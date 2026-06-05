# High-entropy pairing secret, hidden from the signaling server

## Status

accepted

## Context

DuoDrop's differentiator is application-layer end-to-end encryption such that "even a
compromised relay sees nothing." For that claim to be true, our threat model must include
an **actively malicious signaling server** — one that could MITM the WebRTC handshake by
swapping DTLS fingerprints in the SDP it relays. App-layer encryption only defeats that
attack if the **encryption key is hidden from the server**.

The brief proposed short, memorable pairing codes (e.g. `SNAIL-42`) that both route peers
*and* derive the key. But the server routes on the code, so it sees it; and if the key is
derived from it, the server can derive the key. Even if we route on `hash(code)` instead,
a short code is low-entropy (~13 bits) and the server can brute-force it offline from the
hash in milliseconds — a slow KDF doesn't help against so small a search space.

## Decision

- The **pairing secret** is high-entropy (~128-bit), never sent to the signaling server.
  It rides inside the share link's URL `#fragment` and inside the QR; the typed fallback
  renders it as ~22 grouped base32 chars.
- The server routes on a **Routing ID** derived from the secret by domain-separated
  hashing (`HKDF(secret, "routing")`), distinct from the **Pairing key**
  (`HKDF(secret, "encryption")`). Because the secret is high-entropy, the Routing ID is
  not brute-forceable back to the secret, and it shares no bits with the key.
- We do **not** use a PAKE. A PAKE would let us keep short memorable codes (limiting the
  server to one online guess per handshake), but a high-entropy secret makes the offline
  brute-force concern moot with far simpler crypto.

## Consequences

- We give up the friendly `SNAIL-42` code. The typed-code path becomes a ~22-char base32
  fallback; the link and QR (which carry 128 bits for free) become the primary join paths.
- The signaling server is genuinely zero-knowledge of the secret and key, so the
  "compromised relay sees nothing" claim holds against both passive and active servers,
  modulo an active server still being able to *deny* service (it can't read or forge).
- Scope limit, stated honestly: content confidentiality and authenticity hold, but
  **metadata is not hidden**. An active server that MITMs the DTLS layer still observes the
  app-layer ciphertext flow — transfer count, file/chunk sizes, and timing. Size padding /
  cover traffic are explicitly out of scope for v1.
- Because both peers share a secret the MITM lacks, the app-layer AEAD authenticates the
  peer for free — no separate short-authentication-string (SAS) comparison step is needed.
