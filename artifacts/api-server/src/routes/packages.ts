import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { packagesTable, subadminPackagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreatePackageBody,
  UpdatePackageBody,
  UpdatePackageParams,
  DeletePackageParams,
} from "@workspace/api-zod";
import { requireAdminAuth, requireSuperAdmin } from "../lib/auth.js";

const router = Router();

type PackageInsert = typeof packagesTable.$inferInsert;

function formatPackage(p: typeof packagesTable.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    durationMinutes: p.durationMinutes,
    price: parseFloat(p.price as unknown as string),
    description: p.description,
    createdAt: p.createdAt.toISOString(),
  };
}

router.get("/packages", requireAdminAuth, async (req: Request, res: Response) => {
  const adminSession = req.adminSession!;

  if (adminSession.role === "subadmin" && adminSession.subadminId) {
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
      .where(eq(subadminPackagesTable.subadminId, adminSession.subadminId));

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
    return;
  }

  const packages = await db.select().from(packagesTable);
  res.json(packages.map(formatPackage));
});

router.post("/packages", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = CreatePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const insertData: PackageInsert = {
    name: parsed.data.name,
    durationMinutes: parsed.data.durationMinutes,
    price: String(parsed.data.price),
    description: parsed.data.description ?? null,
  };
  const [created] = await db.insert(packagesTable).values(insertData).returning();
  res.status(201).json(formatPackage(created));
});

router.put("/packages/:id", requireSuperAdmin, async (req: Request, res: Response) => {
  const params = UpdatePackageParams.safeParse(req.params);
  const body = UpdatePackageBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [updated] = await db
    .update(packagesTable)
    .set({ ...body.data, price: String(body.data.price) })
    .where(eq(packagesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatPackage(updated));
});

router.delete("/packages/:id", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = DeletePackageParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(packagesTable).where(eq(packagesTable.id, parsed.data.id));
  res.json({ success: true, message: "Deleted" });
});

export default router;
