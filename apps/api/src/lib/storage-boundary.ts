import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { resolveInside } from './security.js';

// Docker/Linux only. Anchor every directory lookup to an open descriptor rather
// than checking a pathname and reopening it later (a symlink/rename race).
export async function openStorageFile(root:string,storagePath:string,flags:number,mode=0o600):Promise<FileHandle>{
  if(process.platform!=='linux')throw new Error('Storage requires the Linux Docker runtime');
  const absolute=resolveInside(root,storagePath),parts=relative(root,absolute).split(sep);
  if(parts.length<1||parts.some(part=>!part||part==='.'||part==='..'))throw new Error('PATH_ESCAPE');
  let directory=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{
    for(const part of parts.slice(0,-1)){
      const next=await open(`/proc/self/fd/${directory.fd}/${part}`,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
      await directory.close();directory=next;
    }
    return await open(`/proc/self/fd/${directory.fd}/${parts.at(-1)}`,flags|constants.O_NOFOLLOW,mode);
  }finally{await directory.close()}
}

// Creation/deletion/recovery directories must also belong exclusively to this
// service. Reject existing symlinks before mkdir/rename/unlink operations.
export async function assertUserStorageDirectories(root:string,userId:string){
  if(!/^[a-f0-9-]{36}$/i.test(userId))throw new Error('PATH_ESCAPE');
  const prefix=`users/${userId}`;
  for(const path of ['', 'users',prefix,...['files','dirs','.tmp','.edits','.purge','.previews'].map(name=>`${prefix}/${name}`)]){
    try{const info=await lstat(resolveInside(root,path));if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe storage directory')}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  }
}
