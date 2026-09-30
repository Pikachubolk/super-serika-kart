// Online race synchronisation (owner: online agent). One instance per online race, passed to Race as
// `opts.online`. Race calls the hooks below; everything else (network, puppets, results) lives here.
//
// Model: every client is authoritative for ITS OWN kart (the host also for CPU karts and for karts of players
// that disconnected). Karts simulated elsewhere are "net puppets": Race skips their physics and calls
// applyRemote() every fixed step, which writes the interpolated pose (~100 ms behind, extrapolated when late)
// and the visual flags/timers straight onto the Kart so Kart.updateVisual renders them normally.
// Items: whoever uses an item broadcasts { item id, uses, look-back }; every other client replays useItem()
// on its puppet. Hits are only applied to karts simulated locally (puppet hit methods are no-ops), so there
// is no double counting — the victim's own client applies it and streams the result.
//
// Race hooks: roster, localKartId, simulates(entry), attach(race), applyRemote(kart, dt), beforeUse(kart),
//   afterItems(), onLocalFinish(), update(dt), secondsToGo(), startAt, detach()

const SEND_HZ = 20;
const INTERP_MS = 100;
const MAX_EXTRAP_MS = 250;
const LOAD_TIMEOUT_MS = 20000;
const GO_LEAD_MS = 4500;
const ALL_DONE_DELAY = 2.5; // s after the last human finishes
const STRAGGLER_TIMEOUT = 40; // s after the first human finishes
const MIN_AFTER_OWN_FINISH = 4.5; // let the host's own finish banner play
const PUPPET_NOOPS = ['spinOut', 'launch', 'shrink', 'squish', 'respawn'];

const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const F_GROUNDED = 1;
const F_DRIFT = 2;
const F_OFFROAD = 4;
const F_FINISHED = 8;
const F_ROULETTE = 16;
const F_ITEMHELD = 32;
const F_LOOKBACK = 64;
const F_RAMPAIR = 128;

export class NetRaceSync {
  constructor(session, info, { autopilot = false } = {}) {
    this.session = session;
    this.info = info;
    this.roster = info.roster;
    this.autopilot = autopilot;
    const mine = info.roster.find((r) => r.owner === session.selfId);
    this.localKartId = mine?.kartId || null;
    this.isHost = session.isHost;
    this.startAt = null;
    this.race = null;
    this.buffers = new Map(); // kartId -> snapshots (ascending ts)
    this.latest = new Map(); // kartId -> newest snapshot
    this._sendAcc = 0;
    this._pre = null;
    this._replaying = false;
    this._done = false;
    this._loadStart = performance.now();
    this._firstHumanFinish = null;
    this._allDoneAt = null;
    this._ownFinishAt = null;
    this._offs = [];
    this.hostLeft = false;
    this.stats = { statesSent: 0, statesRecv: 0, itemsSent: 0, itemsReplayed: 0, takeovers: 0 };
    this._offs.push(session.on('msg', (m, from) => this._onMsg(m, from)));
    this._offs.push(session.on('peerLeft', (id) => this._onPeerLeft(id)));
    this._offs.push(session.on('closed', (e) => this._onClosed(e)));
    if (this.isHost) this._offs.push(session.on('loaded', () => this._maybeGo()));
    window.__ssk = window.__ssk || {};
    window.__ssk.netSync = this;
  }

  /** Does this client run the physics for that roster entry? */
  simulates(entry) {
    if (!entry) return false;
    if (entry.owner === this.session.selfId) return true;
    return this.isHost && !entry.owner;
  }

  entryFor(kartId) {
    return this.roster.find((r) => r.kartId === kartId) || null;
  }

  // ============================================================================================ attach
  attach(race) {
    this.race = race;
    this.kartsById = new Map();
    for (const k of race.karts) {
      this.kartsById.set(k.id, k);
      const e = this.entryFor(k.id);
      if (e?.owner && e.owner !== this.session.selfId) k.netPlayer = true; // for labels
      if (!this.simulates(e)) this._makePuppet(k);
    }
    if (!this.info.items && race.items) {
      race.items.enabled = false;
      race.items.boxes?.setVisible?.(false);
    }
    this._offs.push(race.events.on('itemUse', (p) => this._onItemUse(p)));
    if (this.isHost) {
      this._maybeGo();
      // background tabs get no animation frames: keep the host's start / results decisions ticking anyway
      this._hostTimer = setInterval(() => {
        if (!this.race || this._done) return;
        try {
          if (this.startAt == null) this._maybeGo();
          this._hostResults();
        } catch (err) {
          console.warn('[net] host tick failed', err);
        }
      }, 250);
    } else this.session.send({ t: 'loaded' });
  }

