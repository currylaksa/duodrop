/**
 * The room-code Join transport (SAS path, ADR 0003 / 0005). The creator's QR encodes a link
 * whose #fragment carries the **non-secret** 4-digit room code, so scanning it — or opening it
 * — joins the same room as typing the code. Nothing secret is in the QR; security comes from
 * the emoji safety-string compare. Pure seam: text <-> room code. Camera capture lives in
 * QrScanner.tsx.
 */

const ROOM_CODE = /^\d{4}$/;

/** The scannable/openable link for a room code: `<origin>/#room=4821`. */
export function buildRoomLink(code: string, origin: string): string {
  return `${origin}/#room=${code}`;
}

/**
 * Recover a 4-digit room code from scanned QR text or an opened URL. Accepts a full link
 * (`…#room=4821`) or a bare code. Returns null if no room code is present.
 */
export function roomFromScan(text: string): string | null {
  const fromLink = text.match(/[#&]room=(\d{4})(?:\b|$)/);
  if (fromLink) return fromLink[1]!;
  const trimmed = text.trim();
  return ROOM_CODE.test(trimmed) ? trimmed : null;
}
