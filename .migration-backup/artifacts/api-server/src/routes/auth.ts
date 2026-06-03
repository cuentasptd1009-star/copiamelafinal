import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  sessionsTable,
  adminSessionsTable,
  accessCodesTable,
  subadminsTable,
  avatarsTable,
  settingsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  LoginWithCodeBody,
  AdminLoginBody,
} from "@workspace/api-zod";
import {
  generateToken,
  hashPassword,
  verifyPassword,
  extractToken,
  getUserSession,
  getAdminSession,
  invalidateSessionCache,
} from "../lib/auth.js";
import { z } from "zod";

const router = Router();

const ADMIN_USERNAME = "admin@admin";

const DEFAULT_ADMIN_PASSWORD = "admin";

async function getAdminPasswordHash(): Promise<string> {
  // ADMIN_PASSWORD env var always wins — use this to recover access if locked out
  if (process.env.ADMIN_PASSWORD) {
    return hashPassword(process.env.ADMIN_PASSWORD);
  }
  try {
    const [stored] = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, "adminPasswordHash"))
      .limit(1);
    if (stored?.value) return stored.value;
  } catch {
    // fall through to default
  }
  // No password configured anywhere — use default so admin can always log in
  return hashPassword(DEFAULT_ADMIN_PASSWORD);
}

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = LoginWithCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { code, deviceId } = parsed.data;

  const codes = await db
    .select()
    .from(accessCodesTable)
    .where(eq(accessCodesTable.code, code))
    .limit(1);

  if (!codes[0]) {
    res.status(401).json({ error: "El código no existe", code: "NOT_FOUND" });
    return;
  }

  const accessCode = codes[0];
  if (!accessCode.isActive) {
    res.status(401).json({ error: "El código está inactivo", code: "INACTIVE" });
    return;
  }

  if (accessCode.expiresAt && accessCode.expiresAt <= new Date()) {
    res.status(401).json({ error: "El código ha expirado", code: "EXPIRED" });
    return;
  }

  const existingSessions = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.codeId, accessCode.id));

  let sessionConflict = false;
  if (existingSessions.length > 0) {
    sessionConflict = true;
    await db.delete(sessionsTable).where(eq(sessionsTable.codeId, accessCode.id));
  }

  const token = generateToken();
  await db.insert(sessionsTable).values({
    codeId: accessCode.id,
    deviceId,
    token,
    lastActiveAt: new Date(),
  });

  res.json({
    token,
    sessionConflict,
    message: sessionConflict
      ? "Tu código está abierto en otro dispositivo. Se cerrará la otra sesión."
      : undefined,
    code: {
      id: accessCode.id,
      code: accessCode.code,
      name: accessCode.name,
      expiresAt: accessCode.expiresAt?.toISOString() ?? null,
      isActive: accessCode.isActive,
      isExpired: false,
      subadminId: accessCode.subadminId,
      packageId: accessCode.packageId,
      createdAt: accessCode.createdAt.toISOString(),
      activeSessionDevice: deviceId,
    },
  });
});

router.post("/auth/admin-login", async (req: Request, res: Response) => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { username, password } = parsed.data;

  const adminPasswordHash = await getAdminPasswordHash();
  if (username === ADMIN_USERNAME && verifyPassword(password, adminPasswordHash)) {
    const token = generateToken();
    await db.insert(adminSessionsTable).values({
      role: "admin",
      username,
      token,
    });
    res.json({ token, role: "admin", username, subadminId: null });
    return;
  }

  const subadmins = await db
    .select()
    .from(subadminsTable)
    .where(eq(subadminsTable.username, username))
    .limit(1);

  if (!subadmins[0] || !verifyPassword(password, subadmins[0].passwordHash)) {
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }

  const token = generateToken();
  await db.insert(adminSessionsTable).values({
    role: "subadmin",
    subadminId: subadmins[0].id,
    username,
    token,
  });
  res.json({ token, role: "subadmin", username, subadminId: subadmins[0].id });
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) {
    res.json({ success: true, message: "Logged out" });
    return;
  }
  await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
  await db.delete(adminSessionsTable).where(eq(adminSessionsTable.token, token));
  invalidateSessionCache(token);
  res.json({ success: true, message: "Logged out" });
});

router.get("/auth/me", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userSession = await getUserSession(token);
  if (userSession) {
    const code = await db
      .select()
      .from(accessCodesTable)
      .where(eq(accessCodesTable.id, userSession.codeId))
      .limit(1);
    if (code[0]) {
      let avatarUrl: string | null = null;
      if (code[0].avatarId) {
        const [av] = await db.select().from(avatarsTable).where(eq(avatarsTable.id, code[0].avatarId)).limit(1);
        if (av) avatarUrl = av.imageUrl;
      }

      // Only show WhatsApp support for codes created directly by admin (no subadminId)
      let providerWhatsapp: string | null = null;
      if (!code[0].subadminId) {
        const [setting] = await db.select({ value: settingsTable.value })
          .from(settingsTable)
          .where(eq(settingsTable.key, "whatsappNumber"))
          .limit(1);
        providerWhatsapp = setting?.value ?? null;
      }

      const isExpired = code[0].expiresAt != null && code[0].expiresAt <= new Date();

      res.json({
        type: "user",
        codeId: code[0].id,
        codeName: code[0].name,
        displayName: code[0].displayName ?? null,
        avatarId: code[0].avatarId ?? null,
        avatarUrl,
        expiresAt: code[0].expiresAt?.toISOString() ?? null,
        isExpired,
        role: null,
        subadminId: null,
        username: null,
        balance: null,
        providerWhatsapp,
      });
      return;
    }
  }

  const adminSession = await getAdminSession(token);
  if (adminSession) {
    let balance: number | null = null;
    if (adminSession.role === "subadmin" && adminSession.subadminId) {
      const [sa] = await db
        .select({ balance: subadminsTable.balance })
        .from(subadminsTable)
        .where(eq(subadminsTable.id, adminSession.subadminId));
      if (sa) balance = parseFloat(sa.balance as unknown as string);
    }
    res.json({
      type: adminSession.role === "admin" ? "admin" : "subadmin",
      codeId: null,
      codeName: null,
      displayName: null,
      avatarId: null,
      avatarUrl: null,
      expiresAt: null,
      role: adminSession.role,
      subadminId: adminSession.subadminId,
      username: adminSession.username,
      balance,
    });
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
});

const UpdateProfileBody = z.object({
  displayName: z.string().nullable().optional(),
  avatarId: z.number().int().nullable().optional(),
});

router.put("/auth/profile", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

  const userSession = await getUserSession(token);
  if (!userSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const { displayName, avatarId } = parsed.data;
  const patch: Record<string, unknown> = {};
  if (displayName !== undefined) patch.displayName = displayName;
  if (avatarId !== undefined) patch.avatarId = avatarId;

  if (Object.keys(patch).length > 0) {
    await db.update(accessCodesTable).set(patch).where(eq(accessCodesTable.id, userSession.codeId));
  }

  res.json({ success: true });
});

export default router;
