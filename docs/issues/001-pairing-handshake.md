# 001 — Pairing handshake → data channel "connected"

Type: AFK

## What to build

The foundational tracer bullet: two browsers pair through the signaling server and open a
direct WebRTC data channel. This slice establishes the **Pairing secret / Routing ID split**
(see ADR 0001) from day one, so later encryption is purely additive.

End-to-end behavior:
- Signaling server (Node + Express + `ws`). Rooms are keyed on the **Routing ID** only.
  A room locks at exactly two peers (a third presenting the same Routing ID is rejected),
  idle rooms expire, and room creation is rate-limited per IP. The server relays SDP
  offer/answer and ICE candidates between the two peers and tears the room down on
  disconnect/refresh (re-pair-on-drop; no resume).
- Client generates a 128-bit **Pairing secret**, derives `routingId = HKDF(secret,"routing")`
  locally, and builds the share link `https://<host>/#k=<secret>` — the secret lives in the
  URL fragment and is never sent to the server.
- The joining peer opens the link, reads the secret from the fragment, derives the same
  Routing ID, and joins the room. The two exchange SDP/ICE, open an `RTCDataChannel`, send a
  "hello", and log "connected".
- The server reads its port from the `PORT` environment variable and exposes a `/health`
  endpoint (so the deploy host and keep-warm pinger in issue 009 can reach it).

## Acceptance criteria

- [ ] Server matches peers solely by Routing ID; the Pairing secret never appears in any HTTP request, WebSocket message, or server log.
- [ ] A room holds at most two peers; a third join attempt for the same Routing ID is rejected.
- [ ] Idle/unjoined rooms expire and room creation is rate-limited.
- [ ] Opening the share link on a second device establishes an `RTCDataChannel` and both peers exchange a "hello".
- [ ] PC↔PC works via the link (no camera required).
- [ ] Disconnect/refresh tears the room down cleanly (no stale rooms); re-sharing the link re-pairs.
- [ ] Server binds to `process.env.PORT` and responds on `/health` (for deploy + keep-warm pinger).

## Blocked by

None - can start immediately.
