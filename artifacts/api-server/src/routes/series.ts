import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { seriesTable, seasonsTable, episodesTable, accessCodesTable } from "@workspace/db";
import { eq, asc, ilike, desc, sql } from "drizzle-orm";
import { requireAdminAuth, extractToken, getUserSession, getAdminSession } from "../lib/auth.js";
import { cache, TTL } from "../lib/cache.js";

const router = Router();

function formatSeries(s: typeof seriesTable.$inferSelect) {
  return { ...s, createdAt: s.createdAt?.toISOString() ?? null };
}

async function checkAuth(req: Request, res: Response): Promise<boolean> {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return false; }
  const userSession = await getUserSession(token);
  const adminSession = await getAdminSession(token);
  if (!userSession && !adminSession) { res.status(401).json({ error: "Unauthorized" }); return false; }
  if (userSession) {
    const [code] = await db.select().from(accessCodesTable).where(eq(accessCodesTable.id, userSession.codeId)).limit(1);
    if (!code || !code.isActive) { res.status(401).json({ error: "Code inactive" }); return false; }
    if (code.expiresAt != null && code.expiresAt <= new Date()) { res.status(401).json({ error: "Code expired" }); return false; }
  }
  return true;
}

router.get("/series", async (req: Request, res: Response) => {
  if (!await checkAuth(req, res)) return;

  const cacheKey = `series:list`;
  const cached = cache.get<object[]>(cacheKey);
  if (cached) {
    res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    res.json(cached);
    return;
  }

  const all = await db.select().from(seriesTable)
    .where(eq(seriesTable.hidden, false))
    .orderBy(asc(seriesTable.order));

  const result = all.map(formatSeries);
  cache.set(cacheKey, result, TTL.MEDIUM);
  res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  res.json(result);
});

router.post("/series/:id/view", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userSession = await getUserSession(token);
  const adminSession = await getAdminSession(token);
  if (!userSession && !adminSession) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.update(seriesTable).set({ viewCount: sql`${seriesTable.viewCount} + 1` }).where(eq(seriesTable.id, id));
  cache.delete('series:list');
  res.json({ ok: true });
});

router.get("/series/all", requireAdminAuth, async (req: Request, res: Response) => {
  const all = await db.select().from(seriesTable).orderBy(asc(seriesTable.order));
  res.json(all.map(formatSeries));
});

router.get("/series/poster-search", requireAdminAuth, async (req: Request, res: Response) => {
  const title = (req.query.q as string || '').trim();
  if (!title) { res.json({ poster: null, banner: null, title: null, year: null, genre: null, description: null }); return; }
  const { getTmdbApiKey } = await import("./settings.js");
  const tmdbKey = await getTmdbApiKey();
  if (tmdbKey) {
    try {
      const url = `https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${encodeURIComponent(title)}&language=es-ES`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await r.json() as any;
      if (data.results?.[0]) {
        const s = data.results[0];
        const detail = s.id ? await (await fetch(`https://api.themoviedb.org/3/tv/${s.id}?api_key=${tmdbKey}&language=es-ES`, { signal: AbortSignal.timeout(6000) })).json() as any : null;
        res.json({
          poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
          banner: s.backdrop_path ? `https://image.tmdb.org/t/p/original${s.backdrop_path}` : null,
          title: s.name || title,
          year: s.first_air_date ? parseInt(s.first_air_date.split('-')[0]) : null,
          genre: detail?.genres?.[0]?.name ?? null,
          description: s.overview || null,
        });
        return;
      }
    } catch {}
  }
  res.json({ poster: null, banner: null, title: null, year: null, genre: null, description: null });
});

router.get("/series/:id", async (req: Request, res: Response) => {
  if (!await checkAuth(req, res)) return;
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const cacheKey = `series:detail:${id}`;
  const cached = cache.get<object>(cacheKey);
  if (cached) { res.json(cached); return; }

  const [s] = await db.select().from(seriesTable).where(eq(seriesTable.id, id)).limit(1);
  if (!s) { res.status(404).json({ error: "Not found" }); return; }

  const seasons = await db.select().from(seasonsTable)
    .where(eq(seasonsTable.seriesId, id))
    .orderBy(asc(seasonsTable.seasonNumber));

  const episodes = await db.select().from(episodesTable)
    .where(eq(episodesTable.seriesId, id))
    .orderBy(asc(episodesTable.order));

  const seasonsWithEpisodes = seasons.map(season => ({
    ...season,
    createdAt: season.createdAt?.toISOString() ?? null,
    episodes: episodes
      .filter(ep => ep.seasonId === season.id)
      .map(ep => ({ ...ep, createdAt: ep.createdAt?.toISOString() ?? null })),
  }));

  const result = { ...formatSeries(s), seasons: seasonsWithEpisodes };
  cache.set(cacheKey, result, TTL.MEDIUM);
  res.json(result);
});

