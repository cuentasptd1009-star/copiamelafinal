import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const RENDITIONS = [
  { name: '360p', width: 640, height: 360, bitrate: '500k', maxrate: '650k', bandwidth: 800000 },
  { name: '480p', width: 854, height: 480, bitrate: '800k', maxrate: '950k', bandwidth: 1100000 },
];
export const DELAY_SECONDS = 10;

export function ffmpegArguments(source, directory) {
  const filters = '[0:v:0]fps=25,split=2[v0][v1];' + RENDITIONS.map((r, i) =>
    `[v${i}]scale=${r.width}:${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[out${i}]`).join(';');
  const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-stats_period', '2', '-progress', 'pipe:3',
    '-threads', '1', '-filter_complex_threads', '1', '-rw_timeout', '15000000',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '3',
    '-user_agent', 'Mozilla/5.0 (compatible; SuperTV/1.0)', '-live_start_index', '-2',
    '-fflags', '+genpts+discardcorrupt', '-i', source, '-filter_complex', filters];
  RENDITIONS.forEach((r, i) => args.push(
    '-map', `[out${i}]`, '-map', '0:a:0?', '-c:v', 'libx264', '-threads', '1',
    '-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'baseline', '-level:v', '3.0',
    '-pix_fmt', 'yuv420p', '-b:v', r.bitrate, '-maxrate', r.maxrate, '-bufsize', '1500k',
    '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '2', '-af', 'aresample=async=1:first_pts=0',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '12', '-hls_delete_threshold', '4',
    '-hls_flags', 'delete_segments+independent_segments+program_date_time+temp_file',
    '-hls_segment_filename', path.join(directory, r.name, 'seg_%08d.ts'), path.join(directory, r.name, 'index.m3u8')));
  return args;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const playlistDuration = text => [...text.matchAll(/^#EXTINF:([\d.]+)/gm)].reduce((sum, m) => sum + Number(m[1]), 0);
const cleanError = message => String(message).replace(/https?:\/\/[^\s]+/g, '[origin]').slice(-800);

export function createLiveServer(options = {}) {
  const config = {
    apiBase: process.env.LIVE_API_BASE || 'http://127.0.0.1:4000',
    directory: process.env.LIVE_DIRECTORY || '/var/cache/supertv-live',
    allowed: new Set((process.env.LIVE_CHANNEL_IDS || '').split(',').map(Number).filter(Number.isSafeInteger)),
    maxChannels: Math.max(1, Math.min(5, Number(process.env.LIVE_MAX_CHANNELS) || 1)),
    stateFile: process.env.LIVE_CONFIG_FILE || null,
    idleMs: Number(process.env.LIVE_IDLE_MS) || 120000,
    warmupMs: Number(process.env.LIVE_WARMUP_MS) || 45000,
    ...options,
  };
  const jobs = new Map();
  const authorizations = new Map();
  const cooldown = new Map();
  const ready = (async () => {
    if (!config.stateFile) return;
    try {
      const data = JSON.parse(await readFile(config.stateFile, 'utf8'));
      if (!Array.isArray(data.enabledChannelIds) || data.enabledChannelIds.length > 5 || !data.enabledChannelIds.every(Number.isSafeInteger)) throw new Error('Invalid live configuration');
      config.allowed = new Set(data.enabledChannelIds);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })();
  let updates = Promise.resolve();
  const summary = () => ({ enabledChannelIds: [...config.allowed], maxSelectedChannels: 5,
    maxConcurrentChannels: config.maxChannels, delaySeconds: DELAY_SECONDS,
    activeChannels: [...jobs.values()].map(j => ({ id: j.id, ready: j.ready, speed: j.speed || null })) });
  async function requireAdmin(token) {
    const response = await fetch(`${config.apiBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Object.assign(new Error('Unauthorized'), { status: 401 });
    const session = await response.json();
    if (session.type !== 'admin' || session.role !== 'admin') throw Object.assign(new Error('Admin only'), { status: 403 });
  }
  async function setEnabled(id, enabled, channels) {
    const update = updates.then(async () => {
      const next = new Set([...config.allowed].filter(value => channels.has(value)));
      if (enabled) next.add(id); else next.delete(id);
      if (next.size > 5) throw Object.assign(new Error('Puedes activar hasta 5 canales. Desactiva uno antes de añadir otro.'), { status: 409 });
      if (config.stateFile) {
        const temporary = `${config.stateFile}.${randomBytes(4).toString('hex')}.tmp`;
        await writeFile(temporary, JSON.stringify({ enabledChannelIds: [...next] }), { mode: 0o600 });
        await rename(temporary, config.stateFile);
      }
      config.allowed = next;
      for (const job of [...jobs.values()]) if (!next.has(job.id)) stop(job, 'disabled');
      if (enabled) start(channels.get(id));
      return summary();
    });
    updates = update.catch(() => {});
    return update;
  }

  async function authorize(token) {
    if (!token || token.length < 8 || token.length > 256) throw Object.assign(new Error('Unauthorized'), { status: 401 });
    const cached = authorizations.get(token);
    if (cached && cached.expires > Date.now()) return cached.channels;
    const response = await fetch(`${config.apiBase}/api/channels`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Object.assign(new Error('Unauthorized'), { status: response.status === 401 || response.status === 403 ? 401 : 503 });
    const data = await response.json();
    if (!Array.isArray(data)) throw Object.assign(new Error('Backend unavailable'), { status: 503 });
    const channels = new Map(data.map(c => [c.id, { id: c.id, streamUrl: c.streamUrl, streamFormat: c.streamFormat }]));
    if (authorizations.size >= 256) authorizations.delete(authorizations.keys().next().value);
    authorizations.set(token, { expires: Date.now() + 10000, channels });
    return channels;
  }

  function stop(job, reason) {
    if (job.stopping) return;
    job.stopping = true;
    jobs.delete(job.id);
    if (reason !== 'idle' && reason !== 'shutdown' && reason !== 'disabled') cooldown.set(job.id, Date.now() + 180000);
    job.child?.kill('SIGTERM');
    const force = setTimeout(() => job.child?.kill('SIGKILL'), 5000); force.unref();
    if (!job.child) rm(job.directory, { recursive: true, force: true }).catch(() => {});
    console.log(JSON.stringify({ event: 'live-stop', channel: job.id, reason }));
  }

  function start(channel) {
    const existing = jobs.get(channel.id);
    if (existing) return existing;
    if (jobs.size >= config.maxChannels || (cooldown.get(channel.id) || 0) > Date.now()) return null;
    let origin;
    try { origin = new URL(channel.streamUrl); } catch { return null; }
    if (!['http:', 'https:'].includes(origin.protocol)) return null;
    const generation = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const job = { id: channel.id, generation, directory: path.join(config.directory, String(channel.id), generation),
      lastSeen: Date.now(), started: Date.now(), lastProgress: Date.now(), slowSince: null, child: null, stopping: false, ready: false };
    jobs.set(channel.id, job);
    job.readiness = (async () => {
      await Promise.all(RENDITIONS.map(r => mkdir(path.join(job.directory, r.name), { recursive: true, mode: 0o700 })));
      if (job.stopping) throw new Error('Stopped');
      const child = spawn('python3', [fileURLToPath(new URL('./ffmpeg-child.py', import.meta.url)), String(process.pid), process.env.FFMPEG_PATH || 'ffmpeg', ...ffmpegArguments(channel.streamUrl, job.directory)],
        { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
      job.child = child;
      child.on('error', () => stop(job, 'ffmpeg-unavailable'));
      child.stderr.on('data', bytes => { job.lastError = cleanError(bytes.toString()); });
      let progress = '';
      child.stdio[3].on('data', bytes => {
        progress += bytes.toString();
        const lines = progress.split('\n'); progress = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('out_time_us=')) {
            const value = Number(line.slice(12));
            if (value > (job.mediaTime || 0)) { job.lastProgress = Date.now(); job.mediaTime = value; }
          }
          if (line.startsWith('speed=')) {
            job.speed = Number.parseFloat(line.slice(6));
            if (job.speed < 0.9 && Date.now() - job.started > 30000) job.slowSince ??= Date.now();
            else job.slowSince = null;
          }
        }
      });
      child.on('exit', code => {
        if (!job.stopping) {
          console.error(JSON.stringify({ event: 'live-exit', channel: job.id, code, detail: job.lastError || '' }));
          stop(job, 'ffmpeg-exit');
        }
        rm(job.directory, { recursive: true, force: true }).catch(() => {});
      });
      console.log(JSON.stringify({ event: 'live-start', channel: job.id, pid: child.pid }));
      while (!job.stopping && Date.now() - job.started < config.warmupMs) {
        try {
          const lists = await Promise.all(RENDITIONS.map(r => readFile(path.join(job.directory, r.name, 'index.m3u8'), 'utf8')));
          if (lists.every(text => playlistDuration(text) >= DELAY_SECONDS + 2)) { job.ready = true; return; }
        } catch { /* The encoder has not published its first playlist yet. */ }
        await delay(250);
      }
      stop(job, 'warmup-failed');
      throw new Error('Live processing unavailable');
    })();
    // A client may disconnect during warmup; keep the shared job's rejection handled.
    job.readiness.catch(() => {});
    return job;
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of authorizations) if (entry.expires < now) authorizations.delete(token);
    for (const [id, until] of cooldown) if (until < now) cooldown.delete(id);
    for (const job of jobs.values()) {
      if (now - job.lastSeen > config.idleMs) stop(job, 'idle');
      else if (now - job.lastProgress > 35000) stop(job, 'source-stalled');
      else if (job.slowSince && now - job.slowSince > 30000) stop(job, 'insufficient-capacity');
    }
  }, 5000); sweep.unref();

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'X-SuperTV-Live');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!['GET', 'HEAD', 'PUT'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
    try { await ready; } catch { res.writeHead(503); res.end('Live configuration unavailable'); return; }
    const token = url.searchParams.get('token') || req.headers.authorization?.replace(/^Bearer /i, '') || '';
    if (url.pathname.startsWith('/api/live/admin/')) {
      try {
        const channels = await authorize(token);
        await requireAdmin(token);
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/api/live/admin/config' && req.method === 'GET') { res.end(JSON.stringify(summary())); return; }
        const setting = /^\/api\/live\/admin\/channels\/(\d+)$/.exec(url.pathname);
        if (!setting || req.method !== 'PUT') { res.writeHead(404); res.end(); return; }
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw Object.assign(new Error('Request too large'), { status: 413 }); }
        let data; try { data = JSON.parse(body); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
        if (typeof data.enabled !== 'boolean') throw Object.assign(new Error('enabled must be boolean'), { status: 400 });
        const id = Number(setting[1]); const channel = channels.get(id);
        if (data.enabled && (!channel || !/^https?:\/\//.test(channel.streamUrl) || !(channel.streamFormat === 'hls' || /\.m3u8(?:[?#]|$)|\/hls\//i.test(channel.streamUrl)))) {
          throw Object.assign(new Error('Selecciona un canal HLS (M3U8) válido.'), { status: 400 });
        }
        res.end(JSON.stringify(await setEnabled(id, data.enabled, channels)));
      } catch (error) { res.writeHead(error.status || 503); res.end(JSON.stringify({ error: error.status ? error.message : 'No se pudo guardar la configuración.' })); }
      return;
    }
    if (req.method === 'PUT') { res.writeHead(405); res.end(); return; }
    const match = /^\/api\/live\/channels\/(\d+)\/(status|master\.m3u8|([a-z0-9-]{1,50})\/(360p|480p)\/(index\.m3u8|seg_\d+\.ts))$/.exec(url.pathname);
    if (!match) { res.writeHead(404); res.end(); return; }
    const id = Number(match[1]);
    const fallback = () => { if (!res.destroyed) { res.writeHead(302, { Location: `/api/channels/${id}/hls-proxy?token=${encodeURIComponent(token)}` }); res.end(); } };
    try {
      const channels = await authorize(token);
      const channel = channels.get(id);
      if (!channel) { res.writeHead(404); res.end(); return; }
      if (match[2] === 'status') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ enabled: config.allowed.has(id), ready: !!jobs.get(id)?.ready,
          delaySeconds: DELAY_SECONDS, qualities: config.allowed.has(id) ? [360, 480] : [] }));
        return;
      }
      if (match[2] === 'master.m3u8') {
        if (!config.allowed.has(id)) { fallback(); return; }
        const job = start(channel);
        if (!job) { fallback(); return; }
        job.lastSeen = Date.now();
        try { await job.readiness; } catch { fallback(); return; }
        if (res.destroyed) return;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('X-SuperTV-Live', 'transcoded');
        res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-START:TIME-OFFSET=-10,PRECISE=YES\n' + RENDITIONS.map(r =>
          `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.width}x${r.height},FRAME-RATE=25.000,CODECS="avc1.42c01e,mp4a.40.2",NAME="SuperTV ${r.name}"\n/api/live/channels/${id}/${job.generation}/${r.name}/index.m3u8?token=${encodeURIComponent(token)}\n`).join(''));
        return;
      }
      const job = jobs.get(id);
      if (!job || job.generation !== match[3] || !job.ready) { res.writeHead(404); res.end(); return; }
      job.lastSeen = Date.now();
      const file = path.join(job.directory, match[4], match[5]);
      if (match[5] === 'index.m3u8') {
        let text = await readFile(file, 'utf8');
        const prefix = `/api/live/channels/${id}/${job.generation}/${match[4]}/`;
        text = text.replace('#EXTM3U', '#EXTM3U\n#EXT-X-START:TIME-OFFSET=-10,PRECISE=YES')
          .split('\n').map(line => /^seg_\d+\.ts$/.test(line.trim()) ? `${prefix}${line.trim()}?token=${encodeURIComponent(token)}` : line).join('\n');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end(text);
      } else {
        const info = await stat(file);
        res.setHeader('Content-Type', 'video/mp2t'); res.setHeader('Content-Length', info.size);
        res.setHeader('Cache-Control', 'private, max-age=15');
        if (req.method === 'HEAD') res.end();
        else { const stream = createReadStream(file); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); }
      }
    } catch (error) {
      if (!res.headersSent && !res.destroyed) { res.writeHead(error.status || (error.code === 'ENOENT' ? 404 : 503)); res.end('Live stream unavailable'); }
      else if (!res.destroyed) res.destroy();
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 65000;
  return { server, jobs, ready, async close() {
    clearInterval(sweep);
    for (const job of [...jobs.values()]) stop(job, 'shutdown');
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}

if (process.env.LIVE_RUN_SERVER === '1' || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  const live = createLiveServer();
  const port = Number(process.env.LIVE_PORT) || 8790;
  await live.ready;
  live.server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'live-listen', port })));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await live.close(); process.exit(0); });
}
