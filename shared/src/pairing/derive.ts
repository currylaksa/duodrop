/**
 * Pairing-secret key derivation (ADR 0001).
 *
 * Both values come from the same high-entropy Pairing secret via HKDF-SHA-256 with
 * distinct `info` labels, so they are cryptographically independent (domain-separated):
 *   - the Routing ID is server-visible and reveals nothing about the key;
 *   - the Pairing key never leaves the device.
 */

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// WebCrypto's BufferSource requires an ArrayBuffer-backed view; copy into one.
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const SALT = toArrayBuffer(encoder.encode('duodrop/v1'));

async function hkdf(secret: Uint8Array, info: string, byteLength: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(secret), 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: toArrayBuffer(encoder.encode(info)) },
    key,
    byteLength * 8,
  );
  return new Uint8Array(bits);
}

/** The server-visible value the two peers are matched on. */
export async function deriveRoutingId(secret: Uint8Array): Promise<string> {
  return toHex(await hkdf(secret, 'duodrop:routing', 16));
}

/** The 32-byte symmetric key used to encrypt Transfers. Never sent to the server. */
export async function derivePairingKey(secret: Uint8Array): Promise<Uint8Array> {
  return hkdf(secret, 'duodrop:encryption', 32);
}
