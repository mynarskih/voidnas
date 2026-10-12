import {api,apiResponse,ApiError} from './api';
import {type UploadJob,type UploadRepository} from './upload-store';
export type ServerUpload={id:string;status:'ACTIVE'|'COMPLETE';offset:string;size:string;sha256:string|null;writing:boolean;expiresAt:string};
export type UploadTransport={init(job:UploadJob,signal:AbortSignal):Promise<void>;status(id:string,signal:AbortSignal):Promise<ServerUpload>;chunk(id:string,offset:number,body:Blob,signal:AbortSignal):Promise<number>;cancel(id:string,signal:AbortSignal):Promise<void>};
export const uploadTransport:UploadTransport={
  async init(job,signal){await api('/api/uploads',{method:'POST',signal,body:JSON.stringify({uploadId:job.id,fileName:job.name,size:job.size,mimeType:job.type,parentId:job.parentId,sha256:job.sha256})})},
  status:(id,signal)=>api('/api/uploads/'+id,{signal}),
  async chunk(id,offset,body,signal){const response=await apiResponse('/api/uploads/'+id,{method:'PATCH',signal,body,headers:{'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset)}});const value=response.headers.get('Upload-Offset');if(value===null)throw new Error('Invalid upload offset');return Number(value)},
  async cancel(id,signal){await api('/api/uploads/'+id,{method:'DELETE',signal})}
};
type Hasher=(file:File,progress:(value:number)=>void,signal:AbortSignal)=>Promise<string>;
type Lock=(id:string,action:()=>Promise<void>)=>Promise<boolean>;
export const browserUploadLock:Lock=async(id,action)=>{
  if(!navigator.locks){await action();return true}
  return navigator.locks.request('voidnas-upload:'+id,{ifAvailable:true},async lock=>{if(!lock)return false;await action();return true});
};
const delay=(signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'))};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},500);
  if(signal.aborted){abort();return}signal.addEventListener('abort',abort,{once:true});
});
export class UploadManager{
  jobs:UploadJob[]=[];verification=0;error='';ready=false;
  private files=new Map<string,File>();
  private listeners=new Set<()=>void>();
  private active:{id:string;controller:AbortController}|undefined;
  private running=false;private disposed=false;
  constructor(readonly userId:string,private repository:UploadRepository,private transport:UploadTransport,private hash:Hasher,private lock:Lock,private completed:()=>void=()=>{}){}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  private emit(){if(!this.disposed)this.listeners.forEach(listener=>listener())}
  async initialize(){
    try{
      const jobs=await this.repository.list(this.userId);
      if(this.disposed)return;
      this.jobs=jobs.map(job=>['complete','cancelled','cancelling'].includes(job.state)?job:{...job,state:'needs-file',error:undefined});
      this.ready=true;this.emit();
      // A lost final response must not make a completed upload require retransmission.
      for(const job of this.jobs.filter(job=>job.initiated&&job.state==='needs-file')){
        if(this.disposed)return;
        const controller=new AbortController();this.active={id:job.id,controller};
        try{const status=await this.transport.status(job.id,controller.signal);if(status.status==='COMPLETE')await this.save({...job,state:'complete',offset:job.size})}catch{/* Offline/expired sessions remain visible for explicit retry or cancellation. */}
        finally{this.active=undefined}
      }
    }catch{this.error='Upload queue storage unavailable';this.emit()}
    finally{this.active=undefined;void this.pump()}
  }
  private async save(job:UploadJob){
    await this.repository.put(job);
    this.jobs=this.jobs.map(current=>current.id===job.id?job:current);this.emit();
  }
  async enqueue(files:Iterable<File>,parentId:string|null,destination:string){
    if(!this.ready||this.disposed)return;
    try{
      for(const file of files){
        if(this.jobs.length>=100)throw new Error('Clear finished transfers before adding more files');
        const job:UploadJob={id:crypto.randomUUID(),userId:this.userId,name:file.name,size:file.size,type:file.type,lastModified:file.lastModified,parentId,destination,initiated:false,offset:0,state:'queued',createdAt:Date.now()};
        await this.repository.put(job);if(this.disposed)return;
        this.jobs=[...this.jobs,job];this.files.set(job.id,file);this.emit();
      }
      void this.pump();
    }catch(error){this.error=(error as Error).message;this.emit()}
  }
  async resume(id:string,file?:File){
    const job=this.jobs.find(job=>job.id===id);
    if(!job||['complete','cancelled','cancelling','uploading','verifying'].includes(job.state)||this.active?.id===id)return;
    if(file){
      if(file.name!==job.name||file.size!==job.size){await this.save({...job,state:'needs-file',error:'Select the original file with the same name and size'});return}
      this.files.set(id,file);
    }
    if(!this.files.has(id)){await this.save({...job,state:'needs-file'});return}
    await this.save({...job,state:'queued',error:undefined});void this.pump();
  }
  async pause(id:string){
    const job=this.jobs.find(job=>job.id===id);if(!job||['complete','cancelled','cancelling'].includes(job.state))return;
    // Abort synchronously before any persistence wait; no new chunk can be queued.
    if(this.active?.id===id)this.active.controller.abort();
    await this.save({...job,state:'paused',error:undefined});
  }
  async cancel(id:string){
    const job=this.jobs.find(job=>job.id===id);if(!job||['complete','cancelled'].includes(job.state))return;
    if(this.active?.id===id)this.active.controller.abort();
    // Do not delete metadata until the server releases the reservation.
    await this.save({...job,state:'cancelling',error:undefined});void this.pump();
  }
  async remove(id:string){
    const job=this.jobs.find(job=>job.id===id);if(!job||!['complete','cancelled'].includes(job.state))return;
    await this.repository.remove(this.userId,id);this.jobs=this.jobs.filter(job=>job.id!==id);this.files.delete(id);this.emit();
  }
  dispose(){this.disposed=true;this.active?.controller.abort();this.files.clear();this.listeners.clear()}
  private async pump(){
    if(this.running||this.disposed||!this.ready||this.active)return;
    this.running=true;
    try{
      while(!this.disposed){
        const job=this.jobs.find(job=>job.state==='queued'||(job.state==='cancelling'&&!job.error));if(!job)break;
        const controller=new AbortController();this.active={id:job.id,controller};this.verification=0;
        try{
          const acquired=await this.lock(this.userId+':'+job.id,()=>this.run(job,controller.signal));
          if(!acquired)await this.save({...job,state:'paused',error:'Transfer is active in another tab'});
        }catch(error){
          const current=this.jobs.find(current=>current.id===job.id)!;
          if(controller.signal.aborted){
            // Do not overwrite an explicit cancellation or pause with stale state.
            if(!['paused','cancelling'].includes(current.state))await this.save({...current,state:'paused'});
          }else await this.save({...current,state:current.state==='cancelling'?'cancelling':'error',error:(error as Error).message});
        }finally{this.active=undefined;this.emit()}
      }
    }catch(error){this.error=(error as Error).message;this.emit()}
    finally{this.running=false}
  }
  private async run(original:UploadJob,signal:AbortSignal){
    let job=original;
    if(job.state==='cancelling'){
      // Init may have committed although its response never reached this browser.
      for(let attempts=0;;attempts++){
        try{
          const status=await this.transport.status(job.id,signal).catch(error=>{if(error instanceof ApiError&&[404,410].includes(error.status))return null;throw error});
          if(status?.status==='COMPLETE'){await this.save({...job,state:'complete',offset:job.size,error:undefined});this.files.delete(job.id);if(!this.disposed)this.completed();return}
          await this.transport.cancel(job.id,signal);break;
        }
        catch(error){
          if(error instanceof ApiError&&[404,410].includes(error.status)){
            const status=await this.transport.status(job.id,signal).catch(error=>{if(error instanceof ApiError&&[404,410].includes(error.status))return null;throw error});
            if(status?.status==='COMPLETE'){await this.save({...job,state:'complete',offset:job.size,error:undefined});this.files.delete(job.id);if(!this.disposed)this.completed();return}
            break;
          }
          if(error instanceof ApiError&&error.status===409&&attempts<20){await delay(signal);continue}
          throw error;
        }
      }
      await this.save({...job,state:'cancelled',error:undefined});this.files.delete(job.id);return;
    }
    const file=this.files.get(job.id);if(!file){await this.save({...job,state:'needs-file'});return}
    await this.save({...job,state:'verifying'});signal.throwIfAborted();
    const sha256=await this.hash(file,value=>{this.verification=value;this.emit()},signal);
    signal.throwIfAborted();
    if(job.sha256&&job.sha256!==sha256){this.files.delete(job.id);await this.save({...job,state:'needs-file',error:'File contents changed. Select the original file.'});return}
    job={...job,sha256,state:'uploading'};await this.save(job);signal.throwIfAborted();
    // The stable UUID and fingerprint are persisted BEFORE initiation.
    if(!job.initiated){await this.transport.init(job,signal);job={...job,initiated:true};await this.save(job)}
    let busyAttempts=0;
    for(;;){
      signal.throwIfAborted();
      const server=await this.transport.status(job.id,signal);
      const offset=Number(server.offset);
      if(server.size!==String(job.size)||server.sha256!==job.sha256||!Number.isSafeInteger(offset)||offset<0||offset>job.size)throw new Error('Upload identity mismatch');
      if(server.status==='COMPLETE'){
        job={...job,state:'complete',offset:job.size,expiresAt:server.expiresAt,error:undefined};
        await this.save(job);this.files.delete(job.id);if(!this.disposed)this.completed();return;
      }
      if(server.writing){if(++busyAttempts>20)throw new Error('Upload is busy. Try resuming again.');await delay(signal);continue}
      job={...job,offset,expiresAt:server.expiresAt};await this.save(job);signal.throwIfAborted();
      if(offset===job.size)throw new Error('Upload is busy. Try resuming again.');
      try{
        const end=Math.min(job.size,offset+16*1024*1024);
        const next=await this.transport.chunk(job.id,offset,file.slice(offset,end),signal);
        if(next!==end)throw new Error('Invalid upload offset');
        busyAttempts=0;
        // Confirm completion using the server, not a rounded local percentage.
      }catch(error){if(error instanceof ApiError&&error.status===409&&++busyAttempts<=20){await delay(signal);continue}throw error}
    }
  }
}
