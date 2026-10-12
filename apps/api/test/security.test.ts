import { describe, expect, it } from 'vitest';
import { contentDisposition, resolveInside, sessionCsrfToken, validateName } from '../src/lib/security.js';

describe('storage boundary', () => {
  it('allows a descendant path', () => expect(resolveInside('/srv/nas/storage', 'users/id/file')).toContain('users'));
  it('rejects traversal', () => expect(() => resolveInside('/srv/nas/storage', '../../etc/passwd')).toThrow('PATH_ESCAPE'));
  it('rejects path separators and control characters in names', () => {
    for (const name of ['../secret', 'folder/file', 'bad\0name', 'line\nbreak']) expect(() => validateName(name)).toThrow('INVALID_FILENAME');
  });
  it('encodes download names without header injection', () => {
    const header = contentDisposition('report\r\nInjected: yes.pdf');
    expect(header).not.toContain('\r'); expect(header).not.toContain('\n'); expect(header).toContain("filename*=UTF-8''");
  });
  it('rejects unsafe Windows names, hidden direction controls and excessive UTF-8 bytes', () => {
    for (const name of ['CON.txt','aux','file\tname','file:name','a\u202etxt','ą'.repeat(128),'\ud800']) expect(() => validateName(name)).toThrow('INVALID_FILENAME');
    expect(validateName('Zdjęcie 📷.jpg')).toBe('Zdjęcie 📷.jpg');
  });
});

describe('recoverable session CSRF token',()=>{
  it('is stable across tabs and reloads for one session',()=>expect(sessionCsrfToken('session-1')).toBe(sessionCsrfToken('session-1')));
  it('is bound to the session and server secret',()=>{
    expect(sessionCsrfToken('session-1')).not.toBe(sessionCsrfToken('session-2'));
    expect(sessionCsrfToken('session-1','secret-a')).not.toBe(sessionCsrfToken('session-1','secret-b'));
  });
});
