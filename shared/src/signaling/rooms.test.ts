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

  it('allocates a short code on create-room, then pairs a joiner who types it (SAS path, ADR 0003)', () => {
    const rooms = new RoomRegistry({ generateCode: () => '8412' });
    const creator = fakePeer();
    const joiner = fakePeer();

    rooms.createRoom(creator);
    expect(creator.sent).toContainEqual({ type: 'room-created', code: '8412' });

    // The joiner types the code, which is just a Routing ID for the existing join path.
    rooms.join('8412', joiner);

    // Room locks: the joiner initiates the offer, the waiting creator answers.
    expect(joiner.sent).toContainEqual({ type: 'ready', initiator: true });
    expect(creator.sent).toContainEqual({ type: 'ready', initiator: false });
  });

  it('never hands out a code that is already taken', () => {
    const codes = ['8412', '8412', '5309']; // first two collide with a live room, third is free
    const rooms = new RoomRegistry({ generateCode: () => codes.shift() ?? '0000' });
    const first = fakePeer();
    const second = fakePeer();

    rooms.createRoom(first);
    rooms.createRoom(second);

    expect(first.sent).toContainEqual({ type: 'room-created', code: '8412' });
    expect(second.sent).toContainEqual({ type: 'room-created', code: '5309' });
  });

  it('rejects room creation when no code is free after bounded retries', () => {
    const rooms = new RoomRegistry({ generateCode: () => '8412' }); // every attempt collides
    const first = fakePeer();
    const second = fakePeer();

    rooms.createRoom(first); // seats the only code
    rooms.createRoom(second); // every retry hits the taken code

    expect(second.sent).toContainEqual({ type: 'rejected', reason: 'unavailable' });
  });

  it('expires a created room that no one joins, freeing its code', () => {
    const clock = { t: 0 };
    const rooms = new RoomRegistry({
      idleTimeoutMs: 1000,
      now: () => clock.t,
      generateCode: () => '8412',
    });
    const creator = fakePeer();

    rooms.createRoom(creator);
    clock.t = 1000; // the creator waited out the idle window with no joiner
    rooms.sweepIdle();

    expect(creator.sent).toContainEqual({ type: 'expired' });

    // Code freed: a fresh create reuses it.
    const next = fakePeer();
    rooms.createRoom(next);
    expect(next.sent).toContainEqual({ type: 'room-created', code: '8412' });
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
