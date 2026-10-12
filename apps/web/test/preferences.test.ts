import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPreferences, formatDate, getPreferences, setPreferences, t, validTimeZone } from '../src/preferences';

afterEach(()=>{setPreferences(defaultPreferences);vi.unstubAllGlobals()});
describe('account preferences',()=>{
  it('translates UI labels and interpolates filenames without interpreting markup',()=>{
    setPreferences({...defaultPreferences,language:'pl'});
    expect(t('Files')).toBe('Pliki');
    expect(t('Select {name}',{name:'<script>.txt'})).toBe('Zaznacz <script>.txt');
    expect(t('Unknown technical value')).toBe('Unknown technical value');
    setPreferences(defaultPreferences);expect(t('Files')).toBe('Files');
  });
  it('formats the same UTC instant in the selected time zone, including daylight saving',()=>{
    const utc={...defaultPreferences,timeZone:'UTC'};
    const warsaw={...defaultPreferences,timeZone:'Europe/Warsaw'};
    expect(formatDate('2026-01-10T12:00:00Z',utc)).toContain('12:00');
    expect(formatDate('2026-01-10T12:00:00Z',warsaw)).toContain('13:00');
    expect(formatDate('2026-07-10T12:00:00Z',warsaw)).toContain('14:00');
    expect(formatDate(null,{...warsaw,language:'pl'})).toBe('Nigdy');
    expect(formatDate('invalid',warsaw)).toBe('Unavailable');
  });
  it('applies theme and language to the document, caching only preferences',()=>{
    const document={documentElement:{dataset:{},style:{},lang:''}};
    const setItem=vi.fn();vi.stubGlobal('document',document);vi.stubGlobal('localStorage',{setItem});
    const account={...defaultPreferences,theme:'light' as const,language:'pl' as const,username:'private-account',csrfToken:'must-not-cache'};
    setPreferences(account);
    expect(document.documentElement.dataset).toEqual({theme:'light'});
    expect(document.documentElement.style).toEqual({colorScheme:'light'});
    expect(document.documentElement.lang).toBe('pl');
    expect(getPreferences()).toEqual({language:'pl',timeZone:'Europe/Warsaw',theme:'light'});
    expect(setItem.mock.calls[0][1]).not.toContain('private-account');
    expect(setItem.mock.calls[0][1]).not.toContain('must-not-cache');
  });
  it('works even when browser storage is disabled',()=>{
    vi.stubGlobal('localStorage',{setItem:()=>{throw new Error('blocked')}});
    expect(()=>setPreferences({...defaultPreferences,theme:'light'})).not.toThrow();
    expect(getPreferences().theme).toBe('light');
  });
  it('validates time zones',()=>{
    expect(validTimeZone('Europe/Warsaw')).toBe(true);expect(validTimeZone('UTC')).toBe(true);
    expect(validTimeZone('Europe/NotAZone')).toBe(false);
  });
});
