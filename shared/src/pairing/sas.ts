/**
 * Short Authentication String (SAS) pairing — the laptop ↔ laptop short-code path
 * (ADR 0003). The two peers rendezvous on a non-secret room number, exchange ephemeral
 * X25519 public keys through the relay, and each derives the SAME 32-byte session key and
 * the SAME emoji safety string. The humans compare the safety string on both screens and
 * confirm a match: an active relay that MITMs the key exchange must substitute its own
 * public key to each side, which makes the two safety strings diverge. The session key
 * never reaches the server, preserving ADR 0001's core invariant.
 */

import sodium from 'libsodium-wrappers';

/** Resolve once before calling anything else here (libsodium WASM init). */
export async function ready(): Promise<void> {
  await sodium.ready;
}

export interface EphemeralKeyPair {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

/** A fresh per-pairing X25519 keypair; the public key is sent to the peer via the relay. */
export function generateEphemeralKeyPair(): EphemeralKeyPair {
  return sodium.crypto_kx_keypair();
}

export interface PairedSession {
  /** 32-byte symmetric key for the Transfer's secretstream. Never sent to the server. */
  readonly sessionKey: Uint8Array;
  /** Emoji safety string shown on both screens for the human match check. */
  readonly safetyString: string[];
}

/** Number of emoji in the safety string. 4 emoji over a 64-symbol set ≈ 24 bits. */
export const SAFETY_STRING_LENGTH = 4;

/** 64 visually distinct emoji; each safety-hash byte selects one (byte mod 64 is uniform). */
export const SAFETY_ALPHABET: readonly string[] = [
  '🐶', '🐱', '🐭', '🐹', '🦊', '🐻', '🐼', '🐨',
  '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧',
  '🦉', '🦄', '🐝', '🦋', '🐢', '🐬', '🐳', '🦀',
  '🐙', '🦑', '🦐', '🐌', '🐞', '🦗', '🐜', '🦂',
  '🍎', '🍌', '🍓', '🍒', '🍑', '🍉', '🍕', '🍔',
  '🍟', '🌮', '🍩', '🍪', '🧀', '🍿', '🌽', '🥕',
  '⚽', '🏀', '🎷', '🎸', '🎺', '🚀', '🛸', '🎈',
  '🎁', '🔔', '🔑', '🎯', '🌵', '🌻', '🌈', '🔥',
];

const encoder = new TextEncoder();

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

// Canonical, role-independent ordering of the two public keys so both peers hash the same
// transcript regardless of who initiated the pairing.
const ordered = (a: Uint8Array, b: Uint8Array): [Uint8Array, Uint8Array] => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]! ? [a, b] : [b, a];
  }
  return [a, b];
};

const toSafetyString = (hash: Uint8Array): string[] => {
  const emoji: string[] = [];
  for (let i = 0; i < SAFETY_STRING_LENGTH; i++) {
    emoji.push(SAFETY_ALPHABET[hash[i]! % SAFETY_ALPHABET.length]!);
  }
  return emoji;
};

/**
 * Derive the shared session key and safety string from our keypair and the peer's public
 * key. Both peers call this with their own/peer keys swapped and get identical results.
 */
export function deriveSession(ours: EphemeralKeyPair, peerPublicKey: Uint8Array): PairedSession {
  const shared = sodium.crypto_scalarmult(ours.privateKey, peerPublicKey);
  const [first, second] = ordered(ours.publicKey, peerPublicKey);
  const transcript = concat(shared, first, second);

  const sessionKey = sodium.crypto_generichash(
    32,
    concat(encoder.encode('duodrop:sas:session'), transcript),
    null,
  );
  const safetyHash = sodium.crypto_generichash(
    32,
    concat(encoder.encode('duodrop:sas:display'), transcript),
    null,
  );

  return { sessionKey, safetyString: toSafetyString(safetyHash) };
}
