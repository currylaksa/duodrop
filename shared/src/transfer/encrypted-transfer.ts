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

/**
 * Encrypt a Blob/File as a secretstream and pump it over the channel with backpressure. Each
 * `chunkSize` slice is read from disk on demand via `Blob.slice()`, so even a multi-GB file
 * never loads into memory and never hits the ~2 GiB typed-array cap — the send-side counterpart
 * to the receiver's streaming-to-disk sink.
 */
export async function sendEncryptedBlob(
  channel: SendChannel,
  encryptor: Encryptor,
  meta: FileMeta,
  blob: Blob,
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

  if (blob.size === 0) {
    await send(encryptor.encrypt(EMPTY, true));
    return;
  }
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, blob.size);
    const chunk = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    await send(encryptor.encrypt(chunk, end >= blob.size));
    opts.onProgress?.(end, blob.size);
  }
}

/** In-memory convenience wrapper (used by tests); streams the bytes through `sendEncryptedBlob`. */
export function sendEncryptedFile(
  channel: SendChannel,
  encryptor: Encryptor,
  meta: FileMeta,
  data: Uint8Array,
  opts: SendEncryptedOptions = {},
): Promise<void> {
  return sendEncryptedBlob(channel, encryptor, meta, new Blob([data as BlobPart]), opts);
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
      if (final) {
        this.handlers.onComplete?.(this.meta, new Uint8Array(0));
        this.reset();
      }
      return;
    }
    this.received += plain.length;
    this.handlers.onProgress?.(this.received, this.meta.size);
    if (this.handlers.onChunk) {
      // Streaming sink (phase 3): forward each chunk; never buffer the whole file.
      this.handlers.onChunk(plain);
      if (final) {
        this.handlers.onComplete?.(this.meta, EMPTY);
        this.reset();
      }
      return;
    }
    this.chunks.push(plain);
    if (final) {
      this.handlers.onComplete?.(this.meta, concat(this.chunks));
      this.reset();
    }
  }

  // A queue sends each file as its own secretstream (own header). Clear per-file state on the
  // FINAL frame so the next file's header starts a fresh decryptor instead of being decrypted
  // as a chunk (which throws "ciphertext rejected").
  private reset(): void {
    this.decryptor = undefined;
    this.meta = undefined;
    this.chunks = [];
    this.received = 0;
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
