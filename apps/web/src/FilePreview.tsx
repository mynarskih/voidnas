import {lazy,Suspense,useEffect,useState} from 'react';
import {Download,FileImage} from 'lucide-react';
import {api,FileItem} from './api';
import {Modal} from './Modal';
import {t} from './preferences';

const PdfPreview=lazy(()=>import('./PdfPreview'));
type Preview={kind:'image'|'audio'|'video'|'pdf'|'text';mimeType:string;content?:string};
export function FilePreview({item,onClose,prefix='/api/files'}:{item:FileItem;onClose:()=>void;prefix?:string}){
  const[info,setInfo]=useState<Preview|null>(null),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();setInfo(null);setError('');api<Preview>(`${prefix}/${item.id}/preview-info`,{signal:controller.signal}).then(setInfo).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[item.id,prefix]);
  const source=`${prefix}/${item.id}/preview`;
  return <Modal title={item.name} onClose={onClose} className="file-preview"><div className="preview-stage">
    {error?<div className="preview-error" role="alert"><FileImage size={28}/><p>{t(error)}</p><p>{t('Download the file to open it on your device.')}</p></div>:!info?<p role="status">{t('Loading…')}</p>:info.kind==='image'?<img src={source} alt={item.name} onError={()=>setError(t('Preview unavailable'))}/>:info.kind==='audio'?<audio controls preload="metadata" src={source} onError={()=>setError(t('This browser cannot play this media format.'))}/>:info.kind==='video'?<video controls playsInline preload="metadata" src={source} onError={()=>setError(t('This browser cannot play this media format.'))}/>:info.kind==='pdf'?<Suspense fallback={<p role="status">{t('Loading PDF viewer…')}</p>}><PdfPreview url={source}/></Suspense>:<pre className="text-preview">{info.content}</pre>}
  </div><footer className="preview-footer"><span className="form-note">{t('Preview only · No file scripts are executed')}</span><a className="button" href={`${prefix}/${item.id}/download`}><Download size={15}/>{t('Download')}</a></footer></Modal>;
}
export function FileThumbnail({item,prefix='/api/files'}:{item:FileItem;prefix?:string}){
  const[failed,setFailed]=useState(false);
  if(failed)return <FileImage size={18}/>;
  return <img className="file-thumbnail" src={`${prefix}/${item.id}/thumbnail`} loading="lazy" alt="" onError={()=>setFailed(true)}/>;
}
export const hasThumbnail=(item:FileItem)=>!item.isDirectory&&/\.(png|jpe?g|gif|webp|avif)$/i.test(item.name);
