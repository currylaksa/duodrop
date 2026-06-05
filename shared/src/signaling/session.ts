/**
 * The client side of the signaling handshake (issue 001). A PairingSession drives one peer
 * through join → SDP offer/answer → ICE → data channel, talking the same wire protocol the
 * server relays. It depends only on two injected interfaces so the negotiation logic can be
 * tested without a real browser; the thin RTCPeerConnection/WebSocket wrappers live in the
 * client and satisfy these shapes.
 */

import type { ClientMessage } from './protocol';
import type { ServerMessage } from './rooms';

export type SessionDescription = { type: 'offer' | 'answer'; sdp: string };
export type IceCandidate = Record<string, unknown>;

/** The opaque payload the server relays inside a `signal`, exchanged peer-to-peer. */
export type SignalPayload =
  | { kind: 'description'; description: SessionDescription }
  | { kind: 'candidate'; candidate: IceCandidate };

/** The link to the signaling server. */
export interface SignalLink {
  send(message: ClientMessage): void;
  onMessage(handler: (message: ServerMessage) => void): void;
}

/** The minimal RTCPeerConnection surface the handshake needs. */
export interface RtcConnection {
  createOffer(): Promise<SessionDescription>;
  createAnswer(): Promise<SessionDescription>;
  setLocalDescription(description: SessionDescription): Promise<void>;
  setRemoteDescription(description: SessionDescription): Promise<void>;
  addIceCandidate(candidate: IceCandidate): Promise<void>;
  onIceCandidate(handler: (candidate: IceCandidate) => void): void;
  onConnected(handler: () => void): void;
  sendMessage(text: string): void;
  onMessage(handler: (text: string) => void): void;
}

export interface SessionHandlers {
  onConnected?: () => void;
  onHello?: (text: string) => void;
}

export class PairingSession {
  constructor(
    private readonly routingId: string,
    private readonly rtc: RtcConnection,
    private readonly link: SignalLink,
    private readonly handlers: SessionHandlers = {},
  ) {}

  start(): void {
    this.rtc.onIceCandidate((candidate) => {
      this.link.send({ type: 'signal', data: { kind: 'candidate', candidate } });
    });
    this.rtc.onConnected(() => {
      this.rtc.sendMessage('hello');
      this.handlers.onConnected?.();
    });
    this.rtc.onMessage((text) => this.handlers.onHello?.(text));
    this.link.onMessage((message) => void this.handle(message));
    this.link.send({ type: 'join', routingId: this.routingId });
  }

  private async handle(message: ServerMessage): Promise<void> {
    if (message.type === 'ready' && message.initiator) {
      const offer = await this.rtc.createOffer();
      await this.rtc.setLocalDescription(offer);
      this.link.send({ type: 'signal', data: { kind: 'description', description: offer } });
    } else if (message.type === 'signal') {
      const payload = message.data as SignalPayload;
      if (payload.kind === 'description') {
        await this.rtc.setRemoteDescription(payload.description);
        // An offer demands an answer back; an answer just completes our own offer.
        if (payload.description.type === 'offer') {
          const answer = await this.rtc.createAnswer();
          await this.rtc.setLocalDescription(answer);
          this.link.send({ type: 'signal', data: { kind: 'description', description: answer } });
        }
      } else {
        await this.rtc.addIceCandidate(payload.candidate);
      }
    }
  }
}
