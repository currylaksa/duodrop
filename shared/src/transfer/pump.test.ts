import { describe, it, expect } from 'vitest';
import { pumpTransfer, sendFile, type SendChannel } from './pump';
import { TransferReceiver, type TransferMessage, type FileMeta } from './transfer';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('backpressure pump (phase 2): never outruns the data channel buffer', () => {
  it('sends every message in order when the buffer stays under the high-water mark', async () => {
    const sent: TransferMessage[] = [];
    const channel: SendChannel = {
      send: (m) => sent.push(m),
      bufferedAmount: 0,
      setDrainHandler: () => {},
    };

    await pumpTransfer(channel, ['meta', new Uint8Array([1, 2]), 'eof'], 50);

    expect(sent).toEqual(['meta', new Uint8Array([1, 2]), 'eof']);
  });

  it('parks when the buffer is over the high-water mark and resumes once it drains', async () => {
    const sent: TransferMessage[] = [];
    let buffered = 100; // already congested, above the 50-byte mark
    let drain = () => {};
    const channel: SendChannel = {
      send: (m) => sent.push(m),
      get bufferedAmount() {
        return buffered;
      },
      setDrainHandler: (handler) => {
        drain = handler;
      },
    };

    const done = pumpTransfer(channel, ['a', 'b'], 50);
    await flush();
    // Congested: the pump sends nothing and waits for the channel to drain.
    expect(sent).toEqual([]);

    buffered = 0;
    drain(); // channel signals it drained
    await done;
    expect(sent).toEqual(['a', 'b']);
  });

  it('sends a whole file end to end through one channel into a receiver', async () => {
    const data = new Uint8Array(1000).map((_, i) => i);
    const meta: FileMeta = { name: 'x.bin', size: 1000, type: 'application/octet-stream' };

    let result: { meta: FileMeta; bytes: Uint8Array } | undefined;
    const rx = new TransferReceiver({
      onComplete: (m, bytes) => {
        result = { meta: m, bytes };
      },
    });
    // The send side feeds frames straight into the receive side.
    const channel: SendChannel = {
      send: (m) => rx.accept(m),
      bufferedAmount: 0,
      setDrainHandler: () => {},
    };

    await sendFile(channel, meta, data, { chunkSize: 256 });

    expect(result?.meta).toEqual(meta);
    expect([...(result?.bytes ?? [])]).toEqual([...data]);
  });
});
