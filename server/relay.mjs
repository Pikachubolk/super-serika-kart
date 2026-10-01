// WebSocket relay for online play (owner: online agent).
//
// Peer-to-peer WebRTC is blocked on many school / office / mobile networks, so every online message goes
// through this relay instead, on the same HTTPS origin as the game (wss://<host>/ws). It is a dumb switchboard
// that mimics the small part of PeerJS the game uses (src/net/relay.js is the client side):
//
//   client -> server                         server -> client
//   { op: 'reg', id? }                       { op: 'open', id } | { op: 'err', type: 'unavailable-id' }
//   { op: 'conn', cid, to, meta }            { op: 'ok', cid } (to the caller) + { op: 'in', cid, from, meta } (to `to`)
//                                            | { op: 'err', cid, type: 'peer-unavailable' }
//   { op: 'd', cid, d }                      { op: 'd', cid, d } (to the other end of cid)
//   { op: 'x', cid }                         { op: 'x', cid } (to the other end)
//
// A socket is one "peer" with a unique id (rooms register as `ssk-room-<CODE>`). Game logic (lobby, races,
// tournaments) still runs on the host's browser; the relay never looks inside `d`.

import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';

const MAX_MSG = 64 * 1024; // bytes per frame
const MAX_CONNS = 48; // data connections per socket (host: 2 per guest)
const RATE = 600; // frames per second per socket (bursting allowed up to 2x)
const PING_MS = 20000; // keepalive (Cloudflare drops idle sockets after 100 s)
const ID_RE = /^[A-Za-z0-9_-]{4,48}$/;
const CID_RE = /^[A-Za-z0-9]{8,32}$/;

export function createRelay({ log = console } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG, perMessageDeflate: false });
  const peers = new Map(); // id -> ws
  const conns = new Map(); // cid -> { a: ws (caller), b: ws (callee) }
  const stats = { sockets: 0, peers: 0, conns: 0, frames: 0 };

  const send = (ws, msg) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  const other = (c, ws) => (c.a === ws ? c.b : c.a);

  function closeConn(cid, from) {
    const c = conns.get(cid);
    if (!c) return;
    conns.delete(cid);
    c.a.cids.delete(cid);
    c.b.cids.delete(cid);
    send(other(c, from), { op: 'x', cid });
  }

  wss.on('connection', (ws) => {
    stats.sockets++;
    ws.id = null;
    ws.cids = new Set();
    ws.alive = true;
    ws.bucket = RATE * 2;
    ws.lastFill = Date.now();
    ws.on('pong', () => (ws.alive = true));
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      // token bucket rate limit
      const now = Date.now();
      ws.bucket = Math.min(RATE * 2, ws.bucket + ((now - ws.lastFill) / 1000) * RATE);
      ws.lastFill = now;
      if (ws.bucket < 1) return;
      ws.bucket--;
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;
      stats.frames++;
      switch (m.op) {
        case 'reg': {
          if (ws.id) return;
          let id = typeof m.id === 'string' && ID_RE.test(m.id) ? m.id : null;
          if (id && peers.has(id)) return send(ws, { op: 'err', type: 'unavailable-id' });
          if (!id) do id = `p-${randomBytes(9).toString('base64url')}`; while (peers.has(id));
          ws.id = id;
          peers.set(id, ws);
          return send(ws, { op: 'open', id });
        }
        case 'conn': {
          if (!ws.id || !CID_RE.test(m.cid || '') || conns.has(m.cid)) return;
          const target = peers.get(m.to);
          if (!target || target === ws) return send(ws, { op: 'err', cid: m.cid, type: 'peer-unavailable' });
          if (ws.cids.size >= MAX_CONNS || target.cids.size >= MAX_CONNS) return send(ws, { op: 'err', cid: m.cid, type: 'peer-unavailable' });
          conns.set(m.cid, { a: ws, b: target });
          ws.cids.add(m.cid);
          target.cids.add(m.cid);
          const meta = m.meta && typeof m.meta === 'object' ? m.meta : undefined;
          send(target, { op: 'in', cid: m.cid, from: ws.id, meta });
          return send(ws, { op: 'ok', cid: m.cid });
        }
        case 'd': {
          const c = conns.get(m.cid);
          if (!c || (c.a !== ws && c.b !== ws)) return;
          return send(other(c, ws), { op: 'd', cid: m.cid, d: m.d });
        }
        case 'x': {
          const c = conns.get(m.cid);
          if (c && (c.a === ws || c.b === ws)) closeConn(m.cid, ws);
          return;
        }
      }
    });
    ws.on('close', () => {
      stats.sockets--;
      for (const cid of [...ws.cids]) closeConn(cid, ws);
      if (ws.id && peers.get(ws.id) === ws) peers.delete(ws.id);
    });
    ws.on('error', () => {});
  });

  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
    stats.peers = peers.size;
    stats.conns = conns.size;
  }, PING_MS);
  timer.unref?.();

  return {
    stats,
    /** Hand an HTTP upgrade request to the relay. */
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close() {
      clearInterval(timer);
      wss.close();
    },
    log,
  };
}
