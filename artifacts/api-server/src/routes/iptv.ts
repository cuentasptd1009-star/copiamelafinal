import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { channelsTable, db, iptvUsersTable } from "@workspace/db";
import { requireAdminAuth } from "../lib/auth.js";

const router = Router();
function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
}
const publicBase = (process.env.IPTV_PUBLIC_BASE || "https://167-233-103-143.sslip.io").replace(/\/+$/, "");
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const keyPattern = /^iptv_[A-Za-z0-9_-]{43}$/;
const hlsUrl = /\.m3u8(?:[?#]|$)|\/hls\//i;
const userFields = {
  id: iptvUsersTable.id, username: iptvUsersTable.username, channelIds: iptvUsersTable.channelIds,
  enabled: iptvUsersTable.enabled,
};

function onlyAdmin(req: Request, res: Response, next: () => void) {
  if (req.adminSession?.role !== "admin") {
    res.status(403).json({ error: "Solo el administrador puede gestionar IPTV." });
    return;
  }
  next();
}

function m3uText(value: string | null) {
  return (value ?? "").replace(/[\x00-\x1f\x7f"]/g, " ").trim();
}

function protectResponse(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
}

async function sendPlaylist(res: Response, user: { channelIds: number[]; playlistKey: string }) {
  const channels = user.channelIds.length
    ? await db.select().from(channelsTable).where(inArray(channelsTable.id, user.channelIds)).orderBy(asc(channelsTable.order), asc(channelsTable.id))
    : [];
  const lines = ["#EXTM3U"];
  for (const channel of channels) {
    if (!hlsUrl.test(channel.streamUrl)) continue;
    const name = m3uText(channel.name);
    lines.push(`#EXTINF:-1 tvg-id="${channel.id}" tvg-name="${name}" tvg-logo="${m3uText(channel.logo)}" group-title="${m3uText(channel.category)}",${name}`);
    lines.push(`${publicBase}/api/live/channels/${channel.id}/master.m3u8?key=${encodeURIComponent(user.playlistKey)}`);
  }
  protectResponse(res);
  res.type("application/vnd.apple.mpegurl").send(lines.join("\n") + "\n");
}

router.get("/iptv/admin/users", requireAdminAuth, onlyAdmin, async (_req, res) => {
  protectResponse(res);
  res.json(await db.select(userFields).from(iptvUsersTable).orderBy(asc(iptvUsersTable.username)));
});

router.get("/iptv/admin/channels", requireAdminAuth, onlyAdmin, async (_req, res) => {
  const channels = await db.select().from(channelsTable).orderBy(asc(channelsTable.order), asc(channelsTable.id));
  res.json(channels.filter(channel => hlsUrl.test(channel.streamUrl)).map(({ id, name, logo, category }) => ({ id, name, logo, category })));
});

router.post("/iptv/admin/users", requireAdminAuth, onlyAdmin, async (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
  const password = req.body?.password;
  const channelIds = req.body?.channelIds;
  if (!usernamePattern.test(username) || typeof password !== "string" || password.length < 8 || password.length > 128 ||
      !Array.isArray(channelIds) || channelIds.length < 1 || channelIds.length > 2000 ||
      channelIds.some(id => !Number.isInteger(id) || id < 1 || id > 2147483647)) {
    res.status(400).json({ error: "Usa un nombre de 3 a 32 caracteres, una contraseña de 8 a 128 y selecciona canales." });
    return;
  }
  const ids = [...new Set<number>(channelIds)];
  const channels = await db.select().from(channelsTable).where(inArray(channelsTable.id, ids));
  if (channels.length !== ids.length || channels.some(channel => !hlsUrl.test(channel.streamUrl))) {
    res.status(400).json({ error: "Selecciona canales HLS disponibles." });
    return;
  }
  const salt = randomBytes(16).toString("hex");
  const passwordHash = salt + ":" + (await derivePassword(password, salt)).toString("hex");
  const playlistKey = "iptv_" + randomBytes(32).toString("base64url");
  const [created] = await db.insert(iptvUsersTable).values({ username, passwordHash, playlistKey, channelIds: ids })
    .onConflictDoNothing({ target: iptvUsersTable.username }).returning(userFields);
  if (!created) { res.status(409).json({ error: "Ese usuario IPTV ya existe." }); return; }
  protectResponse(res);
  res.status(201).json({ ...created, accessUrl: `${publicBase}/api/iptv/list.m3u8?key=${playlistKey}` });
});

router.patch("/iptv/admin/users/:id", requireAdminAuth, onlyAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const enabled = req.body?.enabled;
  if (!Number.isInteger(id) || id < 1 || id > 2147483647 || typeof enabled !== "boolean") {
    res.status(400).json({ error: "Estado de usuario inválido." }); return;
  }
  const [updated] = await db.update(iptvUsersTable).set({ enabled }).where(eq(iptvUsersTable.id, id)).returning(userFields);
  if (!updated) { res.sendStatus(404); return; }
  res.json(updated);
});

router.get("/iptv/admin/users/:id/access", requireAdminAuth, onlyAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) { res.sendStatus(400); return; }
  const [user] = await db.select().from(iptvUsersTable).where(eq(iptvUsersTable.id, id));
  if (!user?.enabled) { res.status(404).json({ error: "La cuenta IPTV no está activa." }); return; }
  protectResponse(res);
  res.json({ url: `${publicBase}/api/iptv/list.m3u8?key=${user.playlistKey}` });
});

router.get("/iptv/admin/users/:id/list.m3u8", requireAdminAuth, onlyAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) { res.sendStatus(400); return; }
  const [user] = await db.select().from(iptvUsersTable).where(eq(iptvUsersTable.id, id));
  if (!user?.enabled) { res.status(404).json({ error: "La cuenta IPTV no está activa." }); return; }
  await sendPlaylist(res, user);
});

router.get("/iptv/list.m3u8", async (req, res) => {
  protectResponse(res);
  const key = req.query.key;
  if (typeof key === "string" && keyPattern.test(key)) {
    const [account] = await db.select().from(iptvUsersTable).where(eq(iptvUsersTable.playlistKey, key));
    if (!account?.enabled) { res.sendStatus(401); return; }
    await sendPlaylist(res, account);
    return;
  }
  let userInput: string | undefined;
  let password: string | undefined;
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Basic ") && authorization.length <= 256) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator !== -1) {
      userInput = decoded.slice(0, separator);
      password = decoded.slice(separator + 1);
    }
  }
  const username = typeof userInput === "string" ? userInput.toLowerCase() : "";
  if (!usernamePattern.test(username) || typeof password !== "string" || password.length < 8 || password.length > 128) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Super TV IPTV", charset="UTF-8"');
    res.sendStatus(401); return;
  }
  const [user] = await db.select().from(iptvUsersTable).where(eq(iptvUsersTable.username, username));
  if (!user?.enabled || !keyPattern.test(user.playlistKey)) { res.sendStatus(401); return; }
  const [salt, hash] = user.passwordHash.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = await derivePassword(password, salt);
  if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
    res.sendStatus(401); return;
  }
  await sendPlaylist(res, user);
});

export default router;
