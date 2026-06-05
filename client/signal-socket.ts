/**
 * Real WebSocket adapter (issue 001). Implements the SignalLink the PairingSession uses to
 * reach the signaling server. Outbound messages sent before the socket opens (e.g. the
 * immediate `join`) are buffered and flushed on open.
 */

import type { SignalLink } from '../shared/src/signaling/session';
import type { ServerMessage } from '../shared/src/signaling/rooms';

export function createSignalLink(url: string): SignalLink {
  const ws = new WebSocket(url);
  const pending: string[] = [];
  let open = false;

  ws.addEventListener('open', () => {
    open = true;
    for (const text of pending) ws.send(text);
    pending.length = 0;
  });

  return {
    send: (message) => {
      const text = JSON.stringify(message);
      if (open) ws.send(text);
      else pending.push(text);
    },
    onMessage: (handler) => {
      ws.addEventListener('message', (event) =>
        handler(JSON.parse(String(event.data)) as ServerMessage),
      );
    },
  };
}
