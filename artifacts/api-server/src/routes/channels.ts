import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { channelsTable, settingsTable } from "@workspace/db";
import { eq, asc, ilike, or, sql, inArray } from "drizzle-orm";
import { cache, TTL } from "../lib/cache.js";
import { channelTracker } from "../lib/tracker.js";
import {
  CreateChannelBody,
  UpdateChannelBody,
  GetChannelParams,
  UpdateChannelParams,
  DeleteChannelParams,
  ListChannelsQueryParams,
  ImportChannelsBody,
} from "@workspace/api-zod";
import { requireAdminAuth, requireUserAuth, extractToken, getUserSession, getAdminSession } from "../lib/auth.js";
import type { InsertChannel } from "@workspace/db";
import { accessCodesTable } from "@workspace/db";

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fd[0-9a-f]{2}:/i,
  /^fc00:/i,
];

function isSafeRelayUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "0.0.0.0") return false;
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return false;
  }
  return true;
}

function detectStreamFormat(url: string): string {
  if (url.includes("youtube.com/") || url.includes("youtu.be/")) return "youtube";
  const clean = url.toLowerCase().split("?")[0].split("#")[0];
  if (clean.endsWith(".m3u8") || clean.includes("/hls/")) return "hls";
  if (clean.endsWith(".mpd") || clean.includes("/dash/")) return "dash";
  if (clean.endsWith(".flv")) return "flv";
  return "native";
}


async function checkHlsAuth(req: Request, res: Response): Promise<{ ok: boolean; token?: string }> {
  const token = (req.query.token as string) || extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return { ok: false }; }
  const userSession = await getUserSession(token);
  const adminSession = await getAdminSession(token);
  if (!userSession && !adminSession) { res.status(401).json({ error: "Unauthorized" }); return { ok: false }; }
  if (userSession) {
    const codeCacheKey = `auth:code:${userSession.codeId}`;
    let code = cache.get<{ isActive: boolean; expiresAt: Date | null } | null>(codeCacheKey);
    if (code === undefined) {
      const [row] = await db.select().from(accessCodesTable).where(eq(accessCodesTable.id, userSession.codeId)).limit(1);
      code = row ?? null;
      cache.set(codeCacheKey, code, 120_000);
    }
    if (!code || !code.isActive) { res.status(401).json({ error: "Code inactive" }); return { ok: false }; }
    if (code.expiresAt != null && code.expiresAt <= new Date()) { res.status(401).json({ error: "Code expired" }); return { ok: false }; }
  }
  return { ok: true, token };
}

const router = Router();

const URL_PROTOCOLS = ["http://", "https://", "rtmp://", "rtmps://", "rtsp://", "udp://", "rtp://", "vlc://"];

function looksLikeUrl(line: string): boolean {
  return URL_PROTOCOLS.some((p) => line.startsWith(p));
}

function parseM3U(content: string) {
  // Strip BOM if present
  const cleaned = content.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const channels: { name: string; logo?: string; category?: string; streamUrl: string }[] = [];
  let currentName = "";
  let currentLogo = "";
  let currentCategory = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXTINF")) {
      const nameMatch = line.match(/,(.+)$/);
      const logoMatch = line.match(/tvg-logo="([^"]+)"/);
      const groupMatch = line.match(/group-title="([^"]+)"/);
      currentName = nameMatch ? nameMatch[1].trim() : "Canal";
      currentLogo = logoMatch ? logoMatch[1] : "";
      currentCategory = groupMatch ? groupMatch[1] : "";
    } else if (looksLikeUrl(line)) {
      if (!currentName) currentName = "Canal";
      // Strip any trailing comment or whitespace from URL
      const streamUrl = line.split(/\s+#/)[0].trim();
      channels.push({
        name: currentName,
        logo: currentLogo || undefined,
        category: currentCategory || undefined,
        streamUrl,
      });
      currentName = "";
      currentLogo = "";
      currentCategory = "";
    }
  }
  return channels;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|ico|svg)(\?[^\s|]*)?$/i;
const IMAGE_KEYWORD_RE = /\/(logo|icon|thumb|poster|banner|image|img)s?\//i;

function isStreamUrl(url: string): boolean {
  const protocols = ["http://", "https://", "rtmp://", "rtmps://", "rtsp://"];
  if (!protocols.some((p) => url.startsWith(p))) return false;
  if (url.endsWith(".html") || url.endsWith(".php")) return false;
  const path = url.split("?")[0];
  if (IMAGE_EXT_RE.test(path) && IMAGE_KEYWORD_RE.test(path)) return false;
  return true;
}

