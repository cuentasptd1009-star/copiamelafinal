// Private, quota-limited offline samples. Does not change channels or services.
// Run in a transient cgroup capped at <=30% of one CPU, with <=512 MiB memory.
import { readFile, writeFile, mkdtemp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { Writable } from 'node:stream';
import { cpus } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.umask(0o077);
const emit = data => console.log(JSON.stringify(data));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const runtime = process.env.LIVE_RUNTIME || '/opt/supertv-live';
const ids = process.argv.slice(2).map(Number);
const repairIds = new Set((process.env.CAPACITY_REPAIR_VIDEO_IDS || '').split(',').map(Number));
const iterations = Math.max(1, Math.min(2, Math.trunc(Number(process.env.CAPACITY_RUNS) || 2)));
if (!ids.length || ids.length > 5 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Pass one to five channel IDs');
const group = (await readFile('/proc/self/cgroup', 'utf8')).trim().split('\n').find(x => x.startsWith('0::'))?.slice(3);
if (!group || group === '/') throw new Error('A quota-limited transient cgroup is required');
const cgroup = path.join('/sys/fs/cgroup', group);
const [quota, period] = (await readFile(path.join(cgroup, 'cpu.max'), 'utf8')).trim().split(/\s+/).map(Number);
const memory = Number((await readFile(path.join(cgroup, 'memory.max'), 'utf8')).trim());
if (!(quota > 0 && quota / period <= 0.30 && memory > 0 && memory <= 512 * 1024 ** 2)) throw new Error('Diagnostic resource limits are required');

const { ffmpegArguments, renditionsFor } = await import(pathToFileURL(path.join(runtime, 'server.mjs')));
const { createChannelLookup } = await import(pathToFileURL(path.join(runtime, 'sharing.mjs')));
const { createHlsInput } = await import(pathToFileURL(path.join(runtime, 'ingest.mjs')));
const lookup = createChannelLookup();
const root = await mkdtemp('/root/supertv-capacity-');
let activeInput, activeChild, stop = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stop = true; activeInput?.close(); activeChild?.kill('SIGTERM'); });
const run = (file, args, timeout = 20000) => new Promise((resolve, reject) => {
  activeChild = execFile(file, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    activeChild = null;
    if (error) reject(Object.assign(new Error('Diagnostic subprocess failed'), { code: error.code })); else resolve(stdout);
  });
});
const cpuSnapshot = async () => {
  const values = (await readFile('/proc/stat', 'utf8')).split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  return { total: values.slice(0, 8).reduce((a, b) => a + b, 0), idle: values[3] + values[4], steal: values[7] };
};
const memorySnapshot = async () => {
  const text = await readFile('/proc/meminfo', 'utf8');
  return Object.fromEntries(['MemTotal', 'MemAvailable'].map(key => [key, +(Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)?.[1]) / 1024).toFixed(1)]));
};

