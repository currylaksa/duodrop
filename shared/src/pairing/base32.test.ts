import { describe, it, expect } from 'vitest';
import { encodeSecret, decodeSecret } from './base32';

const SECRET = new Uint8Array([0xff, 0x00, 0x91, 0x3c, 0x7a, 0x42, 0xde, 0x05, 0xbb, 0x10, 0x6e, 0xa3, 0x58, 0xc4, 0x2f, 0x99]);

describe('pairing code (Crockford base32)', () => {
  it('round-trips a secret through encode then decode', () => {
    const code = encodeSecret(SECRET);
    expect([...decodeSecret(code)]).toEqual([...SECRET]);
  });

  it('decodes tolerantly: lowercase, missing groups, and confusable look-alikes', () => {
    const canonical = encodeSecret(SECRET);
    const messy = canonical
      .toLowerCase()
      .replace(/-/g, ' ') // user used spaces instead of dashes
      .replace(/0/g, 'o') // typed letter O for zero
      .replace(/1/g, 'l'); // typed letter L for one
    expect([...decodeSecret(messy)]).toEqual([...SECRET]);
  });

  it('never emits the ambiguous letters I, L, O, or U', () => {
    // Encode many random secrets; the alphabet must exclude the confusable letters.
    for (let i = 0; i < 200; i++) {
      const random = crypto.getRandomValues(new Uint8Array(16));
      const code = encodeSecret(random).replace(/-/g, '');
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('rejects a code containing characters outside the alphabet', () => {
    expect(() => decodeSecret('K7QM-9FRT-@@@@')).toThrow();
  });
});
