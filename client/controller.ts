/**
 * Client orchestration (phases 3–4). Ties the pairing session to the encrypted transfer so
 * React only deals with state. One instance per pairing: it starts the handshake, and once
 * the data channel opens, wires sending (encrypt + backpressure + progress) and receiving
 * (decrypt + reassemble + download). Every byte on the wire is XChaCha20-Poly1305 ciphertext.
 */

import { deriveRoutingId, derivePairingKey } from '../shared/src/pairing';
import { PairingSession } from '../shared/src/signaling/session';
import { ready, createEncryptor } from '../shared/src/crypto/secretstream';
import { sendEncryptedFile, EncryptedReceiver } from '../shared/src/transfer/encrypted-transfer';
import type { FileMeta } from '../shared/src/transfer/transfer';
import { createRtcConnection, type TransferChannel } from './peer-connection';
import { createSignalLink } from './signal-socket';
import { fetchIceServers } from './ice';
import { signalWsUrl } from './config';
import { createReceiveSink, type ReceiveSink, BLOB_FALLBACK_CAP } from './receive-sink';

export type Direction = 'send' | 'receive';
export type ItemStatus = 'active' | 'done';

export interface TransferItem {
  id: string;
  name: string;
  size: number;
  direction: Direction;
  transferred: number;
  status: ItemStatus;
}

export interface ControllerHandlers {
  onConnected(): void;
  onItemAdd(item: TransferItem): void;
  onItemProgress(id: string, transferred: number): void;
  onItemDone(id: string): void;
  onWarn?(message: string): void;
}

let counter = 0;
const uid = (): string => `t${++counter}`;

export class DuoDropController {
  private transfer: TransferChannel | undefined;
  private key: Uint8Array | undefined;

  constructor(
    private readonly secret: Uint8Array,
    private readonly handlers: ControllerHandlers,
  ) {}

  async start(): Promise<void> {
    await ready();
    this.key = await derivePairingKey(this.secret);
    const routingId = await deriveRoutingId(this.secret);
    const iceServers = await fetchIceServers();
    const connection = createRtcConnection(iceServers);
    this.transfer = connection.transfer;
    const session = new PairingSession(routingId, connection, createSignalLink(signalWsUrl()), {
      onConnected: () => this.onConnected(),
    });
    session.start();
  }

  private onConnected(): void {
    const transfer = this.transfer!;
    let receiveId = '';
    // The sink (disk stream or in-memory blob) is opened when the file starts; chunks arrive
    // synchronously but write asynchronously, so a promise chain keeps writes ordered and the
    // close after the last write.
    let sinkReady: Promise<ReceiveSink> | null = null;
    let writeChain: Promise<void> = Promise.resolve();
    const receiver = new EncryptedReceiver(this.key!, {
      onStart: (meta) => {
        receiveId = uid();
        this.handlers.onItemAdd({
          id: receiveId,
          name: meta.name,
          size: meta.size,
          direction: 'receive',
          transferred: 0,
          status: 'active',
        });
        sinkReady = createReceiveSink(meta).then((sink) => {
          if (sink.mode === 'blob' && meta.size > BLOB_FALLBACK_CAP) {
            this.handlers.onWarn?.(
              `Large file — this browser saves it in memory, which may strain the tab.`,
            );
          }
          return sink;
        });
      },
      onProgress: (received) => this.handlers.onItemProgress(receiveId, received),
      onChunk: (plain) => {
        const ready = sinkReady!;
        writeChain = writeChain.then(() => ready).then((sink) => sink.write(plain));
      },
      onComplete: () => {
        const id = receiveId;
        const ready = sinkReady!;
        writeChain = writeChain
          .then(() => ready)
          .then((sink) => sink.close())
          .then(() => this.handlers.onItemDone(id));
      },
    });
    // The session's "hello" rides the same channel as a string; the receiver ignores it.
    transfer.onMessage((message) => receiver.accept(message));
    this.handlers.onConnected();
  }

  async sendFiles(files: File[]): Promise<void> {
    const transfer = this.transfer;
    const key = this.key;
    if (!transfer || !key) return;
    for (const file of files) {
      const id = uid();
      this.handlers.onItemAdd({
        id,
        name: file.name,
        size: file.size,
        direction: 'send',
        transferred: 0,
        status: 'active',
      });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const meta: FileMeta = { name: file.name, size: file.size, type: file.type };
      // A fresh encryptor per file: each Transfer is its own one-directional stream.
      await sendEncryptedFile(transfer, createEncryptor(key), meta, bytes, {
        onProgress: (sent) => this.handlers.onItemProgress(id, sent),
      });
      this.handlers.onItemDone(id);
    }
  }
}
