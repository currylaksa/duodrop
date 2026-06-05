import { describe, it, expect } from 'vitest';
import { generatePairingSecret } from './secret';

describe('generatePairingSecret', () => {
  it('returns a fresh 128-bit secret on each call', () => {
    const a = generatePairingSecret();
    const b = generatePairingSecret();

    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(16); // 128-bit, per ADR 0001
    expect([...a]).not.toEqual([...b]); // unpredictable: two calls differ
  });
});
