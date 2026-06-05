/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket base of the signaling server in production, e.g. "wss://duodrop-sig.onrender.com". */
  readonly VITE_SIGNAL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
