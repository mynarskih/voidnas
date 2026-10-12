import {useEffect,useState} from 'react';
import {Bell,Check,LogOut,Monitor,RefreshCw,Save,ShieldCheck} from 'lucide-react';
import {api,fmtDate} from './api';
import {t} from './preferences';

type Session={id:string;ip:string|null;userAgent:string|null;createdAt:string;lastSeenAt:string;expiresAt:string;current:boolean;user?:{id:string;username:string}};
export function SessionsList({admin=false,onCurrentRevoked}:{admin?:boolean;onCurrentRevoked?:()=>void}){
  const[items,setItems]=useState<Session[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[loading,setLoading]=useState(true);
  const path=admin?'/api/admin/sessions':'/api/auth/sessions';
  const load=async(next?:string)=>{try{const data=await api<{items:Session[];nextCursor?:string|null}>(path+(next?'?cursor='+next:''));setItems(current=>next?[...current,...data.items]:data.items);setCursor(data.nextCursor??null);setError('')}catch(e){setError((e as Error).message)}finally{setLoading(false)}};
  useEffect(()=>{void load()},[admin]);
  async function revoke(row:Session){setBusy(row.id);try{await api(`${path}/${row.id}`,{method:'DELETE'});if(row.current)onCurrentRevoked?.();else void load()}catch(e){setError((e as Error).message)}finally{setBusy(null)}}
  return <section className="settings-section sessions-section"><header className="section-head"><div><h2>{t(admin?'Active devices':'Your devices')}</h2><p>{t('Each entry is an active sign-in session, not a verified device identity.')}</p></div><button className="button" onClick={()=>void load()}><RefreshCw size={14}/>{t('Refresh')}</button></header>
    {error&&<p className="error" role="alert">{error}</p>}{loading?<p role="status">{t('Loading…')}</p>:<div className="session-list">{items.map(row=><article className="session-row" key={row.id}><Monitor size={18}/><div><strong>{row.user?.username??t('Signed-in device')}{row.current&&<span className="quiet-badge">{t('This session')}</span>}</strong><span className="session-agent">{row.userAgent||t('Unknown browser')}</span><code>{row.ip??t('Unavailable')}</code><small>{t('Last activity')}: {fmtDate(row.lastSeenAt)} · {t('Created')}: {fmtDate(row.createdAt)}</small></div><button className="button" disabled={!!busy||(admin&&row.current)} onClick={()=>void revoke(row)}><LogOut size={14}/>{busy===row.id?t('Please wait'):t('Sign out device')}</button></article>)}</div>}
    {cursor&&<button className="button load-more" onClick={()=>void load(cursor)}>{t('Load more')}</button>}
  </section>;
}

type Settings={trashRetentionDays:7|30|90|null;uploadBytesPerSecond:number;downloadBytesPerSecond:number;maxConcurrentTransfers:number;storageWarningPercent:number;backupMaxAgeHours:number;publicLinksEnabled:boolean};
type Backup={status:'success'|'failed';lastAttemptAt:string;lastSuccessAt:string|null};
export function ServerSettings(){
  const[draft,setDraft]=useState<Settings|null>(null),[saved,setSaved]=useState<Settings|null>(null),[backup,setBackup]=useState<Backup|null>(null),[confirmation,setConfirmation]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{api<{settings:Settings;backup:Backup|null}>('/api/admin/settings').then(data=>{setDraft(data.settings);setSaved(data.settings);setBackup(data.backup)}).catch(e=>setError(e.message))},[]);
  if(!draft)return <p className={error?'error':'form-note'} role={error?'alert':'status'}>{error||t('Loading…')}</p>;
  const update=(patch:Partial<Settings>)=>{setDraft({...draft,...patch});setMessage('')};
  const requiresConfirm=draft.trashRetentionDays!==null&&draft.trashRetentionDays!==saved?.trashRetentionDays;
  async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');try{const result=await api<{settings:Settings}>('/api/admin/settings',{method:'PATCH',body:JSON.stringify({...draft,confirmRetention:confirmation})});setDraft(result.settings);setSaved(result.settings);setConfirmation(false);setMessage(t('Settings saved'))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <><div className="section-head"><div><h2>{t('Server settings')}</h2><p>{t('Changes are enforced by the server, for every account.')}</p></div></div><form className="server-settings settings-section" onSubmit={submit}>
    <fieldset><legend>{t('Trash retention')}</legend><label>{t('Automatically delete after')}<select value={draft.trashRetentionDays??'never'} onChange={e=>{update({trashRetentionDays:e.target.value==='never'?null:Number(e.target.value) as 7|30|90});setConfirmation(false)}}><option value="never">{t('Never automatically delete')}</option>{[7,30,90].map(days=><option key={days} value={days}>{t('{count} days',{count:days})}</option>)}</select></label>
      <p className="form-note">{t('Retention also applies to items already in Trash. Expired folders and their contents are permanently removed.')}</p>{requiresConfirm&&<label className="checkbox-note"><input type="checkbox" checked={confirmation} onChange={e=>setConfirmation(e.target.checked)} required/>{t('I understand that expired items will be permanently deleted.')}</label>}
    </fieldset>
    <fieldset><legend>{t('Transfer limits')}</legend><p className="form-note">{t('Limits apply per stream. Use 0 for unlimited speed; at least 0.0625 MiB/s otherwise.')}</p><div className="form-grid">
      <label>{t('Upload speed (MiB/s)')}<input type="number" min="0" max="1024" step="0.0625" value={draft.uploadBytesPerSecond/1024**2} onChange={e=>update({uploadBytesPerSecond:Math.round(Number(e.target.value)*1024**2)})}/></label>
      <label>{t('Download speed (MiB/s)')}<input type="number" min="0" max="1024" step="0.0625" value={draft.downloadBytesPerSecond/1024**2} onChange={e=>update({downloadBytesPerSecond:Math.round(Number(e.target.value)*1024**2)})}/></label>
      <label>{t('Concurrent transfers per account')}<input type="number" min="1" max="16" value={draft.maxConcurrentTransfers} onChange={e=>update({maxConcurrentTransfers:Number(e.target.value)})}/></label>
    </div></fieldset>
    <fieldset><legend>{t('Sharing and alerts')}</legend><label className="checkbox-note"><input type="checkbox" checked={draft.publicLinksEnabled} onChange={e=>update({publicLinksEnabled:e.target.checked})}/>{t('Allow public shared links')}</label><p className="form-note">{t('Disabling public links blocks existing links too, without deleting them.')}</p><div className="form-grid"><label>{t('Storage warning threshold (%)')}<input type="number" min="50" max="99" value={draft.storageWarningPercent} onChange={e=>update({storageWarningPercent:Number(e.target.value)})}/></label><label>{t('Backup overdue after (hours)')}<input type="number" min="1" max="720" value={draft.backupMaxAgeHours} onChange={e=>update({backupMaxAgeHours:Number(e.target.value)})}/></label></div><p className="form-note">{t('Last successful backup')}: <code>{backup?.lastSuccessAt?fmtDate(backup.lastSuccessAt):t('Not recorded')}</code></p></fieldset>
    {error&&<p className="error" role="alert">{error}</p>}<footer><span role="status">{message}</span><button className="button" disabled={busy||(requiresConfirm&&!confirmation)}><Save size={15}/>{t(busy?'Saving…':'Save changes')}</button></footer>
  </form></>;
}

