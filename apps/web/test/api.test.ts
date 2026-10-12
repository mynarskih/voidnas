import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiResponse, setCsrf } from '../src/api';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>setCsrf(''));
afterEach(()=>vi.unstubAllGlobals());
describe('authenticated API requests',()=>{
  it('recovers CSRF when a new browser tab has an existing cookie',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(json({csrfToken:'restored'})).mockResolvedValueOnce(json({ok:true}));vi.stubGlobal('fetch',fetcher);
    await api('/api/auth/logout',{method:'POST'});
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/me');
    expect(fetcher.mock.calls[1][1].headers.get('X-CSRF-Token')).toBe('restored');
  });
  it('retries a CSRF rejection once with the refreshed token',async()=>{
    setCsrf('stale');const fetcher=vi.fn().mockResolvedValueOnce(json({error:'CSRF validation failed'},403)).mockResolvedValueOnce(json({csrfToken:'fresh'})).mockResolvedValueOnce(json({ok:true}));vi.stubGlobal('fetch',fetcher);
    await api('/api/auth/password',{method:'PATCH',body:JSON.stringify({newPassword:'test'})});
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][1].headers.get('X-CSRF-Token')).toBe('fresh');
  });
  it('never retries authorization failures',async()=>{
    setCsrf('current');const fetcher=vi.fn().mockResolvedValue(json({error:'Administrator role required'},403));vi.stubGlobal('fetch',fetcher);
    await expect(api('/api/admin/users',{method:'POST'})).rejects.toThrow('Administrator');expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('sends file blobs without JSON conversion and preserves offset headers',async()=>{
    setCsrf('current');const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal('fetch',fetcher);
    const bytes=new Blob(['binary']);await apiResponse('/api/uploads/id',{method:'PATCH',body:bytes,headers:{'Content-Type':'application/offset+octet-stream','Upload-Offset':'0'}});
    const init=fetcher.mock.calls[0][1];expect(init.body).toBe(bytes);expect(init.headers.get('Content-Type')).toBe('application/offset+octet-stream');expect(init.headers.get('Upload-Offset')).toBe('0');
  });
  it('login works without an existing authenticated session',async()=>{
    const fetcher=vi.fn().mockResolvedValue(json({csrfToken:'new'}));vi.stubGlobal('fetch',fetcher);
    await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:'test',password:'test'})});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1].headers.has('X-CSRF-Token')).toBe(false);
  });
});
