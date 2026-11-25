import { once } from 'node:events';

const PLAYLIST_LIMIT = 512 * 1024;
const SEGMENT_LIMIT = 16 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; SuperTV/1.0)';

export function parseMediaPlaylist(text, base) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid source playlist');
  if (/#EXT-X-MAP:|#EXT-X-BYTERANGE:|#EXT-X-KEY:.*METHOD=(?!NONE)/.test(text)) throw new Error('This source requires a different ingest format');
  const lines = text.split(/\r?\n/).map(line => line.trim());
  if (lines.some(line => line.startsWith('#EXT-X-STREAM-INF:'))) {
    if (lines.some(line => line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(line) && /URI=/.test(line))) throw new Error('Separate source audio is not supported by this ingest');
    const variants = [];
    for (let i = 0; i < lines.length - 1; i++) if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      const height = Number(/RESOLUTION=\d+x(\d+)/.exec(lines[i])?.[1] || 0);
      const bandwidth = Number(/(?:^|[, :])BANDWIDTH=(\d+)/.exec(lines[i])?.[1] || 0);
      const uri = lines.slice(i + 1).find(line => line && !line.startsWith('#'));
      if (uri && height <= 1080) variants.push({ height, bandwidth, url: new URL(uri, base).href });
    }
    variants.sort((a,b) => b.height-a.height || b.bandwidth-a.bandwidth);
    if (!variants.length) throw new Error('No supported source rendition');
    return { variant: variants[0].url };
  }
  const first = Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)?.[1] || 0);
  const target = Number(/#EXT-X-TARGETDURATION:([\d.]+)/.exec(text)?.[1] || 6);
  const segments = []; let duration = NaN;
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) duration = Number.parseFloat(line.slice(8));
    else if (line && !line.startsWith('#')) {
      if (!(duration > 0)) throw new Error('Invalid source segment duration');
      segments.push({ seq: first + segments.length, duration, url: new URL(line, base).href });
      duration = NaN;
    }
  }
  if (!segments.length) throw new Error('The source has no media');
  return { first, target, segments, ended: text.includes('#EXT-X-ENDLIST') };
}

