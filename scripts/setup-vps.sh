#!/usr/bin/env bash
#
# bertclips one-shot VPS setup (Ubuntu/Debian).
#
# Run this on a fresh DigitalOcean droplet as root (the droplet Console logs in as
# root by default):
#
#   curl -fsSL https://raw.githubusercontent.com/willywonka773202-cloud/bertclips/main/scripts/setup-vps.sh | bash
#
# It is idempotent — safe to re-run. It installs the free engine (ffmpeg + yt-dlp +
# faster-whisper), Node, clones + builds bertclips, installs a systemd service, starts
# it, and kicks the 24/7 heartbeat.
#
set -euo pipefail

REPO_URL="https://github.com/willywonka773202-cloud/bertclips"
APP_DIR="/opt/bertclips"
APP_USER="bertclips"
PORT="3210"

log() { printf "\n\033[1;36m==>\033[0m %s\n" "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (on the DigitalOcean droplet Console you already are)." >&2
  exit 1
fi

log "Installing system packages (ffmpeg, python, git)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git ffmpeg python3 python3-venv python3-pip

log "Installing Node.js 20 (NodeSource)…"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

log "Creating the ${APP_USER} service user…"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd -r -m -d "$APP_DIR" -s /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "Cloning / updating the repo…"
if [ -d "$APP_DIR/.git" ]; then
  runuser -u "$APP_USER" -- git -C "$APP_DIR" fetch --depth 1 origin main
  runuser -u "$APP_USER" -- git -C "$APP_DIR" reset --hard origin/main
else
  # /opt/bertclips is the user's home and already exists, so clone into a temp dir then move.
  runuser -u "$APP_USER" -- git clone --depth 1 "$REPO_URL" "$APP_DIR/src"
  shopt -s dotglob
  mv "$APP_DIR/src/"* "$APP_DIR/"
  rmdir "$APP_DIR/src"
  shopt -u dotglob
fi

log "Building the Python engine venv (yt-dlp + faster-whisper)…"
runuser -u "$APP_USER" -- python3 -m venv "$APP_DIR/venv"
runuser -u "$APP_USER" -- "$APP_DIR/venv/bin/pip" install --upgrade pip
runuser -u "$APP_USER" -- "$APP_DIR/venv/bin/pip" install yt-dlp faster-whisper

log "Writing .env…"
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<ENV
BERTOS_DEPLOYMENT_MODE=local
BERTOS_RUNTIME_DIR=${APP_DIR}/.bertos-runtime
BERTAI_CLIPPING_DIR=${APP_DIR}/ops
CLIPPING_PYTHON_BIN=${APP_DIR}/venv/bin/python
# Set a token here (and send x-bertclips-token on POSTs) if you expose this past your firewall.
BERTCLIPS_GATE_TOKEN=
ENV
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
fi

log "Installing npm dependencies + building…"
runuser -u "$APP_USER" -- bash -lc "cd '$APP_DIR' && npm install --no-audit --no-fund && npm run build"

log "Installing the systemd service…"
cat > /etc/systemd/system/bertclips.service <<UNIT
[Unit]
Description=bertclips service
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start
ExecStartPost=/bin/sh -c 'sleep 6; curl -sf http://127.0.0.1:${PORT}/api/health || true'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable bertclips
systemctl restart bertclips

log "Waiting for the service to come up…"
sleep 8
if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  echo
  echo "  bertclips is running on port ${PORT}."
  curl -s "http://127.0.0.1:${PORT}/api/health"; echo
  echo
  echo "  Cockpit:  http://$(curl -s ifconfig.me 2>/dev/null || echo YOUR_DROPLET_IP):${PORT}"
  echo "  Logs:     journalctl -u bertclips -f"
  echo "  Data:     ${APP_DIR}/.bertos-runtime  (back this up)"
else
  echo "Service did not answer /api/health yet. Check: journalctl -u bertclips -e" >&2
  exit 1
fi
