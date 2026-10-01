// Online session (owner: online agent): star topology with shareable room codes.
//
//   Host = room owner, peer id `ssk-room-<CODE>`; clients connect to it and every message goes through the
//   host (it relays race traffic to the other clients). Transport: the game server's WebSocket relay
//   (src/net/relay.js + server/relay.mjs, same HTTPS origin, works behind school / office firewalls);
//   `?net=p2p` switches to PeerJS WebRTC data channels via the public PeerJS server instead.
//   Each client opens two data channels to the host: an ordered one for lobby / race control / items and an
//   unordered one ('state') for the 20 Hz kart snapshots, so one lost packet never stalls the others.
//
// Tournaments: every online race belongs to a tournament of `settings.rounds` races (1 = a single race).
//   Points follow GP_POINTS and are keyed by a stable entry key: `p:<token>` for humans (the token lives in
//   sessionStorage, so a reload or a dropped phone reconnects to the same standings) and `c:<charId>` for
//   CPU racers (fixed for the whole tournament). Between races the room is in the 'results' phase: everyone
//   sees the standings and the next race starts for all at `nextAt` (or earlier once every human is ready).
//   Players who join while a race is running wait (`waiting`) and are added to the next race.
//
// API:
//   const s = new NetSession()
//   await s.host({ name, charId })            -> creates a room; s.code is the 6-char room code
//   await s.join(code, { name, charId })      -> joins; rejects with a friendly Error (code not found, full...)
//   s.rejoin()                                -> join the last room again (same token = same standings)
//   s.role ('idle'|'host'|'client'), s.code, s.selfId, s.token, s.players [{ id, key, name, charId, ready, ping,
//   host, waiting }], s.settings { cc, trackId ('random'|'all'|'cup:<id>'|id), laps, cpus, items, rounds },
//   s.phase ('lobby'|'race'|'results'), s.tour (see _newTour) | null, s.nextAt (host clock ms) | null,
//   s.isHost, s.me, s.inTournament (a tournament with races left)
//   s.setMe({ charId?, ready?, name? })      s.updateSettings(partial)   (host)
//   s.startRace() (host)                      -> next race of the tournament (or a new one) for everyone
//   s.finishRound(results) (host)             -> scores a race, returns the tour snapshot
//   s.endTournament() (host)                  -> abandon the tournament, back to the lobby
//   s.send(msg)  (client -> host, host -> every client)   s.relay(msg, exceptPeerId) (host)
//   s.sendState(msg) / s.relayState(msg, exceptPeerId)     same, over the unordered channel
//   s.now() -> host clock in ms (clients estimate the offset with ping/pong)   s.nextIn() -> s until nextAt
//   s.syncClock()                              a quick burst of pings (before a race start)
//   s.leave()                                  closes everything
//   s.on(type, fn) -> off    events: 'lobby', 'start' (info), 'msg' (msg, fromPeerId), 'peerLeft' (peerId),
//                                    'closed' ({ reason, role, canRejoin }), 'loaded' (peerId, host only)
//   helpers: makeCode(), normalizeCode(text), inviteLink(code), loadNick(), saveNick(name), trackChoiceLabel(id)

import { RelayPeer } from './relay.js';
import { CHARACTERS } from '../data/characters.js';
import { TRACKS, CUPS, getTrackEntry } from '../data/tracks/index.js';
import { ENGINE_CLASSES, RACERS_PER_RACE, GP_POINTS } from '../data/engine.js';

export const NET_VERSION = 3; // 3: WebSocket relay transport
export const ROOM_PREFIX = 'ssk-room-';
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const CODE_LEN = 6;
export const MAX_PLAYERS = RACERS_PER_RACE || 8;
export const ROUND_CHOICES = [1, 2, 3, 4, 6, 8];
export const INTERMISSION_S = 20; // results -> next race (unless everyone is ready sooner)
const MIN_INTERMISSION_S = 6;
const HEARTBEAT_MS = 1000;
const TIMEOUT_MS = 12000;
const JOIN_TIMEOUT_MS = 15000;
const NICK_KEY = 'ssk.online.nick';
const TOKEN_KEY = 'ssk.online.token';

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

