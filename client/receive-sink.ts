/**
 * Receive sink (phase 3). Resolves the brief's Blob-vs-stream contradiction with an honest,
 * per-browser ceiling: where the File System Access API exists (Chromium/desktop) we stream
 * each chunk straight to disk via `showSaveFilePicker()` — effectively no size limit; where it
 * doesn't (Firefox, iOS Safari) we fall back to the in-memory Blob path from issue 002, with a
 * documented cap the caller warns past. The mode is chosen at runtime per file.
 */
import type { FileMeta } from '../shared/src/transfer/transfer';
import { downloadBytes } from './download';

export type SinkMode = 'stream' | 'blob';

export interface ReceiveSink {
  readonly mode: SinkMode;
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** Above this size the in-memory fallback risks crashing the tab; the caller warns past it. */
export const BLOB_FALLBACK_CAP = 1024 * 1024 * 1024; // 1 GiB

// Minimal shape of the File System Access API surface we use (not in TS's stock DOM lib).
interface WritableLike {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
interface FileHandleLike {
  createWritable(): Promise<WritableLike>;
}
type SaveFilePicker = (opts: { suggestedName?: string }) => Promise<FileHandleLike>;

export function canStreamToDisk(): boolean {
  return typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

async function createStreamSink(meta: FileMeta): Promise<ReceiveSink> {
  const picker = (globalThis as unknown as { showSaveFilePicker: SaveFilePicker }).showSaveFilePicker;
  const handle = await picker({ suggestedName: meta.name });
  const writable = await handle.createWritable();
  return {
    mode: 'stream',
    write: (chunk) => writable.write(chunk),
    close: () => writable.close(),
  };
}

function createBlobSink(meta: FileMeta): ReceiveSink {
  const chunks: Uint8Array[] = [];
  return {
    mode: 'blob',
    write: (chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    },
    close: () => {
      downloadBytes(meta, concat(chunks));
      return Promise.resolve();
    },
  };
}

/** Pick the streaming sink where supported, falling back to the in-memory Blob otherwise. */
export async function createReceiveSink(meta: FileMeta): Promise<ReceiveSink> {
  if (canStreamToDisk()) {
    try {
      return await createStreamSink(meta);
    } catch {
      // Picker cancelled or unavailable at runtime — degrade to the in-memory path.
    }
  }
  return createBlobSink(meta);
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
