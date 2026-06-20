# SAS room code is the only pairing path; the QR carries the room code

## Status

accepted (supersedes [ADR 0004](./0004-drop-typed-secret-join.md) and the
"primary, no-human-in-the-loop" stance of [ADR 0001](./0001-high-entropy-pairing-secret.md))

## Context

ADR 0004 removed the *typed* 128-bit secret but kept the high-entropy secret alive as a
QR / share-link transport, so two pairing systems coexisted: the secret path (QR/link) and
the SAS room code. In practice that meant two "Create" buttons and two mental models for one
job.

Re-grounding on the actual purpose (get a file onto an untrusted public device with no
sign-in and nothing long to type), the secret path earns its keep nowhere the room code
doesn't already serve:

- The room code is friendlier to type and needs no camera.
- The room code's QR is just as scannable as the secret's QR — and a scanned room code is
  **non-secret**, so there is nothing to leak if a bystander photographs the screen.
- Maintaining the high-entropy secret meant carrying `secret` / `derive` / `base32` / `link`
  and a `secret` controller mode the UI no longer needed.

The only thing the secret path bought over SAS — "no human in the loop" MITM resistance —
does not matter for co-located devices where the human is already looking at both screens.

## Decision

- **The SAS room code is the sole pairing path.** The 128-bit Pairing secret is removed from
  the product: no secret display, no `Create a QR channel`, no typed-secret or pasted-link
  join, no `secret` mode in the client controller.
- **The QR now carries the room code, not a secret.** It encodes `…/#room=<code>`; scanning
  or opening it joins the same room as typing the four digits. Because the code is
  non-secret, the QR reveals nothing — its only job is to save typing.
- **One create, one join.** "Create a room" shows the 4-digit code *and* its QR and waits;
  "Join a room" takes the typed code or a camera scan. Both then run the unchanged SAS
  ephemeral-key exchange and the 4-emoji human compare before any bytes flow.

ADR 0001's **core invariant is untouched**: the per-session key (now always the SAS session
key from the ephemeral X25519 exchange) never reaches the signaling server.

## Consequences

- One pairing model end to end: a non-secret 4-digit code (typed or scanned) plus an emoji
  match. No account, no long secret, nothing for a malicious server to brute-force because
  there is no secret in play — the server already allocates and sees the code.
- The MITM envelope is now ADR 0003's everywhere: an active relay succeeds only at
  ≈ 1/64⁴ per attempt *and* only if a human ignores a visible emoji mismatch. The compare
  step is load-bearing on every pairing; the UI keeps it hard to skip.
- `shared/src/pairing/{secret,derive,base32,link}.ts` and their barrel exports are now
  **unused by the app** (their tests still pass). Left in place as dead library code for a
  separate cleanup, since deleting them touches ADR 0001's artefacts. `sas.ts` is the only
  pairing primitive the app now uses.
- Reversibility is cheaper to describe than to want: the secret modules still exist in git
  and on disk, so the high-entropy path could be reinstated, but ADR 0005 is a deliberate
  narrowing, not a hedge.
