# 007 — TURN relay + ephemeral credentials (Cloudflare Realtime TURN)

Type: AFK

## What to build

A managed TURN relay fallback for the ~10–15% of connections that fail on symmetric NATs /
mobile networks — credentialed so no reusable TURN credential ever ships to the client.
This uses **Cloudflare Realtime TURN** instead of self-hosted coturn (see ADR 0002), which
keeps the ephemeral-credential security model with no VPS to run.

End-to-end behavior:
- A Cloudflare TURN key (app) is created; its secret lives only on the signaling server
  (Render), never in the client bundle.
- The signaling server exposes an endpoint that calls Cloudflare's API to mint **short-lived
  TURN credentials** on demand.
- The client fetches these at pairing and passes them, alongside Google public STUN, into the
  `RTCPeerConnection` `iceServers`.
- No long-lived or reusable TURN credential is exposed to the client.

## Acceptance criteria

- [ ] A connection that cannot go direct succeeds via the Cloudflare TURN relay.
- [ ] TURN credentials handed to the client are short-lived and expire; the CF TURN secret never leaves the server.
- [ ] Both STUN and TURN are present in `iceServers`.
- [ ] A cross-network transfer (e.g. mobile data ↔ Wi-Fi) completes.

## Blocked by

- 001 — Pairing handshake → data channel "connected"
