import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Build src/pwa/sw.js into dist/sw.js with this build's version + precache list (see that file). */
function serviceWorker() {
  return {
    name: 'ssk-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => /\.(js|css)$/.test(f))
        .sort();
      const version = createHash('sha1').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./src/pwa/sw.js', import.meta.url), 'utf8')
        .replace('__SW_VERSION__', version)
        .replace("...'__PRECACHE__'", files.map((f) => JSON.stringify(`./${f}`)).join(', '));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  server: {
    port: 5173,
    strictPort: true,
    // Several agents / tools hit the dev server concurrently; keep HMR from full-reloading tool pages.
    hmr: { overlay: false },
    // online relay in dev: `npm run relay` (server/server.mjs on :8787)
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
