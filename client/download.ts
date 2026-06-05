/** Trigger a browser download of received bytes (phase 3). */
import type { FileMeta } from '../shared/src/transfer/transfer';

export function downloadBytes(meta: FileMeta, bytes: Uint8Array): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: meta.type || 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = meta.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
