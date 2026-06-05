/**
 * Real RTCPeerConnection adapter (issues 001 + phase 3). Implements the RtcConnection the
 * PairingSession drives, and additionally exposes the live data channel as a TransferChannel
 * for file transfer. One physical data channel is multiplexed: the session's "hello" and the
 * transfer frames share it, so listeners receive every message and route by shape.
 */

import type {
  RtcConnection,
  SessionDescription,
  IceCandidate,
} from '../shared/src/signaling/session';
import type { SendChannel } from '../shared/src/transfer/pump';
import type { TransferMessage } from '../shared/src/transfer/transfer';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Resume sending once the buffer falls below 256 KiB (paired with the pump's high mark). */
const LOW_WATER_MARK = 256 * 1024;

/** The data channel as the transfer layer needs it: send + backpressure + raw messages. */
export interface TransferChannel extends SendChannel {
  onMessage(handler: (message: TransferMessage) => void): void;
}

export type Connection = RtcConnection & { transfer: TransferChannel };

export function createRtcConnection(iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS): Connection {
  const pc = new RTCPeerConnection({ iceServers });
  let channel: RTCDataChannel | undefined;
  let onConnected = () => {};
  let drainHandler = () => {};
  const messageListeners: Array<(message: TransferMessage) => void> = [];

  const wire = (ch: RTCDataChannel) => {
    channel = ch;
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = LOW_WATER_MARK;
    ch.onopen = () => onConnected();
    ch.onbufferedamountlow = () => drainHandler();
    ch.onmessage = (event) => {
      const message: TransferMessage =
        typeof event.data === 'string'
          ? event.data
          : new Uint8Array(event.data as ArrayBuffer);
      for (const listener of messageListeners) listener(message);
    };
  };
  pc.ondatachannel = (event) => wire(event.channel);

  return {
    createOffer: async () => {
      wire(pc.createDataChannel('duodrop'));
      const offer = await pc.createOffer();
      return { type: 'offer', sdp: offer.sdp ?? '' };
    },
    createAnswer: async () => {
      const answer = await pc.createAnswer();
      return { type: 'answer', sdp: answer.sdp ?? '' };
    },
    setLocalDescription: async (description: SessionDescription) => {
      await pc.setLocalDescription(description);
    },
    setRemoteDescription: async (description: SessionDescription) => {
      await pc.setRemoteDescription(description);
    },
    addIceCandidate: async (candidate: IceCandidate) => {
      await pc.addIceCandidate(candidate as RTCIceCandidateInit);
    },
    onIceCandidate: (handler) => {
      pc.onicecandidate = (event) => {
        if (event.candidate) handler(event.candidate.toJSON() as unknown as IceCandidate);
      };
    },
    onConnected: (handler) => {
      onConnected = handler;
    },
    sendMessage: (text) => channel?.send(text),
    onMessage: (handler) => {
      // The session only cares about string control messages (the "hello").
      messageListeners.push((message) => {
        if (typeof message === 'string') handler(message);
      });
    },
    transfer: {
      send: (message) => {
        // Split by type so each call matches an RTCDataChannel.send overload (string vs binary).
        if (typeof message === 'string') channel?.send(message);
        else channel?.send(message as Uint8Array<ArrayBuffer>);
      },
      get bufferedAmount() {
        return channel?.bufferedAmount ?? 0;
      },
      setDrainHandler: (handler) => {
        drainHandler = handler;
      },
      onMessage: (handler) => {
        messageListeners.push(handler);
      },
    },
  };
}
