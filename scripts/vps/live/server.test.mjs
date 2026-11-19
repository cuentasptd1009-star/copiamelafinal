import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLiveServer, segmentBandwidth } from './server.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

test('bitrate metadata separates weighted average consumption from peak headroom', () => {
  assert.deepEqual(segmentBandwidth([2, 6], [250000, 1500000]), { bandwidth: 2500000, averageBandwidth: 1750000 });
  assert.throws(() => segmentBandwidth([], []));
  assert.throws(() => segmentBandwidth([2, 0], [100, 100]));
  assert.throws(() => segmentBandwidth([2], [100, 200]));
});

test('authenticated viewers share a bounded adaptive encoder with repaired timestamps, original video and private playlists', { timeout: 90000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'supertv-live-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = path.join(root, 'input.m3u8');
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-bf', '2',
    '-threads', '1', '-b:v', '2000k', '-g', '50', '-sc_threshold', '0', '-c:a', 'aac', '-f', 'hls', '-hls_time', '10', '-hls_list_size', '0', fixture], { timeout: 30000 });
  assert.equal(generated.status, 0, generated.stderr?.toString());
  { // Model an unannounced backwards jump in the source TS clock.
    const shifted = path.join(root, 'shifted.ts');
    const reset = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-copyts','-itsoffset','-3','-i',path.join(root,'input2.ts'),'-map','0','-c','copy','-mpegts_copyts','1','-f','mpegts',shifted]);
    assert.equal(reset.status,0,reset.stderr?.toString());
    await writeFile(path.join(root,'input2.ts'),await readFile(shifted));
  }
  const playlist = (await readFile(fixture, 'utf8')).replace('#EXT-X-ENDLIST', '');
  let backendBase;
  let thirdViewerAuthorizations = 0;
  let playbackManifestStarted = null;
  const backend = http.createServer(async (req, res) => {
    if (req.url === '/api/channels') {
      if (req.headers.authorization === 'Bearer viewer-three') { thirdViewerAuthorizations++; await new Promise(resolve => setTimeout(resolve, 50)); }
      if (!['Bearer viewer-one', 'Bearer viewer-two', 'Bearer viewer-three'].includes(req.headers.authorization)) { res.writeHead(401); res.end(); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([1, 2].map(id => ({ id, streamUrl: `${backendBase}/input.m3u8` })))); return;
    }
    if (req.url === '/input.m3u8') {
      // The newest segment alone has ten seconds: publish another on the next live reload.
      // This verifies a fresh-edge ingest still waits for a genuine twelve-second reserve.
      playbackManifestStarted ??= Date.now(); res.end(Date.now() - playbackManifestStarted < 2500 ? playlist.slice(0, playlist.lastIndexOf('#EXTINF')) : playlist);
      return;
    }
    if (/^\/input\d+\.ts$/.test(req.url)) { res.end(await readFile(path.join(root, req.url.slice(1)))); return; }
    res.writeHead(404); res.end();
  });
  backendBase = await listen(backend);
  t.after(() => new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve); }));
  const live = createLiveServer({ apiBase: backendBase, directory: path.join(root, 'output'), allowed: new Set([1]), idleMs: 1000, warmupMs: 30000 });
  const base = await listen(live.server); t.after(() => live.close());
  assert.equal((await fetch(`${base}/api/live/channels/1/master.m3u8`)).status, 401);
  assert.equal(live.jobs.size, 0);
  const [a, b] = await Promise.all(['viewer-one', 'viewer-two'].map(token => fetch(`${base}/api/live/channels/1/master.m3u8?token=${token}`, { redirect: 'manual' })));
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const [first, second] = await Promise.all([a.text(), b.text()]);
  assert.equal(live.jobs.size, 1);
  assert.match(first, /RESOLUTION=640x360/); assert.match(first, /RESOLUTION=854x480/);
  assert.match(first, /TIME-OFFSET=-6/);
  for (const line of first.split('\n').filter(line => line.startsWith('#EXT-X-STREAM-INF:'))) {
    const peak = Number(/(?:[:,])BANDWIDTH=(\d+)/.exec(line)?.[1]);
    const average = Number(/AVERAGE-BANDWIDTH=(\d+)/.exec(line)?.[1]);
    assert.ok(average > 0 && average <= peak, line);
    if (line.includes('NAME="SuperTV Original')) {
      assert.ok(peak >= live.jobs.get(1).profile.bandwidth);
      assert.ok(average >= Math.ceil(live.jobs.get(1).profile.bandwidth / 1.3));
    }
  }
  assert.ok(first.includes('viewer-one') && !first.includes('viewer-two'));
  assert.ok(second.includes('viewer-two') && !second.includes('viewer-one'));
  for(let i=0;i<10;i++){ await fetch(`${base}/api/live/channels/1/master.m3u8?token=viewer-one`); await new Promise(resolve=>setTimeout(resolve,500)); }
  const starts = []; const durationsByLevel = []; let firstSegmentUrl;
  const variants = first.split('\n').filter(line => line.startsWith('/api/'));
  for (const [i, variant] of variants.entries()) {
    const response = await fetch(base + variant); assert.equal(response.status, 200);
    const body = await response.text();
    const durations = [...body.matchAll(/#EXTINF:([\d.]+)/g)].map(m => Number(m[1]));
    assert.ok(durations.reduce((a, b) => a + b, 0) >= 8);
    durationsByLevel.push(durations);
    const encoded = await readFile(path.join(live.jobs.get(1).directory, ['360p','480p','720p','original'][i], 'index.m3u8'),'utf8');
    const encodedDuration = [...encoded.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum,m)=>sum+Number(m[1]),0);
    assert.ok(encodedDuration>=17.9,'source timestamp reset must not discard three seconds of footage');
    const segment = body.split('\n').find(line => line.startsWith('/api/'));
    const unauthorized = await fetch(base + segment.replace('viewer-one', 'expired-viewer')); assert.equal(unauthorized.status, 401);
    const video = await fetch(base + segment); assert.equal(video.status, 200);
    if (i === 0) {
      firstSegmentUrl = base + segment;
      const viewers = await Promise.all(Array.from({length:50}, () => fetch(base + segment).then(async r => ({status:r.status,size:(await r.arrayBuffer()).byteLength}))));
      assert.ok(viewers.every(v=>v.status===200 && v.size>0)); assert.equal(live.jobs.size,1);
    }
    const file = path.join(root, `encoded-${i}.ts`); await writeFile(file, Buffer.from(await video.arrayBuffer()));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]);
    const stream = JSON.parse(probe.stdout).streams[0]; assert.equal(stream.height, [360,480,720,1080][i]);
    const timestamps = spawnSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','packet=pts_time,flags','-of','json',file]);
    const keyframe = JSON.parse(timestamps.stdout).packets.find(p=>p.flags.includes('K')); starts.push(Number(keyframe.pts_time));
  }
  const simultaneous = await Promise.all(Array.from({length:50}, () => fetch(`${base}/api/live/channels/1/status?token=viewer-three`)));
  assert.ok(simultaneous.every(r => r.status === 200));
  assert.equal(thirdViewerAuthorizations, 1, 'parallel media requests share one session authorization lookup');
  assert.equal(variants.length, 4);
  assert.ok(Math.max(...starts)-Math.min(...starts) < 0.08, JSON.stringify({starts,durationsByLevel}));
  assert.ok(durationsByLevel.every(d=>Math.abs(d[0]-durationsByLevel[0][0])<0.08), JSON.stringify(durationsByLevel));
  const other = await fetch(`${base}/api/live/channels/2/master.m3u8?token=viewer-one`, { redirect: 'manual' });
  assert.equal(other.status, 302); assert.match(other.headers.get('location'), /\/api\/channels\/2\/hls-proxy/);
  assert.equal(live.jobs.size, 1);
  await new Promise(resolve => setTimeout(resolve, 6500));
  assert.equal(live.jobs.size, 0, 'encoder stops when viewers leave');
  const retired = await fetch(base + variants[0], { redirect: 'manual' });
  assert.equal(retired.status,302,'existing viewers can recover through the original playlist after retirement');
  assert.match(retired.headers.get('location'), /hls-proxy/);
  assert.equal((await fetch(firstSegmentUrl)).status,200,'already published segments survive the retirement grace period');

  // A populated HLS window is insufficient when the encoder cannot replenish it in real time.
  playbackManifestStarted = null;
  const slow = createLiveServer({ apiBase: backendBase, directory: path.join(root, 'slow-output'), allowed: new Set([1]), warmupMs: 18000 });
  const slowBase = await listen(slow.server); t.after(() => slow.close());
  const guarded = setInterval(() => {
    const job = slow.jobs.get(1);
    if (job && !Object.getOwnPropertyDescriptor(job, 'recentSpeed')?.get) Object.defineProperty(job, 'recentSpeed', { get: () => 0.5, set() {}, configurable: true });
  }, 1);
  try {
    const response = await fetch(`${slowBase}/api/live/channels/1/master.m3u8?token=viewer-one`, { redirect: 'manual' });
    assert.equal(response.status, 302, 'a half-speed encoder must use the original stream');
    assert.match(response.headers.get('location'), /hls-proxy/);
  } finally { clearInterval(guarded); }
});

