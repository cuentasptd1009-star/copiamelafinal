import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { moviesTable, seriesTable, seasonsTable, episodesTable } from "@workspace/db";
import { asc } from "drizzle-orm";
import { requireAdminAuth } from "../lib/auth.js";
import { cache } from "../lib/cache.js";

const router = Router();

const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'ts', 'flv', 'wmv', 'mpg', 'mpeg', 'm4v', 'm3u8', 'divx', 'mp2ts', 'rmvb', 'rm', '3gp', 'ogv', 'vob', 'asf', 'm2ts', 'mts']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

function isVideo(name: string) {
  return VIDEO_EXTS.has(name.split('.').pop()?.toLowerCase() ?? '');
}
function isImage(name: string) {
  return IMAGE_EXTS.has(name.split('.').pop()?.toLowerCase() ?? '');
}
// Strip only the file extension — keep the exact filename as the title
function cleanTitle(name: string) {
  return name.replace(/\.[^.]+$/, '').trim();
}
function extractShortcode(url: string): string | null {
  const m = url.match(/\/s\/([A-Za-z0-9_\-]+)/);
  return m ? m[1] : null;
}
function detectSeasonEp(name: string): { season: number; episode: number } | null {
  const m = name.match(/[Ss](\d{1,2})[Ee](\d{1,3})|(\d{1,2})x(\d{1,3})|[Tt]emporada[\s_\-]*(\d+).*[Ee]pisodio[\s_\-]*(\d+)/i);
  if (!m) return null;
  if (m[1] && m[2]) return { season: parseInt(m[1]), episode: parseInt(m[2]) };
  if (m[3] && m[4]) return { season: parseInt(m[3]), episode: parseInt(m[4]) };
  if (m[5] && m[6]) return { season: parseInt(m[5]), episode: parseInt(m[6]) };
  return null;
}
function detectSeasonFolder(name: string): number | null {
  const m = name.match(/[Ss]eason[\s_\-]*(\d+)|[Tt]emporada[\s_\-]*(\d+)|^[Ss](\d{1,2})$/i);
  if (!m) return null;
  return parseInt(m[1] || m[2] || m[3]);
}

interface TeraFile {
  fs_id: string;
  server_filename: string;
  isdir: number;
  size: number;
  dlink?: string;
  thumbs?: { url1?: string; url2?: string; url3?: string };
  list?: TeraFile[];
}

async function fetchTeraboxListing(shortcode: string, dir?: string, token?: string): Promise<{ list: TeraFile[]; uk?: string; shareid?: string; token?: string } | null> {
  try {
    const infoUrl = `https://1024terabox.com/api/shorturlinfo?shorturl=${shortcode}&root=1`;
    const infoRes = await fetch(infoUrl, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, */*',
        'Referer': 'https://1024terabox.com/',
      }
    });
    if (!infoRes.ok) return null;
    const info = await infoRes.json() as any;
    if (info.errno !== 0 || !info.list) return null;
    return { list: info.list, uk: info.uk, shareid: info.shareid, token: info.token };
  } catch {
    return null;
  }
}

async function fetchSubfolder(shortcode: string, uk: string, shareid: string, accessToken: string, dirPath: string): Promise<TeraFile[]> {
  try {
    const url = `https://1024terabox.com/api/shorturlinfo?shorturl=${shortcode}&root=0&dir=${encodeURIComponent(dirPath)}&uk=${uk}&shareid=${shareid}&t=${accessToken}`;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, */*',
        'Referer': 'https://1024terabox.com/',
      }
    });
    if (!r.ok) return [];
    const data = await r.json() as any;
    return data.list || [];
  } catch {
    return [];
  }
}

interface AnalyzedItem {
  name: string;
  url: string;
  poster?: string;
  size?: number;
  season?: number;
  episode?: number;
  folderName?: string;
  fsId?: string;
}

interface AnalyzeResult {
  type: 'movie' | 'series' | 'mixed';
  title: string;
  items: AnalyzedItem[];
  seasons?: Record<number, AnalyzedItem[]>;
  poster?: string;
  totalFiles: number;
  hasFolders: boolean;
}

