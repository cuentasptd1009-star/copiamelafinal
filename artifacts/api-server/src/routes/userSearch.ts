import { Router, type Request, type Response } from "express";
import { requireUserAuth, requireAdminAuth, extractToken } from "../lib/auth.js";
import { db } from "@workspace/db";
import { adminSessionsTable, sessionsTable, accessCodesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Accepts either a valid admin session token OR a valid active user session token
async function requireAnyAuth(req: any, res: any, next: any) {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Try admin session first
  const adminSessions = await db.select().from(adminSessionsTable).where(eq(adminSessionsTable.token, token)).limit(1);
  if (adminSessions[0]) { req.adminSession = adminSessions[0]; return next(); }

  // Try user session
  const userSessions = await db.select().from(sessionsTable).where(eq(sessionsTable.token, token)).limit(1);
  if (userSessions[0]) {
    const codes = await db.select().from(accessCodesTable).where(eq(accessCodesTable.id, userSessions[0].codeId)).limit(1);
    const code = codes[0];
    if (code && code.isActive && (code.expiresAt == null || code.expiresAt > new Date())) {
      req.userSession = userSessions[0];
      return next();
    }
  }

  res.status(401).json({ error: "Unauthorized" });
}

const router = Router();

const YT_API = "https://www.googleapis.com/youtube/v3";
const ARCHIVE_SEARCH = "https://archive.org/advancedsearch.php";
const ARCHIVE_META = "https://archive.org/metadata";

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

const ADULT_RE = /\b(xxx|porno?|pornog\w*|sexo?|sexual\w*|er[oó]tic[ao]?|adulto?|nsfw|hentai|nude|desnud[ao]|naked|putit[ao]?|obscen\w*|escort|prostitu\w*)\b/i;

// Keywords that indicate the video is NOT a full movie
const JUNK_TITLE_RE = /\b(tr[aá]iler|trailer|reseña|resumen|cr[ií]tica|rese[nñ]a|review|rese[nñ]as|top\s*\d+|top\s*ten|ranking|explicado|explicaci[oó]n|escenas|escena|capitulo|cap[ií]tulo|episodio|temporada|parte\s*[12]|clip|making\s*of|behind|entrevista|interview|hablando|opinión|opinion|analisis|an[aá]lisis|banda\s*sonora|soundtrack|ost\b|temas?|song|songs|music\s*video|lyric|lyrics|en\s*\d+\s*minutos?|en\s*\d+\s*segundos?|anuncio|avance|promo\b|promotional|react\w*|vlog|shorts?\b|resumen\s*en|min\s*resumen|teaser|featurette|deleted\s*scene|blooper|gag\s*reel|fan\s*made|fanmade|fan\s*film|parody|parodia|vs\b|comparaci[oó]n|comparacion|documental\s*sobre|podcast|gaming|gameplay|speedrun)\b/i;

/**
 * Parse YouTube text duration like "1:23:45" or "45:23" into total minutes.
 * Returns -1 if unparseable.
 */
function parseDurationText(text: string): number {
  if (!text) return -1;
  const parts = text.trim().split(":").map(Number);
  if (parts.some(isNaN)) return -1;
  if (parts.length === 3) {
    // H:MM:SS
    return parts[0] * 60 + parts[1] + parts[2] / 60;
  }
  if (parts.length === 2) {
    // MM:SS
    return parts[0] + parts[1] / 60;
  }
  return -1;
}

/**
 * Returns true if the video looks like a real full-length movie.
 * Requires duration >= 60 minutes AND title doesn't contain junk keywords.
 */
function isLikelyFullMovie(title: string, durationText: string): boolean {
  if (JUNK_TITLE_RE.test(title)) return false;
  const minutes = parseDurationText(durationText);
  // If we have a duration, it must be at least 60 minutes
  if (minutes !== -1 && minutes < 60) return false;
  return true;
}

function sanitizeText(str: string, maxLen = 500): string {
  return str
    .replace(/<[^>]+>/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

function buildYouTubeQuery(raw: string, type: "movie" | "series" = "movie"): string {
  // Keep the query in Spanish — do NOT translate to English so YouTube returns Spanish-language titles
  let q = raw.trim();
  q = q.replace(FILLER_RE, " ").replace(/\s{2,}/g, " ").trim();
  if (!q || q.length < 2) q = raw.trim();
  if (type === "series") {
    if (!q.toLowerCase().includes("temporada") && !q.toLowerCase().includes("episodio") && !q.toLowerCase().includes("serie completa")) {
      q = `${q} serie completa`;
    }
  } else {
    if (!q.toLowerCase().includes("pelicula completa") && !q.toLowerCase().includes("película completa") && !q.toLowerCase().includes("full movie")) {
      q = `${q} pelicula completa`;
    }
  }
  return q;
}

function parseISODuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] || "0");
  const min = parseInt(m[2] || "0");
  if (h > 0) return `${h}h ${min}m`;
  if (min > 0) return `${min}m`;
  return "";
}

