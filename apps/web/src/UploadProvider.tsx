import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {File,Pause,Play,UploadCloud,X} from 'lucide-react';
import {fmtBytes,fmtDate} from './api';
import {t} from './preferences';
import {BrowserUploadRepository} from './upload-store';
import {browserUploadLock,UploadManager,uploadTransport} from './upload-manager';
import {hashFile} from './upload-hash';
type Transfers={manager:UploadManager|null;open:()=>void;enqueue:(files:Iterable<File>,parentId:string|null,destination:string)=>Promise<void>};
const Context=createContext<Transfers|null>(null);
export function useUploads(){const value=useContext(Context);if(!value)throw new Error('Upload provider required');return value}
export function UploadProvider({userId,onCompleted,children}:{userId:string;onCompleted:()=>void;children:ReactNode}){
  const[manager,setManager]=useState<UploadManager|null>(null),[,render]=useState(0),[open,setOpen]=useState(false),[error,setError]=useState('');
  const callback=useRef(onCompleted);callback.current=onCompleted;
  useEffect(()=>{
    let mounted=true;
    const current=new UploadManager(userId,new BrowserUploadRepository(),uploadTransport,hashFile,browserUploadLock,()=>{
      window.dispatchEvent(new Event('nas-files-changed'));callback.current();
    });
    const unsubscribe=current.subscribe(()=>render(value=>value+1));setManager(current);
    void current.initialize().then(()=>{if(mounted&&current.jobs.some(job=>!['complete','cancelled'].includes(job.state)))setOpen(true)});
    return()=>{mounted=false;unsubscribe();current.dispose()};
  },[userId]);
  const act=(action:()=>Promise<void>)=>{setError('');void action().catch(error=>setError((error as Error).message))};
  const choose=useRef<HTMLInputElement>(null),chosen=useRef<string|null>(null);
  const jobs=manager?.jobs??[];
  return <Context.Provider value={{manager,open:()=>setOpen(true),enqueue:async(files,parentId,destination)=>{
    setOpen(true);await manager?.enqueue(files,parentId,destination);
  }}}>{children}
    {open&&<section className="upload-tray durable-tray" aria-label={t('File transfers')}>
      <header><span>{t('Uploads')}</span><small>{jobs.filter(job=>job.state==='complete').length} / {jobs.length}</small><button className="icon-btn" aria-label={t('Close uploads')} onClick={()=>setOpen(false)}><X size={16}/></button></header>
      <p className="transfer-note">{t('After reopening your browser, select the original file to resume. Files are not stored in the browser.')}</p>
      {(error||manager?.error)&&<p className="error" role="alert">{t(error||manager!.error)}</p>}
      <div className="upload-jobs">{jobs.map(job=>{
        const percent=job.state==='complete'?100:job.size?Math.min(99,Math.floor(job.offset/job.size*100)):0;
        const active=['queued','verifying','uploading'].includes(job.state),finished=['complete','cancelled'].includes(job.state);
        return <article className="durable-job" key={job.id}><div className="transfer-title"><File size={16}/><strong title={job.name}>{job.name}</strong><code>{percent}%</code></div>
          <div className="bar" role="progressbar" aria-label={job.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{width:percent+'%'}}/></div>
          <div className="transfer-meta"><span>{job.destination}</span><code>{fmtBytes(job.offset)} / {fmtBytes(job.size)}</code></div>
          <p className={job.error?'error':'transfer-status'} role={job.error?'alert':undefined}>{job.error?t(job.error):job.state==='verifying'?t('Checking file contents… {percent}%',{percent:manager!.verification}):t({'queued':'Queued','verifying':'Checking file contents…','uploading':'Uploading…','paused':'Paused','needs-file':'Select file to resume','complete':'Upload complete','cancelling':'Cancelling…','cancelled':'Cancelled','error':'Transfer interrupted'}[job.state])}</p>
          {job.expiresAt&&!finished&&<small className="transfer-expiry">{t('Resume before {date}',{date:fmtDate(job.expiresAt)})}</small>}
          <div className="transfer-actions">
            {active&&<button className="button" onClick={()=>act(()=>manager!.pause(job.id))}><Pause size={13}/>{t('Pause')}</button>}
            {!active&&!finished&&job.state!=='cancelling'&&<><button className="button" onClick={()=>act(()=>manager!.resume(job.id))}><Play size={13}/>{t('Resume')}</button><button className="button" onClick={()=>{chosen.current=job.id;choose.current?.click()}}>{t('Choose original file')}</button></>}
            {!finished&&<button className="button" onClick={()=>act(()=>manager!.cancel(job.id))}>{t(job.state==='cancelling'?'Retry cancellation':'Cancel upload')}</button>}
            {finished&&<button className="button" onClick={()=>act(()=>manager!.remove(job.id))}>{t('Dismiss')}</button>}
          </div>
        </article>;
      })}</div>
      {!jobs.length&&<p className="transfer-note">{t('No transfers yet')}</p>}
      <input ref={choose} type="file" hidden onChange={event=>{const file=event.target.files?.[0],id=chosen.current;if(file&&id)act(()=>manager!.resume(id,file));event.target.value=''}}/>
    </section>}
  </Context.Provider>;
}
export function TransferButton(){const{open,manager}=useUploads();return <button className="button" onClick={open}><UploadCloud size={14}/>{t('Transfers')}{manager?.jobs.some(job=>!['complete','cancelled'].includes(job.state))&&<span className="mono">{manager.jobs.filter(job=>!['complete','cancelled'].includes(job.state)).length}</span>}</button>}
