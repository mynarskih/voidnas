import {fingerprint} from './upload-fingerprint';
self.onmessage=async(event:MessageEvent<Blob>)=>{
  try{self.postMessage({hash:await fingerprint(event.data,progress=>self.postMessage({progress}))})}
  catch(error){self.postMessage({error:(error as Error).message})}
};
