import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { subadminsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdminAuth } from "../lib/auth.js";
import { z } from "zod";

const router = Router();

const UpdateSubadminSettingsBody = z.object({
  whatsappNumber: z.string().nullable().optional(),
});

router.put("/subadmin/settings", requireAdminAuth, async (req: Request, res: Response) => {
  const session = req.adminSession!;
  if (session.role !== "subadmin" || !session.subadminId) {
    res.status(403).json({ error: "Only subadmins can update their own settings" });
    return;
  }

  const parsed = UpdateSubadminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.whatsappNumber !== undefined) {
    patch.whatsappNumber = parsed.data.whatsappNumber || null;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(subadminsTable).set(patch).where(eq(subadminsTable.id, session.subadminId));
  }

  res.json({ success: true });
});

router.get("/subadmin/settings", requireAdminAuth, async (req: Request, res: Response) => {
  const session = req.adminSession!;
  if (session.role !== "subadmin" || !session.subadminId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [sa] = await db.select({ whatsappNumber: subadminsTable.whatsappNumber })
    .from(subadminsTable)
    .where(eq(subadminsTable.id, session.subadminId))
    .limit(1);

  res.json({ whatsappNumber: sa?.whatsappNumber ?? null });
});

export default router;
