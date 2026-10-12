import type { FastifyInstance,FastifyRequest,FastifyReply } from 'fastify';
import { z } from 'zod';
import { entryAccess,inaccessible } from '../lib/authorization.js';
import { inspectPreview,thumbnail } from '../lib/previews.js';
import { sendFile } from '../lib/file-stream.js';

export function registerPreviews(app:FastifyInstance,requireUser:(request:FastifyRequest,reply:FastifyReply)=>Promise<unknown>){
  for(const action of ['preview-info','preview','thumbnail'] as const){
    app.get(`/api/files/:id/${action}`,{preHandler:requireUser,config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async(request,reply)=>{
      const{id}=z.object({id:z.string().uuid()}).parse(request.params);
      const{item}=await entryAccess(app.prisma,id,request.authUser!.id);
      if(item.isDirectory)throw inaccessible();
      if(action==='thumbnail')return reply.type('image/webp').header('X-Content-Type-Options','nosniff').send(await thumbnail(item));
      const preview=await inspectPreview(item);
      if(action==='preview-info')return preview;
      if(preview.kind==='text')return {content:preview.content,kind:preview.kind};
      return sendFile(app.prisma,item,request,reply,{inlineMime:preview.mimeType});
    });
  }
}
