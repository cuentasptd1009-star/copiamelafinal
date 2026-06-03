const BASE = (import.meta.env.VITE_API_URL || import.meta.env.BASE_URL || '').replace(/\/+$/, '');

/**
 * Base URL for all API calls.
 * In development: empty string (relative to current host).
 * In production with VITE_API_URL set: points to the backend host (e.g. Replit Deploy),
 * so API traffic goes to the backend server and NOT through Vercel.
 */
export const apiBase = BASE;

function getAuthHeader(): Record<string, string> {
  try {
    const path = window.location.pathname;
    const isAdmin = path.includes('/admin') || path.includes('/subadmin');
    if (isAdmin) {
      const adminToken = localStorage.getItem('supertv_admin_token');
      if (adminToken) return { Authorization: `Bearer ${adminToken}` };
    }
    const userToken = localStorage.getItem('supertv_token');
    if (userToken) return { Authorization: `Bearer ${userToken}` };
    const adminToken2 = localStorage.getItem('supertv_admin_token');
    if (adminToken2) return { Authorization: `Bearer ${adminToken2}` };
  } catch {}
  return {};
}

export interface SeriesItem {
  id: number;
  title: string;
  description?: string | null;
  poster?: string | null;
  banner?: string | null;
  category?: string | null;
  genre?: string | null;
  year?: number | null;
  featured: boolean;
  hidden: boolean;
  order: number;
  createdAt: string;
}

export interface Season {
  id: number;
  seriesId: number;
  seasonNumber: number;
  title?: string | null;
  poster?: string | null;
  createdAt: string;
  episodes: Episode[];
}

export interface Episode {
  id: number;
  seriesId: number;
  seasonId: number;
  episodeNumber: number;
  title: string;
  description?: string | null;
  filePath: string;
  thumbnail?: string | null;
  duration?: number | null;
  order: number;
  createdAt: string;
}

export interface SeriesDetail extends SeriesItem {
  seasons: Season[];
}

export async function fetchSeries(): Promise<SeriesItem[]> {
  const r = await fetch(`${BASE}/api/series`, { headers: getAuthHeader() });
  if (!r.ok) throw new Error('Failed to fetch series');
  return r.json();
}

export async function fetchAllSeries(): Promise<SeriesItem[]> {
  const r = await fetch(`${BASE}/api/series/all`, { headers: getAuthHeader() });
  if (!r.ok) throw new Error('Failed to fetch all series');
  return r.json();
}

export async function fetchSeriesDetail(id: number): Promise<SeriesDetail> {
  const r = await fetch(`${BASE}/api/series/${id}`, { headers: getAuthHeader() });
  if (!r.ok) throw new Error('Failed to fetch series detail');
  return r.json();
}

export async function createSeries(data: Partial<SeriesItem>): Promise<SeriesItem> {
  const r = await fetch(`${BASE}/api/series`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('Failed to create series');
  return r.json();
}

export async function updateSeries(id: number, data: Partial<SeriesItem>): Promise<SeriesItem> {
  const r = await fetch(`${BASE}/api/series/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('Failed to update series');
  return r.json();
}

export async function deleteSeries(id: number): Promise<void> {
  await fetch(`${BASE}/api/series/${id}`, { method: 'DELETE', headers: getAuthHeader() });
}

export async function createSeason(data: { seriesId: number; seasonNumber: number; title?: string; poster?: string }): Promise<Season> {
  const r = await fetch(`${BASE}/api/seasons`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('Failed to create season');
  return r.json();
}

export async function deleteSeason(id: number): Promise<void> {
  await fetch(`${BASE}/api/seasons/${id}`, { method: 'DELETE', headers: getAuthHeader() });
}

export async function createEpisode(data: Partial<Episode> & { seriesId: number; seasonId: number; title: string; filePath: string }): Promise<Episode> {
  const r = await fetch(`${BASE}/api/episodes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('Failed to create episode');
  return r.json();
}

export async function updateEpisode(id: number, data: Partial<Episode>): Promise<Episode> {
  const r = await fetch(`${BASE}/api/episodes/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('Failed to update episode');
  return r.json();
}

export async function deleteEpisode(id: number): Promise<void> {
  await fetch(`${BASE}/api/episodes/${id}`, { method: 'DELETE', headers: getAuthHeader() });
}

export async function scanSeriesFolder(url: string): Promise<{ baseUrl: string; items: Array<{ name: string; url: string; poster?: string; seasonCount?: number }> }> {
  const r = await fetch(`${BASE}/api/series/scan-folder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ url }),
  });
  if (!r.ok) throw new Error('Failed to scan folder');
  return r.json();
}

export async function scanMoviesFolder(url: string): Promise<{ items: Array<{ name: string; url: string; poster?: string }> }> {
  const r = await fetch(`${BASE}/api/movies/scan-folder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ url }),
  });
  if (!r.ok) throw new Error('Failed to scan folder');
  return r.json();
}

export async function scanSeriesSeasons(seriesId: number, url: string): Promise<{ success: boolean; seasonsCreated: number }> {
  const r = await fetch(`${BASE}/api/series/${seriesId}/scan-seasons`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ url }),
  });
  if (!r.ok) throw new Error('Failed to scan seasons');
  return r.json();
}

export async function searchSeriesPoster(id: number, query: string): Promise<{ poster: string | null; banner: string | null; title: string | null; year: number | null; genre: string | null; description: string | null }> {
  const r = await fetch(`${BASE}/api/series/${id}/poster-search?q=${encodeURIComponent(query)}`, { headers: getAuthHeader() });
  if (!r.ok) throw new Error('Failed to search poster');
  return r.json();
}
