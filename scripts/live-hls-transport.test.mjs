import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../artifacts/super-tv/src/lib/live-hls-transport.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { removeLeadingPictures, createLiveFragmentTransport } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const wrap = 2 ** 33;
const open = [0,0,1,0x67,0x42,0,30,0,0,1,0x68,0xce,0,0,1,0x41,0xb8];
const idr = [0,0,1,0x67,0x42,0,30,0,0,1,0x68,0xce,0,0,1,0x65,0xb8];
function packet(pts, nal = [0,0,1,0x41,0xe0], pid = 256, stream = 0xe0) {
  const p = new Uint8Array(188).fill(0xff);
  p.set([0x47, 0x40 | (pid >> 8), pid & 255, 0x10]);
  const n = BigInt((pts + wrap) % wrap);
  const t = [Number((n >> 29n) & 14n) | 0x21, Number((n >> 22n) & 255n), Number((n >> 14n) & 254n) | 1, Number((n >> 7n) & 255n), Number((n << 1n) & 254n) | 1];
  p.set([0,0,1,stream,0,0,0x80,0x80,5,...t,...nal],4);return p;
}
const join = (...packets) => Uint8Array.from(packets.flatMap(p => [...p])).buffer;
test('open-GOP entry discards unavailable leading pictures while preserving audio and later video', () => {
  const first = packet(18000, open), leading = packet(12000), audio = packet(10000, [1,2,3], 257, 0xc0), later = packet(21000);
  const result = removeLeadingPictures(join(first, leading, audio, later));
  assert.equal(result.removedPackets,1);assert.deepEqual(result.data,join(first,audio,later));
});
test('IDR starts, ordinary video, malformed data and encrypted bytes are unchanged', () => {
  for (const buffer of [join(packet(18000,idr),packet(12000)), join(packet(18000),packet(21000)),new Uint8Array(376).buffer,new Uint8Array(189).buffer]) {
    const result=removeLeadingPictures(buffer);assert.equal(result.data,buffer);assert.equal(result.removedPackets,0);
  }
});
test('timestamp rollover retains the same leading-picture decision', () => {
  const first=packet(3000,open), leading=packet(wrap-3000), later=packet(6000);
  assert.deepEqual(removeLeadingPictures(join(first,leading,later)).data,join(first,later));
});
test('continuous fragments are untouched; a new decoder, discontinuity or rendition is normalized again', () => {
  class Loader { load(ctx,config,cb) { cb.onSuccess({data:ctx.data},{},ctx,null); } }
  const transport=createLiveFragmentTransport({DefaultConfig:{loader:Loader}});
  const data=join(packet(18000,open),packet(12000),packet(21000));
  const load=(cc=0,level=0,type='main')=>{let result;new transport.fLoader().load({data,frag:{type,sn:1,cc,level}}, {}, {onSuccess:r=>result=r.data});return result;};
  assert.notEqual(load().byteLength,data.byteLength);
  assert.equal(load(),data); // Preserve references across normal GOP boundaries.
  assert.equal(load(0,0,'audio'),data);
  assert.notEqual(load(1).byteLength,data.byteLength);
  assert.notEqual(load(1,1).byteLength,data.byteLength);
  transport.reset();assert.notEqual(load().byteLength,data.byteLength);
});

test('failed-media retries back off and pending retries are cancelled when the channel closes', async () => {
  const { createLiveMediaRecovery } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  const originalSet=globalThis.setTimeout, originalClear=globalThis.clearTimeout;
  const pending=new Map();let id=0, stops=0, recovered=0;const delays=[];
  globalThis.setTimeout=(fn,delay)=>{delays.push(delay);pending.set(++id,fn);return id;};
  globalThis.clearTimeout=id=>pending.delete(id);
  try {
    const recovery=createLiveMediaRecovery({stopLoad(){stops++;},recoverMediaError(){recovered++;}});
    for(let i=0;i<8;i++) { recovery.recover();recovery.recover();assert.equal(pending.size,1);const [key,fn]=pending.entries().next().value;pending.delete(key);fn(); }
    assert.deepEqual(delays,[0,0,1000,2000,4000,8000,15000,15000]);assert.equal(recovered,8);assert.equal(stops,8);
    recovery.recover();recovery.destroy();assert.equal(pending.size,0);
  } finally {globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test('a non-keyframe prefix does not hide the first open-GOP entry point', () => {
  const prefix=packet(9000),first=packet(18000,open),leading=packet(12000),later=packet(21000);
  assert.deepEqual(removeLeadingPictures(join(prefix,first,leading,later)).data,join(prefix,first,later));
});
