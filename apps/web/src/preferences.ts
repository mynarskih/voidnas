import { useSyncExternalStore } from 'react';
import { polish } from './translations';

export type Preferences={language:'en'|'pl';timeZone:string;theme:'dark'|'light'};
export const defaultPreferences:Preferences={language:'en',timeZone:'Europe/Warsaw',theme:'dark'};
export function validTimeZone(value:string){try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);return true}catch{return false}}
function cachedPreferences():Preferences{
  try{
    const stored=JSON.parse(localStorage.getItem('voidnas.preferences')||'null');
    if(stored&&['en','pl'].includes(stored.language)&&['dark','light'].includes(stored.theme)&&typeof stored.timeZone==='string'&&validTimeZone(stored.timeZone))return {language:stored.language,timeZone:stored.timeZone,theme:stored.theme};
  }catch{ /* Storage can be unavailable; the account remains the source of truth. */ }
  return defaultPreferences;
}
let current=cachedPreferences();
const listeners=new Set<()=>void>();
export const getPreferences=()=>current;
function applyDocument(preferences:Preferences){
  if(typeof document==='undefined')return;
  document.documentElement.dataset.theme=preferences.theme;
  document.documentElement.lang=preferences.language;
  document.documentElement.style.colorScheme=preferences.theme;
}
applyDocument(current);
export function setPreferences(preferences:Preferences){
  current={language:preferences.language,timeZone:preferences.timeZone,theme:preferences.theme};applyDocument(current);
  try{localStorage.setItem('voidnas.preferences',JSON.stringify(current))}catch{ /* Account persistence does not depend on browser storage. */ }
  listeners.forEach(listener=>listener());
}
export const usePreferences=()=>useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},getPreferences,getPreferences);
export function t(key:string,values:Record<string,string|number>={},language=current.language){
  const message=language==='pl'?(polish[key]??key):key;
  return message.replace(/\{(\w+)\}/g,(match,name)=>Object.prototype.hasOwnProperty.call(values,name)?String(values[name]):match);
}
let dateFormatter:{key:string;value:Intl.DateTimeFormat}|undefined;
export function formatDate(value?:string|null,preferences=current){
  if(!value)return t('Never',{},preferences.language);
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return t('Unavailable',{},preferences.language);
  const key=preferences.language+'|'+preferences.timeZone;
  if(dateFormatter?.key!==key)dateFormatter={key,value:new Intl.DateTimeFormat(preferences.language==='pl'?'pl-PL':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:preferences.timeZone})};
  return dateFormatter.value.format(date);
}
