/**
 * The link Join method. The Pairing secret rides in the URL `#fragment`, which browsers
 * never send to the server (ADR 0001), so the share link is zero-knowledge to the relay.
 * The fragment carries the secret as compact base64url.
 */

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Build a share link carrying the secret in its #fragment. */
export function buildShareLink(secret: Uint8Array, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/#k=${toBase64Url(secret)}`;
}

/** Recover the secret from a share link, or null if it carries no pairing fragment. */
export function parseShareLink(url: string): Uint8Array | null {
  let hash: string;
  try {
    hash = new URL(url).hash;
  } catch {
    return null;
  }
  const match = /[#&]k=([A-Za-z0-9_-]+)/.exec(hash);
  if (!match) return null;
  try {
    return fromBase64Url(match[1]!);
  } catch {
    return null;
  }
}
