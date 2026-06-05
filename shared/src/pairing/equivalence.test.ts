import { describe, it, expect } from 'vitest';
import {
  generatePairingSecret,
  deriveRoutingId,
  derivePairingKey,
  encodeSecret,
  decodeSecret,
  buildShareLink,
  parseShareLink,
} from './index';

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('Join methods converge on one pairing', () => {
  it('the typed code, the share link, and the creator derive the same Routing ID and Pairing key', async () => {
    const secret = generatePairingSecret();
    const origin = 'https://duodrop.app';

    const viaCreator = secret;
    const viaLink = parseShareLink(buildShareLink(secret, origin))!;
    const viaTyped = decodeSecret(encodeSecret(secret));

    const routingIds = await Promise.all([viaCreator, viaLink, viaTyped].map(deriveRoutingId));
    expect(new Set(routingIds).size).toBe(1); // all three land in the same room

    const keys = await Promise.all([viaCreator, viaLink, viaTyped].map(derivePairingKey));
    expect(new Set(keys.map(toHex)).size).toBe(1); // and share the same encryption key
  });
});