const ADULT_FILTER =
  ' -subject:adult -subject:"adults only" -subject:porn -subject:pornography -subject:xxx -subject:erotic -subject:erotica -subject:"18+" -collection:erotica';

function buildArchiveQuery(raw: string): string {
  const multiWord: [string, string][] = [
    ["ciencia ficción", "science fiction"],
    ["ciencia ficcion", "science fiction"],
    ["cine mudo", "silent film"],
  ];
  let q = raw.trim();
  for (const [es, en] of multiWord) q = q.replace(new RegExp(es, "gi"), en);
  for (const [es, en] of Object.entries(GENRE_MAP)) {
    if (!es.includes(" ")) q = q.replace(new RegExp(`\\b${es}\\b`, "gi"), en);
  }
  q = q.replace(FILLER_RE, " ").replace(/\s{2,}/g, " ").trim();
  if (!q || q.length < 2) q = raw.trim();
  const terms = q.split(/\s+/).map(t => t.replace(/[^\w\s\-']/g, "").trim()).filter(t => t.length > 1);
  if (terms.length === 0) return q;
  if (terms.length === 1) {
    const t = terms[0];
    return `(title:${t} OR subject:${t} OR description:${t})`;
  }
  const phrase = terms.join(" ");
  const andTerms = terms.join(" AND ");
  return `(title:"${phrase}" OR title:(${andTerms}) OR subject:(${andTerms}) OR description:(${andTerms}))`;
}

const VIDEO_PRIORITY = ["mp4", "mpeg4", "ogv", "avi", "mkv", "webm", "mov"];

function cleanIdentifier(id: string): string {
  return id.replace(/^\/+/, "").trim();
}

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const INNERTUBE_CONTEXT = {
  client: { clientName: "WEB", clientVersion: "2.20240101", hl: "es", gl: "MX" },
};

function extractVideosAndToken(data: any): { videos: any[]; continuationToken: string | null } {
  const contents: any[] =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents ??
    data?.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction?.continuationItems ??
    [];

  const videos: any[] = [];
  let continuationToken: string | null = null;

  for (const section of contents) {
    const items: any[] = section?.itemSectionRenderer?.contents ?? [];
    for (const item of items) {
      const vr = item?.videoRenderer;
      if (!vr || !vr.videoId) continue;
      const videoId: string = vr.videoId;
      const title: string = vr.title?.runs?.[0]?.text ?? "";
      const channel: string = vr.ownerText?.runs?.[0]?.text ?? "";
      const thumb: string = vr.thumbnail?.thumbnails?.slice(-1)[0]?.url?.split("?")[0] ?? "";
      const durText: string = vr.lengthText?.simpleText ?? "";
      videos.push({ videoId, title, thumbnail: thumb, channel, duration: durText });
    }
    // Grab continuation token from continuationItemRenderer
    const contItem = section?.continuationItemRenderer;
    if (contItem) {
      continuationToken =
        contItem?.continuationEndpoint?.continuationCommand?.token ??
        contItem?.button?.buttonRenderer?.command?.continuationCommand?.token ??
        null;
    }
  }
  return { videos, continuationToken };
}

async function youtubeInternalSearch(q: string, maxResults = 50): Promise<any[]> {
  // First page
  const firstRes = await fetch(
    `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ context: INNERTUBE_CONTEXT, query: q, params: "EgIQAQ%3D%3D" }),
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!firstRes.ok) return [];
  const firstData = await firstRes.json();
  const { videos, continuationToken } = extractVideosAndToken(firstData);

  // Fetch additional pages until we have enough or no more tokens
  let token = continuationToken;
  let page = 1;
  while (videos.length < maxResults && token && page < 4) {
    try {
      const contRes = await fetch(
        `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
          body: JSON.stringify({ context: INNERTUBE_CONTEXT, continuation: token }),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!contRes.ok) break;
      const contData = await contRes.json();
      const { videos: moreVideos, continuationToken: nextToken } = extractVideosAndToken(contData);
      videos.push(...moreVideos);
      token = nextToken;
      page++;
    } catch {
      break;
    }
  }

  return videos.slice(0, maxResults);
}

router.get("/user-search/youtube", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q || q.length < 2) return res.json({ items: [] });
    if (ADULT_RE.test(q)) return res.json({ items: [] });

    const contentType = req.query.type === "series" ? "series" : "movie";
    const smartQ = buildYouTubeQuery(q, contentType);

    const raw = await youtubeInternalSearch(smartQ, 50);
    if (raw.length === 0) return res.json({ items: [] });

    // For movies: sort so full-length films appear first, but keep ALL results
    const sorted = contentType === "movie"
      ? [
          ...raw.filter(v => isLikelyFullMovie(v.title, v.duration)),
          ...raw.filter(v => !isLikelyFullMovie(v.title, v.duration)),
        ]
      : raw;

    const items = sorted.map((v) => ({
      videoId: v.videoId,
      title: sanitizeText(v.title, 200),
      thumbnail: v.thumbnail,
      channel: sanitizeText(v.channel, 80),
      duration: v.duration,
    }));

    res.json({ items });
  } catch {
    res.json({ items: [] });
  }
});

