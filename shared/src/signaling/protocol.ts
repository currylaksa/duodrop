/**
 * The signaling wire protocol (issue 001). The client sends only two kinds of message, and
 * — by design (ADR 0001) — neither carries the Pairing secret: the server is told the
 * Routing ID to match on and is handed opaque SDP/ICE blobs to relay, nothing more.
 */

import type { RoomRegistry, Peer } from './rooms';

/** A message a peer sends to the signaling server. */
export type ClientMessage =
  | { type: 'join'; routingId: string }
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
  } else if (m.type === 'signal' && 'data' in m) {
    rooms.relay(peer, m.data);
  }
}
