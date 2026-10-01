// Copies the web build (../dist, from `npm run build` in the repo root) into ./app for packaging.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'dist');
const dst = path.join(__dirname, 'app');
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('No web build found: run `npm run build` in the repo root first.');
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (p) => !p.endsWith('sw.js') }); // no service worker in the app
console.log('copied', src, '->', dst);