function isImageUrl(url: string): boolean {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  const path = url.split("?")[0];
  return IMAGE_EXT_RE.test(path) || IMAGE_KEYWORD_RE.test(path);
}

function detectLinks(content: string) {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const channels: { name: string; streamUrl: string; logo?: string }[] = [];

  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim()).filter(Boolean);

    if (parts.length >= 2) {
      const streamPart = parts.find((p) => isStreamUrl(p));
      const logoPart = parts.find((p) => isImageUrl(p));
      const namePart = parts.find((p) => !isStreamUrl(p) && !isImageUrl(p) && p.length > 0);
      if (streamPart) {
        channels.push({ name: namePart || `Canal ${channels.length + 1}`, streamUrl: streamPart, logo: logoPart });
        continue;
      }
    }

    const urlRe = /(?:https?|rtmp|rtmps|rtsp):\/\/[^\s\r\n"'<>|]+/g;
    const urls = line.match(urlRe) ?? [];
    const streams = urls.filter((u) => isStreamUrl(u));
    const images = urls.filter((u) => isImageUrl(u));

    for (const streamUrl of streams) {
      channels.push({ name: `Canal ${channels.length + 1}`, streamUrl, logo: images[0] });
    }
  }

  return channels;
}

router.get("/channels", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userSession = await getUserSession(token);
  const adminSession = await getAdminSession(token);
  if (!userSession && !adminSession) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Enforce code expiry for user sessions
  if (userSession) {
    const [code] = await db.select().from(accessCodesTable).where(eq(accessCodesTable.id, userSession.codeId)).limit(1);
    if (!code || !code.isActive) { res.status(401).json({ error: "Code inactive" }); return; }
    if (code.expiresAt != null && code.expiresAt <= new Date()) { res.status(401).json({ error: "Code expired" }); return; }
  }

  const isAdmin = !!adminSession;

  const parsed = ListChannelsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};

  const cacheKey = `channels:list:${isAdmin ? "admin" : "user"}:${params.category ?? ""}:${params.search ?? ""}`;
  const cached = cache.get<object[]>(cacheKey);
  if (cached) {
    res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    res.json(cached);
    return;
  }

  let query = db.select().from(channelsTable).$dynamic();
  
  if (params.category) {
    query = query.where(eq(channelsTable.category, params.category));
  } else if (params.search) {
    query = query.where(ilike(channelsTable.name, `%${params.search}%`));
  }

  const channels = await query.orderBy(asc(channelsTable.order));
  const result = channels.map((c) => {
    const streamFormat = detectStreamFormat(c.streamUrl);
    return {
      ...c,
      createdAt: c.createdAt.toISOString(),
      streamUrl: c.streamUrl, // Direct URL returned to all authenticated users
      streamFormat,
    };
  });

  cache.set(cacheKey, result, TTL.MEDIUM);
  res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  res.json(result);
});

router.get("/channels/categories", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userSession = await getUserSession(token);
  const adminSession = await getAdminSession(token);
  if (!userSession && !adminSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const cacheKey = "channels:categories";
  const cached = cache.get<string[]>(cacheKey);
  if (cached) {
    res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
    res.json(cached);
    return;
  }

  const rows = await db
    .selectDistinct({ category: channelsTable.category })
    .from(channelsTable)
    .orderBy(asc(channelsTable.category));
  const allCats = rows.map((r) => r.category).filter(Boolean) as string[];

  const [orderSetting] = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "channelCategoryOrder"))
    .limit(1);

  let result = allCats;
  if (orderSetting?.value) {
    try {
      const savedOrder: string[] = JSON.parse(orderSetting.value);
      const savedSet = new Set(savedOrder);
      const ordered = savedOrder.filter((c) => allCats.includes(c));
      const remaining = allCats.filter((c) => !savedSet.has(c));
      result = [...ordered, ...remaining];
    } catch {
      result = allCats;
    }
  }

  cache.set(cacheKey, result, TTL.LONG);
  res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
  res.json(result);
});

router.get("/channels/category-order", requireAdminAuth, async (_req: Request, res: Response) => {
  const [orderSetting] = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "channelCategoryOrder"))
    .limit(1);

  if (!orderSetting?.value) {
    res.json([]);
    return;
  }
  try {
    res.json(JSON.parse(orderSetting.value));
  } catch {
    res.json([]);
  }
});

