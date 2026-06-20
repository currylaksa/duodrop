# DuoDrop

A browser-based, zero-install P2P file transfer app for one specific problem: **getting a
file onto an untrusted, co-located device — a print-shop PC, a lab machine — without
signing into Telegram / WhatsApp / Drive on it.** Logging a messaging account into a public
machine is the thing to avoid; so is hand-typing a long secret on it, which is just as
hostile. Two devices pair, then send files directly device-to-device over WebRTC with
application-layer end-to-end encryption. The signaling server only brokers the handshake and
must learn nothing about file contents or the encryption key.

Pairing is **one path** (SAS, [ADR 0003](docs/adr/0003-short-code-sas-pairing.md) /
[ADR 0005](docs/adr/0005-sas-only-room-code-qr.md)): the server allocates a short,
**non-secret** 4-digit **room code**; the other device types it or scans its QR; then both
humans compare a 4-emoji safety string before any bytes flow. There is no pre-shared secret
and nothing long to type. (An earlier high-entropy **pairing secret** path was removed —
ADR 0005; its modules linger as unused code.)

## Language

### Pairing

**Peer**:
One of the two devices in a transfer. Either peer can send or receive; direction is
chosen after pairing, not fixed by who created the room.

**Room**:
The ephemeral, two-peer matching context held in the signaling server's memory. Exists
only to relay the handshake between exactly two peers, then is torn down.

**Room code**:
The short, **non-secret**, server-allocated 4-digit number the two peers rendezvous on (SAS,
ADR 0003) — it *is* the Routing ID for this path. Security comes from the emoji compare, not
from the code, so the server may mint and see it, and its QR (`…/#room=<code>`) may be shown
or photographed freely. It carries no key.
_Avoid_: treating its secrecy as protective; conflating it with the removed pairing secret.

**Routing ID**:
The value the signaling server matches the two peers on. Today this *is* the **Room code** —
a non-secret, server-allocated 4-digit number. (Historically it was a hash of the pairing
secret; that path is retired with the secret, ADR 0005.) The server allocates and sees it; it
carries nothing that decrypts the file.
_Avoid_: room ID; implying it is secret.

**Session key**:
The 32-byte symmetric key that encrypts and decrypts file chunks, one per pairing. Both peers
derive it from the SAS ephemeral X25519 exchange over a shared transcript (ADR 0003) — never
from a typed secret, and **never sent to the signaling server**. (Formerly there was also a
secret-derived "Pairing key"; retired with the secret, ADR 0005.)
_Avoid_: calling it the "pairing key".

**Join method**:
How the second peer pairs — now a single path. The server allocates a non-secret 4-digit
**Room code**; the joiner **types it** or **scans / opens its QR** (the QR encodes
`…/#room=<code>`, so a scan or an opened link joins the same room as typing). Both peers then
run the SAS ephemeral-key exchange and compare a 4-emoji safety string. No camera is required
(typing always works); no account; no secret.
_Avoid_: calling QR and typing separate "methods" — they reach the same Room code; treating
the removed long secret as a join method.

**Pairing secret** (retired, ADR 0005):
A former 128-bit shared secret from which the encryption key was derived, carried by QR /
link and never sent to the server. Removed from the product — a co-located public device
wants neither a long secret to type nor a secret on screen, and the non-secret Room code plus
emoji compare covers the job. The term now survives only in ADR 0001 and in the unused
`shared/src/pairing/{secret,derive,base32,link}.ts`.
_Avoid_: presenting it as a current way to pair.

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

- "Code" now means the **Room code** — which is also the **Routing ID** the server matches
  on. It is non-secret. There is no longer a high-entropy secret to confuse it with (ADR
  0005), so the old "which code?" ambiguity collapses to one.

## Example dialogue

> **Dev:** "Where does the server look up the room?"
> **Expert:** "By the Room code — the 4-digit number it allocated. That's the Routing ID."
> **Dev:** "Isn't a short code brute-forceable?"
> **Expert:** "There's nothing on it to brute-force — no secret rides it. The key comes from
> an ephemeral X25519 exchange the two devices run, and the humans compare four emoji to catch
> a relay-in-the-middle. The server only relays and never holds the key."
