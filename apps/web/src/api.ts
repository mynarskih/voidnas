import { formatDate, Preferences, t } from './preferences';
export type User = Preferences & { id:string; username:string; role:'ADMIN'|'USER'; quotaBytes:string|null; usedBytes:string; enabled:boolean; createdAt?:string; lastLogin?:string|null };
export type FileItem = { id:string; name:string; size:string; mimeType?:string; isDirectory:boolean; updatedAt:string; deletedAt?:string|null };
// Only a UI hint. The server independently validates UTF-8 contents and size.
export const canEditText=(item:FileItem)=>!item.isDirectory&&(item.mimeType?.startsWith('text/')||/\.(txt|md|markdown|json|yaml|yml|toml|xml|csv|log|ini|conf|config|env|js|ts|jsx|tsx|css|html|sql|sh|ps1|py|rs|go|java|c|h|cpp|svg)$/i.test(item.name)||!item.name.includes('.'));
let csrf = '';
export class ApiError extends Error{constructor(message:string,public status:number){super(message);this.name='ApiError'}}
export const setCsrf = (value:string) => { csrf=value; };
let csrfRefresh:Promise<void>|null=null;
async function refreshCsrf(){
  if(!csrfRefresh)csrfRefresh=(async()=>{
    const response=await fetch('/api/auth/me',{credentials:'include',cache:'no-store'});
    if(!response.ok)throw new Error(t('Session expired. Sign in again.'));
    const data=await response.json();setCsrf(data.csrfToken);
  })().finally(()=>{csrfRefresh=null});
  return csrfRefresh;
}
export async function apiResponse(path:string, init:RequestInit={}) {
  const headers=new Headers(init.headers);
  if(init.body && !(init.body instanceof Blob) && !headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const mutation=['POST','PUT','PATCH','DELETE'].includes((init.method||'GET').toUpperCase());
  const publicUnlock=/^\/api\/public-links\/[a-f0-9-]{36}\/unlock$/.test(path);
  const protectedRequest=mutation && !publicUnlock && !['/api/auth/login','/api/setup'].includes(path);
  if(protectedRequest && !csrf)await refreshCsrf();
  if(protectedRequest)headers.set('X-CSRF-Token',csrf);
  let response=await fetch(path,{...init,headers,credentials:'include'});
  // A rejected CSRF check executes no handler, so replaying this request is safe.
  if(protectedRequest && response.status===403 && (await response.clone().json().catch(()=>({}))).error==='CSRF validation failed'){
    await refreshCsrf();headers.set('X-CSRF-Token',csrf);
    response=await fetch(path,{...init,headers,credentials:'include'});
  }
  if(!response.ok){const data=await response.json().catch(()=>({error:response.statusText}));throw new ApiError(t(data.error||'Request failed'),response.status)}
  return response;
}
export async function api<T>(path:string, init:RequestInit={}) {const response=await apiResponse(path,init);if(response.status===204)return undefined as T;return response.json() as Promise<T>}
export const fmtBytes=(value:string|number|null|undefined)=>{if(value===null)return t('Unlimited');if(value===undefined)return t('Unavailable');let n=Number(value);if(!Number.isFinite(n))return t('Unavailable');if(n===0)return'0 B';const u=['B','KB','MB','GB','TB','PB'];const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),u.length-1);return`${(n/1024**i).toFixed(i>1?1:0)} ${u[i]}`};
export const fmtDate=formatDate;
