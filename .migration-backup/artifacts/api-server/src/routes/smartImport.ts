import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { moviesTable, seriesTable, seasonsTable, episodesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdminAuth } from "../lib/auth.js";
import { cache } from "../lib/cache.js";

const router = Router();

const VIDEO_EXTS = new Set([
  // MPEG family
  'mp4', 'mpeg', 'mpg', 'mpe', 'm1v', 'm2v', 'mp2', 'mpv', 'mp2ts',
  // Matroska / WebM
  'mkv', 'mk3d', 'webm',
  // Apple / QuickTime
  'mov', 'qt', 'm4v',
  // AVI / Windows
  'avi', 'divx', 'xvid', 'wmv', 'asf',
  // Flash
  'flv', 'f4v', 'f4p', 'f4b',
  // Transport streams
  'ts', 'm2ts', 'mts', 'trp', 'tp',
  // Real Media
  'rmvb', 'rm', 'rv',
  // HLS / DASH
  'm3u8', 'mpd',
  // OGG
  'ogv', 'ogg', 'ogx',
  // Raw / H.264 / H.265
  'h264', 'h265', 'hevc', '264', '265',
  // Mobile / 3GPP
  '3gp', '3gpp', '3g2', '3gpp2',
  // DVD / Blu-ray / VCD
  'vob', 'ifo', 'dat', 'bup', 'bdmv', 'evo', 'iso',
  // Motion JPEG
  'mjpeg', 'mjpg',
  // Camera / recorder formats
  'mod', 'tod', 'rec',
  // Windows recordings
  'wtv',
  // Samsung / misc device
  'svi', 'amv',
  // MXF (broadcast)
  'mxf',
  // Nullsoft / NuppelVideo
  'nsv', 'nuv',
  // Other common
  'dv', 'roq', 'yuv',
]);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

function isVideo(name: string) { return VIDEO_EXTS.has(name.split('.').pop()?.toLowerCase() ?? ''); }
function isImage(name: string) { return IMAGE_EXTS.has(name.split('.').pop()?.toLowerCase() ?? ''); }

// Strip only the file extension — keep the exact filename as the title
function filenameToTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim();
}
// Legacy alias kept for compatibility
function cleanTitle(name: string) { return filenameToTitle(name); }
function detectSeasonEp(name: string): { season: number; episode: number } | null {
  const m = name.match(/[Ss](\d{1,2})[Ee](\d{1,3})|(\d{1,2})x(\d{1,3})|[Tt]emporada[\s_\-]*(\d+).*[Ee]pisodio[\s_\-]*(\d+)/i);
  if (!m) return null;
  if (m[1] && m[2]) return { season: parseInt(m[1]), episode: parseInt(m[2]) };
  if (m[3] && m[4]) return { season: parseInt(m[3]), episode: parseInt(m[4]) };
  if (m[5] && m[6]) return { season: parseInt(m[5]), episode: parseInt(m[6]) };
  return null;
}
function detectSeasonFolder(name: string): number | null {
  const m = name.match(/[Ss]eason[\s_\-]*(\d+)|[Tt]emporada[\s_\-]*(\d+)|^[Ss](\d{1,2})$/i);
  if (!m) return null;
  return parseInt(m[1] || m[2] || m[3]);
}
function extractEpNumber(name: string): number | null {
  const m = name.match(/[Ee](\d{1,3})|[Ee]pisodio[\s_\-]*(\d+)|[Cc]ap[\s_\-]*(\d+)/i) ||
    name.match(/[\s._\-](\d{2,3})[\s._\-]/);
  return m ? parseInt(m[1] || m[2] || m[3]) : null;
}

function detectUrlFormat(url: string): string | null {
  if (!url) return null;
  const clean = url.toLowerCase().split('?')[0].split('#')[0];
  if (clean.endsWith('.m3u8') || clean.includes('/hls/') || clean.includes('manifest.m3u8')) return 'hls';
  if (clean.endsWith('.mpd') || clean.includes('/dash/')) return 'dash';
  if (clean.endsWith('.flv') || clean.endsWith('.f4v') || clean.endsWith('.f4p') || clean.endsWith('.f4b')) return 'flv';
  if (clean.includes('/terabox') || clean.includes('terabox.com') || clean.includes('1024tera') || clean.includes('terabox/play')) return 'native';
  const ext = clean.split('.').pop() ?? '';
  // All formats that play natively in browser or via native player
  const nativeExts = new Set([
    'mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v', 'ogv', 'ogg', 'ogx',
    '3gp', '3gpp', '3g2', '3gpp2', 'wmv', 'divx', 'xvid',
    'mpg', 'mpeg', 'mpe', 'mp2', 'mpv', 'm1v', 'm2v', 'mp2ts',
    'ts', 'm2ts', 'mts', 'trp', 'tp',
    'rmvb', 'rm', 'rv',
    'asf', 'vob', 'dat', 'evo',
    'h264', 'h265', 'hevc', '264', '265',
    'mjpeg', 'mjpg', 'dv', 'mxf', 'mod', 'tod', 'rec',
    'wtv', 'svi', 'amv', 'nsv', 'nuv', 'roq',
  ]);
  if (nativeExts.has(ext)) return 'native';
  return null;
}

function isTeraboxUrl(url: string): boolean {
  return /terabox\.com\/s\/|1024terabox\.com\/s\/|1024tera\.com\/s\/|terabox\.app\/s\/|freeterabox\.com\/s\//i.test(url);
}
function isMegaUrl(url: string): boolean {
  return /mega\.nz|mega\.co\.nz/i.test(url);
}
function isGoogleDriveUrl(url: string): boolean {
  return /drive\.google\.com|docs\.google\.com/i.test(url);
}
function isDropboxUrl(url: string): boolean {
  return /dropbox\.com\//i.test(url);
}
function isDirectVideoUrl(url: string): boolean {
  const clean = url.toLowerCase().split('?')[0].split('#')[0];
  const ext = clean.split('.').pop() ?? '';
  return VIDEO_EXTS.has(ext);
}
function convertDropboxToDirectUrl(url: string): string {
  return url
    .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
    .replace(/[?&]dl=0/, '')
    .replace(/\?$/, '');
}

function extractShortcode(url: string): string | null {
  const m = url.match(/\/s\/([A-Za-z0-9_\-]+)/);
  return m ? m[1] : null;
}

function extractSurl(shortcode: string): string {
  // Terabox surl is the shortcode without the leading '1' prefix
  return shortcode.startsWith('1') ? shortcode.slice(1) : shortcode;
}

interface AnalyzedItem {
  name: string;
  url: string;
  poster?: string;
  size?: number;
  season?: number;
  episode?: number;
  folderName?: string;
  fsId?: string;
}

// In-memory dlink cache (fresh links last ~40 min)
const dlinkCache = new Map<string, { url: string; expires: number }>();

function buildTeraboxProxyUrl(shortcode: string, fsId: string, dirPath?: string): string {
  let url = `/api/terabox/play?shortcode=${encodeURIComponent(shortcode)}&fsId=${encodeURIComponent(fsId)}`;
  if (dirPath) url += `&dir=${encodeURIComponent(dirPath)}`;
  return url;
}

interface SeriesGroup {
  title: string;
  folderUrl: string;
  poster?: string;
  items: AnalyzedItem[];
  seasons: Record<number, AnalyzedItem[]>;
}

