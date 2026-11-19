import { createHmac, createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 256) return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createChannelLookup() {
  let pool; let opening;
  const cache = new Map(); const pending = new Map();
  async function openPool() {
      if (!opening) opening = (async () => {
        const env = await readFile(process.env.LIVE_DB_ENV || '/opt/copiamelafinal/artifacts/api-server/.env', 'utf8');
        const match = /^(?:export )?DATABASE_URL=(.+)$/m.exec(env);
        if (!match) throw new Error('Database configuration unavailable');
        const connectionString = match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
        const require = createRequire(import.meta.url);
        const { Pool } = require(process.env.LIVE_PG_MODULE || '/opt/copiamelafinal/lib/db/node_modules/pg');
        pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 20000 });
        return pool;
      })().catch(error => { opening = undefined; throw error; });
      return opening;
  }
  const iptvCache = new Map();
  const iptvPending = new Map();
  return {
    async get(id) {
      const cached = cache.get(id);
      if (cached?.expires > Date.now()) return cached.channel;
      if (pending.has(id)) return pending.get(id);
      const request = (async () => {
      await openPool();
      const result = await pool.query('SELECT id, stream_url AS "streamUrl" FROM channels WHERE id=$1', [id]);
      const channel = result.rows[0] || null;
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(id, { channel, expires: Date.now() + 10000 });
      return channel;
      })();
      pending.set(id, request);
      try { return await request; } finally { pending.delete(id); }
    },
    async getForIptv(key, id, device) {
      const cacheKey = key + ':' + device;
      let entry = iptvCache.get(cacheKey);
      if (!entry || entry.expires < Date.now()) {
        let request = iptvPending.get(cacheKey);
        if (!request) {
          request = (async () => {
            const db = await openPool();
            const result = await db.query(
              `WITH admitted AS (
                UPDATE iptv_users AS u
                SET device_leases = COALESCE((
                  SELECT jsonb_object_agg(d.key, d.value)
                  FROM jsonb_each_text(u.device_leases) d
                  WHERE d.value::bigint > EXTRACT(EPOCH FROM now())
                ), '{}'::jsonb) || jsonb_build_object($2::text, (EXTRACT(EPOCH FROM now()) + 30)::bigint)
                WHERE u.playlist_key = $1 AND u.enabled
                  AND (u.expires_at IS NULL OR u.expires_at > now())
                  AND $3::integer = ANY(u.channel_ids)
                  AND (COALESCE((u.device_leases ->> $2::text)::bigint, 0) > EXTRACT(EPOCH FROM now())
                    OR (SELECT count(*) FROM jsonb_each_text(u.device_leases) d
                        WHERE d.value::bigint > EXTRACT(EPOCH FROM now())) < 5)
                RETURNING u.channel_ids, u.expires_at
              )
              SELECT c.id, c.stream_url AS "streamUrl", a.expires_at AS "expiresAt"
              FROM admitted a JOIN channels c ON c.id = ANY(a.channel_ids)`,
              [key, device, id],
            );
            const expiresAt = result.rows[0]?.expiresAt?.getTime() ?? Infinity;
            const current = { channels: new Map(result.rows.map(row => [row.id, row])),
              expires: Math.min(Date.now() + 3000, expiresAt) };
            if (current.channels.size) {
              if (iptvCache.size >= 256) iptvCache.delete(iptvCache.keys().next().value);
              iptvCache.set(cacheKey, current);
            }
            return current;
          })().finally(() => iptvPending.delete(cacheKey));
          iptvPending.set(cacheKey, request);
        }
        entry = await request;
      }
      return entry.channels.get(id);
    },
    async close() { if (pool) await pool.end(); },
  };
}

