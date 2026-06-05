/**
 * Deploy-aware endpoints (phase 5, ADR 0002). In production the frontend (Cloudflare Pages)
 * and the signaling server (Render) are different origins, so the signaling base is injected
 * at build time via VITE_SIGNAL_URL (e.g. "wss://duodrop-sig.onrender.com"). In dev it's
 * unset and we use the same-origin paths that Vite proxies to the local server.
 */

const signalBase = import.meta.env.VITE_SIGNAL_URL;

export function signalWsUrl(): string {
  if (signalBase) return `${signalBase}/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export function iceServersUrl(): string {
  if (signalBase) return `${signalBase.replace(/^ws/, 'http')}/ice-servers`;
  return '/ice-servers';
}
