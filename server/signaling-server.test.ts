import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createSignalingServer } from './signaling-server';

let server: Server;

afterEach(() => {
  server?.close();
});

function listen(s: Server): Promise<number> {
  server = s;
  return new Promise((resolve) =>
    s.listen(0, () => resolve((s.address() as AddressInfo).port)),
  );
}

function connect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise((resolve) => ws.once('open', () => resolve(ws)));
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) =>
    ws.once('message', (data) => resolve(JSON.parse(data.toString()))),
  );
}

describe('signaling server transport (issue 001), end to end over real sockets', () => {
  it('answers /health for the deploy host and keep-warm pinger', async () => {
    const port = await listen(createSignalingServer());

    const res = await fetch(`http://127.0.0.1:${port}/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('pairs two peers on the same Routing ID and relays a signal between them', async () => {
    const port = await listen(createSignalingServer());
    const a = await connect(port);
    const b = await connect(port);

    a.send(JSON.stringify({ type: 'join', routingId: 'r1' }));
    b.send(JSON.stringify({ type: 'join', routingId: 'r1' }));

    // Both peers learn the room locked, with exactly one named as the offer initiator.
    const [readyA, readyB] = await Promise.all([nextMessage(a), nextMessage(b)]);
    expect(readyA.type).toBe('ready');
    expect(readyB.type).toBe('ready');
    expect([readyA.initiator, readyB.initiator].sort()).toEqual([false, true]);

    // An opaque SDP/ICE blob from one peer reaches the other untouched.
    a.send(JSON.stringify({ type: 'signal', data: { sdp: 'offer' } }));
    expect(await nextMessage(b)).toEqual({ type: 'signal', data: { sdp: 'offer' } });

    a.close();
    b.close();
  });
});
