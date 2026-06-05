import { describe, it, expect } from 'vitest';
import { deriveRoutingId, derivePairingKey } from './derive';

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// A fixed 128-bit secret so derivation outputs are reproducible across runs.
const SECRET = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

describe('pairing derivation (ADR 0001: secret/routing split)', () => {
  it('derives a deterministic, domain-separated Routing ID and Pairing key from one secret', async () => {
    const id1 = await deriveRoutingId(SECRET);
    const id2 = await deriveRoutingId(SECRET);
    const key1 = await derivePairingKey(SECRET);
    const key2 = await derivePairingKey(SECRET);

    // Deterministic: both peers derive the same values from the same secret, so they
    // agree on the room (Routing ID) and the encryption key (Pairing key).
    expect(id1).toBe(id2);
    expect(toHex(key1)).toBe(toHex(key2));

    // Domain-separated: the server-visible Routing ID exposes no Pairing-key material.
    // With distinct HKDF info labels the two outputs are independent, so the Routing ID
    // string never appears anywhere inside the key bytes.
    expect(toHex(key1).includes(id1)).toBe(false);
  });
});
