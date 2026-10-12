import { afterEach, describe, expect, it } from 'vitest';
import { constants } from 'node:fs';
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertUserStorageDirectories, openStorageFile } from '../src/lib/storage-boundary.js';

const temporary:string[]=[];
afterEach(async()=>{for(const path of temporary.splice(0))await rm(path,{recursive:true,force:true})});
const setup=async()=>{const root=await mkdtemp(join(tmpdir(),'voidnas-boundary-'));temporary.push(root);await mkdir(join(root,'safe'));await writeFile(join(root,'safe','file'),'original');return root};
describe.skipIf(process.platform!=='linux')('descriptor-anchored storage',()=>{
  it('reads normal files and rejects traversal',async()=>{
    const root=await setup(),handle=await openStorageFile(root,'safe/file',constants.O_RDONLY);
    try{expect(await handle.readFile('utf8')).toBe('original')}finally{await handle.close()}
    await expect(openStorageFile(root,'../outside',constants.O_RDONLY)).rejects.toThrow('PATH_ESCAPE');
  });
  it('rejects symlinks in both the final filename and ancestor directories',async()=>{
    const root=await setup();await symlink(join(root,'safe','file'),join(root,'leaf'));await symlink(join(root,'safe'),join(root,'parent'));
    await expect(openStorageFile(root,'leaf',constants.O_RDONLY)).rejects.toThrow();
    await expect(openStorageFile(root,'parent/file',constants.O_RDONLY)).rejects.toThrow();
  });
  it('retains the originally opened file when a directory is replaced',async()=>{
    const root=await setup(),handle=await openStorageFile(root,'safe/file',constants.O_RDONLY);
    try{await rename(join(root,'safe'),join(root,'old'));await mkdir(join(root,'safe'));await writeFile(join(root,'safe','file'),'replacement');expect(await handle.readFile('utf8')).toBe('original')}finally{await handle.close()}
  });
  it('rejects symlinked user creation directories',async()=>{
    const root=await setup(),id='550e8400-e29b-41d4-a716-446655440000';await mkdir(join(root,'users',id),{recursive:true});await symlink(join(root,'safe'),join(root,'users',id,'.tmp'));
    await expect(assertUserStorageDirectories(root,id)).rejects.toThrow('Unsafe storage directory');
  });
});
