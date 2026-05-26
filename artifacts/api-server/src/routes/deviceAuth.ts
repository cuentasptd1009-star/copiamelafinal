import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { accessCodesTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateToken } from "../lib/auth.js";

const router = Router();

interface PendingActivation {
  status: 'pending' | 'confirmed';
  token?: string;
  expiresAt: number;
}

const pendingActivations = new Map<string, PendingActivation>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingActivations.entries()) {
    if (val.expiresAt < now) pendingActivations.delete(key);
  }
}, 60_000);

router.post("/device-auth/request", (req: Request, res: Response) => {
  const { deviceId } = req.body as { deviceId?: string };
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 4) {
    res.status(400).json({ error: "deviceId requerido" });
    return;
  }
  pendingActivations.set(deviceId, {
    status: 'pending',
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  res.json({ ok: true });
});

router.post("/device-auth/confirm", async (req: Request, res: Response) => {
  const { deviceId, code } = req.body as { deviceId?: string; code?: string };
  if (!deviceId || !code) {
    res.status(400).json({ error: "deviceId y code son requeridos" });
    return;
  }

  const pending = pendingActivations.get(deviceId);
  if (!pending || pending.expiresAt < Date.now()) {
    res.status(404).json({ error: "Solicitud expirada. Escanea el QR nuevamente." });
    return;
  }

  const codes = await db
    .select()
    .from(accessCodesTable)
    .where(eq(accessCodesTable.code, code.toUpperCase().trim()))
    .limit(1);

  if (!codes[0]) {
    res.status(401).json({ error: "El código no existe" });
    return;
  }
  const accessCode = codes[0];
  if (!accessCode.isActive) {
    res.status(401).json({ error: "El código está inactivo" });
    return;
  }
  if (accessCode.expiresAt && accessCode.expiresAt <= new Date()) {
    res.status(401).json({ error: "El código ha expirado" });
    return;
  }

  await db.delete(sessionsTable).where(eq(sessionsTable.codeId, accessCode.id));

  const token = generateToken();
  await db.insert(sessionsTable).values({
    codeId: accessCode.id,
    deviceId,
    token,
    lastActiveAt: new Date(),
  });

  pendingActivations.set(deviceId, {
    status: 'confirmed',
    token,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  res.json({ ok: true, message: "¡Dispositivo activado!" });
});

router.get("/device-auth/status/:deviceId", (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const pending = pendingActivations.get(deviceId);

  if (!pending || pending.expiresAt < Date.now()) {
    res.json({ status: 'expired' });
    return;
  }

  if (pending.status === 'confirmed' && pending.token) {
    const token = pending.token;
    pendingActivations.delete(deviceId);
    res.json({ status: 'confirmed', token });
    return;
  }

  res.json({ status: 'pending' });
});

export default router;