export async function createHlsInput(source, { userAgent = USER_AGENT, fetcher = fetch, failureTimeoutMs = 20000, reserve = 0 } = {}) {
  const controller = new AbortController();
  const signal = controller.signal;
  const stats = { playlists: 0, downloads: 0, bytes: 0, queuedBytes: 0, maxDownloadMs: 0, resets: 0, sourceSeconds: 0, fedSeconds: 0 };
  let closed = false, epoch = 0, next, playlist, mediaUrl = source, sourceEdge;
  const queue = new Map(); const listeners = new Set();
  const wake = () => { for (const resolve of listeners) resolve(); listeners.clear(); };
  const pause = ms => new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
  async function resource(url, limit, timeout = 10000) {
    const parsed = new URL(url);
    if (!['http:','https:'].includes(parsed.protocol)) throw new Error('Invalid source protocol');
    const request = new AbortController();
    const abort = () => request.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeout);
    if (signal.aborted) abort();
    try {
      const response = await fetcher(url, { headers: { 'User-Agent': userAgent, 'Cache-Control': 'no-cache' }, signal: request.signal });
      if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`Source HTTP request failed (${response.status})`), { status: response.status }); }
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Source resource is too large'); }
      let size = 0; const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length; if (size > limit) throw new Error('Source resource is too large'); chunks.push(chunk);
      }
      return { data: Buffer.concat(chunks), url: response.url || url };
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }

  async function loadPlaylist() {
    for (let depth = 0; depth < 4; depth++) {
      const response = await resource(mediaUrl, PLAYLIST_LIMIT);
      const parsed = parseMediaPlaylist(response.data.toString('utf8'), response.url);
      if (parsed.variant) { mediaUrl = parsed.variant; continue; }
      stats.playlists++; return parsed;
    }
    throw new Error('Too many source playlist levels');
  }
  async function segment(entry) {
    let error;
    for (let attempt = 0; attempt < 3 && !closed; attempt++) {
      try {
        const started = Date.now(); const response = await resource(entry.url, SEGMENT_LIMIT);
        // MPEG-TS sync bytes recur every 188 bytes; reject fMP4 or encrypted bodies.
        if (response.data.length < 376 || response.data.length % 188 !== 0 || response.data[0] !== 0x47 || response.data[188] !== 0x47) throw new Error('The source segment is not MPEG-TS');
        stats.downloads++; stats.bytes += response.data.length;
        stats.maxDownloadMs = Math.max(stats.maxDownloadMs, Date.now()-started);
        return response.data;
      } catch (cause) { error = cause; if (!closed && attempt < 2) await pause(200 * (attempt + 1)); }
    }
    throw error || new Error('Source ingest stopped');
  }
  function schedule() {
    if (closed || next === undefined) return;
    for (const entry of playlist.segments) {
      if (entry.seq < next) continue;
      const key = `${epoch}:${entry.seq}`;
      if (queue.has(key)) continue;
      if (queue.size >= 2) break;
      const item = { ...entry, epoch };
      item.promise = segment(item).then(buffer => {
        item.size = buffer.length; if (!closed && item.epoch === epoch) stats.queuedBytes += buffer.length; wake(); return buffer;
      });
      item.promise.catch(() => {}); queue.set(key,item);
    }
    wake();
  }
  function accept(parsed) {
    if (parsed.ended) throw new Error('The source is not a running live playlist');
    const latest = parsed.segments.at(-1).seq;
    const initial = next === undefined;
    if (initial || latest < sourceEdge) {
      if (next !== undefined) { epoch++; stats.resets++; queue.clear(); stats.queuedBytes = 0; }
      next = latest; sourceEdge = latest;
      if (initial && reserve > 0) {
        let available = 0;
        for (let i = parsed.segments.length - 1; i >= 0 && available < reserve; i--) {
          available += parsed.segments[i].duration;
          next = parsed.segments[i].seq;
        }
      }
    } else {
      for (const entry of parsed.segments) if (entry.seq > sourceEdge) stats.sourceSeconds += entry.duration;
      sourceEdge = latest;
      if (next < parsed.first && !queue.has(`${epoch}:${next}`)) { next = parsed.first; stats.resets++; }
    }
    playlist = parsed; schedule();
  }
  function close() { if (!closed) { closed = true; controller.abort(); queue.clear(); stats.queuedBytes = 0; wake(); } }
  try { accept(await loadPlaylist()); } catch (error) { close(); throw error; }
  async function poll() {
    let lastGood = Date.now();
    while (!closed) {
      await pause(Math.max(400, Math.min(1000, playlist.target * 150)));
      if (closed) break;
      try { accept(await loadPlaylist()); lastGood = Date.now(); }
      catch (error) {
        if (!closed && Date.now() - lastGood > failureTimeoutMs) throw error;
      }
    }
  }
  async function pump(writable) {
    while (!closed) {
      const key = `${epoch}:${next}`; const item = queue.get(key);
      if (!item) { await new Promise(resolve => { listeners.add(resolve); if (closed) wake(); }); continue; }
      let buffer;
      try {
        buffer = await item.promise;
      } catch (error) {
        if (closed) break;
        if (item.epoch !== epoch) continue;
        queue.delete(key);
        // Retry the same position while it remains in the upstream window.
        // A missing segment must not tear down the encoder on a brief outage.
        if (playlist.first > next) next = playlist.first;
        await pause(500);
        schedule();
        continue;
      }
      if (closed) break;
      if (item.epoch !== epoch) continue;
      if (!writable.write(buffer)) await once(writable, 'drain', { signal });
      if (item.epoch !== epoch) continue;
      stats.queuedBytes = Math.max(0,stats.queuedBytes-buffer.length); stats.fedSeconds += item.duration; stats.lastFedAt = Date.now();
      queue.delete(key); next++; schedule();
    }
  }
  return { stats, close, peek: () => queue.get(`${epoch}:${next}`).promise, pipeTo(writable) {
    writable.on('error', close);
    return Promise.all([poll(),pump(writable)]).catch(error => { close(); if (error?.name !== 'AbortError') throw error; });
  } };
}
