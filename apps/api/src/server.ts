import { buildApp } from './app.js';
import { config } from './config.js';
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { resolveInside } from './lib/security.js';
import { recoverTextEdits } from './lib/text-files.js';
import { assertUserStorageDirectories } from './lib/storage-boundary.js';
import { cleanupExpiredUploads } from './lib/upload-cleanup.js';
import { folderAccess } from './lib/authorization.js';
import { maintainOperations } from './lib/operations.js';
import { verifyUploadChecksum } from './lib/upload-integrity.js';

const app = await buildApp();
await mkdir(config.STORAGE_ROOT, { recursive: true });

async function reconcilePurges() {
  const usersRoot = resolveInside(config.STORAGE_ROOT, 'users');
  for (const user of await readdir(usersRoot, { withFileTypes: true }).catch(() => [])) {
    if (!user.isDirectory() || !/^[0-9a-f-]{36}$/i.test(user.name)) continue;
    const purgeRoot = resolveInside(config.STORAGE_ROOT, `users/${user.name}/.purge`);
    for (const group of await readdir(purgeRoot, { withFileTypes: true }).catch(() => [])) {
      if (!group.isDirectory() || !/^[0-9a-f-]{36}$/i.test(group.name)) continue;
      const groupPath = resolveInside(config.STORAGE_ROOT, `users/${user.name}/.purge/${group.name}`);
      let recovered = true;
      for (const entry of await readdir(groupPath, { withFileTypes: true }).catch(() => [])) {
        if (!/^[0-9a-f-]{36}$/i.test(entry.name) || entry.isSymbolicLink()) { recovered = false; continue; }
        const staged = resolveInside(config.STORAGE_ROOT, `users/${user.name}/.purge/${group.name}/${entry.name}`);
        const record = await app.prisma.fileEntry.findFirst({ where: { id: entry.name, ownerId: user.name }, select: { storagePath: true } });
        if (!record) continue;
        const original = resolveInside(config.STORAGE_ROOT, record.storagePath);
        try { await lstat(original); recovered = false; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { recovered = false; continue; }
          await rename(staged, original).catch(() => { recovered = false; });
        }
      }
      if (recovered) await rm(groupPath, { recursive: true, force: true }).catch(error => app.log.error(error, 'Could not clean purge staging'));
    }
  }
}

async function reconcileUploads() {
  const active = await app.prisma.uploadSession.findMany({ where: { status: 'ACTIVE' } });
  for (const upload of active) {
    await assertUserStorageDirectories(config.STORAGE_ROOT,upload.userId);
    // A revoked recipient must not regain write access through restart recovery.
    const actorId=upload.initiatedById??upload.userId;
    const permitted=await app.prisma.user.findFirst({where:{id:actorId,enabled:true}}).then(async actor=>!!actor&&(await folderAccess(app.prisma,upload.parentId,actorId)).ownerId===upload.userId).catch(()=>false);
    const temp = resolveInside(config.STORAGE_ROOT, upload.temporaryPath);
    const finalRel = `users/${upload.userId}/files/${upload.id}`;
    const final = resolveInside(config.STORAGE_ROOT, finalRel);
    if(!permitted){
      // A completed rename without DB commit must remain tracked for cleanup,
      // not become an unaccounted final-file orphan after grant revocation.
      const finalInfo=await lstat(final).catch(()=>null),tempInfo=await lstat(temp).catch(()=>null);
      if(finalInfo&&!tempInfo&&!await app.prisma.fileEntry.findUnique({where:{id:upload.id}}))await rename(final,temp);
      await app.prisma.uploadSession.update({where:{id:upload.id},data:{status:'FAILED',writing:false}});continue;
    }
    const tempInfo = await lstat(temp).catch(() => null);
    const finalInfo = tempInfo ? null : await lstat(final).catch(() => null);
    if (!tempInfo && !finalInfo) {
      await app.prisma.$transaction([app.prisma.storageReservation.deleteMany({ where: { uploadSessionId: upload.id } }), app.prisma.uploadSession.update({ where: { id: upload.id }, data: { status: 'FAILED' } })]);
      continue;
    }
    const present = tempInfo ?? finalInfo!;
    if (!present.isFile() || BigInt(present.size) > upload.expectedSize) {
      app.log.error({ uploadId: upload.id }, 'Upload has an invalid stored size');
      continue;
    }
    if (BigInt(present.size) < upload.expectedSize) {
      if (finalInfo) await rename(final, temp);
      if (upload.writing || upload.receivedBytes !== BigInt(present.size)) await app.prisma.uploadSession.update({ where: { id: upload.id }, data: { receivedBytes: BigInt(present.size),writing:false } });
      continue;
    }
    try{await verifyUploadChecksum(config.STORAGE_ROOT,tempInfo?upload.temporaryPath:finalRel,upload.sha256)}
    catch{if(finalInfo)await rename(final,temp);await app.prisma.uploadSession.update({where:{id:upload.id},data:{status:'FAILED',writing:false}});continue}
    if (tempInfo) { await mkdir(resolveInside(config.STORAGE_ROOT, `users/${upload.userId}/files`), { recursive: true }); await rename(temp, final); }
    try {
      await app.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${upload.userId}, 0))`;
        if(!await tx.user.findFirst({where:{id:actorId,enabled:true}})||(await folderAccess(tx,upload.parentId,actorId)).ownerId!==upload.userId)throw new Error('Upload permission revoked');
        await tx.fileEntry.create({ data: { id: upload.id, ownerId: upload.userId, parentId: upload.parentId, name: upload.fileName, storagePath: finalRel, size: upload.expectedSize, mimeType: upload.mimeType || 'application/octet-stream' } });
        await tx.user.update({ where: { id: upload.userId }, data: { usedBytes: { increment: upload.expectedSize } } });
        await tx.uploadSession.update({ where: { id: upload.id }, data: { status: 'COMPLETE', receivedBytes: upload.expectedSize,writing:false } });
        await tx.storageReservation.deleteMany({ where: { uploadSessionId: upload.id } });
        await tx.auditLog.create({data:{userId:actorId,action:'FILE_UPLOAD',resourceId:upload.id,result:'SUCCESS',metadata:{recovered:true,size:upload.expectedSize.toString()}}});
      });
    } catch (error) { app.log.error({ error, uploadId: upload.id }, 'Could not reconcile completed upload'); }
  }
}

await reconcilePurges();
await reconcileUploads();
await recoverTextEdits(async storagePath=>!!await app.prisma.fileEntry.findUnique({where:{storagePath},select:{id:true}}));
await cleanupExpiredUploads(app.prisma, config.STORAGE_ROOT);
const interval = setInterval(() => void cleanupExpiredUploads(app.prisma, config.STORAGE_ROOT).catch(error => app.log.error({ code: error.code }, 'Upload cleanup deferred')), 60 * 60 * 1000); interval.unref();
let maintenanceBusy=false;
const maintenance=async()=>{if(maintenanceBusy)return;maintenanceBusy=true;try{await maintainOperations(app.prisma)}catch(error){app.log.warn({code:(error as {code?:string}).code},'Operations check deferred')}finally{maintenanceBusy=false}};
const operationsInterval=setInterval(()=>void maintenance(),60_000);operationsInterval.unref();
void maintenance();
await app.listen({ host: '0.0.0.0', port: 3000 });

const shutdown = async () => { clearInterval(interval);clearInterval(operationsInterval);await app.close(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
