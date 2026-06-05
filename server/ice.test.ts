import { describe, it, expect } from 'vitest';
import { mintIceServers } from './ice';

const STUN = { urls: 'stun:stun.l.google.com:19302' };

describe('ICE server minting (phase 5): STUN always, TURN via Cloudflare when configured', () => {
  it('returns STUN-only when no Cloudflare TURN credentials are configured', async () => {
    const servers = await mintIceServers({});
    expect(servers).toEqual([STUN]);
  });

  it('appends the minted Cloudflare TURN servers when credentials are configured', async () => {
    const turn = {
      urls: ['turn:turn.cloudflare.com:3478'],
      username: 'ephemeral-user',
      credential: 'short-lived-secret',
    };
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ iceServers: turn }), { status: 200 })) as typeof fetch;

    const servers = await mintIceServers({ keyId: 'k1', apiToken: 't1', fetchImpl });

    expect(servers).toEqual([STUN, turn]);
  });

  it('falls back to STUN-only when the Cloudflare API call fails', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch;

    const servers = await mintIceServers({ keyId: 'k1', apiToken: 't1', fetchImpl });

    expect(servers).toEqual([STUN]);
  });
});
