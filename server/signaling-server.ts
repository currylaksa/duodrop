/**
 * The signaling server transport (issue 001). A thin Express + `ws` shell over the tested
 * room logic: it owns sockets, IPs, and HTTP, and delegates every pairing decision to the
 * RoomRegistry. No file data and never the Pairing secret pass through here (ADR 0001).
 */

import express from 'express';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomRegistry, type Peer } from '../shared/src/signaling/rooms';
import { handleClientMessage } from '../shared/src/signaling/protocol';
import { RateLimiter } from '../shared/src/signaling/rate-limit';
import { mintIceServers, type IceConfig } from './ice';

export interface SignalingServerOptions {
  idleTimeoutMs?: number;
  sweepIntervalMs?: number;
  rateLimit?: { limit: number; windowMs: number };
  iceConfig?: IceConfig;
}

/** Build the HTTP+WebSocket signaling server. Caller decides the port via `.listen()`. */
export function createSignalingServer(opts: SignalingServerOptions = {}): Server {
  const app = express();
  // The frontend is served from a different origin (Cloudflare Pages) than this signaling
  // server (Render), so its GETs need permissive CORS. Only ephemeral, non-secret data is
  // exposed here; the WebSocket upgrade itself is not subject to CORS.
  app.use((_req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    next();
  });

  // Liveness probe for the deploy host and the keep-warm pinger (issue 009).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Short-lived ICE servers (STUN + Cloudflare TURN). The TURN secret stays server-side; the
  // client fetches fresh, ephemeral credentials per pairing (ADR 0002).
  app.get('/ice-servers', async (_req, res) => {
    res.json({ iceServers: await mintIceServers(opts.iceConfig ?? {}) });
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  const rooms = new RoomRegistry({ idleTimeoutMs: opts.idleTimeoutMs });
  const limiter = new RateLimiter(opts.rateLimit ?? { limit: 30, windowMs: 60_000 });

  wss.on('connection', (ws: WebSocket, req) => {
    // Coarse abuse guard: cap new connections per source IP, which bounds room creation.
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (!limiter.tryAcquire(ip)) {
      ws.close(1008, 'rate limited');
      return;
    }

    // Guard against the close race: a relay may target a peer whose socket just dropped.
    const peer: Peer = {
      send: (message) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
    };

    ws.on('message', (raw) => handleClientMessage(rooms, peer, raw.toString()));
    ws.on('close', () => rooms.leave(peer));
  });

  // Reap rooms that never reached two peers. unref so the timer never holds the process open.
  const sweep = setInterval(() => rooms.sweepIdle(), opts.sweepIntervalMs ?? 10_000);
  sweep.unref();
  httpServer.on('close', () => clearInterval(sweep));

  return httpServer;
}
