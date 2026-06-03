import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { moviesTable, accessCodesTable } from "@workspace/db";
import { eq, asc, ilike, and, or, ne, sql } from "drizzle-orm";
import {
  CreateMovieBody,
  UpdateMovieBody,
  UpdateMovieParams,
  DeleteMovieParams,
  ListMoviesQueryParams,
} from "@workspace/api-zod";
import { requireAdminAuth, extractToken, getUserSession, getAdminSession } from "../lib/auth.js";
import { cache, TTL } from "../lib/cache.js";

const router = Router();

router.get("/movies", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

  const userSession = await getUserSession(token);
  const adminSession = await getAdminSession(token);
  if (!userSession && !adminSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (userSession) {
    const [code] = await db.select().from(accessCodesTable).where(eq(accessCodesTable.id, userSession.codeId)).limit(1);
    if (!code || !code.isActive) { res.status(401).json({ error: "Code inactive" }); return; }
    if (code.expiresAt != null && code.expiresAt <= new Date()) { res.status(401).json({ error: "Code expired" }); return; }
  }

  const parsed = ListMoviesQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};

  const cacheKey = `movies:list:${params.category ?? ""}:${params.search ?? ""}`;
  const cached = cache.get<object[]>(cacheKey);
  if (cached) {
    res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    res.json(cached);
    return;
  }

  const isAdmin = !!adminSession;

  let query = db.select().from(moviesTable).$dynamic();

  const hideHidden = !isAdmin ? ne(moviesTable.hidden, true) : undefined;

  if (params.category) {
    query = query.where(hideHidden ? and(eq(moviesTable.category, params.category), hideHidden) : eq(moviesTable.category, params.category));
  } else if (params.search) {
    query = query.where(hideHidden ? and(ilike(moviesTable.title, `%${params.search}%`), hideHidden) : ilike(moviesTable.title, `%${params.search}%`));
  } else if (hideHidden) {
    query = query.where(hideHidden);
  }

  const movies = await query.orderBy(asc(moviesTable.order));
  const result = movies.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }));

  cache.set(cacheKey, result, TTL.MEDIUM);
  res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  res.json(result);
});

router.post("/movies/:id/view", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userSession = await getUserSession(token);
  const adminSession = await getAdminSession(token);
  if (!userSession && !adminSession) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.update(moviesTable).set({ viewCount: sql`${moviesTable.viewCount} + 1` }).where(eq(moviesTable.id, id));
  cache.delete(`movies:list::`) ;
  res.json({ ok: true });
});

router.get("/movies/search-poster", requireAdminAuth, async (req: Request, res: Response) => {
  const title = (req.query.q as string || '').trim();
  if (!title) { res.json({ poster: null, title: null, year: null, genre: null, description: null }); return; }

  const { getTmdbApiKey } = await import("./settings.js");
  const tmdbKey = await getTmdbApiKey();
  if (tmdbKey) {
    try {
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(title)}&language=es-ES`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await r.json() as any;
      if (data.results?.[0]) {
        const m = data.results[0];
        res.json({
          poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
          banner: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null,
          title: m.title || title,
          year: m.release_date ? parseInt(m.release_date.split('-')[0]) : null,
          genre: m.genre_ids?.[0] ? null : null,
          description: m.overview || null,
        });
        return;
      }
    } catch {}
  }

  const omdbKey = process.env.OMDB_API_KEY;
  if (omdbKey) {
    try {
      const url = `https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${omdbKey}&type=movie`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await r.json() as any;
      if (data.Response === 'True') {
        res.json({
          poster: data.Poster !== 'N/A' ? data.Poster : null,
          banner: null,
          title: data.Title || title,
          year: data.Year ? parseInt(data.Year) : null,
          genre: data.Genre?.split(',')[0]?.trim() || null,
          description: data.Plot !== 'N/A' ? data.Plot : null,
        });
        return;
      }
    } catch {}
  }

  res.json({ poster: null, banner: null, title: null, year: null, genre: null, description: null });
});

router.post("/movies/scan-folder", requireAdminAuth, async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') { res.status(400).json({ error: "url required" }); return; }
  try {
    const baseUrl = url.endsWith('/') ? url : url + '/';
    const r = await fetch(baseUrl, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { res.status(400).json({ error: `Could not fetch URL: ${r.status}` }); return; }
    const html = await r.text();
    const links = extractLinksFromHtml(html, baseUrl);
    const videoFiles = links.filter(l => !l.isDir && isVideo(l.name));
    const subFolders = links.filter(l => l.isDir);
    const items: Array<{ name: string; url: string; poster?: string; inFolder?: string }> = [];
    for (const v of videoFiles) {
      items.push({ name: cleanTitle(v.name), url: v.url });
    }
    for (const folder of subFolders.slice(0, 30)) {
      try {
        const r2 = await fetch(folder.url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r2.ok) continue;
        const html2 = await r2.text();
        const inner = extractLinksFromHtml(html2, folder.url);
        const vids = inner.filter(l => !l.isDir && isVideo(l.name));
        const posterLink = inner.find(l => !l.isDir && /poster|cover|folder/i.test(l.name) && /\.(jpg|jpeg|png|webp)/i.test(l.name));
        for (const v of vids) {
          items.push({ name: cleanTitle(v.name), url: v.url, poster: posterLink?.url, inFolder: folder.name });
        }
      } catch {}
    }
    res.json({ baseUrl, items });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to scan' });
  }
});

const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'm3u8', 'ts', 'flv', 'wmv', 'mpg', 'mpeg', 'mp2ts', 'divx', 'm4v']);
function isVideo(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? VIDEO_EXTS.has(ext) : false;
}
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
function cleanTitle(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

router.post("/movies/reorder", requireAdminAuth, async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "ids must be an array" });
    return;
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(moviesTable).set({ order: i + 1 }).where(eq(moviesTable.id, ids[i]));
    }
  });
  cache.invalidatePrefix("movies:");
  res.json({ success: true });
});

router.post("/movies", requireAdminAuth, async (req: Request, res: Response) => {
  const parsed = CreateMovieBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [created] = await db.insert(moviesTable).values({
    title: parsed.data.title,
    filePath: parsed.data.filePath,
    videoFormat: (parsed.data as any).videoFormat ?? null,
    description: parsed.data.description ?? null,
    poster: parsed.data.poster ?? null,
    category: parsed.data.category ?? null,
    duration: parsed.data.duration ?? null,
  }).returning();
  cache.invalidatePrefix("movies:");
  res.status(201).json({ ...created, createdAt: created.createdAt.toISOString() });
});

router.put("/movies/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const params = UpdateMovieParams.safeParse(req.params);
  const body = UpdateMovieBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [updated] = await db
    .update(moviesTable)
    .set(body.data)
    .where(eq(moviesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  cache.invalidatePrefix("movies:");
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.patch("/movies/:id/hidden", requireAdminAuth, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const hidden = req.body?.hidden === true || req.body?.hidden === false ? Boolean(req.body.hidden) : true;
  const [updated] = await db.update(moviesTable).set({ hidden }).where(eq(moviesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  cache.invalidatePrefix("movies:");
  res.json({ success: true, id, hidden });
});

router.delete("/movies/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const parsed = DeleteMovieParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(moviesTable).where(eq(moviesTable.id, parsed.data.id));
  cache.invalidatePrefix("movies:");
  res.json({ success: true, message: "Deleted" });
});

export default router;
