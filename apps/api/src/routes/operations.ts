import type { FastifyInstance,FastifyReply,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { serialize } from '../lib/serialize.js';
import { readAdminSettings,settingsSchema } from '../lib/admin-settings.js';
import { checkOperations,readBackupStatus } from '../lib/operations.js';

type Guard=(request:FastifyRequest,reply:FastifyReply)=>Promise<unknown>;
export function registerOperations(app:FastifyInstance,requireUser:Guard,requireAdmin:Guard){
  const db=app.prisma;
  const selection={id:true,ip:true,userAgent:true,createdAt:true,lastSeenAt:true,expiresAt:true};
  app.get('/api/auth/sessions',{preHandler:requireUser},async request=>{
    const rows=await db.session.findMany({where:{userId:request.authUser!.id,revokedAt:null,expiresAt:{gt:new Date()}},select:selection,orderBy:{lastSeenAt:'desc'},take:100});
    return {items:rows.map(row=>({...row,current:row.id===request.sessionId}))};
  });
  app.delete('/api/auth/sessions/:id',{preHandler:requireUser},async(request,reply)=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params);
    const result=await db.session.updateMany({where:{id,userId:request.authUser!.id,revokedAt:null},data:{revokedAt:new Date()}});
    if(!result.count)return reply.code(404).send({error:'Session not found'});
    if(id===request.sessionId)reply.clearCookie('voidnas_session',{path:'/'});
    await audit(db,request,'SESSION_REVOKED','SUCCESS',id);return {ok:true};
  });
  app.get('/api/admin/sessions',{preHandler:requireAdmin},async request=>{
    const q=z.object({userId:z.string().uuid().optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(request.query);
    const rows=await db.session.findMany({where:{revokedAt:null,expiresAt:{gt:new Date()},...(q.userId?{userId:q.userId}:{})},select:{...selection,user:{select:{id:true,username:true}}},orderBy:[{lastSeenAt:'desc'},{id:'asc'}],take:q.limit+1,...(q.cursor?{cursor:{id:q.cursor},skip:1}:{})});
    return {items:rows.slice(0,q.limit).map(row=>({...row,current:row.id===request.sessionId})),nextCursor:rows.length>q.limit?rows[q.limit-1].id:null};
  });
  app.delete('/api/admin/sessions/:id',{preHandler:requireAdmin},async request=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params);
    const result=await db.session.updateMany({where:{id,revokedAt:null},data:{revokedAt:new Date()}});
    if(!result.count)throw Object.assign(new Error('Session not found'),{statusCode:404});
    await audit(db,request,'SESSION_REVOKED','SUCCESS',id);return {ok:true};
  });
  app.get('/api/admin/settings',{preHandler:requireAdmin},async()=>({settings:await readAdminSettings(db),backup:await readBackupStatus()}));
  app.patch('/api/admin/settings',{preHandler:requireAdmin},async request=>{
    const data=settingsSchema.partial().extend({confirmRetention:z.boolean().optional()}).strict().refine(value=>Object.keys(value).some(key=>key!=='confirmRetention')).parse(request.body);
    const settings=await db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(947332)`;
      const current=await readAdminSettings(tx),{confirmRetention,...changes}=data;
      if(changes.trashRetentionDays!==undefined&&changes.trashRetentionDays!==null&&changes.trashRetentionDays!==current.trashRetentionDays&&!confirmRetention)throw Object.assign(new Error('Confirm permanent deletion before enabling or changing retention'),{statusCode:409});
      const updated=settingsSchema.parse({...current,...changes});
      await tx.systemSetting.upsert({where:{key:'admin-settings'},create:{key:'admin-settings',value:updated},update:{value:updated}});return updated;
    });
    await audit(db,request,'SYSTEM_SETTINGS_CHANGED','SUCCESS',undefined,{keys:Object.keys(data).filter(key=>key!=='confirmRetention')});
    return {settings};
  });
  app.get('/api/admin/alerts',{preHandler:requireAdmin},async request=>{
    const q=z.object({history:z.enum(['true','false']).default('false'),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(request.query);
    await checkOperations(db);
    const rows=await db.adminAlert.findMany({where:q.history==='true'?{}:{active:true},orderBy:[{lastSeenAt:'desc'},{id:'asc'}],take:q.limit+1,...(q.cursor?{cursor:{id:q.cursor},skip:1}:{})});
    const unread=await db.adminAlert.count({where:{active:true,acknowledgedAt:null}});
    return {items:serialize(rows.slice(0,q.limit)),unread,nextCursor:rows.length>q.limit?rows[q.limit-1].id:null};
  });
  app.patch('/api/admin/alerts/:id',{preHandler:requireAdmin},async request=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params);z.object({acknowledged:z.literal(true)}).strict().parse(request.body);
    await db.adminAlert.update({where:{id},data:{acknowledgedAt:new Date()}});await audit(db,request,'ALERT_ACKNOWLEDGED','SUCCESS',id);return {ok:true};
  });
}
