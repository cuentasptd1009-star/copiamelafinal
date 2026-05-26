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

router.post("/check-url", requireAdminAuth, async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }
  if (!isSafeUrl(url)) {
    res.status(400).json({ ok: false, status: 0, error: "URL not allowed" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const r = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SuperTV/1.0)" },
    });
    clearTimeout(timeout);
    res.json({ ok: r.status < 400, status: r.status });
  } catch (err: unknown) {
    clearTimeout(timeout);
    const timedOut = (err as { name?: string })?.name === "AbortError";
    res.json({ ok: false, status: timedOut ? 408 : 0, error: timedOut ? "timeout" : "unreachable" });
  }
});

export default router;
