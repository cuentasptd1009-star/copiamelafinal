import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { avatarsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { getAdminSession, extractToken } from "../lib/auth.js";

const router = Router();

const CreateAvatarBody = z.object({
  name: z.string().nullable().optional(),
  imageUrl: z.string().min(1),
});

router.get("/avatars", async (req: Request, res: Response) => {
  const avatars = await db
    .select()
    .from(avatarsTable)
    .orderBy(asc(avatarsTable.order), asc(avatarsTable.createdAt));
  res.json(avatars);
});

router.post("/avatars", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const adminSession = await getAdminSession(token);
  if (!adminSession || adminSession.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = CreateAvatarBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const maxOrderResult = await db
    .select({ order: avatarsTable.order })
    .from(avatarsTable)
    .orderBy(asc(avatarsTable.order));
  const maxOrder = maxOrderResult.length > 0 ? Math.max(...maxOrderResult.map(r => r.order)) + 1 : 0;

  const [created] = await db.insert(avatarsTable).values({
    name: parsed.data.name ?? null,
    imageUrl: parsed.data.imageUrl,
    order: maxOrder,
  }).returning();

  res.status(201).json(created);
});

router.delete("/avatars/:id", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const adminSession = await getAdminSession(token);
  if (!adminSession || adminSession.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(avatarsTable).where(eq(avatarsTable.id, id));
  res.json({ success: true });
});

export default router;
