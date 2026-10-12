export type UploadState='queued'|'verifying'|'uploading'|'paused'|'needs-file'|'complete'|'cancelling'|'cancelled'|'error';
export type UploadJob={id:string;userId:string;name:string;size:number;type:string;lastModified:number;parentId:string|null;destination:string;sha256?:string;initiated:boolean;offset:number;expiresAt?:string;state:UploadState;error?:string;createdAt:number};
export interface UploadRepository{list(userId:string):Promise<UploadJob[]>;put(job:UploadJob):Promise<void>;remove(userId:string,id:string):Promise<void>}
export class BrowserUploadRepository implements UploadRepository{
  private db:Promise<IDBDatabase>|undefined;
  private open(){
    return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('voidnas-transfers',1);
      request.onupgradeneeded=()=>{const store=request.result.createObjectStore('jobs',{keyPath:'key'});store.createIndex('userId','userId')};
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)};
      request.onerror=()=>reject(new Error('Upload queue storage unavailable'));
      request.onblocked=()=>reject(new Error('Upload queue storage unavailable'));
    });
  }
  async list(userId:string){
    const db=await this.open();
    return new Promise<UploadJob[]>((resolve,reject)=>{
      const transaction=db.transaction('jobs','readonly'),request=transaction.objectStore('jobs').index('userId').getAll(userId);
      transaction.oncomplete=()=>resolve(request.result.map(({key,...job})=>job).sort((a,b)=>a.createdAt-b.createdAt));
      transaction.onerror=transaction.onabort=()=>reject(new Error('Upload queue storage unavailable'));
    });
  }
  async put(job:UploadJob){
    const db=await this.open();
    await new Promise<void>((resolve,reject)=>{
      const transaction=db.transaction('jobs','readwrite');
      // Explicit metadata only: never persist File/Blob objects, cookies or tokens.
      const {id,userId,name,size,type,lastModified,parentId,destination,sha256,initiated,offset,expiresAt,state,error,createdAt}=job;
      transaction.objectStore('jobs').put({key:userId+':'+id,id,userId,name,size,type,lastModified,parentId,destination,sha256,initiated,offset,expiresAt,state,error,createdAt});
      transaction.oncomplete=()=>resolve();
      transaction.onerror=transaction.onabort=()=>reject(new Error('Upload queue storage unavailable'));
    });
  }
  async remove(userId:string,id:string){
    const db=await this.open();
    await new Promise<void>((resolve,reject)=>{
      const transaction=db.transaction('jobs','readwrite');transaction.objectStore('jobs').delete(userId+':'+id);
      transaction.oncomplete=()=>resolve();transaction.onerror=transaction.onabort=()=>reject(new Error('Upload queue storage unavailable'));
    });
  }
}
