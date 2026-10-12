import { Transform, type TransformCallback } from 'node:stream';

// One stream chunk at a time; backpressure holds the upstream. No file buffers.
export class TransferThrottle extends Transform {
  private timer?:ReturnType<typeof setTimeout>;
  private pending?:TransformCallback;
  private next=performance.now();
  constructor(private bytesPerSecond:number){super({highWaterMark:256*1024})}
  _transform(chunk:Buffer,_encoding:BufferEncoding,callback:TransformCallback){
    if(!this.bytesPerSecond){callback(null,chunk);return}
    const now=performance.now();this.next=Math.max(now,this.next)+chunk.length/this.bytesPerSecond*1000;
    this.pending=callback;
    this.timer=setTimeout(()=>{this.timer=undefined;this.pending=undefined;callback(null,chunk)},Math.max(0,this.next-now));
  }
  _destroy(error:Error|null,callback:(error?:Error|null)=>void){if(this.timer)clearTimeout(this.timer);this.pending?.(error??new Error('Transfer cancelled'));this.pending=undefined;callback(error)}
}
const transfers=new Map<string,number>();
export function acquireTransfer(actorId:string,limit:number){
  const active=transfers.get(actorId)??0;
  if(active>=limit)throw Object.assign(new Error('Concurrent transfer limit reached'),{statusCode:429});
  transfers.set(actorId,active+1);let released=false;
  return()=>{if(released)return;released=true;const count=(transfers.get(actorId)??1)-1;if(count)transfers.set(actorId,count);else transfers.delete(actorId)};
}
