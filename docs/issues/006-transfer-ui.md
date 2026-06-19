# 006 — Transfer UI: drag-drop, progress, speed, errors, queue

Type: AFK

## What to build

The live transfer experience on a responsive React layout (desktop + mobile from one
codebase), wrapping the transfer path from issues 002–004.

End-to-end behavior:
- Drag-and-drop plus a file picker for selecting files; either peer can send or receive.
- A **send queue**: multiple selected files are sent as sequential Transfers over the one
  persistent connection (no re-pairing between files).
- Live UI: connection state, per-file progress bars, transfer speed, and success/error states
  on both ends.
- Mobile resilience: on `visibilitychange` to hidden during a transfer, warn the user to keep
  the tab foregrounded; a backgrounding-induced drop falls into the re-pair model.
- Responsive layout works on phone and desktop.

## Acceptance criteria

- [x] Files can be added by drag-drop and by picker; sending works in both directions.
- [x] Queueing several files sends them sequentially without re-pairing.
- [x] Both ends show live per-file progress and transfer speed.
- [x] Connection state and success/error states are clearly surfaced.
- [x] Backgrounding the tab mid-transfer warns the user.
- [x] Layout is usable on both a phone and a desktop viewport.

## Blocked by

- 002 — Plain file transfer end-to-end
- 005 — Pairing UI: code + QR + copy-link + scan
