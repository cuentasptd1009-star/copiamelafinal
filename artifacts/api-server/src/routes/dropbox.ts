import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { settingsTable, moviesTable, seriesTable, seasonsTable, episodesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdminAuth } from "../lib/auth.js";

const router = Router();

const DROPBOX_API = "https://api.dropboxapi.com/2";
const VIDEO_EXTS = new Set(["mp4", "mkv", "avi", "mov", "webm", "ts", "flv", "wmv", "mpg", "mpeg", "m4v", "divx", "m2ts"]);
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function isVideo(name: string) {
  return VIDEO_EXTS.has(name.split(".").pop()?.toLowerCase() ?? "");
}
function isImage(name: string) {
  return IMAGE_EXTS.has(name.split(".").pop()?.toLowerCase() ?? "");
}
function cleanTitle(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[._]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function getDropboxToken(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, "dropboxToken"))
      .limit(1);
    return row?.value || null;
  } catch {
    return null;
  }
}

async function dropboxApi(token: string, endpoint: string, body: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== null) headers["Content-Type"] = "application/json";
  const res = await fetch(`${DROPBOX_API}${endpoint}`, {
    method: "POST",
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Dropbox API error (${res.status}): ${err.slice(0, 200)}`);
  }
  return res.json();
}

async function getTemporaryLink(token: string, path: string): Promise<string | null> {
  try {
    const data = await dropboxApi(token, "/files/get_temporary_link", { path });
    return data.link || null;
  } catch {
    return null;
  }
}

// Browse a Dropbox folder
router.post("/dropbox/browse", requireAdminAuth, async (req: Request, res: Response) => {
  const token = await getDropboxToken();
  if (!token) {
    res.status(400).json({ error: "Token de Dropbox no configurado. Ve a Configuración para añadirlo." });
    return;
  }

  const { path = "" } = req.body;
  const folderPath = path === "" || path === "/" ? "" : path;

  try {
    const data = await dropboxApi(token, "/files/list_folder", {
      path: folderPath,
      recursive: false,
      include_media_info: false,
      include_deleted: false,
      include_has_explicit_shared_members: false,
      limit: 300,
    });

    let entries = data.entries || [];

    // If has_more, fetch all pages
    let cursor = data.cursor;
    while (data.has_more && cursor) {
      const more = await dropboxApi(token, "/files/list_folder/continue", { cursor });
      entries = entries.concat(more.entries || []);
      cursor = more.cursor;
      if (!more.has_more) break;
    }

    const folders = entries
      .filter((e: any) => e[".tag"] === "folder")
      .map((e: any) => ({
        type: "folder" as const,
        name: e.name,
        path: e.path_display,
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    const files = entries
      .filter((e: any) => e[".tag"] === "file" && (isVideo(e.name) || isImage(e.name)))
      .map((e: any) => ({
        type: "file" as const,
        name: e.name,
        path: e.path_display,
        size: e.size,
        isVideo: isVideo(e.name),
        isImage: isImage(e.name),
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    res.json({ folders, files, path: folderPath || "/" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Error al leer la carpeta de Dropbox" });
  }
});

// Import movies or series from Dropbox
router.post("/dropbox/import", requireAdminAuth, async (req: Request, res: Response) => {
  const { importType, items, category } = req.body;

  if (!importType || !items || !Array.isArray(items)) {
    res.status(400).json({ error: "Datos de importación inválidos" });
    return;
  }

  try {
    if (importType === "movies") {
      const [maxOrder] = await db
        .select({ order: moviesTable.order })
        .from(moviesTable)
        .orderBy(asc(moviesTable.order))
        .limit(1);
      let orderStart = (maxOrder?.order || 0) + items.length;
      const created: Array<{ id: number; title: string }> = [];

      for (const item of items) {
        const filePath = `/api/dropbox/play?path=${encodeURIComponent(item.path)}`;
        const [movie] = await db
          .insert(moviesTable)
          .values({
            title: item.title || cleanTitle(item.name),
            filePath,
            poster: item.poster || null,
            category: category || item.category || null,
            order: orderStart--,
            featured: false,
          })
          .returning();
        created.push({ id: movie.id, title: movie.title });
      }

      res.json({ success: true, type: "movies", created, count: created.length });

    } else if (importType === "series") {
      const { seriesTitle, poster, seasons } = req.body;
      const [newSeries] = await db
        .insert(seriesTable)
        .values({
          title: seriesTitle || "Serie sin nombre",
          poster: poster || null,
          category: category || null,
          featured: false,
          hidden: false,
        })
        .returning();

      const seasonMap: Record<number, number> = {};
      let totalEpisodes = 0;

      for (const item of items) {
        const sNum = item.season || 1;
        if (!seasonMap[sNum]) {
          const [newSeason] = await db
            .insert(seasonsTable)
            .values({
              seriesId: newSeries.id,
              seasonNumber: sNum,
              title: seasons?.[sNum] || `Temporada ${sNum}`,
            })
            .returning();
          seasonMap[sNum] = newSeason.id;
        }

        const filePath = `/api/dropbox/play?path=${encodeURIComponent(item.path)}`;
        await db.insert(episodesTable).values({
          seriesId: newSeries.id,
          seasonId: seasonMap[sNum],
          title: item.title || cleanTitle(item.name),
          filePath,
          episodeNumber: item.episode || (totalEpisodes + 1),
          order: item.episode || (totalEpisodes + 1),
          thumbnail: item.poster || null,
        });
        totalEpisodes++;
      }

      res.json({
        success: true,
        type: "series",
        seriesId: newSeries.id,
        title: newSeries.title,
        seasons: Object.keys(seasonMap).length,
        episodes: totalEpisodes,
      });
    } else {
      res.status(400).json({ error: "Tipo inválido" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Error al importar" });
  }
});

// Play a Dropbox file — get a 4-hour temporary link and redirect
router.get("/dropbox/play", async (req: Request, res: Response) => {
  const path = req.query.path as string;
  if (!path) {
    res.status(400).json({ error: "path es requerido" });
    return;
  }

  const token = await getDropboxToken();
  if (!token) {
    res.status(400).json({ error: "Token de Dropbox no configurado" });
    return;
  }

  const link = await getTemporaryLink(token, path);
  if (!link) {
    res.status(502).json({ error: "No se pudo obtener el enlace temporal de Dropbox" });
    return;
  }

  // Redirect to the Dropbox CDN URL — works perfectly for video seeking
  res.redirect(302, link);
});

// Verify token is working
router.get("/dropbox/test", requireAdminAuth, async (_req: Request, res: Response) => {
  const token = await getDropboxToken();
  if (!token) {
    res.json({ ok: false, error: "Token no configurado" });
    return;
  }
  try {
    const data = await dropboxApi(token, "/users/get_current_account", null);
    res.json({ ok: true, name: data.name?.display_name, email: data.email });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

export default router;
