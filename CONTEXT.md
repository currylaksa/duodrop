# DuoDrop

A browser-based, zero-install P2P file transfer app for one specific problem: **getting a
file onto an untrusted, co-located device — a print-shop PC, a lab machine — without
signing into Telegram / WhatsApp / Drive on it.** Logging a messaging account into a public
machine is the thing to avoid; so is hand-typing a long secret on it, which is just as
hostile. Two devices pair, then send files directly device-to-device over WebRTC with
application-layer end-to-end encryption. The signaling server only brokers the handshake and
must learn nothing about file contents or the encryption key.

The pairing UX is built around that hostile setting. The **primary** way in is a short,
**non-secret** room code authenticated by a human emoji compare (SAS, [ADR 0003](docs/adr/0003-short-code-sas-pairing.md)) —
nothing long to type, no account. The high-entropy-secret path survives only as a **QR /
share-link** transport (camera or remote case); the secret is **never hand-typed to join**
([ADR 0004](docs/adr/0004-drop-typed-secret-join.md)).

## Language

### Pairing

**Peer**:
One of the two devices in a transfer. Either peer can send or receive; direction is
chosen after pairing, not fixed by who created the room.

**Room**:
The ephemeral, two-peer matching context held in the signaling server's memory. Exists
only to relay the handshake between exactly two peers, then is torn down.

**Pairing secret**:
The shared, **high-entropy** (128-bit) secret both peers know and from which the
encryption key is derived. It rides inside a QR or share link (base64url) and is **never
sent to the signaling server**. It is the pairing primitive for the **QR / link path**. It
is deliberately *not* a short memorable code — a short code could be brute-forced by a
malicious server from the Routing ID — so it is **never hand-typed to join** (typing 128
bits is hostile, doubly so on a public device). The typed case is served instead by the
**Room code** below, which is non-secret. (Historically the secret had a ~22-char base32
typed fallback; [ADR 0004](docs/adr/0004-drop-typed-secret-join.md) removed it.)
_Avoid_: room code, pairing code, short code, passphrase.

**Routing ID**:
The value the signaling server matches the two peers on. Derived from the pairing secret
by domain-separated hashing so it shares no bits with the Pairing key. Because the secret
is high-entropy, the server cannot brute-force the secret back out of the Routing ID. The
server sees only this, never the pairing secret.
_Avoid_: room code, room ID.

**Pairing key**:
The symmetric key derived from the **pairing secret**, used to encrypt and decrypt file
chunks on the QR / link path. One per pairing. (The Room-code path derives its *own*
symmetric key — the SAS **session key** — from an ephemeral key exchange, not from any
pairing secret; ADR 0003. Both feed the same encryption stream, so don't use "session key"
loosely for the Pairing key.)

**Join method**:
How the second peer pairs. Two families now exist:
1. **Room code** (primary; SAS, ADR 0003) — the joiner types a short, non-secret 4-digit
   code and both humans compare a 4-emoji safety string. No secret to type, no account; the
   friendly path for a public or camera-less device.
2. **Pairing-secret transport** — the joiner obtains the high-entropy **pairing secret** out
   of band, by **scanning the QR** or **opening the share link**. Both carry the *same*
   secret and reveal nothing to the server; the QR suits a phone, the link suits remote.
**Hand-typing the pairing secret has been removed** (ADR 0004) — the Room code covers the
typed case instead.
_Avoid_: treating QR as the primary way in; calling the typed long secret a join method.

**Room code**:
The short, **non-secret**, server-allocated 4-digit number for the SAS path (ADR 0003). It
is a human-friendly **Routing ID** the two peers rendezvous on — security comes from the
emoji compare, not from the code, so the server may mint and see it. Distinct from the
**pairing secret**, which it never carries.
_Avoid_: conflating it with the pairing secret; treating its secrecy as protective.

### Transfer

**Transfer**:
The sending of **one file** from one peer to the other, framed as a single one-directional
encryption stream (libsodium `crypto_secretstream`). The stream's first encrypted message
is the file metadata; the final tag marks end-of-file. A new Transfer = a new stream, so
either peer can send and direction is per-transfer.
_Avoid_: "send" / "upload" / "share" used as nouns.

**Send queue**:
Multiple files selected together are sent as sequential Transfers over the one persistent
connection. The queue is an ordering of Transfers, not a single combined Transfer.
_Avoid_: batch, bundle.

### Flagged ambiguities

- The word "code" is now overloaded three ways: the **pairing secret** (secures; never
  typed, never sent to the server), the **Routing ID** (routes; server-visible hash), and
  the **Room code** (the SAS path's non-secret 4-digit routing rendezvous). The Room code is
  a kind of Routing ID; neither it nor the Routing ID is ever the secret. When a design note
  says "the code," decide which of the three is meant.

## Example dialogue

> **Dev:** "Where does the server look up the room?"
> **Expert:** "By the Routing ID — the hash. It never sees the Pairing secret."
> **Dev:** "So how does the other peer get the Pairing secret?"
> **Expert:** "Out of band: it's in the link fragment or the QR — never typed by hand. The
> server relays handshake messages for that Routing ID but can't derive the Pairing key."
> **Dev:** "And the short room code?"
> **Expert:** "Different path entirely — that's the SAS Room code. It carries no secret; the
> two humans compare four emoji to authenticate. The server allocates and sees the code."
