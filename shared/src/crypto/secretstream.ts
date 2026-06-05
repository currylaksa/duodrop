/**
 * Application-layer encryption (phase 4). A Transfer is a libsodium `crypto_secretstream`
 * (XChaCha20-Poly1305): one keyed stream per file, where each chunk is encrypted in order
 * and the final chunk carries the FINAL tag. The key is the device-only Pairing key (ADR
 * 0001), so a compromised relay or TURN sees only ciphertext. Call `ready()` once before use.
 */

import sodium from 'libsodium-wrappers';

export async function ready(): Promise<void> {
  await sodium.ready;
}

export interface Encryptor {
  /** The stream header the receiver needs to start decrypting; send it first. */
  readonly header: Uint8Array;
  encrypt(plaintext: Uint8Array, final: boolean): Uint8Array;
}

export interface Decryptor {
  decrypt(ciphertext: Uint8Array): { message: Uint8Array; final: boolean };
}

export function createEncryptor(key: Uint8Array): Encryptor {
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  return {
    header,
    encrypt: (plaintext, final) =>
      sodium.crypto_secretstream_xchacha20poly1305_push(
        state,
        plaintext,
        null,
        final
          ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
          : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
      ),
  };
}

export function createDecryptor(key: Uint8Array, header: Uint8Array): Decryptor {
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key);
  return {
    decrypt: (ciphertext) => {
      const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, ciphertext, null);
      if (!result) throw new Error('decryption failed: ciphertext rejected');
      return {
        message: result.message,
        final: result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
      };
    },
  };
}
