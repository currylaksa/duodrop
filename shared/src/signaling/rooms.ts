/**
 * Signaling room logic (issue 001). Transport-agnostic and in-memory: the Express/`ws`
 * layer wraps this, so the relay can be exercised without real sockets or timers.
 *
 * Rooms are keyed on the **Routing ID** only (ADR 0001) — the server never sees the
 * Pairing secret. A room relays opaque SDP/ICE payloads between its two peers and is torn
 * down on disconnect; there is no resume.
 */

/** A message the server sends to a connected peer. SDP/ICE rides opaquely inside `signal`. */
export type ServerMessage =
  | { type: 'ready'; initiator: boolean }
  | { type: 'room-created'; code: string }
  | { type: 'signal'; data: unknown }
  | { type: 'rejected'; reason: 'full' | 'unavailable' }
  | { type: 'peer-left' }
  | { type: 'expired' };

/** A connected peer, abstracted to its one outbound capability so the logic stays testable. */
export interface Peer {
  send(message: ServerMessage): void;
}

interface Room {
  readonly peers: Set<Peer>;
  readonly createdAt: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/** How many random draws to try before giving up on finding a free code (saturation guard). */
const CODE_ALLOCATION_ATTEMPTS = 100;

/** Default short-code generator for the SAS path: a 4-digit numeric, non-secret (ADR 0003). */
const defaultGenerateCode = (): string =>
  ((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 10_000).toString().padStart(4, '0');

export class RoomRegistry {
  /** Routing ID (or server-allocated SAS code) → the room currently matched on it. */
  private readonly rooms = new Map<string, Room>();
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;
  private readonly generateCode: () => string;

  constructor(
    opts: { idleTimeoutMs?: number; now?: () => number; generateCode?: () => string } = {},
  ) {
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
    this.generateCode = opts.generateCode ?? defaultGenerateCode;
  }

  /**
   * Allocate a fresh short code and seat the creator in its room (SAS path, ADR 0003). The
   * code is non-secret — security comes from the safety-string comparison, not its secrecy —
   * so the server may hand it out. The joiner later pairs on it via the ordinary `join`.
   */
  createRoom(peer: Peer): void {
    let code: string | null = null;
    for (let attempt = 0; attempt < CODE_ALLOCATION_ATTEMPTS; attempt++) {
      const candidate = this.generateCode();
      if (!this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (code === null) {
      peer.send({ type: 'rejected', reason: 'unavailable' });
      return;
    }
    this.rooms.set(code, { peers: new Set([peer]), createdAt: this.now() });
    peer.send({ type: 'room-created', code });
  }

  /** Add a peer to the room for this Routing ID, creating the room on first arrival. */
  join(routingId: string, peer: Peer): void {
    let room = this.rooms.get(routingId);
    if (!room) {
      room = { peers: new Set(), createdAt: this.now() };
      this.rooms.set(routingId, room);
    }
    // The room locks at two peers; a third presenting the same Routing ID is turned away.
    if (room.peers.size >= 2) {
      peer.send({ type: 'rejected', reason: 'full' });
      return;
    }
    room.peers.add(peer);

    // On lock, both peers are told the room is ready. The peer that just arrived initiates
    // the WebRTC offer; the one already waiting answers — so exactly one offer is made.
    if (room.peers.size === 2) {
      for (const member of room.peers) {
        member.send({ type: 'ready', initiator: member === peer });
      }
    }
  }

  /** Forward an opaque SDP/ICE payload from `sender` to the other peer(s) in its room. */
  relay(sender: Peer, data: unknown): void {
    for (const room of this.rooms.values()) {
      if (!room.peers.has(sender)) continue;
      for (const peer of room.peers) {
        if (peer !== sender) peer.send({ type: 'signal', data });
      }
    }
  }

  /** Remove a peer on disconnect, tearing the whole room down so the other peer re-pairs. */
  leave(peer: Peer): void {
    for (const [routingId, room] of this.rooms) {
      if (!room.peers.has(peer)) continue;
      for (const other of room.peers) {
        if (other !== peer) other.send({ type: 'peer-left' });
      }
      this.rooms.delete(routingId);
      return;
    }
  }

  /** Drop rooms that never reached two peers within the idle window, freeing their Routing ID. */
  sweepIdle(): void {
    for (const [routingId, room] of this.rooms) {
      const idle = room.peers.size < 2 && this.now() - room.createdAt >= this.idleTimeoutMs;
      if (!idle) continue;
      for (const peer of room.peers) peer.send({ type: 'expired' });
      this.rooms.delete(routingId);
    }
  }
}
