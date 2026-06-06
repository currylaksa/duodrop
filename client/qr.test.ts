import { describe, it, expect } from 'vitest';
import { secretFromScan } from './qr';
import {
  generatePairingSecret,
  buildShareLink,
  encodeSecret,
} from '../shared/src/pairing';

describe('QR join (phase 5): a scanned share link recovers the same Pairing secret', () => {
  it('recovers the secret from a scanned share link', () => {
    const secret = generatePairingSecret();
    const link = buildShareLink(secret, 'https://duodrop.app');

    const recovered = secretFromScan(link);
    expect(recovered).not.toBeNull();
    expect([...recovered!]).toEqual([...secret]); // identical secret — same as opening the link
  });

  it('also tolerates a bare typed code, so a code-bearing QR still works', () => {
    const secret = generatePairingSecret();
    const recovered = secretFromScan(encodeSecret(secret));
    expect([...recovered!]).toEqual([...secret]);
  });

  it('returns null for text that is not a DuoDrop secret', () => {
    expect(secretFromScan('https://example.com/hello')).toBeNull();
    expect(secretFromScan('not a qr payload')).toBeNull();
    expect(secretFromScan('')).toBeNull();
  });
});