router.post("/series", requireAdminAuth, async (req: Request, res: Response) => {
  const { title, description, poster, banner, category, genre, year, featured, hidden } = req.body;
  if (!title) { res.status(400).json({ error: "Title required" }); return; }
  const [created] = await db.insert(seriesTable).values({
    title, description, poster, banner, category, genre,
    year: year ? Number(year) : undefined,
    featured: !!featured,
    hidden: !!hidden,
  }).returning();
  cache.invalidatePrefix("series:");
  res.status(201).json(formatSeries(created));
});

router.put("/series/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { title, description, poster, banner, category, genre, year, featured, hidden, order } = req.body;
  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (poster !== undefined) patch.poster = poster;
  if (banner !== undefined) patch.banner = banner;
  if (category !== undefined) patch.category = category;
  if (genre !== undefined) patch.genre = genre;
  if (year !== undefined) patch.year = year ? Number(year) : null;
  if (featured !== undefined) patch.featured = !!featured;
  if (hidden !== undefined) patch.hidden = !!hidden;
  if (order !== undefined) patch.order = Number(order);
  const [updated] = await db.update(seriesTable).set(patch).where(eq(seriesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  cache.invalidatePrefix("series:");
  res.json(formatSeries(updated));
});

router.delete("/series/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(seriesTable).where(eq(seriesTable.id, id));
  cache.invalidatePrefix("series:");
  res.json({ success: true });
});

router.post("/series/reorder", requireAdminAuth, async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids must be an array" }); return; }
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(seriesTable).set({ order: i + 1 }).where(eq(seriesTable.id, ids[i]));
    }
  });
  cache.invalidatePrefix("series:");
  res.json({ success: true });
});

router.get("/series/:id/poster-search", requireAdminAuth, async (req: Request, res: Response) => {

  const title = (req.query.q as string || '').trim();
  if (!title) { res.json({ poster: null, banner: null, title: null, year: null, genre: null, description: null }); return; }
  const { getTmdbApiKey } = await import("./settings.js");
  const tmdbKey2 = await getTmdbApiKey();
  if (tmdbKey2) {
    try {
      const url = `https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey2}&query=${encodeURIComponent(title)}&language=es-ES`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await r.json() as any;
      if (data.results?.[0]) {
        const s = data.results[0];
        const detail = s.id ? await (await fetch(`https://api.themoviedb.org/3/tv/${s.id}?api_key=${tmdbKey2}&language=es-ES`, { signal: AbortSignal.timeout(6000) })).json() as any : null;
        res.json({
          poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
          banner: s.backdrop_path ? `https://image.tmdb.org/t/p/original${s.backdrop_path}` : null,
          title: s.name || title,
          year: s.first_air_date ? parseInt(s.first_air_date.split('-')[0]) : null,
          genre: detail?.genres?.[0]?.name ?? null,
          description: s.overview || null,
        });
        return;
      }
    } catch {}
  }
  res.json({ poster: null, banner: null, title: null, year: null, genre: null, description: null });
});

router.post("/series/scan-folder", requireAdminAuth, async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') { res.status(400).json({ error: "url required" }); return; }
  try {
    const baseUrl = url.endsWith('/') ? url : url + '/';
    const r = await fetch(baseUrl, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { res.status(400).json({ error: `Could not fetch URL: ${r.status}` }); return; }
    const html = await r.text();
    const links = extractLinksFromHtml(html, baseUrl);
    const seriesFolders = links.filter(l => l.isDir);
    const detected: Array<{name: string; url: string; poster?: string; seasonCount?: number}> = [];
    for (const folder of seriesFolders.slice(0, 50)) {
      try {
        const r2 = await fetch(folder.url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r2.ok) continue;
        const html2 = await r2.text();
        const inner = extractLinksFromHtml(html2, folder.url);
        const hasSeasons = inner.some(l => l.isDir && /season|temporada|temp|s\d+/i.test(l.name));
        const hasVideos = inner.some(l => !l.isDir && isVideo(l.name));
        const posterLink = inner.find(l => !l.isDir && /poster|cover|folder/i.test(l.name) && /\.(jpg|jpeg|png|webp)/i.test(l.name));
        if (hasSeasons || hasVideos) {
          detected.push({ name: folder.name, url: folder.url, poster: posterLink?.url, seasonCount: inner.filter(l => l.isDir).length });
        }
      } catch {}
    }
    res.json({ baseUrl, items: detected });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to scan' });
  }
});

