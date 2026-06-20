import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import {
  ready,
  generateEphemeralKeyPair,
  deriveSession,
  SAFETY_ALPHABET,
  SAFETY_STRING_LENGTH,
} from './sas';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// Seeded keypairs so the assertions are reproducible across runs.
const seeded = (fill: number) => {
  const kp = sodium.crypto_kx_seed_keypair(new Uint8Array(32).fill(fill));
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
};

beforeAll(async () => {
  await ready();
});

describe('SAS pairing (ADR 0003: short-code path)', () => {
  it('exposes a 64-symbol alphabet of distinct emoji', () => {
    expect(SAFETY_ALPHABET).toHaveLength(64);
    expect(new Set(SAFETY_ALPHABET).size).toBe(64);
  });

  it('lets both peers derive an identical session key and safety string, regardless of role', () => {
    const sender = seeded(1);
    const receiver = seeded(2);

    // Each peer calls deriveSession with its own keypair and the peer's public key.
    const senderView = deriveSession(sender, receiver.publicKey);
    const receiverView = deriveSession(receiver, sender.publicKey);

    expect(hex(senderView.sessionKey)).toBe(hex(receiverView.sessionKey));
    expect(senderView.safetyString).toEqual(receiverView.safetyString);

    expect(senderView.sessionKey.length).toBe(32);
    expect(senderView.safetyString).toHaveLength(SAFETY_STRING_LENGTH);
    for (const emoji of senderView.safetyString) expect(SAFETY_ALPHABET).toContain(emoji);
  });

  it("makes the two peers' safety strings diverge under an active MITM", () => {
    const sender = seeded(1);
    const receiver = seeded(2);
    const relay = seeded(9); // a malicious relay interposes its own ephemeral key

    // The relay terminates each peer's exchange, so neither talks to the real other side.
    const senderView = deriveSession(sender, relay.publicKey);
    const receiverView = deriveSession(receiver, relay.publicKey);

    // The humans see four different emoji on each screen and abort.
    expect(senderView.safetyString).not.toEqual(receiverView.safetyString);
    expect(hex(senderView.sessionKey)).not.toBe(hex(receiverView.sessionKey));
  });

  it('generates fresh 32-byte ephemeral X25519 keys', () => {
    const a = generateEphemeralKeyPair();
    const b = generateEphemeralKeyPair();

    expect(a.publicKey.length).toBe(32);
    expect(a.privateKey.length).toBe(32);
    expect(hex(a.publicKey)).not.toBe(hex(b.publicKey));
  });
});
