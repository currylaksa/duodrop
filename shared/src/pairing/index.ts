/**
 * Pairing primitives (ADR 0001). The Pairing secret is the single source of truth; from it
 * both peers derive a server-visible Routing ID and a device-only Pairing key, and it
 * travels between them via three interchangeable Join methods (typed code, link, QR).
 */
export { generatePairingSecret } from './secret';
export { deriveRoutingId, derivePairingKey } from './derive';
export { encodeSecret, decodeSecret } from './base32';
export { buildShareLink, parseShareLink } from './link';
