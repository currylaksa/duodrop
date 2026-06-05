import { describe, it, expect } from 'vitest';
import { frameTransfer, TransferReceiver, type FileMeta } from './transfer';

describe('plain transfer (phase 2): frame a file into a stream and reassemble it', () => {
  it('round-trips a multi-chunk file: framed then received yields identical bytes and metadata', () => {
    const data = new Uint8Array(50).map((_, i) => i);
    const meta: FileMeta = { name: 'a.bin', size: 50, type: 'application/octet-stream' };

    let result: { meta: FileMeta; bytes: Uint8Array } | undefined;
    const rx = new TransferReceiver({
      onComplete: (m, bytes) => {
        result = { meta: m, bytes };
      },
    });

    for (const message of frameTransfer(meta, data, 16)) rx.accept(message);

    expect(result?.meta).toEqual(meta);
    expect([...(result?.bytes ?? [])]).toEqual([...data]);
  });

  it('round-trips an empty file: meta and eof with no chunks yield zero bytes', () => {
    const meta: FileMeta = { name: 'empty.txt', size: 0, type: 'text/plain' };

    let result: { meta: FileMeta; bytes: Uint8Array } | undefined;
    const rx = new TransferReceiver({
      onComplete: (m, bytes) => {
        result = { meta: m, bytes };
      },
    });

    for (const message of frameTransfer(meta, new Uint8Array(0), 16)) rx.accept(message);

    expect(result?.meta).toEqual(meta);
    expect(result?.bytes.length).toBe(0);
  });

  it('announces the file metadata when the transfer starts, before any chunk', () => {
    const data = new Uint8Array(20);
    const meta: FileMeta = { name: 'a.bin', size: 20, type: 'application/octet-stream' };

    const events: string[] = [];
    const rx = new TransferReceiver({
      onStart: (m) => events.push(`start:${m.name}:${m.size}`),
      onProgress: () => events.push('progress'),
    });

    for (const message of frameTransfer(meta, data, 16)) rx.accept(message);

    // start fires once, before the first progress event.
    expect(events[0]).toBe('start:a.bin:20');
    expect(events.indexOf('start:a.bin:20')).toBeLessThan(events.indexOf('progress'));
  });

  it('reports cumulative progress as chunks arrive, ending at the full size', () => {
    const data = new Uint8Array(50);
    const meta: FileMeta = { name: 'a.bin', size: 50, type: 'application/octet-stream' };

    const progress: Array<{ received: number; total: number }> = [];
    const rx = new TransferReceiver({
      onProgress: (received, total) => progress.push({ received, total }),
    });

    for (const message of frameTransfer(meta, data, 16)) rx.accept(message);

    // 50 bytes in 16-byte chunks → 16, 32, 48, 50 received against a total of 50.
    expect(progress).toEqual([
      { received: 16, total: 50 },
      { received: 32, total: 50 },
      { received: 48, total: 50 },
      { received: 50, total: 50 },
    ]);
  });
});
