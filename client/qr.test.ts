import { describe, it, expect } from 'vitest';
import { buildRoomLink, roomFromScan } from './qr';

describe('QR join (SAS path): a scanned link recovers the non-secret room code', () => {
  it('round-trips a room code through a built link', () => {
    const link = buildRoomLink('4821', 'https://duodrop.app');
    expect(link).toBe('https://duodrop.app/#room=4821');
    expect(roomFromScan(link)).toBe('4821');
  });

  it('also tolerates a bare 4-digit code, so a code-only QR still works', () => {
    expect(roomFromScan('0007')).toBe('0007');
    expect(roomFromScan('  4821 ')).toBe('4821');
  });

  it('returns null for text that carries no room code', () => {
    expect(roomFromScan('https://example.com/hello')).toBeNull();
    expect(roomFromScan('not a qr payload')).toBeNull();
    expect(roomFromScan('12345')).toBeNull();
    expect(roomFromScan('')).toBeNull();
  });
});