  _makePuppet(k) {
    k.netRemote = true;
    for (const m of PUPPET_NOOPS) k[m] = () => false;
    k.loseCoins = () => 0;
  }

  _unPuppet(k) {
    k.netRemote = false;
    for (const m of PUPPET_NOOPS) delete k[m];
    delete k.loseCoins;
  }

  detach() {
    clearInterval(this._hostTimer);
    for (const off of this._offs) off?.();
    this._offs.length = 0;
    this.race = null;
    if (window.__ssk?.netSync === this) window.__ssk.netSync = null;
  }

  // ============================================================================================ start
  _maybeGo() {
    if (!this.isHost || this.startAt != null || !this.race) return;
    const waited = performance.now() - this._loadStart;
    if (!this.session.allLoaded() && waited < LOAD_TIMEOUT_MS) return;
    this.startAt = this.session.now() + GO_LEAD_MS;
    this.session.send({ t: 'go', at: this.startAt, raceId: this.info.raceId });
  }

  secondsToGo() {
    return this.startAt == null ? Infinity : (this.startAt - this.session.now()) / 1000;
  }

  // ============================================================================================ messages
  _onMsg(m, from) {
    if (!m || (m.raceId && m.raceId !== this.info.raceId)) return;
    switch (m.t) {
      case 'go':
        if (!this.isHost) this.startAt = m.at;
        break;
      case 'S':
        if (Array.isArray(m.a)) for (const s of m.a) this._pushState(s);
        break;
      case 'item':
        this._replayItem(m);
        break;
      case 'results':
        if (!this.isHost) this._deliver(m.results);
        break;
    }
  }

  _pushState(s) {
    if (!s || !s.k) return;
    const k = this.kartsById?.get(s.k);
    if (k && !k.netRemote) return; // we own it (e.g. taken over)
    let buf = this.buffers.get(s.k);
    if (!buf) this.buffers.set(s.k, (buf = []));
    if (buf.length && s.ts <= buf[buf.length - 1].ts) return; // out of order / duplicate
    buf.push(s);
    this.stats.statesRecv++;
    if (buf.length > 30) buf.splice(0, buf.length - 30);
    this.latest.set(s.k, s);
  }

  _onPeerLeft(peerId) {
    const race = this.race;
    for (const e of this.roster) {
      if (e.owner !== peerId) continue;
      e.owner = null;
      e.left = true;
      const k = this.kartsById?.get(e.kartId);
      if (k) {
        k.name = `${e.name} (CPU)`;
        if (this.isHost && race) {
          this._unPuppet(k);
          race.netTakeOver?.(k);
          this.stats.takeovers++;
        }
      }
      try {
        race?.hud?.notify?.(`${e.name} disconnected`, { color: '#ff6b87', duration: 2.5 });
      } catch {
        /* ignore */
      }
    }
  }

  _onClosed(e) {
    if (this._done || !this.race || e?.role === 'left') return;
    // the host is gone (or our link to it): end the race locally with what we know
    this.hostLeft = true;
    try {
      this.race.hud?.notify?.(e?.reason || 'Connection lost', { color: '#ff6b87', duration: 3 });
    } catch {
      /* ignore */
    }
    const race = this.race;
    setTimeout(() => {
      if (this._done || this.race !== race) return;
      this._deliver(race.getResults(), { hostLeft: true, reason: e?.reason });
    }, 2500);
  }

  // ============================================================================================ items
  beforeUse(k) {
    this._pre = { kart: k, item: k.item, uses: k.itemUses, roulette: !!k.roulette?.active };
  }

  _onItemUse({ kart, itemId }) {
    if (this._replaying || !kart || kart.netRemote) return;
    const pre = this._pre && this._pre.kart === kart ? this._pre : null;
    this.stats.itemsSent++;
    this.session.send({
      t: 'item',
      raceId: this.info.raceId,
      k: kart.id,
      id: itemId,
      u: pre && pre.item === itemId ? pre.uses : kart.itemUses + 1,
      b: !!kart.controls?.lookBack,
    });
    this._pre = null;
  }

  _replayItem(m) {
    const race = this.race;
    const k = this.kartsById?.get(m.k);
    if (!race?.items || !k || !k.netRemote) return;
    this._replaying = true;
    try {
      if (k.roulette) k.roulette.active = false;
      k.item = m.id;
      k.itemUses = m.u || 1;
      k.controls.lookBack = !!m.b;
      k.controls.item = true;
      race.items.useItem(k);
      this.stats.itemsReplayed++;
    } catch (err) {
      console.warn('[net] item replay failed', err);
    } finally {
      this._replaying = false;
    }
  }

