import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // Several agents / tools hit the dev server concurrently; keep HMR from full-reloading tool pages.
    hmr: { overlay: false },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
