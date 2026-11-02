import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En developpement, /api et /socket.io sont proxifies vers l'API gateway Node.
// En Docker, Nginx joue le meme role (voir infrastructure/docker/nginx.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8080', changeOrigin: true },
      '/socket.io': { target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8080', ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
