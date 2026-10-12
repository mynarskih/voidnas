import { describe, expect, it } from 'vitest';
import { decodeText, MAX_TEXT_BYTES, textVersion } from '../src/lib/text-files.js';

describe('bounded UTF-8 text editor',()=>{
  it('preserves Polish text, BOM and CRLF',()=>{
    const text='\ufeffZażółć gęślą jaźń\r\n';
    expect(decodeText(Buffer.from(text))).toBe(text);
  });
  it('rejects binary contents even with text MIME',()=>expect(()=>decodeText(Buffer.from([77,90,0,1]))).toThrow('binary'));
  it('rejects invalid UTF-8 rather than corrupting it',()=>expect(()=>decodeText(Buffer.from([0xc3,0x28]))).toThrow('UTF-8'));
  it('limits byte count, not only characters',()=>expect(()=>decodeText(Buffer.alloc(MAX_TEXT_BYTES+1,65))).toThrow('1 MB'));
  it('uses content versions to detect concurrent edits',()=>{
    expect(textVersion(Buffer.from('first'))).toBe(textVersion(Buffer.from('first')));
    expect(textVersion(Buffer.from('first'))).not.toBe(textVersion(Buffer.from('second')));
  });
});
