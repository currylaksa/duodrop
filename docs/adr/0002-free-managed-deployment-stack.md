# Free managed deployment stack instead of DigitalOcean + coturn

## Status

accepted (supersedes the deployment approach described in the build brief)

## Context

The build brief prescribed a DigitalOcean droplet with Nginx, Certbot, PM2, and a
self-hosted coturn TURN server. That is operationally heavy and not free. The goal here was
a **strictly-free ($0, no credit card)** deploy that still preserves the project's security
properties, while learning a more modern hosting approach than a hand-managed VPS.

DuoDrop is three components with different needs: a static frontend, a stateful long-lived
WebSocket signaling server, and a TURN relay (UDP + public IP). Static hosts (GitHub/
Cloudflare Pages) alone can only serve the first.

## Decision

- **Frontend → Cloudflare Pages.** Static, auto-HTTPS, clean root origin, and security
  response headers via a `_headers` file (CSP, `Referrer-Policy`, `Permissions-Policy`).
- **Signaling → Render free tier**, running the unchanged Node `ws` + Express server, kept
  responsive by a free keep-warm pinger (GitHub Actions cron / UptimeRobot on `/health`) to
  defeat the free-tier idle spin-down within the 750 instance-hours/month budget.
- **TURN → Cloudflare Realtime TURN** (managed, free) instead of self-hosted coturn. The
  signaling server holds the CF TURN secret and mints short-lived credentials via the CF
  API, preserving ADR-0001-aligned ephemeral credentials (no reusable credential in the
  client).

Rejected: Fly.io (requires a card), Cloudflare Workers + Durable Objects (the stateful
piece needs the paid plan and a signaling rewrite), Railway (no free tier), edge/isolate
runtimes like Deno Deploy (ephemeral — breaks in-memory room state), and Metered TURN
(nudges toward a static client credential, weakening the ephemeral-cred model).

## Consequences

- Entire stack is $0 with no credit card and no VPS to secure or patch; TLS is automatic.
- The signaling server code is unchanged from issue 001 — only `PORT`/`/health` wiring.
- Trade-off: the Render free tier sleeps when idle, so the keep-warm pinger is load-bearing;
  if it lapses, the first pairing after idle incurs a ~30–50s cold start.
- Dependence on Cloudflare for both Pages and TURN (single-ecosystem convenience, mild
  lock-in).
