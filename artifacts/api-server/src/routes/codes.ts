import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { accessCodesTable, sessionsTable, packagesTable } from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import {
  CreateCodeBody,
  UpdateCodeBody,
  UpdateCodeParams,
  DeleteCodeParams,
  AdjustCodeTimeBody,
  AdjustCodeTimeParams,
} from "@workspace/api-zod";
import { requireAdminAuth, generateCode } from "../lib/auth.js";

const router = Router();

function formatCode(c: typeof accessCodesTable.$inferSelect, activeDevice?: string) {
  const now = new Date();
  const isExpired = c.expiresAt ? new Date(c.expiresAt) < now : false;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    isActive: c.isActive,
    isExpired,
    subadminId: c.subadminId,
    packageId: c.packageId,
    createdAt: c.createdAt.toISOString(),
    activeSessionDevice: activeDevice ?? null,
  };
}

router.get("/codes", requireAdminAuth, async (req: Request, res: Response) => {
  const adminSession = req.adminSession!;

  let codes;
  if (adminSession.role === "subadmin" && adminSession.subadminId) {
    codes = await db
      .select()
      .from(accessCodesTable)
      .where(eq(accessCodesTable.subadminId, adminSession.subadminId))
      .orderBy(desc(accessCodesTable.createdAt));
  } else {
    codes = await db
      .select()
      .from(accessCodesTable)
      .orderBy(desc(accessCodesTable.createdAt));
  }

  const sessions = await db.select().from(sessionsTable);
  const sessionsByCode = new Map(sessions.map((s) => [s.codeId, s.deviceId]));

  res.json(codes.map((c) => formatCode(c, sessionsByCode.get(c.id))));
});

router.post("/codes", requireAdminAuth, async (req: Request, res: Response) => {
  const parsed = CreateCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const adminSession = req.adminSession!;

  if (adminSession.role === "subadmin") {
    res.status(403).json({ error: "Subadmins cannot create codes manually" });
    return;
  }

  const { code: rawCode, name, packageId, durationMinutes } = parsed.data;

  const finalCode = rawCode?.trim() || generateCode();

  let expiresAt: Date | undefined;

  if (packageId) {
    const pkg = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, packageId))
      .limit(1);
    if (pkg[0]) {
      expiresAt = new Date();
      expiresAt.setTime(expiresAt.getTime() + pkg[0].durationMinutes * 60 * 1000);
    }
  } else if (durationMinutes) {
    expiresAt = new Date();
    expiresAt.setTime(expiresAt.getTime() + durationMinutes * 60 * 1000);
  } else {
    expiresAt = new Date();
    expiresAt.setTime(expiresAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  const [created] = await db
    .insert(accessCodesTable)
    .values({
      code: finalCode,
      name: name ?? null,
      expiresAt: expiresAt ?? null,
      isActive: true,
      subadminId: null,
      packageId: packageId ?? null,
    })
    .returning();

  res.status(201).json(formatCode(created));
});

router.put("/codes/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const params = UpdateCodeParams.safeParse(req.params);
  const body = UpdateCodeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const adminSession = req.adminSession!;
  if (adminSession.role === "subadmin") {
    res.status(403).json({ error: "Subadmins cannot edit codes" });
    return;
  }

  const updateData: Partial<typeof accessCodesTable.$inferInsert> = {};
  if (body.data.name !== undefined) updateData.name = body.data.name;
  if (body.data.isActive !== undefined) updateData.isActive = body.data.isActive ?? undefined;
  if (body.data.expiresAt !== undefined) {
    updateData.expiresAt = body.data.expiresAt ? new Date(body.data.expiresAt) : null;
  }

  const [updated] = await db
    .update(accessCodesTable)
    .set(updateData)
    .where(eq(accessCodesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatCode(updated));
});

router.delete("/codes/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const parsed = DeleteCodeParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const adminSession = req.adminSession!;

  if (adminSession.role === "subadmin" && adminSession.subadminId) {
    const [code] = await db
      .select()
      .from(accessCodesTable)
      .where(
        and(
          eq(accessCodesTable.id, parsed.data.id),
          eq(accessCodesTable.subadminId, adminSession.subadminId)
        )
      );
    if (!code) {
      res.status(403).json({ error: "No tienes permiso para eliminar este código" });
      return;
    }
  }

  await db.delete(accessCodesTable).where(eq(accessCodesTable.id, parsed.data.id));
  res.json({ success: true, message: "Deleted" });
});

router.post("/codes/:id/adjust-time", requireAdminAuth, async (req: Request, res: Response) => {
  const params = AdjustCodeTimeParams.safeParse(req.params);
  const body = AdjustCodeTimeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const adminSession = req.adminSession!;
  if (adminSession.role === "subadmin") {
    res.status(403).json({ error: "Subadmins cannot adjust code time" });
    return;
  }

  const [code] = await db
    .select()
    .from(accessCodesTable)
    .where(eq(accessCodesTable.id, params.data.id));

  if (!code) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const base = code.expiresAt ? new Date(code.expiresAt) : new Date();
  const { amount, unit, operation } = body.data;
  const sign = operation === "add" ? 1 : -1;

  const unitToMs: Record<string, number> = {
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000,
    years: 365 * 24 * 60 * 60 * 1000,
  };

  const newExpiry = new Date(base.getTime() + sign * amount * unitToMs[unit]);

  const [updated] = await db
    .update(accessCodesTable)
    .set({ expiresAt: newExpiry })
    .where(eq(accessCodesTable.id, params.data.id))
    .returning();

  res.json(formatCode(updated));
});

router.delete("/codes/bulk", requireAdminAuth, async (req: Request, res: Response) => {
  const adminSession = req.adminSession!;
  if (adminSession.role === "subadmin") {
    res.status(403).json({ error: "Subadmins cannot bulk delete codes" });
    return;
  }
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }
  const numIds = ids.map(Number).filter((n) => !isNaN(n));
  if (numIds.length === 0) {
    res.status(400).json({ error: "No valid ids provided" });
    return;
  }
  await db.delete(accessCodesTable).where(inArray(accessCodesTable.id, numIds));
  res.json({ success: true, deleted: numIds.length });
});

export default router;
