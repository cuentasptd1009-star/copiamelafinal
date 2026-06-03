export interface ChannelEntry {
  id: number;
  streamUrl: string;
  name: string;
}

export interface MiniPlayerState {
  url: string;
  title: string;
  type: 'channel' | 'movie';
  movieId?: string | null;
  channelId?: number | null;
  streamFormat?: string | null;
  isMinimized: boolean;
  isFocused?: boolean;
  channels: ChannelEntry[];
  channelIndex: number;
}

let state: MiniPlayerState | null = null;
const listeners = new Set<() => void>();

export function getMiniPlayerState(): MiniPlayerState | null {
  return state;
}

export function setMiniPlayerState(s: MiniPlayerState | null) {
  state = s;
  listeners.forEach((fn) => fn());
}

export function updateMiniPlayerState(patch: Partial<MiniPlayerState>) {
  if (!state) return;
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function subscribeMiniPlayer(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
