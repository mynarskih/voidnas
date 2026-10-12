import { mkdir, rename, rm, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { assertUserStorageDirectories } from './storage-boundary.js';
import { resolveInside } from './security.js';
import { inaccessible } from './authorization.js';

export async function purgeEntry(db:PrismaClient,storageRoot:string,id:string,ownerId:string,before?:Date){
  await assertUserStorageDirectories(storageRoot,ownerId);
  const purgeRel=`users/${ownerId}/.purge/${randomUUID()}`,purgeAbs=resolveInside(storageRoot,purgeRel);
  await mkdir(purgeAbs,{recursive:true});
  const moved:{from:string;to:string}[]=[];let entries=0,bytes=0n;const purgedIds=new Set<string>();
  try{
    await db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId},0))`;
      const root=await tx.fileEntry.findFirst({where:{id,ownerId,deletedAt:before?{lt:before}:{not:null}}});
      if(!root)throw inaccessible();
      const rows=[root],seen=new Set([root.id]);let frontier=root.isDirectory?[root.id]:[];
      while(frontier.length){
        const children=await tx.fileEntry.findMany({where:{ownerId,parentId:{in:frontier}}});
        for(const child of children){if(seen.has(child.id))throw inaccessible();seen.add(child.id)}
        rows.push(...children);frontier=children.filter(row=>row.isDirectory).map(row=>row.id);
      }
      for(const row of rows){
        const from=resolveInside(storageRoot,row.storagePath),to=resolveInside(storageRoot,`${purgeRel}/${row.id}`);
        try{await rename(from,to);moved.push({from,to})}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
      }
      entries=rows.length;for(const row of rows)purgedIds.add(row.id);bytes=rows.reduce((sum,row)=>sum+(row.isDirectory?0n:row.size),0n);
      for(const row of [...rows].reverse())await tx.fileEntry.delete({where:{id:row.id}});
      if(bytes)await tx.user.update({where:{id:ownerId},data:{usedBytes:{decrement:bytes}}});
    },{timeout:30000});
    // A failed physical cleanup is retryable using the existing purge recovery.
    await rm(purgeAbs,{recursive:true,force:true}).catch(()=>undefined);
    const previews=resolveInside(storageRoot,`users/${ownerId}/.previews`);
    for(const cached of await readdir(previews).catch(()=>[])){
      if(/^[a-f0-9-]{36}-[a-f0-9]{64}\.webp$/.test(cached)&&purgedIds.has(cached.slice(0,36)))await rm(resolveInside(previews,cached),{force:true}).catch(()=>undefined);
    }
    return {entries,bytes};
  }catch(error){
    // Do not destroy the staging copy until COMMIT's outcome is known.
    await db.fileEntry.findFirst({where:{id,ownerId},select:{id:true}}).then(async record=>{
      let restored=true;
      if(record)for(const row of [...moved].reverse())await rename(row.to,row.from).catch(()=>{restored=false});
      if(restored)await rm(purgeAbs,{recursive:true,force:true});
    }).catch(()=>undefined);
    throw error;
  }
}

let retentionRunning=false;
export async function cleanupTrash(db:PrismaClient,root:string,retention:number|null,now=new Date()){
  if(retention===null||retentionRunning)return 0;retentionRunning=true;
  try{
    const cutoff=new Date(now.getTime()-retention*86400_000);
    const candidates=await db.fileEntry.findMany({where:{deletedAt:{lt:cutoff}},select:{id:true,ownerId:true},orderBy:{deletedAt:'asc'},take:100});
    let removed=0;
    for(const row of candidates){
      try{const result=await purgeEntry(db,root,row.id,row.ownerId,cutoff);removed+=result.entries;
        await db.auditLog.create({data:{userId:row.ownerId,action:'TRASH_RETENTION_PURGE',resourceId:row.id,result:'SUCCESS',metadata:{entries:result.entries,bytes:result.bytes.toString()}}});
      }catch(error){if((error as {statusCode?:number}).statusCode!==404)throw error}
    }
    return removed;
  }finally{retentionRunning=false}
}
