# Super TV live pilot

This service adds a shared, on-demand 360p/480p HLS ladder for **CARACOL (channel 450)**.
It does not replace the application's API or its database. All playlists and segments
validate the existing user's session through the local API. Tokens never enter the
shared media files, and each response receives the requesting viewer's token.

The frontend targets **10 seconds behind the available HLS edge**, with a 20-second
forward buffer. This is approximate: source segment duration, missing source footage,
native player behavior, and network conditions affect the actual delay. It cannot
reconstruct video that the origin never delivered.

## Capacity

The CX23 pilot permits one encoder job shared by all viewers of this channel. It
produces 640x360 at 500 kbps and 854x480 at 800 kbps, with 64 kbps AAC audio. FFmpeg
runs at lower priority with limited encoder/filter threads. Idle jobs stop after two
minutes. Warmup failure, sustained processing below realtime, or source stalls cause
fallback to the existing original stream. The encoder dies if its Node parent dies.

Other channels use their existing original stream; native multi-quality HLS sources
retain their available renditions. Do not expand `LIVE_CHANNEL_IDS` or
`LIVE_MAX_CHANNELS` without measuring CPU, memory, encoding speed, and disk usage.
No server resize or billing-plan change is performed by this installer.

## Install

Copy the four runtime files (`server.mjs`, `ffmpeg-child.py`, `ecosystem.config.cjs`,
`install.sh`) from the same reviewed Git commit into a root-only release directory.
Run `bash install.sh` as root. Requirements: Node 18+, Python 3, FFmpeg with libx264,
PM2, and the existing `/etc/nginx/copiamelafinal-api-tls.conf` HTTPS proxy.

The installer creates a timestamped backup under `/root/supertv-live-backup-*`, starts
`supertv-live` on loopback port 8790, and adds only the `/api/live/` proxy location.
Existing channels and the database are not modified. PM2 saves the service for reboot.

For rollback, stop `supertv-live`, restore the saved `nginx.conf` to the original
configuration path, run `nginx -t -c /etc/nginx/copiamelafinal-api-tls.conf`, then reload
that Nginx instance with `nginx -s reload -c /etc/nginx/copiamelafinal-api-tls.conf`.
Use the matching previous frontend release, or let its HLS fallback use the original
stream. Root cache files live exclusively under `/var/cache/supertv-live`.

## Verify

Run `node --test scripts/vps/live/server.test.mjs` where FFmpeg is installed. It uses
a real generated HLS input and verifies both encoded resolutions, shared jobs,
private token rewriting, unauthorized access, fallback, and idle shutdown. On the VPS,
verify authenticated manifests and segments, then watch the FFmpeg process's CPU/RSS
and `speed` under normal source load before expanding the pilot.
