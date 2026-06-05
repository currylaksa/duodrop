# 009 — Deploy: free managed stack (Cloudflare Pages + Render + Cloudflare TURN)

Type: HITL

Human-in-the-loop: requires creating external accounts (Cloudflare, Render) and storing
secrets/env vars — not mergeable purely by an AFK agent. See ADR 0002 for why this stack
replaces the brief's DigitalOcean + Nginx + Certbot + PM2 + coturn.

## What to build

Stand the whole app up on a $0, no-VPS managed stack with automatic HTTPS everywhere
(secure context is mandatory for WebRTC, camera/QR, and service workers).

End-to-end behavior:
- **Frontend → Cloudflare Pages.** Connect the repo, build the Vite app, serve at a clean
  root origin. Add a `_headers` file with security headers (CSP, `Referrer-Policy`,
  `Permissions-Policy`). The signaling server's `wss://` URL is injected at build via an env
  var.
- **Signaling → Render free tier.** Deploy the unchanged Node `ws` + Express server. It
  reads `PORT` from the environment and exposes a `/health` endpoint. A **keep-warm pinger**
  (GitHub Actions cron / UptimeRobot hitting `/health` every ~10 min) prevents the free-tier
  idle spin-down, staying within the 750 instance-hours/month budget.
- **TURN → Cloudflare Realtime TURN** (see issue 007). The Render server holds the CF TURN
  key secret and mints short-lived credentials via the CF API; the client never holds a
  reusable credential.
- No droplet, Nginx, Certbot, PM2, or coturn. HTTPS is automatic on both Pages and Render.

## Acceptance criteria

- [ ] Frontend is live on Cloudflare Pages over HTTPS with security headers set via `_headers`.
- [ ] Signaling server runs on Render free, reads `PORT` from env, and serves `/health`.
- [ ] A keep-warm pinger keeps the signaling server responsive (no user-visible cold start in normal use) and stays within the free tier.
- [ ] Cross-network transfer (mobile data ↔ Wi-Fi) works end-to-end on the live deploy, relaying via Cloudflare TURN when a direct path fails.
- [ ] QR scanning and PWA install work (secure context confirmed).
- [ ] No credit card and no paid plan is required for any component.

## Blocked by

- 006 — Transfer UI: drag-drop, progress, speed, errors, queue
- 007 — TURN relay + ephemeral credentials (Cloudflare Realtime TURN)
- 008 — PWA: manifest + service worker (app shell only)
