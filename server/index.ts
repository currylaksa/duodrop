/** Entrypoint: bind the signaling server to the platform-provided PORT (ADR 0002). */
import { createSignalingServer } from './signaling-server';

const port = Number(process.env.PORT) || 8080;

createSignalingServer({
  // Cloudflare Realtime TURN credentials are minted server-side from these secrets (ADR 0002).
  iceConfig: {
    keyId: process.env.CF_TURN_KEY_ID,
    apiToken: process.env.CF_TURN_API_TOKEN,
  },
}).listen(port, () => {
  console.log(`signaling server listening on :${port}`);
});
