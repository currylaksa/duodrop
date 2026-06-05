import { describe, it, expect } from 'vitest';
import { RoomRegistry, type ServerMessage, type Peer } from './rooms';

/** A test Peer that records every message the registry sends it. */
function fakePeer(): Peer & { sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  return { sent, send: (message) => sent.push(message) };
}

describe('signaling room logic (issue 001): rooms keyed on Routing ID', () => {
  it('relays a signal from one peer to the other peer in the same room', () => {
    const rooms = new RoomRegistry();
    const a = fakePeer();
    const b = fakePeer();

    rooms.join('routing-1', a);
    rooms.join('routing-1', b);

    rooms.relay(a, { sdp: 'offer' });

    // The signal reaches the *other* peer, carrying the opaque SDP/ICE payload...
    expect(b.sent).toContainEqual({ type: 'signal', data: { sdp: 'offer' } });
    // ...and is never echoed back to the sender.
    expect(a.sent).not.toContainEqual({ type: 'signal', data: { sdp: 'offer' } });
  });

  it('notifies both peers when the room locks, naming exactly one initiator to avoid offer glare', () => {
    const rooms = new RoomRegistry();
    const a = fakePeer();
    const b = fakePeer();

    rooms.join('routing-1', a);
    // The first peer waits alone — nothing to do until a second peer arrives.
    expect(a.sent).toEqual([]);

    rooms.join('routing-1', b);

    // Both learn the room is ready; the later joiner is the sole initiator of the WebRTC offer.
    expect(b.sent).toContainEqual({ type: 'ready', initiator: true });
    expect(a.sent).toContainEqual({ type: 'ready', initiator: false });
  });

  it('locks a room at two peers: a third peer with the same Routing ID is rejected, not added', () => {
    const rooms = new RoomRegistry();
    const a = fakePeer();
    const b = fakePeer();
    const c = fakePeer();

    rooms.join('routing-1', a);
    rooms.join('routing-1', b);
    rooms.join('routing-1', c);

    // The third peer is told the room is full...
    expect(c.sent).toContainEqual({ type: 'rejected', reason: 'full' });

    // ...and never becomes part of the room, so relayed signals never reach it.
    rooms.relay(a, { sdp: 'offer' });
    expect(c.sent).not.toContainEqual({ type: 'signal', data: { sdp: 'offer' } });
  });

  it('isolates rooms: a signal never crosses to a peer on a different Routing ID', () => {
    const rooms = new RoomRegistry();
    const a = fakePeer();
    const stranger = fakePeer();

    rooms.join('routing-1', a);
    rooms.join('routing-2', stranger);

    rooms.relay(a, { sdp: 'offer' });

    expect(stranger.sent).toEqual([]);
  });

  it('tears the room down when a peer leaves: the other peer is notified and re-pairing works', () => {
    const rooms = new RoomRegistry();
    const a = fakePeer();
    const b = fakePeer();

    rooms.join('routing-1', a);
    rooms.join('routing-1', b);
    rooms.leave(b);

    // The surviving peer learns the link dropped (re-pair-on-drop; no resume)...
    expect(a.sent).toContainEqual({ type: 'peer-left' });

    // ...and the Routing ID is free again, so two fresh peers can re-pair on it.
    const a2 = fakePeer();
    const b2 = fakePeer();
    rooms.join('routing-1', a2);
    rooms.join('routing-1', b2);
    rooms.relay(a2, { sdp: 'offer' });
    expect(b2.sent).toContainEqual({ type: 'signal', data: { sdp: 'offer' } });
  });

  it('expires an unfilled room once it has idled past the timeout', () => {
    const clock = { t: 0 };
    const rooms = new RoomRegistry({ idleTimeoutMs: 1000, now: () => clock.t });
    const lonely = fakePeer();

    rooms.join('routing-1', lonely);
    clock.t = 1000; // the room has waited out its idle window with only one peer
    rooms.sweepIdle();

    // The lone peer is told its room expired, and the Routing ID is freed for re-pairing.
    expect(lonely.sent).toContainEqual({ type: 'expired' });
    const a = fakePeer();
    const b = fakePeer();
    rooms.join('routing-1', a);
    rooms.join('routing-1', b);
    rooms.relay(a, { sdp: 'offer' });
    expect(b.sent).toContainEqual({ type: 'signal', data: { sdp: 'offer' } });
  });

  it('never expires a locked two-peer room, however long it has been connected', () => {
    const clock = { t: 0 };
    const rooms = new RoomRegistry({ idleTimeoutMs: 1000, now: () => clock.t });
    const a = fakePeer();
    const b = fakePeer();

    rooms.join('routing-1', a);
    rooms.join('routing-1', b);
    clock.t = 60_000; // far beyond the idle window — but the room is full, not idle
    rooms.sweepIdle();

    expect(a.sent).not.toContainEqual({ type: 'expired' });
    expect(b.sent).not.toContainEqual({ type: 'expired' });
    // Still live: the relay keeps working after the sweep.
    rooms.relay(a, { sdp: 'offer' });
    expect(b.sent).toContainEqual({ type: 'signal', data: { sdp: 'offer' } });
  });
});
