export function hashFile(file:File,progress:(value:number)=>void,signal:AbortSignal):Promise<string>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./upload-hash.worker.ts',import.meta.url),{type:'module'});
    const cleanup=()=>{worker.terminate();signal.removeEventListener('abort',abort)};
    const abort=()=>{cleanup();reject(new DOMException('Aborted','AbortError'))};
    if(signal.aborted){abort();return}
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=event=>{
      if(typeof event.data.progress==='number')progress(event.data.progress);
      if(typeof event.data.hash==='string'){cleanup();resolve(event.data.hash)}
      if(event.data.error){cleanup();reject(new Error(event.data.error))}
    };
    worker.onerror=()=>{cleanup();reject(new Error('File verification failed'))};
    worker.postMessage(file);
  });
}
