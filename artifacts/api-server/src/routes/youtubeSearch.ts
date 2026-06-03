import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { moviesTable, seriesTable, seasonsTable, episodesTable } from "@workspace/db";
import { requireAdminAuth } from "../lib/auth.js";
import { cache } from "../lib/cache.js";

const router = Router();

const YT_API = "https://www.googleapis.com/youtube/v3";

// ── YouTube Innertube (no API key required) ───────────────────────────────────
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const INNERTUBE_CONTEXT = {
  client: { clientName: "WEB", clientVersion: "2.20240101", hl: "es", gl: "MX" },
};

function extractVideosFromSearch(data: any): any[] {
  const contents: any[] =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents ??
    data?.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction?.continuationItems ??
    [];
  const videos: any[] = [];
  for (const section of contents) {
    for (const item of section?.itemSectionRenderer?.contents ?? []) {
      const vr = item?.videoRenderer;
      if (!vr?.videoId) continue;
      videos.push({
        videoId: vr.videoId,
        title: vr.title?.runs?.[0]?.text ?? "",
        channel: vr.ownerText?.runs?.[0]?.text ?? "",
        thumbnail: vr.thumbnail?.thumbnails?.slice(-1)[0]?.url?.split("?")[0] ?? "",
        duration: vr.lengthText?.simpleText ?? "",
      });
    }
  }
  return videos;
}

function extractPlaylistsFromSearch(data: any): any[] {
  const contents: any[] =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents ??
    data?.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction?.continuationItems ??
    [];
  const playlists: any[] = [];
  for (const section of contents) {
    for (const item of section?.itemSectionRenderer?.contents ?? []) {
      const pr = item?.playlistRenderer;
      if (!pr?.playlistId) continue;
      playlists.push({
        playlistId: pr.playlistId,
        title: pr.title?.simpleText ?? "",
        channel: pr.longBylineText?.runs?.[0]?.text ?? pr.shortBylineText?.runs?.[0]?.text ?? "",
        thumbnail: pr.thumbnails?.[0]?.thumbnails?.slice(-1)?.[0]?.url?.split("?")?.[0] ?? "",
        episodeCount: parseInt(pr.videoCount ?? "0") || 0,
      });
    }
  }
  return playlists;
}

async function innertubeSearch(q: string, params: string): Promise<any> {
  const r = await fetch(
    `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ context: INNERTUBE_CONTEXT, query: q, params }),
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!r.ok) return null;
  return r.json();
}

/** Fetch all videos from a YouTube playlist using the innertube browse API (no API key) */
async function fetchPlaylistItemsInternal(
  playlistId: string,
  maxItems = 200,
): Promise<Array<{ videoId: string; title: string; thumbnail: string; position: number }>> {
  const items: Array<{ videoId: string; title: string; thumbnail: string; position: number }> = [];

  async function fetchPage(body: object): Promise<string | null> {
    const r = await fetch(
      `https://www.youtube.com/youtubei/v1/browse?key=${INNERTUBE_KEY}&prettyPrint=false`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok) return null;
    const data = await r.json() as any;

    // Extract video items — may be nested differently across responses
    const videoList: any[] =
      data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
        ?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents ??
      data?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction
        ?.continuationItems ?? [];

    let continuationToken: string | null = null;
    for (const item of videoList) {
      const pvr = item?.playlistVideoRenderer;
      if (pvr?.videoId) {
        const vid: string = pvr.videoId;
        const title: string = pvr.title?.runs?.[0]?.text ?? pvr.title?.simpleText ?? vid;
        const thumb: string =
          pvr.thumbnail?.thumbnails?.slice(-1)[0]?.url?.split("?")[0] ??
          `https://img.youtube.com/vi/${vid}/mqdefault.jpg`;
        const position: number =
          parseInt(pvr.index?.simpleText ?? String(items.length)) || items.length;
        if (title !== "Private video" && title !== "Deleted video") {
          items.push({ videoId: vid, title: sanitizeText(title, 300), thumbnail: thumb, position });
        }
      }
      if (item?.continuationItemRenderer) {
        continuationToken =
          item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ?? null;
      }
    }
    return continuationToken;
  }

  // First page
  let token = await fetchPage({ context: INNERTUBE_CONTEXT, browseId: `VL${playlistId}` });

  // Paginate
  let page = 0;
  while (token && items.length < maxItems && page < 5) {
    try {
      token = await fetchPage({ context: INNERTUBE_CONTEXT, continuation: token }) ?? null;
      page++;
    } catch { break; }
  }

  return items.sort((a, b) => a.position - b.position).slice(0, maxItems);
}

