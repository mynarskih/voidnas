import type { FastifyInstance,FastifyRequest,FastifyReply } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { passwordOptions } from '../lib/authentication.js';
import { randomToken,hashToken } from '../lib/security.js';
import { ancestorIds,inaccessible } from '../lib/authorization.js';
import { readAdminSettings } from '../lib/admin-settings.js';
import { inspectPreview,thumbnail } from '../lib/previews.js';
import { sendFile } from '../lib/file-stream.js';
import { serialize } from '../lib/serialize.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';

const linkSelection={id:true,fileId:true,createdAt:true,expiresAt:true,revokedAt:true,updatedAt:true};
const expiry=z.string().datetime().nullable().refine(value=>value===null||Date.parse(value)>Date.now(),'Expiry must be in the future');
const linkData=z.object({expiresAt:expiry.optional(),password:z.string().min(8).max(256).nullable().optional()}).strict();
type Guard=(request:FastifyRequest,reply:FastifyReply)=>Promise<unknown>;
export function registerPublicLinks(app:FastifyInstance,requireUser:Guard){
  const db=app.prisma;
  const cookieName=(id:string)=>`voidnas_link_${id}`;
  async function liveLink(id:string){
    if(!(await readAdminSettings(db)).publicLinksEnabled)throw inaccessible();
    const link=await db.publicLink.findFirst({where:{id,revokedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}],owner:{enabled:true},file:{deletedAt:null}},include:{file:true}});
    if(!link)throw inaccessible();await ancestorIds(db,link.file);return link;
  }
  async function tokenLink(request:FastifyRequest,id:string){
    const token=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(request.headers['x-link-token']);
    const link=await liveLink(id);if(hashToken(token)!==link.tokenHash)throw inaccessible();return link;
  }
  async function grantedItem(request:FastifyRequest,id:string,fileId:string){
    const token=request.cookies[cookieName(id)];if(!token)throw Object.assign(new Error('Unlock this shared link first'),{statusCode:401});
    const link=await liveLink(id);
    const grant=await db.publicLinkGrant.findFirst({where:{linkId:id,tokenHash:hashToken(token),expiresAt:{gt:new Date()}}});if(!grant)throw Object.assign(new Error('Shared link session expired'),{statusCode:401});
    const item=await db.fileEntry.findFirst({where:{id:fileId,ownerId:link.ownerId,deletedAt:null}});if(!item)throw inaccessible();
    if(!(await ancestorIds(db,item)).includes(link.fileId))throw inaccessible();return {link,item};
  }
  app.get('/api/links',{preHandler:requireUser},async request=>{
    const q=z.object({fileId:z.string().uuid().optional()}).parse(request.query);
    const rows=await db.publicLink.findMany({where:{ownerId:request.authUser!.id,...(q.fileId?{fileId:q.fileId}:{})},select:{...linkSelection,passwordHash:true,file:{select:{id:true,name:true,isDirectory:true}}},orderBy:{createdAt:'desc'},take:100});
    return {items:rows.map(({passwordHash,...row})=>({...row,passwordProtected:!!passwordHash}))};
  });
  app.post('/api/links',{preHandler:requireUser,config:{rateLimit:{max:15,timeWindow:'1 minute'}}},async request=>{
    const data=linkData.extend({fileId:z.string().uuid()}).strict().parse(request.body);
    if(!(await readAdminSettings(db)).publicLinksEnabled)throw Object.assign(new Error('Public links are disabled by the administrator'),{statusCode:403});
    const token=randomToken(),passwordHash=data.password?await argon2.hash(data.password,passwordOptions):null,ownerId=request.authUser!.id;
    const link=await db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},0))`;
      const file=await tx.fileEntry.findFirst({where:{id:data.fileId,ownerId,deletedAt:null}});if(!file)throw inaccessible();await ancestorIds(tx,file);
      if(await tx.publicLink.count({where:{ownerId,revokedAt:null}})>=100)throw Object.assign(new Error('Public link limit reached'),{statusCode:429});
      return tx.publicLink.create({data:{ownerId,fileId:file.id,tokenHash:hashToken(token),passwordHash,expiresAt:data.expiresAt===undefined?new Date(Date.now()+7*86400_000):data.expiresAt?new Date(data.expiresAt):null},select:linkSelection});
    });
    await audit(db,request,'PUBLIC_LINK_CREATED','SUCCESS',link.id);return {link,url:`/share/${link.id}#${token}`};
  });
  app.patch('/api/links/:id',{preHandler:requireUser,config:{rateLimit:{max:15,timeWindow:'1 minute'}}},async request=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params);
    const data=linkData.extend({rotateToken:z.boolean().optional()}).strict().parse(request.body);
    const newToken=data.rotateToken?randomToken():null,passwordHash=data.password?await argon2.hash(data.password,passwordOptions):null,ownerId=request.authUser!.id;
    const link=await db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id},1))`;
      const old=await tx.publicLink.findFirst({where:{id,ownerId,revokedAt:null}});if(!old)throw inaccessible();
      await tx.publicLinkGrant.deleteMany({where:{linkId:id}});
      return tx.publicLink.update({where:{id},data:{...(data.password!==undefined?{passwordHash}:{}),...(data.expiresAt!==undefined?{expiresAt:data.expiresAt?new Date(data.expiresAt):null}:{}),...(newToken?{tokenHash:hashToken(newToken)}:{})},select:linkSelection});
    });
    await audit(db,request,'PUBLIC_LINK_UPDATED','SUCCESS',id);return {link,...(newToken?{url:`/share/${id}#${newToken}`}:{})};
  });
  app.delete('/api/links/:id',{preHandler:requireUser},async request=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params),ownerId=request.authUser!.id;
    await db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id},1))`;
      const result=await tx.publicLink.updateMany({where:{id,ownerId},data:{revokedAt:new Date()}});if(!result.count)throw inaccessible();
      await tx.publicLinkGrant.deleteMany({where:{linkId:id}});
    });await audit(db,request,'PUBLIC_LINK_REVOKED','SUCCESS',id);return {ok:true};
  });
  app.get('/api/public-links/:id',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async request=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params);const link=await tokenLink(request,id);
    return {file:{id:link.file.id,name:link.file.name,isDirectory:link.file.isDirectory,size:link.file.size.toString(),updatedAt:link.file.updatedAt},passwordRequired:!!link.passwordHash,expiresAt:link.expiresAt};
  });
  app.post('/api/public-links/:id/unlock',{config:{rateLimit:{max:8,timeWindow:'15 minutes'}}},async(request,reply)=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params);
    const{password}=z.object({password:z.string().max(256).optional()}).strict().parse(request.body);
    const link=await tokenLink(request,id),token=randomToken();
    const expiresAt=new Date(Math.min(Date.now()+2*3600_000,link.expiresAt?.getTime()??Infinity));
    const valid=await db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id},1))`;
      const current=await tx.publicLink.findUniqueOrThrow({where:{id}});
      if(current.revokedAt||current.tokenHash!==link.tokenHash||current.passwordHash!==link.passwordHash||(current.expiresAt&&current.expiresAt<new Date()))throw inaccessible();
      const key=`link-throttle:${id}`,saved=(await tx.systemSetting.findUnique({where:{key}}))?.value as {start?:number;failures?:number}|undefined;
      const now=Date.now(),start=typeof saved?.start==='number'&&now-saved.start<15*60_000?saved.start:now;
      const failures=start===saved?.start&&typeof saved.failures==='number'?saved.failures:0;
      if(failures>=8)return false;
      if(current.passwordHash&&!await argon2.verify(current.passwordHash,password??'').catch(()=>false)){
        await tx.systemSetting.upsert({where:{key},create:{key,value:{start,failures:failures+1}},update:{value:{start,failures:failures+1}}});return false;
      }
      await tx.systemSetting.deleteMany({where:{key}});
      if(await tx.publicLinkGrant.count({where:{linkId:id,expiresAt:{gt:new Date()}}})>=500)throw Object.assign(new Error('Shared link session limit reached'),{statusCode:429});
      await tx.publicLinkGrant.create({data:{linkId:id,tokenHash:hashToken(token),expiresAt}});return true;
    },{timeout:15000});
    if(!valid){await audit(db,request,'PUBLIC_LINK_UNLOCK_FAILED','FAILED',id);return reply.code(401).send({error:'Invalid shared link password or too many attempts'})}
    reply.setCookie(cookieName(id),token,{httpOnly:true,secure:config.COOKIE_SECURE,sameSite:'strict',path:`/api/public-links/${id}`,expires:expiresAt});
    await audit(db,request,'PUBLIC_LINK_UNLOCKED','SUCCESS',id);return {ok:true};
  });
  app.get('/api/public-links/:id/files',{config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async request=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params);
    const q=z.object({parentId:z.string().uuid(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(request.query);
    const{item}=await grantedItem(request,id,q.parentId);if(!item.isDirectory)throw inaccessible();
    const rows=await db.fileEntry.findMany({where:{ownerId:item.ownerId,parentId:item.id,deletedAt:null},select:{id:true,name:true,size:true,isDirectory:true,updatedAt:true,mimeType:true},orderBy:[{name:'asc'},{id:'asc'}],take:q.limit+1,...(q.cursor?{cursor:{id:q.cursor},skip:1}:{})});
    return {items:serialize(rows.slice(0,q.limit)),nextCursor:rows.length>q.limit?rows[q.limit-1].id:null};
  });
  for(const action of ['download','preview-info','preview','thumbnail'] as const){
    app.get(`/api/public-links/:id/files/:fileId/${action}`,{config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async(request,reply)=>{
      const{id,fileId}=z.object({id:z.string().uuid(),fileId:z.string().uuid()}).parse(request.params);
      const{item}=await grantedItem(request,id,fileId);if(item.isDirectory)throw inaccessible();
      if(action==='download'){await audit(db,request,'PUBLIC_LINK_DOWNLOAD','SUCCESS',id);return sendFile(db,item,request,reply,{actorId:item.ownerId})}
      if(action==='thumbnail')return reply.type('image/webp').send(await thumbnail(item));
      const preview=await inspectPreview(item);if(action==='preview-info')return preview;
      if(preview.kind==='text')return {content:preview.content,kind:preview.kind};
      return sendFile(db,item,request,reply,{inlineMime:preview.mimeType,actorId:item.ownerId});
    });
  }
}
