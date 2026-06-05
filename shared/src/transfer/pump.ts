/**
 * Backpressure pump (phase 2). Sends a framed Transfer over the data channel without
 * outrunning its send buffer: before each frame, if the channel is congested above the
 * high-water mark, it parks until the channel signals it has drained. Without this, a large
 * file floods the buffer and crashes the tab.
 */

import { frameTransfer, type TransferMessage, type FileMeta } from './transfer';

/** 16 KiB chunks stay well under the data-channel message limit (brief). */
const DEFAULT_CHUNK_SIZE = 16 * 1024;
/** Pause sending once ~1 MiB is buffered, so a big file never floods the send buffer. */
const DEFAULT_HIGH_WATER_MARK = 1024 * 1024;

/** The send-side data-channel surface the pump needs (real RTCDataChannel satisfies it). */
export interface SendChannel {
  send(message: TransferMessage): void;
  readonly bufferedAmount: number;
  /** Register a one-shot handler fired when the buffer drains below its low threshold. */
  setDrainHandler(handler: () => void): void;
}

/** Send every message in order, pausing whenever the buffer exceeds `highWaterMark` bytes. */
export async function pumpTransfer(
  channel: SendChannel,
  messages: Iterable<TransferMessage>,
  highWaterMark: number,
): Promise<void> {
  for (const message of messages) {
    if (channel.bufferedAmount > highWaterMark) {
      await new Promise<void>((resolve) => channel.setDrainHandler(resolve));
    }
    channel.send(message);
  }
}

/** Frame a file and pump it over the channel with backpressure. The one call a sender needs. */
export function sendFile(
  channel: SendChannel,
  meta: FileMeta,
  data: Uint8Array,
  opts: { chunkSize?: number; highWaterMark?: number } = {},
): Promise<void> {
  const messages = frameTransfer(meta, data, opts.chunkSize ?? DEFAULT_CHUNK_SIZE);
  return pumpTransfer(channel, messages, opts.highWaterMark ?? DEFAULT_HIGH_WATER_MARK);
}
