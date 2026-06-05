/**
 * The typed Join method: render a Pairing secret as a human-keyable code and parse it
 * back. Uses Crockford Base32 — 32 symbols that omit the ambiguous letters I, L, O, U;
 * decoding is case-insensitive and maps the look-alikes O→0 and I/L→1.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeRaw(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decodeRaw(code: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of code) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`invalid pairing code character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Render a secret as a grouped Crockford-base32 code for typing/display. */
export function encodeSecret(secret: Uint8Array): string {
  const raw = encodeRaw(secret);
  return (raw.match(/.{1,4}/g) ?? []).join('-');
}

/** Parse a typed pairing code back into the secret bytes, tolerantly. */
export function decodeSecret(code: string): Uint8Array {
  const normalized = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return decodeRaw(normalized);
}
