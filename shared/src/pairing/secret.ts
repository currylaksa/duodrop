/** Generate a fresh 128-bit Pairing secret (ADR 0001). */
export function generatePairingSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}
