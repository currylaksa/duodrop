import { describe, it, expect, beforeAll } from 'vitest';
import type { ClientMessage } from './protocol';
import type { ServerMessage } from './rooms';
import {
  sasReady,
  generateEphemeralKeyPair,
  deriveSession,
  encodePublicKey,
  decodePublicKey,
} from '../pairing';
import {
  PairingSession,
  type SignalLink,
  type RtcConnection,
  type SessionDescription,
  type IceCandidate,
  type SignalPayload,
} from './session';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeLink() {
  let handler: (m: ServerMessage) => void = () => {};
  const sent: ClientMessage[] = [];
  const link: SignalLink & { sent: ClientMessage[]; emit: (m: ServerMessage) => void } = {
    sent,
    send: (m) => sent.push(m),
    onMessage: (cb) => {
      handler = cb;
    },
    emit: (m) => handler(m),
  };
  return link;
}

function fakeRtc() {
  let iceCb: (c: IceCandidate) => void = () => {};
  let connectedCb: () => void = () => {};
  let messageCb: (t: string) => void = () => {};
  const local: SessionDescription[] = [];
  const remote: SessionDescription[] = [];
  const added: IceCandidate[] = [];
  const data: string[] = [];
  const rtc: RtcConnection & {
    local: SessionDescription[];
    remote: SessionDescription[];
    added: IceCandidate[];
    data: string[];
    fireIce: (c: IceCandidate) => void;
    fireConnected: () => void;
    fireMessage: (t: string) => void;
  } = {
    local,
    remote,
    added,
    data,
    createOffer: async () => ({ type: 'offer', sdp: 'OFFER' }),
    createAnswer: async () => ({ type: 'answer', sdp: 'ANSWER' }),
    setLocalDescription: async (d) => {
      local.push(d);
    },
    setRemoteDescription: async (d) => {
      remote.push(d);
    },
    addIceCandidate: async (c) => {
      added.push(c);
    },
    onIceCandidate: (cb) => {
      iceCb = cb;
    },
    onConnected: (cb) => {
      connectedCb = cb;
    },
    sendMessage: (t) => data.push(t),
    onMessage: (cb) => {
      messageCb = cb;
    },
    fireIce: (c) => iceCb(c),
    fireConnected: () => connectedCb(),
    fireMessage: (t) => messageCb(t),
  };
  return rtc;
}

describe('pairing session (issue 001): drives the WebRTC handshake', () => {
  it('joins the room with its Routing ID when started', () => {
    const link = fakeLink();
    new PairingSession('routing-1', fakeRtc(), link).start();
    expect(link.sent).toContainEqual({ type: 'join', routingId: 'routing-1' });
  });

  it('as initiator, creates an offer, sets it locally, and sends it as a signal', async () => {
    const link = fakeLink();
    const rtc = fakeRtc();
    new PairingSession('r', rtc, link).start();

    link.emit({ type: 'ready', initiator: true });
    await flush();

    expect(rtc.local).toContainEqual({ type: 'offer', sdp: 'OFFER' });
    expect(link.sent).toContainEqual({
      type: 'signal',
      data: { kind: 'description', description: { type: 'offer', sdp: 'OFFER' } },
    });
  });

  it('as responder, answers an incoming offer and never creates its own offer', async () => {
    const link = fakeLink();
    const rtc = fakeRtc();
    new PairingSession('r', rtc, link).start();

    link.emit({ type: 'ready', initiator: false });
    await flush();
    // The responder waits — it does not offer.
    expect(rtc.local).toEqual([]);

    link.emit({
      type: 'signal',
      data: { kind: 'description', description: { type: 'offer', sdp: 'PEER_OFFER' } },
    });
    await flush();

    expect(rtc.remote).toContainEqual({ type: 'offer', sdp: 'PEER_OFFER' });
    expect(rtc.local).toContainEqual({ type: 'answer', sdp: 'ANSWER' });
    expect(link.sent).toContainEqual({
      type: 'signal',
      data: { kind: 'description', description: { type: 'answer', sdp: 'ANSWER' } },
    });
  });

  it('as initiator, applies the peer answer as the remote description without re-answering', async () => {
    const link = fakeLink();
    const rtc = fakeRtc();
    new PairingSession('r', rtc, link).start();
    link.emit({ type: 'ready', initiator: true });
    await flush();

    link.emit({
      type: 'signal',
      data: { kind: 'description', description: { type: 'answer', sdp: 'PEER_ANSWER' } },
    });
    await flush();

    expect(rtc.remote).toContainEqual({ type: 'answer', sdp: 'PEER_ANSWER' });
    // Only its own offer was set locally — it never answers an answer.
    expect(rtc.local).toEqual([{ type: 'offer', sdp: 'OFFER' }]);
  });

  it('relays its own ICE candidates outward and applies the peer’s inbound', async () => {
    const link = fakeLink();
    const rtc = fakeRtc();
    new PairingSession('r', rtc, link).start();

    rtc.fireIce({ candidate: 'LOCAL' });
    expect(link.sent).toContainEqual({
      type: 'signal',
      data: { kind: 'candidate', candidate: { candidate: 'LOCAL' } },
    });

    link.emit({
      type: 'signal',
      data: { kind: 'candidate', candidate: { candidate: 'REMOTE' } },
    });
    await flush();
    expect(rtc.added).toContainEqual({ candidate: 'REMOTE' });
  });

  it('sends a hello and reports connected when the data channel opens, and surfaces the peer hello', () => {
    const link = fakeLink();
    const rtc = fakeRtc();
    let connected = false;
    let heard = '';
    new PairingSession('r', rtc, link, {
      onConnected: () => {
        connected = true;
      },
      onHello: (text) => {
        heard = text;
      },
    }).start();

    rtc.fireConnected();
    expect(rtc.data).toContain('hello');
    expect(connected).toBe(true);

    rtc.fireMessage('hello');
    expect(heard).toBe('hello');
  });
});

