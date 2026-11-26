import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import type { IptvImportedChannel } from "@workspace/db";

const maxPlaylistBytes = 4 * 1024 * 1024;
const maxChannels = 10000;

function webUrl(value: string, base?: string) {
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 4096) {
    throw new Error("URL IPTV inválida.");
  }
  return url;
}

function publicIpv4(address: string) {
  const [a, b, c] = address.split(".").map(Number);
  return a > 0 && a < 224 && ![10, 127].includes(a)
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && [0, 168].includes(b))
    && !(a === 198 && [18, 19, 51].includes(b))
    && !(a === 203 && b === 0 && c === 113);
}

async function open(url: URL, signal: AbortSignal, range?: string, redirects = 0): Promise<{ response: IncomingMessage; url: URL }> {
  const address = await lookup(url.hostname, { family: 4 });
  if (!publicIpv4(address.address)) throw new Error("El servidor IPTV debe ser público.");
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const client = request(url, {
      signal, family: 4, agent: false,
      lookup: (_hostname, _options, callback) => callback(null, address.address, 4),
      headers: range ? { Range: range } : {},
    }, resolve);
    client.once("error", reject);
    client.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
    response.destroy();
    if (redirects >= 4 || !response.headers.location) throw new Error("Redirección IPTV inválida.");
    return open(webUrl(response.headers.location, url.href), signal, range, redirects + 1);
  }
  if (![200, 206].includes(response.statusCode || 0)) {
    response.destroy();
    throw new Error("El servidor IPTV rechazó la solicitud.");
  }
  return { response, url };
}

async function playlistText(response: IncomingMessage, prefix = Buffer.alloc(0), reader = response.iterator()) {
  const blocks = [prefix];
  let size = prefix.length;
  for await (const chunk of reader) {
    size += chunk.length;
    if (size > maxPlaylistBytes) { response.destroy(); throw new Error("La lista IPTV supera 4 MB."); }
    blocks.push(chunk);
  }
  return Buffer.concat(blocks).toString("utf8");
}

