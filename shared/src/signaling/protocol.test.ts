import { describe, it, expect } from 'vitest';
import { RoomRegistry, type ServerMessage, type Peer } from './rooms';
import { handleClientMessage } from './protocol';

function fakePeer(): Peer & { sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  return { sent, send: (message) => sent.push(message) };
}

describe('signaling wire protocol (issue 001): client → server messages', () => {
  it('routes a wire join into the room and relays a wire signal to the paired peer', () => {
    const rooms = new RoomRegistry();
    const a = fakePeer();
    const b = fakePeer();

    handleClientMessage(rooms, a, JSON.stringify({ type: 'join', routingId: 'r1' }));
    handleClientMessage(rooms, b, JSON.stringify({ type: 'join', routingId: 'r1' }));
    handleClientMessage(rooms, a, JSON.stringify({ type: 'signal', data: { sdp: 'offer' } }));

    expect(b.sent).toContainEqual({ type: 'signal', data: { sdp: 'offer' } });
  });

  it('routes a create-room into a fresh server-allocated room (SAS path, ADR 0003)', () => {
    const rooms = new RoomRegistry({ generateCode: () => '8412' });
    const creator = fakePeer();

    handleClientMessage(rooms, creator, JSON.stringify({ type: 'create-room' }));

    expect(creator.sent).toContainEqual({ type: 'room-created', code: '8412' });
  });

  it('ignores malformed, unknown, or incomplete messages without forming a room', () => {
    const rooms = new RoomRegistry();
    const a = fakePeer();
    const b = fakePeer();

    expect(() => handleClientMessage(rooms, a, 'not json')).not.toThrow();
    expect(() => handleClientMessage(rooms, a, JSON.stringify({ type: 'bogus' }))).not.toThrow();

    // Two joins each missing their Routing ID must NOT be matched into one room.
    handleClientMessage(rooms, a, JSON.stringify({ type: 'join' }));
    handleClientMessage(rooms, b, JSON.stringify({ type: 'join' }));
    handleClientMessage(rooms, a, JSON.stringify({ type: 'signal', data: { x: 1 } }));

    expect(b.sent).toEqual([]);
  });
});
