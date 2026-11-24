import { apiBase } from './api';

export const LIVE_DELAY_SECONDS = 10;
export const LIVE_SERVER_BUFFER_SECONDS = 4;
export const LIVE_CLIENT_BUFFER_SECONDS = LIVE_DELAY_SECONDS - LIVE_SERVER_BUFFER_SECONDS;

// Split the ten-second reserve between paced VPS playlists (4s) and the player (6s).
// This is not an exact wall-clock delay from the original broadcast.
// A larger playable window absorbs brief interruptions without racing back live.
export const liveBufferConfig = {
  lowLatencyMode: false,
  liveSyncDuration: LIVE_CLIENT_BUFFER_SECONDS,
  liveMaxLatencyDuration: 40,
  maxLiveSyncPlaybackRate: 1,
  abrEwmaFastLive: 1,
  abrEwmaSlowLive: 3,
  // Retain 20% headroom when recovering quality instead of the default 30%.
  abrBandWidthUpFactor: 0.8,
  abrMaxWithRealBitrate: true,
  backBufferLength: 15,
  maxBufferLength: 20,
  maxMaxBufferLength: 40,
};

type AdaptiveHls = InstanceType<typeof import('hls.js')['default']>;

// Small low-quality fragments can leave the bandwidth estimator dominated by
// request latency. A bounded sample of the next rendition measures body transfer
// separately, without changing the user's selected quality or playback timeline.
export function attachLiveQualityRecovery(hls: AdaptiveHls, video: HTMLVideoElement): () => void {
  let disposed = false;
  let request: AbortController | null = null;
  let lastProbe = 0;
  const reserve = () => {
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) > video.currentTime) return video.buffered.end(i) - video.currentTime;
    }
    return 0;
  };
  const timer = setInterval(async () => {
    if (disposed || request || !hls.autoLevelEnabled || video.paused || video.readyState < 3 || reserve() < 5 || Date.now() - lastProbe < 30000) return;
    const next = hls.currentLevel + 1;
    if (next < 1 || next > hls.maxAutoLevel) return;
    const level = hls.levels[next];
    if (!level?.uri || typeof AbortController === 'undefined') return;
    lastProbe = Date.now();
    const controller = new AbortController(); request = controller;
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const playlist = await fetch(level.uri, { signal: controller.signal, cache: 'no-store' });
      if (!playlist.ok) return;
      const text = await playlist.text();
      if (!text.startsWith('#EXTM3U') || text.includes('#EXT-X-STREAM-INF:')) return;
      const segments = text.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'));
      if (!segments.length || controller.signal.aborted || reserve() < 5) return;
      const response = await fetch(new URL(segments[segments.length - 1].trim(), playlist.url || level.uri), { signal: controller.signal });
      if (!response.ok || !response.body) return;
      reader = response.body.getReader();
      let firstAt = 0, bytes = 0, total = 0;
      while (total < 512 * 1024) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (!firstAt) firstAt = performance.now();
        else bytes += chunk.value.byteLength;
        if (reserve() < 3 || !hls.autoLevelEnabled) return;
      }
      const elapsed = performance.now() - firstAt;
      if (!disposed && !controller.signal.aborted && hls.autoLevelEnabled && bytes >= 128 * 1024 && elapsed >= 100 && reserve() >= 3) {
        const estimate = bytes * 8000 / elapsed;
        const required = level.averageBitrate || level.bitrate;
        if (estimate * liveBufferConfig.abrBandWidthUpFactor >= required && estimate > hls.bandwidthEstimate) hls.bandwidthEstimate = estimate;
      }
    } catch { /* A failed sample never interrupts or selects a playback level. */ }
    finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort(); request = null;
    }
  }, 3000);
  return () => { disposed = true; clearInterval(timer); request?.abort(); };
}

export function liveMasterUrl(channelId: string | number, token: string): string {
  return `${apiBase}/api/live/channels/${channelId}/master.m3u8?token=${encodeURIComponent(token)}`;
}

const capabilities = new Map<string, { expires: number; enabled?: boolean; request?: Promise<boolean> }>();
export function forgetLiveCapability(channelId: string | number, token: string) {
  capabilities.delete(`${channelId}:${token}`);
}
export async function isLiveChannelEnabled(channelId: string | number, token: string): Promise<boolean> {
  const key = `${channelId}:${token}`;
  const cached = capabilities.get(key);
  if (cached?.request) return cached.request;
  if (cached && cached.expires > Date.now()) return !!cached.enabled;
  const entry: { expires: number; enabled?: boolean; request?: Promise<boolean> } = { expires: Date.now() + 10000 };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), 5000);
  entry.request = fetch(`${apiBase}/api/live/channels/${channelId}/status?token=${encodeURIComponent(token)}`, {
    signal: controller?.signal,
  }).then(async response => {
    if (!response.ok) throw new Error('Live channel status unavailable');
    return !!(await response.json()).enabled;
  }).catch(() => true)
    .then(enabled => { entry.enabled = enabled; entry.request = undefined; clearTimeout(timeout); return enabled; });
  if (capabilities.size >= 256) capabilities.delete(capabilities.keys().next().value!);
  capabilities.set(key, entry);
  return entry.request;
}
export function channelHlsUrl(channelId: string | number, token: string): string {
  return capabilities.get(`${channelId}:${token}`)?.enabled
    ? liveMasterUrl(channelId, token)
    : `${apiBase}/api/channels/${channelId}/hls-proxy?token=${encodeURIComponent(token)}`;
}
