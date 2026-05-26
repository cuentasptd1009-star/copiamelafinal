import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  subadminsTable,
  accessCodesTable,
  packagesTable,
  subadminPackagesTable,
} from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";
import {
  CreateSubadminBody,
  UpdateSubadminBody,
  UpdateSubadminParams,
  DeleteSubadminParams,
  AddSubadminBalanceBody,
  AddSubadminBalanceParams,
  BuyPackageBody,
} from "@workspace/api-zod";
import { z } from "zod";
import { requireAdminAuth, requireSuperAdmin, hashPassword, generateCode } from "../lib/auth.js";

const AssignSubadminPackagesParams = z.object({ id: z.coerce.number().int() });
const AssignSubadminPackagesBody = z.object({
  packages: z.array(z.object({ packageId: z.number().int(), customPrice: z.number().nullable().optional() })),
});

const router = Router();

function formatSubadmin(s: typeof subadminsTable.$inferSelect, totalCodes = 0) {
  return {
    id: s.id,
    username: s.username,
    balance: parseFloat(s.balance as unknown as string),
    totalCodesGenerated: totalCodes,
    createdAt: s.createdAt.toISOString(),
  };
}

router.get("/subadmins", requireSuperAdmin, async (req: Request, res: Response) => {
  const subadmins = await db.select().from(subadminsTable);
  const codeCounts = await db
    .select({ subadminId: accessCodesTable.subadminId, count: count() })
    .from(accessCodesTable)
    .groupBy(accessCodesTable.subadminId);

  const countMap = new Map(codeCounts.map((c) => [c.subadminId, c.count]));
  res.json(subadmins.map((s) => formatSubadmin(s, countMap.get(s.id) ?? 0)));
});

router.post("/subadmins", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = CreateSubadminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { username, password } = parsed.data;
  const passwordHash = hashPassword(password);
  const [created] = await db
    .insert(subadminsTable)
    .values({ username, passwordHash })
    .returning();
  res.status(201).json(formatSubadmin(created));
});

router.put("/subadmins/:id", requireSuperAdmin, async (req: Request, res: Response) => {
  const params = UpdateSubadminParams.safeParse(req.params);
  const body = UpdateSubadminBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const updateData: Partial<typeof subadminsTable.$inferInsert> = {};
  if (body.data.username) updateData.username = body.data.username;
  if (body.data.password) updateData.passwordHash = hashPassword(body.data.password);

  const [updated] = await db
    .update(subadminsTable)
    .set(updateData)
    .where(eq(subadminsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatSubadmin(updated));
});

router.delete("/subadmins/:id", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = DeleteSubadminParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(subadminsTable).where(eq(subadminsTable.id, parsed.data.id));
  res.json({ success: true, message: "Deleted" });
});

