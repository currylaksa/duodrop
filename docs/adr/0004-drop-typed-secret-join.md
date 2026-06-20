# Drop the typed pairing-secret join; lead with the short code

## Status

accepted (supersedes the typed-fallback part of [ADR 0001](./0001-high-entropy-pairing-secret.md);
builds on [ADR 0003](./0003-short-code-sas-pairing.md))

## Context

The product exists for one job: get a file onto an **untrusted, co-located device** — a
print-shop PC, a lab machine — **without signing a messaging account into it**. The whole
point is to not hand a public machine your identity.

ADR 0001 made the Pairing secret high-entropy (~128 bits) and offered three Join methods:
scan a QR, open a share link, or **type the secret** (rendered as ~22 base32 chars). The
typed fallback was meant to be "the universal way in." But in the actual use case it is
self-defeating: hand-typing 22 ambiguous characters on a public keyboard is roughly as
hostile as logging in — slow, error-prone, and exactly the friction we set out to remove.
Worse, it was the *only* typed option, so a camera-less device had no friendly path at all.

ADR 0003 added the SAS **Room code**: a short, non-secret 4-digit number authenticated by a
4-emoji human compare. That is the friendly typed path the public-device case actually
needs — and it carries no secret, so typing it on an untrusted machine is fine.

With the Room code in place, keeping the typed long secret only adds a confusing second
"code" (see the overloaded-"code" note in CONTEXT.md) and a worse UX nobody should pick.

## Decision

- **Remove hand-typing the Pairing secret as a Join method.** The text box that accepted a
  typed secret (or a pasted share link) is gone from the UI, along with its parsing path.
- **The high-entropy secret survives only as a QR / share-link transport.** Scanning the QR
  and opening a share link still work and still carry the same 128-bit secret out of band;
  the secret is simply never entered by hand. The creator's QR / "Copy link" path is
  unchanged.
- **The short Room code (ADR 0003) becomes the primary Join.** The home screen leads with
  "Pair with a room code"; "Create a QR channel" is the secondary, camera/remote path. The
  Join screen is unified: type the 4-digit code, or scan a QR.

ADR 0001's **core invariant is untouched**: the encryption key still never reaches the
signaling server, on either path.

## Consequences

- The public-device job is now friction-light end to end: 4 digits + an emoji glance, no
  account, nothing long to type.
- We lose the "type the secret with no camera and no second screen" escape hatch. That
  combination is now served by the Room code instead (which needs the relay to allocate a
  code, but so does every path here).
- One fewer parsing surface in the client (`decodeSecret`-from-typed-input is no longer
  wired into joining), and one fewer overloaded meaning of "code" to explain — though
  CONTEXT.md still documents all three (secret / Routing ID / Room code).
- Reversible: the QR/link path retains the full secret machinery, so a typed-secret box
  could be re-added later if a no-relay, no-camera case ever demands it.
