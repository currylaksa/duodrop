/**
 * Bridges a browser File to the tested transfer protocol (phase 3). Reads the file into
 * bytes and streams it over the data channel with backpressure. Receiving is just a
 * TransferReceiver whose onComplete triggers a download (see `download.ts`).
 */

import { sendFile, type SendChannel } from '../shared/src/transfer/pump';
import type { FileMeta } from '../shared/src/transfer/transfer';

export async function sendFileOverChannel(
  channel: SendChannel,
  file: File,
  opts: { chunkSize?: number; highWaterMark?: number } = {},
): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const meta: FileMeta = { name: file.name, size: file.size, type: file.type };
  await sendFile(channel, meta, bytes, opts);
}