interface SmartAnalyzeResult {
  source: 'terabox' | 'http';
  type: 'movie' | 'series' | 'multi-series';
  title: string;
  items: AnalyzedItem[];
  seasons?: Record<number, AnalyzedItem[]>;
  seasonTitles?: Record<number, string>;
  seriesGroups?: SeriesGroup[];
  poster?: string;
  totalFiles: number;
  hasFolders: boolean;
  folderCount: number;
}

// ─── Terabox credentials (session cookies + tokens) ──────────────────────────

interface TeraCredentials {
  cookieStr: string;
  jsToken: string;
  pcfToken: string;
  base: string;
}

/** Read admin-configured Terabox account cookies from DB (cached 5 min) */
let _teraboxCookiesCache: { value: string; expires: number } | null = null;
async function getStoredTeraboxCookies(): Promise<string> {
  if (_teraboxCookiesCache && _teraboxCookiesCache.expires > Date.now()) {
    return _teraboxCookiesCache.value;
  }
  try {
    const [row] = await db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, 'teraboxCookies')).limit(1);
    const value = row?.value ?? '';
    _teraboxCookiesCache = { value, expires: Date.now() + 5 * 60 * 1000 };
    return value;
  } catch {
    return '';
  }
}

/** Invalidate stored Terabox cookies cache (call after saving new cookies) */
function invalidateTeraboxCookiesCache() { _teraboxCookiesCache = null; }

// All known Terabox domains to try in order
const TERA_BASES = [
  'https://www.1024tera.com',
  'https://1024terabox.com',
  'https://www.terabox.com',
  'https://terabox.app',
  'https://freeterabox.com',
];

const TERA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── Terabox scanner ─────────────────────────────────────────────────────────

interface TeraFile {
  fs_id: string;
  server_filename: string;
  isdir: number;
  size: number;
  dlink?: string;
  thumbs?: { url1?: string; url2?: string; url3?: string };
  path?: string;
}

interface TeraListing {
  list: TeraFile[];
  uk: number;
  shareid: number;
  sign: string;
  timestamp: number;
  token?: string; // share-scoped access token from shorturlinfo (used as t= param)
  base: string;
  creds: TeraCredentials;
}

interface HtmlShareData {
  list?: TeraFile[];
  uk?: number;
  shareid?: number;
  sign?: string;
  timestamp?: number;
  jsToken?: string;
  pcfToken?: string;
  cookieStr?: string;
}

