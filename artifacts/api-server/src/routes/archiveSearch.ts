import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { moviesTable } from "@workspace/db";
import { requireAdminAuth } from "../lib/auth.js";

const router = Router();

const ARCHIVE_SEARCH = "https://archive.org/advancedsearch.php";
const ARCHIVE_META = "https://archive.org/metadata";

const VIDEO_PRIORITY = ["mp4", "mpeg4", "ogv", "avi", "mkv", "webm", "mov"];

// Spanish → English genre/keyword translations
const GENRE_MAP: Record<string, string> = {
  "acción": "action", "accion": "action",
  "comedia": "comedy", "comedias": "comedy",
  "terror": "horror", "miedo": "horror", "suspenso": "suspense", "suspenso": "thriller",
  "drama": "drama", "dramas": "drama",
  "romance": "romance", "romántica": "romance", "romantica": "romance", "amor": "love",
  "aventura": "adventure", "aventuras": "adventure",
  "animación": "animation", "animacion": "animation", "animada": "animation", "animadas": "animation",
  "ciencia ficción": "science fiction", "ciencia ficcion": "science fiction", "scifi": "sci-fi",
  "thriller": "thriller",
  "documental": "documentary", "documentales": "documentary",
  "western": "western",
  "fantasía": "fantasy", "fantasia": "fantasy",
  "misterio": "mystery",
  "policial": "crime", "crimen": "crime", "policíaca": "crime", "policiaca": "crime",
  "musical": "musical",
  "guerra": "war",
  "histórica": "historical", "historica": "historical", "historia": "history",
  "bélica": "war", "belica": "war",
  "infantil": "children", "niños": "children", "familia": "family",
  "clásica": "classic", "clasica": "classic", "clásico": "classic", "clasico": "classic",
  "muda": "silent", "mudo": "silent", "cine mudo": "silent film",
  "española": "spanish", "español": "spanish", "espanol": "spanish", "hispana": "hispanic",
  "mexicana": "mexican", "mexicano": "mexican", "argentina": "argentina", "argentino": "argentina",
  "latina": "latin", "latino": "latin", "latinoamericana": "latin america",
  "vaquero": "cowboy", "vaqueros": "western",
  "superhéroe": "superhero", "superheroe": "superhero",
  "biografía": "biography", "biopic": "biography",
  "espionaje": "spy", "espía": "spy",
  "psicológica": "psychological", "psicologica": "psychological",
  "sobrenatural": "supernatural",
  "vampiro": "vampire", "vampiros": "vampire",
  "zombie": "zombie", "zombies": "zombie",
  "mafia": "mafia", "gangster": "gangster",
  "boxeo": "boxing", "deporte": "sports", "deportes": "sports",
  "música": "music", "musica": "music",
};

// Spanish filler words to remove before searching
const FILLER_RE = /\b(peliculas?|películas?|pelis?|película|peli|de|del|en|las?|los?|un|una|el|la|quiero|ver|buscar|busco|hay|buenas?|mejores?|tipo|genero|género|año|años|anos?|busca|film|films|cine|movie|movies|sobre|con|para|que|es|son|muy|más|mas|todo|todos|toda|todas|alguna|algún|algun|donde|como|cual|cuales|disponibles?|gratuitas?|gratis|libre|libres)\b/gi;

