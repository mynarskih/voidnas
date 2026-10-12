import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { openStorageFile } from './storage-boundary.js';

// Stream through a pinned, no-follow descriptor. Never buffer the entire file.
export async function verifyUploadChecksum(root:string,path:string,expected:string|null){
  if(!expected)return;
  const handle=await openStorageFile(root,path,constants.O_RDONLY);
  try{
    const hash=createHash('sha256');
    for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:1024*1024}))hash.update(chunk);
    if(hash.digest('hex')!==expected)throw Object.assign(new Error('Uploaded file checksum mismatch'),{statusCode:422});
  }finally{await handle.close()}
}
