/**
 * Integration test for the phase-3 receive pipeline: a real encrypted file goes through
 * sendEncryptedFile → EncryptedReceiver (streaming onChunk) → the controller's ordered
 * async write-queue → a ReceiveSink. WebRTC itself can't run in node, so this exercises
 * everything from the secretstream down — the seam issue 003 changed — minus the transport.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { ready, createEncryptor } from '../shared/src/crypto/secretstream';
import { sendEncryptedFile, EncryptedReceiver } from '../shared/src/transfer/encrypted-transfer';
import type { SendChannel } from '../shared/src/transfer/pump';
import type { TransferMessage, FileMeta } from '../shared/src/transfer/transfer';
import type { ReceiveSink } from './receive-sink';

const KEY = new Uint8Array(32).fill(9);

const downloaded: { meta: FileMeta; bytes: Uint8Array }[] = [];
const join = (chunks: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
};
vi.mock('./download', () => ({
  downloadChunks: (meta: FileMeta, chunks: Uint8Array[]) =>
    downloaded.push({ meta, bytes: join(chunks) }),
}));

afterEach(() => {
  downloaded.length = 0;
});

// Mirrors the ordered write-queue in controller.ts onConnected(): chunks arrive synchronously
// but write asynchronously, so a promise chain keeps writes in order and closes after the last.
function wireReceive(sink: ReceiveSink) {
  let writeChain: Promise<void> = Promise.resolve();
  let closed: Promise<void> | null = null;
  const receiver = new EncryptedReceiver(KEY, {
    onChunk: (plain) => {
      writeChain = writeChain.then(() => sink.write(plain));
    },
    onComplete: () => {
      closed = writeChain.then(() => sink.close());
    },
  });
  return { receiver, settled: () => closed ?? writeChain };
}

describe('receive pipeline (phase 3): encrypted bytes stream to a sink, byte-identical', () => {
  beforeAll(async () => {
    await ready();
  });

  it('reassembles a multi-chunk file byte-identical through the real blob sink', async () => {
    const { createReceiveSink } = await import('./receive-sink');
    const data = new Uint8Array(50_000).map((_, i) => (i * 31 + 7) & 0xff);
    const meta: FileMeta = { name: 'photo.raw', size: data.length, type: 'application/octet-stream' };

    const sink = await createReceiveSink(meta); // blob mode in node (no FSA)
    expect(sink.mode).toBe('blob');
    const { receiver, settled } = wireReceive(sink);

    const channel: SendChannel = {
      send: (m: TransferMessage) => receiver.accept(m),
      bufferedAmount: 0,
      setDrainHandler: () => {},
    };
    await sendEncryptedFile(channel, createEncryptor(KEY), meta, data, { chunkSize: 16 * 1024 });
    await settled();

    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]!.bytes.length).toBe(data.length);
    expect([...downloaded[0]!.bytes]).toEqual([...data]); // byte-identical
  });

  it('keeps writes in order even when the sink resolves them out of order', async () => {
    const writes: number[] = [];
    let order = 0;
    // First write resolves slowest, last fastest — only a serialized queue preserves order.
    const slowSink: ReceiveSink = {
      mode: 'stream',
      write: (chunk) => {
        const callIndex = order++;
        const delay = 30 - callIndex * 5;
        return new Promise((resolve) =>
          setTimeout(() => {
            writes.push(chunk[0]!);
            resolve();
          }, Math.max(0, delay)),
        );
      },
      close: () => Promise.resolve(),
    };

    const data = new Uint8Array([0, 1, 2, 3, 4]); // each chunk's first byte tags its order
    const meta: FileMeta = { name: 'seq.bin', size: data.length, type: 'application/octet-stream' };
    const { receiver, settled } = wireReceive(slowSink);
    const channel: SendChannel = {
      send: (m: TransferMessage) => receiver.accept(m),
      bufferedAmount: 0,
      setDrainHandler: () => {},
    };
    await sendEncryptedFile(channel, createEncryptor(KEY), meta, data, { chunkSize: 1 });
    await settled();

    expect(writes).toEqual([0, 1, 2, 3, 4]); // serialized despite out-of-order resolution
  });
});
