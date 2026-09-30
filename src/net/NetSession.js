// Online session (owner: online agent): PeerJS (WebRTC data channels) star topology with shareable room codes.
//
//   Host = room owner, peer id `ssk-room-<CODE>`; clients connect to it and every message goes through the
//   host (it relays race traffic to the other clients). Signalling uses the free public PeerJS server.
//
// API:
//   const s = new NetSession()
//   await s.host({ name, charId })            -> creates a room; s.code is the 6-char room code
//   await s.join(code, { name, charId })      -> joins; rejects with a friendly Error (code not found, full...)
//   s.role ('idle'|'host'|'client'), s.code, s.selfId, s.players [{ id, name, charId, ready, ping, host }],
//   s.settings { cc, trackId ('random'|id), laps, cpus, items }, s.phase ('lobby'|'race'), s.isHost, s.me
//   s.setMe({ charId?, ready?, name? })      s.updateSettings(partial)   (host)
//   s.startRace() (host)                      -> broadcasts 'start' with the race info (roster / grid)
//   s.send(msg)  (client -> host, host -> every client)   s.relay(msg, exceptPeerId) (host)
//   s.now() -> host clock in ms (clients estimate the offset with ping/pong)
//   s.leave()                                  closes everything
//   s.on(type, fn) -> off    events: 'lobby', 'start' (info), 'msg' (msg, fromPeerId), 'peerLeft' (peerId),
//                                    'closed' ({ reason }), 'loaded' (peerId, host only)
//   helpers: makeCode(), normalizeCode(text), inviteLink(code), loadNick(), saveNick(name)

import { Peer } from 'peerjs';
import { CHARACTERS } from '../data/characters.js';
import { TRACKS } from '../data/tracks/index.js';
import { ENGINE_CLASSES, RACERS_PER_RACE } from '../data/engine.js';

export const NET_VERSION = 1;
export const ROOM_PREFIX = 'ssk-room-';
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const CODE_LEN = 6;
export const MAX_PLAYERS = RACERS_PER_RACE || 8;
const HEARTBEAT_MS = 1000;
const TIMEOUT_MS = 10000;
const JOIN_TIMEOUT_MS = 15000;
const NICK_KEY = 'ssk.online.nick';

export function makeCode() {
  const a = new Uint32Array(CODE_LEN);
  try {
    crypto.getRandomValues(a);
  } catch {
    for (let i = 0; i < CODE_LEN; i++) a[i] = Math.floor(Math.random() * 1e9);
  }
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
  return s;
}

/** Accepts a code or a pasted invite link; returns the cleaned code (may be shorter than 6 if invalid). */
export function normalizeCode(text) {
  let s = String(text || '').trim();
  const m = s.match(/[?&]join=([A-Za-z0-9]+)/);
  if (m) s = m[1];
  return s
    .toUpperCase()
    .split('')
    .filter((c) => CODE_CHARS.includes(c))
    .join('')
    .slice(0, CODE_LEN);
}

