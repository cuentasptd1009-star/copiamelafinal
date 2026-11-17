import type Hls from 'hls.js';
import type { FragmentLoaderContext, LoaderCallbacks, LoaderConfiguration, LoaderContext } from 'hls.js';

// Keep ordinary relay playback inside short origin playlist windows, while
// prefetching enough complete fragments to survive a slow segment request.
export const relayBufferConfig = {
  lowLatencyMode: false,
  liveSyncDurationCount: 2,
  backBufferLength: 6,
  maxBufferLength: 12,
  maxMaxBufferLength: 24,
};

const TS_SIZE = 188;
const PTS_WRAP = 2 ** 33;

function timestamp(data: Uint8Array, offset: number): number {
  return (data[offset] & 14) * 2 ** 29 + data[offset + 1] * 2 ** 22 +
    (data[offset + 2] & 254) * 2 ** 14 + data[offset + 3] * 2 ** 7 + (data[offset + 4] >> 1);
}

function gopStart(data: number[]): 0 | 1 | 2 {
  let sps = false, pps = false, intra = false;
  for (let i = 0; i + 4 < data.length; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 1) continue;
    const type = data[i + 3] & 31;
    if (type === 5) return 2; // IDR is already an independent start.
    if (type === 7) sps = true;
    if (type === 8) pps = true;
    if (type === 1) {
      // Read first_mb_in_slice and slice_type (unsigned Exp-Golomb).
      const bytes: number[] = [];
      for (let j = i + 4; j < Math.min(data.length, i + 36); j++) {
        if (j >= i + 6 && data[j] === 3 && data[j - 1] === 0 && data[j - 2] === 0) continue;
        bytes.push(data[j]);
      }
      let bit = 0;
      const read = () => bit < bytes.length * 8 ? (bytes[bit >> 3] >> (7 - (bit++ & 7))) & 1 : -1;
      const ue = () => {
        let zeros = 0, next = read();
        while (next === 0 && zeros < 24) { zeros++; next = read(); }
        if (next !== 1 || zeros >= 24) return -1;
        let value = 1;
        for (let k = 0; k < zeros; k++) { const b = read(); if (b < 0) return -1; value = value * 2 + b; }
        return value - 1;
      };
      if (ue() < 0) continue;
      const slice = ue();
      if (slice === 2 || slice === 4 || slice === 7 || slice === 9) intra = true;
    }
  }
  return sps && pps && intra ? 1 : 0;
}

/** Remove only open-GOP leading pictures at a new decoder entry point.
 * They have presentation timestamps before the first intra picture and may
 * reference the preceding, unavailable GOP. Keep all audio, tables and video
 * after that point. Continuous fragments must never be filtered this way.
 */
export function removeLeadingPictures(data: ArrayBuffer): { data: ArrayBuffer; videoFound: boolean; removedPackets: number } {
  const bytes = new Uint8Array(data);
  const unchanged = (videoFound = false) => ({ data, videoFound, removedPackets: 0 });
  if (bytes.length < TS_SIZE * 2 || bytes.length % TS_SIZE !== 0) return unchanged();
  type Group = { pid: number; pts: number; packets: number[]; prefix: number[] };
  const groups: Group[] = [];
  const active = new Map<number, Group>();
  for (let offset = 0; offset < bytes.length; offset += TS_SIZE) {
    if (bytes[offset] !== 0x47 || bytes[offset + 1] & 0x80 || bytes[offset + 3] & 0xc0) return unchanged();
    const pid = (bytes[offset + 1] & 31) * 256 + bytes[offset + 2];
    const control = (bytes[offset + 3] >> 4) & 3;
    if (!(control & 1)) continue;
    const payload = offset + 4 + (control === 3 ? 1 + bytes[offset + 4] : 0);
    if (payload >= offset + TS_SIZE) continue;
    let elementary = payload;
    if (bytes[offset + 1] & 0x40) {
      active.delete(pid);
      if (payload + 14 > offset + TS_SIZE || bytes[payload] !== 0 || bytes[payload + 1] !== 0 || bytes[payload + 2] !== 1 ||
          bytes[payload + 3] < 0xe0 || bytes[payload + 3] > 0xef || !(bytes[payload + 7] & 0x80)) continue;
      const group: Group = { pid, pts: timestamp(bytes, payload + 9), packets: [], prefix: [] };
      groups.push(group); active.set(pid, group);
      elementary = payload + 9 + bytes[payload + 8];
    }
    const group = active.get(pid);
    if (group) {
      group.packets.push(offset);
      for (let j = elementary; j < offset + TS_SIZE && group.prefix.length < 512; j++) group.prefix.push(bytes[j]);
    }
  }
  if (!groups.length) return unchanged();
  const first = groups.find(group => gopStart(group.prefix) !== 0);
  if (!first || gopStart(first.prefix) !== 1) return unchanged(true);
  const discarded = new Set<number>();
  for (const group of groups.slice(groups.indexOf(first) + 1)) {
    let delta = group.pts - first.pts;
    if (delta > PTS_WRAP / 2) delta -= PTS_WRAP;
    if (delta < -PTS_WRAP / 2) delta += PTS_WRAP;
    if (group.pid === first.pid && delta < 0 && delta > -90_000) {
      for (const packet of group.packets) discarded.add(packet);
    }
  }
  if (!discarded.size) return unchanged(true);
  const output = new Uint8Array(bytes.length - discarded.size * TS_SIZE);
  let target = 0;
  for (let offset = 0; offset < bytes.length; offset += TS_SIZE) {
    if (discarded.has(offset)) continue;
    output.set(bytes.subarray(offset, offset + TS_SIZE), target); target += TS_SIZE;
  }
  return { data: output.buffer, videoFound: true, removedPackets: discarded.size };
}

export function createLiveFragmentTransport(HlsClass: typeof Hls) {
  const started = new Set<string>();
  const Base = HlsClass.DefaultConfig.loader;
  class LiveFragmentLoader extends Base {
    declare context: FragmentLoaderContext | null;
    load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
      super.load(context, config, {
        ...callbacks,
        onSuccess(response, stats, loadedContext, networkDetails) {
          const frag = (loadedContext as FragmentLoaderContext).frag;
          if (frag?.type === 'main' && typeof frag.sn === 'number' && response.data instanceof ArrayBuffer) {
            const key = `${frag.cc}:${frag.level}`;
            if (!started.has(key)) {
              const result = removeLeadingPictures(response.data);
              if (result.videoFound) started.add(key);
              if (result.removedPackets) response = { ...response, data: result.data };
            }
          }
          callbacks.onSuccess(response, stats, loadedContext, networkDetails);
        },
      });
    }
  }
  return { fLoader: LiveFragmentLoader, reset: () => started.clear() };
}

// Failed sources are retried with a delay instead of an error overlay or an
// immediate MediaSource rebuild loop. One timer per player; disposed on exit.
export function createLiveMediaRecovery(hls: Hls, onWaiting: () => void = () => {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let lastFailure = 0;
  return {
    recover() {
      if (timer) return;
      const now = Date.now();
      if (now - lastFailure > 30_000) attempts = 0;
      lastFailure = now;
      const delay = attempts < 2 ? 0 : Math.min(15_000, 1000 * 2 ** Math.min(attempts - 2, 4));
      attempts++;
      hls.stopLoad(); onWaiting();
      timer = setTimeout(() => { timer = undefined; hls.recoverMediaError(); }, delay);
    },
    destroy() { if (timer) clearTimeout(timer); timer = undefined; },
  };
}
