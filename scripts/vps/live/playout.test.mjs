import test from 'node:test';
import assert from 'node:assert/strict';
import { playoutPlaylist } from './playout.mjs';

const start=Date.parse('2026-01-01T00:00:00Z');
const playlist=(first=50)=>'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:'+first+'\n'+Array.from({length:4},(_,i)=>`#EXTINF:2,\n#EXT-X-PROGRAM-DATE-TIME:${new Date(start+i*2000).toISOString()}\nseg_${String(first+i).padStart(8,'0')}.ts\n`).join('')+'#EXT-X-ENDLIST\n';

test('a burst of cached segments becomes visible on the reserved playout clock',()=>{
 const text=playlist();
 assert.equal((playoutPlaylist(text,start+5999).match(/^seg_/gm)||[]).length,0);
 assert.equal((playoutPlaylist(text,start+6000).match(/^seg_/gm)||[]).length,1);
 assert.equal((playoutPlaylist(text,start+8000).match(/^seg_/gm)||[]).length,2);
 assert.equal((playoutPlaylist(text,start+10000).match(/^seg_/gm)||[]).length,3);
 assert.ok(!playoutPlaylist(text,start+10000).includes('#EXT-X-ENDLIST'));
 const complete=playoutPlaylist(text,start+12000);
 assert.equal((complete.match(/^seg_/gm)||[]).length,4);
 assert.ok(complete.includes('#EXT-X-ENDLIST'));
 assert.ok(complete.includes('#EXT-X-MEDIA-SEQUENCE:50'));
});
