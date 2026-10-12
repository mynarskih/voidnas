import { describe, expect, it } from 'vitest';
import { serialize } from '../src/lib/serialize.js';

describe('API serialization', () => {
  it('never exposes storage paths or hashed authentication secrets in nested results', () => {
    expect(serialize({ items: [{ id: 'id', storagePath: 'private', owner: { username: 'alice', passwordHash: 'hash', tokenHash: 'token', csrfHash: 'csrf' }, temporaryPath: 'part' }] })).toEqual({ items: [{ id: 'id', owner: { username: 'alice' } }] });
  });
  it('preserves dates and large file sizes in nested rows', () => {
    const updatedAt = new Date('2026-09-25T16:51:36.946Z');
    expect(serialize({ items: [{ updatedAt, size: 20n * 1024n ** 3n }] })).toEqual({
      items: [{ updatedAt: '2026-09-25T16:51:36.946Z', size: '21474836480' }]
    });
  });
});
