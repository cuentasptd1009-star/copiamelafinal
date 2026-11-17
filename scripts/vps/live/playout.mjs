// Smooth upstream segment bursts without adding to the total ten-second reserve.
export const TOTAL_RESERVE_SECONDS = 10;
export const SERVER_RESERVE_SECONDS = 4;
export const CLIENT_RESERVE_SECONDS = TOTAL_RESERVE_SECONDS - SERVER_RESERVE_SECONDS;

export function playoutPlaylist(text, now = Date.now()) {
  const headers = []; const segments = []; let block = [], ended = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (/^#EXTM3U$|^#EXT-X-(?:VERSION|TARGETDURATION|MEDIA-SEQUENCE|INDEPENDENT-SEGMENTS|ALLOW-CACHE)(?::|$)/.test(line)) headers.push(line);
    else if (line === '#EXT-X-ENDLIST') ended = true;
    else {
      block.push(line);
      if (/^seg_\d+\.ts$/.test(line.trim())) {
        const duration = Number.parseFloat(block.find(l => l.startsWith('#EXTINF:'))?.slice(8));
        const start = Date.parse(block.find(l => l.startsWith('#EXT-X-PROGRAM-DATE-TIME:'))?.slice(25));
        segments.push({ lines: block, end: start + duration * 1000, duration }); block = [];
      }
    }
  }
  const cutoff = now - SERVER_RESERVE_SECONDS * 1000;
  const visible = [];
  for (const segment of segments) { if (!Number.isFinite(segment.end) || segment.end > cutoff) break; visible.push(segment); }
  return headers.concat(visible.flatMap(s => s.lines), ended && visible.length === segments.length ? ['#EXT-X-ENDLIST'] : []).join('\n') + '\n';
}
