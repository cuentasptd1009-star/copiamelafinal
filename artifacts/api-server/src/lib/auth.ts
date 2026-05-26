import crypto from "crypto";
import { db } from "@workspace/db";
import { sessionsTable, adminSessionsTable, accessCodesTable, subadminsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { cache } from "./cache.js";

const LAST_ACTIVE_THROTTLE = 60_000;

const SESSION_TTL = 120_000;

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 5; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith("scrypt:")) {
    const [, salt, hashHex] = stored.split(":");
    const hash = crypto.scryptSync(password, salt, 64);
    const storedHash = Buffer.from(hashHex, "hex");
    return crypto.timingSafeEqual(hash, storedHash);
  }
  const legacyHash = crypto.createHash("sha256").update(password + "supertv_salt").digest("hex");
  return legacyHash === stored;
}

export async function getUserSession(token: string) {
  const cacheKey = `auth:user:${token}`;
  const cached = cache.get<typeof sessions[0] | null>(cacheKey);
  if (cached !== undefined) return cached;

  const sessions = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.token, token))
    .limit(1);
  const result = sessions[0] ?? null;
  cache.set(cacheKey, result, SESSION_TTL);
  return result;
}

export async function getAdminSession(token: string) {
  const cacheKey = `auth:admin:${token}`;
  const cached = cache.get<typeof sessions[0] | null>(cacheKey);
  if (cached !== undefined) return cached;

  const sessions = await db
    .select()
    .from(adminSessionsTable)
    .where(eq(adminSessionsTable.token, token))
    .limit(1);
  const result = sessions[0] ?? null;
  cache.set(cacheKey, result, SESSION_TTL);
  return result;
}

export function invalidateSessionCache(token: string): void {
  cache.delete(`auth:user:${token}`);
  cache.delete(`auth:admin:${token}`);
}

export function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

export async function requireUserAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const session = await getUserSession(token);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const codeCacheKey = `auth:code:${session.codeId}`;
  let codeResult = cache.get<{ isActive: boolean; expiresAt: Date | null } | null>(codeCacheKey);
  if (codeResult === undefined) {
    const code = await db
      .select()
      .from(accessCodesTable)
      .where(eq(accessCodesTable.id, session.codeId))
      .limit(1);
    codeResult = code[0] ?? null;
    cache.set(codeCacheKey, codeResult, SESSION_TTL);
  }

  if (!codeResult || !codeResult.isActive) {
    res.status(401).json({ error: "Code inactive" });
    return;
  }

  if (codeResult.expiresAt != null && codeResult.expiresAt <= new Date()) {
    res.status(401).json({ error: "Code expired", code: "EXPIRED" });
    return;
  }
  req.userSession = session;
  req.userCode = codeResult;

  const throttleKey = `lastactive:${session.id}`;
  if (!cache.get(throttleKey)) {
    cache.set(throttleKey, true, LAST_ACTIVE_THROTTLE);
    db.update(sessionsTable)
      .set({ lastActiveAt: new Date() })
      .where(eq(sessionsTable.id, session.id))
      .execute()
      .catch(() => {});
  }

  next();
}

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const session = await getAdminSession(token);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.adminSession = session;
  next();
}

export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAdminAuth(req, res, async () => {
    const session = req.adminSession;
    if (session.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
}