async function capture(id, sample) {
  const cache = `/var/cache/supertv-live/${id}`;
  try {
    const generations = await readdir(cache);
    const recent = (await Promise.all(generations.map(async generation => {
      const index = path.join(cache, generation, 'original/index.m3u8');
      return { index, age: (await stat(index)).mtimeMs };
    }))).sort((a, b) => b.age - a.age)[0];
    if (recent && Date.now() - recent.age < 15000) {
      const text = await readFile(recent.index, 'utf8');
      const files = text.split('\n').filter(line => /^seg_\d+\.ts$/.test(line)).slice(-6);
      const chunks = await Promise.all(files.map(file => readFile(path.join(path.dirname(recent.index), file))));
      const bytes = chunks.reduce((sum, b) => sum + b.length, 0);
      if (bytes > 0 && bytes <= 32 * 1024 ** 2) { await writeFile(sample, Buffer.concat(chunks)); return 'existing-original-cache'; }
    }
  } catch { /* A channel without a live job needs a bounded source sample. */ }
  const channel = await lookup.get(id);
  if (!channel) throw new Error('Channel unavailable');
  let input;
  try { input = await createHlsInput(channel.streamUrl); }
  catch {
    // Match the worker's direct-FFmpeg fallback for encrypted/fMP4 playlists.
    // Automatic stream selection chooses the highest-resolution source video.
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-rw_timeout', '8000000', '-user_agent', 'Mozilla/5.0 (compatible; SuperTV/1.0)', '-live_start_index', '-1', '-i', channel.streamUrl, '-t', '8', '-c', 'copy', sample], 35000);
    return 'direct-hls-stream-copy';
  }
  activeInput = input;
  const chunks = []; let bytes = 0;
  const sink = new Writable({ write(chunk, encoding, callback) {
    bytes += chunk.length;
    if (bytes > 32 * 1024 ** 2) { input.close(); callback(new Error('Sample limit')); return; }
    chunks.push(chunk); callback();
    setImmediate(() => { if (input.stats.fedSeconds >= 8) input.close(); });
  } });
  const timer = setTimeout(() => input.close(), 25000);
  try {
    await input.pipeTo(sink);
    if (stop || input.stats.fedSeconds < 4) throw new Error('Insufficient source sample');
    await writeFile(sample, Buffer.concat(chunks)); return 'bounded-source-sample';
  } finally { clearTimeout(timer); input.close(); activeInput = null; }
}

