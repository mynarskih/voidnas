import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
const url=new URL(process.env.DATABASE_URL);
assert.match(url.pathname,/^\/voidnas_restore_test_[a-f0-9]{32}$/,'Refusing to verify against production database');
assert.equal(process.env.STORAGE_ROOT,'/tmp/voidnas-restore-test');
const require=createRequire('/app/apps/api/package.json'),{PrismaClient}=require('@prisma/client');
const {openStorageFile}=await import('/app/apps/api/dist/lib/storage-boundary.js');
const database=new PrismaClient();
try{
  let count=0,cursor;
  while(true){
    const rows=await database.fileEntry.findMany({where:{isDirectory:false},orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{})});
    for(const file of rows){const handle=await openStorageFile(process.env.STORAGE_ROOT,file.storagePath,constants.O_RDONLY);try{const info=await handle.stat();assert.equal(info.isFile(),true);assert.equal(BigInt(info.size),file.size);count++}finally{await handle.close()}}
    if(rows.length<100)break;cursor=rows.at(-1).id;
  }
  const users=await database.user.count();assert.ok(users>0,'Backup has no user accounts');
  console.log(`RESTORE VERIFIED: ${users} accounts; ${count} physical files match database metadata`);
}finally{await database.$disconnect()}
