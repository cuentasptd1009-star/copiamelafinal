import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLiveServer } from './server.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

test('authenticated viewers share a bounded two-quality encoder and private playlists', { timeout: 60000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'supertv-live-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = path.join(root, 'input.m3u8');
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-threads', '1', '-b:v', '2000k', '-g', '250', '-sc_threshold', '0', '-c:a', 'aac', '-f', 'hls', '-hls_time', '10', '-hls_list_size', '0', fixture], { timeout: 30000 });
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const playlist = (await readFile(fixture, 'utf8')).replace('#EXT-X-ENDLIST', '');
  let backendBase;
  const backend = http.createServer(async (req, res) => {
    if (req.url === '/api/channels') {
      if (!['Bearer viewer-one', 'Bearer viewer-two'].includes(req.headers.authorization)) { res.writeHead(401); res.end(); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([1, 2].map(id => ({ id, streamUrl: `${backendBase}/input.m3u8` })))); return;
    }
    if (req.url === '/input.m3u8') { res.end(playlist); return; }
    if (/^\/input\d+\.ts$/.test(req.url)) { res.end(await readFile(path.join(root, req.url.slice(1)))); return; }
    res.writeHead(404); res.end();
  });
  backendBase = await listen(backend);
  t.after(() => new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve); }));
  const live = createLiveServer({ apiBase: backendBase, directory: path.join(root, 'output'), allowed: new Set([1]), idleMs: 1000, warmupMs: 30000 });
  const base = await listen(live.server); t.after(() => live.close());
  assert.equal((await fetch(`${base}/api/live/channels/1/master.m3u8`)).status, 401);
  assert.equal(live.jobs.size, 0);
  const [a, b] = await Promise.all(['viewer-one', 'viewer-two'].map(token => fetch(`${base}/api/live/channels/1/master.m3u8?token=${token}`)));
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const [first, second] = await Promise.all([a.text(), b.text()]);
  assert.equal(live.jobs.size, 1);
  assert.match(first, /RESOLUTION=640x360/); assert.match(first, /RESOLUTION=854x480/);
  assert.match(first, /TIME-OFFSET=-10/);
  assert.ok(first.includes('viewer-one') && !first.includes('viewer-two'));
  assert.ok(second.includes('viewer-two') && !second.includes('viewer-one'));
  const variants = first.split('\n').filter(line => line.startsWith('/api/'));
  for (const [i, variant] of variants.entries()) {
    const response = await fetch(base + variant); assert.equal(response.status, 200);
    const body = await response.text();
    const durations = [...body.matchAll(/#EXTINF:([\d.]+)/g)].map(m => Number(m[1]));
    assert.ok(durations.reduce((a, b) => a + b, 0) >= 12);
    const segment = body.split('\n').find(line => line.startsWith('/api/'));
    const unauthorized = await fetch(base + segment.replace('viewer-one', 'expired-viewer')); assert.equal(unauthorized.status, 401);
    const video = await fetch(base + segment); assert.equal(video.status, 200);
    const file = path.join(root, `encoded-${i}.ts`); await writeFile(file, Buffer.from(await video.arrayBuffer()));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]);
    const stream = JSON.parse(probe.stdout).streams[0]; assert.equal(stream.height, i === 0 ? 360 : 480);
  }
  const other = await fetch(`${base}/api/live/channels/2/master.m3u8?token=viewer-one`, { redirect: 'manual' });
  assert.equal(other.status, 302); assert.match(other.headers.get('location'), /\/api\/channels\/2\/hls-proxy/);
  assert.equal(live.jobs.size, 1);
  await new Promise(resolve => setTimeout(resolve, 6500));
  assert.equal(live.jobs.size, 0, 'encoder stops when viewers leave');
});
