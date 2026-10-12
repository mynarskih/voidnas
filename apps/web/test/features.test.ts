import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {t} from '../src/preferences';
import {canEditText} from '../src/api';
const source=(file:string)=>readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
describe('NAS feature safety and accessibility contracts',()=>{
  it('does not offer text editing for images, PDF or media',()=>{
    const base={id:'test',size:'1',isDirectory:false,updatedAt:'2026-09-26'};
    for(const name of ['image.png','audio.wav','video.mp4','document.pdf'])expect(canEditText({...base,name})).toBe(false);
    for(const name of ['readme.txt','code.html','vector.svg'])expect(canEditText({...base,name})).toBe(true);
    expect(canEditText({...base,name:'folder.txt',isDirectory:true})).toBe(false);
  });
  it('escapes markup by using text nodes, never raw HTML',()=>{
    const preview=source('FilePreview.tsx');expect(preview).toContain('{info.content}');expect(preview).not.toContain('dangerouslySetInnerHTML');
    expect(preview).not.toContain('<iframe');expect(source('PdfPreview.tsx')).toContain('annotationMode:0');expect(source('PdfPreview.tsx')).toContain('enableXfa:false');
  });
  it('keeps shared link secrets in fragments, not API URL parameters',()=>{
    expect(source('SharingViews.tsx')).toContain('location.hash.slice(1)');expect(source('SharingViews.tsx')).toContain("'X-Link-Token':token");
    expect(source('SharingViews.tsx')).not.toContain('localStorage');
  });
  it('requires explicit acknowledgement of destructive retention',()=>{
    expect(source('OperationsViews.tsx')).toContain('requiresConfirm&&!confirmation');expect(source('OperationsViews.tsx')).toContain('confirmRetention:confirmation');
  });
  it('labels preview, session and alert controls in Polish',()=>{
    expect(t('Preview',{},'pl')).toBe('Podgląd');expect(t('Sign out device',{},'pl')).toBe('Wyloguj urządzenie');expect(t('Alerts',{},'pl')).toBe('Alerty');
    expect(t('Read and write',{},'pl')).toBe('Odczyt i zapis');
  });
});
