# Build Brief — Secure P2P File Transfer Web App ("DuoDrop")

## What we're building
A web-based, cross-platform file transfer app (an AirDrop / PairDrop alternative) that
sends files **directly device-to-device** over WebRTC. No app install. One responsive
site that works on PC (browser) and phone (browser + installable PWA). Supports any
device combination — **PC↔phone, phone↔phone, and PC↔PC** — in any direction. The
signaling server only brokers the initial handshake; files never touch the server.
Differentiator vs existing tools: **application-layer end-to-end encryption** derived
from the pairing code, so even a compromised relay sees nothing — a zero-trust file transfer.

This is a portfolio project demonstrating WebRTC, NAT traversal, signaling, E2E crypto,
chunked streaming, and PWA deployment, for a Security / Solutions Engineer profile.

## Pairing model (read this first)
**The short room code is the real pairing primitive.** QR and links are just shortcuts
that resolve to the same code. This is what makes every device combination work — QR alone
breaks PC↔PC, since neither PC has a camera pointed at the other's screen. So the first
device displays the code three ways, and the second device can join by whichever fits:

1. **Type the code** — universal, works for *every* combination including PC↔PC. Use
   human-friendly codes (word-based like `SNAIL-42`, or unambiguous chars — exclude
   `0/O`, `1/l/I`) since people type them by hand.
2. **Scan QR** — optional accelerator when the joining device has a camera (phone↔phone,
   phone scanning a PC screen). Just encodes the same code.
3. **Share a link** — URL with the code embedded (e.g. `duodrop.app/r/SNAIL-42`).
   Opening it auto-joins the room. This is the smoothest PC↔PC path: copy the link, send
   it to the other machine (chat / email to self), open, connected. Add a "Copy link" button.

So the first device's pairing panel shows: **the code (large), a QR of it, and a Copy-link
button.** One mechanism, three ways in.

## Core user flow
1. User opens site on device A → app generates a short room code, plus a QR and a shareable link encoding it.
2. User joins on device B by typing the code, scanning the QR, or opening the link.
3. Signaling server matches the two peers in a "room" and relays SDP offer/answer + ICE candidates.
4. WebRTC `RTCPeerConnection` + `RTCDataChannel` establishes a direct P2P link.
5. Sender picks file(s) → chunked, encrypted, streamed over the data channel.
6. Receiver reassembles, decrypts, and downloads. Show progress + transfer speed on both ends.

Either device can send or receive — direction is chosen after pairing, not fixed by who created the room.

## Architecture

### Frontend (one responsive site)
- React 19 + Vite, responsive layout (desktop and mobile from same codebase).
- PWA: web app manifest + service worker so phone can "Add to Home Screen" and launch fullscreen.
- Pairing UI: display code + QR + copy-link button on the creating device; join input
  (type code) + QR scanner + link auto-join on the joining device.
- QR: generate with `qrcode`; scan with a camera-based lib (e.g. `html5-qrcode`). Scanning
  is optional — never the only way to join (would break PC↔PC).
- Drag-and-drop + file picker for selecting files. Either peer can send or receive.
- Live UI: connection state, per-file progress bars, transfer speed, success/error states.

### Signaling server (thin)
- Node + Express + WebSocket (`ws`).
- Responsibilities ONLY: create/join rooms by code, relay SDP offer/answer and ICE candidates between the two peers, clean up rooms on disconnect.
- Stateless beyond in-memory room map. No file data ever passes through it.
- Rate-limit room creation; expire idle rooms.

### Connectivity
- **STUN**: Google public STUN servers for NAT discovery (free).
- **TURN**: run `coturn` on the DigitalOcean droplet as a relay fallback for symmetric
  NATs / mobile networks (~10–15% of connections fail without it). Use credentialed TURN.
- Pass both into `RTCPeerConnection` `iceServers`.

### File transfer mechanics
- **Chunking**: slice files (~16–64 KB chunks; stay under the data channel message limit).
- **Backpressure**: monitor `dataChannel.bufferedAmount`, pause sending above a high
  watermark, resume below a low watermark, to avoid blowing the send buffer on big files.
- **Protocol**: send a JSON metadata header (filename, size, type, total chunks) first,
  then ordered binary chunks, then an end-of-file marker. Receiver reassembles into a Blob
  and triggers download.
- Support multiple files queued sequentially.

### Security (the differentiator — lean into this)
- WebRTC already encrypts the data channel in transit via DTLS. Add an **app-layer E2E layer** on top:
  - Derive a shared symmetric key from the pairing code using a PAKE (e.g. SPAKE2) OR,
    simpler v1: a short user passphrase + key derivation (Argon2/PBKDF2) → shared key.
  - Encrypt each chunk with libsodium (`crypto_secretstream` / XChaCha20-Poly1305) before
    sending; decrypt on receive.
  - Goal: even a malicious TURN relay or signaling server learns nothing about file contents.
- Zero-trust framing: never trust the transport, authenticate the pairing, encrypt end-to-end.

### Deployment
- DigitalOcean droplet (Singapore), Nginx reverse proxy, SSL via Let's Encrypt/Certbot.
  HTTPS is mandatory — WebRTC, camera (QR scan), and service workers require a secure context.
- PM2 to run the signaling server; coturn as a system service.
- Same deployment pattern already used for SecureExam UTM.

## Suggested build phases (for Claude Code)
1. **Signaling + pairing**: WebSocket server, room create/join by code, relay SDP/ICE. Client supports all three join methods (type code, link auto-join, QR scan) — verify PC↔PC works via code/link. Minimal client that establishes a data channel and logs "connected".
2. **Plain transfer**: chunking, backpressure, metadata header, reassembly + download. Get a file across reliably (no encryption yet). Confirm bidirectional (either peer can send).
3. **UI/UX**: React responsive layout, pairing panel (code + QR + copy-link), QR scanner, drag-drop, progress + speed, error handling.
4. **E2E encryption**: integrate libsodium, key derivation from pairing code/passphrase, encrypt/decrypt chunks.
5. **TURN + deploy**: stand up coturn, wire iceServers, Nginx + SSL + PM2, PWA manifest + service worker, test cross-network (mobile data ↔ Wi-Fi).

## Tech stack summary
- Frontend: React 19, Vite, PWA (manifest + service worker)
- Libs: `qrcode`, `html5-qrcode` (or similar), `libsodium-wrappers`
- Signaling: Node, Express, `ws`
- Transport: WebRTC (`RTCPeerConnection`, `RTCDataChannel`), STUN (Google), TURN (coturn)
- Infra: DigitalOcean, Nginx, Certbot/SSL, PM2

## Things to get right (edge cases)
- HTTPS everywhere (secure context required for WebRTC/camera/SW).
- TURN fallback or cross-network transfers silently fail.
- Backpressure handling or large files crash the tab.
- Clean room teardown on disconnect/refresh to avoid stale rooms.
- Mobile browser quirks: keep the tab active during transfer; warn on backgrounding.
- File size: streaming chunks (not loading whole file in memory) for large transfers.

## Stretch goal — LAN auto-discovery (post-v1)
When both devices are on the **same network**, skip codes entirely: the signaling server
groups peers by their apparent network (e.g. by public IP) and each device shows the
others as clickable avatars — the Snapdrop/PairDrop "nearby devices" experience. Tap a
peer to start a transfer, no code needed. Keep this **out of v1**: it adds peer-grouping
logic on the server and a discovery UI, and the code/link/QR model already covers every
case. Note it as the headline enhancement once the core works.

## Naming
Working name "DuoDrop" (nods to the two-device pairing model). Adjust freely.
