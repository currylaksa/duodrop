/**
 * Encrypted Transfer (phase 4) — layered over the same data channel as the plaintext
 * protocol, but every frame is ciphertext. The wire is: the secretstream header, then the
 * encrypted metadata, then encrypted chunks with the last carrying the FINAL tag. The relay
 * sees only opaque binary; only a holder of the Pairing key can read the file (ADR 0001).
 */

import { createDecryptor, type Encryptor } from '../crypto/secretstream';
import type { SendChannel } from './pump';
import type { FileMeta, TransferMessage, TransferHandlers } from './transfer';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const EMPTY = new Uint8Array(0);

const DEFAULT_CHUNK_SIZE = 16 * 1024;
const DEFAULT_HIGH_WATER_MARK = 1024 * 1024;

export interface SendEncryptedOptions {
  chunkSize?: number;
  highWaterMark?: number;
  onProgress?: (sent: number, total: number) => void;
}

/** Encrypt a file as a secretstream and pump it over the channel with backpressure. */
export async function sendEncryptedFile(
  channel: SendChannel,
  encryptor: Encryptor,
  meta: FileMeta,
  data: Uint8Array,
  opts: SendEncryptedOptions = {},
): Promise<void> {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const highWaterMark = opts.highWaterMark ?? DEFAULT_HIGH_WATER_MARK;
  const send = async (frame: Uint8Array): Promise<void> => {
    if (channel.bufferedAmount > highWaterMark) {
      await new Promise<void>((resolve) => channel.setDrainHandler(resolve));
    }
    channel.send(frame);
  };

  await send(encryptor.header);
  await send(encryptor.encrypt(encoder.encode(JSON.stringify(meta)), false));

  if (data.length === 0) {
    await send(encryptor.encrypt(new Uint8Array(0), true));
    return;
  }
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, data.length);
    await send(encryptor.encrypt(data.subarray(offset, end), end >= data.length));
    opts.onProgress?.(end, data.length);
  }
}

/** Decrypt an incoming secretstream back into the original file bytes. */
export class EncryptedReceiver {
  private decryptor: ReturnType<typeof createDecryptor> | undefined;
  private meta: FileMeta | undefined;
  private chunks: Uint8Array[] = [];
  private received = 0;

  constructor(
    private readonly key: Uint8Array,
    private readonly handlers: TransferHandlers = {},
  ) {}

  accept(message: TransferMessage): void {
    if (typeof message === 'string') return; // every encrypted frame is binary
    if (!this.decryptor) {
      this.decryptor = createDecryptor(this.key, message); // first frame is the header
      return;
    }
    const { message: plain, final } = this.decryptor.decrypt(message);
    if (!this.meta) {
      this.meta = JSON.parse(decoder.decode(plain)) as FileMeta;
      this.handlers.onStart?.(this.meta);
      if (final) this.handlers.onComplete?.(this.meta, new Uint8Array(0));
      return;
    }
    this.received += plain.length;
    this.handlers.onProgress?.(this.received, this.meta.size);
    if (this.handlers.onChunk) {
      // Streaming sink (phase 3): forward each chunk; never buffer the whole file.
      this.handlers.onChunk(plain);
      if (final) this.handlers.onComplete?.(this.meta, EMPTY);
      return;
    }
    this.chunks.push(plain);
    if (final) this.handlers.onComplete?.(this.meta, concat(this.chunks));
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
