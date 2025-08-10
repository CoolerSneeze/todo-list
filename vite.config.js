import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { registerApi } from './server/routes.js'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'dev-api-health-inline',
      enforce: 'pre',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          if (
            req.method === 'GET' &&
            (url === '/api/health' || url.startsWith('/api/health?') ||
             url === '/api/health.txt' || url.startsWith('/api/health.txt?'))
          ) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('X-API', 'health-inline');
            res.end(JSON.stringify({ ok: true, ts: Date.now() }));
            return;
          }
          return next();
        });
        console.log('[api] Inline health mounted');
      }
    },
    {
      name: 'dev-api-settings',
      enforce: 'pre',
      configureServer(server) {
        try {
          registerApi(server);
          console.log('[api] Settings routes mounted');
        } catch (e) {
          console.error('[api] Failed to mount settings routes:', e);
        }
      }
    }
  ]
})
