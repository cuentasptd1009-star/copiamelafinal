import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdminAuth, requireSuperAdmin, hashPassword, verifyPassword } from "../lib/auth.js";
import { z } from "zod";

const router = Router();

const ALLOWED_KEYS = ["whatsappNumber", "teraboxCookies", "dropboxToken", "tmdbApiKey", "sectionOrder", "sectionVisibility"] as const;
type SettingKey = typeof ALLOWED_KEYS[number];

const DEFAULT_SECTION_ORDER = ["channels", "movies", "series"];
const DEFAULT_SECTION_VISIBILITY: Record<string, boolean> = { channels: true, movies: true, series: true };

// Shared helper to get TMDB API key (env var takes priority, then DB)
export async function getTmdbApiKey(): Promise<string | null> {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY;
  try {
    const { db } = await import("@workspace/db");
    const { settingsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, 'tmdbApiKey')).limit(1);
    return row?.value || null;
  } catch { return null; }
}

router.get("/settings/public", async (_req: Request, res: Response) => {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  let sectionOrder = DEFAULT_SECTION_ORDER;
  let sectionVisibility = DEFAULT_SECTION_VISIBILITY;
  try { if (map["sectionOrder"]) sectionOrder = JSON.parse(map["sectionOrder"]); } catch {}
  try { if (map["sectionVisibility"]) sectionVisibility = JSON.parse(map["sectionVisibility"]); } catch {}

  res.json({
    whatsappNumber: map["whatsappNumber"] ?? null,
    sectionOrder,
    sectionVisibility,
  });
});

router.get("/admin/settings", requireAdminAuth, async (_req: Request, res: Response) => {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  let sectionOrder = DEFAULT_SECTION_ORDER;
  let sectionVisibility = DEFAULT_SECTION_VISIBILITY;
  try { if (map["sectionOrder"]) sectionOrder = JSON.parse(map["sectionOrder"]); } catch {}
  try { if (map["sectionVisibility"]) sectionVisibility = JSON.parse(map["sectionVisibility"]); } catch {}

  res.json({
    whatsappNumber: map["whatsappNumber"] ?? null,
    teraboxCookies: map["teraboxCookies"] ? "***configured***" : null,
    dropboxToken: map["dropboxToken"] ? "***configured***" : null,
    tmdbApiKey: map["tmdbApiKey"] ? "***configured***" : (process.env.TMDB_API_KEY ? "***env***" : null),
    sectionOrder,
    sectionVisibility,
  });
});

const UpdateSettingsBody = z.object({
  whatsappNumber: z.string().nullable().optional(),
  teraboxCookies: z.string().nullable().optional(),
  dropboxToken: z.string().nullable().optional(),
  tmdbApiKey: z.string().nullable().optional(),
  sectionOrder: z.array(z.string()).nullable().optional(),
  sectionVisibility: z.record(z.boolean()).nullable().optional(),
});

router.put("/admin/settings", requireAdminAuth, async (req: Request, res: Response) => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const updates: { key: SettingKey; value: string | null }[] = [];
  if (parsed.data.whatsappNumber !== undefined) {
    updates.push({ key: "whatsappNumber", value: parsed.data.whatsappNumber });
  }
  if (parsed.data.teraboxCookies !== undefined) {
    updates.push({ key: "teraboxCookies", value: parsed.data.teraboxCookies });
  }
  if (parsed.data.dropboxToken !== undefined) {
    updates.push({ key: "dropboxToken", value: parsed.data.dropboxToken });
  }
  if (parsed.data.tmdbApiKey !== undefined) {
    updates.push({ key: "tmdbApiKey", value: parsed.data.tmdbApiKey });
  }
  if (parsed.data.sectionOrder !== undefined) {
    updates.push({ key: "sectionOrder", value: parsed.data.sectionOrder ? JSON.stringify(parsed.data.sectionOrder) : null });
  }
  if (parsed.data.sectionVisibility !== undefined) {
    updates.push({ key: "sectionVisibility", value: parsed.data.sectionVisibility ? JSON.stringify(parsed.data.sectionVisibility) : null });
  }

  for (const { key, value } of updates) {
    if (value === null || value === "") {
      await db.delete(settingsTable).where(eq(settingsTable.key, key));
    } else {
      await db
        .insert(settingsTable)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value, updatedAt: new Date() },
        });
    }
  }

  res.json({ success: true });
});

const ChangePasswordBody = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(4),
});

router.post("/admin/change-password", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }

  if (process.env.ADMIN_PASSWORD) {
    res.status(400).json({
      error: "La contraseña está fijada por variable de entorno ADMIN_PASSWORD. Elimínala primero para poder cambiarla desde aquí.",
    });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;

  const [stored] = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "adminPasswordHash"))
    .limit(1);
  const currentHash = stored?.value ?? null;

  if (!currentHash) {
    res.status(503).json({ error: "Admin password not configured." });
    return;
  }

  if (!verifyPassword(currentPassword, currentHash)) {
    res.status(401).json({ error: "La contraseña actual es incorrecta" });
    return;
  }

  const newHash = hashPassword(newPassword);
  await db
    .insert(settingsTable)
    .values({ key: "adminPasswordHash", value: newHash, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: newHash, updatedAt: new Date() },
    });

  res.json({ success: true });
});

export default router;
