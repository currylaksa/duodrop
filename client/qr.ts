/**
 * The QR Join method (phase 5, issue 005). The creator's QR encodes the *share link*, so a
 * scan recovers the same Pairing secret as opening the link — never revealing it to the server
 * (ADR 0001). This module is the pure seam: turning decoded QR text back into a secret. The
 * camera capture itself lives in QrScanner.tsx.
 */
import { parseShareLink, decodeSecret } from '../shared/src/pairing';

const SECRET_BYTES = 16;

/**
 * Recover a Pairing secret from scanned QR text. The QR carries a share link, but we also
 * tolerate a bare typed code so the scanner never rejects a valid secret on a technicality.
 * Returns null if the text isn't a DuoDrop secret.
 */
export function secretFromScan(text: string): Uint8Array | null {
  const fromLink = parseShareLink(text);
  if (fromLink && fromLink.length === SECRET_BYTES) return fromLink;
  try {
    const fromCode = decodeSecret(text);
    if (fromCode.length === SECRET_BYTES) return fromCode;
  } catch {
    // not a base32 code either
  }
  return null;
}
