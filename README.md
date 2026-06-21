<div align="center">

# 🫳 DuoDrop

**AirDrop for everyone — original quality, zero trust, no app, no account.**

Send a file straight from one device to another over WebRTC, end-to-end encrypted.
The server brokers the handshake and learns *nothing* — not the file, not the key.

[**🚀 Live: duodrop.pages.dev**](https://duodrop.pages.dev) · [Glossary](CONTEXT.md) · [ADRs](docs/adr/)

</div>

---

## Why this exists

Two everyday problems, one tool:

1. **The untrusted machine.** You need a file on a print-shop PC or a lab computer, but
   you do *not* want to log your Telegram / WhatsApp / Drive account into it — and typing a
   long secret on a borrowed keyboard is just as hostile. DuoDrop needs neither.

2. **Original quality.** Messaging apps recompress your photos into mush. DuoDrop is an
   **AirDrop alternative that ships the original bytes** — lossless, byte-exact, any file
   type, any size — and it works PC↔phone, phone↔phone, and PC↔PC, across platforms, in
   the browser.

No install. No account. The bytes go **directly device-to-device**; they never touch a server.

## How it works

```
   Device A  ──┐                                  ┌──  Device B
               │   1. rendezvous on a 4-digit     │
   [room code] │      non-secret room code        │ [type code / scan QR]
               │   2. compare 4 emoji 🐢🍕🌙⚡      │
   signaling ──┤      (catches a relay-in-middle) ├── signaling
    server     │                                  │   (relay only)
               │   3. WebRTC data channel opens   │
               └──────── encrypted file ──────────┘
                        (server sees none of it)
```

1. **Pair** — Device A shows a short **non-secret 4-digit room code** (plus a QR and a link
   for it). Device B types the code or scans the QR. Typing always works, so *every* device
   combination is covered — including PC↔PC, where no camera is pointed at a screen.
2. **Verify** — both humans compare a **4-emoji safety string**. Matching emoji prove there's
   no relay-in-the-middle. Security comes from this compare, *not* from the code's secrecy.
3. **Transfer** — a direct WebRTC `RTCDataChannel` opens and the file streams across,
   chunk by chunk, encrypted end-to-end.

### The security model (the load-bearing part)

The encryption key is derived from an **ephemeral X25519 exchange the two devices run
themselves** — never typed, and **never sent to the signaling server** ([ADR 0001](docs/adr/0001-high-entropy-pairing-secret.md)).
WebRTC already encrypts the channel in transit (DTLS); DuoDrop adds an **application-layer
E2E layer** on top with libsodium `crypto_secretstream` (XChaCha20-Poly1305). So even a
malicious signaling server or TURN relay learns nothing about the contents.

> The 4-digit code is *not* a secret — there's nothing on it to brute-force. It only tells
> the server which two peers to introduce. The key never goes near it.

### Big files, small memory

Both ends stream to/from disk instead of holding the whole file in RAM: the sender slices
the file straight off disk, and the receiver writes incoming chunks to disk via
`showSaveFilePicker` (with a Blob fallback). No 2 GiB typed-array cap, no tab crashes on
large transfers. Backpressure on `bufferedAmount` keeps the send buffer from blowing up.

## Tech stack

| Layer | What |
|-------|------|
| **Frontend** | React 19 · Vite · TypeScript · installable PWA |
| **Crypto** | `libsodium-wrappers` — X25519 key exchange + `crypto_secretstream` (XChaCha20-Poly1305) |
| **Transport** | WebRTC `RTCPeerConnection` / `RTCDataChannel`, STUN + TURN for NAT traversal |
| **Pairing** | Non-secret 4-digit room code · `qrcode` (show) · `jsqr` (scan) · 4-emoji SAS |
| **Signaling** | Node · Express · `ws` — relays SDP/ICE only, in-memory rooms, no file data |
| **Deploy** | Client on Cloudflare Pages · signaling on Render |

## Run it locally

```bash
npm install

npm run server      # signaling server (Node + ws)
npm run client:dev  # Vite dev server, in a second terminal

npm test            # vitest
npm run typecheck   # tsc --noEmit
```

Open the printed URL on two devices (or two tabs), pair with the code, compare the emoji, send.

## Project shape

- **`CONTEXT.md`** — the domain glossary. Keep *Routing ID* (routes, server-visible) distinct
  from the *Session key* (secures, never sent to the server).
- **`docs/adr/`** — architecture decisions. ADR 0001 (key stays off the server) is load-bearing;
  ADRs 0003–0005 chart the move to SAS-only pairing (the old high-entropy secret was removed).
- **`docs/issues/`** — the work built in vertical slices, TDD where the logic is non-trivial.

---

<div align="center">
<sub>A portfolio project exploring WebRTC, NAT traversal, signaling, and end-to-end crypto.</sub>
</div>
