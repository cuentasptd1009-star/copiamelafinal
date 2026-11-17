// Isolated, bounded capacity check. Does not enable channels or modify production config.
import { spawn } from 'node:child_process';
import { mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createChannelLookup } from './sharing.mjs';
import { probeSource, renditionsFor, ffmpegArguments } from './server.mjs';
const id = Number(process.argv[2]);
const seconds = Math.max(30, Math.min(600, Number(process.argv[3]) || 240));
if (!Number.isSafeInteger(id) || id <= 0) throw new Error('A channel ID is required');
const database = createChannelLookup();
const directory = `/var/cache/supertv-live-diagnostic-${process.pid}`;
let child;
try {
  const channel = await database.get(id);
  if (!channel) throw new Error('Channel unavailable');
  const profile = await probeSource(channel.streamUrl);
  const renditions = renditionsFor(profile);
  console.log(JSON.stringify({ profile: { width: profile.width, height: profile.height, fps: profile.fps }, seconds }));
  await Promise.all(renditions.map(r => mkdir(path.join(directory, r.name), { recursive: true, mode: 0o700 })));
  const started = Date.now(); let text = ''; let latest = {}; let firstMedia; let lastReport = 0;
  child = spawn('nice', ['-n', '10', 'ffmpeg', ...ffmpegArguments(channel.streamUrl, directory, profile, renditions)], {stdio:['ignore','ignore','ignore','pipe']});
  child.stdio[3].on('data', bytes => {
    text += bytes.toString(); const lines = text.split('\n'); text = lines.pop() || '';
    for (const line of lines) {
      const at = line.indexOf('='); if (at < 0) continue;
      latest[line.slice(0, at)] = line.slice(at + 1);
      if (line.startsWith('progress=')) {
        const wall = (Date.now() - started) / 1000; const media = Number(latest.out_time_us) / 1e6;
        if (!firstMedia && media > 0) firstMedia = { wall, media };
        if (wall - lastReport >= 10) {
          lastReport = wall;
          console.log(JSON.stringify({ wall: +wall.toFixed(1), media: +media.toFixed(1), speed: latest.speed,
            runningRate: firstMedia && wall > firstMedia.wall ? +((media-firstMedia.media)/(wall-firstMedia.wall)).toFixed(3) : null }));
        }
      }
    }
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), seconds * 1000);
  const force = setTimeout(() => child.kill('SIGKILL'), (seconds + 8) * 1000);
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  clearTimeout(timer); clearTimeout(force);
  for (const r of renditions) {
    try { const list = await readFile(path.join(directory,r.name,'index.m3u8'),'utf8'); console.log(JSON.stringify({ rendition:r.name,segments:[...list.matchAll(/^#EXTINF:/gm)].length })); } catch {}
  }
  console.log(JSON.stringify({ exit:code, elapsed:+((Date.now()-started)/1000).toFixed(1) }));
} finally {
  child?.kill('SIGTERM'); await database.close(); await rm(directory,{ recursive:true, force:true });
}
