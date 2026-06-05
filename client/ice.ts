/**
 * Fetch the ICE servers (STUN + ephemeral Cloudflare TURN) from the signaling server before
 * opening the peer connection (phase 5). Falls back to Google STUN if the endpoint is
 * unreachable, so pairing still works on permissive networks without TURN.
 */
import { iceServersUrl } from './config';

const GOOGLE_STUN: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const response = await fetch(iceServersUrl());
    if (!response.ok) return [GOOGLE_STUN];
    const data = (await response.json()) as { iceServers?: RTCIceServer[] };
    return data.iceServers?.length ? data.iceServers : [GOOGLE_STUN];
  } catch {
    return [GOOGLE_STUN];
  }
}
