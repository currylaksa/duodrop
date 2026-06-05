/**
 * ICE server minting (phase 5, ADR 0002). STUN is always available (Google, free); TURN is
 * Cloudflare Realtime TURN, minted on demand with short-lived credentials so the client never
 * holds a reusable secret. The CF API token lives only on the server. If TURN isn't configured
 * or the API call fails, we degrade gracefully to STUN-only rather than break pairing.
 */

const STUN: IceServer = { urls: 'stun:stun.l.google.com:19302' };

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceConfig {
  keyId?: string;
  apiToken?: string;
  ttlSeconds?: number;
  fetchImpl?: typeof fetch;
}

export async function mintIceServers(config: IceConfig): Promise<IceServer[]> {
  if (!config.keyId || !config.apiToken) return [STUN];

  try {
    const doFetch = config.fetchImpl ?? fetch;
    const response = await doFetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${config.keyId}/credentials/generate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: config.ttlSeconds ?? 86_400 }),
      },
    );
    if (!response.ok) return [STUN];
    const data = (await response.json()) as { iceServers?: IceServer };
    return data.iceServers ? [STUN, data.iceServers] : [STUN];
  } catch {
    return [STUN];
  }
}
