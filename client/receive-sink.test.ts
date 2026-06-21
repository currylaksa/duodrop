import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FileMeta } from '../shared/src/transfer/transfer';

const downloaded: { meta: FileMeta; chunks: Uint8Array[] }[] = [];
vi.mock('./download', () => ({
  downloadChunks: (meta: FileMeta, chunks: Uint8Array[]) => downloaded.push({ meta, chunks }),
}));

import { createReceiveSink, canStreamToDisk } from './receive-sink';

const meta: FileMeta = { name: 'big.bin', size: 6, type: 'application/octet-stream' };

// A fake File System Access writable that records what it received, optionally never resolving
// the picker (cancelled) by throwing.
function installPicker(opts: { cancel?: boolean } = {}) {
  const writes: number[][] = [];
  let closed = false;
  (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => {
    if (opts.cancel) throw new Error('AbortError: user cancelled');
    return {
      createWritable: async () => ({
        write: async (c: Uint8Array) => {
          writes.push([...c]);
        },
        close: async () => {
          closed = true;
        },
      }),
    };
  };
  return { writes, isClosed: () => closed };
}

afterEach(() => {
  downloaded.length = 0;
  delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
});

describe('receive sink: stream to disk on a gesture, blob fallback otherwise', () => {
  it('falls back to an in-memory blob download when the File System Access API is absent', async () => {
    expect(canStreamToDisk()).toBe(false);

    const sink = createReceiveSink(meta);
    expect(sink.mode).toBe('blob');
    expect(sink.promptSave).toBeUndefined();
    await sink.write(new Uint8Array([1, 2, 3]));
    await sink.write(new Uint8Array([4, 5, 6]));
    await sink.close();

    expect(downloaded).toHaveLength(1);
    // Handed off as the chunk list — never concatenated into one (>2 GiB-capped) typed array.
    expect(downloaded[0]!.chunks.map((c) => [...c])).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it('buffers until promptSave, then flushes buffered chunks and streams the rest to disk', async () => {
    const fake = installPicker();
    expect(canStreamToDisk()).toBe(true);

    const sink = createReceiveSink(meta);
    expect(sink.mode).toBe('stream');

    await sink.write(new Uint8Array([1, 2, 3])); // arrives before the click → buffered
    await sink.promptSave!(); // user clicks Save → picker opens, buffer flushes
    await sink.write(new Uint8Array([4, 5, 6])); // arrives after → straight to disk
    await sink.close();

    expect(fake.writes).toEqual([[1, 2, 3], [4, 5, 6]]); // in order, none lost
    expect(fake.isClosed()).toBe(true);
    expect(downloaded).toHaveLength(0); // disk-streamed, never held as a blob
  });

  it('degrades to the blob download when the user cancels the save picker', async () => {
    installPicker({ cancel: true });
    const sink = createReceiveSink(meta);

    await sink.write(new Uint8Array([1, 2, 3]));
    await sink.promptSave!(); // cancelled — keeps buffering
    await sink.write(new Uint8Array([4, 5, 6]));
    await sink.close();

    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]!.chunks.map((c) => [...c])).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it('degrades to the blob download when the user never picks a location', async () => {
    installPicker();
    const sink = createReceiveSink(meta);

    await sink.write(new Uint8Array([1, 2, 3]));
    await sink.write(new Uint8Array([4, 5, 6]));
    await sink.close(); // never clicked Save

    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]!.chunks.map((c) => [...c])).toEqual([[1, 2, 3], [4, 5, 6]]);
  });
});