type Alert={id:string;code:string;severity:string;message:string;active:boolean;acknowledgedAt:string|null;firstSeenAt:string;lastSeenAt:string;resolvedAt:string|null};
export function AlertsView(){
  const[items,setItems]=useState<Alert[]>([]),[history,setHistory]=useState(false),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  async function load(next?:string){try{const data=await api<{items:Alert[];nextCursor:string|null}>(`/api/admin/alerts?history=${history}`+(next?'&cursor='+next:''));setItems(current=>next?[...current,...data.items]:data.items);setCursor(data.nextCursor);setError('')}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),30_000);return()=>clearInterval(timer)},[history]);
  return <><div className="section-head"><div><h2>{t('Alerts')}</h2><p>{t('Local health and security notices. No external notifications.')}</p></div><button className="button" onClick={()=>setHistory(value=>!value)}>{t(history?'Active alerts':'Show history')}</button></div>
    {error&&<p className="error" role="alert">{t('Cannot reach the server or read alerts.')} {error}</p>}{loading?<p role="status">{t('Loading…')}</p>:!items.length?<p className="empty-note">{t('No active alerts')}</p>:<div className="alert-list">{items.map(item=><article key={item.id} className={`alert-row ${item.active?'':'resolved'}`}><span className={`status-dot ${item.active?(item.severity==='Critical'?'red':'amber'):'green'}`}/><div><strong>{t(item.message)}</strong><span><code>{item.code}</code> · {fmtDate(item.lastSeenAt)}</span><small>{t(item.active?'Active': 'Resolved')}{item.acknowledgedAt?' · '+t('Acknowledged'):''}</small></div>{item.active&&!item.acknowledgedAt&&<button className="button" onClick={async()=>{try{await api(`/api/admin/alerts/${item.id}`,{method:'PATCH',body:JSON.stringify({acknowledged:true})});void load()}catch(e){setError((e as Error).message)}}}><Check size={14}/>{t('Acknowledge')}</button>}</article>)}</div>}
    {cursor&&<button className="button load-more" onClick={()=>void load(cursor)}>{t('Load more')}</button>}
  </>;
}
export function AlertBell({onOpen}:{onOpen:()=>void}){
  const[count,setCount]=useState(0),[unavailable,setUnavailable]=useState(false);
  useEffect(()=>{let alive=true;const poll=()=>api<{unread:number}>('/api/admin/alerts?limit=1').then(data=>{if(alive){setCount(data.unread);setUnavailable(false)}}).catch(()=>{if(alive)setUnavailable(true)});void poll();const timer=setInterval(()=>void poll(),30_000);return()=>{alive=false;clearInterval(timer)}},[]);
  return <button className={`alert-bell icon-btn ${unavailable?'amber':''}`} onClick={onOpen} aria-label={t(unavailable?'Alerts unavailable':'Alerts')} title={t(unavailable?'Cannot reach the server or read alerts.':'Alerts')}><Bell size={17}/>{count>0&&<span className="alert-count">{count}</span>}</button>;
}
