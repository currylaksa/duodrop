import { describe, it, expect } from 'vitest';
import { sendFileOverChannel } from './file-transfer';
import { TransferReceiver, type TransferMessage, type FileMeta } from '../shared/src/transfer/transfer';
import type { SendChannel } from '../shared/src/transfer/pump';

describe('file transfer bridge (phase 3): a File goes across and reassembles', () => {
  it('reads a File and reassembles identical bytes and metadata on the far side', async () => {
    const bytes = new Uint8Array(500).map((_, i) => i);
    const file = new File([bytes], 'photo.bin', { type: 'application/octet-stream' });

    let result: { meta: FileMeta; bytes: Uint8Array } | undefined;
    const rx = new TransferReceiver({
      onComplete: (meta, received) => {
        result = { meta, bytes: received };
      },
    });
    const channel: SendChannel = {
      send: (m: TransferMessage) => rx.accept(m),
      bufferedAmount: 0,
      setDrainHandler: () => {},
    };

    await sendFileOverChannel(channel, file, { chunkSize: 128 });

    expect(result?.meta).toEqual({ name: 'photo.bin', size: 500, type: 'application/octet-stream' });
    expect([...(result?.bytes ?? [])]).toEqual([...bytes]);
  });
});
