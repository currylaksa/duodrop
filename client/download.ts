/** Trigger a browser download of received bytes (phase 3). */
import type { FileMeta } from '../shared/src/transfer/transfer';

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download from the received chunk list. Building the Blob straight from the array avoids
 * concatenating into one typed array — which caps at ~2 GiB (2³¹−1) and throws RangeError on
 * a larger file — and lets the browser spill a big Blob to disk instead of holding it in RAM.
 */
export function downloadChunks(meta: FileMeta, chunks: Uint8Array[]): void {
  const blob = new Blob(chunks as BlobPart[], { type: meta.type || 'application/octet-stream' });
  triggerDownload(blob, meta.name);
}

export function downloadBytes(meta: FileMeta, bytes: Uint8Array): void {
  downloadChunks(meta, [bytes]);
}