  /** Called after items.update: the puppets' item slots come from the network, not local pickups. */
  afterItems() {
    if (!this.race) return;
    for (const k of this.race.karts) {
      if (!k.netRemote) continue;
      const s = this.latest.get(k.id);
      k.item = s?.it || null;
      k.itemUses = s?.iu || 0;
      if (k.roulette) {
        k.roulette.active = !!(s && s.f & F_ROULETTE);
        k.roulette.time = 0;
        k.roulette.duration = 99;
      }
    }
  }

  // ============================================================================================ puppets
  applyRemote(k, dt) {
    const buf = this.buffers.get(k.id);
    k.prevPosition.copy(k.position);
    k.prevYaw = k.yaw;
    if (!buf || !buf.length) return;
    const T = this.session.now() - INTERP_MS;
    let a = buf[0];
    let b = null;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].ts <= T) {
        a = buf[i];
        b = buf[i + 1] || null;
        break;
      }
    }
    // drop snapshots we no longer need
    const ai = buf.indexOf(a);
    if (ai > 2) buf.splice(0, ai - 1);

    if (b && T >= a.ts) {
      const t = (T - a.ts) / Math.max(1, b.ts - a.ts);
      k.position.set(lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t));
      k.velocity.set(lerp(a.v[0], b.v[0], t), lerp(a.v[1], b.v[1], t), lerp(a.v[2], b.v[2], t));
      k.yaw = lerpAngle(a.y, b.y, t);
      k.speed = lerp(a.s, b.s, t);
    } else {
      // extrapolate from the newest (or hold the oldest when we are ahead of the buffer)
      const e = Math.min(MAX_EXTRAP_MS, Math.max(0, T - a.ts)) / 1000;
      k.position.set(a.p[0] + a.v[0] * e, a.p[1] + a.v[1] * e, a.p[2] + a.v[2] * e);
      k.velocity.set(a.v[0], a.v[1], a.v[2]);
      k.yaw = a.y;
      k.speed = a.s;
    }
    if (k.position.distanceToSquared(k.prevPosition) > 400) k.prevPosition.copy(k.position); // teleport (respawn)
    k.vy = k.velocity.y;
    const path = this.race.track.path;
    k.proj = path.project(k.position, k.proj?.index ?? null, k.proj || {});
    if (a.f & F_GROUNDED && k.proj.frame?.up) k.up.copy(k.proj.frame.up);
    const fx = Math.sin(k.yaw);
    const fz = Math.cos(k.yaw);
    k.forward?.set(fx, 0, fz);
    k.right?.set(-fz, 0, fx);

    // flags + timers (aged from snapshot a to the render time)
    const age = Math.max(0, (T - a.ts) / 1000);
    const tm = a.tm;
    const dec = (v) => Math.max(0, v - age);
    k.grounded = !!(a.f & F_GROUNDED);
    k.offroad = !!(a.f & F_OFFROAD);
    k._rampAir = !!(a.f & F_RAMPAIR);
    const D = k.drift;
    D.active = !!(a.f & F_DRIFT);
    D.dir = a.d[0];
    D.level = a.d[1];
    D.charge = a.d[2];
    D.tight = a.d[3];
    k.boostTime = dec(tm[0]);
    k.boostStrength = tm[1];
    k.spinTime = dec(tm[2]);
    k._spinDuration = tm[3] || 1.1;
    k._spinDir = tm[4] || 1;
    k.launchTime = dec(tm[5]);
    k._launchDuration = tm[6] || 1.5;
    k._tumbleSide = tm[7] || 1;
    k.trickTime = dec(tm[8]);
    k._trickStyle = tm[9] || 0;
    k.shrinkTime = dec(tm[10]);
    k.squishTime = dec(tm[11]);
    k.invincibleTime = dec(tm[12]);
    k.respawnTime = dec(tm[13]);
    k.graceTime = dec(tm[14]);
    k.stallTime = dec(tm[15]);
    k.airTime = tm[16] || 0;
    const c = k.controls;
    c.throttle = a.c[0];
    c.brake = a.c[1];
    c.steer = a.c[2];
    c.item = !!(a.f & F_ITEMHELD);
    c.lookBack = !!(a.f & F_LOOKBACK);
    c.itemPressed = false;
    c.driftPressed = false;
    k._steer = a.c[2];

    // race bookkeeping follows the newest state (places react quickly)
    const s = this.latest.get(k.id) || a;
    k.progress = s.pr;
    k.lap = s.lap;
    k.lapTimes = s.lt || k.lapTimes;
    k.coins = s.co || 0;
    if (s.f & F_FINISHED && !k.finished) {
      k.finished = true;
      k.finishTime = s.ft;
      this.race.events?.emit?.('finish', { kart: k, place: k.place, time: s.ft });
    }
  }

  _snapshot(k, ts) {
    const D = k.drift || {};
    let f = 0;
    if (k.grounded) f |= F_GROUNDED;
    if (D.active) f |= F_DRIFT;
    if (k.offroad) f |= F_OFFROAD;
    if (k.finished) f |= F_FINISHED;
    if (k.roulette?.active) f |= F_ROULETTE;
    if (k.controls?.item) f |= F_ITEMHELD;
    if (k.controls?.lookBack) f |= F_LOOKBACK;
    if (k._rampAir) f |= F_RAMPAIR;
    const p = k.position;
    const v = k.velocity;
    return {
      k: k.id,
      ts: Math.round(ts),
      p: [r3(p.x), r3(p.y), r3(p.z)],
      v: [r2(v.x), r2(v.y), r2(v.z)],
      y: r3(k.yaw),
      s: r2(k.speed || 0),
      f,
      d: [D.dir || 0, D.level || 0, r2(D.charge || 0), r2(D.tight || 0)],
      tm: [
        r2(k.boostTime || 0),
        r2(k.boostStrength || 1),
        r2(k.spinTime || 0),
        r2(k._spinDuration || 1.1),
        k._spinDir || 1,
        r2(k.launchTime || 0),
        r2(k._launchDuration || 1.5),
        k._tumbleSide || 1,
        r2(k.trickTime || 0),
        k._trickStyle || 0,
        r2(k.shrinkTime || 0),
        r2(k.squishTime || 0),
        r2(k.invincibleTime || 0),
        r2(k.respawnTime || 0),
        r2(k.graceTime || 0),
        r2(k.stallTime || 0),
        r2(k.airTime || 0),
      ],
      c: [r2(k.controls?.throttle || 0), r2(k.controls?.brake || 0), r2(k._steer ?? k.controls?.steer ?? 0)],
      pr: r2(k.progress || 0),
      lap: k.lap || 1,
      ft: k.finished ? k.finishTime : null,
      lt: k.lapTimes?.length ? k.lapTimes.map(r3) : undefined,
      it: k.item || null,
      iu: k.itemUses || 0,
      co: k.coins || 0,
    };
  }

  // ============================================================================================ per frame
  update(dt) {
    const race = this.race;
    if (!race || this._done) return;
    if (this.isHost && this.startAt == null) this._maybeGo();
    this._sendAcc += dt;
    if (this._sendAcc >= 1 / SEND_HZ) {
      this._sendAcc %= 1 / SEND_HZ;
      const ts = this.session.now();
      const a = [];
      for (const k of race.karts) if (!k.netRemote) a.push(this._snapshot(k, ts));
      if (a.length) {
        this.session.send({ t: 'S', raceId: this.info.raceId, a });
        this.stats.statesSent += a.length;
      }
    }
    if (this.isHost) this._hostResults(dt);
  }

  onLocalFinish() {
    this._ownFinishAt = performance.now();
  }

  _hostResults() {
    const race = this.race;
    if (race.phase !== 'racing' && race.phase !== 'finished') return;
    const humans = this.roster.filter((e) => e.owner);
    if (!humans.length) return;
    const now = performance.now();
    const karts = humans.map((e) => this.kartsById.get(e.kartId)).filter(Boolean);
    const anyDone = karts.some((k) => k.finished);
    if (anyDone && this._firstHumanFinish == null) this._firstHumanFinish = now;
    const allDone = karts.every((k) => k.finished);
    if (allDone && this._allDoneAt == null) this._allDoneAt = now;
    const ownOk = !race.player?.finished || (this._ownFinishAt != null && now - this._ownFinishAt > MIN_AFTER_OWN_FINISH * 1000);
    const ready =
      (this._allDoneAt != null && now - this._allDoneAt > ALL_DONE_DELAY * 1000 && ownOk) ||
      (this._firstHumanFinish != null && now - this._firstHumanFinish > STRAGGLER_TIMEOUT * 1000);
    if (!ready) return;
    const results = race.getResults().map((r) => ({ ...r, isPlayer: false }));
    this.session.send({ t: 'results', raceId: this.info.raceId, results });
    this.session.endRace();
    this._deliver(results);
  }

  _deliver(results, extra = {}) {
    if (this._done) return;
    this._done = true;
    const race = this.race;
    const list = (results || []).map((r) => {
      const e = this.entryFor(r.id);
      return { ...r, isPlayer: r.id === this.localKartId, online: true, human: !!(e && (e.owner || e.left)), name: r.name || e?.name };
    });
    this.finalResults = list;
    this.resultExtra = extra;
    if (race && typeof race.onFinish === 'function') race.onFinish(list);
  }
}

export default NetRaceSync;