router.post("/series/:seriesId/scan-seasons", requireAdminAuth, async (req: Request, res: Response) => {
  const seriesId = Number(req.params.seriesId);
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  try {
    const baseUrl = url.endsWith('/') ? url : url + '/';
    const r = await fetch(baseUrl, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { res.status(400).json({ error: `Could not fetch: ${r.status}` }); return; }
    const html = await r.text();
    const links = extractLinksFromHtml(html, baseUrl);
    const seasonFolders = links.filter(l => l.isDir && /season|temporada|temp|s\d+/i.test(l.name));
    const videoFiles = links.filter(l => !l.isDir && isVideo(l.name));
    const posterLink = links.find(l => !l.isDir && /poster|cover|folder/i.test(l.name) && /\.(jpg|jpeg|png|webp)/i.test(l.name));
    const bannerLink = links.find(l => !l.isDir && /banner|fanart|backdrop/i.test(l.name) && /\.(jpg|jpeg|png|webp)/i.test(l.name));
    const descFile = links.find(l => !l.isDir && /description\.txt|plot\.txt/i.test(l.name));

    const created: number[] = [];
    if (seasonFolders.length > 0) {
      for (let si = 0; si < seasonFolders.length; si++) {
        const sf = seasonFolders[si];
        const seasonNum = extractSeasonNumber(sf.name) ?? (si + 1);
        const [season] = await db.insert(seasonsTable).values({ seriesId, seasonNumber: seasonNum, title: `Temporada ${seasonNum}` }).returning();
        const r2 = await fetch(sf.url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r2.ok) {
          const html2 = await r2.text();
          const epLinks = extractLinksFromHtml(html2, sf.url).filter(l => !l.isDir && isVideo(l.name));
          for (let ei = 0; ei < epLinks.length; ei++) {
            const ep = epLinks[ei];
            const epNum = extractEpisodeNumber(ep.name) ?? (ei + 1);
            await db.insert(episodesTable).values({ seriesId, seasonId: season.id, episodeNumber: epNum, title: cleanTitle(ep.name), filePath: ep.url, order: ei });
          }
        }
        created.push(season.id);
      }
    } else if (videoFiles.length > 0) {
      const [season] = await db.insert(seasonsTable).values({ seriesId, seasonNumber: 1, title: 'Temporada 1' }).returning();
      for (let ei = 0; ei < videoFiles.length; ei++) {
        const ep = videoFiles[ei];
        const epNum = extractEpisodeNumber(ep.name) ?? (ei + 1);
        await db.insert(episodesTable).values({ seriesId, seasonId: season.id, episodeNumber: epNum, title: cleanTitle(ep.name), filePath: ep.url, order: ei });
      }
      created.push(season.id);
    }

    const updates: Record<string, unknown> = {};
    if (posterLink) updates.poster = posterLink.url;
    if (bannerLink) updates.banner = bannerLink.url;
    if (Object.keys(updates).length > 0) {
      await db.update(seriesTable).set(updates).where(eq(seriesTable.id, seriesId));
    }

    cache.invalidatePrefix("series:");
    res.json({ success: true, seasonsCreated: created.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed' });
  }
});

router.post("/seasons", requireAdminAuth, async (req: Request, res: Response) => {
  const { seriesId, seasonNumber, title, poster } = req.body;
  if (!seriesId || !seasonNumber) { res.status(400).json({ error: "seriesId and seasonNumber required" }); return; }
  const [created] = await db.insert(seasonsTable).values({ seriesId: Number(seriesId), seasonNumber: Number(seasonNumber), title, poster }).returning();
  cache.invalidatePrefix("series:");
  res.status(201).json({ ...created, createdAt: created.createdAt?.toISOString() ?? null });
});

router.put("/seasons/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const patch: Record<string, unknown> = {};
  if (req.body.seasonNumber !== undefined) patch.seasonNumber = Number(req.body.seasonNumber);
  if (req.body.title !== undefined) patch.title = req.body.title;
  if (req.body.poster !== undefined) patch.poster = req.body.poster;
  const [updated] = await db.update(seasonsTable).set(patch).where(eq(seasonsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  cache.invalidatePrefix("series:");
  res.json({ ...updated, createdAt: updated.createdAt?.toISOString() ?? null });
});

router.delete("/seasons/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await db.delete(seasonsTable).where(eq(seasonsTable.id, id));
  cache.invalidatePrefix("series:");
  res.json({ success: true });
});

router.post("/episodes", requireAdminAuth, async (req: Request, res: Response) => {
  const { seriesId, seasonId, episodeNumber, title, description, filePath, duration } = req.body;
  if (!seriesId || !seasonId || !title || !filePath) { res.status(400).json({ error: "Missing required fields" }); return; }
  const existing = await db.select({ count: episodesTable.id }).from(episodesTable).where(eq(episodesTable.seasonId, Number(seasonId)));
  const videoFormat = req.body.videoFormat ?? null;

  // Auto-use series poster as thumbnail for YouTube episodes when no thumbnail is provided
  let thumbnail = req.body.thumbnail || null;
  const isYoutube = /youtube\.com|youtu\.be/i.test(String(filePath));
  if (!thumbnail && isYoutube) {
    const [series] = await db.select({ poster: seriesTable.poster }).from(seriesTable).where(eq(seriesTable.id, Number(seriesId))).limit(1);
    if (series?.poster) thumbnail = series.poster;
  }

  const [created] = await db.insert(episodesTable).values({
    seriesId: Number(seriesId), seasonId: Number(seasonId),
    episodeNumber: episodeNumber ? Number(episodeNumber) : existing.length + 1,
    title, description, filePath, videoFormat, thumbnail,
    duration: duration ? Number(duration) : undefined,
    order: existing.length,
  }).returning();
  cache.invalidatePrefix("series:");
  res.status(201).json({ ...created, createdAt: created.createdAt?.toISOString() ?? null });
});

router.put("/episodes/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const patch: Record<string, unknown> = {};
  const fields = ['episodeNumber', 'title', 'description', 'filePath', 'videoFormat', 'thumbnail', 'duration', 'order'] as const;
  for (const f of fields) {
    if (req.body[f] !== undefined) patch[f === 'episodeNumber' ? 'episodeNumber' : f] = req.body[f];
  }
  const [updated] = await db.update(episodesTable).set(patch).where(eq(episodesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  cache.invalidatePrefix("series:");
  res.json({ ...updated, createdAt: updated.createdAt?.toISOString() ?? null });
});

router.delete("/episodes/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await db.delete(episodesTable).where(eq(episodesTable.id, id));
  cache.invalidatePrefix("series:");
  res.json({ success: true });
});

function extractLinksFromHtml(html: string, baseUrl: string): Array<{ name: string; url: string; isDir: boolean }> {
  const results: Array<{ name: string; url: string; isDir: boolean }> = [];
  const hrefRe = /href="([^"?#]+)"/gi;
  let m: RegExpExecArray | null;
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1];
    if (href.startsWith('/') && href === base.pathname) continue;
    if (href.startsWith('?') || href.startsWith('#') || href === '../' || href === './') continue;
    try {
      const fullUrl = new URL(href, baseUrl).href;
      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);
      const isDir = href.endsWith('/');
      const name = decodeURIComponent(href.replace(/\/$/, '').split('/').pop() || '');
      if (!name || name === '..') continue;
      results.push({ name, url: fullUrl, isDir });
    } catch {}
  }
  return results;
}

const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'm3u8', 'ts', 'flv', 'wmv', 'mpg', 'mpeg', 'mp2ts', 'divx', 'm4v']);
function isVideo(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? VIDEO_EXTS.has(ext) : false;
}

function extractSeasonNumber(name: string): number | null {
  const m = name.match(/(?:season|temporada|temp|s)[\s._-]*(\d+)/i) || name.match(/^(\d+)$/);
  return m ? parseInt(m[1]) : null;
}

function extractEpisodeNumber(name: string): number | null {
  const m = name.match(/(?:e|ep|episode|capitulo|cap|episodio)[\s._-]*(\d+)/i) || name.match(/[\s._-](\d{1,3})[\s._-]/);
  return m ? parseInt(m[1]) : null;
}

function cleanTitle(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default router;