const runner = `import subprocess,resource,json,sys,time,os,signal
p=None
def stop(sig,frame):
 if p and p.poll() is None: os.killpg(p.pid,signal.SIGTERM)
signal.signal(signal.SIGTERM,stop)
started=time.monotonic()
p=subprocess.Popen(['ffmpeg']+json.loads(sys.argv[1]),stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
try: out,err=p.communicate(timeout=120)
except subprocess.TimeoutExpired:
 os.killpg(p.pid,signal.SIGKILL);out,err=p.communicate()
usage=resource.getrusage(resource.RUSAGE_CHILDREN)
print(json.dumps({'exit':p.returncode,'cpuSeconds':usage.ru_utime+usage.ru_stime,'wallSeconds':time.monotonic()-started,'peakMiB':usage.ru_maxrss/1024}))
`;
const results = [];
try {
  emit({ event: 'begin', ids, cpus: cpus().length, quotaCores: quota / period, memoryMiB: memory / 1024 ** 2 });
  const samples = []; let previous = await cpuSnapshot();
  for (let i = 0; i < 15 && !stop; i++) {
    await delay(1000); const current = await cpuSnapshot(); const total = current.total - previous.total;
    samples.push({ busy: 100 * (total - current.idle + previous.idle) / total, steal: 100 * (current.steal - previous.steal) / total }); previous = current;
  }
  const busy = samples.map(x => x.busy).sort((a, b) => a - b);
  const baseline = { avgBusyPercent: +(busy.reduce((a, b) => a + b, 0) / busy.length).toFixed(1), p95BusyPercent: +busy[Math.floor((busy.length - 1) * .95)].toFixed(1), maxStealPercent: +Math.max(...samples.map(x => x.steal)).toFixed(1), memoryMiB: await memorySnapshot() };
  emit({ event: 'baseline', ...baseline });
  if (baseline.p95BusyPercent > 80 || stop) throw new Error('Insufficient headroom for diagnostics');
  for (const id of ids) {
    if (stop) break;
    const directory = path.join(root, String(id)); await mkdir(directory, { mode: 0o700 });
    try {
      emit({ event: 'sampling', id });
      const sample = path.join(directory, 'sample.ts'); const captureMode = await capture(id, sample);
      const data = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,profile,level', '-of', 'json', sample]));
      const video = data.streams.find(s => s.codec_type === 'video'); const audio = data.streams.find(s => s.codec_type === 'audio');
      const [n, d] = String(video?.r_frame_rate || '0/1').split('/').map(Number); const fps = n / (d || 1);
      const info = { id, captureMode, width: video?.width, height: video?.height, fps: +fps.toFixed(3), video: video?.codec_name, audio: audio?.codec_name || null, videoReencoded: repairIds.has(id), currentWorkerCompatible: video?.codec_name === 'h264' && (!audio || audio.codec_name === 'aac') && video.height <= 1080 && fps > 0 && fps <= 31 };
      emit({ event: 'profile', ...info });
      // The offline candidate also measures 60fps/MP2 inputs. This does not
      // change the production worker's stricter admission rules.
      if (video?.codec_name !== 'h264' || video.height > 1080 || !(fps > 0 && fps <= 61)) { results.push({ ...info, measured: false }); continue; }
      const profile = { width: video.width, height: video.height, fps, profile: /high/i.test(video.profile) ? 'high' : /main/i.test(video.profile) ? 'main' : 'baseline', level: (video.level || 40) / 10, codecs: 'avc1.640028', bandwidth: 5000000 };
      const renditions = renditionsFor(profile); const runs = [];
      for (let iteration = 0; iteration < iterations && !stop; iteration++) {
        const output = path.join(directory, `output-${iteration}`); await Promise.all(renditions.map(r => mkdir(path.join(output, r.name), { recursive: true, mode: 0o700 })));
        const flags = new Set(['-rw_timeout', '-reconnect', '-reconnect_streamed', '-reconnect_delay_max', '-user_agent', '-live_start_index', '-http_multiple', '-http_persistent']);
        const original = ffmpegArguments(sample, output, profile, renditions);
        if (repairIds.has(id)) {
          const at = original.findIndex((value, i) => value === '-c:v' && original[i + 1] === 'copy');
          if (at < 0) throw new Error('Original rendition unavailable');
          original.splice(at, 2, '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'high', '-level:v', String(profile.level), '-8x8dct', '1', '-pix_fmt', 'yuv420p', '-b:v', '4000k', '-maxrate', '6000k', '-bufsize', '8000k', '-g', String(Math.round(fps * 2)), '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*2)');
          for (let i = 0; i < original.length; i++) if (original[i] === '-force_key_frames') original[i + 1] = 'expr:gte(t,n_forced*2)';
        }
        let args = original.filter((value, i) => !flags.has(value) && !flags.has(original[i - 1]));
        args.splice(args.indexOf('-i'), 0, '-stream_loop', '-1');
        args = args.flatMap(x => x === '-output_ts_offset' ? ['-t', '8', x] : [x]).map(x => x === 'pipe:3' ? 'pipe:1' : x);
        const usage = JSON.parse(await run('python3', ['-c', runner, JSON.stringify(args)], 125000));
        if (usage.exit !== 0) throw new Error('Encoder sample failed');
        const playlist = await readFile(path.join(output, 'original/index.m3u8'), 'utf8');
        const seconds = [...playlist.matchAll(/^#EXTINF:([\d.]+)/gm)].reduce((sum, m) => sum + Number(m[1]), 0);
        if (seconds < 7) throw new Error('Incomplete encoded sample');
        const result = { cpuCores: +(usage.cpuSeconds / seconds).toFixed(3), peakMiB: +usage.peakMiB.toFixed(1), mediaSeconds: +seconds.toFixed(3), wallSeconds: +usage.wallSeconds.toFixed(1) };
        runs.push(result); emit({ event: 'run', id, iteration: iteration + 1, ...result }); await rm(output, { recursive: true, force: true });
      }
      results.push({ ...info, measured: runs.length === iterations, qualities: renditions.map(r => r.height), runs });
    } catch (error) { results.push({ id, measured: false, error: String(error.code || 'sample-unavailable') }); emit({ event: 'channel-failed', id, code: String(error.code || 'sample-unavailable') }); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
  emit({ event: 'complete', results });
} catch { emit({ event: 'stopped', reason: 'diagnostic-headroom-or-runtime-limit', results }); process.exitCode = 1; }
finally { activeInput?.close(); activeChild?.kill('SIGTERM'); await lookup.close(); await rm(root, { recursive: true, force: true }); }
