# Deploying bertclips 24/7

Two common ways to keep the service and its heartbeat running on a Linux VPS.

## Option A — systemd (recommended)

Create `/etc/systemd/system/bertclips.service`:

```ini
[Unit]
Description=bertclips service
After=network.target

[Service]
Type=simple
User=bertclips
WorkingDirectory=/opt/bertclips
Environment=NODE_ENV=production
EnvironmentFile=/opt/bertclips/.env
ExecStart=/usr/bin/npm run start
# Start the browser-independent heartbeat once the server is up.
ExecStartPost=/bin/sh -c 'sleep 5; curl -sf http://127.0.0.1:3210/api/health || true'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo useradd -r -m -d /opt/bertclips bertclips   # if the user doesn't exist
# copy the built app to /opt/bertclips, run `npm install --omit=dev` + `npm run build` there
sudo systemctl daemon-reload
sudo systemctl enable --now bertclips
sudo systemctl status bertclips
curl -s http://127.0.0.1:3210/api/health          # confirm heartbeat: { running: true }
```

The heartbeat also self-starts on the first cockpit load, so `ExecStartPost` is a belt-
and-suspenders nudge — if it's ever missed, the next page view starts it.

## Option B — pm2

```bash
npm install -g pm2
cd /opt/bertclips
pm2 start "npm run start" --name bertclips
pm2 save
pm2 startup            # follow the printed command to persist across reboots
# start the heartbeat
curl -s http://127.0.0.1:3210/api/health
```

## Reverse proxy + TLS (optional)

Front it with nginx/Caddy for HTTPS if you expose it beyond the VPS. If you do, set
`BERTCLIPS_GATE_TOKEN` in `.env` and send `x-bertclips-token` on mutations, or keep the
service bound to loopback / your Tailscale interface only.

## Backups

The `BERTOS_RUNTIME_DIR` (default `.bertos-runtime/`) holds all state — config,
campaigns, promos, clips, and the earnings ledger. Back it up on a schedule.
```
