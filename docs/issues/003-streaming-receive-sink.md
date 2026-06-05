# 003 — Streaming receive sink (File System Access API + Blob fallback)

Type: AFK

## What to build

Replace the in-memory Blob on the receive side with streaming-to-disk so large files don't
crash the tab. This resolves the brief's Blob-vs-stream contradiction with an honest,
per-browser size ceiling.

End-to-end behavior:
- Where the File System Access API is available (Chromium/desktop), the receiver calls
  `showSaveFilePicker()` up front and writes each chunk straight to the resulting
  `WritableStream` as it arrives — effectively no size limit.
- Where it is unavailable (Firefox, iOS Safari), fall back to the in-memory Blob path from
  issue 002, with a documented size cap and a warning above it.
- The choice is detected at runtime; the user is told which mode they're in when it matters
  (e.g. "large file — choose where to save").

## Acceptance criteria

- [ ] On a supporting browser, a file larger than available RAM transfers without the tab's memory growing with file size.
- [ ] On a non-supporting browser, the Blob fallback still works and warns past the documented cap.
- [ ] The downloaded file is byte-identical to the original in both modes.

## Blocked by

- 002 — Plain file transfer end-to-end
