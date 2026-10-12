import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { basename, normalize, resolve, sep } from 'node:path';
import { config } from '../config.js';

export const randomToken = () => randomBytes(32).toString('base64url');
export const sessionCsrfToken = (sessionId: string, secret = config.CSRF_SECRET) => createHmac('sha256', secret).update(`voidnas:csrf:${sessionId}`).digest('base64url');
export const hashToken = (token: string, secret = config.SESSION_PEPPER) => createHash('sha256').update(`${secret}:${token}`).digest('hex');
export const safeEqual = (a: string, b: string) => {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};

export function validateName(name: string) {
  const value = name.normalize('NFC').trim();
  if (!value || Buffer.byteLength(value, 'utf8') > 255 || value === '.' || value === '..' || /[\\/:*?"<>|\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(value) || /[. ]$/u.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new Error('INVALID_FILENAME');
  return value;
}

export function resolveInside(root: string, relative: string) {
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, normalize(relative));
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${sep}`)) throw new Error('PATH_ESCAPE');
  return absolute;
}

export function contentDisposition(name: string) {
  const fallback = basename(name).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
