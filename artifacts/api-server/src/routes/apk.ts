import { Router, type IRouter, type Request, type Response } from "express";
import { extractToken, getAdminSession } from "../lib/auth.js";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// APK info — reads from settings table (download link stored by admin)
router.get("/apk/info", async (_req: Request, res: Response) => {
  try {
    const [urlRow] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "apkDownloadLink"))
      .limit(1);
    if (urlRow?.value) {
      res.json({ available: true, url: urlRow.value });
      return;
    }
  } catch {}
  res.json({ available: false });
});

// Download APK — redirects to the configured download link
router.get('/apk/download', async (_req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, 'apkDownloadLink'))
      .limit(1);
    if (row?.value) {
      res.redirect(302, row.value);
      return;
    }
  } catch {}
  res.status(404).json({
    error: 'Enlace de descarga no disponible. El administrador aún no ha configurado el enlace.',
  });
});

// Get current APK download link (admin only)
router.get("/admin/apk/link", async (req: Request, res: Response) => {
  const tok = extractToken(req);
  if (!tok) { res.status(401).json({ error: "Unauthorized" }); return; }
  const adminSession = await getAdminSession(tok);
  if (!adminSession || adminSession.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  try {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "apkDownloadLink"))
      .limit(1);
    res.json({ link: row?.value || null });
  } catch {
    res.status(500).json({ error: "Error al obtener el enlace" });
  }
});

// Set APK download link (admin only)
router.post("/admin/apk/set-link", async (req: Request, res: Response) => {
  const tok = extractToken(req);
  if (!tok) { res.status(401).json({ error: "Unauthorized" }); return; }
  const adminSession = await getAdminSession(tok);
  if (!adminSession || adminSession.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const { link } = req.body as { link?: string };
  if (!link) { res.status(400).json({ error: "Falta el enlace de descarga" }); return; }

  try {
    const now = new Date();
    await db
      .insert(settingsTable)
      .values({ key: "apkDownloadLink", value: link, updatedAt: now })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: link, updatedAt: now } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "No se pudo guardar el enlace" });
  }
});

export default router;
