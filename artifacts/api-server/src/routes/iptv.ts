import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { asc, eq, inArray, sql } from "drizzle-orm";
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
  enabled: iptvUsersTable.enabled, expiresAt: iptvUsersTable.expiresAt,
};

function active(account: { enabled: boolean; expiresAt: Date | null } | undefined) {
  return !!account?.enabled && (!account.expiresAt || account.expiresAt.getTime() > Date.now());
}

function daysFrom(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("amount" in value) || !("unit" in value)) return null;
  const { amount, unit } = value;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return null;
  const factor = unit === "days" ? 1 : unit === "months" ? 30 : unit === "years" ? 365 : 0;
  return factor && amount * factor <= 36500 ? amount * factor : null;
}

async function passwordHashFor(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + (await derivePassword(password, salt)).toString("hex");
}

async function authenticate(usernameInput: unknown, password: unknown) {
  const username = typeof usernameInput === "string" ? usernameInput.toLowerCase() : "";
  if (!usernamePattern.test(username) || typeof password !== "string" || password.length < 8 || password.length > 128) return null;
  const [user] = await db.select().from(iptvUsersTable).where(eq(iptvUsersTable.username, username));
  if (!user || !active(user) || !keyPattern.test(user.playlistKey)) return null;
  const [salt, hash] = user.passwordHash.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = await derivePassword(password, salt);
  return expected.length === actual.length && timingSafeEqual(actual, expected) ? user : null;
}

async function assignedChannels(ids: number[]) {
  if (!ids.length) return [];
  const rows = await db.select().from(channelsTable).where(inArray(channelsTable.id, ids)).orderBy(asc(channelsTable.order), asc(channelsTable.id));
  return rows.filter(channel => hlsUrl.test(channel.streamUrl));
}

function playbackUrl(id: number, key: string) {
  return `${publicBase}/api/live/channels/${id}/master.m3u8?key=${encodeURIComponent(key)}`;
}

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
  const channels = await assignedChannels(user.channelIds);
  const lines = ["#EXTM3U"];
  for (const channel of channels) {
    const name = m3uText(channel.name);
    lines.push(`#EXTINF:-1 tvg-id="${channel.id}" tvg-name="${name}" tvg-logo="${m3uText(channel.logo)}" group-title="${m3uText(channel.category)}",${name}`);
    lines.push(playbackUrl(channel.id, user.playlistKey));
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
  const days = req.body?.duration === undefined ? 30 : daysFrom(req.body.duration);
  if (days === null || !usernamePattern.test(username) || typeof password !== "string" || password.length < 8 || password.length > 128 ||
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
  const passwordHash = await passwordHashFor(password);
  const expiresAt = new Date(Date.now() + days * 86400000);
  const playlistKey = "iptv_" + randomBytes(32).toString("base64url");
  const [created] = await db.insert(iptvUsersTable).values({ username, passwordHash, playlistKey, channelIds: ids, expiresAt })
    .onConflictDoNothing({ target: iptvUsersTable.username }).returning(userFields);
  if (!created) { res.status(409).json({ error: "Ese usuario IPTV ya existe." }); return; }
  protectResponse(res);
  res.status(201).json({ ...created, accessUrl: `${publicBase}/api/iptv/list.m3u8?key=${playlistKey}` });
});

router.patch("/iptv/admin/users/:id", requireAdminAuth, onlyAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { enabled, password, duration } = req.body ?? {};
  const days = duration === undefined ? undefined : daysFrom(duration);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647 || (enabled !== undefined && typeof enabled !== "boolean") ||
      (password !== undefined && (typeof password !== "string" || password.length < 8 || password.length > 128)) ||
      days === null || (enabled === undefined && password === undefined && days === undefined)) {
    res.status(400).json({ error: "Datos de la cuenta IPTV inválidos." }); return;
  }
  const [updated] = await db.update(iptvUsersTable).set({
    ...(enabled !== undefined ? { enabled } : {}),
    ...(days !== undefined ? { expiresAt: sql`greatest(coalesce(${iptvUsersTable.expiresAt}, now()), now()) + ${days} * interval '1 day'` } : {}),
    ...(password !== undefined ? {
      passwordHash: await passwordHashFor(password), playlistKey: "iptv_" + randomBytes(32).toString("base64url"), deviceLeases: {},
    } : {}),
  }).where(eq(iptvUsersTable.id, id)).returning(userFields);
  if (!updated) { res.sendStatus(404); return; }
  res.json(updated);
});

