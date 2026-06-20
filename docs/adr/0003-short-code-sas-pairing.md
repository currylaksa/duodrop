# Short-code pairing via a Short Authentication String (SAS)

## Status

accepted (extends [ADR 0001](./0001-high-entropy-pairing-secret.md))

## Context

ADR 0001 makes the Pairing secret high-entropy (~128 bits) so the signaling server can
never brute-force the key. That is the right call for the **phone path**: the QR and the
share-link carry 128 bits for free, so the user never sees the length.

But it leaves the **laptop ↔ laptop path** painful. Two laptops can't scan each other's
screens, so the joining side must hand-type the ~22-char base32 fallback. The only easy
alternative — sharing a clickable link over a messaging app — defeats the product: if a
messaging app is the trust anchor, the user might as well send the file through it.

The real use case (printing-shop laptop, CCNA lab PC) is **co-located**: both devices are
physically in front of the user, exactly like the phone-QR case. ADR 0001 dismissed a
Short Authentication String as unnecessary *because a high-entropy shared secret
authenticates the peer for free*. That reasoning only holds when the code is long. If we
want a short code, the shared secret no longer authenticates anything, so the SAS we set
aside becomes the natural way to authenticate — and it fits co-located devices perfectly.

Note the threat model for this path: the receiving device legitimately obtains the
plaintext anyway (the user wants to print / use the file on it). So encryption here is not
protecting the file *from the endpoint* — it protects it from the **signaling server and
the network**. That makes a short code easy to justify.

## Decision

Add a second, **opt-in** Join method alongside ADR 0001's secret-carrying QR/link/typed
code. The high-entropy path is unchanged and remains the default for the phone and for
remote (link) sharing.

- **Rendezvous is non-secret.** The server allocates a short numeric room number (e.g.
  `8412`); the receiver shows it, the sender types it. Nothing secret travels, so there is
  no "why not just use the messaging app" paradox. Server allocation avoids collisions and
  bounds room-squatting.
- **Key agreement is unauthenticated, then human-authenticated.** Each peer generates an
  ephemeral X25519 keypair (`crypto_kx_keypair`) and exchanges public keys through the
  relay. Both derive the same 32-byte session key from `X25519(ourPriv, peerPub)` over a
  transcript that includes both public keys in canonical order. The session key is **never
  sent to the server** — ADR 0001's core invariant still holds.
- **A 4-emoji Short Authentication String, derived from the same transcript, is shown on
  both screens.** The humans compare; the **sender taps "Match" before any file bytes
  flow**. An active relay that MITMs the exchange must substitute its own public key to
  each side, which makes the two safety strings diverge — the mismatch is visible.
- We still do **not** use a PAKE. SAS reuses primitives already in the stack (libsodium
  X25519 + BLAKE2b) with no new dependency, and the co-located screens make visual
  comparison the cheapest authenticator.

## Consequences

- Laptop ↔ laptop becomes as in-person-friendly as the phone-QR path: type a 4-digit room
  number, glance at four emoji on both screens, confirm.
- **Security envelope, stated honestly.** An active MITM succeeds with probability
  ≈ 1/64⁴ ≈ 6×10⁻⁸ per attempt, *and only if the human ignores a mismatch*. There is no
  offline attack: the relay never holds the key. This is weaker than the high-entropy
  path's "no human in the loop" guarantee, which is why this path is opt-in and the human
  compare step is load-bearing — the UI must make a mismatch hard to skip.
- ADR 0001's metadata caveat is unchanged: content stays confidential and authentic, but
  transfer count, sizes, and timing remain observable.
- New surface: an ephemeral-key exchange in the signaling protocol and a SAS-compare step
  in the UI. The crypto core lives in `shared/src/pairing/sas.ts`.
