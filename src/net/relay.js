// WebSocket relay transport (owner: online agent) - client side of server/relay.mjs.
//
// RelayPeer / RelayConn mimic the subset of PeerJS's Peer / DataConnection that NetSession uses, so the
// session logic is the same for both transports:
//   peer.on|once|off('open' (id) | 'error' ({ type }) | 'connection' (conn) | 'disconnected')
//   peer.id, peer.connect(id, { metadata }) -> conn, peer.reconnect(), peer.destroy()
//   conn.peer, conn.metadata, conn.open, conn.send(obj), conn.close(), conn.on('open'|'data'|'close'|'error')
// Every message travels over one WebSocket to the game's own server (same HTTPS origin), so online play works
// on networks that block WebRTC (schools, offices, some mobile carriers).

const DEFAULT_RELAY = 'wss://kart.serika.dev/ws';

/** Relay URL: same origin when the game is served over http(s); the public server otherwise (desktop app). */
export function relayURL() {
  try {
    const env = import.meta.env?.VITE_RELAY_URL;
    if (env) return env;
    const q = new URLSearchParams(location.search).get('relay');
    if (q) return q;
    if (location.protocol === 'https:' || location.protocol === 'http:') return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  } catch {
    /* ignore */
  }
  return DEFAULT_RELAY;
}

class Emitter {
  constructor() {
    this._ev = new Map();
  }
  on(type, fn) {
    if (!this._ev.has(type)) this._ev.set(type, new Set());
    this._ev.get(type).add(fn);
    return this;
  }
  once(type, fn) {
    const w = (...a) => {
      this.off(type, w);
      fn(...a);
    };
    w._orig = fn;
    return this.on(type, w);
  }
  off(type, fn) {
    const set = this._ev.get(type);
    if (!set) return this;
    for (const f of set) if (f === fn || f._orig === fn) set.delete(f);
    return this;
  }
  emit(type, ...args) {
    for (const fn of [...(this._ev.get(type) || [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[relay] "${type}" handler failed`, err);
      }
    }
  }
}

const rid = () => {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
};

export class RelayConn extends Emitter {
  constructor(peer, cid, remote, metadata) {
    super();
    this._peer = peer;
    this.cid = cid;
    this.peer = remote;
    this.metadata = metadata;
    this.open = false;
    this.reliable = true;
    this.serialization = 'json';
  }
  send(data) {
    if (!this.open) return;
    this._peer._send({ op: 'd', cid: this.cid, d: data });
  }
  close() {
    if (this._closed) return;
    this._peer._send({ op: 'x', cid: this.cid });
    this._gone();
  }
  _gone() {
    if (this._closed) return;
    this._closed = true;
    this.open = false;
    this._peer._conns.delete(this.cid);
    this.emit('close');
  }
}

export class RelayPeer extends Emitter {
  constructor(id = null, { url = relayURL() } = {}) {
    super();
    this.id = null;
    this._want = id;
    this._url = url;
    this._conns = new Map(); // cid -> RelayConn
    this.destroyed = false;
    this.disconnected = true;
    this._connect();
  }

  _connect() {
    let ws;
    try {
      ws = new WebSocket(this._url);
    } catch {
      setTimeout(() => this.emit('error', { type: 'network', message: 'Could not reach the game server.' }), 0);
      return;
    }
    this._ws = ws;
    ws.onopen = () => this._send({ op: 'reg', id: this._want || undefined });
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      this._onMsg(m);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this._ws !== ws) return;
      const wasOpen = !this.disconnected;
      this.disconnected = true;
      for (const c of [...this._conns.values()]) c._gone();
      if (this.destroyed) return;
      if (wasOpen) this.emit('disconnected');
      else this.emit('error', { type: 'network', message: 'Could not reach the game server.' });
    };
  }

  _onMsg(m) {
    switch (m.op) {
      case 'open':
        this.id = m.id;
        this.disconnected = false;
        this.emit('open', m.id);
        return;
      case 'err': {
        if (m.cid) {
          const c = this._conns.get(m.cid);
          c?.emit('error', { type: m.type });
          c?._gone();
        }
        this.emit('error', { type: m.type, message: m.type });
        return;
      }
      case 'ok': {
        const c = this._conns.get(m.cid);
        if (!c) return;
        c.open = true;
        c.emit('open');
        return;
      }
      case 'in': {
        const c = new RelayConn(this, m.cid, m.from, m.meta);
        this._conns.set(m.cid, c);
        this.emit('connection', c);
        // like PeerJS: the receiving side's 'open' fires after 'connection' handlers attached their listeners
        setTimeout(() => {
          if (c._closed) return;
          c.open = true;
          c.emit('open');
        }, 0);
        return;
      }
      case 'd':
        this._conns.get(m.cid)?.emit('data', m.d);
        return;
      case 'x':
        this._conns.get(m.cid)?._gone();
        return;
    }
  }

  _send(msg) {
    const ws = this._ws;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  connect(to, { metadata } = {}) {
    const c = new RelayConn(this, rid(), to, metadata);
    this._conns.set(c.cid, c);
    this._send({ op: 'conn', cid: c.cid, to, meta: metadata });
    return c;
  }

  /** A dropped socket loses every connection, so reconnecting only re-registers the id for new joiners. */
  reconnect() {
    if (this.destroyed || !this.disconnected) return;
    this._want = this.id || this._want;
    this._connect();
  }

  destroy() {
    this.destroyed = true;
    for (const c of [...this._conns.values()]) c._gone();
    try {
      this._ws?.close();
    } catch {
      /* ignore */
    }
  }
}
