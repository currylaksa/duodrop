import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FileMeta } from '../shared/src/transfer/transfer';

const downloaded: { meta: FileMeta; bytes: Uint8Array }[] = [];
vi.mock('./download', () => ({
  downloadBytes: (meta: FileMeta, bytes: Uint8Array) => downloaded.push({ meta, bytes }),
}));

import { createReceiveSink, canStreamToDisk } from './receive-sink';

const meta: FileMeta = { name: 'big.bin', size: 6, type: 'application/octet-stream' };

afterEach(() => {
  downloaded.length = 0;
  delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
});

describe('receive sink (phase 3): stream to disk where possible, blob fallback otherwise', () => {
  it('falls back to an in-memory blob download when the File System Access API is absent', async () => {
    expect(canStreamToDisk()).toBe(false);

    const sink = await createReceiveSink(meta);
    expect(sink.mode).toBe('blob');
    await sink.write(new Uint8Array([1, 2, 3]));
    await sink.write(new Uint8Array([4, 5, 6]));
    await sink.close();

    expect(downloaded).toHaveLength(1);
    expect([...downloaded[0]!.bytes]).toEqual([1, 2, 3, 4, 5, 6]); // byte-identical
  });

  it('streams each chunk straight to the writable, never buffering into a blob', async () => {
    const writes: number[][] = [];
    let closed = false;
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (c: Uint8Array) => {
          writes.push([...c]);
        },
        close: async () => {
          closed = true;
        },
      }),
    });

    expect(canStreamToDisk()).toBe(true);
    const sink = await createReceiveSink(meta);
    expect(sink.mode).toBe('stream');
    await sink.write(new Uint8Array([1, 2, 3]));
    await sink.write(new Uint8Array([4, 5, 6]));
    await sink.close();

    expect(writes).toEqual([[1, 2, 3], [4, 5, 6]]); // per-chunk, in order
    expect(closed).toBe(true);
    expect(downloaded).toHaveLength(0); // disk-streamed, never held in memory as a blob
  });

  it('falls back to the blob path when the user cancels the save picker', async () => {
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => {
      throw new Error('AbortError: user cancelled');
    };

    const sink = await createReceiveSink(meta);
    expect(sink.mode).toBe('blob');
  });
});
