# DuoDrop

A browser-based, zero-install P2P file transfer app. Two devices pair, then send
files directly device-to-device over WebRTC with application-layer end-to-end
encryption. The signaling server only brokers the handshake and must learn nothing
about file contents or the encryption key.

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
encryption key is derived. It rides inside a link or QR (base64url), and can be typed as a
fallback (rendered as ~22 grouped base32 chars, ambiguous chars excluded). It is **never
sent to the signaling server**. This is the real pairing primitive. It is deliberately
*not* a short memorable code — a short code could be brute-forced by a malicious server
from the Routing ID.
_Avoid_: room code, pairing code, short code, passphrase.

**Routing ID**:
The value the signaling server matches the two peers on. Derived from the pairing secret
by domain-separated hashing so it shares no bits with the Pairing key. Because the secret
is high-entropy, the server cannot brute-force the secret back out of the Routing ID. The
server sees only this, never the pairing secret.
_Avoid_: room code, room ID.

**Pairing key** (a.k.a. session key):
The symmetric key derived from the **pairing secret**, used to encrypt and decrypt file
chunks. One per pairing.

**Join method**:
One of three interchangeable ways the second peer obtains the **pairing secret** — typing
it, scanning a QR, or opening a share link. All three carry the *same* secret; QR and link
are just transports for it. Typing is the universal fallback (works PC↔PC); scanning needs
a camera; the link is the smoothest PC↔PC path. None of the three reveals the secret to
the server.
_Avoid_: treating QR as the primary or only way in (breaks PC↔PC).

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

- The brief's "the code" conflates **pairing secret** (the thing that secures) with
  **routing ID** (the thing that routes). They are deliberately separated so the server
  routes on the Routing ID while never seeing the Pairing secret. When the design says
  "the code," decide which of the two is meant.

## Example dialogue

> **Dev:** "Where does the server look up the room?"
> **Expert:** "By the Routing ID — the hash. It never sees the Pairing secret."
> **Dev:** "So how does the other peer get the Pairing secret?"
> **Expert:** "Out of band: it's in the link fragment or the QR, or the user types it.
> The server relays handshake messages for that Routing ID but can't derive the Pairing key."
