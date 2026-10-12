import { describe, expect, it } from 'vitest';
import { allowedMutationOrigin } from '../src/lib/request-policy.js';
describe('browser origin boundary', () => {
  it('accepts same-origin HTTPS and token-authenticated non-browser clients', () => {
    expect(allowedMutationOrigin('https://nas.example.com','same-origin','nas.example.com',true)).toBe(true);
    expect(allowedMutationOrigin(undefined,undefined,'nas.example.com',true)).toBe(true);
  });
  it('rejects cross-site login/setup, siblings, null origins and insecure origins', () => {
    for (const origin of ['https://evil.example','https://portfolio.example.com','null','http://nas.example.com','https://nas.example.com@evil.example','https://nas.example.com/path'])
      expect(allowedMutationOrigin(origin,'same-site','nas.example.com',true)).toBe(false);
    expect(allowedMutationOrigin(undefined,'cross-site','nas.example.com',true)).toBe(false);
  });
  it('supports loopback HTTP only in explicit local mode', () => {
    expect(allowedMutationOrigin('http://localhost:8090','same-origin','localhost:8090',false)).toBe(true);
    expect(allowedMutationOrigin('http://localhost:8091','same-origin','localhost:8090',false)).toBe(false);
  });
});
