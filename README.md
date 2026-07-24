# bertclips

The BERT clipping operation as its own standalone, VPS-deployable service — extracted
from the `bert-ai` monorepo so it can run 24/7 on its own box.

It turns long-form source video (YouTube / Twitch VODs) into short vertical clips with a
**free local engine** (yt-dlp + whisper + ffmpeg), tracks paid clipping **campaigns**,
runs **game promos** (your own Roblox games — dev-progress clips now, launch ads later),
keeps a **cash-truth earnings ledger**, and bridges the live **BertClipsHub** posting
factory. One cockpit, served at `/`.

## What's in here

- **Free local engine** (`lib/clipping/engine.ts`, `scripts/clipping/*`): yt-dlp pulls
  the source, whisper transcribes, a ranker picks the moments, ffmpeg renders vertical
  clips with burned-in captions. No per-clip cost.
- **Cash-truth ledger** (`lib/clipping/store.ts`): only measured payouts you record hit
  the ledger — the money source of truth.
- **Campaigns**: paid per-1k-view bounties (Whop-style) you target.
- **Game promos** (`GamePromo`): your own Roblox games promoted through clips. A promo
  opens in the `progress` phase (dev-hype) and graduates to `launch` (release ads) with
  one click. Posts via the connected `builtbybert` upload-post profile on
  TikTok / Instagram / X.
- **Factory bridge** (`lib/clipping/factory-bridge.ts`): read-only view of the live
  BertClipsHub posting process over loopback. Offline-graceful.
- **24/7 heartbeat** (`lib/clipping/heartbeat.ts`): a browser-independent tick that
  drives the autonomous producer + factory observer. Started from `GET /api/health`.

### Deliberately different from bert-ai

The AI **research loop** (the free GLM "council" that only discovers/ranks sources — it
never renders or posts) is **stubbed** here (`lib/clipping/research.ts`), because it
tangled into bert-ai's whole provider / memory / council stack. The engine, ledger,
campaigns, game promos, and factory bridge are all fully active. To bring research to the
VPS later, port `lib/providers` + `lib/chat/council` + `lib/memory` from bert-ai and
restore the real implementation — the export surface already matches.

## Quick start on a VPS (one command)

On a fresh Ubuntu droplet, as root (the DigitalOcean droplet Console logs in as root):

```bash
curl -fsSL https://raw.githubusercontent.com/willywonka773202-cloud/bertclips/main/scripts/setup-vps.sh | bash
```

That installs the engine (ffmpeg + yt-dlp + faster-whisper) and Node, clones + builds
the app, installs a `bertclips` systemd service, starts it on port 3210, and kicks the
24/7 heartbeat. It is idempotent — re-run it to update. The manual steps below are the
same thing broken out if you'd rather do it by hand.

## Run it on a VPS (manual)

### 1. System dependencies (the free engine)

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg python3 python3-pip
python3 -m pip install --user yt-dlp faster-whisper
# Optional: face-aware crop (enhances output, not required)
python3 -m pip install --user opencv-python-headless
```

Verify the engine sees them from the cockpit's setup card, or check `ffmpeg -version`,
`yt-dlp --version`, `python3 -c "import faster_whisper"`.

### 2. Node + build

Node 20+ recommended.

```bash
npm install
cp .env.example .env      # edit as needed
npm run build
```

### 3. Configuration (`.env`)

| Var | Meaning |
| --- | --- |
| `BERTOS_RUNTIME_DIR` | Where the JSON stores (config, campaigns, promos, clips, ledger) live. Default `.bertos-runtime`. Back this up — it's your data. |
| `BERTOS_DEPLOYMENT_MODE` | `local` enables the engine, promo rail, and factory bridge. Anything else runs the cockpit read-only. Set to `local` on the VPS. |
| `BERTCLIPS_DIR` | Path to the BertClipsHub factory folder (posted.json / views.json / roblox-promo). Leave unset if the factory isn't on this box. |
| `BERTCLIPS_GATE_TOKEN` | Optional. If set, POST (mutation) routes require an `x-bertclips-token` header matching it. Leave unset on a private VPS behind your own firewall. |

### 4. Start + keep it alive 24/7

```bash
npm run start      # serves on :3210
```

Then hit the health endpoint once to start the heartbeat (a systemd `ExecStartPost`, an
uptime monitor, or the first cockpit load all work):

```bash
curl -s http://127.0.0.1:3210/api/health
```

A systemd unit is in [`DEPLOY.md`](./DEPLOY.md).

## Game promos: getting footage to the VPS

For clipping **other people's VODs** (YouTube/Twitch), the VPS is ideal — yt-dlp pulls
the source directly, nothing to transfer.

For your **own game** (Punch Simulator), you record gameplay on your PC — you're not
playing Roblox on the VPS. Get those recordings to the box one of two ways:

1. **Drop folder** — the factory watches `roblox-promo/raw/<slug>/` under `BERTCLIPS_DIR`.
   Sync your recordings there (Syncthing, rclone, an rsync cron) and they become promo clips.
2. **Queue a file source** — drop a recording anywhere reachable and queue it in the cockpit.

Adding a game promo in the cockpit also best-effort creates its `roblox-promo/raw/<slug>/`
drop folder (when `BERTCLIPS_DIR` points at a factory on this host).

## Tests / guards

```bash
npm run typecheck
npm test          # runs the scripts/check-*.mjs invariant guards
```

The guards lock the safety invariants: the autonomous producer is heartbeat-ticked,
free-first, and arm-gated; auto-post stays dormant until a posting rail is wired; game
promos carry no CPM (free-first) and open in the `progress` phase; the factory bridge is
loopback + read-only.