describe('SAS short-code session (ADR 0003): the laptop ↔ laptop path', () => {
  beforeAll(async () => {
    await sasReady();
  });

  it('asks the server to allocate a room and surfaces the allocated code', () => {
    const link = fakeLink();
    let created = '';
    new PairingSession('', fakeRtc(), link, { onRoomCreated: (c) => (created = c) }, {
      sas: true,
      create: true,
    }).start();

    expect(link.sent).toContainEqual({ type: 'create-room' });
    link.emit({ type: 'room-created', code: '4821' });
    expect(created).toBe('4821');
  });

  it('joins on the typed code rather than allocating, in SAS join mode', () => {
    const link = fakeLink();
    new PairingSession('4821', fakeRtc(), link, {}, { sas: true }).start();
    expect(link.sent).toContainEqual({ type: 'join', routingId: '4821' });
  });

  it('sends its ephemeral public key over the relay once the room is ready', async () => {
    const link = fakeLink();
    new PairingSession('4821', fakeRtc(), link, {}, { sas: true }).start();

    link.emit({ type: 'ready', initiator: false });
    await flush();

    const signal = link.sent.find(
      (m): m is Extract<ClientMessage, { type: 'signal' }> =>
        m.type === 'signal' && (m.data as SignalPayload).kind === 'pubkey',
    );
    expect(signal).toBeDefined();
    const payload = signal!.data as Extract<SignalPayload, { kind: 'pubkey' }>;
    expect(decodePublicKey(payload.publicKey).length).toBe(32);
  });

  it('derives the same session key and safety string the real peer would see', async () => {
    const link = fakeLink();
    let safety: string[] = [];
    let key: Uint8Array = new Uint8Array();
    new PairingSession(
      '4821',
      fakeRtc(),
      link,
      { onSafetyString: (s, k) => ((safety = s), (key = k)) },
      { sas: true },
    ).start();

    link.emit({ type: 'ready', initiator: false });
    await flush();

    // Recover the public key the session put on the wire, then play the honest peer.
    const ourPubSignal = link.sent.find(
      (m): m is Extract<ClientMessage, { type: 'signal' }> =>
        m.type === 'signal' && (m.data as SignalPayload).kind === 'pubkey',
    )!;
    const ourPub = decodePublicKey(
      (ourPubSignal.data as Extract<SignalPayload, { kind: 'pubkey' }>).publicKey,
    );
    const peer = generateEphemeralKeyPair();
    const peerView = deriveSession(peer, ourPub);

    link.emit({
      type: 'signal',
      data: { kind: 'pubkey', publicKey: encodePublicKey(peer.publicKey) },
    });
    await flush();

    expect(safety).toEqual(peerView.safetyString);
    expect(hex(key)).toBe(hex(peerView.sessionKey));
  });

  it('does not start the SAS exchange when not in SAS mode (QR/link path stays intact)', async () => {
    const link = fakeLink();
    new PairingSession('routing-1', fakeRtc(), link).start();
    link.emit({ type: 'ready', initiator: false });
    await flush();
    expect(link.sent.some((m) => m.type === 'signal')).toBe(false);
  });
});
