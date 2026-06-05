# 002 — Plain file transfer end-to-end

Type: AFK

## What to build

Get a real file across the established data channel, reliably and bidirectionally — no
encryption yet. This proves the chunking/backpressure/reassembly path before crypto and UI
are layered on.

End-to-end behavior:
- Sender slices the file into ~16 KB chunks (safely under the data-channel message limit).
- A metadata header is sent first (filename, size, MIME type, total chunk count), then the
  ordered binary chunks, then an end-of-file marker. (Plaintext for now; this framing is
  replaced by the encrypted `crypto_secretstream` framing in issue 004.)
- Backpressure: the sender monitors `dataChannel.bufferedAmount`, pauses above a high
  watermark, and resumes on the `bufferedamountlow` event so large files don't blow the send
  buffer.
- Receiver reassembles chunks into a Blob and triggers a download. (Streaming-to-disk is
  issue 003.)
- Either peer can send — direction is chosen per transfer, not fixed by who created the room.

## Acceptance criteria

- [ ] A multi-megabyte file transfers and the downloaded file is byte-identical to the original.
- [ ] Backpressure keeps `bufferedAmount` bounded during a large transfer (no unbounded growth).
- [ ] Transfer works in both directions (creator→joiner and joiner→creator).
- [ ] Metadata header arrives before chunks; receiver uses it to name and size the download.

## Blocked by

- 001 — Pairing handshake → data channel "connected"
