/**
 * Receive sink (phase 3 + big-file streaming). Where the File System Access API exists (desktop
 * Chromium) we stream each chunk straight to disk — effectively no size limit and no RAM
 * buffering. But `showSaveFilePicker()` needs a user gesture, while chunks arrive on a network
 * event (no gesture), so the stream sink starts by buffering and exposes `promptSave()` for a
 * Save button to call from a real click: it opens the picker, flushes what buffered so far, then
 * streams the rest straight to disk. Where the API is absent (Firefox, iOS Safari) — or the user
 * never picks a location — it degrades to the in-memory Blob download from issue 002, with a
 * documented cap the caller warns past.
 */
import type { FileMeta } from '../shared/src/transfer/transfer';
import { downloadChunks } from './download';

export type SinkMode = 'stream' | 'blob';

export interface ReceiveSink {
  readonly mode: SinkMode;
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Stream mode only: open the OS save dialog (must be called from a user gesture) and stream
   * to disk, flushing whatever buffered before the click. No-op once a save is under way. */
  promptSave?(): Promise<void>;
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

function createStreamSink(meta: FileMeta): ReceiveSink {
  const picker = (globalThis as unknown as { showSaveFilePicker: SaveFilePicker }).showSaveFilePicker;
  let writable: WritableLike | null = null;
  let buffer: Uint8Array[] = [];
  let saving = false; // a picker call is in flight or has succeeded
  let closed = false;

  // Writes arrive on the network; promptSave fires on a UI click; close ends the stream. Run
  // them through one chain so the buffer flush never interleaves with a write or the close.
  let tail: Promise<void> = Promise.resolve();
  const serial = (fn: () => Promise<void>): Promise<void> => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };

  const blobFallback = (): void => {
    downloadChunks(meta, buffer);
    buffer = [];
  };

  return {
    mode: 'stream',
    write: (chunk) =>
      serial(async () => {
        if (writable) await writable.write(chunk);
        else buffer.push(chunk);
      }),
    promptSave: async () => {
      if (saving) return;
      saving = true;
      let w: WritableLike;
      try {
        // picker() must be the first call (before any await) to keep the click's activation.
        const handle = await picker({ suggestedName: meta.name });
        w = await handle.createWritable();
      } catch {
        saving = false; // cancelled — keep buffering; close() falls back to the blob download
        if (closed) await serial(async () => blobFallback());
        return;
      }
      await serial(async () => {
        writable = w;
        const pending = buffer;
        buffer = [];
        for (const c of pending) await w.write(c);
        if (closed) await w.close(); // the file finished arriving before the user picked
      });
    },
    close: () =>
      serial(async () => {
        closed = true;
        if (writable) await writable.close();
        else if (!saving) blobFallback();
        // else: a picker is in flight — its flush sees `closed` and closes the writable.
      }),
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
      downloadChunks(meta, chunks);
      return Promise.resolve();
    },
  };
}

/** Pick the streaming sink where supported, falling back to the in-memory Blob otherwise. */
export function createReceiveSink(meta: FileMeta): ReceiveSink {
  return canStreamToDisk() ? createStreamSink(meta) : createBlobSink(meta);
}
