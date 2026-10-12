import { useEffect, useRef, useState } from 'react';
import { Save, X } from 'lucide-react';
import { api, FileItem, fmtBytes } from './api';
import { t } from './preferences';

export function TextEditor({item,onClose,onSaved}:{item:FileItem;onClose:()=>void;onSaved:()=>void}){
  const[content,setContent]=useState(''),[original,setOriginal]=useState(''),[version,setVersion]=useState('');
  const[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const dialog=useRef<HTMLDivElement>(null),textarea=useRef<HTMLTextAreaElement>(null);
  const dirty=content!==original,byteLength=new TextEncoder().encode(content).length;
  const close=()=>{if(!saving&&(!dirty||window.confirm(t("Discard unsaved changes?"))))onClose()};
  useEffect(()=>{
    let alive=true;
    api<{content:string;version:string}>(`/api/files/${item.id}/text`).then(data=>{if(alive){setContent(data.content);setOriginal(data.content);setVersion(data.version)}}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)});
    return()=>{alive=false};
  },[item.id]);
  useEffect(()=>{if(!loading)textarea.current?.focus()},[loading]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return()=>previous?.focus();
  },[]);
  async function save(){
    setSaving(true);setError('');
    try{const result=await api<{version:string}>(`/api/files/${item.id}/text`,{method:'PUT',body:JSON.stringify({content,version})});setVersion(result.version);setOriginal(content);onSaved()}
    catch(e){setError((e as Error).message)}finally{setSaving(false)}
  }
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="editor-title" onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();close()}
    if((event.ctrlKey||event.metaKey)&&event.key==='s'){event.preventDefault();if(version&&dirty&&!saving&&byteLength<=1024*1024)void save()}
    if(event.key==='Tab'){
      const elements=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled)');
      const first=elements?.[0],last=elements?.[elements.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
  }}>
    <button className="modal-scrim" onClick={close} aria-label={t("Close text editor")} tabIndex={-1}/>
    <div className="modal text-editor" ref={dialog}>
      <header><div><h2 id="editor-title">{item.name}{dirty?' •':''}</h2><p>{t("Text editor · UTF-8 · Maximum 1 MB")}</p></div><button className="icon-btn" aria-label={t("Close editor")} disabled={saving} onClick={close}><X size={17}/></button></header>
      {loading?<p className="editor-notice">{t("Loading…")}</p>:version?<textarea ref={textarea} value={content} onChange={event=>setContent(event.target.value)} aria-label={t('Contents of {name}',{name:item.name})} spellCheck={false} disabled={saving}/>:null}
      {error&&<p className="error editor-notice" role="alert">{error}</p>}
      <footer><span>{fmtBytes(byteLength)}{dirty?t(" · Unsaved changes"):t(" · Saved")}{byteLength>1024*1024?t(" · File too large"):''}</span><div><button className="button" disabled={saving} onClick={close}>{t("Close")}</button><button className="button" disabled={!version||!dirty||saving||byteLength>1024*1024} onClick={()=>void save()}><Save size={15}/>{saving?t("Saving…"):t("Save")}</button></div></footer>
    </div>
  </div>;
}