// Admin-accessible YouTube search — direct query, no "full movie" transformation
router.get("/admin/youtube-search", requireAnyAuth, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q || q.length < 2) return res.json({ items: [] });
    if (ADULT_RE.test(q)) return res.json({ items: [] });

    // Admin search: use the query exactly as typed (no "full movie" appended)
    // so admin can find specific titles to import
    const raw = await youtubeInternalSearch(q, 50);
    if (raw.length === 0) return res.json({ items: [] });

    const items = raw.map((v) => ({
      videoId: v.videoId,
      title: sanitizeText(v.title, 200),
      thumbnail: v.thumbnail,
      channel: sanitizeText(v.channel, 80),
      duration: v.duration,
    }));

    res.json({ items });
  } catch {
    res.json({ items: [] });
  }
});

router.get("/user-search/archive", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q || q.length < 2) return res.json({ items: [] });
    if (ADULT_RE.test(q)) return res.json({ items: [] });

    const smartQ = buildArchiveQuery(q);

    const makeParams = (langFilter: string) => {
      const p = new URLSearchParams();
      p.set("q", `mediatype:movies${langFilter} ${smartQ}${ADULT_FILTER}`);
      p.append("fl[]", "identifier");
      p.append("fl[]", "title");
      p.append("fl[]", "year");
      p.append("fl[]", "creator");
      p.set("rows", "12");
      p.set("start", "0");
      p.set("output", "json");
      p.append("sort[]", "downloads desc");
      return p;
    };

    const mapDocs = (docs: any[]) => docs.map((d: any) => ({
      identifier: cleanIdentifier(String(d.identifier || "")),
      title: d.title ? String(Array.isArray(d.title) ? d.title[0] : d.title) : d.identifier,
      year: d.year ? String(d.year) : undefined,
      creator: d.creator ? String(Array.isArray(d.creator) ? d.creator[0] : d.creator) : undefined,
      thumbnail: `https://archive.org/services/img/${cleanIdentifier(String(d.identifier || ""))}`,
    })).filter((i: any) => i.identifier);

    // First try Spanish-language results
    const SPANISH_LANG = ` language:(spanish OR espanol OR español OR castellano)`;
    const res2 = await fetch(`${ARCHIVE_SEARCH}?${makeParams(SPANISH_LANG)}`, { signal: AbortSignal.timeout(12000) });
    if (!res2.ok) return res.json({ items: [] });
    const data2 = await res2.json();
    let docs: any[] = data2.response?.docs || [];

    // If Spanish returns fewer than 3 results, fall back to any language (broader search)
    if (docs.length < 3) {
      const resFallback = await fetch(`${ARCHIVE_SEARCH}?${makeParams("")}`, { signal: AbortSignal.timeout(12000) });
      if (resFallback.ok) {
        const dataFallback = await resFallback.json();
        docs = dataFallback.response?.docs || [];
      }
    }

    const items = mapDocs(docs);
    res.json({ items });
  } catch {
    res.json({ items: [] });
  }
});

router.get("/user-search/archive/video/:identifier", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const identifier = cleanIdentifier(String(req.params.identifier || ""));
    if (!identifier) return res.status(400).json({ error: "identifier requerido" });

    const metaRes = await fetch(`${ARCHIVE_META}/${encodeURIComponent(identifier)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!metaRes.ok) return res.status(404).json({ error: "No encontrado" });

    const data = await metaRes.json();
    const files: any[] = data.files || [];

    for (const ext of VIDEO_PRIORITY) {
      const f = files.find(
        (f: any) =>
          typeof f.name === "string" &&
          f.name.toLowerCase().endsWith(`.${ext}`) &&
          f.source !== "metadata"
      );
      if (f) {
        return res.json({
          url: `https://archive.org/download/${identifier}/${encodeURIComponent(f.name)}`,
          title: data.metadata?.title || identifier,
        });
      }
    }
    res.status(404).json({ error: "Sin video reproducible" });
  } catch {
    res.status(500).json({ error: "Error al obtener video" });
  }
});

export default router;
