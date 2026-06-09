import { Router, type IRouter, type Request, type Response } from "express";
  import { extractToken, getAdminSession } from "../lib/auth.js";
  import { db } from "@workspace/db";
  import { settingsTable } from "@workspace/db";
  import { eq } from "drizzle-orm";
  import { v2 as cloudinary } from "cloudinary";

  const router: IRouter = Router();

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  // APK info — reads from settings table (Cloudinary URL stored after upload)
  router.get("/apk/info", async (_req: Request, res: Response) => {
    try {
      const [urlRow] = await db
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, "apkCloudinaryUrl"))
        .limit(1);
      if (urlRow) {
        let size: number | undefined;
        let updatedAt: string | undefined;
        try {
          const [metaRow] = await db
            .select()
            .from(settingsTable)
            .where(eq(settingsTable.key, "apkMeta"))
            .limit(1);
          if (metaRow) {
            const m = JSON.parse(metaRow.value);
            size = m.size;
            updatedAt = m.updatedAt;
          }
        } catch {}
        res.json({ available: true, size, updatedAt: updatedAt ?? urlRow.updatedAt?.toISOString() });
        return;
      }
    } catch {}
    res.json({ available: false });
  });

  // Get Cloudinary signed upload params for direct browser-to-Cloudinary APK upload
  // This bypasses Vercel's 4.5MB serverless payload limit for large APK files
  router.get("/admin/apk/upload-params", async (req: Request, res: Response) => {
    const tok = extractToken(req);
    if (!tok) { res.status(401).json({ error: "Unauthorized" }); return; }
    const adminSession = await getAdminSession(tok);
    if (!adminSession || adminSession.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      res.status(500).json({ error: "Cloudinary no está configurado en el servidor" });
      return;
    }

    const publicId = "super-tv/apk/super-tv-app";
    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      { public_id: publicId, timestamp, overwrite: true },
      apiSecret,
    );

    res.json({
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
      publicId,
      signature,
      timestamp,
      apiKey,
      cloudName,
    });
  });

  // Confirm upload — called by frontend after successful Cloudinary upload
  // Saves the resulting URL + metadata to the settings table
  router.post("/admin/apk/confirm-upload", async (req: Request, res: Response) => {
    const tok = extractToken(req);
    if (!tok) { res.status(401).json({ error: "Unauthorized" }); return; }
    const adminSession = await getAdminSession(tok);
    if (!adminSession || adminSession.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

    const { url, size } = req.body as { url?: string; size?: number };
    if (!url) { res.status(400).json({ error: "Falta la URL del APK" }); return; }

    try {
      const now = new Date();
      await db
        .insert(settingsTable)
        .values({ key: "apkCloudinaryUrl", value: url, updatedAt: now })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value: url, updatedAt: now } });
      await db
        .insert(settingsTable)
        .values({
          key: "apkMeta",
          value: JSON.stringify({ size, updatedAt: now.toISOString() }),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: JSON.stringify({ size, updatedAt: now.toISOString() }), updatedAt: now },
        });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "No se pudo guardar la información del APK" });
    }
  });

  // Download APK — redirects to the Cloudinary URL
  router.get("/apk/download", async (_req: Request, res: Response) => {
    try {
      const [row] = await db
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, "apkCloudinaryUrl"))
        .limit(1);
      if (row) {
        res.redirect(302, row.value);
        return;
      }
    } catch {}
    res.status(404).json({
      error: "APK no disponible. El administrador aún no ha subido el archivo.",
    });
  });

  export default router;
  