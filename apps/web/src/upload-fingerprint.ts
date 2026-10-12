import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
export const HASH_CHUNK_BYTES=8*1024*1024;
export async function fingerprint(file:Blob,progress:(percent:number)=>void=()=>{},signal?:AbortSignal){
  const hash=sha256.create();
  try{
    for(let offset=0;offset<file.size;offset+=HASH_CHUNK_BYTES){
      signal?.throwIfAborted();
      const bytes=new Uint8Array(await file.slice(offset,offset+HASH_CHUNK_BYTES).arrayBuffer());
      signal?.throwIfAborted();hash.update(bytes);
      progress(Math.round(Math.min(file.size,offset+bytes.length)/file.size*100));
    }
    signal?.throwIfAborted();return bytesToHex(hash.digest());
  }finally{hash.destroy()}
}
