export interface WatchProgress {
  movieId: number;
  time: number;
  duration: number;
  updatedAt: number;
}

export interface EpisodeProgress {
  episodeId: number;
  seriesId: number;
  seasonId: number;
  time: number;
  duration: number;
  updatedAt: number;
}

export interface SeriesProgress {
  seriesId: number;
  seasonId: number;
  episodeId: number;
  episodeNumber: number;
  seasonNumber: number;
  episodeTitle?: string;
  time: number;
  duration: number;
  updatedAt: number;
}

export interface WatchRecord {
  movieId: number;
  category: string | null;
  updatedAt: number;
}

const P = 'supertv_';

export function saveProgress(movieId: number, time: number, duration: number): void {
  try {
    if (time < 10) return;
    if (duration > 0 && time / duration > 0.95) {
      localStorage.removeItem(`${P}prog_${movieId}`);
      return;
    }
    const data: WatchProgress = { movieId, time, duration, updatedAt: Date.now() };
    localStorage.setItem(`${P}prog_${movieId}`, JSON.stringify(data));
  } catch {}
}

export function getProgress(movieId: number): WatchProgress | null {
  try {
    const raw = localStorage.getItem(`${P}prog_${movieId}`);
    return raw ? (JSON.parse(raw) as WatchProgress) : null;
  } catch { return null; }
}

