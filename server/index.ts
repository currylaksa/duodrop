/** Entrypoint: bind the signaling server to the platform-provided PORT (ADR 0002). */
import { createSignalingServer } from './signaling-server';

const port = Number(process.env.PORT) || 8080;

createSignalingServer({
  // A waiting room holds the Routing ID until the second device joins. Pairing is a manual,
  // human-paced step (copy a link, switch devices, scan a QR, type a code), so the default 30s
  // is far too aggressive — it sweeps the room mid-pairing. Give people five minutes.
  idleTimeoutMs: 5 * 60_000,
  // Cloudflare Realtime TURN credentials are minted server-side from these secrets (ADR 0002).
  iceConfig: {
    keyId: process.env.CF_TURN_KEY_ID,
    apiToken: process.env.CF_TURN_API_TOKEN,
  },
}).listen(port, () => {
  console.log(`signaling server listening on :${port}`);
});