export function createOriginRelay({ getSecret, allowPrivate = false }) {
  const entries = new Map(); const pending = new Map(); let bytes = 0;
  const MAX_BODY = 16 * 1024 * 1024; const MAX_CACHE = 64 * 1024 * 1024;
  const privateAddress = address => /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address)
    || /^(?:::1$|::ffff:(?:127\.|10\.|192\.168\.|169\.254\.)|f[cd]|fe80:)/i.test(address);
  async function safeUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid origin protocol');
    if (!allowPrivate) {
      const addresses = await lookup(url.hostname, { all: true });
      if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new Error('Invalid origin address');
    }
    return url;
  }
  async function fetchResource(value) {
    const previous = entries.get(value);
    if (previous && previous.expires > Date.now()) return previous;
    if (pending.has(value)) return pending.get(value);
    if (pending.size >= 4) throw new Error('Origin temporarily busy');
    const request = (async () => {
      let url = await safeUrl(value); let response;
      for (let i = 0; i < 5; i++) {
        response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SuperTV/1.0)' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
        if (response.status < 300 || response.status >= 400) break;
        const next = response.headers.get('location'); await response.body?.cancel();
        if (!next) throw new Error('Invalid origin redirect');
        url = await safeUrl(new URL(next, url));
      }
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_BODY) throw new Error('Origin unavailable');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_BODY) throw new Error('Origin segment is too large');
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks); const text = data.subarray(0, 20).toString().trimStart();
      const manifest = text.startsWith('#EXTM3U');
      if (!manifest && /\.m3u8(?:[?#]|$)/i.test(url.href)) throw new Error('Invalid origin playlist');
      const type = response.headers.get('content-type') || 'application/octet-stream';
      const entry = { data, manifest, base: url.href, type: /^(?:video|audio)\//.test(type) ? type : 'application/octet-stream', expires: Date.now() + (manifest ? 2000 : 30000) };
      if (entries.has(value)) { bytes -= entries.get(value).data.length; entries.delete(value); }
      while (bytes + data.length > MAX_CACHE && entries.size) {
        const first = entries.keys().next().value; bytes -= entries.get(first).data.length; entries.delete(first);
      }
      entries.set(value, entry); bytes += data.length;
      return entry;
    })();
    pending.set(value, request);
    try { return await request; } finally { pending.delete(value); }
  }
  const signature = (id, value, expiry) => createHmac('sha256', getSecret()).update(`${id}\0${expiry}\0${value}`).digest('base64url');
  function relayUrl(value, base, id, key) {
    const absolute = new URL(value, base).href; const expiry = String(Math.floor(Date.now() / 1000) + 300);
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(getSecret()).digest(), nonce);
    cipher.setAAD(Buffer.from(`${id}\0${expiry}`));
    const encrypted = Buffer.concat([cipher.update(absolute), cipher.final()]);
    const opaque = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
    return `/api/live/channels/${id}/relay?s=${opaque}&exp=${expiry}&sig=${signature(id, opaque, expiry)}&key=${encodeURIComponent(key)}`;
  }
  return {
    async send(res, value, id, key, head = false) {
      const entry = await fetchResource(value);
      res.setHeader('Cache-Control', 'private, no-store');
      if (entry.manifest) {
        const text = entry.data.toString().split('\n').map(line => {
          if (!line.trim()) return line;
          if (!line.trim().startsWith('#')) return relayUrl(line.trim(), entry.base, id, key);
          return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${relayUrl(uri, entry.base, id, key)}"`);
        }).join('\n');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end(head ? undefined : text);
      } else {
        res.setHeader('Content-Type', entry.type); res.setHeader('Content-Length', entry.data.length);
        res.end(head ? undefined : entry.data);
      }
    },
    verify(url, id) {
      const encoded = url.searchParams.get('s') || ''; const expiry = url.searchParams.get('exp') || ''; const supplied = url.searchParams.get('sig') || '';
      if (encoded.length > 10000 || !/^\d+$/.test(expiry) || Number(expiry) < Date.now() / 1000 || Number(expiry) > Date.now() / 1000 + 600) throw Object.assign(new Error('Expired segment'), { status: 403 });
      if (!sameSecret(supplied, signature(id, encoded, expiry))) throw Object.assign(new Error('Invalid segment signature'), { status: 403 });
      try {
        const payload = Buffer.from(encoded, 'base64url');
        const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(getSecret()).digest(), payload.subarray(0, 12));
        decipher.setAuthTag(payload.subarray(12, 28)); decipher.setAAD(Buffer.from(`${id}\0${expiry}`));
        return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString();
      } catch { throw Object.assign(new Error('Invalid segment signature'), { status: 403 }); }
    },
  };
}
