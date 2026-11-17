# Super TV live pilot

This service adds a shared, on-demand adaptive HLS ladder up to the original resolution for channels selected by the administrator (up to five selections). All channels start disabled.
It does not replace the application's API or its database. All playlists and segments
validate the existing user's session through the local API. Tokens never enter the
shared media files, and each response receives the requesting viewer's token.

For enabled channels, a **ten-second combined reserve** is split between four seconds of paced server playout and six seconds behind that playlist edge in the player, with a 20-second forward buffer. The master and media playlists request the six-second client offset, so independent HLS players receive the same hint. Cached segments are exposed on the playout clock rather than in source-sized bursts. This is approximate: source segment duration, missing source footage,
native player behavior, and network conditions affect the actual delay. It cannot
reconstruct video that the origin never delivered.

The raw encoder playlist retains thirty segments so prefetched media cannot expire
the visible history while waiting on the paced playout clock. This history does not
increase the requested playback offset. Masters include an average bandwidth estimate
as well as peak headroom for each rendition. The original retains the probe's nominal
bitrate floor so low-motion warmup footage cannot understate later requirements.
Super TV's Hls.js player can recheck a higher rendition's transfer speed when Auto
has at least five seconds buffered. Samples stop after approximately 512 KiB or
three seconds, run at most once per thirty seconds, and never select a manual level.
The standard ABR algorithm still chooses the rendition and reduces quality when needed.
Independent/native players apply their own ABR rules; the M3U8 cannot install this
recovery behavior into another website's player.

## Capacity

The CX23 initially permits one encoder job shared by all viewers of the same channel. The admin displays this simultaneous-processing limit separately from the five saved selections. It produces 360p, 480p, and (for sources above 720p) 720p. The highest variant copies the original video without re-encoding; AAC audio is normalized to a continuous 48 kHz timeline in every variant, including the original-video variant. Input timestamp discontinuities are normalized rather than copied blindly. Lower variants follow the source keyframes on the same normalized timeline, so one master playlist can adapt up and down including the original. Sources at 720p use Original 720p + 480p + 360p. Sources above 1080p/30fps or with unsupported codecs fall back to the original proxy. FFmpeg
runs at lower priority, with two decode/filter threads and one thread per rendition encoder. Fast bilinear scaling reduces work on the shared two-vCPU VPS. For unencrypted MPEG-TS HLS, a bounded reader polls source playlists independently, prefetches at most two segments, and feeds FFmpeg in sequence through a pipe. It starts at the newest complete source segment. Encrypted/fMP4 or other unsupported input forms retain direct FFmpeg ingest. The decoder also has a bounded 512-packet queue. A cold start waits for new source media to build the playable reserve. A ladder is not published during warmup unless the actual published media edge advances at real-time speed over a measured interval. FFmpeg's average speed is retained only as a diagnostic because source timestamp offsets can distort it. Idle jobs stop after two
minutes. Warmup failure, an encoder exit, or source stalls cause
fallback to the existing original stream. The encoder dies if its Node parent dies.

Other channels use their existing original stream; native multi-quality HLS sources
retain their available renditions. On conversion retirement, old media segments remain available for sixty seconds and old variant playlists fall back to the original, rather than becoming permanent 404 responses. This fallback does not guarantee a seamless timeline transition in an already-open external player: reopen the channel after changing its conversion setting. Inactive cache generations are pruned. Selections are persisted in `/opt/supertv-live/channels.json` through admin-only API routes. The installer preserves this file. Do not expand `LIVE_MAX_CHANNELS` without measuring CPU, memory, encoding speed, and disk usage.
No server resize or billing-plan change is performed by this installer.

## Install

Copy the runtime files (`server.mjs`, `sharing.mjs`, `ingest.mjs`, `playout.mjs`, `ffmpeg-child.py`, `ecosystem.config.cjs`,
`install.sh`) from the same reviewed Git commit into a root-only release directory.
Run `bash install.sh` as root. Requirements: Node 18+, Python 3, FFmpeg with libx264,
PM2, and the existing `/etc/nginx/copiamelafinal-api-tls.conf` HTTPS proxy.

The installer creates a timestamped backup under `/root/supertv-live-backup-*`, starts
`supertv-live` on loopback port 8790, and adds only the `/api/live/` proxy location.
The channel sources and database are not modified. PM2 saves the service for reboot.

For rollback, stop `supertv-live`, restore the saved `nginx.conf` to the original
configuration path, run `nginx -t -c /etc/nginx/copiamelafinal-api-tls.conf`, then reload
that Nginx instance with `nginx -s reload -c /etc/nginx/copiamelafinal-api-tls.conf`.
Use the matching previous frontend release, or let its HLS fallback use the original
stream. Root cache files live exclusively under `/var/cache/supertv-live`.

## Verify

Run `node --test scripts/vps/live/*.test.mjs` where FFmpeg is installed. It uses
a real generated HLS input and verifies both encoded resolutions, shared jobs,
private token rewriting, unauthorized access, fallback, and idle shutdown. On the VPS,
verify authenticated manifests and segments, then watch the FFmpeg process's CPU/RSS
and `speed` under normal source load before expanding the pilot.

## External players

An administrator can copy, renew, or revoke a channel-specific external link. It has
no automatic expiry and is independent of Super TV user/admin sessions. Anyone with
the link can play that channel, so the other website controls access for its own users.
Renewing or revoking invalidates the old key immediately on subsequent requests.
The channel toggle also controls what this stable link serves on a fresh playback:
adaptive processed HLS when enabled and capacity is available, original HLS otherwise.
Keys and the relay encryption secret are stored only in the root-readable runtime
configuration. External metadata lookups use a bounded read-only-query PG pool through
the API's existing local database configuration; no database credentials reach clients.
Origin relay URLs are authenticated and encrypted, and shared origin fetches are
bounded to 64 MiB of cache and four concurrent downloads.

The tests check 50 simultaneous reads of the same channel/segment, one shared encoder,
per-channel key scope, segment authentication, key renewal/revocation, and persistence.
This is not a promise of 50 uninterrupted full-time viewers at every source bitrate:
network throughput, origin availability, and included egress traffic still apply.

For a bounded isolated sustained check, run `node scripts/vps/live/diagnose.mjs CHANNEL_ID 240` on the VPS from a private release directory. It does not change channel selections, publishes no endpoint, and removes its temporary media after the check. Do not run it alongside an active production conversion on this small VPS. Check actual client playback and buffer health over several minutes as well as encoder speed.