router.post("/channels/category-order", requireAdminAuth, async (req: Request, res: Response) => {
  const { order } = req.body as { order?: unknown };
  if (!Array.isArray(order) || !order.every((o) => typeof o === "string")) {
    res.status(400).json({ error: "order must be an array of strings" });
    return;
  }
  await db
    .insert(settingsTable)
    .values({ key: "channelCategoryOrder", value: JSON.stringify(order), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: JSON.stringify(order), updatedAt: new Date() },
    });
  cache.invalidatePrefix("channels:");
  res.json({ success: true });
});

router.post("/channels/import", requireAdminAuth, async (req: Request, res: Response) => {
  const parsed = ImportChannelsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { content, format } = parsed.data;
  let toImport: { name: string; logo?: string; category?: string; streamUrl: string }[] = [];

  if (format === "m3u" || (format === "auto" && content.includes("#EXTM3U"))) {
    toImport = parseM3U(content);
  } else {
    toImport = detectLinks(content);
  }

  let imported = 0;
  let failed = 0;
  const createdChannels = [];

  const maxOrder = await db
    .select({ max: sql<number>`coalesce(max(${channelsTable.order}), 0)` })
    .from(channelsTable);
  let orderStart = (maxOrder[0]?.max ?? 0) + 1;

  for (const ch of toImport) {
    try {
      const [created] = await db
        .insert(channelsTable)
        .values({ ...ch, order: orderStart++ })
        .returning();
      createdChannels.push({ ...created, createdAt: created.createdAt.toISOString() });
      imported++;
    } catch {
      failed++;
    }
  }

  cache.invalidatePrefix("channels:");
  res.json({ imported, failed, channels: createdChannels });
});

router.post("/channels/reorder", requireAdminAuth, async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "ids must be an array" });
    return;
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(channelsTable).set({ order: i + 1 }).where(eq(channelsTable.id, ids[i]));
    }
  });
  cache.invalidatePrefix("channels:");
  res.json({ success: true });
});

function rewriteM3u8(
  text: string,
  baseUrl: URL,
  channelId: string,
  token: string,
): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) return line;
      let absolute: string;
      try {
        absolute = new URL(trimmed, baseUrl).toString();
      } catch {
        return line;
      }
      // Sub-manifests (.m3u8) still go through the relay so they can be rewritten too
      const lower = absolute.toLowerCase().split("?")[0];
      if (lower.endsWith(".m3u8") || lower.includes("manifest")) {
        const encoded = Buffer.from(absolute).toString("base64url");
        return `/api/channels/${channelId}/hls-relay?s=${encoded}&token=${encodeURIComponent(token)}`;
      }
      // Route all segment URLs through hls-relay — relay handles HTTPS upgrade or proxy
      const encoded = Buffer.from(absolute).toString("base64url");
      return `/api/channels/${channelId}/hls-relay?s=${encoded}&token=${encodeURIComponent(token)}`;
    })
    .join("\n");
}