// Spanish → English genre/keyword translations (shared with archiveSearch logic)
const GENRE_MAP: Record<string, string> = {
  "acción": "action", "accion": "action",
  "comedia": "comedy", "comedias": "comedy",
  "terror": "horror", "miedo": "horror",
  "drama": "drama", "dramas": "drama",
  "romance": "romance", "romántica": "romance", "romantica": "romance", "amor": "love",
  "aventura": "adventure", "aventuras": "adventure",
  "animación": "animation", "animacion": "animation", "animada": "animation",
  "ciencia ficcion": "science fiction", "scifi": "sci-fi",
  "thriller": "thriller", "suspenso": "thriller",
  "documental": "documentary", "documentales": "documentary",
  "western": "western",
  "fantasía": "fantasy", "fantasia": "fantasy",
  "misterio": "mystery",
  "policial": "crime", "crimen": "crime",
  "musical": "musical",
  "guerra": "war",
  "histórica": "historical", "historica": "historical",
  "infantil": "children", "niños": "children", "familia": "family",
  "clásica": "classic", "clasica": "classic", "clásico": "classic", "clasico": "classic",
  "mexicana": "mexican", "mexicano": "mexican",
  "latina": "latin", "latino": "latin",
  "española": "spanish", "espanol": "spanish",
  "vampiro": "vampire", "zombies": "zombie",
  "mafia": "mafia", "gangster": "gangster",
  "boxeo": "boxing", "deporte": "sports",
  "música": "music", "musica": "music",
  "superhéroe": "superhero", "superheroe": "superhero",
  "biografía": "biography", "biopic": "biography",
  "espionaje": "spy",
  "psicológica": "psychological", "psicologica": "psychological",
};

const FILLER_RE = /\b(peliculas?|películas?|pelis?|de|del|en|las?|los?|un|una|el|la|quiero|ver|buscar|busco|hay|buenas?|mejores?|tipo|genero|género|año|años|anos?|busca|cine|sobre|con|para|que|es|son|muy|más|mas|todo|todos)\b/gi;

function buildYouTubeQuery(raw: string): string {
  let q = raw.trim();
  q = q.replace(/ciencia ficcion/gi, "science fiction");
  for (const [es, en] of Object.entries(GENRE_MAP)) {
    if (!es.includes(" ")) {
      q = q.replace(new RegExp(`\\b${es}\\b`, "gi"), en);
    }
  }
  q = q.replace(FILLER_RE, " ").replace(/\s{2,}/g, " ").trim();
  if (!q || q.length < 2) q = raw.trim();
  // Append "full movie" to bias results toward full films
  if (!q.toLowerCase().includes("full movie") && !q.toLowerCase().includes("pelicula completa")) {
    q = `${q} full movie`;
  }
  return q;
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s?#]+)/);
  return m ? m[1] : null;
}

