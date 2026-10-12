import { constants } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { mkdir,rename,rm,readdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import type { FileEntry } from '@prisma/client';
import { config } from '../config.js';
import { openStorageFile,assertUserStorageDirectories } from './storage-boundary.js';
import { resolveInside } from './security.js';
import { readText } from './text-files.js';

export type PreviewKind='image'|'audio'|'video'|'pdf'|'text';
const raster=new Set(['image/png','image/jpeg','image/webp','image/gif','image/avif']);
const audio=new Set(['audio/mpeg','audio/wav','audio/x-wav','audio/flac','audio/ogg','audio/mp4','audio/aac']);
const video=new Set(['video/mp4','video/webm','video/quicktime','video/ogg']);
const textExtensions=new Set(['.txt','.md','.markdown','.json','.yaml','.yml','.toml','.xml','.csv','.log','.ini','.conf','.config','.env','.js','.ts','.jsx','.tsx','.css','.html','.sql','.sh','.ps1','.py','.rs','.go','.java','.c','.h','.cpp','.svg']);
export function previewKind(mime:string|undefined,name:string):PreviewKind|null{
  if(mime&&raster.has(mime))return 'image';
  if(mime&&audio.has(mime))return 'audio';if(mime&&video.has(mime))return 'video';if(mime==='application/pdf')return 'pdf';
  if(!mime&&(textExtensions.has(extname(name).toLowerCase())||!extname(name)))return 'text';return null;
}
export async function inspectPreview(item:FileEntry){
  if(item.isDirectory)throw Object.assign(new Error('Preview unavailable'),{statusCode:415});
  const handle=await openStorageFile(config.STORAGE_ROOT,item.storagePath,constants.O_RDONLY);
  let detected:string|undefined;
  try{const info=await handle.stat();if(!info.isFile()||BigInt(info.size)!==item.size)throw new Error('Stored size mismatch');
    const probe=Buffer.alloc(Math.min(8192,info.size));const read=await handle.read(probe,0,probe.length,0);detected=(await fileTypeFromBuffer(probe.subarray(0,read.bytesRead)).catch(()=>undefined))?.mime;
  }finally{await handle.close()}
  const kind=previewKind(detected,item.name);
  if(!kind||(kind==='pdf'&&item.size>64n*1024n*1024n))throw Object.assign(new Error('Preview unavailable for this file type or size'),{statusCode:415});
  if(kind==='text'){const text=await readText(item.storagePath);return {kind,mimeType:'text/plain',content:text.content}}
  return {kind,mimeType:detected!};
}

sharp.cache(false);sharp.concurrency(1);
let thumbnailJobs=0;
const thumbnailWaiters:Array<()=>void>=[];
export async function thumbnail(item:FileEntry){
  await assertUserStorageDirectories(config.STORAGE_ROOT,item.ownerId);
  const preview=await inspectPreview(item);
  if(preview.kind!=='image'||item.size>32n*1024n*1024n)throw Object.assign(new Error('Thumbnail unavailable'),{statusCode:415});
  const key=createHash('sha256').update(`${item.storagePath}:${item.updatedAt.toISOString()}`).digest('hex');
  const cacheRel=`users/${item.ownerId}/.previews/${item.id}-${key}.webp`;
  const existing=await openStorageFile(config.STORAGE_ROOT,cacheRel,constants.O_RDONLY).catch(()=>null);
  if(existing){try{return await existing.readFile()}finally{await existing.close()}}
  if(thumbnailJobs>=2){
    if(thumbnailWaiters.length>=16)throw Object.assign(new Error('Thumbnail service busy'),{statusCode:429});
    await new Promise<void>(resolve=>thumbnailWaiters.push(resolve));
  }else thumbnailJobs++;
  try{
    const input=await openStorageFile(config.STORAGE_ROOT,item.storagePath,constants.O_RDONLY);
    let image:Buffer;try{image=await input.readFile()}finally{await input.close()}
    const result=await sharp(image,{limitInputPixels:16_000_000,animated:false,failOn:'error'}).rotate().resize(320,240,{fit:'inside',withoutEnlargement:true}).webp({quality:72}).timeout({seconds:8}).toBuffer();
    await mkdir(resolveInside(config.STORAGE_ROOT,`users/${item.ownerId}/.previews`),{recursive:true});
    // Bound cache storage independently of account quota; at most two writers.
    const cached=await readdir(resolveInside(config.STORAGE_ROOT,`users/${item.ownerId}/.previews`));
    if(cached.length>=256||result.length>256*1024)return result;
    const temporaryRel=`users/${item.ownerId}/.previews/${randomUUID()}.tmp`;
    const output=await openStorageFile(config.STORAGE_ROOT,temporaryRel,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL);
    try{await output.writeFile(result);await output.sync();await output.close();await rename(resolveInside(config.STORAGE_ROOT,temporaryRel),resolveInside(config.STORAGE_ROOT,cacheRel))}
    finally{await output.close().catch(()=>undefined);await rm(resolveInside(config.STORAGE_ROOT,temporaryRel),{force:true}).catch(()=>undefined)}
    return result;
  }catch(error){if((error as {statusCode?:number}).statusCode)throw error;throw Object.assign(new Error('Thumbnail unavailable'),{statusCode:415})}
  finally{const next=thumbnailWaiters.shift();if(next)next();else thumbnailJobs--}
}
