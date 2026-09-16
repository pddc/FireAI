#!/usr/bin/env bash
# FireAI installer for Raspberry Pi OS (Bookworm / Trixie, 64-bit recommended).
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/fireai/main/deploy/install.sh | bash
#   # or from a checkout:  sudo bash deploy/install.sh [--upgrade] [--from-dir /path/to/release]
#
# Layout after install:
#   /opt/fireai/current -> /opt/fireai/releases/<version>   (code + prebuilt web/dist)
#   /opt/fireai/data                                          (settings.json, pelletdb.json, history/, recipes/, logs/, bridge creds)
#   /opt/fireai/venv                                          (Python virtualenv)
#   supervisor programs: fireai-control, fireai-server, fireai-bridge
#   nginx: serves the app on :80 and proxies /api, /ws, /health, /docs to the server on :8080
set -euo pipefail

FIREAI_ROOT=${FIREAI_ROOT:-/opt/fireai}
DATA_DIR=$FIREAI_ROOT/data
VENV=$FIREAI_ROOT/venv
# Set FIREAI_REPO to your GitHub repo (owner/name or full URL) when installing from releases.
REPO=${FIREAI_REPO:-https://github.com/CHANGE-ME/fireai}
FROM_DIR=""
UPGRADE=0
for arg in "$@"; do
  case $arg in
    --upgrade) UPGRADE=1 ;;
    --from-dir=*) FROM_DIR="${arg#*=}" ;;
    --from-dir) shift; FROM_DIR="$1" ;;
  esac
done

log() { echo -e "\e[1;33m[fireai]\e[0m $*"; }
need_root() { if [ "$(id -u)" -ne 0 ]; then exec sudo -E bash "$0" "$@"; fi; }
need_root "$@"

log "Installing system packages"
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-dev python3-pip git curl nginx redis-server supervisor \
  libglib2.0-dev libopenjp2-7 libatlas-base-dev bluetooth bluez libbluetooth-dev fonts-dejavu-core >/dev/null
if grep -q "Raspberry Pi 5" /proc/device-tree/model 2>/dev/null; then apt-get install -y -qq python3-rpi-lgpio >/dev/null || true; fi

# Redis: memory only, never touch the SD card.
sed -i 's/^save .*/save ""/; s/^appendonly yes/appendonly no/' /etc/redis/redis.conf
grep -q '^save ""' /etc/redis/redis.conf || echo 'save ""' >> /etc/redis/redis.conf
systemctl enable --now redis-server

mkdir -p "$FIREAI_ROOT/releases" "$DATA_DIR"/{logs,history,recipes,backups,bridge}

# ---- fetch release -------------------------------------------------------
if [ -n "$FROM_DIR" ]; then
  VERSION=$(python3 -c "import json;print(json.load(open('$FROM_DIR/updater/updater_manifest.json'))['metadata']['versions']['server'])")
  REL=$FIREAI_ROOT/releases/$VERSION
  rm -rf "$REL"; cp -r "$FROM_DIR" "$REL"
else
  log "Fetching latest release"
  API=$(curl -fsSL "https://api.github.com/repos/${REPO#https://github.com/}/releases/latest")
  VERSION=$(echo "$API" | python3 -c "import sys,json;print(json.load(sys.stdin)['tag_name'].lstrip('v'))")
  URL=$(echo "$API" | python3 -c "import sys,json;a=[x for x in json.load(sys.stdin)['assets'] if x['name'].endswith('.tar.gz')][0];print(a['browser_download_url'])")
  REL=$FIREAI_ROOT/releases/$VERSION
  rm -rf "$REL"; mkdir -p "$REL"
  curl -fsSL "$URL" -o /tmp/fireai.tar.gz
  curl -fsSL "$URL.sha256" -o /tmp/fireai.tar.gz.sha256 && (cd /tmp && sha256sum -c fireai.tar.gz.sha256)
  tar -xzf /tmp/fireai.tar.gz -C "$REL" --strip-components=1
fi
log "Release $VERSION at $REL"

# ---- python env ---------------------------------------------------------
if [ ! -x "$VENV/bin/python" ]; then python3 -m venv "$VENV"; fi
"$VENV/bin/pip" install -q --upgrade pip wheel
log "Installing Python dependencies (this takes a while on a Pi Zero)"
"$VENV/bin/pip" install -q -e "$REL[server,bridge,pi]"
# Hardware module dependencies from the wizard manifest (best effort: some only build on certain Pis)
"$VENV/bin/python" "$REL/scripts/module_deps.py" "$REL/wizard/wizard_manifest.json" > /tmp/fireai-module-deps.txt
while read -r dep; do
  [ -z "$dep" ] && continue
  "$VENV/bin/pip" install -q "$dep" || log "  ! optional dependency failed: $dep"
done < /tmp/fireai-module-deps.txt

# ---- data dir links ------------------------------------------------------
# The processes run with cwd=$DATA_DIR so settings.json / history / logs live outside the release.
for d in controller dashboard display distance grillplat notify probes updater wizard static file_mgmt common core server bridge; do
  ln -sfn "$REL/$d" "$DATA_DIR/$d"
done
ln -sfn "$REL/control.py" "$DATA_DIR/control.py"
ln -sfn "$REL" "$FIREAI_ROOT/current"
chown -R "${SUDO_USER:-pi}:${SUDO_USER:-pi}" "$DATA_DIR" "$FIREAI_ROOT/releases" || true

# ---- services ------------------------------------------------------------
sed "s#__ROOT__#$FIREAI_ROOT#g; s#__USER__#${SUDO_USER:-pi}#g" "$REL/deploy/supervisor/fireai.conf" > /etc/supervisor/conf.d/fireai.conf
sed "s#__ROOT__#$FIREAI_ROOT#g" "$REL/deploy/nginx/fireai.conf" > /etc/nginx/sites-available/fireai
ln -sfn /etc/nginx/sites-available/fireai /etc/nginx/sites-enabled/fireai
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx || systemctl restart nginx
supervisorctl reread >/dev/null && supervisorctl update >/dev/null
supervisorctl restart fireai-control fireai-server fireai-bridge >/dev/null || supervisorctl start fireai-control fireai-server fireai-bridge

# Enable SPI / I2C / 1-wire / hardware PWM per board-config if this is a fresh install
if [ "$UPGRADE" -eq 0 ] && [ -f "$REL/board-config.py" ]; then
  "$VENV/bin/python" "$REL/board-config.py" -pwm -ow -bl -s -i -gs >/dev/null 2>&1 || true
fi

IP=$(hostname -I | awk '{print $1}')
log "Done. Open http://$IP/ to set the admin password and finish setup."
[ "$UPGRADE" -eq 0 ] && log "A reboot is recommended on a fresh install to enable hardware interfaces."
