import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createHlsInput, parseMediaPlaylist } from './ingest.mjs';

const media = (first, count) => '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:'+first+'\n'+Array.from({length:count},(_,i)=>`#EXTINF:2,\npart${first+i}.ts\n`).join('');

test('ingest resolves source windows and rejects unsupported encryption before reading media', async () => {
  const parsed = parseMediaPlaylist(media(10,3),'https://source.invalid/live/index.m3u8');
  assert.equal(parsed.segments.at(-1).seq,12);
  assert.equal(parsed.segments[0].url,'https://source.invalid/live/part10.ts');
  for (const tag of ['#EXT-X-KEY:METHOD=AES-128,URI="secret"','#EXT-X-MAP:URI="init.mp4"','#EXT-X-BYTERANGE:100@0']) {
    assert.throws(()=>parseMediaPlaylist(media(1,1)+tag+'\n','https://source.invalid/index.m3u8'));
  }
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nhigh.m3u8\n';
  assert.equal(parseMediaPlaylist(master,'https://source.invalid/index.m3u8').variant,'https://source.invalid/high.m3u8');
  assert.throws(()=>parseMediaPlaylist(master+'#EXT-X-MEDIA:URI="audio.m3u8",TYPE=AUDIO\n','https://source.invalid/index.m3u8'));
});

test('ingest starts at the newest segment, prefetches in parallel and feeds bytes in sequence', {timeout:5000}, async () => {
  let playlists=0, active=0, maxActive=0; const requested=[];
  const fetcher=async url=>{
    if(url.endsWith('.m3u8'))return new Response(++playlists===1?media(10,3):media(11,5));
    const seq=Number(/part(\d+)\.ts/.exec(url)[1]);requested.push(seq);active++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setTimeout(resolve,seq===12?40:5));active--;
    const bytes=Buffer.alloc(376);bytes[0]=bytes[188]=0x47;bytes[1]=seq;return new Response(bytes);
  };
  const input=await createHlsInput('https://source.invalid/index.m3u8',{fetcher});
  const received=[];
  const sink=new Writable({write(bytes,encoding,done){received.push(bytes[1]);done();if(received.length===3)input.close();}});
  try {
    await input.pipeTo(sink);
    assert.deepEqual(received,[12,13,14]);
    assert.ok(!requested.includes(10)&&!requested.includes(11));
    assert.ok(maxActive<=2);
    assert.equal(input.stats.queuedBytes,0);
  }finally{input.close();sink.destroy();}
});

test('ingest rejects incomplete transport packets instead of feeding a partial segment', async () => {
  const bytes=Buffer.alloc(377);bytes[0]=bytes[188]=0x47;
  const input=await createHlsInput('https://source.invalid/index.m3u8',{fetcher:async url=>new Response(url.endsWith('.m3u8')?media(0,1):bytes)});
  try { await assert.rejects(input.peek(),/MPEG-TS/); } finally { input.close(); }
});
