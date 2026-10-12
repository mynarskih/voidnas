import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { config } from '../config.js';
import { resolveInside } from './security.js';
import { openStorageFile } from './storage-boundary.js';

export const MAX_TEXT_BYTES = 1024 * 1024;
const problem = (message:string, statusCode=415) => Object.assign(new Error(message),{statusCode});
export const textVersion = (bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function decodeText(bytes:Uint8Array){
  if(bytes.length>MAX_TEXT_BYTES)throw problem('Text editor supports files up to 1 MB',413);
  if(bytes.includes(0))throw problem('This is a binary file, not an editable text file');
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}
  catch{throw problem('Text editor requires UTF-8 encoding')}
}
export async function readText(storagePath:string){
  const handle=await openStorageFile(config.STORAGE_ROOT,storagePath,constants.O_RDONLY);
  try{
    const info=await handle.stat();
    if(!info.isFile())throw problem('File is unavailable',409);
    if(info.size>MAX_TEXT_BYTES)throw problem('Text editor supports files up to 1 MB',413);
    // Bound allocation and reads even if something changes the physical file.
    const buffer=Buffer.alloc(MAX_TEXT_BYTES+1);let length=0;
    while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,null);if(!result.bytesRead)break;length+=result.bytesRead}
    const bytes=buffer.subarray(0,length);
    return {content:decodeText(bytes),version:textVersion(bytes)};
  }finally{await handle.close()}
}

type EditJournal={ownerId:string;previous:string;next:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function durableWrite(path:string,bytes:Uint8Array){
  const handle=await open(path,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}
}
export async function stageTextEdit(ownerId:string,previous:string,bytes:Buffer){
  const id=randomUUID(),next=`users/${ownerId}/files/${id}`;
  const dir=`users/${ownerId}/.edits`,journal=`${dir}/${id}.json`,journalTemp=`${dir}/${id}.journal.tmp`,temporary=`${dir}/${id}.tmp`;
  await mkdir(resolveInside(config.STORAGE_ROOT,dir),{recursive:true});
  const finish=async(committed:boolean)=>{
    await rm(resolveInside(config.STORAGE_ROOT,committed?previous:next),{force:true});
    await rm(resolveInside(config.STORAGE_ROOT,temporary),{force:true});
    await rm(resolveInside(config.STORAGE_ROOT,journalTemp),{force:true});
    await rm(resolveInside(config.STORAGE_ROOT,journal),{force:true});
  };
  try{
    await durableWrite(resolveInside(config.STORAGE_ROOT,journalTemp),Buffer.from(JSON.stringify({ownerId,previous,next} satisfies EditJournal)));
    await rename(resolveInside(config.STORAGE_ROOT,journalTemp),resolveInside(config.STORAGE_ROOT,journal));
    await durableWrite(resolveInside(config.STORAGE_ROOT,temporary),bytes);
    await rename(resolveInside(config.STORAGE_ROOT,temporary),resolveInside(config.STORAGE_ROOT,next));
  }catch(error){await finish(false).catch(()=>undefined);throw error}
  return {storagePath:next,finish};
}

// The original is never overwritten. The committed DB pointer decides recovery.
export async function recoverTextEdits(isReferenced:(path:string)=>Promise<boolean>){
  const root=resolveInside(config.STORAGE_ROOT,'users');
  for(const user of await readdir(root,{withFileTypes:true}).catch(()=>[])){
    if(!user.isDirectory()||!uuid.test(user.name))continue;
    const dir=`users/${user.name}/.edits`;
    for(const file of await readdir(resolveInside(config.STORAGE_ROOT,dir),{withFileTypes:true}).catch(()=>[])){
      const id=file.name.replace(/\.json$/,'');
      if(!file.isFile()||!file.name.endsWith('.json')||!uuid.test(id))continue;
      const journal=resolveInside(config.STORAGE_ROOT,`${dir}/${file.name}`);
      const info=JSON.parse(await readFile(journal,'utf8')) as EditJournal;
      const prefix=`users/${user.name}/files/`;
      if(info.ownerId!==user.name||info.next!==`${prefix}${id}`||!info.previous.startsWith(prefix)||!uuid.test(info.previous.slice(prefix.length)))throw new Error('Invalid text edit recovery journal');
      for(const path of [info.previous,info.next])if(!await isReferenced(path))await rm(resolveInside(config.STORAGE_ROOT,path),{force:true});
      await rm(resolveInside(config.STORAGE_ROOT,`${dir}/${id}.tmp`),{force:true});
      await rm(journal,{force:true});
    }
  }
}