router.get("/channels/:id/hls-proxy", async (req: Request, res: Response) => {
  const auth = await checkHlsAuth(req, res);
  if (!auth.ok) return;

  const parsed = GetChannelParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [channel] = await db.select().from(channelsTable).where(eq(channelsTable.id, parsed.data.id));
  if (!channel) { res.status(404).json({ error: "Not found" }); return; }

  channelTracker.record(channel.id, channel.name);

    // HTTP streams: fetch manifest server-side (KB only) → rewrite all URLs to HTTPS relay
    if (channel.streamUrl.startsWith("http://")) {
      try {
        const streamUpstream = await fetch(channel.streamUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SuperTV/1.0)", Accept: "*/*" },
          signal: AbortSignal.timeout(15000),
          redirect: "follow",
        });
        if (!streamUpstream.ok) { res.status(502).send("Upstream error"); return; }
        const manifestText = await streamUpstream.text();
        const manifestBaseUrl = new URL(channel.streamUrl);
        const rewritten = rewriteM3u8(manifestText, manifestBaseUrl, String(channel.id), auth.token!);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(rewritten);
      } catch {
        res.status(502).send("Failed to fetch stream");
      }
    } else {
      res.redirect(302, channel.streamUrl);
    }
  });

router.get("/channels/:id/hls-relay", async (req: Request, res: Response) => {
  const auth = await checkHlsAuth(req, res);
  if (!auth.ok) return;

  const parsed = GetChannelParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).send("Invalid id"); return; }

  const s = req.query.s as string;
  if (!s) { res.status(400).send("Missing segment"); return; }

  let segUrl: string;
  try {
    segUrl = Buffer.from(s, "base64url").toString("utf8");
  } catch {
    res.status(400).send("Invalid segment token");
    return;
  }

  if (!isSafeRelayUrl(segUrl)) {
    res.status(400).send("Invalid segment URL");
    return;
  }

  const urlClean = segUrl.toLowerCase().split("?")[0];
  const looksLikeManifest = urlClean.endsWith(".m3u8") || urlClean.includes("manifest");

  // FAST PATH: HTTPS segment (not a manifest) — redirect immediately.
  // Browser fetches directly from the origin: ZERO Vercel bandwidth, full playback speed.
  if (segUrl.startsWith("https://") && !looksLikeManifest) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.redirect(302, segUrl);
    return;
  }

  // HTTPS manifest — fetch and rewrite URLs (manifests are only ~2–10 KB, negligible).
  if (segUrl.startsWith("https://") && looksLikeManifest) {
    try {
      const upstream = await fetch(segUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SuperTV/1.0)", Accept: "*/*" },
        signal: AbortSignal.timeout(15000),
      });
      if (!upstream.ok) { res.status(502).send("Segment unavailable"); return; }
      const contentType = upstream.headers.get("content-type") || "";
      const isManifest = contentType.includes("mpegurl") || looksLikeManifest;
      if (isManifest) {
        const text = await upstream.text();
        const baseUrl = new URL(segUrl);
        const token = (req.query.token as string) || "";
        const rewritten = rewriteM3u8(text, baseUrl, String(parsed.data.id), token);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(rewritten);
      } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.redirect(302, segUrl);
      }
    } catch {
      res.status(502).send("Failed to fetch manifest");
    }
    return;
  }

  // HTTP URL: try to upgrade to HTTPS first — redirect costs zero bandwidth.
  // Only fall back to proxying if the origin truly does not support HTTPS.
  try {
    if (looksLikeManifest) {
      // HTTP manifest: must fetch + rewrite so segment URLs get upgraded/proxied correctly.
      const upstream = await fetch(segUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SuperTV/1.0)", Accept: "*/*" },
        signal: AbortSignal.timeout(15000),
      });
      if (!upstream.ok) { res.status(502).send("Segment unavailable"); return; }
      const text = await upstream.text();
      const baseUrl = new URL(segUrl);
      const token = (req.query.token as string) || "";
      const rewritten = rewriteM3u8(text, baseUrl, String(parsed.data.id), token);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(rewritten);
    } else {
      // HTTP segment: probe once per host whether HTTPS is available, then redirect.
      const hostKey = `https_ok:${new URL(segUrl).hostname}`;
      let httpsOk = cache.get<boolean>(hostKey);
      if (httpsOk === undefined) {
        const httpsUrl = segUrl.replace("http://", "https://");
        try {
          const probe = await fetch(httpsUrl, {
            method: "HEAD",
            signal: AbortSignal.timeout(3000),
            redirect: "follow",
          });
          httpsOk = probe.ok;
        } catch {
          httpsOk = false;
        }
        cache.set(hostKey, httpsOk, 600_000);
      }

      if (httpsOk) {
        // Host supports HTTPS — redirect browser to fetch directly (zero Vercel bandwidth)
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.redirect(302, segUrl.replace("http://", "https://"));
      } else {
        // HTTP-only origin — must proxy through Vercel to avoid mixed-content blocking on HTTPS pages.
        try {
          const upstream = await fetch(segUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SuperTV/1.0)", Accept: "*/*" },
            signal: AbortSignal.timeout(15000),
          });
          if (!upstream.ok) { res.status(502).send("Segment unavailable"); return; }
          const segBuf = await upstream.arrayBuffer();
          const segCt = upstream.headers.get("content-type") || "video/MP2T";
          res.setHeader("Content-Type", segCt);
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.send(Buffer.from(segBuf));
        } catch {
          res.status(502).send("Failed to fetch segment");
        }
      }
    }
  } catch {
    res.status(502).send("Failed to fetch segment");
  }
});