function sanitizeText(str: string, maxLen = 500): string {
  return str
    .replace(/<[^>]+>/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

/**
 * Cleans a raw YouTube video title into something presentable.
 * Strips clickbait suffixes, filler phrases, emojis, year tags, quality tags, etc.
 * Examples:
 *   "Una PELÍCULA de ACCIÓN Que Te Quita La Respiración | EN ESPAÑOL COMPLETA HD 2024"
 *     → "Una Película De Acción Que Te Quita La Respiración"
 *   "EL CONJURO DEL MÁS ALLÁ 📽 Película Completa de Terror en Español Latino"
 *     → "El Conjuro Del Más Allá"
 */
function cleanYouTubeTitle(raw: string): string {
  if (!raw) return raw;
  let t = raw;

  // Remove emoji (Unicode ranges for emoticons, symbols, etc.)
  t = t.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE00}-\u{FEFF}]/gu, "");

  // Split at pipe and take the first chunk
  t = t.split("|")[0];

  // Split at " - " (with spaces) and take the first chunk if it's meaningful
  const dashIdx = t.indexOf(" - ");
  if (dashIdx > 6) t = t.slice(0, dashIdx);

  // Remove content inside brackets/parentheses (often "(2024)", "[HD]", etc.)
  t = t.replace(/[\[(][^\])]*(HD|4K|720p|1080p|completa?|full|español|latino|doblad|subtitulad|20[0-2]\d|19\d{2})[^\])]*/gi, "");
  t = t.replace(/[\[(][^\])]{1,40}[\])]/g, "");

  // Remove common filler phrases (order matters — longer phrases first)
  const FILLER = [
    /película[s]?\s+completa[s]?\s+en\s+español(\s+latino)?/gi,
    /pelicula[s]?\s+completa[s]?\s+en\s+español(\s+latino)?/gi,
    /película[s]?\s+completa[s]?/gi,
    /pelicula[s]?\s+completa[s]?/gi,
    /full\s+movie/gi,
    /en\s+español\s+latino/gi,
    /en\s+español/gi,
    /español\s+latino/gi,
    /\bespañol\b/gi,
    /\blatino\b/gi,
    /\bdoblada?\b/gi,
    /\bsubtitulada?\b/gi,
    /\bsubtitled?\b/gi,
    /\bcompleta?\b/gi,
    /\bgratis\b/gi,
    /\boficial\b/gi,
    /\btrailer\b/gi,
    /\b4k\b/gi,
    /\b1080p\b/gi,
    /\b720p\b/gi,
    /\bhd\b/gi,
    /\bfull\b/gi,
    /\bmira\b/gi,
    /\bver\b/gi,
    /\b20[0-2]\d\b/g,
    /\b19[5-9]\d\b/g,
  ];
  for (const re of FILLER) {
    t = t.replace(re, " ");
  }

  // Collapse whitespace
  t = t.replace(/\s{2,}/g, " ").trim();

  // Remove trailing punctuation left behind
  t = t.replace(/[|\-–—:,]+$/, "").trim();

  // Title-case (capitalize first letter of each word)
  t = t
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // If result is too short or empty, return sanitized original
  return t.length > 2 ? t : sanitizeText(raw, 300);
}

function parseISODuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] || "0");
  const min = parseInt(m[2] || "0");
  const sec = parseInt(m[3] || "0");
  if (h > 0) return `${h}h ${min}m`;
  if (min > 0) return `${min}m`;
  return `${sec}s`;
}

router.get("/youtube/search", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "YOUTUBE_API_KEY no configurada. Ve a Secrets del proyecto y agrega tu clave de YouTube Data API v3.",
        needsKey: true,
      });
    }

    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ items: [] });

    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const pageToken = String(req.query.pageToken || "");
    const lang = req.query.lang ? String(req.query.lang).trim() : "";

    const smartQ = buildYouTubeQuery(q);

    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "video",
      q: smartQ,
      safeSearch: "strict",
      videoDuration: "long",
      maxResults: "20",
      key: apiKey,
    });
    if (pageToken) searchParams.set("pageToken", pageToken);
    if (lang) searchParams.set("relevanceLanguage", lang.slice(0, 2));

    const searchRes = await fetch(`${YT_API}/search?${searchParams}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!searchRes.ok) {
      const errBody = await searchRes.json().catch(() => ({}));
      const msg = errBody?.error?.message || `YouTube API error: ${searchRes.status}`;
      return res.status(500).json({ error: msg });
    }
    const searchData = await searchRes.json();
    const searchItems: any[] = searchData.items || [];
    const nextPageToken: string = searchData.nextPageToken || "";

    if (searchItems.length === 0) return res.json({ items: [], nextPageToken });

    // Fetch duration for each video
    const videoIds = searchItems.map((i: any) => i.id?.videoId).filter(Boolean).join(",");
    const detailParams = new URLSearchParams({ part: "contentDetails", id: videoIds, key: apiKey });
    const detailRes = await fetch(`${YT_API}/videos?${detailParams}`, {
      signal: AbortSignal.timeout(10000),
    });
    const detailData = detailRes.ok ? await detailRes.json() : { items: [] };
    const durationMap: Record<string, string> = {};
    for (const v of detailData.items || []) {
      durationMap[v.id] = parseISODuration(v.contentDetails?.duration || "");
    }

    const items = searchItems.map((item: any) => {
      const videoId: string = item.id?.videoId || "";
      const snippet = item.snippet || {};
      const year = snippet.publishedAt ? new Date(snippet.publishedAt).getFullYear() : undefined;
      return {
        videoId,
        title: cleanYouTubeTitle(sanitizeText(snippet.title || "", 300)),
        description: sanitizeText(snippet.description || "", 300),
        thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
        channel: sanitizeText(snippet.channelTitle || "", 100),
        year: year ? String(year) : undefined,
        duration: durationMap[videoId] || "",
        url: `https://www.youtube.com/watch?v=${videoId}`,
      };
    });

    res.json({ items, nextPageToken });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── YouTube Video Info (oEmbed — no API key needed) ──────────────────────────