/** Invite link to the web version (the desktop app runs from app://, which friends cannot open). */
export const inviteLink = (code) =>
  /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname.replace(/[^/]*$/, '')}?join=${code}` : `https://kart.serika.dev/?join=${code}`;

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

/** Per-tab identity: survives a reload (sessionStorage) so a dropped player gets their standings back. */
function loadToken() {
  let t = null;
  try {
    t = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  if (!t || !/^[A-Za-z0-9]{8,24}$/.test(t)) {
    t = makeCode() + makeCode();
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* ignore */
    }
  }
  return t;
}

/** Course choices for the host: random / every course / a cup / one fixed course. */
export const TRACK_CHOICES = ['random', 'all', ...CUPS.map((c) => `cup:${c.id}`), ...TRACKS.map((t) => t.id), 'test-oval'];

export function trackChoiceLabel(id) {
  if (id === 'random') return 'Random Courses';
  if (id === 'all') return 'All Courses (in order)';
  if (String(id).startsWith('cup:')) return CUPS.find((c) => `cup:${c.id}` === id)?.name || id;
  return getTrackEntry(id)?.name || id;
}

/** 'relay' (default: WebSocket via the game server) or 'p2p' (PeerJS WebRTC, ?net=p2p). */
function transport() {
  try {
    return new URLSearchParams(location.search).get('net') === 'p2p' ? 'p2p' : 'relay';
  } catch {
    return 'relay';
  }
}

const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Sensei';
const validChar = (id) => (CHARACTERS.some((c) => c.id === id) ? id : 'serika');
const cleanToken = (t) => (typeof t === 'string' && /^[A-Za-z0-9]{8,24}$/.test(t) ? t : null);

function friendlyError(err) {
  const t = err?.type || '';
  if (t === 'peer-unavailable') return 'Room not found. Check the code and try again.';
  if (t === 'unavailable-id') return 'That room code is taken. Try again.';
  if (t === 'browser-incompatible') return 'This browser does not support online play (WebRTC).';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed' || t === 'disconnected')
    return 'Could not reach the game server. Check your internet connection and try again.';
  if (t === 'webrtc' || t === 'negotiation-failed') return 'Could not connect to the other player (a firewall or strict network may block peer-to-peer).';
  return err?.message || 'Connection failed.';
}

const defaultSettings = () => ({ cc: 150, trackId: 'random', laps: 3, cpus: true, items: true, rounds: 4 });