router.get("/iptv/admin/users/:id/access", requireAdminAuth, onlyAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) { res.sendStatus(400); return; }
  const [user] = await db.select().from(iptvUsersTable).where(eq(iptvUsersTable.id, id));
  if (!user || !active(user)) { res.status(404).json({ error: "La cuenta IPTV no está activa." }); return; }
  protectResponse(res);
  res.json({ url: `${publicBase}/api/iptv/list.m3u8?key=${user.playlistKey}` });
});

router.get("/iptv/admin/users/:id/list.m3u8", requireAdminAuth, onlyAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) { res.sendStatus(400); return; }
  const [user] = await db.select().from(iptvUsersTable).where(eq(iptvUsersTable.id, id));
  if (!user || !active(user)) { res.status(404).json({ error: "La cuenta IPTV no está activa." }); return; }
  await sendPlaylist(res, user);
});

router.get("/iptv/list.m3u8", async (req, res) => {
  protectResponse(res);
  const key = req.query.key;
  if (typeof key === "string" && keyPattern.test(key)) {
    const [account] = await db.select().from(iptvUsersTable).where(eq(iptvUsersTable.playlistKey, key));
    if (!account || !active(account)) { res.sendStatus(401); return; }
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
  const user = await authenticate(userInput, password);
  if (!user) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Super TV IPTV", charset="UTF-8"');
    res.sendStatus(401); return;
  }
  await sendPlaylist(res, user);
});

router.get("/iptv/get.php", async (req, res) => {
  protectResponse(res);
  const user = await authenticate(req.query.username, req.query.password);
  if (!user) { res.sendStatus(401); return; }
  await sendPlaylist(res, user);
});

router.get("/iptv/player_api.php", async (req, res) => {
  protectResponse(res);
  const user = await authenticate(req.query.username, req.query.password);
  if (!user) { res.status(401).json({ user_info: { auth: 0, status: "Disabled" } }); return; }
  const action = req.query.action;
  const url = new URL(publicBase);
  if (!action) {
    res.json({
      user_info: { username: user.username, auth: 1, status: "Active", max_connections: "5",
        exp_date: user.expiresAt ? String(Math.floor(user.expiresAt.getTime() / 1000)) : null,
        allowed_output_formats: ["m3u8"] },
      server_info: { url: url.hostname, server_protocol: url.protocol.slice(0, -1),
        port: url.port || (url.protocol === "https:" ? "443" : "80"),
        https_port: url.port || "443", timezone: "UTC", timestamp_now: Math.floor(Date.now() / 1000) },
    });
    return;
  }
  if (action !== "get_live_categories" && action !== "get_live_streams") { res.json([]); return; }
  const channels = await assignedChannels(user.channelIds);
  const categories = [...new Set(channels.map(channel => channel.category || "En vivo"))].sort();
  if (action === "get_live_categories") {
    res.json(categories.map((category_name, index) => ({ category_id: String(index + 1), category_name, parent_id: 0 })));
    return;
  }
  res.json(channels.flatMap((channel, index) => {
    const category_id = String(categories.indexOf(channel.category || "En vivo") + 1);
    if (req.query.category_id && req.query.category_id !== "0" && req.query.category_id !== category_id) return [];
    return [{ num: index + 1, name: channel.name, stream_type: "live", stream_id: channel.id,
      stream_icon: channel.logo || "", epg_channel_id: null, category_id, tv_archive: 0,
      direct_source: playbackUrl(channel.id, user.playlistKey) }];
  }));
});

router.get("/iptv/live/:username/:password/:stream", async (req, res) => {
  protectResponse(res);
  const user = await authenticate(req.params.username, req.params.password);
  if (!user) { res.sendStatus(401); return; }
  const match = /^(\d+)(?:\.m3u8|\.ts)?$/.exec(req.params.stream);
  const id = Number(match?.[1]);
  if (!match || !user.channelIds.includes(id)) { res.sendStatus(404); return; }
  res.redirect(302, playbackUrl(id, user.playlistKey));
});

export default router;
