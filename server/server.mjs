// Production server (owner: lead): serves the built game (dist/) and the online relay (/ws) on one port.
//   node server/server.mjs                 PORT (default 80), DIST (default ./dist)
// Static files: hashed /assets/* cached forever, everything else revalidated; gzip for text types;
// unknown paths fall back to index.html. /healthz answers "ok" (+ relay stats as JSON with ?v).

import http from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRelay } from './relay.mjs';

const PORT = Number(process.env.PORT || 80);
const DIST = resolve(process.env.DIST || 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
const GZIP = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt']);

// load the whole build into memory once (a few MB), pre-gzipped; without a build only the relay runs (dev)
const files = new Map();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const ext = extname(name).toLowerCase();
      const body = readFileSync(p);
      const url = '/' + p.slice(DIST.length + 1).split(sep).join('/');
      files.set(url, { body, gz: GZIP.has(ext) && body.length > 1024 ? gzipSync(body, { level: 9 }) : null, type: TYPES[ext] || 'application/octet-stream', immutable: url.startsWith('/assets/') });
    }
  }
}
try {
  walk(DIST);
} catch {
  console.warn(`[server] no build at ${DIST}: relay only`);
}
const index = files.get('/index.html');

const relay = createRelay();

const server = http.createServer((req, res) => {
  let path;
  try {
    path = decodeURIComponent((req.url || '/').split('?')[0]).replace(/\/{2,}/g, '/');
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, relay: relay.stats }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  let f = files.get(path);
  if (!f) {
    if (path.startsWith('/assets/') || extname(path)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    f = index; // client-side routes / ?join= links
  }
  if (!f) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('no build');
    return;
  }
  const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const headers = {
    'content-type': f.type,
    'cache-control': f.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    vary: 'accept-encoding',
  };
  if (gz) headers['content-encoding'] = 'gzip';
  const body = gz ? f.gz : f.body;
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] === '/ws') relay.handleUpgrade(req, socket, head);
  else socket.destroy();
});

server.listen(PORT, () => console.log(`[server] ${files.size} files from ${DIST}, relay at /ws, listening on :${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
