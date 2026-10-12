import {describe,it,expect} from 'vitest';
import {Readable,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {settingsSchema,defaultSettings} from '../src/lib/admin-settings.js';
import {acquireTransfer,TransferThrottle} from '../src/lib/transfers.js';
import {previewKind} from '../src/lib/previews.js';

describe('Operational settings and bounded transfers',()=>{
  it('never enables destructive retention by default',()=>expect(settingsSchema.parse(defaultSettings).trashRetentionDays).toBeNull());
  it('validates retention, speed, thresholds and concurrency',()=>{
    for(const change of [{trashRetentionDays:1},{uploadBytesPerSecond:1},{maxConcurrentTransfers:0},{storageWarningPercent:100},{ownerId:'untrusted'},{backupMaxAgeHours:0}])expect(settingsSchema.safeParse({...defaultSettings,...change}).success).toBe(false);
    expect(settingsSchema.parse({...defaultSettings,trashRetentionDays:30,uploadBytesPerSecond:65536}).trashRetentionDays).toBe(30);
  });
  it('limits simultaneous streams independently and releases only once',()=>{
    const release=acquireTransfer('test-first',1);expect(()=>acquireTransfer('test-first',1)).toThrow('Concurrent transfer');
    const other=acquireTransfer('test-other',1);other();release();release();const again=acquireTransfer('test-first',1);again();
  });
  it('throttles with backpressure and preserves exact bytes',async()=>{
    const chunks:Buffer[]=[];const start=performance.now();
    await pipeline(Readable.from([Buffer.alloc(1024,65)]),new TransferThrottle(10240),new Writable({write(chunk,_encoding,next){chunks.push(chunk);next()}}));
    expect(performance.now()-start).toBeGreaterThanOrEqual(85);expect(Buffer.concat(chunks)).toEqual(Buffer.alloc(1024,65));
  });
  it('destroys waiting throttles without retaining timers',async()=>{
    const throttle=new TransferThrottle(1024);throttle.on('error',()=>{});throttle.write(Buffer.alloc(1024));throttle.destroy();expect(throttle.destroyed).toBe(true);
  });
});
describe('Safe preview kinds',()=>{
  it('allows only validated raster/media/PDF signatures',()=>{
    expect(previewKind('image/png','image.exe')).toBe('image');expect(previewKind('application/pdf','document.pdf')).toBe('pdf');expect(previewKind('audio/mpeg','song.mp3')).toBe('audio');expect(previewKind('video/mp4','clip.mp4')).toBe('video');
  });
  it('never treats executable markup as inline image or document',()=>{
    expect(previewKind('image/svg+xml','evil.svg')).toBeNull();expect(previewKind('text/html','evil.html')).toBeNull();
    expect(previewKind(undefined,'evil.html')).toBe('text');expect(previewKind(undefined,'evil.svg')).toBe('text');expect(previewKind(undefined,'spoofed.png')).toBeNull();
  });
});
