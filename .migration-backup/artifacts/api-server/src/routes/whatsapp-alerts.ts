import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  accessCodesTable,
  subadminsTable,
  whatsappAlertLogsTable,
} from "@workspace/db";
import { eq, sql, and, isNull, inArray } from "drizzle-orm";
import { requireSuperAdmin } from "../lib/auth.js";

const router = Router();

function buildWaMessage(subadminName: string, codes: { code: string; name: string | null; expiresAt: string }[]): string {
  const codeLines = codes.map(c => {
    const label = c.name ? `${c.name} (${c.code})` : c.code;
    const date = new Date(c.expiresAt).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
    return `• ${label} — vence el ${date}`;
  }).join("\n");
  return `Hola ${subadminName}, te informamos que los siguientes códigos de acceso están por vencer:\n\n${codeLines}\n\nPor favor, renuévalos a tiempo para que tus clientes no pierdan el servicio. ¡Gracias!`;
}

router.get("/admin/whatsapp-alerts", requireSuperAdmin, async (req: Request, res: Response) => {
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60_000);

  const expiring = await db
    .select({
      codeId: accessCodesTable.id,
      code: accessCodesTable.code,
      codeName: accessCodesTable.name,
      expiresAt: accessCodesTable.expiresAt,
      subadminId: subadminsTable.id,
      subadminUsername: subadminsTable.username,
      whatsappNumber: subadminsTable.whatsappNumber,
    })
    .from(accessCodesTable)
    .innerJoin(subadminsTable, eq(accessCodesTable.subadminId, subadminsTable.id))
    .where(
      sql`${accessCodesTable.isActive} = true
        AND ${accessCodesTable.expiresAt} IS NOT NULL
        AND ${accessCodesTable.expiresAt} > ${now}
        AND ${accessCodesTable.expiresAt} <= ${in48h}
        AND ${subadminsTable.whatsappNumber} IS NOT NULL`
    );

  if (!expiring.length) {
    res.json({ alerts: [] });
    return;
  }

  const codeIds = expiring.map(e => e.codeId);
  const dismissed = await db
    .select({ codeId: whatsappAlertLogsTable.codeId })
    .from(whatsappAlertLogsTable)
    .where(
      and(
        inArray(whatsappAlertLogsTable.codeId, codeIds),
        sql`${whatsappAlertLogsTable.dismissedAt} IS NOT NULL`
      )
    );

  const dismissedIds = new Set(dismissed.map(d => d.codeId));

  const pending = expiring.filter(e => !dismissedIds.has(e.codeId));

  const bySubadmin = new Map<number, typeof pending>();
  for (const item of pending) {
    if (!bySubadmin.has(item.subadminId)) bySubadmin.set(item.subadminId, []);
    bySubadmin.get(item.subadminId)!.push(item);
  }

  const alerts = Array.from(bySubadmin.entries()).map(([subadminId, items]) => {
    const { subadminUsername, whatsappNumber } = items[0];
    const codes = items.map(i => ({
      codeId: i.codeId,
      code: i.code,
      name: i.codeName,
      expiresAt: i.expiresAt!.toISOString(),
    }));
    const message = buildWaMessage(subadminUsername, codes);
    const phone = whatsappNumber!.replace(/\D/g, "");
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    return {
      subadminId,
      subadminUsername,
      whatsappNumber: whatsappNumber!,
      waUrl,
      codes,
    };
  });

  res.json({ alerts });
});

router.post("/admin/whatsapp-alerts/dismiss", requireSuperAdmin, async (req: Request, res: Response) => {
  const { codeIds, subadminId } = req.body as { codeIds: number[]; subadminId: number };
  if (!Array.isArray(codeIds) || !codeIds.length || !subadminId) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const now = new Date();
  const existing = await db
    .select({ codeId: whatsappAlertLogsTable.codeId })
    .from(whatsappAlertLogsTable)
    .where(inArray(whatsappAlertLogsTable.codeId, codeIds));

  const existingIds = new Set(existing.map(e => e.codeId));
  const toInsert = codeIds.filter(id => !existingIds.has(id));

  if (toInsert.length) {
    await db.insert(whatsappAlertLogsTable).values(
      toInsert.map(codeId => ({ codeId, subadminId, alertType: "expiring_soon", dismissedAt: now }))
    );
  }

  const toUpdate = codeIds.filter(id => existingIds.has(id));
  if (toUpdate.length) {
    await db
      .update(whatsappAlertLogsTable)
      .set({ dismissedAt: now })
      .where(inArray(whatsappAlertLogsTable.codeId, toUpdate));
  }

  res.json({ success: true });
});

export default router;
