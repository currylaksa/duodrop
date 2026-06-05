import { describe, it, expect } from 'vitest';
import { buildShareLink, parseShareLink } from './link';

const SECRET = new Uint8Array([0xff, 0x00, 0x91, 0x3c, 0x7a, 0x42, 0xde, 0x05, 0xbb, 0x10, 0x6e, 0xa3, 0x58, 0xc4, 0x2f, 0x99]);
const ORIGIN = 'https://duodrop.app';

describe('share link', () => {
  it('round-trips the secret through build then parse', () => {
    const link = buildShareLink(SECRET, ORIGIN);
    expect([...parseShareLink(link)!]).toEqual([...SECRET]);
  });

  it('puts the secret in the URL #fragment and nothing identifying in the path or query', () => {
    const link = buildShareLink(SECRET, ORIGIN);
    const url = new URL(link);
    expect(url.hash.startsWith('#k=')).toBe(true);
    // The server only ever sees scheme/host/path/query — none of it may carry the secret.
    const beforeFragment = link.split('#')[0]!;
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
    expect(beforeFragment).not.toContain(url.hash.slice(3)); // encoded secret absent before '#'
  });

  it('returns null for a URL with no pairing fragment', () => {
    expect(parseShareLink('https://duodrop.app/')).toBeNull();
  });
});
