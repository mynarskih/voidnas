import { describe, expect, it } from 'vitest';
import { parseByteRange } from '../src/lib/range.js';

describe('HTTP byte ranges', () => {
  it('reads a normal interval', () => expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 }));
  it('reads from an offset to the end', () => expect(parseByteRange('bytes=95-', 100)).toEqual({ start: 95, end: 99 }));
  it('reads the final N bytes', () => expect(parseByteRange('bytes=-3', 100)).toEqual({ start: 97, end: 99 }));
  it('caps an oversized suffix at the file size', () => expect(parseByteRange('bytes=-200', 100)).toEqual({ start: 0, end: 99 }));
  it('rejects malformed or unsatisfiable ranges', () => {
    for (const input of ['bytes=-0', 'bytes=-', 'bytes=100-', 'bytes=40-20', 'bytes=0-1,3-4', 'bytes=999999999999999999999-']) {
      expect(parseByteRange(input, 100)).toBeNull();
    }
  });
});
