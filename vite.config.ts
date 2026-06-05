import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server for the client. The signaling WebSocket is reached at same-origin `/ws`,
// proxied to the locally-running signaling server (npm run server, default :8080).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'http://localhost:8080', ws: true },
      '/ice-servers': { target: 'http://localhost:8080' },
    },
  },
});