function parsePlaylist(text: string, base?: string): IptvImportedChannel[] {
  if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("La lista debe ser un archivo M3U válido.");
  const channels: IptvImportedChannel[] = [];
  let info: Omit<IptvImportedChannel, "url"> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      const attrs = Object.fromEntries([...line.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
      const separator = line.match(/^(?:[^",]|"[^"]*")*,/)?.[0].length;
      const name = separator ? line.slice(separator).trim() : "";
      info = { name: (name || attrs["tvg-name"] || "Canal").slice(0, 200), category: (attrs["group-title"] || "En vivo").slice(0, 150),
        logo: (attrs["tvg-logo"] || "").slice(0, 1000), epg: (attrs["tvg-id"] || "").slice(0, 150) };
    } else if (info && line && !line.startsWith("#")) {
      try {
        const url = webUrl(line, base);
        if (!/^\/(?:movie|series)\//i.test(url.pathname)) channels.push({ ...info, url: url.href });
      } catch { /* Ignore unsupported entries. */ }
      info = undefined;
      if (channels.length > maxChannels) throw new Error("La lista supera 10.000 canales.");
    }
  }
  if (!channels.length) throw new Error("La lista no contiene canales en vivo compatibles.");
  return channels;
}

async function downloadPlaylist(url: URL) {
  const result = await open(url, AbortSignal.timeout(20000));
  return parsePlaylist(await playlistText(result.response), result.url.href);
}

async function downloadLiveJson(base: URL, credentials: URLSearchParams, action: string) {
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/+$/, "") + "/player_api.php";
  url.search = new URLSearchParams({ ...Object.fromEntries(credentials), action }).toString();
  const { response } = await open(url, AbortSignal.timeout(20000));
  const data: unknown = JSON.parse(await playlistText(response));
  if (!Array.isArray(data)) throw new Error("El proveedor no devolvió un catálogo en vivo.");
  return data;
}

async function providerChannels(base: URL, username: string, password: string): Promise<IptvImportedChannel[]> {
  const credentials = new URLSearchParams({ username, password });
  const [streams, categories] = await Promise.all([
    downloadLiveJson(base, credentials, "get_live_streams"),
    downloadLiveJson(base, credentials, "get_live_categories").catch(() => []),
  ]);
  const names = new Map(categories.flatMap(entry =>
    entry && typeof entry.category_name === "string" ? [[String(entry.category_id), entry.category_name.slice(0, 150)]] : []));
  const channels: IptvImportedChannel[] = [];
  for (const entry of streams) {
    if (!entry || !/^\d{1,15}$/.test(String(entry.stream_id)) || typeof entry.name !== "string") continue;
    const stream = new URL(base);
    stream.pathname = stream.pathname.replace(/\/+$/, "") +
      `/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${entry.stream_id}.m3u8`;
    channels.push({
      name: entry.name.slice(0, 200), category: names.get(String(entry.category_id)) || "En vivo",
      logo: typeof entry.stream_icon === "string" ? entry.stream_icon.slice(0, 1000) : "",
      epg: typeof entry.epg_channel_id === "string" ? entry.epg_channel_id.slice(0, 150) : "",
      url: stream.href,
    });
    if (channels.length > maxChannels) throw new Error("La lista supera 10.000 canales.");
  }
  if (!channels.length) throw new Error("El proveedor no devolvió canales en vivo.");
  return channels;
}

export async function importChannels(body: Record<string, unknown>) {
  const { providerServer, providerUsername, providerPassword, m3uText, m3uUrl } = body;
  if (typeof providerServer !== "string" || typeof providerUsername !== "string" || typeof providerPassword !== "string" ||
    !providerUsername.trim() || !providerPassword || Boolean(m3uText) === Boolean(m3uUrl)) {
    throw new Error("Completa los datos del proveedor y elige un archivo M3U o un enlace.");
  }
  const provider = webUrl(providerServer);
  provider.hash = "";
  provider.search = "";
  const own = typeof m3uText === "string" && m3uText ? parsePlaylist(m3uText) :
    typeof m3uUrl === "string" && m3uUrl ? await downloadPlaylist(webUrl(m3uUrl)) : [];
  if (!own.length) throw new Error("Añade tu lista M3U.");
  let supplied;
  try {
    supplied = await providerChannels(provider, providerUsername, providerPassword);
  } catch {
    const download = new URL(provider);
    download.pathname = download.pathname.replace(/\/+$/, "") + "/get.php";
    download.search = new URLSearchParams({
      username: providerUsername, password: providerPassword, type: "m3u_plus", output: "m3u8",
    }).toString();
    supplied = await downloadPlaylist(download);
  }
  return [...own, ...supplied];
}

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptResource(url: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  return Buffer.concat([iv, cipher.update(url), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}

export function decryptResource(token: string, secret: string) {
  if (!/^[\w-]{40,6000}$/.test(token)) throw new Error("Recurso IPTV inválido.");
  const data = Buffer.from(token, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString();
}

export async function relayImported(res: Response, origin: string, childUrl: (url: string) => string, range?: string, image = false) {
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  const deadline = setTimeout(() => controller.abort(), 15000);
  const { response, url } = await open(webUrl(origin), controller.signal, range).finally(() => clearTimeout(deadline));
  response.setTimeout(15000, () => response.destroy());
  const type = response.headers["content-type"] || "";
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (image && !/^image\/(?:png|jpeg|webp|gif|avif)(?:;|$)/i.test(type)) {
    response.destroy();
    throw new Error("Logo no compatible.");
  }
  const reader = response.iterator();
  const first = await reader.next();
  const bytes = Buffer.from(first.value || []);
  const manifest = bytes.subarray(0, 32).toString().trimStart().startsWith("#EXTM3U") ||
    /mpegurl/i.test(response.headers["content-type"] || "") || /\.m3u8$/i.test(url.pathname);
  if (manifest && !image) {
    const rewrite = (value: string) => childUrl(webUrl(value, url.href).href);
    const text = (await playlistText(response, bytes, reader)).split(/\r?\n/).map(line => {
      if (!line.trim()) return line;
      if (!line.trimStart().startsWith("#")) return rewrite(line.trim());
      return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${rewrite(uri)}"`);
    }).join("\n");
    res.type("application/vnd.apple.mpegurl").send(text);
    return;
  }
  res.status(response.statusCode || 200);
  res.type(image || /^(?:video|audio)\//.test(type) ? type : "application/octet-stream");
  for (const header of ["content-length", "content-range", "accept-ranges"]) {
    if (response.headers[header]) res.setHeader(header, response.headers[header]!);
  }
  await pipeline((async function* () { if (bytes.length) yield bytes; yield* reader; })(), res);
}
