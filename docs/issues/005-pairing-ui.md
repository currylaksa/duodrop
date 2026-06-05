# 005 — Pairing UI: code + QR + copy-link + scan

Type: AFK

## What to build

The full pairing panel realizing the "one mechanism, three Join methods" model (see
CONTEXT.md). All three carry the *same* Pairing secret; none reveals it to the server.

End-to-end behavior:
- Creating device shows: the secret as a **grouped base32 code** (ambiguous chars excluded),
  a **QR** of the share link, and a **Copy-link** button.
- Joining device can join by any of three paths:
  - **Type the code** — universal fallback; the typed base32 is decoded to the secret, from
    which the Routing ID is derived. Works PC↔PC.
  - **Scan the QR** — camera-based scanner (`html5-qrcode` or similar) reads the link.
  - **Open the link** — auto-joins from the URL fragment (already wired in issue 001).
- Scanning is always optional — never the only way in (that would break PC↔PC).

## Acceptance criteria

- [ ] Creator panel displays the base32 code (large, grouped), a scannable QR, and a working Copy-link button.
- [ ] Joining by typing the code connects (PC↔PC verified, no camera).
- [ ] Joining by scanning the QR connects (phone scanning a PC screen / phone↔phone).
- [ ] Joining by opening the link auto-connects.
- [ ] The typed-code input tolerates the excluded/ambiguous-character scheme and grouping.

## Blocked by

- 001 — Pairing handshake → data channel "connected"
