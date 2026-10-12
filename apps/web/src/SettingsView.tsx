import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Globe, Moon, Save, Sun } from 'lucide-react';
import { api, User } from './api';
import { formatDate, Preferences, setPreferences, t } from './preferences';

const fromUser=(user:User):Preferences=>({language:user.language,timeZone:user.timeZone,theme:user.theme});
export function SettingsView({user,onSaved}:{user:User;onSaved:(preferences:Preferences)=>void}){
  const[draft,setDraft]=useState(()=>fromUser(user)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[now,setNow]=useState(()=>new Date());
  const persisted=useRef(fromUser(user));
  useEffect(()=>{persisted.current=fromUser(user)},[user.language,user.timeZone,user.theme]);
  useEffect(()=>()=>setPreferences(persisted.current),[]);
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(timer)},[]);
  const zones=useMemo(()=>Array.from(new Set(['UTC',draft.timeZone,...Intl.supportedValuesOf('timeZone')])).sort(),[draft.timeZone]);
  const dirty=JSON.stringify(draft)!==JSON.stringify(fromUser(user));
  function change(next:Preferences){setDraft(next);setPreferences(next);setSaved(false);setError('')}
  async function save(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');
    try{const result=await api<{preferences:Preferences}>('/api/auth/preferences',{method:'PATCH',body:JSON.stringify(draft)});persisted.current=result.preferences;setDraft(result.preferences);setPreferences(result.preferences);onSaved(result.preferences);setSaved(true)}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <div className="page narrow preferences-page"><header className="page-head"><div><div className="breadcrumb">VoidNAS <span> / {t('Settings')}</span></div><h1>{t('Settings')}</h1></div></header>
    <section className="preferences-card"><header><h2>{t('Personal preferences')}</h2><p>{t('Choose your language, time zone and appearance.')}</p></header>
      <form onSubmit={save}>
        <label htmlFor="language"><span><Globe size={16}/>{t('Language')}</span><select id="language" value={draft.language} disabled={busy} onChange={e=>change({...draft,language:e.target.value as Preferences['language']})}><option value="en">English</option><option value="pl">Polski</option></select></label>
        <label htmlFor="time-zone"><span>{t('Time zone')}</span><select id="time-zone" value={draft.timeZone} disabled={busy} onChange={e=>change({...draft,timeZone:e.target.value})}>{zones.map(zone=><option key={zone} value={zone}>{zone}</option>)}</select><small>{t('Dates are displayed in this time zone. Server time is not changed.')}</small></label>
        <div className="zone-preview"><code>{t('Current time')}: {formatDate(now.toISOString(),draft)}</code><button type="button" className="button" disabled={busy} onClick={()=>change({...draft,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})}>{t('Use device time zone')}</button></div>
        <fieldset><legend>{t('Appearance')}</legend><div className="theme-choices">{(['dark','light'] as const).map(theme=><label key={theme} className={draft.theme===theme?'selected':''}><input type="radio" name="appearance" value={theme} checked={draft.theme===theme} disabled={busy} onChange={()=>change({...draft,theme})}/>{theme==='dark'?<Moon size={18}/>:<Sun size={18}/>}<span>{t(theme==='dark'?'Dark':'Light')}</span>{draft.theme===theme&&<Check size={15}/>}</label>)}</div></fieldset>
        <p className="form-note">{t('Preferences are saved to your account and apply on every device.')}</p>
        {error&&<p className="error" role="alert">{t(error)}</p>}
        <footer><span role="status" aria-live="polite">{saved?t('Settings saved'):dirty?t('Unsaved changes'):''}</span><div><button type="button" className="button" disabled={!dirty||busy} onClick={()=>change(fromUser(user))}>{t('Reset changes')}</button><button className="button" disabled={!dirty||busy}><Save size={15}/>{t(busy?'Saving…':'Save changes')}</button></div></footer>
      </form>
    </section>
  </div>;
}