router.get("/youtube/video-info", requireAdminAuth, async (req: Request, res: Response) => {
  const url = String(req.query.url || "").trim();
  if (!url) return res.status(400).json({ error: "url requerida" });

  const videoId = extractYouTubeId(url);
  if (!videoId) return res.status(400).json({ error: "URL de YouTube inválida. Usa youtube.com/watch?v=... o youtu.be/..." });

  try {
    // oEmbed doesn't require an API key
    // 200 = public & embeddable, 401 = exists but embedding disabled, 404 = not found/private
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(10000) });

    if (oembedRes.status === 401 || oembedRes.status === 403) {
      // Video exists but author disabled embedding — will show "Video no disponible" in players
      return res.json({
        videoId,
        title: null,
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        thumbnailHQ: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        channel: null,
        description: null,
        year: null,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        embeddingDisabled: true,
      });
    }

    if (!oembedRes.ok) {
      return res.json({
        videoId,
        title: null,
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        thumbnailHQ: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        channel: null,
        description: null,
        year: null,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        notFound: true,
      });
    }

    const oembed = await oembedRes.json() as any;

    let description: string | null = null;
    let year: string | null = null;

    // If YOUTUBE_API_KEY is set, also fetch description & published date
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
      try {
        const detailParams = new URLSearchParams({ part: "snippet", id: videoId, key: apiKey });
        const detailRes = await fetch(`${YT_API}/videos?${detailParams}`, { signal: AbortSignal.timeout(10000) });
        if (detailRes.ok) {
          const detailData = await detailRes.json() as any;
          const snippet = detailData.items?.[0]?.snippet;
          if (snippet) {
            description = sanitizeText(snippet.description || "", 500) || null;
            year = snippet.publishedAt ? String(new Date(snippet.publishedAt).getFullYear()) : null;
          }
        }
      } catch { /* ignore */ }
    }

    res.json({
      videoId,
      title: cleanYouTubeTitle(sanitizeText(oembed.title || "", 300)),
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      thumbnailHQ: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      channel: sanitizeText(oembed.author_name || "", 100),
      description,
      year,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/youtube/import", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { videoId, title, description, year, category, thumbnail } = req.body;
    if (!videoId) return res.status(400).json({ error: "videoId requerido" });

    const cleanTitle = cleanYouTubeTitle(sanitizeText(String(title || videoId), 500));
    const cleanDesc = description ? sanitizeText(String(description), 1000) : null;
    const cleanYear = year ? parseInt(String(year)) || null : null;
    const cleanCategory = category ? String(category).slice(0, 200) : null;
    const poster = thumbnail ? String(thumbnail) : `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    const filePath = `https://www.youtube.com/watch?v=${videoId}`;

    const [movie] = await db
      .insert(moviesTable)
      .values({
        title: cleanTitle,
        filePath,
        videoFormat: "youtube",
        description: cleanDesc,
        poster,
        category: cleanCategory,
        year: cleanYear,
      })
      .returning();

    cache.invalidatePrefix("movies:");
    res.json({ movie });
  } catch (e: any) {
    const detail = (e?.cause as any)?.message ?? e?.cause ?? e.message;
    console.error("[youtube/import] DB error:", String(detail));
    res.status(500).json({ error: String(detail) });
  }
});

// ── YouTube Playlist Importer ─────────────────────────────────────────────────

