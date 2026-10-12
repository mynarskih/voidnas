import {describe,it,expect} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {BrowserUploadRepository,type UploadJob} from '../src/upload-store';
import {UploadManager,type UploadTransport} from '../src/upload-manager';
import {ApiError} from '../src/api';
import {fingerprint,HASH_CHUNK_BYTES} from '../src/upload-fingerprint';
import {createHash} from 'node:crypto';
import {File} from 'node:buffer';
const file=(text='abcdef')=>new File([text],'resume.txt',{lastModified:1}) as unknown as globalThis.File;
const job=(userId='alice'):UploadJob=>({id:'one',userId,name:'resume.txt',size:6,type:'',lastModified:1,parentId:null,destination:'Files',initiated:true,sha256:createHash('sha256').update('abcdef').digest('hex'),offset:0,state:'uploading',createdAt:1});
async function wait(check:()=>boolean){for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error('Timeout')}
function setup(existing?:UploadJob){
  const rows=new Map<string,UploadJob>();if(existing)rows.set(existing.id,existing);
  const calls:{init:number;chunks:number[];cancel:number}={init:0,chunks:[],cancel:0};
  let offset=existing?3:0,complete=false;
  const repository={list:async(userId:string)=>[...rows.values()].filter(row=>row.userId===userId),put:async(row:UploadJob)=>{rows.set(row.id,structuredClone(row))},remove:async(_user:string,id:string)=>{rows.delete(id)}};
  const transport:UploadTransport={
    async init(row){expect(rows.get(row.id)?.sha256).toBeTruthy();calls.init++;offset=0},
    async status(id){const row=rows.get(id)!;return {id,status:complete?'COMPLETE':'ACTIVE',offset:String(offset),size:String(row.size),sha256:row.sha256!,writing:false,expiresAt:'2030-01-01T00:00:00Z'}},
    async chunk(_id,start,body){calls.chunks.push(start);offset=start+body.size;complete=offset===6;return offset},
    async cancel(){calls.cancel++}
  };
  const manager=new UploadManager('alice',repository,transport,(f,p,s)=>fingerprint(f,p,s),async(_id,action)=>{await action();return true});
  return {manager,repository,transport,rows,calls,setComplete:()=>{complete=true;offset=6}};
}
describe('durable uploads',()=>{
  it('persists metadata before initiation and completes without duplicate upload',async()=>{
    const {manager,calls}=setup();await manager.initialize();await manager.enqueue([file()],null,'Files');
    await wait(()=>manager.jobs[0]?.state==='complete');expect(calls.init).toBe(1);expect(calls.chunks).toEqual([0]);manager.dispose();
  });
  it('rehydrates paused jobs and resumes from server offset, not saved offset',async()=>{
    const {manager,calls}=setup(job());await manager.initialize();expect(manager.jobs[0].state).toBe('needs-file');
    await manager.resume('one',file());await wait(()=>manager.jobs[0].state==='complete');expect(calls.init).toBe(0);expect(calls.chunks).toEqual([3]);manager.dispose();
  });
  it('rejects different bytes even with the same filename and size',async()=>{
    const {manager,calls}=setup(job());await manager.initialize();await manager.resume('one',file('ghijkl'));
    await wait(()=>!!manager.jobs[0].error);expect(manager.jobs[0].state).toBe('needs-file');expect(calls.chunks).toEqual([]);manager.dispose();
  });
  it('rejects a renamed or differently sized file before hashing',async()=>{
    const {manager,calls}=setup(job());await manager.initialize();await manager.resume('one',file('short'));
    expect(manager.jobs[0].error).toContain('same name and size');expect(calls.chunks).toEqual([]);manager.dispose();
  });
  it('recognizes a completed transfer when the final response was lost',async()=>{
    const {manager,calls,setComplete}=setup(job());setComplete();await manager.initialize();
    expect(manager.jobs[0].state).toBe('complete');expect(calls.init).toBe(0);expect(calls.chunks).toEqual([]);manager.dispose();
  });
  it('retries an uncertain initiation with the same durable id',async()=>{
    const {manager,transport,calls,rows}=setup({...job(),initiated:false,state:'paused',offset:0});let first=true;
    const init=transport.init;transport.init=async(row,signal)=>{await init(row,signal);if(first){first=false;throw new TypeError('Network error')}};
    await manager.initialize();await manager.resume('one',file());await wait(()=>manager.jobs[0].state==='error');
    expect(rows.get('one')!.sha256).toBe(job().sha256);await manager.resume('one');await wait(()=>manager.jobs[0].state==='complete');
    expect(manager.jobs).toHaveLength(1);expect(calls.init).toBe(2);manager.dispose();
  });
  it('a busy tab does not start another upload',async()=>{
    const {repository,transport,calls}=setup(job());
    const manager=new UploadManager('alice',repository,transport,(f,p,s)=>fingerprint(f,p,s),async()=>false);
    await manager.initialize();await manager.resume('one',file());await wait(()=>manager.jobs[0].state==='paused');
    expect(manager.jobs[0].error).toContain('another tab');expect(calls.chunks).toEqual([]);manager.dispose();
  });
  it('pause aborts the active chunk, and resume asks the server again',async()=>{
    const {manager,transport,calls}=setup(job());const original=transport.chunk;let aborted=false;
    transport.chunk=async(_id,_offset,_body,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'))},{once:true}));
    await manager.initialize();await manager.resume('one',file());await wait(()=>manager.jobs[0].state==='uploading');
    await new Promise(resolve=>setTimeout(resolve,30));await manager.pause('one');await wait(()=>aborted);
    transport.chunk=original;await new Promise(resolve=>setTimeout(resolve,20));await manager.resume('one');await wait(()=>manager.jobs[0].state==='complete');
    expect(calls.chunks).toEqual([3]);manager.dispose();
  });
  it('cancellation survives a closed browser and releases the server session',async()=>{
    const {manager,calls}=setup({...job(),state:'cancelling'});await manager.initialize();await wait(()=>manager.jobs[0].state==='cancelled');
    expect(calls.cancel).toBe(1);manager.dispose();
  });
  it('does not label an already completed file as cancelled',async()=>{
    const {manager,calls,setComplete}=setup({...job(),state:'cancelling'});setComplete();await manager.initialize();await wait(()=>manager.jobs[0].state==='complete');
    expect(calls.cancel).toBe(0);manager.dispose();
  });
  it('expired sessions fail without creating a replacement reservation',async()=>{
    const {manager,transport,calls}=setup(job());transport.status=async()=>{throw new ApiError('Upload session expired',410)};
    await manager.initialize();await manager.resume('one',file());await wait(()=>manager.jobs[0].state==='error');
    expect(calls.init).toBe(0);expect(calls.chunks).toEqual([]);manager.dispose();
  });
  it('unavailable browser persistence fails closed before sending bytes',async()=>{
    const {transport,calls}=setup();const repository={list:async()=>[],put:async()=>{throw new Error('disk full')},remove:async()=>{}};
    const manager=new UploadManager('alice',repository,transport,(f,p,s)=>fingerprint(f,p,s),async(_id,action)=>{await action();return true});
    await manager.initialize();await manager.enqueue([file()],null,'Files');expect(manager.error).toBe('disk full');expect(calls.init).toBe(0);manager.dispose();
  });
});
describe('browser metadata store',()=>{
  it('isolates accounts and never stores File objects or credentials',async()=>{
    Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:new IDBFactory()});
    const store=new BrowserUploadRepository();await store.put({...job(),file:file(),csrfToken:'secret'} as UploadJob);
    await store.put({...job('bob'),state:'complete'});
    expect(await store.list('bob')).toHaveLength(1);const rows=await store.list('alice');expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('secret');expect(rows[0]).not.toHaveProperty('file');expect(rows[0]).not.toHaveProperty('csrfToken');
    await store.remove('alice','one');expect(await store.list('alice')).toEqual([]);expect(await store.list('bob')).toHaveLength(1);
  });
});
describe('streamed identity check',()=>{
  it('matches Node SHA-256 across chunk boundaries with bounded reads',async()=>{
    const bytes=Buffer.alloc(HASH_CHUNK_BYTES+29,37),blob=new Blob([bytes]);const reads:number[]=[];
    const original=blob.slice.bind(blob);blob.slice=(start,end,type)=>{reads.push(Math.min(end??blob.size,blob.size)-(start??0));return original(start,end,type)};
    expect(await fingerprint(blob)).toBe(createHash('sha256').update(bytes).digest('hex'));expect(reads).toEqual([HASH_CHUNK_BYTES,29]);
  });
  it('supports empty files and honors cancellation',async()=>{
    expect(await fingerprint(new Blob([]))).toBe(createHash('sha256').digest('hex'));
    const controller=new AbortController();controller.abort();await expect(fingerprint(new Blob(['x']),()=>{},controller.signal)).rejects.toThrow();
  });
});
