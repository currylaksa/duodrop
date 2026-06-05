# 004 — E2E encryption of the transfer

Type: AFK

## What to build

The differentiator: application-layer end-to-end encryption so even an actively malicious
signaling server (which can MITM the DTLS layer) learns nothing about file contents. See
ADR 0001 for the threat model. The Pairing secret already exists from issue 001, so this
slice is purely additive — it starts *using* the secret to key the transfer.

End-to-end behavior:
- Both peers derive `pairingKey = HKDF(secret,"encryption")` — domain-separated from the
  Routing ID so the value handed to the server shares no bits with the key.
- Each **Transfer** is wrapped in a fresh libsodium `crypto_secretstream` (XChaCha20-Poly1305):
  - Sender sends the stream header first.
  - The **first encrypted message is the metadata** (filename, size, type, chunk count) — so
    filename and size never travel in plaintext.
  - Then encrypted chunks, with the stream's **final tag marking EOF**.
- Receiver pulls the stream, decrypts metadata then chunks, and writes them through the
  issue-003 sink. A failed authentication tag aborts the transfer (the AEAD also gives
  integrity for free — no separate checksum).
- No short-authentication-string (SAS) step is needed: mutual knowledge of the secret is the
  authentication (ADR 0001).

## Acceptance criteria

- [ ] Bytes observed on the data channel are ciphertext; filename and size are not recoverable from them.
- [ ] A transfer with a tampered chunk fails the auth tag and aborts rather than producing a corrupt file.
- [ ] Transfer still works bidirectionally; each direction/file uses its own stream.
- [ ] The encryption key is derived only from the Pairing secret and is never sent to or derivable by the signaling server.

## Blocked by

- 002 — Plain file transfer end-to-end