function extractPlaylistId(url: string): string | null {
  const m = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Fetch up to maxItems playlist video entries (handles pagination) */
async function fetchPlaylistItems(playlistId: string, apiKey: string, maxItems = 200): Promise<Array<{ videoId: string; title: string; thumbnail: string; position: number }>> {
  const items: Array<{ videoId: string; title: string; thumbnail: string; position: number }> = [];
  let pageToken = "";
  while (items.length < maxItems) {
    const params = new URLSearchParams({
      part: "snippet",
      playlistId,
      maxResults: "50",
      key: apiKey,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await fetch(`${YT_API}/playlistItems?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) break;
    const data = await r.json() as any;
    for (const it of data.items || []) {
      const sn = it.snippet || {};
      const vid = sn.resourceId?.videoId;
      if (!vid || sn.title === "Private video" || sn.title === "Deleted video") continue;
      items.push({
        videoId: vid,
        title: sanitizeText(sn.title || vid, 300),
        thumbnail: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || `https://img.youtube.com/vi/${vid}/mqdefault.jpg`,
        position: sn.position ?? items.length,
      });
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return items.sort((a, b) => a.position - b.position);
}

// Preview: return playlist info + video list without importing
router.get("/youtube/playlist-preview", requireAdminAuth, async (req: Request, res: Response) => {
  const url = String(req.query.url || "").trim();
  const playlistId = extractPlaylistId(url);
  if (!playlistId) return res.status(400).json({ error: "URL de playlist inválida. Debe contener ?list=..." });

  try {
    // Try innertube first (no API key needed)
    const items = await fetchPlaylistItemsInternal(playlistId, 200);

    if (items.length === 0) {
      // Fall back to YouTube Data API if key is available
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (apiKey) {
        const metaParams = new URLSearchParams({ part: "snippet", id: playlistId, key: apiKey });
        const metaRes = await fetch(`${YT_API}/playlists?${metaParams}`, { signal: AbortSignal.timeout(10000) });
        if (metaRes.ok) {
          const metaData = await metaRes.json() as any;
          const playlist = metaData.items?.[0];
          if (playlist) {
            const sn = playlist.snippet || {};
            const apiItems = await fetchPlaylistItems(playlistId, apiKey, 200);
            return res.json({
              playlistId,
              title: sanitizeText(sn.title || "", 300),
              description: sanitizeText(sn.description || "", 500),
              thumbnail: sn.thumbnails?.medium?.url || sn.thumbnails?.standard?.url || "",
              channelTitle: sanitizeText(sn.channelTitle || "", 100),
              itemCount: apiItems.length,
              items: apiItems,
            });
          }
        }
      }
      return res.status(404).json({ error: "Playlist no encontrada, vacía o privada" });
    }

    const firstThumb = items[0]?.thumbnail ?? "";
    res.json({
      playlistId,
      title: "",
      description: "",
      thumbnail: firstThumb,
      channelTitle: "",
      itemCount: items.length,
      items,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Import: create series + season + all episodes from playlist
router.post("/youtube/import-playlist", requireAdminAuth, async (req: Request, res: Response) => {
  const { playlistId, title, description, poster, banner, category, genre, year } = req.body;
  if (!playlistId) return res.status(400).json({ error: "playlistId requerido" });
  if (!title) return res.status(400).json({ error: "title requerido" });

  try {
    // Try innertube first (no API key needed), fall back to official API if available
    let items = await fetchPlaylistItemsInternal(playlistId, 200);
    if (items.length === 0) {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (apiKey) items = await fetchPlaylistItems(playlistId, apiKey, 200);
    }
    if (items.length === 0) return res.status(400).json({ error: "La playlist está vacía o es privada" });

    // Create series
    const [series] = await db.insert(seriesTable).values({
      title: sanitizeText(String(title), 500),
      description: description ? sanitizeText(String(description), 1000) : null,
      poster: poster || items[0].thumbnail,
      banner: banner || null,
      category: category ? String(category).slice(0, 200) : null,
      genre: genre ? String(genre).slice(0, 100) : null,
      year: year ? parseInt(String(year)) || null : null,
    }).returning();

    // Create Season 1
    const [season] = await db.insert(seasonsTable).values({
      seriesId: series.id,
      seasonNumber: 1,
      title: "Temporada 1",
    }).returning();

    // Create episodes — all share the series poster as thumbnail
    const episodeThumbnail = series.poster || items[0]?.thumbnail || null;
    for (let i = 0; i < items.length; i++) {
      const ep = items[i];
      await db.insert(episodesTable).values({
        seriesId: series.id,
        seasonId: season.id,
        episodeNumber: i + 1,
        title: ep.title,
        filePath: `https://www.youtube.com/watch?v=${ep.videoId}`,
        videoFormat: "youtube",
        thumbnail: episodeThumbnail,
        order: i,
      });
    }

    cache.invalidatePrefix("series:");
    res.json({ series, seasonId: season.id, episodesCreated: items.length });
  } catch (e: any) {
    const detail = (e?.cause as any)?.message ?? e?.cause ?? e.message;
    console.error("[youtube/import-playlist] error:", String(detail));
    res.status(500).json({ error: String(detail) });
  }
});

// ── YouTube Series Search (playlists + full-series videos) ───────────────────

function buildSeriesVideoQuery(raw: string): string {
  let q = raw.trim();
  for (const [es, en] of Object.entries(GENRE_MAP)) {
    if (!es.includes(" ")) {
      q = q.replace(new RegExp(`\\b${es}\\b`, "gi"), en);
    }
  }
  const SERIES_FILLER = /\b(series?|serie|temporada|temporadas|episodios?|cap[ií]tulos?|ver|buscar|quiero|hay|buenas?|mejores?)\b/gi;
  q = q.replace(SERIES_FILLER, " ").replace(/\s{2,}/g, " ").trim();
  if (!q || q.length < 2) q = raw.trim();
  // Bias toward full-series videos
  if (!q.toLowerCase().includes("temporada") && !q.toLowerCase().includes("season")) {
    q = `${q} serie completa temporadas`;
  }
  return q;
}

router.get("/youtube/series-search", requireAdminAuth, async (req: Request, res: Response) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ playlists: [], videos: [] });

  try {
    // Search playlists and videos in parallel using innertube (no API key needed)
    // EgIQBA%3D%3D = playlists filter, EgIQAQ%3D%3D = videos filter
    const [playlistData, videoData] = await Promise.all([
      innertubeSearch(q, "EgIQBA%3D%3D"),
      innertubeSearch(buildSeriesVideoQuery(q), "EgIQAQ%3D%3D"),
    ]);

    const rawPlaylists = playlistData ? extractPlaylistsFromSearch(playlistData) : [];
    const rawVideos = videoData ? extractVideosFromSearch(videoData) : [];

    const playlists = rawPlaylists.map((p) => ({
      playlistId: p.playlistId,
      title: sanitizeText(p.title, 300),
      description: "",
      thumbnail: p.thumbnail || `https://img.youtube.com/vi/default/mqdefault.jpg`,
      channel: sanitizeText(p.channel, 100),
      episodeCount: p.episodeCount,
      url: `https://www.youtube.com/playlist?list=${p.playlistId}`,
    }));

    const videos = rawVideos.map((v) => ({
      videoId: v.videoId,
      title: sanitizeText(v.title, 300),
      description: "",
      thumbnail: v.thumbnail || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`,
      channel: sanitizeText(v.channel, 100),
      duration: v.duration || "",
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
    }));

    res.json({ playlists, videos });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Import single YouTube video as a series (1 season, 1 episode) ─────────────
router.post("/youtube/import-video-as-series", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { videoId, title, description, poster, category, genre, year } = req.body;
    if (!videoId) return res.status(400).json({ error: "videoId requerido" });
    if (!title) return res.status(400).json({ error: "title requerido" });

    const cleanTitle = sanitizeText(String(title), 500);
    const cleanDesc = description ? sanitizeText(String(description), 1000) : null;
    const cleanYear = year ? parseInt(String(year)) || null : null;
    const cleanCategory = category ? String(category).slice(0, 200) : null;
    const cleanGenre = genre ? String(genre).slice(0, 100) : null;
    const thumb = poster || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    const filePath = `https://www.youtube.com/watch?v=${videoId}`;

    const [series] = await db.insert(seriesTable).values({
      title: cleanTitle,
      description: cleanDesc,
      poster: thumb,
      category: cleanCategory,
      genre: cleanGenre,
      year: cleanYear,
    }).returning();

    const [season] = await db.insert(seasonsTable).values({
      seriesId: series.id,
      seasonNumber: 1,
      title: "Temporada 1",
    }).returning();

    await db.insert(episodesTable).values({
      seriesId: series.id,
      seasonId: season.id,
      episodeNumber: 1,
      title: cleanTitle,
      filePath,
      videoFormat: "youtube",
      thumbnail: thumb,
      order: 0,
    });

    cache.invalidatePrefix("series:");
    res.json({ series, seasonId: season.id, episodesCreated: 1 });
  } catch (e: any) {
    const detail = (e?.cause as any)?.message ?? e?.cause ?? e.message;
    res.status(500).json({ error: String(detail) });
  }
});

export default router;
