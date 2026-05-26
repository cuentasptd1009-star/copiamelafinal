import { Router, type Request, type Response } from "express";
import { requireAdminAuth } from "../lib/auth.js";

const router = Router();

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);
const PRIVATE_RANGES = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function isSafeUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (!SAFE_PROTOCOLS.has(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    return !PRIVATE_RANGES.some((r) => r.test(h));
  } catch {
    return false;
  }
}

const CONTENT_TYPE_FORMAT_MAP: Array<[RegExp, string]> = [
  [/mpegurl|x-mpegurl|vnd\.apple\.mpegurl/i, "hls"],
  [/dash\+xml/i, "dash"],
  [/x-flv|flash-video/i, "flv"],
  [/mp4|mp4v|mpeg4/i, "native"],
  [/webm/i, "native"],
  [/ogg/i, "native"],
  [/video\//i, "native"],
];

const EXT_FORMAT_MAP: Record<string, string> = {
  m3u8: "hls",
  mpd: "dash",
  flv: "flv",
  mp4: "native",
  webm: "native",
  mkv: "native",
  avi: "native",
  mov: "native",
  ts: "hls",
  m4v: "native",
  ogv: "native",
  "3gp": "native",
  wmv: "native",
  divx: "native",
  mp2ts: "hls",
  m2ts: "hls",
  mts: "hls",
};

const URL_PATTERN_MAP: Array<[RegExp, string]> = [
  [/\.m3u8($|\?|#)/i, "hls"],
  [/\/hls\//i, "hls"],
  [/manifest\.m3u8/i, "hls"],
  [/playlist\.m3u8/i, "hls"],
  [/\.mpd($|\?|#)/i, "dash"],
  [/\/dash\//i, "dash"],
  [/\.flv($|\?|#)/i, "flv"],
  [/\/stream\/flv/i, "flv"],
];

function detectFromUrl(url: string): string | null {
  for (const [pattern, fmt] of URL_PATTERN_MAP) {
    if (pattern.test(url)) return fmt;
  }
  try {
    const u = new URL(url);
    const pathname = u.pathname.toLowerCase();
    const ext = pathname.split(".").pop()?.split("?")[0] ?? "";
    if (ext && EXT_FORMAT_MAP[ext]) return EXT_FORMAT_MAP[ext];

    const params = Array.from(u.searchParams.values());
    for (const val of params) {
      const valExt = val.split(".").pop()?.toLowerCase() ?? "";
      if (valExt && EXT_FORMAT_MAP[valExt]) return EXT_FORMAT_MAP[valExt];
    }
  } catch {}
  return null;
}

function detectFromContentType(ct: string): string | null {
  for (const [pattern, fmt] of CONTENT_TYPE_FORMAT_MAP) {
    if (pattern.test(ct)) return fmt;
  }
  return null;
}

router.post("/detect-format", requireAdminAuth, async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }

  if (!isSafeUrl(url)) {
    res.status(400).json({ error: "URL not allowed" });
    return;
  }

  const fromUrl = detectFromUrl(url);
  if (fromUrl) {
    res.json({ format: fromUrl, source: "url" });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let format: string | null = null;

    try {
      const headRes = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SuperTV/1.0)",
          Range: "bytes=0-0",
        },
      });

      clearTimeout(timeout);

      const ct = headRes.headers.get("content-type") ?? "";
      const cd = headRes.headers.get("content-disposition") ?? "";
      const finalUrl = headRes.url || url;

      format = detectFromContentType(ct) || detectFromUrl(finalUrl);

      if (!format) {
        const cdMatch = cd.match(/filename[^;=\n]*=([^;\n]*)/i);
        if (cdMatch) {
          const fn = cdMatch[1].replace(/['"]/g, "").trim();
          const ext = fn.split(".").pop()?.toLowerCase() ?? "";
          if (ext && EXT_FORMAT_MAP[ext]) format = EXT_FORMAT_MAP[ext];
        }
      }
    } catch {
      clearTimeout(timeout);
    }

    if (!format) {
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 8000);
      try {
        const getRes = await fetch(url, {
          method: "GET",
          signal: controller2.signal,
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; SuperTV/1.0)",
            Range: "bytes=0-512",
          },
        });
        clearTimeout(timeout2);

        const ct = getRes.headers.get("content-type") ?? "";
        const finalUrl = getRes.url || url;
        format = detectFromContentType(ct) || detectFromUrl(finalUrl);

        if (!format) {
          const chunk = Buffer.from(await getRes.arrayBuffer()).slice(0, 16);
          if (chunk.slice(0, 4).toString("ascii") === "FLV\x01") {
            format = "flv";
          } else if (chunk.slice(4, 8).toString("ascii") === "ftyp") {
            format = "native";
          }
        }
      } catch {
        clearTimeout(timeout2);
      }
    }

    res.json({ format: format ?? "native", source: "probe" });
  } catch {
    res.json({ format: "native", source: "fallback" });
  }
});

export default router;
