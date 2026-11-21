import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './server/api';

/** API aplikacji (ULDK, NMT, Sentinel-2) działa w tym samym procesie co serwer deweloperski i podgląd. */
function apiPlugin(): Plugin {
  const handler = createApiHandler();
  return {
    name: 'kropla-api',
    configureServer(server) {
      server.middlewares.use('/api', (req, res, next) => void handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', (req, res, next) => void handler(req, res, next));
    },
  };
}

// Względna ścieżka bazowa: zbudowaną aplikację można serwować z dowolnego katalogu.
export default defineConfig({
  base: './',
  plugins: [react(), apiPlugin()],
});
