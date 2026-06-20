/**
 * The signaling wire protocol (issue 001). By design (ADR 0001) no client message carries
 * the Pairing secret: the server is told a Routing ID to match on (or asked to allocate a
 * short SAS code, ADR 0003) and is handed opaque SDP/ICE blobs to relay, nothing more.
 */

import type { RoomRegistry, Peer } from './rooms';

/** A message a peer sends to the signaling server. */
export type ClientMessage =
  | { type: 'join'; routingId: string }
  | { type: 'create-room' }
  | { type: 'signal'; data: unknown };

/** Parse one raw wire message and dispatch it to the registry; malformed input is ignored. */
export function handleClientMessage(rooms: RoomRegistry, peer: Peer, raw: string): void {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof message !== 'object' || message === null) return;

  const m = message as Partial<ClientMessage>;
  if (m.type === 'join' && typeof m.routingId === 'string') {
    rooms.join(m.routingId, peer);
  } else if (m.type === 'create-room') {
    rooms.createRoom(peer);
  } else if (m.type === 'signal' && 'data' in m) {
    rooms.relay(peer, m.data);
  }
}