/** Try to extract share listing and auth data directly from the HTML page */
function extractTeraboxFromHtml(html: string): HtmlShareData {
  const result: HtmlShareData = {};

  // ── Auth tokens ──────────────────────────────────────────────────────────
  const jsTokPatterns = [
    /decodeURIComponent\(`([^`]+)`\)/,
    /"jsToken"\s*:\s*"([^"]+)"/,
    /jsToken\s*[=:]\s*["']([^"']+)["']/,
    /fn\s*\(\s*["']([^"']+)["']\s*\)/,
  ];
  for (const p of jsTokPatterns) {
    const m = html.match(p);
    if (m) {
      // First pattern needs decoding + extraction
      if (p.source.includes('decodeURIComponent')) {
        try {
          const decoded = decodeURIComponent(m[1]);
          const inner = decoded.match(/fn\("([^"]+)"\)/);
          if (inner) { result.jsToken = inner[1]; break; }
        } catch {}
      } else {
        result.jsToken = m[1];
        break;
      }
    }
  }

  const pcfPatterns = [
    /"pcftoken"\s*:\s*"([^"]+)"/,
    /pcfToken\s*[=:]\s*["']([^"']+)["']/,
    /"bdstoken"\s*:\s*"([^"]+)"/,
  ];
  for (const p of pcfPatterns) {
    const m = html.match(p);
    if (m) { result.pcfToken = m[1]; break; }
  }

  // ── Embedded file list (window.yunData, __INITIAL_STATE__, __NEXT_DATA__) ─
  const jsonBlobPatterns = [
    /window\.yunData\s*=\s*(\{[\s\S]{10,8000}?\})\s*;?\s*(?:window\.|<\/script>)/,
    /yunData\s*=\s*(\{[\s\S]{10,8000}?\})\s*;?\s*(?:window\.|<\/script>)/,
    /__INITIAL_STATE__\s*=\s*(\{[\s\S]{10,8000}?\})\s*;?\s*(?:window\.|<\/script>)/,
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]{10,50000}?)<\/script>/,
  ];

  for (const p of jsonBlobPatterns) {
    const m = html.match(p);
    if (!m) continue;
    try {
      const obj: any = JSON.parse(m[1]);
      // Direct list at root
      if (Array.isArray(obj.list) && obj.list.length > 0) {
        result.list = obj.list;
        if (obj.uk) result.uk = obj.uk;
        if (obj.shareid) result.shareid = obj.shareid;
        if (obj.sign) result.sign = obj.sign;
        if (obj.timestamp) result.timestamp = obj.timestamp;
        return result;
      }
      // Nested inside props/pageProps (Next.js)
      const nested = obj?.props?.pageProps ?? obj?.pageProps ?? obj?.data ?? obj?.shareinfo ?? null;
      if (nested && Array.isArray(nested.list) && nested.list.length > 0) {
        result.list = nested.list;
        if (nested.uk) result.uk = nested.uk;
        if (nested.shareid) result.shareid = nested.shareid;
        if (nested.sign) result.sign = nested.sign;
        if (nested.timestamp) result.timestamp = nested.timestamp;
        return result;
      }
    } catch { /* keep trying */ }
  }

  // ── uk / shareid / sign / timestamp as standalone vars ───────────────────
  const ukM = html.match(/"uk"\s*:\s*(\d+)/) || html.match(/uk\s*=\s*(\d+)/);
  if (ukM) result.uk = Number(ukM[1]);
  const sidM = html.match(/"shareid"\s*:\s*(\d+)/) || html.match(/shareid\s*=\s*(\d+)/);
  if (sidM) result.shareid = Number(sidM[1]);
  const signM = html.match(/"sign"\s*:\s*"([^"]{10,})"/);
  if (signM) result.sign = signM[1];
  const tsM = html.match(/"timestamp"\s*:\s*(\d+)/);
  if (tsM) result.timestamp = Number(tsM[1]);

  return result;
}

async function fetchPageAndExtract(url: string, cookieStr = ''): Promise<{ html: string; cookies: string; data: HtmlShareData } | null> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': TERA_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    if (cookieStr) headers['Cookie'] = cookieStr;

    const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;

    const setCookies = (res.headers as any).getSetCookie?.() as string[] ?? [];
    const newCookies = setCookies.map((c: string) => c.split(';')[0]).join('; ');
    const mergedCookies = [cookieStr, newCookies].filter(Boolean).join('; ');

    const html = await res.text();
    const data = extractTeraboxFromHtml(html);
    data.cookieStr = mergedCookies;
    return { html, cookies: mergedCookies, data };
  } catch { return null; }
}

async function fetchTeraboxListing(shortcode: string, _unused?: TeraCredentials): Promise<TeraListing | null> {
  const surl = extractSurl(shortcode);
  // Pre-load admin-configured account cookies (provides bdstoken/BDUSS needed for dlink APIs)
  const storedCookies = await getStoredTeraboxCookies();

  for (const base of TERA_BASES) {
    // ── Step 1: visit the short URL and the init page to get cookies + HTML data ──
    let cookieStr = storedCookies; // Start with stored account cookies
    let extracted: HtmlShareData = {};

    // Try short URL first (may redirect to init page)
    const shortRes = await fetchPageAndExtract(`${base}/s/${shortcode}`, cookieStr);
    if (shortRes) {
      cookieStr = shortRes.cookies;
      extracted = shortRes.data;
    }

    // Also try the init page
    if (!extracted.list) {
      const initRes = await fetchPageAndExtract(`${base}/sharing/init?surl=${surl}`, cookieStr);
      if (initRes) {
        cookieStr = initRes.cookies;
        const d = initRes.data;
        if (d.jsToken && !extracted.jsToken) extracted.jsToken = d.jsToken;
        if (d.pcfToken && !extracted.pcfToken) extracted.pcfToken = d.pcfToken;
        if (d.uk && !extracted.uk) extracted.uk = d.uk;
        if (d.shareid && !extracted.shareid) extracted.shareid = d.shareid;
        if (d.sign && !extracted.sign) extracted.sign = d.sign;
        if (d.timestamp && !extracted.timestamp) extracted.timestamp = d.timestamp;
        if (d.list) { extracted.list = d.list; }
      }
    }

    const creds: TeraCredentials = {
      cookieStr,
      jsToken: extracted.jsToken || '',
      pcfToken: extracted.pcfToken || '',
      base,
    };

    // ── Step 2: if we already have the file list from HTML, return it ──────
    if (extracted.list && extracted.list.length > 0) {
      console.log(`[terabox] HTML extraction succeeded on ${base}: ${extracted.list.length} items, uk=${extracted.uk}, shareid=${extracted.shareid}`);
      return {
        list: extracted.list,
        uk: extracted.uk ?? 0,
        shareid: extracted.shareid ?? 0,
        sign: extracted.sign || '',
        timestamp: extracted.timestamp || 0,
        base,
        creds,
      };
    }

    const hasBdstoken = cookieStr.includes('bdstoken=') || cookieStr.includes('BDUSS=');
    console.log(`[terabox] HTML extraction on ${base}: no list, uk=${extracted.uk}, shareid=${extracted.shareid}, jsToken=${!!extracted.jsToken}, pcfToken=${!!extracted.pcfToken}, cookies=${!!cookieStr}, hasBdstoken=${hasBdstoken}, cookieKeys=${cookieStr.split(';').map(c=>c.trim().split('=')[0]).join(',')}`);

    // ── Step 3: try API calls with extracted auth data ────────────────────
    const uk = extracted.uk;
    const shareid = extracted.shareid;
    const sign = extracted.sign || '';
    const timestamp = extracted.timestamp || Math.floor(Date.now() / 1000);
    const jsToken = extracted.jsToken || '';
    const pcfToken = extracted.pcfToken || '';

    const commonHeaders: Record<string, string> = {
      'User-Agent': TERA_UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': `${base}/sharing/init?surl=${surl}`,
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (cookieStr) commonHeaders['Cookie'] = cookieStr;

    const extParams = `jsToken=${jsToken}&bdstoken=${pcfToken}&web=1&app_id=250528&clienttype=0&channel=chunlei`;

    // Try share/list with root=1 first (returns list + metadata in one call)
    // Then shorturlinfo for metadata only, then derive listing URLs from it
    const rootListUrls = [
      `${base}/share/list?shorturl=${shortcode}&root=1&dlink=1&order=other&desc=0&page=1&num=200&${extParams}`,
      `${base}/share/list?shorturl=${surl}&root=1&dlink=1&order=other&desc=0&page=1&num=200&${extParams}`,
      `${base}/share/list?shorturl=${shortcode}&root=1&dlink=1&order=other&desc=0&page=1&num=200&web=1&app_id=250528&clienttype=0`,
      `${base}/api/shorturlinfo?shorturl=${shortcode}&root=1&dlink=1&${extParams}`,
      `${base}/api/shorturlinfo?shorturl=${surl}&root=1&dlink=1&${extParams}`,
      `${base}/api/shorturlinfo?shorturl=${shortcode}&root=1&dlink=1`,
    ];

    for (const url of rootListUrls) {
      try {
        const r = await fetch(url, { headers: commonHeaders, signal: AbortSignal.timeout(10000) });
        if (!r.ok) { console.log(`[terabox] ${url} => HTTP ${r.status}`); continue; }
        const data: any = await r.json();
        console.log(`[terabox] ${url.split('?')[0]} => errno=${data.errno}, list=${Array.isArray(data.list) ? data.list.length : 'none'}, uk=${data.uk}`);
        if (Array.isArray(data.list) && data.list.length > 0) {
          const finalUk = data.uk ?? uk ?? 0;
          const finalShareid = data.shareid ?? shareid ?? 0;
          return { list: data.list, uk: finalUk, shareid: finalShareid, sign: data.sign ?? sign, timestamp: data.timestamp ?? timestamp, token: data.token, base, creds };
        }
        // Got metadata but no list — use it to build listing URL
        if ((data.uk || uk) && (data.shareid || shareid)) {
          const resolvedUk = data.uk ?? uk!;
          const resolvedShareid = data.shareid ?? shareid!;
          const resolvedSign = data.sign ?? sign;
          const resolvedTs = data.timestamp ?? timestamp;
          const resolvedToken = data.token;
          const authParams = `uk=${resolvedUk}&shareid=${resolvedShareid}&sign=${resolvedSign}&timestamp=${resolvedTs}`;

          const listUrls = [
            `${base}/share/list?surl=${surl}&${authParams}&${extParams}&dir=%2F&order=other&desc=0&showempty=0&page=1&num=200`,
            `${base}/share/list?shorturl=${shortcode}&${authParams}&${extParams}&dir=%2F&order=other&desc=0&page=1&num=200`,
            `${base}/share/list?shorturl=${shortcode}&root=1&${authParams}&${extParams}&order=other&desc=0&page=1&num=200`,
          ];
          for (const lu of listUrls) {
            try {
              const lr = await fetch(lu, { headers: commonHeaders, signal: AbortSignal.timeout(10000) });
              if (!lr.ok) continue;
              const ld: any = await lr.json();
              console.log(`[terabox] listing => errno=${ld.errno}, list=${Array.isArray(ld.list) ? ld.list.length : 'none'}`);
              if (Array.isArray(ld.list) && ld.list.length > 0) {
                return { list: ld.list, uk: resolvedUk, shareid: resolvedShareid, sign: resolvedSign, timestamp: resolvedTs, token: resolvedToken, base, creds };
              }
            } catch { /* continue */ }
          }
        }
      } catch { /* continue */ }
    }
  }

  return null;
}

async function fetchTeraboxSubfolder(
  shortcode: string,
  listing: TeraListing,
  dirPath: string
): Promise<TeraFile[]> {
  const { base, creds, uk, shareid, sign, timestamp } = listing;
  const surl = extractSurl(shortcode);
  const hasAuth = uk && shareid && sign;
  const authParams = `uk=${uk}&shareid=${shareid}&sign=${sign}&timestamp=${timestamp}`;
  const extParams = `jsToken=${creds.jsToken}&bdstoken=${creds.pcfToken}&web=1&app_id=250528&clienttype=0`;
  const noExtParams = `web=1&app_id=250528&clienttype=0`;
  const commonHeaders: Record<string, string> = {
    'User-Agent': TERA_UA,
    'Accept': 'application/json',
    'Referer': `${base}/sharing/init?surl=${surl}`,
  };
  if (creds.cookieStr) commonHeaders['Cookie'] = creds.cookieStr;

  const dir = encodeURIComponent(dirPath);
  const attempts: string[] = [];

  if (hasAuth) {
    attempts.push(
      `${base}/share/list?surl=${surl}&${authParams}&${extParams}&dir=${dir}&order=other&desc=0&page=1&num=200`,
      `${base}/share/list?shorturl=${shortcode}&${authParams}&${extParams}&dir=${dir}&order=other&desc=0&page=1&num=200`,
      `${base}/api/shorturlinfo?shorturl=${shortcode}&root=0&dir=${dir}&${authParams}&${extParams}&page=1&num=200`,
    );
  }
  // Always try without auth params too (some shares work without them)
  attempts.push(
    `${base}/share/list?shorturl=${shortcode}&dir=${dir}&order=other&desc=0&page=1&num=200&${noExtParams}`,
    `${base}/share/list?shorturl=${surl}&dir=${dir}&order=other&desc=0&page=1&num=200&${noExtParams}`,
    `${base}/api/shorturlinfo?shorturl=${shortcode}&root=0&dir=${dir}&page=1&num=200&${noExtParams}`,
  );

  for (const url of attempts) {
    try {
      const r = await fetch(url, { headers: commonHeaders, signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const data: any = await r.json();
      if (Array.isArray(data.list) && data.list.length > 0) {
        const sample = data.list[0];
        const hasDlink = !!sample?.dlink;
        console.log(`[terabox] subfolder ${dirPath}: ${data.list.length} items, errno=${data.errno}, hasDlink=${hasDlink}, sampleKeys=${Object.keys(sample).join(',')}`);
        return data.list;
      }
    } catch { /* continue */ }
  }
  console.log(`[terabox] subfolder ${dirPath}: 0 items (all attempts failed)`);
  return [];
}

function teraThumb(f: TeraFile): string | undefined {
  return f.thumbs?.url3 || f.thumbs?.url2 || f.thumbs?.url1;
}

function teraItemUrl(shortcode: string, f: TeraFile, dirPath?: string): string {
  if (f.fs_id) return buildTeraboxProxyUrl(shortcode, String(f.fs_id), dirPath);
  return f.dlink || '';
}

interface ScannedVideo extends TeraFile {
  _folderPoster?: string;
  _dirPath: string;
}

interface FolderScanResult {
  videos: ScannedVideo[];
  poster?: string;
}

/**
 * Recursively scan a Terabox folder, collecting all video files at any depth.
 * Each file carries its containing _dirPath so the proxy can re-fetch it later.
 */
async function scanTeraboxFolder(
  shortcode: string,
  listing: TeraListing,
  dirPath: string,
  depth: number,
  maxDepth: number,
  inheritedPoster?: string,
): Promise<FolderScanResult> {
  const subFiles = await fetchTeraboxSubfolder(shortcode, listing, dirPath);
  const subFolders = subFiles.filter(f => Number(f.isdir) === 1);
  const subVideos = subFiles.filter(f => Number(f.isdir) === 0 && isVideo(f.server_filename));
  const subPosterFile = subFiles.find(f => Number(f.isdir) === 0 && isImage(f.server_filename) && /poster|cover|folder|backdrop/i.test(f.server_filename));
  const localPoster = subPosterFile?.dlink || inheritedPoster;

  const result: FolderScanResult = { videos: [], poster: localPoster };

  // Add video files found at this level — attach the dirPath so we can re-scan it at play time
  for (const v of subVideos) {
    result.videos.push({ ...v, _folderPoster: teraThumb(v) || localPoster, _dirPath: dirPath });
  }

  // Recurse into sub-folders if within depth limit
  if (depth < maxDepth) {
    for (const sf of subFolders) {
      const sfPath = sf.path || `${dirPath}/${sf.server_filename}`;
      const sfResult = await scanTeraboxFolder(shortcode, listing, sfPath, depth + 1, maxDepth, teraThumb(sf) || localPoster);
      result.videos.push(...sfResult.videos);
      if (!result.poster && sfResult.poster) result.poster = sfResult.poster;
    }
  }

  return result;
}

async function analyzeTerabox(url: string): Promise<SmartAnalyzeResult> {
  const shortcode = extractShortcode(url);
  if (!shortcode) throw new Error("No se pudo extraer el código del enlace Terabox.");

  const listing = await fetchTeraboxListing(shortcode);

  if (!listing) {
    throw new Error(
      "No se pudo leer el contenido del enlace Terabox.\n\n" +
      "Terabox requiere autenticación para listar archivos compartidos vía API. " +
      "Usa el modo manual: pega las URLs directas de video (una por línea) para importarlas."
    );
  }

  const { list } = listing;
  console.log(`[terabox] root list: ${list.length} items`, list.map(f => `${f.server_filename}(isdir=${f.isdir})`).join(', '));
  const videos = list.filter(f => Number(f.isdir) === 0 && isVideo(f.server_filename));
  const images = list.filter(f => Number(f.isdir) === 0 && isImage(f.server_filename));
  const folders = list.filter(f => Number(f.isdir) === 1);
  const rootPoster = images.find(i => /poster|cover|folder|backdrop/i.test(i.server_filename));

  const items: AnalyzedItem[] = [];
  const seasons: Record<number, AnalyzedItem[]> = {};
  const seasonTitles: Record<number, string> = {};
  let seasonCounter = 1;

  if (folders.length > 0) {
    // Scan each root folder recursively (up to 5 levels deep)
    // Collect per-folder scan results to detect multi-movie structure
    const folderScans: Array<{ folder: TeraFile; sNum: number; scanResult: FolderScanResult }> = [];

    for (const folder of folders) {
      const detectedSeason = detectSeasonFolder(folder.server_filename);
      const sNum = detectedSeason ?? seasonCounter++;
      seasonTitles[sNum] = folder.server_filename;
      const dirPath = folder.path || `/${folder.server_filename}`;
      const scanResult = await scanTeraboxFolder(shortcode, listing, dirPath, 0, 5, teraThumb(folder) || rootPoster?.dlink);
      folderScans.push({ folder, sNum, scanResult });
    }

    // Detect multi-movie structure: every folder contains exactly 1 video file
    const isMultiMovie = folderScans.length > 0 && folderScans.every(({ scanResult }) => scanResult.videos.length === 1);

    if (isMultiMovie) {
      // Each folder = one separate movie. Flatten, no seasons.
      for (const { folder, scanResult } of folderScans) {
        const v = scanResult.videos[0];
        const item: AnalyzedItem = {
          name: filenameToTitle(folder.server_filename),
          url: teraItemUrl(shortcode, v, v._dirPath),
          size: v.size,
          fsId: v.fs_id ? String(v.fs_id) : undefined,
          poster: v._folderPoster || rootPoster?.dlink,
        };
        items.push(item);
      }
    } else {
      // Series/multi-episode structure. Each folder = a season.
      for (const { folder, sNum, scanResult } of folderScans) {
        const folderPoster = scanResult.poster || rootPoster?.dlink;
        let epIndex = 0;
        for (const v of scanResult.videos) {
          const seEp = detectSeasonEp(v.server_filename);
          const epNum = seEp?.episode || extractEpNumber(v.server_filename) || (++epIndex);
          const item: AnalyzedItem = {
            name: filenameToTitle(v.server_filename),
            url: teraItemUrl(shortcode, v, v._dirPath),
            size: v.size,
            fsId: v.fs_id ? String(v.fs_id) : undefined,
            poster: v._folderPoster || folderPoster,
            season: sNum,
            episode: epNum,
            folderName: folder.server_filename,
          };
          if (!seasons[sNum]) seasons[sNum] = [];
          seasons[sNum].push(item);
          items.push(item);
        }
      }
    }

    // Loose root-level videos (not inside any folder)
    for (const v of videos) {
      const proxyUrl = teraItemUrl(shortcode, v, '/');
      if (!items.find(i => i.fsId && i.fsId === (v.fs_id ? String(v.fs_id) : undefined))) {
        const seEp = detectSeasonEp(v.server_filename);
        const item: AnalyzedItem = {
          name: filenameToTitle(v.server_filename),
          url: proxyUrl,
          size: v.size,
          fsId: v.fs_id ? String(v.fs_id) : undefined,
          poster: teraThumb(v) || rootPoster?.dlink,
          season: seEp?.season,
          episode: seEp?.episode,
        };
        items.push(item);
      }
    }
  } else {
    // No folders — flat list of videos (root level)
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const seEp = detectSeasonEp(v.server_filename);
      const item: AnalyzedItem = {
        name: filenameToTitle(v.server_filename),
        url: teraItemUrl(shortcode, v, '/'),
        size: v.size,
        fsId: v.fs_id ? String(v.fs_id) : undefined,
        poster: teraThumb(v) || rootPoster?.dlink,
        season: seEp?.season,
        episode: seEp?.episode,
      };
      if (seEp) {
        const s = seEp.season;
        if (!seasons[s]) seasons[s] = [];
        seasons[s].push(item);
      }
      items.push(item);
    }
  }

  const hasSeasons = Object.keys(seasons).length > 0;
  const looksLikeSeries = hasSeasons || (folders.length > 0 && items.some(i => i.season));

  const rootName = list[0]?.server_filename ? filenameToTitle(list[0].server_filename.split('/')[0]) : 'Importación Terabox';
  const title = folders.length > 0
    ? (filenameToTitle(list.find(f => f.isdir)?.server_filename?.split('/')[0] || shortcode))
    : (items[0]?.name || rootName);

  return {
    source: 'terabox',
    type: looksLikeSeries ? 'series' : 'movie',
    title,
    items,
    seasons: hasSeasons ? seasons : undefined,
    seasonTitles: hasSeasons ? seasonTitles : undefined,
    poster: rootPoster?.dlink || items[0]?.poster,
    totalFiles: items.length,
    hasFolders: folders.length > 0,
    folderCount: folders.length,
  };
}

// ─── HTTP directory scanner ───────────────────────────────────────────────────

function extractLinksFromHtml(html: string, baseUrl: string): Array<{ name: string; url: string; isDir: boolean }> {
  const results: Array<{ name: string; url: string; isDir: boolean }> = [];
  const hrefRe = /href="([^"?#]+)"/gi;
  let m: RegExpExecArray | null;
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1];
    if (href.startsWith('/') && href === base.pathname) continue;
    if (href.startsWith('?') || href.startsWith('#') || href === '../' || href === './') continue;
    try {
      const fullUrl = new URL(href, baseUrl).href;
      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);
      const isDir = href.endsWith('/');
      const name = decodeURIComponent(href.replace(/\/$/, '').split('/').pop() || '');
      if (!name || name === '..') continue;
      results.push({ name, url: fullUrl, isDir });
    } catch {}
  }
  return results;
}

async function fetchHtmlLinks(url: string, timeoutMs = 15000): Promise<Array<{ name: string; url: string; isDir: boolean }> | null> {
  try {
    const baseUrl = url.endsWith('/') ? url : url + '/';
    const r = await fetch(baseUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const html = await r.text();
    return extractLinksFromHtml(html, baseUrl);
  } catch { return null; }
}

// Recursively collect all video files from an HTTP directory (up to maxDepth levels)
async function collectHttpVideos(
  baseUrl: string,
  seasonTitles: Record<number, string>,
  items: AnalyzedItem[],
  seasons: Record<number, AnalyzedItem[]>,
  rootPoster: string | undefined,
  seasonNum: number,
  folderName: string,
  depth: number,
  maxDepth: number,
): Promise<void> {
  const links = await fetchHtmlLinks(baseUrl, 10000);
  if (!links) return;

  const subVideos = links.filter(l => !l.isDir && isVideo(l.name));
  const subFolders = links.filter(l => l.isDir);
  const subPosterLink = links.find(l => !l.isDir && isImage(l.name) && /poster|cover|folder|backdrop/i.test(l.name));
  const folderPoster = subPosterLink?.url || rootPoster;

  // Add all video files at this level
  for (let i = 0; i < subVideos.length; i++) {
    const v = subVideos[i];
    const seEp = detectSeasonEp(v.name);
    const epNum = seEp?.episode || extractEpNumber(v.name) || (items.filter(it => it.season === seasonNum).length + 1);
    const item: AnalyzedItem = {
      name: filenameToTitle(v.name),
      url: v.url,
      poster: folderPoster,
      season: seasonNum,
      episode: epNum,
      folderName,
    };
    if (!seasons[seasonNum]) seasons[seasonNum] = [];
    seasons[seasonNum].push(item);
    items.push(item);
  }

  // Recurse into subdirectories if within depth limit
  if (depth < maxDepth) {
    for (const sf of subFolders) {
      await collectHttpVideos(sf.url, seasonTitles, items, seasons, folderPoster, seasonNum, sf.name, depth + 1, maxDepth);
    }
  }
}

async function analyzeHttp(url: string): Promise<SmartAnalyzeResult> {
  const baseUrl = url.endsWith('/') ? url : url + '/';
  const links = await fetchHtmlLinks(baseUrl);
  if (!links) throw new Error("No se pudo acceder a la URL. Verifica que sea un directorio HTTP público.");

  const videoFiles = links.filter(l => !l.isDir && isVideo(l.name));
  const folders = links.filter(l => l.isDir);
  const imageFiles = links.filter(l => !l.isDir && isImage(l.name));
  const rootPoster = imageFiles.find(i => /poster|cover|folder|backdrop/i.test(i.name));
  const rootPosterUrl = rootPoster?.url;

  // Root has only videos (no subdirectories)
  if (videoFiles.length > 0 && folders.length === 0) {
    const items: AnalyzedItem[] = videoFiles.map((v) => {
      const seEp = detectSeasonEp(v.name);
      return { name: filenameToTitle(v.name), url: v.url, poster: rootPosterUrl, season: seEp?.season, episode: seEp?.episode };
    });
    const hasSeasons = items.some(i => i.season);
    const seasons: Record<number, AnalyzedItem[]> = {};
    if (hasSeasons) {
      for (const item of items) {
        const s = item.season || 1;
        if (!seasons[s]) seasons[s] = [];
        seasons[s].push(item);
      }
    }
    return {
      source: 'http', type: hasSeasons ? 'series' : 'movie',
      title: filenameToTitle(baseUrl.split('/').filter(Boolean).pop() || 'Importación'),
      items, seasons: hasSeasons ? seasons : undefined,
      poster: rootPosterUrl, totalFiles: items.length, hasFolders: false, folderCount: 0,
    };
  }

  if (folders.length > 0) {
    // Heuristic: if root URL itself is a series folder (subfolders = seasons or episodes)
    const seasonFolders = folders.filter(f => detectSeasonFolder(f.name) !== null);
    const isSeasonStructure = seasonFolders.length > 0 || folders.length <= 5;

    if (isSeasonStructure) {
      // Treat each top-level folder as a season
      const items: AnalyzedItem[] = [];
      const seasons: Record<number, AnalyzedItem[]> = {};
      const seasonTitles: Record<number, string> = {};
      let seasonCounter = 1;

      // Root-level loose videos (season 1 if no folder info)
      for (let vi = 0; vi < videoFiles.length; vi++) {
        const v = videoFiles[vi];
        const seEp = detectSeasonEp(v.name);
        const sNum = seEp?.season || 1;
        const epNum = seEp?.episode || extractEpNumber(v.name) || (vi + 1);
        const item: AnalyzedItem = { name: filenameToTitle(v.name), url: v.url, poster: rootPosterUrl, season: sNum, episode: epNum };
        if (!seasons[sNum]) seasons[sNum] = [];
        seasons[sNum].push(item);
        items.push(item);
      }

      // Scan every folder (no limit) recursively
      for (const folder of folders) {
        const sNum = detectSeasonFolder(folder.name) ?? seasonCounter++;
        seasonTitles[sNum] = folder.name;
        await collectHttpVideos(folder.url, seasonTitles, items, seasons, rootPosterUrl, sNum, folder.name, 0, 3);
      }

      const rootName = filenameToTitle(baseUrl.split('/').filter(Boolean).pop() || 'Serie');
      const hasSeasonData = Object.keys(seasons).length > 0;
      return {
        source: 'http', type: 'series', title: rootName,
        items, seasons: hasSeasonData ? seasons : undefined,
        seasonTitles: hasSeasonData ? seasonTitles : undefined,
        poster: rootPosterUrl, totalFiles: items.length, hasFolders: true, folderCount: folders.length,
      };
    } else {
      // Multiple top-level folders = multiple separate series
      const seriesGroups: SeriesGroup[] = [];

      for (const folder of folders) {
        const subLinks = await fetchHtmlLinks(folder.url, 10000);
        if (!subLinks) continue;
        const subVideos = subLinks.filter(l => !l.isDir && isVideo(l.name));
        const subFolders = subLinks.filter(l => l.isDir);
        const subPoster = subLinks.find(l => !l.isDir && isImage(l.name) && /poster|cover|folder/i.test(l.name));

        if (subVideos.length === 0 && subFolders.length === 0) continue;

        const seriesItems: AnalyzedItem[] = [];
        const seriesSeasons: Record<number, AnalyzedItem[]> = {};
        const seriesSeasonTitles: Record<number, string> = {};
        let sCounter = 1;

        if (subFolders.length > 0) {
          // Subfolders = seasons of this series
          for (const sf of subFolders) {
            const seasonNum = detectSeasonFolder(sf.name) ?? sCounter++;
            seriesSeasonTitles[seasonNum] = sf.name;
            await collectHttpVideos(sf.url, seriesSeasonTitles, seriesItems, seriesSeasons, subPoster?.url, seasonNum, sf.name, 0, 2);
          }
          // Any loose videos in this series folder
          for (let vi = 0; vi < subVideos.length; vi++) {
            const v = subVideos[vi];
            const seEp = detectSeasonEp(v.name);
            const sNum = seEp?.season || 1;
            const epNum = seEp?.episode || extractEpNumber(v.name) || (vi + 1);
            const item: AnalyzedItem = { name: filenameToTitle(v.name), url: v.url, poster: subPoster?.url, season: sNum, episode: epNum };
            if (!seriesSeasons[sNum]) seriesSeasons[sNum] = [];
            seriesSeasons[sNum].push(item);
            seriesItems.push(item);
          }
        } else {
          // Only videos in this folder
          for (let vi = 0; vi < subVideos.length; vi++) {
            const v = subVideos[vi];
            const seEp = detectSeasonEp(v.name);
            const sNum = seEp?.season || 1;
            const epNum = seEp?.episode || extractEpNumber(v.name) || (vi + 1);
            const item: AnalyzedItem = { name: filenameToTitle(v.name), url: v.url, poster: subPoster?.url, season: sNum, episode: epNum };
            if (!seriesSeasons[sNum]) seriesSeasons[sNum] = [];
            seriesSeasons[sNum].push(item);
            seriesItems.push(item);
          }
        }

        if (seriesItems.length > 0) {
          seriesGroups.push({ title: filenameToTitle(folder.name), folderUrl: folder.url, poster: subPoster?.url, items: seriesItems, seasons: seriesSeasons });
        }
      }

      const allItems = seriesGroups.flatMap(g => g.items);
      return {
        source: 'http', type: 'multi-series',
        title: filenameToTitle(baseUrl.split('/').filter(Boolean).pop() || 'Importación'),
        items: allItems, seriesGroups,
        poster: seriesGroups[0]?.poster, totalFiles: allItems.length, hasFolders: true, folderCount: folders.length,
      };
    }
  }

  throw new Error("No se encontraron archivos de video en la URL proporcionada.");
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.post("/smart-import/analyze", requireAdminAuth, async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') { res.status(400).json({ error: "URL requerida" }); return; }

  try {
    // MEGA — not supported (client-side encryption)
    if (isMegaUrl(url)) {
      res.status(422).json({ error: 'MEGA no es compatible con importación automática.\n\nLos archivos de MEGA están cifrados y solo pueden accederse desde su aplicación. Usa el modo Manual pegando URLs directas de otro servicio (HTTP, Dropbox archivo directo, etc.).' });
      return;
    }

    // Google Drive — not supported without OAuth
    if (isGoogleDriveUrl(url)) {
      res.status(422).json({ error: 'Google Drive no es compatible con importación automática.\n\nDrive requiere autenticación OAuth para listar archivos. Usa el modo Manual con URLs directas, o sube los archivos a Terabox/servidor HTTP.' });
      return;
    }

    // Dropbox — only individual video files work (convert to direct link)
    if (isDropboxUrl(url)) {
      const cleanUrl = url.split('?')[0];
      if (isDirectVideoUrl(cleanUrl)) {
        const directUrl = convertDropboxToDirectUrl(url);
        const filename = cleanUrl.split('/').pop() || 'video';
        const title = filenameToTitle(filename);
        const result: SmartAnalyzeResult = {
          source: 'http',
          type: 'movie',
          title,
          items: [{ name: title, url: directUrl }],
          totalFiles: 1,
          hasFolders: false,
          folderCount: 0,
        };
        res.json(result);
        return;
      }
      res.status(422).json({ error: 'Las carpetas de Dropbox requieren API para listar archivos.\n\nSolo funcionan enlaces directos a archivos de video individuales de Dropbox (ej: https://www.dropbox.com/s/XXX/pelicula.mp4). Para múltiples archivos, usa Terabox o un servidor HTTP.' });
      return;
    }

    // Direct video URL (mp4, mkv, avi, etc.)
    if (isDirectVideoUrl(url.split('?')[0])) {
      const filename = url.split('/').pop()?.split('?')[0] || 'video';
      const title = filenameToTitle(filename);
      const result: SmartAnalyzeResult = {
        source: 'http',
        type: 'movie',
        title,
        items: [{ name: title, url }],
        totalFiles: 1,
        hasFolders: false,
        folderCount: 0,
      };
      res.json(result);
      return;
    }

    // Terabox shared folder
    if (isTeraboxUrl(url)) {
      const result = await analyzeTerabox(url);
      res.json(result);
      return;
    }

    // HTTP directory listing (fallback)
    const result = await analyzeHttp(url);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Error al analizar el enlace" });
  }
});

router.post("/smart-import/import", requireAdminAuth, async (req: Request, res: Response) => {
  const { type, title, category, poster, items, seasons, seasonTitles, seriesGroups } = req.body;
  if (!type || !title) { res.status(400).json({ error: "Datos de importación inválidos" }); return; }

  const resolvedSeasonTitles: Record<number, string> = seasonTitles || {};

  try {
    if (type === 'movie') {
      const toCreate: Array<{ name: string; url: string; poster?: string }> = items || [];
      if (!toCreate.length) { res.status(400).json({ error: "Sin elementos para importar" }); return; }

      const created: Array<{ id: number; title: string }> = [];

      for (const item of toCreate) {
        const [movie] = await db.insert(moviesTable).values({
          title: item.name || title,
          filePath: item.url,
          videoFormat: detectUrlFormat(item.url),
          poster: item.poster || poster || null,
          category: category || null,
        }).returning();
        created.push({ id: movie.id, title: movie.title });
      }
      cache.invalidatePrefix("movies:");
      res.json({ success: true, type: 'movie', created, count: created.length });

    } else if (type === 'series') {
      const itemsToImport: Array<{ name: string; url: string; poster?: string; season?: number; episode?: number; folderName?: string }> = items || [];
      if (!itemsToImport.length) { res.status(400).json({ error: "Sin elementos para importar" }); return; }

      const [newSeries] = await db.insert(seriesTable).values({
        title, poster: poster || null, category: category || null, featured: false, hidden: false,
      }).returning();

      const seasonMap: Record<number, number> = {};
      let epCounter = 1;

      for (const item of itemsToImport) {
        const sNum = item.season || 1;
        if (!seasonMap[sNum]) {
          // Use folder name as season title if available, otherwise "Temporada N"
          const seasonTitle = resolvedSeasonTitles[sNum] || item.folderName || `Temporada ${sNum}`;
          const [newSeason] = await db.insert(seasonsTable).values({
            seriesId: newSeries.id, seasonNumber: sNum, title: seasonTitle,
          }).returning();
          seasonMap[sNum] = newSeason.id;
        }
        const epNum = item.episode || epCounter++;
        await db.insert(episodesTable).values({
          seriesId: newSeries.id, seasonId: seasonMap[sNum],
          title: item.name || `Episodio ${epNum}`,
          filePath: item.url, videoFormat: detectUrlFormat(item.url), episodeNumber: epNum, order: epNum, thumbnail: item.poster || null,
        });
      }
      cache.invalidatePrefix("series:");
      res.json({ success: true, type: 'series', seriesId: newSeries.id, title: newSeries.title, seasons: Object.keys(seasonMap).length, episodes: itemsToImport.length });

    } else if (type === 'multi-series') {
      const groups: Array<{ title: string; poster?: string; seasons?: Record<string, Array<{ name: string; url: string; poster?: string; season?: number; episode?: number; folderName?: string }>>; items: Array<{ name: string; url: string; poster?: string; season?: number; episode?: number; folderName?: string }> }> = seriesGroups || [];
      if (!groups.length) { res.status(400).json({ error: "Sin series para importar" }); return; }

      const created: Array<{ id: number; title: string; episodes: number }> = [];

      for (const group of groups) {
        const [newSeries] = await db.insert(seriesTable).values({
          title: group.title, poster: group.poster || null, category: category || null, featured: false, hidden: false,
        }).returning();

        const seasonMap: Record<number, number> = {};
        let epCounter = 1;

        for (const item of group.items) {
          const sNum = item.season || 1;
          if (!seasonMap[sNum]) {
            const seasonTitle = item.folderName || `Temporada ${sNum}`;
            const [newSeason] = await db.insert(seasonsTable).values({
              seriesId: newSeries.id, seasonNumber: sNum, title: seasonTitle,
            }).returning();
            seasonMap[sNum] = newSeason.id;
          }
          const epNum = item.episode || epCounter++;
          await db.insert(episodesTable).values({
            seriesId: newSeries.id, seasonId: seasonMap[sNum],
            title: item.name || `Episodio ${epNum}`,
            filePath: item.url, videoFormat: detectUrlFormat(item.url), episodeNumber: epNum, order: epNum, thumbnail: item.poster || null,
          });
        }
        created.push({ id: newSeries.id, title: newSeries.title, episodes: group.items.length });
      }
      cache.invalidatePrefix("series:");
      res.json({ success: true, type: 'multi-series', created, count: created.length });

    } else {
      res.status(400).json({ error: "Tipo de importación no válido" });
    }
  } catch (err: any) {
    console.error('[smart-import] DB error:', err?.message, err?.cause?.message ?? '');
    res.status(500).json({ error: err?.message || "Error al importar" });
  }
});

// ─── Terabox play proxy ───────────────────────────────────────────────────────
// Streams Terabox video content through our server so the browser doesn't need
// Terabox cookies. Supports HTTP Range requests for seeking. dlinks are cached
// for 40 minutes to avoid redundant listing fetches.

/**
 * Given a file's path and fsId (from the listing), try multiple Terabox API
 * approaches to get a fresh dlink for playback.
 *
 * Key insight: The `shorturlinfo` API returns a `token` field that should be
 * passed as `t=TOKEN` for share-scoped sub-API calls (NOT the bdstoken from
 * page cookies which requires a logged-in account).
 */
async function getDlinkViaFileInfo(
  shortcode: string,
  listing: TeraListing,
  filePath: string,
  fsId?: string,
): Promise<string | null> {
  const { base, creds, uk, shareid, sign, timestamp, token: shareToken } = listing;
  const surl = extractSurl(shortcode);
  const target = encodeURIComponent(filePath);
  const baseParams = `app_id=250528&web=1&clienttype=0&channel=chunlei`;
  const authParams = `uk=${uk}&shareid=${shareid}&sign=${sign}&timestamp=${timestamp}`;
  const tokenParam = shareToken ? `&t=${shareToken}` : '';

  const headers: Record<string, string> = {
    'User-Agent': TERA_UA,
    'Accept': 'application/json',
    'Referer': `${base}/sharing/init?surl=${surl}`,
  };
  if (creds.cookieStr) headers['Cookie'] = creds.cookieStr;

  const attempts: string[] = [];

  // 1. filemetas with fsids + share token (t= param) — the correct auth method for public shares
  if (fsId) {
    attempts.push(
      `${base}/api/filemetas?dlink=1&fsids=[${fsId}]&${authParams}&${baseParams}${tokenParam}&jsToken=${creds.jsToken}`,
      `${base}/api/filemetas?dlink=1&fsids=%5B${fsId}%5D&${authParams}&${baseParams}${tokenParam}&jsToken=${creds.jsToken}`,
    );
  }

  // 2. filemetas with target path (alt approach)
  attempts.push(
    `${base}/api/filemetas?dlink=1&target=${target}&origin=share&shorturl=${surl}&root=0&${baseParams}&${authParams}${tokenParam}&jsToken=${creds.jsToken}`,
    `${base}/api/filemetas?dlink=1&target=${target}&shorturl=${surl}&${baseParams}&${authParams}${tokenParam}`,
  );

  // 3. sharedownload GET approach
  if (fsId) {
    attempts.push(
      `${base}/api/sharedownload?type=nolimitshare&primaryid=[${fsId}]&${authParams}&${baseParams}${tokenParam}&jsToken=${creds.jsToken}`,
    );
  }

  for (const url of attempts) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!r.ok) { console.log(`[terabox] dlink attempt HTTP ${r.status}: ${url.split('?')[0]}`); continue; }
      const data: any = await r.json();
      console.log(`[terabox] dlink attempt errno=${data.errno}: ${url.split('?')[0]}`);
      const dlink = data?.info?.[0]?.dlink || data?.list?.[0]?.dlink || data?.dlink;
      if (dlink) return dlink;
    } catch (e: any) { console.log(`[terabox] dlink attempt error: ${e.message}`); }
  }

  // 4. POST sharedownload (web UI method)
  if (fsId) {
    try {
      const body = new URLSearchParams({
        type: 'nolimitshare',
        primaryid: `[${fsId}]`,
        uk: String(uk),
        shareid: String(shareid),
        sign,
        timestamp: String(timestamp),
        app_id: '250528',
        web: '1',
        clienttype: '0',
        channel: 'chunlei',
        ...(shareToken && { t: shareToken }),
        ...(creds.jsToken && { jsToken: creds.jsToken }),
      });
      const r = await fetch(`${base}/api/sharedownload`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const data: any = await r.json();
        console.log(`[terabox] POST sharedownload errno=${data.errno}`);
        const dlink = data?.info?.[0]?.dlink || data?.list?.[0]?.dlink || data?.dlink;
        if (dlink) return dlink;
      }
    } catch (e: any) { console.log(`[terabox] POST sharedownload error: ${e.message}`); }
  }

  return null;
}

/**
 * Recursively search for a file by fsId within a directory tree.
 * When found, uses the file's `path` to get the dlink via filemetas API.
 */
async function findFileByFsId(
  shortcode: string,
  listing: TeraListing,
  fsId: string,
  dirPath: string,
  depth: number,
  maxDepth: number,
): Promise<string | null> {
  const files = await fetchTeraboxSubfolder(shortcode, listing, dirPath);
  for (const f of files) {
    if (Number(f.isdir) === 0 && String(f.fs_id) === fsId) {
      // Found the file — use its path + fsId to get a fresh dlink
      const dlink = await getDlinkViaFileInfo(shortcode, listing, f.path || '', String(f.fs_id));
      if (dlink) return dlink;
      // fallback: dlink may already be set (unlikely but check anyway)
      return f.dlink || null;
    }
  }
  if (depth >= maxDepth) return null;
  const subFolders = files.filter(f => Number(f.isdir) === 1);
  for (const folder of subFolders) {
    const subPath = folder.path || `${dirPath}/${folder.server_filename}`;
    const dlink = await findFileByFsId(shortcode, listing, fsId, subPath, depth + 1, maxDepth);
    if (dlink) return dlink;
  }
  return null;
}

/**
 * Get a fresh dlink for a Terabox file.
 * Strategy (fastest-first):
 *  1. In-memory cache (40-min TTL)
 *  2. Scan the exact dir if provided
 *  3. Root listing (file might be at root level)
 *  4. Full recursive scan of every root folder (up to 5 levels deep)
 */
async function getTeraboxDlink(shortcode: string, fsId: string, dir?: string): Promise<string | null> {
  const cacheKey = `${shortcode}:${fsId}`;
  const cached = dlinkCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.url;

  const listing = await fetchTeraboxListing(shortcode);
  if (!listing) return null;

  const cache = (dlink: string) => {
    dlinkCache.set(cacheKey, { url: dlink, expires: Date.now() + 40 * 60 * 1000 });
    return dlink;
  };

  // 1. Scan the exact known directory first (fastest when dir is stored in URL)
  if (dir && dir !== '/') {
    const subFiles = await fetchTeraboxSubfolder(shortcode, listing, dir);
    const match = subFiles.find(f => String(f.fs_id) === fsId && Number(f.isdir) === 0);
    if (match?.dlink) return cache(match.dlink);
  }

  // 2. Root listing (file might live at root)
  const rootMatch = listing.list.find(f => String(f.fs_id) === fsId && Number(f.isdir) === 0);
  if (rootMatch?.dlink) return cache(rootMatch.dlink);

  // 3. Full recursive scan — walk every root folder up to 5 levels deep
  const rootFolders = listing.list.filter(f => Number(f.isdir) === 1);
  for (const folder of rootFolders) {
    const folderPath = folder.path || `/${folder.server_filename}`;
    const dlink = await findFileByFsId(shortcode, listing, fsId, folderPath, 0, 5);
    if (dlink) return cache(dlink);
  }

  console.warn(`[terabox] could not find fsId=${fsId} in shortcode=${shortcode}`);
  return null;
}

router.get("/terabox/play", async (req: Request, res: Response) => {
  const shortcode = req.query.shortcode as string;
  const fsId = req.query.fsId as string;
  const dir = req.query.dir as string | undefined;

  if (!shortcode || !fsId) {
    res.status(400).json({ error: "shortcode y fsId son requeridos" });
    return;
  }

  const dlink = await getTeraboxDlink(shortcode, fsId, dir);
  if (!dlink) {
    res.status(502).json({ error: "No se pudo obtener el enlace de reproducción" });
    return;
  }

  // Stream the video through our server with HTTP Range support for seeking
  const rangeHeader = req.headers.range;
  const videoHeaders: Record<string, string> = {
    'User-Agent': TERA_UA,
    'Referer': `https://1024terabox.com/`,
    'Accept': '*/*',
  };
  if (rangeHeader) videoHeaders['Range'] = rangeHeader;

  try {
    const videoRes = await fetch(dlink, {
      headers: videoHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });

    if (!videoRes.ok && videoRes.status !== 206) {
      // dlink may have expired — clear cache and try once more
      const cacheKey = `${shortcode}:${fsId}`;
      dlinkCache.delete(cacheKey);
      const freshDlink = await getTeraboxDlink(shortcode, fsId, dir);
      if (!freshDlink || freshDlink === dlink) {
        res.status(502).json({ error: `Error al acceder al video (${videoRes.status})` });
        return;
      }
      const retryRes = await fetch(freshDlink, { headers: videoHeaders, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (!retryRes.ok && retryRes.status !== 206) {
        res.status(502).json({ error: `Error al acceder al video tras reintento (${retryRes.status})` });
        return;
      }
      return pipeTeraboxResponse(retryRes, req, res, !!rangeHeader);
    }

    return pipeTeraboxResponse(videoRes, req, res, !!rangeHeader);

  } catch (err: any) {
    if (!res.headersSent) {
      res.status(502).json({ error: err?.message || 'Error al transmitir el video' });
    }
  }
});

async function pipeTeraboxResponse(videoRes: Response, req: Request, res: import('express').Response, isRange: boolean): Promise<void> {
  const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
  for (const h of forwardHeaders) {
    const val = videoRes.headers.get(h);
    if (val) res.setHeader(h, val);
  }
  if (!videoRes.headers.get('accept-ranges')) res.setHeader('accept-ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.status(isRange ? 206 : videoRes.status);

  if (!videoRes.body) { res.end(); return; }

  const { Readable } = await import('stream');
  const nodeStream = Readable.fromWeb(videoRes.body as any);
  nodeStream.pipe(res);
  nodeStream.on('error', () => { if (!res.headersSent) res.end(); });
  req.on('close', () => nodeStream.destroy());
}

export default router;