for (const originalOnly of [false, true]) {
test(`admin persists the ${originalOnly ? 'six-channel Original' : 'five-channel adaptive'} configuration`, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'supertv-live-config-'));
  const stateFile = path.join(root, 'channels.json');
  t.after(() => rm(root, { recursive: true, force: true }));
  let segmentReads = 0;
  const backend = http.createServer((req, res) => {
    if (req.url === '/input.m3u8') { res.end('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n/part.ts\n'); return; }
    if (req.url === '/part.ts') { segmentReads++; res.end(Buffer.alloc(376, 0x47)); return; }
    const admin = req.headers.authorization === 'Bearer administrator';
    const viewer = req.headers.authorization === 'Bearer viewer-one';
    if (!admin && !viewer) { res.writeHead(401); res.end(); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/auth/me') res.end(JSON.stringify({ type: admin ? 'admin' : 'user', role: admin ? 'admin' : null }));
    else res.end(JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ id: i === 5 ? 412 : i + 1, streamUrl: `${apiBase}/input.m3u8`, streamFormat: 'hls' }))));
  });
  const apiBase = await listen(backend);
  t.after(() => new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve); }));
  const options = { apiBase, directory: path.join(root, 'output'), stateFile, originalOnly, maxChannels: 0, allowPrivateOrigins: true, lookupChannel: async id => ({ id, streamUrl: `${apiBase}/input.m3u8` }) };
  let live = createLiveServer(options);
  let base = await listen(live.server);
  t.after(() => live.close());
  const headers = { Authorization: 'Bearer administrator', 'Content-Type': 'application/json' };
  const change = (id, enabled, authorization = headers) => fetch(`${base}/api/live/admin/channels/${id}`, {
    method: 'PUT', headers: authorization, body: JSON.stringify({ enabled }),
  });
  assert.equal((await change(1, true, { ...headers, Authorization: 'Bearer viewer-one' })).status, 403);
  assert.equal((await fetch(`${base}/api/live/admin/config`)).status, 401);
  const changes = await Promise.all([change(1, true), change(2, true)]);
  assert.ok(changes.every(response => response.status === 200));
  for (const id of [3, 4, 5]) assert.equal((await change(id, true)).status, 200);
  assert.equal((await change(412, true)).status, originalOnly ? 200 : 409);
  assert.equal((await change(7, true)).status, 409);
  const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.deepEqual(persisted.enabledChannelIds.sort(), originalOnly ? [1, 2, 3, 4, 412, 5].sort() : [1, 2, 3, 4, 5]);
  assert.equal((await change(1, false)).status, 200);
  const issue = () => fetch(`${base}/api/live/admin/channels/1/link`, { method: 'POST', headers, body: '{}' });
  const issued = await (await issue()).json();
  const relative = value => { const u = new URL(value); return u.pathname + u.search; };
  const publicPath = relative(issued.url);
  const retiredExternal = await fetch(base + publicPath.replace('master.m3u8','old-0123abcd/original/index.m3u8'));
  assert.equal(retiredExternal.status,200,'external clients can follow the original playlist after a conversion ends');
  const stream = await fetch(base + publicPath); assert.equal(stream.status, 200);
  const manifest = await stream.text();
  assert.ok(manifest.includes('key=') && !manifest.includes('administrator'));
  const segmentPath = manifest.split('\n').find(line => line.startsWith('/api/'));
  const viewers = await Promise.all(Array.from({ length: 50 }, () => fetch(base + segmentPath).then(async response => ({ status: response.status, size: (await response.arrayBuffer()).byteLength }))));
  assert.ok(viewers.every(v => v.status === 200 && v.size === 376));
  assert.equal(segmentReads, 1, 'fifty external viewers share the same origin download');
  const tampered = new URL(base + segmentPath); tampered.searchParams.set('s', Buffer.from('http://127.0.0.1:1/secret').toString('base64url'));
  assert.equal((await fetch(tampered)).status, 403);
  const renewed = await (await fetch(`${base}/api/live/admin/channels/1/link`, { method: 'POST', headers, body: '{"renew":true}' })).json();
  assert.notEqual(renewed.url, issued.url);
  assert.equal((await fetch(base + publicPath)).status, 401);
  assert.equal((await fetch(base + relative(renewed.url))).status, 200);
  await fetch(`${base}/api/live/admin/channels/1/link`, { method: 'DELETE', headers });
  assert.equal((await fetch(base + relative(renewed.url))).status, 401);
  const durable = await (await issue()).json();
  await live.close();
  live = createLiveServer(options);
  await live.ready; base = await listen(live.server);
  const restored = await (await fetch(`${base}/api/live/admin/config`, { headers })).json();
  assert.equal(restored.maxSelectedChannels, originalOnly ? 6 : 5);
  assert.equal(restored.originalOnly, originalOnly);
  assert.deepEqual(restored.enabledChannelIds.sort(), originalOnly ? [2, 3, 4, 412, 5].sort() : [2, 3, 4, 5]);
  assert.equal((await fetch(base + relative(durable.url))).status, 200, 'external link survives a service restart');
  const original = await fetch(`${base}/api/live/channels/1/master.m3u8?token=viewer-one`, { redirect: 'manual' });
  assert.equal(original.status, 302);
  const disabledStatus = await (await fetch(`${base}/api/live/channels/1/status?token=viewer-one`)).json();
  assert.equal(disabledStatus.enabled, false);
});
}