export const inviteLink = (code) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}?join=${code}`;

export function loadNick() {
  try {
    const n = localStorage.getItem(NICK_KEY);
    if (n) return n.slice(0, 16);
  } catch {
    /* ignore */
  }
  return `Sensei${Math.floor(100 + Math.random() * 900)}`;
}

export function saveNick(name) {
  try {
    localStorage.setItem(NICK_KEY, String(name).slice(0, 16));
  } catch {
    /* ignore */
  }
}

const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Sensei';
const validChar = (id) => (CHARACTERS.some((c) => c.id === id) ? id : 'serika');

function friendlyError(err) {
  const t = err?.type || '';
  if (t === 'peer-unavailable') return 'Room not found. Check the code and try again.';
  if (t === 'unavailable-id') return 'That room code is taken. Try again.';
  if (t === 'browser-incompatible') return 'This browser does not support online play (WebRTC).';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed' || t === 'disconnected')
    return 'Could not reach the matchmaking server. Check your internet connection (or firewall) and try again.';
  if (t === 'webrtc' || t === 'negotiation-failed') return 'Could not connect to the other player (a firewall or strict network may block peer-to-peer).';
  return err?.message || 'Connection failed.';
}

export class NetSession {
  constructor() {
    this.role = 'idle';
    this.code = null;
    this.selfId = null;
    this.peer = null;
    this.conns = new Map(); // host: peerId -> { conn, lastSeen, loaded }
    this.hostConn = null; // client
    this.players = [];
    this.settings = { cc: 150, trackId: 'random', laps: 3, cpus: true, items: true };
    this.phase = 'lobby';
    this.offset = 0; // host clock - local clock (ms)
    this.rtt = 0;
    this.raceInfo = null;
    this._handlers = new Map();
    this._timer = null;
    this._lastHostMsg = 0;
    this._closed = false;
    this._raceSeq = 0;
    if (typeof window !== 'undefined') {
      window.__ssk = window.__ssk || {};
      window.__ssk.net = this;
    }
  }

  // ------------------------------------------------------------------------------------------ events
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this._handlers.get(type)?.delete(fn);
  }
  _emit(type, ...args) {
    const set = this._handlers.get(type);
    if (set)
      for (const fn of [...set]) {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[net] "${type}" handler failed`, err);
        }
      }
  }

  get isHost() {
    return this.role === 'host';
  }
  get active() {
    return this.role !== 'idle' && !this._closed;
  }
  get me() {
    return this.players.find((p) => p.id === this.selfId) || null;
  }
  now() {
    return performance.now() + this.offset;
  }

  // ------------------------------------------------------------------------------------------ host
  async host({ name, charId }) {
    this._reset();
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeCode();
      try {
        const peer = await this._openPeer(ROOM_PREFIX + code);
        this.peer = peer;
        this.role = 'host';
        this.code = code;
        this.selfId = peer.id;
        this.phase = 'lobby';
        this.players = [{ id: peer.id, name: cleanName(name), charId: validChar(charId), ready: true, ping: 0, host: true }];
        peer.on('connection', (conn) => this._hostAccept(conn));
        peer.on('error', (err) => this._peerError(err));
        peer.on('disconnected', () => {
          // lost the signalling server: existing peer connections keep working, try to reconnect quietly
          try {
            if (!this._closed) peer.reconnect();
          } catch {
            /* ignore */
          }
        });
        this._startTimer();
        this._emit('lobby');
        return code;
      } catch (err) {
        lastErr = err;
        if (err?.type !== 'unavailable-id') break;
      }
    }
    this._reset();
    throw new Error(friendlyError(lastErr));
  }

  _openPeer(id) {
    return new Promise((resolve, reject) => {
      let peer;
      try {
        peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
      } catch (err) {
        reject(err);
        return;
      }
      const to = setTimeout(() => {
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
        reject({ type: 'network' });
      }, JOIN_TIMEOUT_MS);
      peer.once('open', () => {
        clearTimeout(to);
        peer.off('error', onErr);
        resolve(peer);
      });
      const onErr = (err) => {
        clearTimeout(to);
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
        reject(err);
      };
      peer.once('error', onErr);
    });
  }

  _hostAccept(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, { conn, lastSeen: performance.now(), loaded: false });
    });
    conn.on('data', (msg) => this._hostOnData(conn, msg));
    const drop = () => this._hostDrop(conn.peer);
    conn.on('close', drop);
    conn.on('error', drop);
  }

  _hostOnData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const from = conn.peer;
    const c = this.conns.get(from);
    if (c) c.lastSeen = performance.now();
    const p = this.players.find((x) => x.id === from);
    switch (msg.t) {
      case 'hello': {
        let reason = null;
        if (msg.v !== NET_VERSION) reason = 'Game version mismatch — reload the page on both devices.';
        else if (this.phase !== 'lobby') reason = 'A race is in progress. Try again when it ends.';
        else if (this.players.length >= MAX_PLAYERS && !p) reason = `The room is full (${MAX_PLAYERS}/${MAX_PLAYERS}).`;
        if (reason) {
          this._sendTo(conn, { t: 'reject', reason });
          setTimeout(() => conn.close(), 400);
          return;
        }
        if (!this.conns.has(from)) this.conns.set(from, { conn, lastSeen: performance.now(), loaded: false });
        if (!p) this.players.push({ id: from, name: cleanName(msg.name), charId: validChar(msg.charId), ready: false, ping: 0, host: false });
        this._sendTo(conn, { t: 'welcome', id: from, code: this.code, players: this.players, settings: this.settings, phase: this.phase });
        this._broadcastLobby();
        return;
      }
      case 'set':
        if (!p) return;
        if (msg.charId) p.charId = validChar(msg.charId);
        if (typeof msg.ready === 'boolean') p.ready = msg.ready;
        if (msg.name) p.name = cleanName(msg.name);
        this._broadcastLobby();
        return;
      case 'ping':
        if (p && Number.isFinite(msg.rtt)) p.ping = Math.round(msg.rtt);
        this._sendTo(conn, { t: 'pong', c: msg.c, h: this.now() });
        return;
      case 'loaded':
        if (c) c.loaded = true;
        this._emit('loaded', from);
        return;
      case 'bye':
        this._hostDrop(from);
        return;
      default:
        // race traffic: handle locally and relay to the other clients
        this._emit('msg', msg, from);
        this.relay(msg, from);
    }
  }

  _hostDrop(peerId) {
    const c = this.conns.get(peerId);
    const wasPlayer = this.players.some((p) => p.id === peerId);
    if (!c && !wasPlayer) return;
    this.conns.delete(peerId);
    try {
      c?.conn.close();
    } catch {
      /* ignore */
    }
    this.players = this.players.filter((p) => p.id !== peerId);
    if (this.phase === 'race' && wasPlayer) {
      this.relay({ t: 'left', id: peerId });
      this._emit('peerLeft', peerId);
    }
    this._broadcastLobby();
  }

  _broadcastLobby() {
    if (this.role !== 'host') return;
    this.send({ t: 'lobby', players: this.players, settings: this.settings, phase: this.phase });
    this._emit('lobby');
  }

  updateSettings(partial = {}) {
    if (!this.isHost) return;
    const s = this.settings;
    if (partial.cc !== undefined && ENGINE_CLASSES[partial.cc]) s.cc = Number(partial.cc);
    if (partial.trackId !== undefined) s.trackId = partial.trackId;
    if (partial.laps !== undefined) s.laps = Math.max(1, Math.min(5, Math.round(partial.laps)));
    if (partial.cpus !== undefined) s.cpus = !!partial.cpus;
    if (partial.items !== undefined) s.items = !!partial.items;
    this._broadcastLobby();
  }

  /** Host: build the roster/grid and start everyone's race. */
  startRace() {
    if (!this.isHost || this.phase !== 'lobby') return null;
    const s = this.settings;
    const trackId = s.trackId === 'random' || !s.trackId ? TRACKS[Math.floor(Math.random() * TRACKS.length)].id : s.trackId;
    const humans = shuffle(this.players.slice(0, MAX_PLAYERS));
    const roster = [];
    if (s.cpus) {
      const used = new Set(humans.map((h) => h.charId));
      const pool = shuffle(CHARACTERS.map((c) => c.id));
      const cpuIds = [...pool.filter((id) => !used.has(id)), ...pool.filter((id) => used.has(id))];
      const n = Math.max(0, MAX_PLAYERS - humans.length);
      for (let i = 0; i < n; i++) {
        const ch = CHARACTERS.find((c) => c.id === cpuIds[i % cpuIds.length]);
        roster.push({ charId: ch.id, name: ch.name, owner: null });
      }
    }
    for (const h of humans) roster.push({ charId: h.charId, name: h.name, owner: h.id });
    roster.forEach((r, i) => (r.kartId = `k${i}`));
    this._raceSeq++;
    const info = { raceId: `${this.code}-${this._raceSeq}-${Date.now() % 100000}`, trackId, cc: s.cc, laps: s.laps, items: s.items, roster, host: this.selfId };
    this.phase = 'race';
    this.raceInfo = info;
    for (const c of this.conns.values()) c.loaded = false;
    for (const p of this.players) if (!p.host) p.ready = false;
    this.send({ t: 'start', info });
    this._broadcastLobby();
    this._emit('start', info);
    return info;
  }

  /** Host: race over, back to the lobby phase (clients learn it from the lobby broadcast). */
  endRace() {
    if (!this.isHost) return;
    this.phase = 'lobby';
    this._broadcastLobby();
  }

  allLoaded() {
    if (!this.isHost || !this.raceInfo) return true;
    for (const r of this.raceInfo.roster) {
      if (!r.owner || r.owner === this.selfId) continue;
      const c = this.conns.get(r.owner);
      if (c && !c.loaded) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------------------------------ client
  async join(code, { name, charId }) {
    code = normalizeCode(code);
    if (code.length !== CODE_LEN) throw new Error('Room codes have 6 letters/numbers.');
    this._reset();
    let peer;
    try {
      peer = await this._openPeer(null);
    } catch (err) {
      this._reset();
      throw new Error(friendlyError(err));
    }
    this.peer = peer;
    this.selfId = peer.id;
    try {
      await new Promise((resolve, reject) => {
        const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
        this.hostConn = conn;
        const to = setTimeout(() => reject({ type: 'timeout', message: 'The room did not answer. Check the code, or the host may be behind a strict firewall.' }), JOIN_TIMEOUT_MS);
        const fail = (err) => {
          clearTimeout(to);
          reject(err);
        };
        peer.on('error', (err) => {
          if (this.role === 'client') this._peerError(err);
          else fail(err);
        });
        conn.on('open', () => this._sendTo(conn, { t: 'hello', v: NET_VERSION, name: cleanName(name), charId: validChar(charId) }));
        conn.on('data', (msg) => {
          if (msg?.t === 'welcome') {
            clearTimeout(to);
            this.role = 'client';
            this.code = code;
            this.selfId = msg.id || peer.id;
            this.players = msg.players || [];
            this.settings = msg.settings || this.settings;
            this.phase = msg.phase || 'lobby';
            this._lastHostMsg = performance.now();
            resolve();
          } else if (msg?.t === 'reject') {
            fail({ message: msg.reason || 'The host refused the connection.' });
          } else if (this.role === 'client') this._clientOnData(msg);
        });
        conn.on('close', () => {
          if (this.role === 'client') this._lost('The host left the room.');
          else fail({ message: 'The connection was closed by the host.' });
        });
        conn.on('error', (err) => {
          if (this.role !== 'client') fail(err);
        });
      });
    } catch (err) {
      this._reset();
      throw new Error(friendlyError(err));
    }
    this._startTimer();
    this._sendPing();
    this._emit('lobby');
    return code;
  }

  _clientOnData(msg) {
    if (!msg || typeof msg !== 'object') return;
    this._lastHostMsg = performance.now();
    switch (msg.t) {
      case 'lobby':
        this.players = msg.players || this.players;
        this.settings = msg.settings || this.settings;
        this.phase = msg.phase || this.phase;
        this._emit('lobby');
        return;
      case 'pong': {
        const t1 = performance.now();
        const rtt = Math.max(0, t1 - msg.c);
        const off = msg.h + rtt / 2 - t1;
        // keep the sample with the smallest rtt-ish weight (simple smoothing)
        if (!this._offSamples) this._offSamples = [];
        this._offSamples.push({ rtt, off });
        if (this._offSamples.length > 8) this._offSamples.shift();
        const best = this._offSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.offset = best.off;
        this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
        return;
      }
      case 'start':
        this.phase = 'race';
        this.raceInfo = msg.info;
        this._emit('start', msg.info);
        return;
      case 'left':
        this._emit('peerLeft', msg.id);
        return;
      case 'kick':
        this._lost(msg.reason || 'You were removed from the room.');
        return;
      default:
        this._emit('msg', msg, this.hostConn?.peer);
    }
  }

  setMe({ charId, ready, name } = {}) {
    const me = this.me;
    if (!me) return;
    if (charId) me.charId = validChar(charId);
    if (typeof ready === 'boolean') me.ready = ready;
    if (name) me.name = cleanName(name);
    if (this.isHost) this._broadcastLobby();
    else {
      this.send({ t: 'set', charId: me.charId, ready: me.ready, name: me.name });
      this._emit('lobby');
    }
  }

  // ------------------------------------------------------------------------------------------ messaging
  _sendTo(conn, msg) {
    try {
      if (conn?.open) conn.send(msg);
    } catch (err) {
      if ((this._sendErrs = (this._sendErrs || 0) + 1) < 5) console.warn('[net] send failed', err);
    }
  }

  send(msg) {
    if (this.role === 'host') for (const c of this.conns.values()) this._sendTo(c.conn, msg);
    else if (this.role === 'client') this._sendTo(this.hostConn, msg);
  }

  relay(msg, exceptPeer) {
    if (this.role !== 'host') return;
    for (const [id, c] of this.conns) if (id !== exceptPeer) this._sendTo(c.conn, msg);
  }

  _sendPing() {
    if (this.role !== 'client') return;
    this.send({ t: 'ping', c: performance.now(), rtt: this.rtt });
  }

  _startTimer() {
    clearInterval(this._timer);
    let tick = 0;
    this._timer = setInterval(() => {
      tick++;
      const now = performance.now();
      if (this.role === 'client') {
        this._sendPing();
        if (now - this._lastHostMsg > TIMEOUT_MS) this._lost('Lost the connection to the host.');
      } else if (this.role === 'host') {
        for (const [id, c] of this.conns) if (now - c.lastSeen > TIMEOUT_MS) this._hostDrop(id);
        if (tick % 2 === 0 && this.phase === 'lobby') this._broadcastLobby(); // ping refresh
      }
    }, HEARTBEAT_MS);
  }

  _peerError(err) {
    const t = err?.type;
    if (t === 'peer-unavailable') return; // a stale connect attempt; not fatal once in a room
    console.warn('[net] peer error', t, err?.message);
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
      // signalling lost: data channels may survive; only fatal if nothing is connected
      if (this.role === 'host' && this.conns.size === 0 && this.phase === 'lobby') return; // keep the room; peer.reconnect handles it
    }
  }

  _lost(reason) {
    if (this._closed || this.role === 'idle') return;
    const wasRole = this.role;
    this._teardown();
    this._emit('closed', { reason, role: wasRole });
  }

  leave() {
    if (this.role === 'idle') return;
    try {
      if (this.role === 'client') this.send({ t: 'bye' });
      else this.send({ t: 'kick', reason: 'The host closed the room.' });
    } catch {
      /* ignore */
    }
    const peer = this.peer;
    this._teardown();
    // give the goodbye a moment to leave before the peer is destroyed
    setTimeout(() => {
      try {
        peer?.destroy();
      } catch {
        /* ignore */
      }
    }, 250);
    this._emit('closed', { reason: null, role: 'left' });
  }

  _teardown() {
    this._closed = true;
    clearInterval(this._timer);
    this._timer = null;
    const peer = this.peer;
    for (const c of this.conns.values()) {
      try {
        c.conn.close();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    this.hostConn = null;
    this.peer = null;
    this.role = 'idle';
    this.phase = 'lobby';
    this.raceInfo = null;
    setTimeout(() => {
      try {
        peer?.destroy();
      } catch {
        /* ignore */
      }
    }, 300);
  }

  _reset() {
    if (this.peer) this._teardown();
    this._closed = false;
    this.role = 'idle';
    this.code = null;
    this.players = [];
    this.offset = 0;
    this.rtt = 0;
    this._offSamples = [];
    this.settings = { cc: 150, trackId: 'random', laps: 3, cpus: true, items: true };
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------------------------------------------ singleton
let _session = null;
export function getSession() {
  if (!_session) _session = new NetSession();
  return _session;
}
