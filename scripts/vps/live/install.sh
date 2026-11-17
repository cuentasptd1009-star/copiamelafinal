#!/usr/bin/env bash
set -euo pipefail
LIVE_SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
for live_bin in node python3 ffmpeg ffprobe pm2 nginx curl; do command -v "$live_bin" >/dev/null; done
node --check "$LIVE_SOURCE_DIR/server.mjs"
LIVE_CONFIG=/etc/nginx/copiamelafinal-api-tls.conf
LIVE_BACKUP="/root/supertv-live-backup-$(date -u +%Y%m%d%H%M%S)"
mkdir -m 700 "$LIVE_BACKUP"
cp -p "$LIVE_CONFIG" "$LIVE_BACKUP/nginx.conf"
install -d -m 700 /opt/supertv-live /var/cache/supertv-live
for live_file in server.mjs ffmpeg-child.py ecosystem.config.cjs; do
  if [ -f "/opt/supertv-live/$live_file" ]; then cp -p "/opt/supertv-live/$live_file" "$LIVE_BACKUP/"; fi
  install -m 600 "$LIVE_SOURCE_DIR/$live_file" "/opt/supertv-live/$live_file"
done
pm2 startOrReload /opt/supertv-live/ecosystem.config.cjs --only supertv-live --update-env
LIVE_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --retry 3 --retry-connrefused http://127.0.0.1:8790/api/live/channels/450/status)
[ "$LIVE_STATUS" = 401 ]
python3 - "$LIVE_CONFIG" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);text=p.read_text()
if 'location ^~ /api/live/' not in text:
    needle='location / {'
    if needle not in text:raise SystemExit('Cannot locate the API proxy block')
    block='''location ^~ /api/live/ {
proxy_pass http://127.0.0.1:8790;
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_read_timeout 60s;
proxy_buffering off;
access_log off;
}
'''
    p.write_text(text.replace(needle,block+needle,1))
PY
if ! nginx -t -c "$LIVE_CONFIG"; then
  cp -p "$LIVE_BACKUP/nginx.conf" "$LIVE_CONFIG"
  pm2 stop supertv-live
  exit 1
fi
nginx -s reload -c "$LIVE_CONFIG"
pm2 save
printf 'Live service installed. Pilot: CARACOL (450). Backup: %s\n' "$LIVE_BACKUP"
