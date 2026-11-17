// Bounded private check: no production configuration changes or public endpoint.
import { spawn } from 'node:child_process';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHlsInput } from './ingest.mjs';
import { createChannelLookup } from './sharing.mjs';
import { probeSource, renditionsFor, ffmpegArguments } from './server.mjs';
const id = Number(process.argv[2]);
const seconds = Math.max(30, Math.min(600, Number(process.argv[3]) || 240));
if (!Number.isSafeInteger(id) || id <= 0) throw new Error('A channel ID is required');
const database = createChannelLookup();
const directory = `/var/cache/supertv-live-diagnostic-${process.pid}`;
let child, reporter, timer, force, input;
function edgeOf(text) {
  let date = NaN, duration = 0, edge = NaN;
  for (const line of text.split('\n')) {
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) date = Date.parse(line.slice(25));
    else if (line.startsWith('#EXTINF:')) duration = Number.parseFloat(line.slice(8));
    else if (/^seg_\d+\.ts$/.test(line.trim()) && Number.isFinite(date)) edge = date + duration * 1000;
  }
  return edge;
}
try {
  const channel = await database.get(id);
  if (!channel) throw new Error('Channel unavailable');
  let sample;
  try { input = await createHlsInput(channel.streamUrl); sample = await input.peek(); } catch { input?.close(); input = null; }
  const profile = await probeSource(sample || channel.streamUrl); sample = null;
  const renditions = renditionsFor(profile);
  console.log(JSON.stringify({ profile: { width: profile.width, height: profile.height, fps: profile.fps }, seconds }));
  await Promise.all(renditions.map(r => mkdir(path.join(directory, r.name), { recursive: true, mode: 0o700 })));
  const started = Date.now(); let text = '', latest = {}, firstEdge;
  const warnings = { clock: 0, network: 0, decode: 0, other: 0 }; let lastWarning = '';
  const args = ffmpegArguments(input ? 'pipe:0' : channel.streamUrl, directory, profile, renditions);
  args[args.indexOf('-loglevel') + 1] = 'warning';
  child = spawn('python3', [fileURLToPath(new URL('./ffmpeg-child.py', import.meta.url)), String(process.pid), 'ffmpeg', ...args], {stdio:[input ? 'pipe' : 'ignore','ignore','pipe','pipe']});
  input?.pipeTo(child.stdin).catch(() => child.kill('SIGTERM'));
  child.stderr.on('data', bytes => {
    for (const line of bytes.toString().split('\n').filter(Boolean)) {
      const category = /timestamp|monoton|dts|pts|discontin|continuity/i.test(line) ? 'clock' : /HTTP|connection|TLS|SSL|timed out|reload/i.test(line) ? 'network' : /decod|NAL|corrupt|damag/i.test(line) ? 'decode' : 'other';
      warnings[category]++; lastWarning = line.replace(/https?:\/\/[^\s]+/g, '[origin]').slice(-500);
    }
  });
  child.stdio[3].on('data', bytes => {
    text += bytes.toString(); const lines = text.split('\n'); text = lines.pop() || '';
    for (const line of lines) { const at = line.indexOf('='); if (at > 0) latest[line.slice(0, at)] = line.slice(at + 1); }
  });
  reporter = setInterval(async () => {
    const wall = (Date.now() - started) / 1000; let edge = NaN;
    try { edge = edgeOf(await readFile(path.join(directory, 'original', 'index.m3u8'), 'utf8')); } catch {}
    if (!firstEdge && Number.isFinite(edge)) firstEdge = { edge, wall };
    console.log(JSON.stringify({ wall: +wall.toFixed(1), media: Number(latest.out_time_us) / 1e6, ffmpegSpeed: latest.speed,
      publishedRate: firstEdge && wall > firstEdge.wall ? +((edge - firstEdge.edge) / ((wall - firstEdge.wall) * 1000)).toFixed(3) : null,
      input: input ? {...input.stats} : null, warnings, lastWarning }));
  }, 10000);
  timer = setTimeout(() => child.kill('SIGTERM'), seconds * 1000);
  force = setTimeout(() => child.kill('SIGKILL'), (seconds + 8) * 1000);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => child.kill('SIGTERM'));
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  console.log(JSON.stringify({ exit: code, elapsed: +((Date.now() - started) / 1000).toFixed(1), warnings, lastWarning }));
} finally {
  clearInterval(reporter); clearTimeout(timer); clearTimeout(force);
  input?.close(); child?.kill('SIGTERM'); await database.close(); await rm(directory, { recursive: true, force: true });
}
