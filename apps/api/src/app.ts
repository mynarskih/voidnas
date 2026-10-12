import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Prisma, PrismaClient, Role, type UploadSession } from '@prisma/client';
import argon2 from 'argon2';
import { constants, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { verifyUploadChecksum } from './lib/upload-integrity.js';
import mime from 'mime-types';
import { z } from 'zod';
import { config } from './config.js';
import { audit } from './lib/audit.js';
import { containerInfo, hostMetrics } from './lib/metrics.js';
import { contentDisposition, hashToken, randomToken, resolveInside, safeEqual, sessionCsrfToken, validateName } from './lib/security.js';
import { serialize } from './lib/serialize.js';
import { parseByteRange } from './lib/range.js';
import { decodeText, MAX_TEXT_BYTES, readText, stageTextEdit, textVersion } from './lib/text-files.js';
import { preferencesSchema, preferenceSelection } from './lib/preferences.js';
import { publicUser } from './lib/public-user.js';
import { assertUserStorageDirectories, openStorageFile } from './lib/storage-boundary.js';
import { allowedMutationOrigin } from './lib/request-policy.js';
import { authenticate, passwordOptions } from './lib/authentication.js';
import { entryAccess, folderAccess, assertChildMutation, assertMoveDestination } from './lib/authorization.js';
import { readAdminSettings } from './lib/admin-settings.js';
import { acquireTransfer, TransferThrottle } from './lib/transfers.js';
import { purgeEntry } from './lib/purge.js';
import { sendFile } from './lib/file-stream.js';
import { registerOperations } from './routes/operations.js';
import { registerPublicLinks } from './routes/public-links.js';
import { registerPreviews } from './routes/previews.js';

const prisma = new PrismaClient();
const SESSION_COOKIE = 'voidnas_session';
const body = <T>(schema: z.ZodType<T>, request: FastifyRequest) => schema.parse(request.body);

export async function buildApp() {
  const app = Fastify({ logger: { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'req.headers["x-link-token"]', 'res.headers["set-cookie"]'] }, trustProxy: config.TRUST_PROXY, bodyLimit: 2 * 1024 * 1024, requestTimeout:300000,connectionTimeout:300000 });
  app.decorate('prisma', prisma);
  app.decorateRequest('authUser', null);
  app.decorateRequest('sessionId', null);
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  app.addHook('onSend',async (_request,reply,payload)=>{reply.header('Cache-Control','no-store');return payload});
  app.addContentTypeParser('application/offset+octet-stream', (request, payload, done) => done(null, payload));

  app.addHook('onRequest', async request => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await prisma.session.findFirst({ where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() }, user: { enabled: true } }, include: { user: { select: { id: true, username: true, role: true, enabled: true, quotaBytes: true, usedBytes: true, ...preferenceSelection } } } });
    if (session) { request.authUser = session.user; request.sessionId = session.id; if(session.lastSeenAt.getTime()<Date.now()-60_000)await prisma.session.updateMany({where:{id:session.id,revokedAt:null},data:{lastSeenAt:new Date()}}); if(['POST','PUT','PATCH','DELETE'].includes(request.method)&&/^\/api\/(files|folders|trash|uploads)(\/|$)/.test(request.url))await assertUserStorageDirectories(config.STORAGE_ROOT,session.user.id); }
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!['POST','PUT','PATCH','DELETE'].includes(request.method)) return;
    if (!allowedMutationOrigin(request.headers.origin, request.headers['sec-fetch-site'], request.headers.host, config.COOKIE_SECURE)) return reply.code(403).send({ error: 'Request origin rejected' });
    if (['/api/auth/login','/api/setup'].includes(request.url.split('?')[0])) return;
    // A public-link unlock grants only read access to that bearer link, never
    // an account session. Origin is still checked above, including for guests.
    if (/^\/api\/public-links\/[a-f0-9-]{36}\/unlock$/.test(request.url.split('?')[0])) return;
    if (!request.authUser || !request.sessionId) return;
    const token = request.headers['x-csrf-token'];
    if (typeof token !== 'string' || !safeEqual(token, sessionCsrfToken(request.sessionId))) return reply.code(403).send({ error: 'CSRF validation failed' });
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ code: (error as { code?: string }).code, statusCode: (error as { statusCode?: number }).statusCode }, 'Request failed');
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', details: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    const handled = error as { message?: string; code?: string; statusCode?: number };
    if (handled.message === 'INVALID_FILENAME') return reply.code(400).send({ error: 'Invalid file name' });
    if (handled.code === 'P2025') return reply.code(404).send({ error: 'Resource not found' });
    if (handled.code === 'P2002') return reply.code(409).send({ error: 'Name already exists' });
    return reply.code(handled.statusCode ?? 500).send({ error: handled.statusCode ? handled.message : 'Internal server error' });
  });

  const requireUser = async (request: FastifyRequest, reply: FastifyReply) => { if (!request.authUser) return reply.code(401).send({ error: 'Authentication required' }); };
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => { if (!request.authUser) return reply.code(401).send({ error: 'Authentication required' }); if (request.authUser.role !== 'ADMIN') return reply.code(403).send({ error: 'Administrator role required' }); };
  const inaccessible = () => Object.assign(new Error('File or folder not found'), { statusCode: 404 });
  const assertActiveParents = async (parentId: string | null, ownerId: string, forbiddenId?: string, db: Prisma.TransactionClient = prisma) => {
    const seen = new Set<string>();
    let current = parentId;
    while (current) {
      if (current === forbiddenId || seen.has(current)) throw Object.assign(new Error('A folder cannot be moved into itself or a descendant'), { statusCode: 409 });
      if (seen.size >= 128) throw Object.assign(new Error('Maximum folder depth exceeded'), { statusCode: 409 });
      seen.add(current);
      const folder = await db.fileEntry.findFirst({ where: { id: current, ownerId, isDirectory: true, deletedAt: null }, select: { parentId: true } });
      if (!folder) throw inaccessible();
      current = folder.parentId;
    }
  };
  const sharedAncestorIds = async (itemId: string, parentId: string | null, ownerId: string) => {
    const ids = [itemId]; const seen = new Set(ids); let current = parentId;
    while (current) {
      if (seen.has(current)) throw inaccessible();
      seen.add(current);
      const folder = await prisma.fileEntry.findFirst({ where: { id: current, ownerId, isDirectory: true, deletedAt: null }, select: { parentId: true } });
      if (!folder) throw inaccessible();
      ids.push(current); current = folder.parentId;
    }
    return ids;
  };
  const finalizeUpload = async (upload: UploadSession, request: FastifyRequest) => {
    const finalRel = `users/${upload.userId}/files/${upload.id}`;
    const tempAbs = resolveInside(config.STORAGE_ROOT, upload.temporaryPath);
    const finalAbs = resolveInside(config.STORAGE_ROOT, finalRel);
    try{await verifyUploadChecksum(config.STORAGE_ROOT,upload.temporaryPath,upload.sha256)}
    catch(error){await prisma.uploadSession.update({where:{id:upload.id},data:{status:'FAILED',writing:false}});throw error}
    await mkdir(resolveInside(config.STORAGE_ROOT, `users/${upload.userId}/files`), { recursive: true });
    try {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${upload.userId}, 0))`;
        const actorId=upload.initiatedById??upload.userId;
        if(!await tx.user.findFirst({where:{id:actorId,enabled:true}}))throw inaccessible();
        if((await folderAccess(tx,upload.parentId,actorId)).ownerId!==upload.userId)throw inaccessible();
        await assertActiveParents(upload.parentId, upload.userId, undefined, tx);
        await rename(tempAbs, finalAbs);
        await tx.fileEntry.create({ data: { id: upload.id, ownerId: upload.userId, parentId: upload.parentId, name: upload.fileName, storagePath: finalRel, size: upload.expectedSize, mimeType: upload.mimeType ?? String(mime.lookup(upload.fileName) || 'application/octet-stream') } });
        await tx.user.update({ where: { id: upload.userId }, data: { usedBytes: { increment: upload.expectedSize } } });
        await tx.uploadSession.update({ where: { id: upload.id }, data: { status: 'COMPLETE', receivedBytes: upload.expectedSize,writing:false } });
        await tx.storageReservation.delete({ where: { uploadSessionId: upload.id } });
      });
    } catch (error) {
      // COMMIT can succeed even if its acknowledgement is lost. Preserve the
      // final file until the database outcome is known; startup reconciles it.
      let exists:boolean|undefined;
      try{exists=!!await prisma.fileEntry.findUnique({where:{id:upload.id},select:{id:true}})}catch{}
      if(exists===true)return;
      if(exists===false)await rename(finalAbs,tempAbs).catch(()=>undefined);
      throw error;
    }
    await audit(prisma, request, 'FILE_UPLOAD', 'SUCCESS', upload.id, { size: upload.expectedSize.toString() });
  };

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/setup/status', async () => ({ required: !await prisma.setupLock.findUnique({ where: { id: 1 } }) && await prisma.user.count({ where: { role: 'ADMIN' } }) === 0 }));
  app.post('/api/setup', { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const data = body(z.object({ username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/), password: z.string().min(12).max(256) }), request);
    try {
      const user = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(947331)`;
        if (await tx.setupLock.findUnique({ where: { id: 1 } }) || await tx.user.count({ where: { role: 'ADMIN' } })) throw new Error('SETUP_COMPLETE');
        const passwordHash = await argon2.hash(data.password, passwordOptions);
        const created = await tx.user.create({ data: { username: data.username, passwordHash, role: 'ADMIN', quotaBytes: null } });
        await tx.setupLock.upsert({ where: { id: 1 }, create: { id: 1, completed: true }, update: { completed: true } });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      await mkdir(resolveInside(config.STORAGE_ROOT, `users/${user.id}`), { recursive: true });
      return reply.code(201).send({ created: true });
    } catch (error) { if ((error as Error).message === 'SETUP_COMPLETE') return reply.code(410).send({ error: 'Setup is permanently disabled' }); throw error; }
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const data = body(z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) }), request);
    const user = await authenticate(prisma, data.username, data.password);
    if (!user) { await audit(prisma, request, 'LOGIN_FAILED', 'FAILED', undefined, { username: data.username }); return reply.code(401).send({ error: 'Invalid username or password' }); }
    const token = randomToken(); const sessionId = randomUUID(); const csrf = sessionCsrfToken(sessionId); const expiresAt = new Date(Date.now() + 7 * 86400_000);
    await prisma.$transaction([prisma.session.create({ data: { id: sessionId, userId: user.id, tokenHash: hashToken(token), csrfHash: hashToken(csrf, config.CSRF_SECRET), expiresAt, ip: request.ip, userAgent: request.headers['user-agent'] } }), prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } })]);
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'strict', path: '/', expires: expiresAt });
    await audit(prisma, { ...request, authUser: user } as FastifyRequest, 'LOGIN_SUCCESS', 'SUCCESS');
    return { user: publicUser(user), csrfToken: csrf };
  });
  app.post('/api/auth/logout', { preHandler: requireUser }, async (request, reply) => { await prisma.session.update({ where: { id: request.sessionId! }, data: { revokedAt: new Date() } }); reply.clearCookie(SESSION_COOKIE, { path: '/' }); await audit(prisma, request, 'LOGOUT', 'SUCCESS'); return { ok: true }; });
  app.post('/api/auth/logout-all', { preHandler: requireUser }, async request => { await prisma.session.updateMany({ where: { userId: request.authUser!.id, revokedAt: null }, data: { revokedAt: new Date() } }); return { ok: true }; });
  app.get('/api/auth/me', { preHandler: requireUser }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { user: publicUser(request.authUser!), csrfToken: sessionCsrfToken(request.sessionId!) };
  });
  app.patch('/api/auth/password', { preHandler: requireUser, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async request => {
    const data = body(z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) }), request); const user = await prisma.user.findUniqueOrThrow({ where: { id: request.authUser!.id } });
    if (!await argon2.verify(user.passwordHash, data.currentPassword)) throw Object.assign(new Error('Current password is incorrect'), { statusCode: 400 });
    await prisma.$transaction([prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(data.newPassword, passwordOptions) } }), prisma.session.updateMany({ where: { userId: user.id, id: { not: request.sessionId! } }, data: { revokedAt: new Date() } })]); return { ok: true };
  });
  app.get('/api/auth/preferences', { preHandler: requireUser }, async (request,reply)=>{
    reply.header('Cache-Control','no-store');
    return {preferences:await prisma.user.findUniqueOrThrow({where:{id:request.authUser!.id},select:preferenceSelection})};
  });
  app.patch('/api/auth/preferences', { preHandler: requireUser }, async request=>{
    const data=body(preferencesSchema,request);
    const preferences=await prisma.user.update({where:{id:request.authUser!.id},data,select:preferenceSelection});
    await audit(prisma,request,'PREFERENCES_CHANGED','SUCCESS');
    return {preferences};
  });

  app.get('/api/files/policy',{preHandler:requireUser},async()=>{const settings=await readAdminSettings(prisma);return {trashRetentionDays:settings.trashRetentionDays}});
  app.get('/api/files', { preHandler: requireUser }, async request => {
    const q = z.object({ parentId: z.string().uuid().optional(), cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(100), search: z.string().max(100).optional(), sort: z.enum(['name','size','updatedAt']).default('name'), order: z.enum(['asc','desc']).default('asc') }).parse(request.query);
    await assertActiveParents(q.parentId ?? null, request.authUser!.id);
    const rows = await prisma.fileEntry.findMany({ where: { ownerId: request.authUser!.id, parentId: q.parentId ?? null, deletedAt: null, ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}) }, orderBy: [{ [q.sort]: q.order }, { id: 'asc' }], take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
    return { items: serialize(rows.slice(0,q.limit)), nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null };
  });
  app.post('/api/folders', { preHandler: requireUser }, async request => {
    const data = body(z.object({ name: z.string(), parentId: z.string().uuid().nullable().optional() }).strict(), request);
    const name = validateName(data.name), actorId=request.authUser!.id, ownerId = (await folderAccess(prisma,data.parentId??null,actorId)).ownerId, id = randomUUID();
    await assertUserStorageDirectories(config.STORAGE_ROOT,ownerId);
    const storagePath = `users/${ownerId}/dirs/${id}`;
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`;
      if((await folderAccess(tx,data.parentId??null,actorId)).ownerId!==ownerId)throw inaccessible();
      await assertActiveParents(data.parentId ?? null, ownerId, undefined, tx);
      await mkdir(resolveInside(config.STORAGE_ROOT, storagePath), { recursive: true });
      await tx.fileEntry.create({ data: { id, ownerId, parentId: data.parentId ?? null, name, storagePath, isDirectory: true } });
    });
    // A lost COMMIT acknowledgment must not delete the physical directory.
    return { item: serialize(await prisma.fileEntry.findUniqueOrThrow({ where: { id } })) };
  });
  app.patch('/api/files/:id', { preHandler: requireUser }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const data = body(z.object({ name: z.string().optional(), parentId: z.string().uuid().nullable().optional() }).strict(), request), actorId=request.authUser!.id,ownerId = (await entryAccess(prisma,id,actorId,true)).item.ownerId;
    const updated = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`;
      const authorization=await entryAccess(tx,id,actorId,true),item=authorization.item;assertChildMutation(authorization);
      if(data.parentId!==undefined)await assertMoveDestination(tx,data.parentId,actorId,authorization);
      await assertActiveParents(item.parentId, ownerId, undefined, tx);
      if (data.parentId !== undefined) await assertActiveParents(data.parentId, ownerId, item.isDirectory ? id : undefined, tx);
      return tx.fileEntry.update({ where: { id }, data: { ...(data.name !== undefined ? { name: validateName(data.name) } : {}), ...(data.parentId !== undefined ? { parentId: data.parentId } : {}) } });
    });
    await audit(prisma, request, 'FILE_MOVE', 'SUCCESS', id); return { item: serialize(updated) };
  });
  app.get('/api/files/:id/text', { preHandler: requireUser }, async (request,reply) => {
    const {id}=z.object({id:z.string().uuid()}).parse(request.params);
    const {item}=await entryAccess(prisma,id,request.authUser!.id);
    if(item.isDirectory)throw inaccessible();
    await assertActiveParents(item.parentId,item.ownerId);
    reply.header('Cache-Control','no-store');
    return readText(item.storagePath);
  });
  app.put('/api/files/:id/text', { preHandler: requireUser, bodyLimit: 8*1024*1024 }, async request => {
    const {id}=z.object({id:z.string().uuid()}).parse(request.params);
    const data=body(z.object({content:z.string().max(MAX_TEXT_BYTES),version:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),request);
    const bytes=Buffer.from(data.content,'utf8');decodeText(bytes);
    const actorId=request.authUser!.id,userId=(await entryAccess(prisma,id,actorId,true)).item.ownerId;
    await assertUserStorageDirectories(config.STORAGE_ROOT,userId);
    let staged:Awaited<ReturnType<typeof stageTextEdit>>|undefined;
    let updated;
    try{
      updated=await prisma.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
        await tx.$queryRaw`SELECT id FROM "FileEntry" WHERE id=${id}::uuid AND "ownerId"=${userId}::uuid FOR UPDATE`;
        const {item}=await entryAccess(tx,id,actorId,true);
        if(item.isDirectory)throw inaccessible();
        await assertActiveParents(item.parentId,userId,undefined,tx);
        const current=await readText(item.storagePath);
        if(current.version!==data.version)throw Object.assign(new Error('File changed since it was opened. Reopen it before saving.'),{statusCode:409});
        const delta=BigInt(bytes.length)-item.size;
        const user=await tx.user.findUniqueOrThrow({where:{id:userId}});
        const reserved=(await tx.storageReservation.aggregate({where:{userId},_sum:{bytes:true}}))._sum.bytes??0n;
        if(delta>0 && user.quotaBytes!==null && user.usedBytes+reserved+delta>user.quotaBytes)throw Object.assign(new Error('Quota exceeded'),{statusCode:413});
        staged=await stageTextEdit(userId,item.storagePath,bytes);
        const row=await tx.fileEntry.update({where:{id},data:{storagePath:staged.storagePath,size:BigInt(bytes.length)}});
        await tx.user.update({where:{id:userId},data:{usedBytes:{increment:delta}}});
        return row;
      },{timeout:15000});
    }catch(error){
      // If the connection fails during COMMIT, never assume the DB rolled back.
      const pending=staged;
      if(pending)await prisma.fileEntry.findUnique({where:{storagePath:pending.storagePath},select:{id:true}}).then(record=>pending.finish(!!record)).catch(cleanup=>request.log.error(cleanup,'Text edit recovery deferred to startup'));
      throw error;
    }
    await staged?.finish(true).catch(error=>request.log.error(error,'Text edit cleanup deferred to startup'));
    await audit(prisma,request,'FILE_EDIT','SUCCESS',id);
    return {item:serialize(updated),version:textVersion(bytes)};
  });
  app.post('/api/files/:id/copy', { preHandler: requireUser, config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const item = await prisma.fileEntry.findFirstOrThrow({ where: { id, ownerId: request.authUser!.id, deletedAt: null } }); if (item.isDirectory) throw Object.assign(new Error('Folder copy is not supported by this operation'), { statusCode: 409 }); await assertActiveParents(item.parentId, item.ownerId);
    const userId = request.authUser!.id;
    let name = `Copy of ${item.name}`; for (let n=2; await prisma.fileEntry.findFirst({ where: { ownerId:userId,parentId:item.parentId,name,deletedAt:null } }); n++) name = `Copy ${n} of ${item.name}`;
    name=validateName(name);
    const entryId=randomUUID(),temporaryPath=`users/${userId}/.tmp/${entryId}.part`,expiresAt=new Date(Date.now()+config.UPLOAD_TTL_HOURS*3600_000);
    await mkdir(resolveInside(config.STORAGE_ROOT,`users/${userId}/.tmp`),{recursive:true});
    // Copies reserve space BEFORE streaming, just like uploads. Otherwise a
    // user could exhaust the physical disk with concurrent rejected copies.
    const upload=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      const user=await tx.user.findUniqueOrThrow({where:{id:userId}});
      const reserved=(await tx.storageReservation.aggregate({where:{userId},_sum:{bytes:true}}))._sum.bytes??0n;
      if(user.quotaBytes!==null&&user.usedBytes+reserved+item.size>user.quotaBytes)throw Object.assign(new Error('Quota exceeded'),{statusCode:413});
      return tx.uploadSession.create({data:{id:entryId,userId,parentId:item.parentId,fileName:name,expectedSize:item.size,mimeType:item.mimeType,temporaryPath,expiresAt,writing:true,reservation:{create:{userId,bytes:item.size,expiresAt}}}});
    });
    let source:Awaited<ReturnType<typeof openStorageFile>>|undefined,destination:Awaited<ReturnType<typeof openStorageFile>>|undefined;
    try{
      source=await openStorageFile(config.STORAGE_ROOT,item.storagePath,constants.O_RDONLY);
      const info=await source.stat();if(!info.isFile()||BigInt(info.size)!==item.size)throw Object.assign(new Error('File is unavailable or changed on disk'),{statusCode:409});
      destination=await openStorageFile(config.STORAGE_ROOT,temporaryPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL);
      await pipeline(source.createReadStream(),createWriteStream('',{fd:destination.fd,autoClose:false}));source=undefined;
      await destination.sync();await destination.close();destination=undefined;
      await finalizeUpload(upload,request);
      return {item:serialize(await prisma.fileEntry.findUniqueOrThrow({where:{id:entryId}}))};
    }catch(error){
      await source?.close().catch(()=>undefined);await destination?.close().catch(()=>undefined);
      // Preserve files on an unknown COMMIT result instead of deleting data.
      await prisma.fileEntry.findUnique({where:{id:entryId},select:{id:true}}).then(async record=>{
        if(!record){await rm(resolveInside(config.STORAGE_ROOT,temporaryPath),{force:true});await prisma.$transaction([prisma.storageReservation.deleteMany({where:{uploadSessionId:entryId}}),prisma.uploadSession.update({where:{id:entryId},data:{status:'FAILED',writing:false}})])}
      }).catch(()=>undefined);
      throw error;
    }
  });
  app.delete('/api/files/:id', { preHandler: requireUser }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params),actorId=request.authUser!.id,ownerId=(await entryAccess(prisma,id,actorId,true)).item.ownerId;
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`;
      const authorization=await entryAccess(tx,id,actorId,true),item=authorization.item;assertChildMutation(authorization);
      await assertActiveParents(item.parentId, ownerId, undefined, tx);
      await tx.fileEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    });
    await audit(prisma, request, 'FILE_DELETE', 'SUCCESS', id); return { ok: true };
  });
  app.get('/api/trash', { preHandler: requireUser }, async request => { const rows = await prisma.fileEntry.findMany({ where: { ownerId: request.authUser!.id, deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' }, take: 200 }); const visible = await Promise.all(rows.map(async row => await assertActiveParents(row.parentId, row.ownerId).then(() => true).catch(() => false))); return { items: serialize(rows.filter((_, index) => visible[index])) }; });
  app.post('/api/trash/:id/restore', { preHandler: requireUser }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params), ownerId = request.authUser!.id;
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`;
      const item = await tx.fileEntry.findFirst({ where: { id, ownerId, deletedAt: { not: null } } }); if (!item) throw inaccessible();
      await assertActiveParents(item.parentId, ownerId, undefined, tx);
      await tx.fileEntry.update({ where: { id }, data: { deletedAt: null } });
    });
    await audit(prisma, request, 'FILE_RESTORE', 'SUCCESS', id); return { ok: true };
  });
  app.delete('/api/trash/:id', { preHandler: requireUser }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const ownerId = request.authUser!.id;
    const result=await purgeEntry(prisma,config.STORAGE_ROOT,id,ownerId);
    await audit(prisma,request,'FILE_DELETE_PERMANENT','SUCCESS',id,{entries:result.entries,bytes:result.bytes.toString()});
    return {ok:true};
  });

  app.post('/api/uploads', { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const data=body(z.object({fileName:z.string(),size:z.coerce.bigint().nonnegative().max(BigInt(Number.MAX_SAFE_INTEGER)),mimeType:z.string().max(255).optional(),parentId:z.string().uuid().nullable().optional(),uploadId:z.string().uuid().optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict(),request);
    const fileName=validateName(data.fileName),actorId=request.authUser!.id;
    const userId=(await folderAccess(prisma,data.parentId??null,actorId)).ownerId;
    await assertUserStorageDirectories(config.STORAGE_ROOT,userId);
    await assertActiveParents(data.parentId??null,userId);
    const id=data.uploadId??randomUUID(),tempRel=`users/${userId}/.tmp/${id}.part`,expiresAt=new Date(Date.now()+config.UPLOAD_TTL_HOURS*3600_000);
    await mkdir(resolveInside(config.STORAGE_ROOT,`users/${userId}/.tmp`),{recursive:true});
    let createdFile=false;
    let result:{upload:UploadSession;created:boolean};
    try{
      result=await prisma.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
        if((await folderAccess(tx,data.parentId??null,actorId)).ownerId!==userId)throw inaccessible();
        const existing=await tx.uploadSession.findUnique({where:{id}});
        if(existing){
          if(existing.userId!==userId||(existing.initiatedById??existing.userId)!==actorId)throw inaccessible();
          if(existing.fileName!==fileName||existing.expectedSize!==data.size||existing.parentId!==(data.parentId??null)||existing.sha256!==(data.sha256??null))throw Object.assign(new Error('Upload identity mismatch'),{statusCode:409});
          if(!['ACTIVE','COMPLETE'].includes(existing.status)||(existing.status==='ACTIVE'&&existing.expiresAt<=new Date()))throw Object.assign(new Error('Upload session expired'),{statusCode:410});
          return {upload:existing,created:false};
        }
        const user=await tx.user.findUniqueOrThrow({where:{id:userId},select:{quotaBytes:true,usedBytes:true}});
        const reserved=(await tx.storageReservation.aggregate({where:{userId},_sum:{bytes:true}}))._sum.bytes??0n;
        if(user.quotaBytes!==null&&user.usedBytes+reserved+data.size>user.quotaBytes)throw Object.assign(new Error('Quota exceeded'),{statusCode:413});
        const upload=await tx.uploadSession.create({data:{id,userId,initiatedById:actorId,parentId:data.parentId??null,fileName,expectedSize:data.size,mimeType:data.mimeType,sha256:data.sha256,temporaryPath:tempRel,expiresAt,writing:data.size===0n,reservation:{create:{userId,bytes:data.size,expiresAt}}}});
        const handle=await openStorageFile(config.STORAGE_ROOT,tempRel,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL);
        createdFile=true;try{await handle.sync()}finally{await handle.close()}
        return {upload,created:true};
      },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    }catch(error){
      // An uncertain COMMIT must not remove bytes referenced by a committed row.
      if(createdFile){
        const absent=await prisma.uploadSession.findUnique({where:{id}}).then(row=>!row).catch(()=>false);
        if(absent)await rm(resolveInside(config.STORAGE_ROOT,tempRel),{force:true});
      }
      throw error;
    }
    if(result.created&&data.size===0n)await finalizeUpload(result.upload,request);
    const complete=result.upload.status==='COMPLETE'||(result.created&&data.size===0n);
    const offset=complete?data.size.toString():result.upload.receivedBytes.toString();
    return reply.header('Location',`/api/uploads/${id}`).header('Upload-Offset',offset).header('Upload-Length',data.size.toString()).code(result.created?201:200).send({id,offset,expiresAt:result.upload.expiresAt,complete});
  });
  const accessibleUpload=async(request:FastifyRequest)=>{
    const {id}=z.object({id:z.string().uuid()}).parse(request.params),actorId=request.authUser!.id;
    const upload=await prisma.uploadSession.findFirst({where:{id,OR:[{initiatedById:actorId},{initiatedById:null,userId:actorId}]}});
    if(!upload)throw inaccessible();
    if(!['ACTIVE','COMPLETE'].includes(upload.status)||(upload.status==='ACTIVE'&&upload.expiresAt<=new Date()))throw Object.assign(new Error('Upload session expired'),{statusCode:410});
    if(upload.status==='ACTIVE'&&(await folderAccess(prisma,upload.parentId,actorId)).ownerId!==upload.userId)throw inaccessible();
    return upload;
  };
  app.get('/api/uploads/:id',{preHandler:requireUser,exposeHeadRoute:false},async(request,reply)=>{
    const upload=await accessibleUpload(request);
    return reply.header('Cache-Control','no-store').send({id:upload.id,status:upload.status,offset:upload.receivedBytes.toString(),size:upload.expectedSize.toString(),sha256:upload.sha256,writing:upload.writing,expiresAt:upload.expiresAt});
  });
  app.head('/api/uploads/:id',{preHandler:requireUser},async(request,reply)=>{
    const upload=await accessibleUpload(request);
    return reply.header('Cache-Control','no-store').header('Upload-Offset',upload.receivedBytes.toString()).header('Upload-Length',upload.expectedSize.toString()).header('Upload-Status',upload.status).header('Upload-Expires',upload.expiresAt.toISOString()).code(204).send();
  });
  app.patch('/api/uploads/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/offset+octet-stream') return reply.code(415).send({ error: 'Upload content type must be application/offset+octet-stream' });
    const offset=BigInt(z.string().max(16).regex(/^\d+$/).parse(request.headers['upload-offset']));
    const chunkLength=BigInt(z.string().max(16).regex(/^\d+$/).parse(request.headers['content-length']));
    if(chunkLength<1n||chunkLength>64n*1024n*1024n)return reply.code(413).send({error:'Chunks must be between 1 byte and 64 MB'});
    const actorId=request.authUser!.id;
    const upload=await prisma.uploadSession.findFirst({where:{id,OR:[{initiatedById:actorId},{initiatedById:null,userId:actorId}],status:'ACTIVE',expiresAt:{gt:new Date()}}});
    if(!upload)throw inaccessible();
    if((await folderAccess(prisma,upload.parentId,actorId)).ownerId!==upload.userId)throw inaccessible();
    await assertUserStorageDirectories(config.STORAGE_ROOT,upload.userId);
    await assertActiveParents(upload.parentId,upload.userId);
    if(upload.writing||offset!==upload.receivedBytes)return reply.code(409).header('Upload-Offset',upload.receivedBytes.toString()).send({error:'Upload is busy or offset mismatch'});
    const received=offset+chunkLength;
    if(received>upload.expectedSize)return reply.code(413).send({error:'Upload exceeds declared size'});
    // Hold the exclusive write state until the bytes are durably written. Never
    // advertise a future offset while an earlier chunk is still streaming.
    const renewedExpiry=new Date(Date.now()+config.UPLOAD_TTL_HOURS*3600_000);
    const claimed=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${upload.userId}, 0))`;
      if((await folderAccess(tx,upload.parentId,actorId)).ownerId!==upload.userId)throw inaccessible();
      const claim=await tx.uploadSession.updateMany({where:{id,userId:upload.userId,status:'ACTIVE',writing:false,receivedBytes:offset,expiresAt:{gt:new Date()}},data:{writing:true,expiresAt:renewedExpiry}});
      if(claim.count===1)await tx.storageReservation.update({where:{uploadSessionId:id},data:{expiresAt:renewedExpiry}});
      return claim;
    });
    if(claimed.count!==1)return reply.code(409).header('Upload-Offset',offset.toString()).send({error:'Concurrent upload request rejected'});
    let handle:Awaited<ReturnType<typeof openStorageFile>>|undefined;
    let releaseTransfer:(()=>void)|undefined;
    let bytes=0;
    const bounded=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;if(BigInt(bytes)>chunkLength)callback(new Error('Chunk exceeds declared size'));else callback(null,chunk)}});
    try{
      const settings=await readAdminSettings(prisma);releaseTransfer=acquireTransfer(actorId,settings.maxConcurrentTransfers);
      handle=await openStorageFile(config.STORAGE_ROOT,upload.temporaryPath,constants.O_RDWR);
      await pipeline(request.body as NodeJS.ReadableStream,bounded,new TransferThrottle(settings.uploadBytesPerSecond),createWriteStream('',{fd:handle.fd,start:Number(offset),autoClose:false}));
      if(BigInt(bytes)!==chunkLength)throw new Error('Incomplete chunk');
      await handle.sync();await handle.close();handle=undefined;
      if(received===upload.expectedSize)await finalizeUpload(upload,request);
      else await prisma.uploadSession.update({where:{id},data:{receivedBytes:received,writing:false}});
    }catch(error){
      if(handle){await handle.truncate(Number(offset)).catch(()=>undefined);await handle.close().catch(()=>undefined);handle=undefined}
      // Do not undo an uncertain final COMMIT. Recovery examines both locations.
      if(received!==upload.expectedSize){
        const rollback=await openStorageFile(config.STORAGE_ROOT,upload.temporaryPath,constants.O_RDWR).catch(()=>null);
        if(rollback){try{await rollback.truncate(Number(offset))}finally{await rollback.close()}}
      }
      await prisma.uploadSession.updateMany({where:{id,status:'ACTIVE',writing:true},data:{writing:false}}).catch(()=>undefined);
      throw error;
    }finally{releaseTransfer?.()}
    return reply.header('Upload-Offset', received.toString()).code(204).send();
  });
  app.delete('/api/uploads/:id', { preHandler: requireUser }, async request => {
    const {id}=z.object({id:z.string().uuid()}).parse(request.params);
    const actorId=request.authUser!.id;
    const upload=await prisma.uploadSession.findFirst({where:{id,OR:[{initiatedById:actorId},{initiatedById:null,userId:actorId}],status:{in:['ACTIVE','FAILED','CANCELLED']}}});
    if(!upload)throw inaccessible();
    await assertUserStorageDirectories(config.STORAGE_ROOT,upload.userId);
    const cancelled=await prisma.uploadSession.updateMany({where:{id,status:{in:['ACTIVE','FAILED','CANCELLED']},writing:false},data:{status:'CANCELLED'}});
    if(cancelled.count!==1)throw Object.assign(new Error('Upload is busy; retry after the current chunk'),{statusCode:409});
    await rm(resolveInside(config.STORAGE_ROOT,upload.temporaryPath),{force:true});
    await prisma.storageReservation.deleteMany({where:{uploadSessionId:id}});
    return {ok:true};
  });

  app.get('/api/files/:id/download', { preHandler: requireUser }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const {item}=await entryAccess(prisma,id,request.authUser!.id);if(item.isDirectory)throw inaccessible();
    await audit(prisma,request,'FILE_DOWNLOAD','SUCCESS',id);
    return sendFile(prisma,item,request,reply);
  });

  app.get('/api/shares', { preHandler: requireUser }, async request => { const rows = await prisma.share.findMany({ where: { recipientId: request.authUser!.id, owner: { enabled: true }, file: { deletedAt: null } }, include: { file: true, owner: { select: { username: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); const visible = await Promise.all(rows.map(async row => await assertActiveParents(row.file.parentId, row.file.ownerId).then(() => true).catch(() => false))); return { items: serialize(rows.filter((_, index) => visible[index])) }; });
  app.get('/api/shares/:id/files', { preHandler: requireUser }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const q = z.object({ parentId: z.string().uuid().optional(), cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query);
    const share = await prisma.share.findFirst({ where: { id, recipientId: request.authUser!.id, owner: { enabled: true } }, include: { file: true } });
    if (!share || !share.file.isDirectory || share.file.deletedAt) throw inaccessible();
    const parentId = q.parentId ?? share.fileId;
    const ancestorIds = await sharedAncestorIds(parentId, (await prisma.fileEntry.findFirst({ where: { id: parentId, ownerId: share.ownerId, isDirectory: true, deletedAt: null }, select: { parentId: true } }))?.parentId ?? null, share.ownerId);
    if (!ancestorIds.includes(share.fileId)) throw inaccessible();
    const rows = await prisma.fileEntry.findMany({ where: { ownerId: share.ownerId, parentId, deletedAt: null }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
    return { items: serialize(rows.slice(0, q.limit)), nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null };
  });
  app.get('/api/shares/outgoing',{preHandler:requireUser},async request=>{
    const q=z.object({fileId:z.string().uuid().optional()}).parse(request.query);
    const rows=await prisma.share.findMany({where:{ownerId:request.authUser!.id,...(q.fileId?{fileId:q.fileId}:{})},select:{id:true,fileId:true,permission:true,createdAt:true,recipient:{select:{username:true}},file:{select:{id:true,name:true,isDirectory:true}}},take:200,orderBy:{createdAt:'desc'}});return {items:rows};
  });
  app.post('/api/shares', { preHandler: requireUser }, async request => {
    const data=body(z.object({fileId:z.string().uuid(),username:z.string().min(1).max(64),permission:z.enum(['READ','READ_WRITE'])}).strict(),request),ownerId=request.authUser!.id;
    const share=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},0))`;
      const file=await tx.fileEntry.findFirstOrThrow({where:{id:data.fileId,ownerId,deletedAt:null}});await assertActiveParents(file.parentId,ownerId,undefined,tx);
      const recipient=await tx.user.findUniqueOrThrow({where:{username:data.username,enabled:true}});if(recipient.id===ownerId)throw Object.assign(new Error('Cannot share with yourself'),{statusCode:400});
      return tx.share.upsert({where:{fileId_recipientId:{fileId:file.id,recipientId:recipient.id}},create:{fileId:file.id,ownerId,recipientId:recipient.id,permission:data.permission},update:{permission:data.permission}});
    });await audit(prisma,request,'SHARE_CREATED','SUCCESS',share.id);return {share:serialize(share)};
  });
  app.patch('/api/shares/:id',{preHandler:requireUser},async request=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params),ownerId=request.authUser!.id;
    const data=body(z.object({permission:z.enum(['READ','READ_WRITE'])}).strict(),request);
    await prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},0))`;const row=await tx.share.findFirst({where:{id,ownerId}});if(!row)throw inaccessible();await tx.share.update({where:{id},data})});
    await audit(prisma,request,'SHARE_UPDATED','SUCCESS',id);return {ok:true};
  });
  app.delete('/api/shares/:id', { preHandler: requireUser }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params),ownerId=request.authUser!.id;
    await prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},0))`;await tx.share.deleteMany({where:{id,ownerId}})});
    await audit(prisma, request, 'SHARE_DELETED', 'SUCCESS', id); return { ok: true };
  });

  app.get('/api/admin/overview', { preHandler: requireAdmin }, async () => { const [users, storage, metrics] = await Promise.all([prisma.user.count(), prisma.user.aggregate({ _sum: { usedBytes: true, quotaBytes: true } }), hostMetrics()]); return serialize({ users, storageUsedBytes: storage._sum.usedBytes ?? 0n, quotaBytes: storage._sum.quotaBytes, metrics }); });
  app.get('/api/admin/users', { preHandler: requireAdmin }, async request => { const q = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query); const rows = await prisma.user.findMany({ select: { id: true, username: true, role: true, quotaBytes: true, usedBytes: true, enabled: true, createdAt: true, lastLogin: true }, orderBy: { createdAt: 'desc' }, take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) }); return { items: serialize(rows.slice(0,q.limit)), nextCursor: rows.length > q.limit ? rows[q.limit-1].id : null }; });
  app.post('/api/admin/users', { preHandler: requireAdmin }, async request => { const data = body(z.object({ username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/), password: z.string().min(12).max(256), role: z.nativeEnum(Role).default(Role.USER), quotaBytes: z.coerce.bigint().nonnegative().nullable() }), request); const passwordHash = await argon2.hash(data.password, passwordOptions); const user = await prisma.user.create({ data: { username: data.username, role: data.role, quotaBytes: data.quotaBytes, passwordHash } }); await mkdir(resolveInside(config.STORAGE_ROOT, `users/${user.id}`), { recursive: true }); await audit(prisma, request, 'USER_CREATED', 'SUCCESS', user.id); return { user: publicUser(user) }; });
  app.patch('/api/admin/users/:id', { preHandler: requireAdmin }, async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const data = body(z.object({ enabled: z.boolean().optional(), role: z.nativeEnum(Role).optional(), quotaBytes: z.coerce.bigint().nonnegative().nullable().optional(), password: z.string().min(12).max(256).optional() }), request);
    if (id === request.authUser!.id && (data.enabled === false || data.role === 'USER')) throw Object.assign(new Error('Cannot remove your own administrator access'), { statusCode: 409 });
    const update: Prisma.UserUpdateInput = { ...(data.enabled !== undefined ? { enabled: data.enabled } : {}), ...(data.role ? { role: data.role } : {}), ...(data.quotaBytes !== undefined ? { quotaBytes: data.quotaBytes } : {}), ...(data.password ? { passwordHash: await argon2.hash(data.password, passwordOptions) } : {}) };
    const user = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      if (data.quotaBytes !== undefined && data.quotaBytes !== null) {
        const current = await tx.user.findUniqueOrThrow({ where: { id }, select: { usedBytes: true } });
        const reserved = (await tx.storageReservation.aggregate({ where: { userId: id }, _sum: { bytes: true } }))._sum.bytes ?? 0n;
        if (data.quotaBytes < current.usedBytes + reserved) throw Object.assign(new Error('Quota cannot be below used and reserved storage'), { statusCode: 409 });
      }
      const updated = await tx.user.update({ where: { id }, data: update });
      if (data.enabled === false || data.password || data.role) await tx.session.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } });
      return updated;
    });
    if (data.password) await audit(prisma, request, 'PASSWORD_RESET', 'SUCCESS', id);
    if (data.role) await audit(prisma, request, 'ROLE_CHANGED', 'SUCCESS', id);
    if (data.quotaBytes !== undefined) await audit(prisma, request, 'QUOTA_CHANGED', 'SUCCESS', id);
    if (data.enabled !== undefined) await audit(prisma, request, data.enabled ? 'USER_ENABLED' : 'USER_DISABLED', 'SUCCESS', id);
    return { user: publicUser(user) };
  });
  app.delete('/api/admin/users/:id', { preHandler: requireAdmin }, async request => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); if (id === request.authUser!.id) throw Object.assign(new Error('Cannot delete yourself'), { statusCode: 409 }); await prisma.user.update({ where: { id }, data: { enabled: false } }); await prisma.session.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } }); await audit(prisma, request, 'USER_DELETED', 'SUCCESS', id); return { ok: true, note: 'Account disabled; data retained for safe administrative deletion' }; });
  app.get('/api/admin/system', { preHandler: requireAdmin }, async () => { const [host, database] = await Promise.all([hostMetrics(), prisma.$queryRaw`SELECT 1`.then(() => 'Healthy').catch(() => 'Unavailable')]); return serialize({ host, container: containerInfo(), components: { backend: 'Healthy', database, storage: await access(config.STORAGE_ROOT).then(() => 'Healthy').catch(() => 'Unavailable'), systemMonitor: host.status } }); });
  app.get('/api/admin/storage', { preHandler: requireAdmin }, async () => serialize(await prisma.user.aggregate({ _sum: { usedBytes: true, quotaBytes: true }, _count: true })));
  app.get('/api/admin/audit', { preHandler: requireAdmin }, async request => { const q = z.object({ cursor: z.coerce.bigint().optional(), limit: z.coerce.number().int().min(1).max(200).default(100), action: z.string().optional() }).parse(request.query); const logs = await prisma.auditLog.findMany({ where: q.action ? { action: q.action } : {}, include: { user: { select: { username: true } } }, orderBy: { id: 'desc' }, take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) }); return { items: serialize(logs.slice(0,q.limit)), nextCursor: logs.length > q.limit ? logs[q.limit-1].id.toString() : null }; });

  registerOperations(app,requireUser,requireAdmin);
  registerPreviews(app,requireUser);
  registerPublicLinks(app,requireUser);
  app.addHook('onClose', async () => prisma.$disconnect());
  return app;
}
