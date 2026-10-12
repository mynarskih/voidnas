import { constants } from 'node:fs';
import type { FastifyRequest,FastifyReply } from 'fastify';
import type { FileEntry,PrismaClient } from '@prisma/client';
import mime from 'mime-types';
import { config } from '../config.js';
import { openStorageFile } from './storage-boundary.js';
import { contentDisposition } from './security.js';
import { parseByteRange } from './range.js';
import { readAdminSettings } from './admin-settings.js';
import { acquireTransfer,TransferThrottle } from './transfers.js';

export async function sendFile(db:PrismaClient,item:FileEntry,request:FastifyRequest,reply:FastifyReply,options:{inlineMime?:string;actorId?:string}={}){
  const settings=await readAdminSettings(db);
  const release=acquireTransfer(options.actorId??request.authUser?.id??item.ownerId,settings.maxConcurrentTransfers);
  let handle:Awaited<ReturnType<typeof openStorageFile>>;
  try{handle=await openStorageFile(config.STORAGE_ROOT,item.storagePath,constants.O_RDONLY)}catch(error){release();throw error}
  const info=await handle.stat().catch(async error=>{await handle.close();release();throw error});
  if(!info.isFile()){await handle.close();release();throw Object.assign(new Error('File is unavailable'),{statusCode:409})}
  let bounds:{start:number;end:number}|undefined;
  if(request.headers.range){bounds=parseByteRange(request.headers.range,info.size)??undefined;if(!bounds){await handle.close();release();return reply.code(416).header('Content-Range',`bytes */${info.size}`).send()}}
  reply.header('Accept-Ranges','bytes').header('Content-Type',options.inlineMime??String(mime.lookup(item.name)||'application/octet-stream'))
    .header('Content-Disposition',options.inlineMime?contentDisposition(item.name).replace(/^attachment/,'inline'):contentDisposition(item.name))
    .header('Content-Security-Policy',"default-src 'none'; sandbox").header('X-Content-Type-Options','nosniff').header('Cache-Control','private, no-store');
  if(bounds)reply.code(206).header('Content-Range',`bytes ${bounds.start}-${bounds.end}/${info.size}`).header('Content-Length',bounds.end-bounds.start+1);
  else reply.header('Content-Length',info.size);
  const source=handle.createReadStream(bounds),throttle=new TransferThrottle(settings.downloadBytesPerSecond);
  const abort=()=>{source.destroy();throttle.destroy();release()};
  request.raw.once('aborted',abort);reply.raw.once('close',abort);
  source.on('error',error=>throttle.destroy(error));throttle.once('close',()=>{source.destroy();release();request.raw.off('aborted',abort);reply.raw.off('close',abort)});
  source.pipe(throttle);return reply.send(throttle);
}