router.get("/channels/:id/stream", async (req: Request, res: Response) => {
  const token = (req.query.token as string) || extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

  const userSession = await getUserSession(token);
  const adminSession = await getAdminSession(token);

  if (!userSession && !adminSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (userSession) {
    const [code] = await db.select().from(accessCodesTable).where(eq(accessCodesTable.id, userSession.codeId)).limit(1);
    if (!code || !code.isActive) { res.status(401).json({ error: "Code inactive" }); return; }
    if (code.expiresAt != null && code.expiresAt <= new Date()) { res.status(401).json({ error: "Code expired" }); return; }
  }

  const parsed = GetChannelParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [channel] = await db.select().from(channelsTable).where(eq(channelsTable.id, parsed.data.id));
  if (!channel) { res.status(404).json({ error: "Not found" }); return; }

  res.redirect(302, channel.streamUrl);
});

router.get("/channels/:id", async (req: Request, res: Response) => {
  const parsed = GetChannelParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [channel] = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.id, parsed.data.id));
  if (!channel) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const token = extractToken(req);
  let isAdmin = false;
  if (token) {
    const adminSession = await getAdminSession(token);
    if (adminSession) isAdmin = true;
  }

  res.json({ ...channel, createdAt: channel.createdAt.toISOString(), streamUrl: isAdmin ? channel.streamUrl : null });
});

router.post("/channels", requireAdminAuth, async (req: Request, res: Response) => {
  const parsed = CreateChannelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const maxOrder = await db
    .select({ max: sql<number>`coalesce(max(${channelsTable.order}), 0)` })
    .from(channelsTable);
  const order = parsed.data.order ?? (maxOrder[0]?.max ?? 0) + 1;

  const [created] = await db
    .insert(channelsTable)
    .values({ ...parsed.data, order } as InsertChannel)
    .returning();
  cache.invalidatePrefix("channels:");
  res.status(201).json({ ...created, createdAt: created.createdAt.toISOString() });
});

router.put("/channels/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const params = UpdateChannelParams.safeParse(req.params);
  const body = UpdateChannelBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [updated] = await db
    .update(channelsTable)
    .set(body.data)
    .where(eq(channelsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  cache.invalidatePrefix("channels:");
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.patch("/channels/:id/category", requireAdminAuth, async (req: Request, res: Response) => {
  const parsed = GetChannelParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const { category } = req.body as { category?: unknown };
  const cat = category === null || category === "" ? null : typeof category === "string" ? category.trim() : null;
  const [updated] = await db
    .update(channelsTable)
    .set({ category: cat ?? undefined })
    .where(eq(channelsTable.id, parsed.data.id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  cache.invalidatePrefix("channels:");
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.patch("/channels/bulk-category", requireAdminAuth, async (req: Request, res: Response) => {
  const { ids, category } = req.body as { ids?: unknown; category?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === 'number')) {
    res.status(400).json({ error: "ids must be a non-empty array of numbers" });
    return;
  }
  const cat = category === null || category === '' ? null : typeof category === 'string' ? category.trim() : null;
  await db.update(channelsTable)
    .set({ category: cat ?? undefined })
    .where(inArray(channelsTable.id, ids as number[]));
  cache.invalidatePrefix("channels:");
  res.json({ success: true, updated: ids.length });
});

router.delete("/channels/bulk", requireAdminAuth, async (req: Request, res: Response) => {
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === 'number')) {
    res.status(400).json({ error: "ids must be a non-empty array of numbers" });
    return;
  }
  await db.delete(channelsTable).where(inArray(channelsTable.id, ids as number[]));
  cache.invalidatePrefix("channels:");
  res.json({ success: true, deleted: ids.length });
});

router.delete("/channels/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const parsed = DeleteChannelParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(channelsTable).where(eq(channelsTable.id, parsed.data.id));
  cache.invalidatePrefix("channels:");
  res.json({ success: true, message: "Deleted" });
});

router.post("/channels/:id/test-stream", requireAdminAuth, async (req: Request, res: Response) => {
  const parsed = GetChannelParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [channel] = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.id, parsed.data.id));

  if (!channel) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const url = channel.streamUrl;
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "SuperTV/1.0",
      },
    }).catch(async () => {
      return fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "SuperTV/1.0",
          Range: "bytes=0-0",
        },
      });
    });

    clearTimeout(timeout);
    const latency = Date.now() - startTime;

    const ok = response.status >= 200 && response.status < 400;
    res.json({
      ok,
      status: response.status,
      latencyMs: latency,
      url,
      message: ok
        ? `Enlace activo (${response.status}) - ${latency}ms`
        : `El servidor respondió con error ${response.status}`,
    });
  } catch (err: unknown) {
    const latency = Date.now() - startTime;
    const error = err instanceof Error ? err : null;
    const isTimeout = error?.name === "AbortError";
    res.json({
      ok: false,
      status: 0,
      latencyMs: latency,
      url,
      message: isTimeout
        ? "Tiempo de espera agotado (8s) — el enlace no responde"
        : `No se pudo conectar: ${error?.message ?? "error desconocido"}`,
    });
  }
});

export default router;