router.post("/terabox/analyze", requireAdminAuth, async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') { res.status(400).json({ error: "URL requerida" }); return; }

  const shortcode = extractShortcode(url);
  if (!shortcode) { res.status(400).json({ error: "URL de Terabox inválida. Formato: https://1024terabox.com/s/XXXXX" }); return; }

  const listing = await fetchTeraboxListing(shortcode);
  if (!listing) { res.status(400).json({ error: "No se pudo acceder al enlace. Verifica que sea público y válido." }); return; }

  const { list, uk, shareid, token } = listing;

  const videos: TeraFile[] = [];
  const images: TeraFile[] = [];
  const folders: TeraFile[] = [];

  for (const f of list) {
    if (f.isdir === 1) folders.push(f);
    else if (isVideo(f.server_filename)) videos.push(f);
    else if (isImage(f.server_filename)) images.push(f);
  }

  const rootPoster = images.find(i => /poster|cover|folder|backdrop/i.test(i.server_filename));

  const items: AnalyzedItem[] = [];
  const seasons: Record<number, AnalyzedItem[]> = {};

  const thumb = (f: TeraFile) => f.thumbs?.url3 || f.thumbs?.url2 || f.thumbs?.url1;

  if (videos.length > 0 && folders.length === 0) {
    for (const v of videos) {
      const seEp = detectSeasonEp(v.server_filename);
      const item: AnalyzedItem = {
        name: cleanTitle(v.server_filename),
        url: v.dlink || '',
        size: v.size,
        fsId: v.fs_id,
        poster: thumb(v) || rootPoster?.dlink,
      };
      if (seEp) {
        item.season = seEp.season;
        item.episode = seEp.episode;
        if (!seasons[seEp.season]) seasons[seEp.season] = [];
        seasons[seEp.season].push(item);
      }
      items.push(item);
    }
  }

  if (folders.length > 0 && uk && shareid && token) {
    for (const folder of folders) {
      const seasonNum = detectSeasonFolder(folder.server_filename);
      const subFiles = await fetchSubfolder(shortcode, uk, shareid, token, `/${folder.server_filename}`);
      const subVideos = subFiles.filter(f => !f.isdir && isVideo(f.server_filename));
      const subPoster = subFiles.find(f => !f.isdir && isImage(f.server_filename) && /poster|cover|folder/i.test(f.server_filename));
      const folderPoster = thumb(folder) || subPoster?.dlink || rootPoster?.dlink;

      for (const v of subVideos) {
        const seEp = detectSeasonEp(v.server_filename);
        const sNum = seasonNum || seEp?.season || 1;
        const epNum = seEp?.episode || (subVideos.indexOf(v) + 1);
        const item: AnalyzedItem = {
          name: cleanTitle(v.server_filename),
          url: v.dlink || '',
          size: v.size,
          fsId: v.fs_id,
          poster: thumb(v) || folderPoster,
          season: sNum,
          episode: epNum,
          folderName: folder.server_filename,
        };
        if (!seasons[sNum]) seasons[sNum] = [];
        seasons[sNum].push(item);
        items.push(item);
      }

      for (const v of videos) {
        const seEp = detectSeasonEp(v.server_filename);
        const item: AnalyzedItem = {
          name: cleanTitle(v.server_filename),
          url: v.dlink || '',
          size: v.size,
          fsId: v.fs_id,
          poster: thumb(v) || rootPoster?.dlink,
          season: seEp?.season,
          episode: seEp?.episode,
        };
        if (!items.find(i => i.fsId === item.fsId)) {
          items.push(item);
        }
      }
    }
  }

  const hasSeasons = Object.keys(seasons).length > 0;
  const looksLikeSeries = hasSeasons || folders.length > 0 || items.some(i => i.season);
  const type: 'movie' | 'series' | 'mixed' = looksLikeSeries
    ? (items.length === 1 ? 'movie' : 'series')
    : (items.length > 3 ? 'mixed' : 'movie');

  const rootName = list[0]?.server_filename ? cleanTitle(list[0].server_filename.split('/')[0]) : `Importación Terabox`;
  const title = folders.length > 0 ? cleanTitle(shortcode) : (items[0]?.name || rootName);

  const result: AnalyzeResult = {
    type,
    title,
    items,
    seasons: hasSeasons ? seasons : undefined,
    poster: rootPoster?.dlink || items[0]?.poster,
    totalFiles: items.length,
    hasFolders: folders.length > 0,
  };

  res.json(result);
});

router.post("/terabox/import", requireAdminAuth, async (req: Request, res: Response) => {
  const { importType, title, category, items, seasons, poster } = req.body;

  if (!importType || !title || !items || !Array.isArray(items)) {
    res.status(400).json({ error: "Datos de importación inválidos" });
    return;
  }

  try {
    if (importType === 'movie') {
      const created: Array<{ id: number; title: string }> = [];
      const [maxOrder] = await db.select({ order: moviesTable.order }).from(moviesTable).orderBy(asc(moviesTable.order)).limit(1);
      let orderStart = (maxOrder?.order || 0) + items.length;

      for (const item of items) {
        const [movie] = await db.insert(moviesTable).values({
          title: item.name || title,
          filePath: item.url,
          poster: item.poster || poster || null,
          category: category || null,
          order: orderStart--,
          featured: false,
        }).returning();
        created.push({ id: movie.id, title: movie.title });
      }
      cache.invalidatePrefix("movies:");
      res.json({ success: true, type: 'movie', created, count: created.length });

    } else if (importType === 'series') {
      const [newSeries] = await db.insert(seriesTable).values({
        title,
        poster: poster || null,
        category: category || null,
        featured: false,
        hidden: false,
      }).returning();

      const seasonMap: Record<number, number> = {};
      const episodesCreated: number[] = [];

      for (const item of items) {
        const sNum = item.season || 1;
        if (!seasonMap[sNum]) {
          const [newSeason] = await db.insert(seasonsTable).values({
            seriesId: newSeries.id,
            seasonNumber: sNum,
            title: `Temporada ${sNum}`,
          }).returning();
          seasonMap[sNum] = newSeason.id;
        }
        const epOrder = item.episode || (episodesCreated.length + 1);
        await db.insert(episodesTable).values({
          seriesId: newSeries.id,
          seasonId: seasonMap[sNum],
          title: item.name || `Episodio ${epOrder}`,
          filePath: item.url,
          episodeNumber: item.episode || epOrder,
          order: epOrder,
          thumbnail: item.poster || null,
        });
        episodesCreated.push(epOrder);
      }
      cache.invalidatePrefix("series:");
      res.json({ success: true, type: 'series', seriesId: newSeries.id, title: newSeries.title, seasons: Object.keys(seasonMap).length, episodes: episodesCreated.length });
    } else {
      res.status(400).json({ error: "Tipo de importación inválido" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Error al importar' });
  }
});

export default router;