function buildSmartQuery(raw: string): string {
  let q = raw.trim();

  // Replace multi-word Spanish phrases first (longest first to avoid partial matches)
  const multiWord = [
    ["ciencia ficción", "science fiction"],
    ["ciencia ficcion", "science fiction"],
    ["cine mudo", "silent film"],
  ];
  for (const [es, en] of multiWord) {
    q = q.replace(new RegExp(es, "gi"), en);
  }

  // Translate single Spanish genre/keyword words
  for (const [es, en] of Object.entries(GENRE_MAP)) {
    if (!es.includes(" ")) {
      q = q.replace(new RegExp(`\\b${es}\\b`, "gi"), en);
    }
  }

  // Remove filler words
  q = q.replace(FILLER_RE, " ").replace(/\s{2,}/g, " ").trim();

  // Fall back to original if everything was stripped
  if (!q || q.length < 2) {
    q = raw.trim();
  }

  // Build field-targeted query for better relevance:
  // search in title, subject (genre tags), and description
  const terms = q
    .split(/\s+/)
    .map(t => t.replace(/[^\w\s\-']/g, "").trim())
    .filter(t => t.length > 1);

  if (terms.length === 0) return q;

  if (terms.length === 1) {
    const t = terms[0];
    return `(title:${t} OR subject:${t} OR description:${t})`;
  }

  const phrase = terms.join(" ");
  const andTerms = terms.join(" AND ");
  return `(title:"${phrase}" OR title:(${andTerms}) OR subject:(${andTerms}) OR description:(${andTerms}))`;
}

// Block adult content at query level
const ADULT_FILTER =
  ' -subject:adult -subject:"adults only" -subject:porn -subject:pornography -subject:xxx -subject:erotic -subject:erotica -subject:"18+" -collection:erotica';

function sanitizeText(str: string, maxLen = 500): string {
  return str
    .replace(/<[^>]+>/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

function cleanIdentifier(id: string): string {
  return id.replace(/^\/+/, "").trim();
}

async function searchArchive(q: string, page: number, rows: number, lang?: string) {
  const params = new URLSearchParams();
  const langFilter = lang ? ` language:${lang}` : "";
  const smartQ = buildSmartQuery(q);
  params.set("q", `mediatype:movies${langFilter} ${smartQ}${ADULT_FILTER}`);
  params.append("fl[]", "identifier");
  params.append("fl[]", "title");
  params.append("fl[]", "description");
  params.append("fl[]", "year");
  params.append("fl[]", "creator");
  params.append("fl[]", "subject");
  params.set("rows", String(rows));
  params.set("start", String((page - 1) * rows));
  params.set("output", "json");
  params.append("sort[]", "downloads desc");

  const res = await fetch(`${ARCHIVE_SEARCH}?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Archive.org error: ${res.status}`);
  const data = await res.json();
  const docs: any[] = data.response?.docs || [];

  return docs.map((d: any) => ({
    ...d,
    identifier: cleanIdentifier(String(d.identifier || "")),
    description: d.description
      ? sanitizeText(String(Array.isArray(d.description) ? d.description[0] : d.description), 300)
      : undefined,
    title: d.title ? String(Array.isArray(d.title) ? d.title[0] : d.title) : d.identifier,
    year: d.year ? String(d.year) : undefined,
    creator: d.creator ? String(Array.isArray(d.creator) ? d.creator[0] : d.creator) : undefined,
    subject: d.subject
      ? (Array.isArray(d.subject) ? d.subject.slice(0, 4).join(", ") : String(d.subject))
      : undefined,
  }));
}

async function getItemVideo(identifier: string): Promise<{ url: string; format: string } | null> {
  const cleanId = cleanIdentifier(identifier);
  const res = await fetch(`${ARCHIVE_META}/${encodeURIComponent(cleanId)}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const files: any[] = data.files || [];

  for (const ext of VIDEO_PRIORITY) {
    const f = files.find(
      (f: any) =>
        typeof f.name === "string" &&
        f.name.toLowerCase().endsWith(`.${ext}`) &&
        f.source !== "metadata"
    );
    if (f) {
      return {
        url: `https://archive.org/download/${cleanId}/${encodeURIComponent(f.name)}`,
        format: "native",
      };
    }
  }
  return null;
}

router.get("/archive/search", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ items: [] });
    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const rows = Math.min(50, Math.max(1, parseInt(String(req.query.rows || "20"))));
    const lang = req.query.lang ? String(req.query.lang).trim() : undefined;
    const items = await searchArchive(q, page, rows, lang);
    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/archive/import", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { identifier, title, description, year, category } = req.body;
    if (!identifier) return res.status(400).json({ error: "identifier requerido" });

    const cleanId = cleanIdentifier(String(identifier));
    const video = await getItemVideo(cleanId);
    if (!video) {
      return res.status(404).json({
        error: `No se encontró archivo de video reproducible para "${cleanId}". Este item puede ser una colección o solo tener formatos no compatibles.`,
      });
    }

    const cleanTitle = sanitizeText(String(title || cleanId), 500);
    const cleanDesc = description ? sanitizeText(String(description), 1000) : null;
    const cleanYear = year ? parseInt(String(year)) || null : null;
    const cleanCategory = category ? String(category).slice(0, 200) : null;
    const poster = `https://archive.org/services/img/${cleanId}`;

    const [movie] = await db
      .insert(moviesTable)
      .values({
        title: cleanTitle,
        filePath: video.url,
        videoFormat: video.format,
        description: cleanDesc,
        poster,
        category: cleanCategory,
        year: cleanYear,
      })
      .returning();

    res.json({ movie });
  } catch (e: any) {
    const detail = (e?.cause as any)?.message ?? e?.cause ?? e.message;
    console.error("[archive/import] DB error:", String(detail));
    res.status(500).json({ error: String(detail) });
  }
});

export default router;
