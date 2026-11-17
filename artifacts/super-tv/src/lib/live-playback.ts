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
  }).then(async response => response.ok && !!(await response.json()).enabled).catch(() => false)
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