export function getAllProgress(): WatchProgress[] {
  try {
    const results: WatchProgress[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${P}prog_`)) {
        const raw = localStorage.getItem(key);
        if (raw) results.push(JSON.parse(raw) as WatchProgress);
      }
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

export function saveEpisodeProgress(
  seriesId: number,
  seasonId: number,
  seasonNumber: number,
  episodeId: number,
  episodeNumber: number,
  time: number,
  duration: number,
  episodeTitle?: string,
): void {
  try {
    if (time < 10) return;
    const ep: EpisodeProgress = { episodeId, seriesId, seasonId, time, duration, updatedAt: Date.now() };
    localStorage.setItem(`${P}eprog_${episodeId}`, JSON.stringify(ep));
    if (duration > 0 && time / duration > 0.95) {
      localStorage.removeItem(`${P}eprog_${episodeId}`);
    }
    const sp: SeriesProgress = { seriesId, seasonId, episodeId, episodeNumber, seasonNumber, time, duration, updatedAt: Date.now(), episodeTitle };
    localStorage.setItem(`${P}sprog_${seriesId}`, JSON.stringify(sp));
  } catch {}
}

export function getEpisodeProgress(episodeId: number): EpisodeProgress | null {
  try {
    const raw = localStorage.getItem(`${P}eprog_${episodeId}`);
    return raw ? (JSON.parse(raw) as EpisodeProgress) : null;
  } catch { return null; }
}

export function getSeriesProgress(seriesId: number): SeriesProgress | null {
  try {
    const raw = localStorage.getItem(`${P}sprog_${seriesId}`);
    return raw ? (JSON.parse(raw) as SeriesProgress) : null;
  } catch { return null; }
}

export function getAllSeriesProgress(): SeriesProgress[] {
  try {
    const results: SeriesProgress[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${P}sprog_`)) {
        const raw = localStorage.getItem(key);
        if (raw) results.push(JSON.parse(raw) as SeriesProgress);
      }
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

export function addToHistory(movieId: number, category: string | null): void {
  try {
    const existing = getHistory();
    const filtered = existing.filter(r => r.movieId !== movieId);
    filtered.unshift({ movieId, category, updatedAt: Date.now() });
    localStorage.setItem(`${P}history`, JSON.stringify(filtered.slice(0, 50)));
  } catch {}
}

export function getHistory(): WatchRecord[] {
  try {
    const raw = localStorage.getItem(`${P}history`);
    return raw ? (JSON.parse(raw) as WatchRecord[]) : [];
  } catch { return []; }
}

export function getFavorites(): number[] {
  try {
    const raw = localStorage.getItem(`${P}favorites`);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch { return []; }
}

export function toggleFavorite(movieId: number): boolean {
  const favs = getFavorites();
  const idx = favs.indexOf(movieId);
  if (idx === -1) {
    favs.unshift(movieId);
    try { localStorage.setItem(`${P}favorites`, JSON.stringify(favs)); } catch {}
    return true;
  } else {
    favs.splice(idx, 1);
    try { localStorage.setItem(`${P}favorites`, JSON.stringify(favs)); } catch {}
    return false;
  }
}

export function getSeriesFavorites(): number[] {
  try {
    const raw = localStorage.getItem(`${P}series_favorites`);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch { return []; }
}

export function toggleSeriesFavorite(seriesId: number): boolean {
  const favs = getSeriesFavorites();
  const idx = favs.indexOf(seriesId);
  if (idx === -1) {
    favs.unshift(seriesId);
    try { localStorage.setItem(`${P}series_favorites`, JSON.stringify(favs)); } catch {}
    return true;
  } else {
    favs.splice(idx, 1);
    try { localStorage.setItem(`${P}series_favorites`, JSON.stringify(favs)); } catch {}
    return false;
  }
}

export function getChannelFavorites(): number[] {
  try {
    const raw = localStorage.getItem(`${P}ch_favorites`);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch { return []; }
}

export function isChannelFavorite(channelId: number): boolean {
  return getChannelFavorites().includes(channelId);
}

export function toggleChannelFavorite(channelId: number): boolean {
  const favs = getChannelFavorites();
  const idx = favs.indexOf(channelId);
  if (idx === -1) {
    favs.unshift(channelId);
    try { localStorage.setItem(`${P}ch_favorites`, JSON.stringify(favs)); } catch {}
    return true;
  } else {
    favs.splice(idx, 1);
    try { localStorage.setItem(`${P}ch_favorites`, JSON.stringify(favs)); } catch {}
    return false;
  }
}

// ── External content (YouTube / Archive) ────────────────────────────────────

export interface ExternalItem {
  id: string;
  source: 'youtube' | 'archive';
  title: string;
  thumbnail: string;
  videoId?: string;
  url?: string;
  updatedAt: number;
}

export function getExternalFavorites(): ExternalItem[] {
  try {
    const raw = localStorage.getItem(`${P}ext_favorites`);
    return raw ? (JSON.parse(raw) as ExternalItem[]) : [];
  } catch { return []; }
}

export function isExternalFavorite(id: string): boolean {
  return getExternalFavorites().some(f => f.id === id);
}

export function toggleExternalFavorite(item: ExternalItem): boolean {
  const favs = getExternalFavorites();
  const idx = favs.findIndex(f => f.id === item.id);
  if (idx === -1) {
    favs.unshift({ ...item, updatedAt: Date.now() });
    try { localStorage.setItem(`${P}ext_favorites`, JSON.stringify(favs.slice(0, 100))); } catch {}
    return true;
  } else {
    favs.splice(idx, 1);
    try { localStorage.setItem(`${P}ext_favorites`, JSON.stringify(favs)); } catch {}
    return false;
  }
}

export function getExternalHistory(): ExternalItem[] {
  try {
    const raw = localStorage.getItem(`${P}ext_history`);
    return raw ? (JSON.parse(raw) as ExternalItem[]) : [];
  } catch { return []; }
}

export function addExternalHistory(item: ExternalItem): void {
  try {
    const history = getExternalHistory().filter(h => h.id !== item.id);
    history.unshift({ ...item, updatedAt: Date.now() });
    localStorage.setItem(`${P}ext_history`, JSON.stringify(history.slice(0, 50)));
  } catch {}
}

export function removeExternalHistory(id: string): void {
  try {
    const history = getExternalHistory().filter(h => h.id !== id);
    localStorage.setItem(`${P}ext_history`, JSON.stringify(history));
  } catch {}
}

export function clearExternalHistory(): void {
  try {
    localStorage.removeItem(`${P}ext_history`);
  } catch {}
}

// ── External content position progress ────────────────────────────────────────

export interface ExternalProgress {
  id: string;
  time: number;
  duration: number;
  updatedAt: number;
}

export function saveExternalProgress(id: string, time: number, duration: number): void {
  try {
    if (time < 10) return;
    if (duration > 0 && time / duration > 0.95) {
      localStorage.removeItem(`${P}extprog_${id}`);
      return;
    }
    const data: ExternalProgress = { id, time, duration, updatedAt: Date.now() };
    localStorage.setItem(`${P}extprog_${id}`, JSON.stringify(data));
  } catch {}
}

export function getExternalProgress(id: string): ExternalProgress | null {
  try {
    const raw = localStorage.getItem(`${P}extprog_${id}`);
    return raw ? (JSON.parse(raw) as ExternalProgress) : null;
  } catch { return null; }
}

export function clearExternalProgress(id: string): void {
  try { localStorage.removeItem(`${P}extprog_${id}`); } catch {}
}

// ── Search history ────────────────────────────────────────────────────────────

export function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(`${P}search_history`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

export function addSearchHistory(query: string): void {
  try {
    const q = query.trim();
    if (!q || q.length < 2) return;
    const history = getSearchHistory().filter(h => h.toLowerCase() !== q.toLowerCase());
    history.unshift(q);
    localStorage.setItem(`${P}search_history`, JSON.stringify(history.slice(0, 10)));
  } catch {}
}

export function removeSearchHistory(query: string): void {
  try {
    const history = getSearchHistory().filter(h => h !== query);
    localStorage.setItem(`${P}search_history`, JSON.stringify(history));
  } catch {}
}

export function clearSearchHistory(): void {
  try { localStorage.removeItem(`${P}search_history`); } catch {}
}