export class NetSession {
  constructor() {
    this.role = 'idle';
    this.code = null;
    this.selfId = null;
    this.token = loadToken();
    this.peer = null;
    this.conns = new Map(); // host: peerId -> { conn, stateConn, lastSeen, loaded }
    this.hostConn = null; // client
    this.stateConn = null; // client (unordered snapshots)
    this.players = [];
    this.settings = defaultSettings();
    this.phase = 'lobby';
    this.tour = null;
    this.nextAt = null;
    this.offset = 0; // host clock - local clock (ms)
    this.rtt = 0;
    this.raceInfo = null;
    this._handlers = new Map();
    this._timer = null;
    this._lastHostMsg = 0;
    this._closed = false;
    this._raceSeq = 0;
    this._last = null; // { code, name, charId } of the last joined room (for rejoin)
    this._pendingStates = new Map(); // host: state conns that opened before their hello
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
  /** A tournament is running and has races left. */
  get inTournament() {
    return !!(this.tour && !this.tour.done);
  }
  now() {
    return performance.now() + this.offset;
  }
  nextIn() {
    return this.nextAt == null ? null : Math.max(0, (this.nextAt - this.now()) / 1000);
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
        this.players = [{ id: peer.id, key: `p:${this.token}`, name: cleanName(name), charId: validChar(charId), ready: true, ping: 0, host: true, waiting: false }];
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

  async _makePeer(id) {
    if (transport() === 'p2p') {
      const { Peer } = await import('peerjs');
      return id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    }
    return new RelayPeer(id);
  }

  _openPeer(id) {
    return new Promise(async (resolve, reject) => {
      let peer;
      try {
        peer = await this._makePeer(id);
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
    if (conn.metadata?.kind === 'state') {
      // the unordered snapshot channel of a client (it may open before or after its hello)
      conn.on('open', () => {
        const c = this.conns.get(conn.peer);
        if (c) c.stateConn = conn;
        else this._pendingStates.set(conn.peer, conn);
      });
      conn.on('data', (msg) => {
        const c = this.conns.get(conn.peer);
        if (!c || !msg || msg.t !== 'S') return;
        c.lastSeen = performance.now();
        this._emit('msg', msg, conn.peer);
        this.relayState(msg, conn.peer);
      });
      const clear = () => {
        const c = this.conns.get(conn.peer);
        if (c?.stateConn === conn) c.stateConn = null;
        this._pendingStates.delete(conn.peer);
      };
      conn.on('close', clear);
      conn.on('error', clear);
      return;
    }
    conn.on('open', () => {
      const prev = this.conns.get(conn.peer);
      this.conns.set(conn.peer, { conn, stateConn: prev?.stateConn || this._takePendingState(conn.peer), lastSeen: performance.now(), loaded: false });
    });
    conn.on('data', (msg) => this._hostOnData(conn, msg));
    const drop = () => {
      if (this.conns.get(conn.peer)?.conn === conn) this._hostDrop(conn.peer);
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  _takePendingState(peerId) {
    const s = this._pendingStates.get(peerId) || null;
    this._pendingStates.delete(peerId);
    return s;
  }

  _hostOnData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const from = conn.peer;
    const c = this.conns.get(from);
    if (c) c.lastSeen = performance.now();
    let p = this.players.find((x) => x.id === from);
    switch (msg.t) {
      case 'hello': {
        const token = cleanToken(msg.token);
        // same tab reconnecting (dropped wifi, phone woke up, reload): take over its old seat
        const old = token && !p ? this.players.find((x) => !x.host && x.key === `p:${token}`) : null;
        let reason = null;
        if (msg.v !== NET_VERSION) reason = 'Game version mismatch — reload the page on both devices.';
        else if (this.players.length >= MAX_PLAYERS && !p && !old) reason = `The room is full (${MAX_PLAYERS}/${MAX_PLAYERS}).`;
        if (reason) {
          this._sendTo(conn, { t: 'reject', reason });
          setTimeout(() => conn.close(), 400);
          return;
        }
        if (!this.conns.has(from)) this.conns.set(from, { conn, stateConn: this._takePendingState(from), lastSeen: performance.now(), loaded: false });
        if (old) {
          const oldConn = this.conns.get(old.id);
          this.conns.delete(old.id);
          for (const x of [oldConn?.conn, oldConn?.stateConn]) {
            try {
              x?.close();
            } catch {
              /* ignore */
            }
          }
          if (this.phase === 'race' && this.raceInfo?.roster.some((r) => r.owner === old.id)) {
            // their kart in the running race becomes a CPU; they rejoin with the next race
            this.relay({ t: 'left', id: old.id }, from);
            this._emit('peerLeft', old.id);
          }
          old.id = from;
          p = old;
        }
        const busy = this.phase !== 'lobby';
        if (!p) {
          p = { id: from, key: `p:${token || from}`, name: '', charId: 'serika', ready: false, ping: 0, host: false, waiting: false };
          this.players.push(p);
        }
        p.name = cleanName(msg.name);
        p.charId = validChar(msg.charId);
        p.waiting = busy && this.phase === 'race'; // joins the next race
        this._sendTo(conn, { t: 'welcome', id: from, code: this.code, ...this._lobbyState() });
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
        if (msg.t === 'S') this.relayState(msg, from);
        else this.relay(msg, from);
    }
  }

  _hostDrop(peerId) {
    const c = this.conns.get(peerId);
    const wasPlayer = this.players.some((p) => p.id === peerId);
    if (!c && !wasPlayer) return;
    this.conns.delete(peerId);
    for (const x of [c?.conn, c?.stateConn]) {
      try {
        x?.close();
      } catch {
        /* ignore */
      }
    }
    this.players = this.players.filter((p) => p.id !== peerId);
    if (this.phase === 'race' && wasPlayer) {
      this.relay({ t: 'left', id: peerId });
      this._emit('peerLeft', peerId);
    }
    this._broadcastLobby();
  }

  _lobbyState() {
    return { players: this.players, settings: this.settings, phase: this.phase, tour: this.tour, nextAt: this.nextAt };
  }

  _broadcastLobby() {
    if (this.role !== 'host') return;
    this.send({ t: 'lobby', ...this._lobbyState() });
    this._emit('lobby');
  }

  updateSettings(partial = {}) {
    if (!this.isHost) return;
    const s = this.settings;
    if (partial.cc !== undefined && ENGINE_CLASSES[partial.cc]) s.cc = Number(partial.cc);
    if (partial.trackId !== undefined && TRACK_CHOICES.includes(partial.trackId)) s.trackId = partial.trackId;
    if (partial.laps !== undefined) s.laps = Math.max(1, Math.min(5, Math.round(partial.laps)));
    if (partial.cpus !== undefined) s.cpus = !!partial.cpus;
    if (partial.items !== undefined) s.items = !!partial.items;
    if (partial.rounds !== undefined && ROUND_CHOICES.includes(Number(partial.rounds))) s.rounds = Number(partial.rounds);
    this._broadcastLobby();
  }

  // ------------------------------------------------------------------------------------------ tournament
  _newTour() {
    const s = this.settings;
    const rounds = ROUND_CHOICES.includes(s.rounds) ? s.rounds : 1;
    return {
      id: `${this.code}-${Date.now() % 1e7}`,
      rounds,
      round: 0, // races finished so far
      trackMode: s.trackId,
      tracks: planTracks(s.trackId, rounds),
      cc: s.cc,
      points: {}, // key -> points after the last finished race
      before: {}, // key -> points before the last finished race
      lastPlaces: {}, // key -> place in the last finished race
      entries: {}, // key -> { name, charId, human }
      cpus: [], // CPU character ids, fixed for the tournament
      history: [], // [{ trackId, places: [{ key, place, time }] }]
      done: false,
    };
  }

  /** Host: sorted standings [{ key, points, name, charId, human, lastPlace }] (leader first). */
  standings(tour = this.tour) {
    return tourStandings(tour);
  }

  /** Host: build the roster/grid for the next race and start it for everyone. */
  startRace() {
    if (!this.isHost || this.phase === 'race') return null;
    const s = this.settings;
    if (!this.tour || this.tour.done) this.tour = this._newTour();
    const tour = this.tour;
    const round = tour.round + 1;
    const trackId = tour.tracks[round - 1] || pickRandomTrack(tour.tracks);

    // humans (waiting players join now) + a fixed CPU crew that makes up the rest of the grid
    const humans = this.players.slice(0, MAX_PLAYERS);
    const cpuN = s.cpus ? Math.max(0, MAX_PLAYERS - humans.length) : 0;
    if (tour.cpus.length > cpuN) {
      // drop the CPUs with the fewest points
      const ranked = [...tour.cpus].sort((a, b) => (tour.points[`c:${b}`] || 0) - (tour.points[`c:${a}`] || 0));
      tour.cpus = ranked.slice(0, cpuN);
    } else if (tour.cpus.length < cpuN) {
      const used = new Set([...humans.map((h) => h.charId), ...tour.cpus]);
      const pool = shuffle(CHARACTERS.map((c) => c.id));
      const fresh = [...pool.filter((id) => !used.has(id)), ...pool.filter((id) => used.has(id) && !tour.cpus.includes(id))];
      while (tour.cpus.length < cpuN && fresh.length) tour.cpus.push(fresh.shift());
    }
    let roster = [
      ...tour.cpus.map((id) => ({ charId: id, name: CHARACTERS.find((c) => c.id === id)?.name || id, owner: null, key: `c:${id}` })),
      ...humans.map((h) => ({ charId: h.charId, name: h.name, owner: h.id, key: h.key })),
    ];
    for (const r of roster) tour.entries[r.key] = { name: r.name, charId: r.charId, human: !!r.owner };
    if (round === 1) {
      // CPUs up front, humans at the back (like the single-player grid)
      roster = [...shuffle(roster.filter((r) => !r.owner)), ...shuffle(roster.filter((r) => r.owner))];
    } else {
      // reverse standings: the leader starts last
      const pts = (r) => tour.points[r.key] || 0;
      roster = shuffle(roster).sort((a, b) => pts(a) - pts(b));
    }
    roster.forEach((r, i) => (r.kartId = `k${i}`));
    this._raceSeq++;
    const info = {
      raceId: `${this.code}-${this._raceSeq}-${Date.now() % 100000}`,
      trackId,
      cc: s.cc,
      laps: s.laps,
      items: s.items,
      roster,
      host: this.selfId,
      round,
      rounds: tour.rounds,
      tourId: tour.id,
    };
    this.phase = 'race';
    this.nextAt = null;
    this.raceInfo = info;
    for (const c of this.conns.values()) c.loaded = false;
    for (const p of this.players) {
      p.waiting = false;
      if (!p.host) p.ready = false;
    }
    this.send({ t: 'start', info });
    this._broadcastLobby();
    this._emit('start', info);
    return info;
  }

  /** Host: score a finished race. Returns the tournament snapshot sent with the results. */
  finishRound(results) {
    if (!this.isHost || !this.tour || !this.raceInfo) return this.tour;
    const tour = this.tour;
    const info = this.raceInfo;
    if (info.tourId !== tour.id || tour.round >= info.round) return tour; // already scored
    tour.before = { ...tour.points };
    const places = [];
    for (const r of results || []) {
      const e = info.roster.find((x) => x.kartId === r.id);
      if (!e) continue;
      tour.points[e.key] = (tour.points[e.key] || 0) + (GP_POINTS[r.place - 1] || 0);
      if (!(e.key in tour.before)) tour.before[e.key] = 0;
      tour.lastPlaces[e.key] = r.place;
      places.push({ key: e.key, place: r.place, time: r.time });
    }
    tour.history.push({ trackId: info.trackId, places });
    tour.round = info.round;
    tour.done = tour.round >= tour.rounds;
    this.phase = tour.done ? 'lobby' : 'results';
    this.nextAt = tour.done ? null : this.now() + INTERMISSION_S * 1000;
    this._resultsAt = performance.now();
    for (const p of this.players) p.ready = !!p.host && tour.done;
    this._broadcastLobby();
    return tour;
  }

  /** Host: leave a tournament early (standings stay visible in the lobby). */
  endTournament() {
    if (!this.isHost || this.phase === 'race') return;
    if (this.tour) this.tour.done = true;
    this.phase = 'lobby';
    this.nextAt = null;
    for (const p of this.players) if (!p.host) p.ready = false;
    this._broadcastLobby();
  }

  /** Legacy: race over without scoring. */
  endRace() {
    if (!this.isHost) return;
    this.phase = 'lobby';
    this.nextAt = null;
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

  _hostIntermission() {
    if (this.phase !== 'results' || this.nextAt == null) return;
    const humans = this.players;
    const allReady = humans.length > 0 && humans.every((p) => p.ready);
    const since = (performance.now() - (this._resultsAt || 0)) / 1000;
    if (this.now() >= this.nextAt || (allReady && since >= MIN_INTERMISSION_S)) this.startRace();
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
        conn.on('open', () => this._sendTo(conn, { t: 'hello', v: NET_VERSION, token: this.token, name: cleanName(name), charId: validChar(charId) }));
        conn.on('data', (msg) => {
          if (msg?.t === 'welcome') {
            clearTimeout(to);
            this.role = 'client';
            this.code = code;
            this.selfId = msg.id || peer.id;
            this._applyLobby(msg);
            this._lastHostMsg = performance.now();
            resolve();
          } else if (msg?.t === 'reject') {
            fail({ message: msg.reason || 'The host refused the connection.' });
          } else if (this.role === 'client') this._clientOnData(msg);
        });
        conn.on('close', () => {
          if (this.role === 'client' && this.hostConn === conn) this._lost('The host left the room.', { rejoin: true });
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
    this._last = { code, name: cleanName(name), charId: validChar(charId) };
    this._openStateChannel(code);
    this._startTimer();
    this.syncClock();
    this._emit('lobby');
    return code;
  }

  /** Join the last room again (same tab token -> same seat and tournament points). */
  rejoin() {
    const last = this._last;
    if (!last) return Promise.reject(new Error('No room to rejoin.'));
    const me = this.me;
    return this.join(last.code, { name: me?.name || last.name, charId: me?.charId || last.charId });
  }

  _openStateChannel(code) {
    const peer = this.peer;
    if (!peer) return;
    try {
      const sc = peer.connect(ROOM_PREFIX + code, { reliable: false, serialization: 'json', metadata: { kind: 'state' } });
      sc.on('open', () => {
        if (this.peer === peer) this.stateConn = sc;
      });
      sc.on('data', (msg) => {
        if (this.role !== 'client' || !msg || msg.t !== 'S') return;
        this._lastHostMsg = performance.now();
        this._emit('msg', msg, this.hostConn?.peer);
      });
      const clear = () => {
        if (this.stateConn === sc) this.stateConn = null;
      };
      sc.on('close', clear);
      sc.on('error', clear);
    } catch (err) {
      console.warn('[net] state channel failed, using the main channel', err);
    }
  }

  _applyLobby(msg) {
    this.players = msg.players || this.players;
    this.settings = { ...defaultSettings(), ...(msg.settings || this.settings) };
    this.phase = msg.phase || this.phase;
    if ('tour' in msg) this.tour = msg.tour || null;
    if ('nextAt' in msg) this.nextAt = msg.nextAt ?? null;
  }

  _clientOnData(msg) {
    if (!msg || typeof msg !== 'object') return;
    this._lastHostMsg = performance.now();
    switch (msg.t) {
      case 'lobby':
        this._applyLobby(msg);
        this._emit('lobby');
        return;
      case 'pong': {
        const t1 = performance.now();
        const rtt = Math.max(0, t1 - msg.c);
        const off = msg.h + rtt / 2 - t1;
        // keep the offset of the fastest recent round trip (least queueing noise)
        if (!this._offSamples) this._offSamples = [];
        this._offSamples.push({ rtt, off });
        if (this._offSamples.length > 12) this._offSamples.shift();
        const best = this._offSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.offset = best.off;
        this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
        return;
      }
      case 'start':
        this.phase = 'race';
        this.nextAt = null;
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
    if (this._last) Object.assign(this._last, { name: me.name, charId: me.charId });
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

  /** Kart snapshots: the unordered channel when it is up, else the main one. */
  sendState(msg) {
    if (this.role === 'host') this.relayState(msg, null);
    else if (this.role === 'client') this._sendTo(this.stateConn?.open ? this.stateConn : this.hostConn, msg);
  }

  relayState(msg, exceptPeer) {
    if (this.role !== 'host') return;
    for (const [id, c] of this.conns) if (id !== exceptPeer) this._sendTo(c.stateConn?.open ? c.stateConn : c.conn, msg);
  }

  _sendPing() {
    if (this.role !== 'client') return;
    this.send({ t: 'ping', c: performance.now(), rtt: this.rtt });
  }

  /** A short burst of pings for a sharper clock offset (join / race load). */
  syncClock(n = 6, gap = 160) {
    if (this.role !== 'client') return;
    for (let i = 0; i < n; i++) setTimeout(() => this._sendPing(), i * gap);
  }

  _startTimer() {
    clearInterval(this._timer);
    let tick = 0;
    this._timer = setInterval(() => {
      tick++;
      const now = performance.now();
      if (this.role === 'client') {
        this._sendPing();
        if (now - this._lastHostMsg > TIMEOUT_MS) this._lost('Lost the connection to the host.', { rejoin: true });
      } else if (this.role === 'host') {
        for (const [id, c] of this.conns) if (now - c.lastSeen > TIMEOUT_MS) this._hostDrop(id);
        this._hostIntermission();
        if (tick % 2 === 0 && this.phase !== 'race') this._broadcastLobby(); // ping refresh
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

  _lost(reason, { rejoin = false } = {}) {
    if (this._closed || this.role === 'idle') return;
    const wasRole = this.role;
    this._teardown();
    this._emit('closed', { reason, role: wasRole, canRejoin: rejoin && wasRole === 'client' && !!this._last });
  }

  leave() {
    this._last = null; // no automatic rejoin after this
    if (this.role === 'idle') return;
    try {
      if (this.role === 'client') this.send({ t: 'bye' });
      else this.send({ t: 'kick', reason: 'The host closed the room.' });
    } catch {
      /* ignore */
    }
    const peer = this.peer;
    this._last = null;
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
      for (const x of [c.conn, c.stateConn]) {
        try {
          x?.close();
        } catch {
          /* ignore */
        }
      }
    }
    this.conns.clear();
    this._pendingStates.clear();
    this.hostConn = null;
    this.stateConn = null;
    this.peer = null;
    this.role = 'idle';
    this.phase = 'lobby';
    this.raceInfo = null;
    this.nextAt = null;
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
    this.tour = null;
    this.nextAt = null;
    this.settings = defaultSettings();
  }
}

// ------------------------------------------------------------------------------------------------ helpers

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandomTrack(used = []) {
  const fresh = TRACKS.filter((t) => !used.includes(t.id));
  const list = fresh.length ? fresh : TRACKS;
  return list[Math.floor(Math.random() * list.length)].id;
}

/** The course of every race of a tournament. */
export function planTracks(mode, rounds) {
  const out = [];
  if (mode === 'random') {
    let bag = [];
    for (let i = 0; i < rounds; i++) {
      if (!bag.length) bag = shuffle(TRACKS.map((t) => t.id)).filter((id) => id !== out[out.length - 1]);
      out.push(bag.shift());
    }
    return out;
  }
  let list;
  if (mode === 'all') list = TRACKS.map((t) => t.id);
  else if (String(mode).startsWith('cup:')) list = CUPS.find((c) => `cup:${c.id}` === mode)?.tracks || [];
  else list = getTrackEntry(mode) ? [mode] : [];
  if (!list.length) return planTracks('random', rounds);
  for (let i = 0; i < rounds; i++) out.push(list[i % list.length]);
  return out;
}

/** Sorted standings of a tour snapshot: [{ key, points, name, charId, human, lastPlace }]. */
export function tourStandings(tour) {
  if (!tour) return [];
  return Object.entries(tour.entries || {})
    .map(([key, e]) => ({ key, points: tour.points?.[key] || 0, name: e.name, charId: e.charId, human: !!e.human, lastPlace: tour.lastPlaces?.[key] ?? 99 }))
    .sort((a, b) => b.points - a.points || a.lastPlace - b.lastPlace);
}

// ------------------------------------------------------------------------------------------------ singleton
let _session = null;
export function getSession() {
  if (!_session) _session = new NetSession();
  return _session;
}
