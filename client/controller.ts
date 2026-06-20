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
import { SpeedSampler } from './speed';

export type Direction = 'send' | 'receive';
export type ItemStatus = 'active' | 'done' | 'error';

export interface TransferItem {
  id: string;
  name: string;
  size: number;
  direction: Direction;
  transferred: number;
  status: ItemStatus;
  speed: number;
  error?: string;
}

export interface ControllerHandlers {
  onConnected(): void;
  onItemAdd(item: TransferItem): void;
  onItemProgress(id: string, transferred: number, speed: number): void;
  onItemDone(id: string): void;
  onItemError(id: string, message: string): void;
  onWarn?(message: string): void;
  onClosed?(message: string): void;
  /** SAS path: the server allocated a short room code for the creator to read out. */
  onRoomCreated?(code: string): void;
  /** SAS path: the emoji safety string the humans compare before any bytes flow. */
  onSafetyString?(safetyString: string[]): void;
}

/**
 * How this peer pairs. The QR/long-link path carries a Pairing secret (key derived locally);
 * the SAS short-code path (ADR 0003) derives the key from an in-band pubkey exchange instead.
 */
export type ControllerConfig =
  | { mode: 'secret'; secret: Uint8Array }
  | { mode: 'sas'; create: true }
  | { mode: 'sas'; create: false; code: string };

let counter = 0;
const uid = (): string => `t${++counter}`;

const CLOSED_MESSAGE: Record<'expired' | 'peer-left' | 'rejected', string> = {
  expired: 'Channel expired — the other device didn’t join in time. Create a new channel.',
  'peer-left': 'The other device disconnected.',
  rejected: 'That channel already has two devices.',
};

export class DuoDropController {
  private transfer: TransferChannel | undefined;
  private key: Uint8Array | undefined;
  private channelOpen = false;
  private wired = false;

  constructor(
    private readonly config: ControllerConfig,
    private readonly handlers: ControllerHandlers,
  ) {}

  async start(): Promise<void> {
    await ready();
    // For the SAS path the key is derived later (from the in-band pubkey exchange); for the
    // secret path it's known up front and the routing id comes from the same secret.
    let routingId = '';
    if (this.config.mode === 'secret') {
      this.key = await derivePairingKey(this.config.secret);
      routingId = await deriveRoutingId(this.config.secret);
    } else if (!this.config.create) {
      routingId = this.config.code; // the typed short code is the routing id
    }
    const sas = this.config.mode === 'sas';
    const iceServers = await fetchIceServers();
    const connection = createRtcConnection(iceServers);
    this.transfer = connection.transfer;
    const session = new PairingSession(
      routingId,
      connection,
      createSignalLink(signalWsUrl()),
      {
        onConnected: () => this.onChannelOpen(),
        onClosed: (reason) => this.handlers.onClosed?.(CLOSED_MESSAGE[reason]),
        onRoomCreated: (code) => this.handlers.onRoomCreated?.(code),
        onSafetyString: (safetyString, sessionKey) => {
          this.key = sessionKey;
          this.handlers.onSafetyString?.(safetyString);
          this.wireReceiver();
        },
      },
      { sas, create: sas && this.config.create },
    );
    session.start();
  }

  /**
   * The data channel opened. Wire the receiver (it needs the key, which on the SAS path may
   * not exist yet) and tell the UI we're connected.
   */
  private onChannelOpen(): void {
    this.channelOpen = true;
    this.wireReceiver();
    this.handlers.onConnected();
  }

  /** Build the receiving pipeline exactly once, when both the channel and the key are ready. */
  private wireReceiver(): void {
    if (this.wired || !this.channelOpen || !this.key) return;
    this.wired = true;
    const transfer = this.transfer!;
    let receiveId = '';
    let speed = new SpeedSampler();
    // The sink (disk stream or in-memory blob) is opened when the file starts; chunks arrive
    // synchronously but write asynchronously, so a promise chain keeps writes ordered and the
    // close after the last write.
    let sinkReady: Promise<ReceiveSink> | null = null;
    let writeChain: Promise<void> = Promise.resolve();
    const receiver = new EncryptedReceiver(this.key!, {
      onStart: (meta) => {
        receiveId = uid();
        speed = new SpeedSampler();
        this.handlers.onItemAdd({
          id: receiveId,
          name: meta.name,
          size: meta.size,
          direction: 'receive',
          transferred: 0,
          status: 'active',
          speed: 0,
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
      onProgress: (received) =>
        this.handlers.onItemProgress(receiveId, received, speed.sample(performance.now(), received)),
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
    // A decrypt/parse failure means a corrupt or tampered stream — surface it on the
    // in-flight item rather than letting the rejection go unhandled.
    transfer.onMessage((message) => {
      try {
        receiver.accept(message);
      } catch {
        if (receiveId) this.handlers.onItemError(receiveId, 'Transfer failed — stream could not be decrypted');
      }
    });
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
        speed: 0,
      });
      const speed = new SpeedSampler();
      const meta: FileMeta = { name: file.name, size: file.size, type: file.type };
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // A fresh encryptor per file: each Transfer is its own one-directional stream.
        await sendEncryptedFile(transfer, createEncryptor(key), meta, bytes, {
          onProgress: (sent) =>
            this.handlers.onItemProgress(id, sent, speed.sample(performance.now(), sent)),
        });
        this.handlers.onItemDone(id);
      } catch (err) {
        // A send failure means the channel is down; stop the queue rather than hammering it.
        this.handlers.onItemError(id, err instanceof Error ? err.message : 'Transfer failed');
        break;
      }
    }
  }
}
