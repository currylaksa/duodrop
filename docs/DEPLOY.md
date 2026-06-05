# Deploying DuoDrop (ADR 0002 — strictly-free stack)

Three components: a static frontend, a stateful signaling server, and managed TURN.

## 1. Signaling server → Render (free)

1. Push this repo to GitHub.
2. Render → **New → Blueprint**, point it at the repo. It reads [`render.yaml`](../render.yaml)
   and creates the `duodrop-signaling` web service (`npm run server`, health check `/health`).
   Render injects `PORT` and gives you `https://<name>.onrender.com`.
3. Set the TURN secrets (below) in the service's **Environment**.

## 2. TURN → Cloudflare Realtime TURN (free)

1. Cloudflare dashboard → **Realtime → TURN** → create a TURN key.
2. Put its **Key ID** and **API token** into the Render env as `CF_TURN_KEY_ID` and
   `CF_TURN_API_TOKEN`. The server mints short-lived credentials per pairing at
   `/ice-servers`; the secret never reaches the client (ADR 0001). Unset ⇒ STUN-only.

## 3. Frontend → Cloudflare Pages (free)

1. Cloudflare → **Pages → Connect to Git** → this repo.
2. Build command `npm run build`, output directory `dist`.
3. Build env var `VITE_SIGNAL_URL=wss://<your-render-host>.onrender.com`.
4. [`public/_headers`](../public/_headers) ships the CSP + security headers — tighten
   `connect-src` from `*.onrender.com` to your exact host.

## 4. Keep-warm

Add repo secret `SIGNALING_HEALTH_URL=https://<your-render-host>.onrender.com/health`.
[`.github/workflows/keep-warm.yml`](../.github/workflows/keep-warm.yml) pings it every 10 min
so the free tier doesn't cold-start.

## Local development

```bash
npm run server      # signaling on :8080
npm run client:dev  # Vite on :5173, proxies /ws + /ice-servers → :8080
```
Open `http://localhost:5173`, **Create a channel**, copy the link, open it in a second
window/device. Locally TURN is STUN-only unless you export `CF_TURN_*` before `npm run server`.
