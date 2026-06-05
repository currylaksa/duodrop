import { describe, it, expect, beforeAll } from 'vitest';
import { ready, createEncryptor, createDecryptor } from './secretstream';

const KEY = new Uint8Array(32).fill(7);
const bytes = (s: string) => new TextEncoder().encode(s);
const str = (b: Uint8Array) => new TextDecoder().decode(b);

describe('secretstream (phase 4): XChaCha20-Poly1305 stream encryption', () => {
  beforeAll(async () => {
    await ready();
  });

  it('round-trips a sequence of messages and flags the final one', () => {
    const enc = createEncryptor(KEY);
    const dec = createDecryptor(KEY, enc.header);

    const c1 = enc.encrypt(bytes('hello'), false);
    const c2 = enc.encrypt(bytes('world'), true);

    const m1 = dec.decrypt(c1);
    const m2 = dec.decrypt(c2);

    expect(str(m1.message)).toBe('hello');
    expect(m1.final).toBe(false);
    expect(str(m2.message)).toBe('world');
    expect(m2.final).toBe(true);
  });

  it('rejects a wrong key and a tampered ciphertext (zero-trust)', () => {
    const enc = createEncryptor(KEY);
    const cipher = enc.encrypt(bytes('secret payload'), true);

    // Wrong key cannot decrypt the stream.
    const wrong = createDecryptor(new Uint8Array(32).fill(9), enc.header);
    expect(() => wrong.decrypt(cipher)).toThrow();

    // A single flipped byte in the ciphertext fails the Poly1305 authentication tag.
    const dec = createDecryptor(KEY, enc.header);
    const tampered = cipher.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    expect(() => dec.decrypt(tampered)).toThrow();
  });
});
