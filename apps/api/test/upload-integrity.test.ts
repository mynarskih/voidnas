import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyUploadChecksum} from '../src/lib/upload-integrity.js';
describe.skipIf(process.platform!=='linux')('upload integrity',()=>{
  it('validates a large stream and rejects corrupted contents',async()=>{
    const root=await mkdtemp(join(tmpdir(),'voidnas-integrity-'));
    try{
      const bytes=Buffer.alloc(3*1024*1024+19,53);await writeFile(join(root,'part'),bytes);
      const hash=createHash('sha256').update(bytes).digest('hex');
      await expect(verifyUploadChecksum(root,'part',hash)).resolves.toBeUndefined();
      await expect(verifyUploadChecksum(root,'part','0'.repeat(64))).rejects.toMatchObject({statusCode:422});
    }finally{await rm(root,{recursive:true,force:true})}
  });
  it('rejects symlinks and path traversal rather than hashing host files',async()=>{
    const root=await mkdtemp(join(tmpdir(),'voidnas-integrity-'));
    try{
      await symlink('/etc/passwd',join(root,'escape'));
      await expect(verifyUploadChecksum(root,'escape','0'.repeat(64))).rejects.toThrow();
      await expect(verifyUploadChecksum(root,'../escape','0'.repeat(64))).rejects.toThrow();
    }finally{await rm(root,{recursive:true,force:true})}
  });
});
it('keeps old sessions compatible when no checksum was declared',async()=>{
  await expect(verifyUploadChecksum('/not-accessed','not-accessed',null)).resolves.toBeUndefined();
});
