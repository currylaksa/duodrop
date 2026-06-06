/**
 * Plain-transfer wire protocol (phase 2). A Transfer is one file framed as a one-directional
 * stream over the data channel: a JSON `meta` header, then ordered binary chunks, then a JSON
 * `eof` marker. String frames carry control JSON; binary frames carry file bytes — the same
 * shape an RTCDataChannel delivers (the receiver branches on `typeof message`). Encryption is
 * layered on later (phase 4) and is purely additive.
 */

export interface FileMeta {
  name: string;
  size: number;
  type: string;
}

/** A single data-channel frame: a control header/marker (string) or a file chunk (binary). */
export type TransferMessage = string | Uint8Array;

/** Frame a file into the stream of messages to send: meta header, chunks, eof marker. */
export function* frameTransfer(
  meta: FileMeta,
  data: Uint8Array,
  chunkSize: number,
): Iterable<TransferMessage> {
  yield JSON.stringify({ t: 'meta', ...meta });
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    yield data.subarray(offset, offset + chunkSize);
  }
  yield JSON.stringify({ t: 'eof' });
}

export interface TransferHandlers {
  onStart?: (meta: FileMeta) => void;
  onProgress?: (received: number, total: number) => void;
  /**
   * Streaming sink: called with each decrypted chunk as it arrives. When provided, the
   * receiver does not buffer the whole file in memory (phase 3) — it forwards chunks for the
   * consumer to write to disk. `onComplete` still fires to signal end-of-stream (with empty
   * bytes). When absent, the receiver buffers and `onComplete` carries the full file.
   */
  onChunk?: (plain: Uint8Array) => void;
  onComplete?: (meta: FileMeta, bytes: Uint8Array) => void;
}

/** Reassemble an incoming Transfer stream back into the original file bytes. */
export class TransferReceiver {
  private meta: FileMeta | undefined;
  private chunks: Uint8Array[] = [];
  private received = 0;

  constructor(private readonly handlers: TransferHandlers = {}) {}

  accept(message: TransferMessage): void {
    if (typeof message === 'string') {
      const frame = JSON.parse(message) as { t: string } & Partial<FileMeta>;
      if (frame.t === 'meta') {
        this.meta = { name: frame.name!, size: frame.size!, type: frame.type! };
        this.chunks = [];
        this.received = 0;
        this.handlers.onStart?.(this.meta);
      } else if (frame.t === 'eof') {
        this.handlers.onComplete?.(this.meta!, concat(this.chunks));
      }
    } else {
      this.chunks.push(message);
      this.received += message.length;
      this.handlers.onProgress?.(this.received, this.meta!.size);
    }
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