router.post("/subadmins/:id/add-balance", requireSuperAdmin, async (req: Request, res: Response) => {
  const params = AddSubadminBalanceParams.safeParse(req.params);
  const body = AddSubadminBalanceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [updated] = await db
    .update(subadminsTable)
    .set({ balance: sql`${subadminsTable.balance} + ${body.data.amount}` })
    .where(eq(subadminsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatSubadmin(updated));
});

router.get("/subadmins/:id/packages", requireSuperAdmin, async (req: Request, res: Response) => {
  const params = AssignSubadminPackagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const rows = await db
    .select({
      id: subadminPackagesTable.id,
      packageId: packagesTable.id,
      packageName: packagesTable.name,
      durationMinutes: packagesTable.durationMinutes,
      basePrice: packagesTable.price,
      customPrice: subadminPackagesTable.customPrice,
      description: packagesTable.description,
    })
    .from(subadminPackagesTable)
    .innerJoin(packagesTable, eq(packagesTable.id, subadminPackagesTable.packageId))
    .where(eq(subadminPackagesTable.subadminId, params.data.id));

  res.json(
    rows.map((r) => {
      const base = parseFloat(r.basePrice as unknown as string);
      const custom = r.customPrice !== null ? parseFloat(r.customPrice as unknown as string) : null;
      return {
        id: r.id,
        packageId: r.packageId,
        packageName: r.packageName,
        durationMinutes: r.durationMinutes,
        basePrice: base,
        customPrice: custom,
        effectivePrice: custom !== null ? custom : base,
        description: r.description,
      };
    })
  );
});

router.post("/subadmins/:id/assign-packages", requireSuperAdmin, async (req: Request, res: Response) => {
  const params = AssignSubadminPackagesParams.safeParse(req.params);
  const body = AssignSubadminPackagesBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const subadminId = params.data.id;

  await db
    .delete(subadminPackagesTable)
    .where(eq(subadminPackagesTable.subadminId, subadminId));

  if (body.data.packages.length > 0) {
    await db.insert(subadminPackagesTable).values(
      body.data.packages.map((p) => ({
        subadminId,
        packageId: p.packageId,
        customPrice: p.customPrice !== null && p.customPrice !== undefined
          ? String(p.customPrice)
          : null,
      }))
    );
  }

  res.json({ success: true });
});

router.post("/subadmins/buy-package", requireAdminAuth, async (req: Request, res: Response) => {
  const adminSession = req.adminSession!;
  if (adminSession.role !== "subadmin" || !adminSession.subadminId) {
    res.status(403).json({ error: "Only subadmins can buy packages" });
    return;
  }

  const parsed = BuyPackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { packageId, codeId, codeName } = parsed.data;

  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(eq(packagesTable.id, packageId));

  if (!pkg) {
    res.status(404).json({ error: "Package not found" });
    return;
  }

  const [subadmin] = await db
    .select()
    .from(subadminsTable)
    .where(eq(subadminsTable.id, adminSession.subadminId));

  const basePrice = parseFloat(pkg.price as unknown as string);

  const [assignment] = await db
    .select()
    .from(subadminPackagesTable)
    .where(
      eq(subadminPackagesTable.subadminId, adminSession.subadminId)
    )
    .then((rows) => rows.filter((r) => r.packageId === packageId));

  if (!assignment) {
    res.status(403).json({ error: "Este paquete no está asignado a tu cuenta" });
    return;
  }

  const price = assignment.customPrice !== null
    ? parseFloat(assignment.customPrice as unknown as string)
    : basePrice;

  const balance = parseFloat(subadmin.balance as unknown as string);

  if (price > 0 && balance < price) {
    res.status(400).json({ error: "Saldo insuficiente" });
    return;
  }

  const expiresAt = new Date();
  expiresAt.setTime(expiresAt.getTime() + pkg.durationMinutes * 60 * 1000);

  let finalCode: string;
  let newCodeRecord;

  if (codeId) {
    const [existingCode] = await db
      .select()
      .from(accessCodesTable)
      .where(eq(accessCodesTable.id, codeId));

    if (!existingCode) {
      res.status(404).json({ error: "Código no encontrado" });
      return;
    }

    if (existingCode.subadminId !== adminSession.subadminId) {
      res.status(403).json({ error: "No tienes permiso para renovar este código" });
      return;
    }

    const now = new Date();
    const base = existingCode.expiresAt && new Date(existingCode.expiresAt) > now
      ? new Date(existingCode.expiresAt)
      : now;
    const renewedExpiresAt = new Date(base.getTime() + pkg.durationMinutes * 60 * 1000);

    const [updated] = await db
      .update(accessCodesTable)
      .set({ expiresAt: renewedExpiresAt, packageId, isActive: true })
      .where(eq(accessCodesTable.id, codeId))
      .returning();
    newCodeRecord = updated;
    finalCode = updated?.code ?? "";
  } else {
    finalCode = generateCode();
    const [created] = await db
      .insert(accessCodesTable)
      .values({
        code: finalCode,
        name: codeName ?? null,
        expiresAt,
        isActive: true,
        subadminId: adminSession.subadminId,
        packageId,
      })
      .returning();
    newCodeRecord = created;
  }

  if (price > 0) {
    await db
      .update(subadminsTable)
      .set({ balance: sql`${subadminsTable.balance} - ${price}` })
      .where(eq(subadminsTable.id, adminSession.subadminId));
  }

  const [updatedSubadmin] = await db
    .select()
    .from(subadminsTable)
    .where(eq(subadminsTable.id, adminSession.subadminId));

  const now = new Date();
  const isExpired = newCodeRecord.expiresAt ? new Date(newCodeRecord.expiresAt) < now : false;

  res.json({
    success: true,
    code: {
      id: newCodeRecord.id,
      code: newCodeRecord.code,
      name: newCodeRecord.name,
      expiresAt: newCodeRecord.expiresAt?.toISOString() ?? null,
      isActive: newCodeRecord.isActive,
      isExpired,
      subadminId: newCodeRecord.subadminId,
      packageId: newCodeRecord.packageId,
      createdAt: newCodeRecord.createdAt.toISOString(),
      activeSessionDevice: null,
    },
    remainingBalance: parseFloat(updatedSubadmin.balance as unknown as string),
  });
});

export default router;
