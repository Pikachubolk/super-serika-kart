// Race (owner: race agent) — one race: builds the world, runs the fixed-step simulation and conducts every
// player-facing moment (intro, countdown, laps, places, hits, finish, results). ARCHITECTURE.md §10.
//
// API CONTRACT:
//   new Race(game, { mode:'gp'|'vs'|'tt', cc, trackId, playerCharacterId, rivalIds?, gridOrder?, laps?, autopilot?, quality? })
//   await race.load(onProgress?)     builds track, karts, AI, items, particles, HUD; precompiles shaders
//   race.start() -> Promise          intro flyover (+ title card, skippable with confirm) -> countdown -> GO
//   race.update(dt)                  per rendered frame (fixed 120 Hz physics steps inside, max 12 per frame)
//   race.render(renderer)
//   race.pause() / race.resume()     freezes the simulation, timers, camera and audio (audio.setPaused)
//   race.getHudState() -> HudState   (§10; the returned object is reused between calls)
//   race.getResults() -> Result[]    sorted by place; unfinished karts get an estimated time
//   race.onFinish = (results) => {}  called ~4.5 s after the player crosses the line
//   race.events (EventBus), race.scene, race.camera, race.dispose()
//
// ADDITIONS:
//   race.phase ('loading'|'intro'|'countdown'|'racing'|'finished'), race.time (s since GO), race.laps,
//   race.mode, race.track, race.karts, race.player, race.items, race.particles, race.hud, race.chase,
//   race.drivers (Map kart -> AIDriver), race.world, race.ttRecord ({ time, lapTimes, characterId } | null)
//   race.sfx(name, position?, opts?)   full volume for the player's own sounds, distance attenuated + panned
//                                      for others (silent beyond 60 u)
//   race.later(seconds, fn)            simulation-time timer (frozen while paused, cancelled by dispose)
//   race.isWrongWay(kart) -> bool
//   race.skipIntro()
//   race.stats -> { steps, maxStepsHit, introAt, countdownAt, goAt }   (performance.now() stamps, for tools)
//   ONLINE: opts.online = NetRaceSync (src/net/NetRaceSync.js) -> race.net. Roster/grid come from it, karts
//   simulated on other clients are puppets (kart.netRemote: physics skipped, net.applyRemote writes the pose),
//   countdown is aligned to net.startAt, results come from the host. race.netTakeOver(kart) turns a puppet
//   into a locally simulated CPU kart (host, when its player disconnects). Single-player paths are unchanged.
// Events on race.events (besides the ItemSystem / Kart ones: 'hit', 'hazardHit', 'itemGet', 'itemUse', 'coin',
//   'tablet', 'explosion', 'itemBox', 'rouletteStart'):
//   'intro' {}, 'countdown' { n }, 'go' {}, 'lap' { kart, lap, final, lapTime }, 'finalLap' { kart },
//   'finish' { kart, place, time }, 'place' { kart, place, prev }, 'wrongWay' { kart, on }, 'respawn' { kart },
//   'raceEnd' { results }
// Time Trial record: localStorage['ssk.tt.<trackId>'] = { time, lapTimes, characterId } (see raceUtils.js).

import * as THREE from 'three';
import { EventBus } from '../core/EventBus.js';
import { loadTrackDef, getTrackEntry, CUPS } from '../data/tracks/index.js';
import { getCharacter } from '../data/characters.js';
import { ENGINE_CLASSES, PHYSICS_DT, MAX_CREDITS, DEFAULT_LAPS } from '../data/engine.js';
import { TIME_TRIAL_ITEM } from '../data/items.js';
import { buildTrack } from '../world/TrackBuilder.js';
import { Kart, resolveKartCollisions, resolveHazardCollisions } from '../entities/Kart.js';
import { AIDriver } from '../entities/AIDriver.js';
import { ItemSystem } from '../entities/ItemSystem.js';
import { Particles } from './Particles.js';
import { ChaseCamera } from './Camera.js';
import { HUD } from '../ui/HUD.js';
import { mulberry32, hashString, clamp } from '../core/utils.js';
import { buildRoster, buildGridOrder, aiProfile } from './roster.js';
import { RaceFeedback } from './feedback.js';
import { collectResources, disposeResources, readTTRecord, writeTTRecord, yieldFrame } from './raceUtils.js';

const MAX_STEPS = 12; // per rendered frame (0.1 s): beyond that the simulation slows down instead of spiralling
const INTRO_DURATION = 4.6;
const PRE_COUNT = 0.55; // s of calm between the flyover and the "3"
const COUNT_FROM = 3;
const FINISH_DELAY = 4.5; // s from the player's finish to onFinish(results)
const SECTORS = 16; // anti-cheat: a lap needs >= half of these sectors visited since the last line crossing
const FULL_MASK = (1 << SECTORS) - 1;
const SFX_RANGE = 60;
const WRONG_WAY_TIME = 0.7;

const _v = new THREE.Vector3();
const _camRight = new THREE.Vector3();

function popcount(m) {
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

export class Race {
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = { mode: 'vs', cc: 150, laps: undefined, autopilot: false, ...opts };
    this.net = this.opts.online || null;
    this.mode = this.opts.mode === 'gp' || this.opts.mode === 'tt' ? this.opts.mode : 'vs';
    this.events = new EventBus();
    this.scene = new THREE.Scene();
    const aspect = typeof window !== 'undefined' && window.innerHeight ? window.innerWidth / window.innerHeight : 16 / 9;
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 2500);
    this.karts = [];
    this.drivers = new Map();
    this.phase = 'loading';
    this.time = 0;
    this.simTime = 0;
    this.countdownLeft = COUNT_FROM + PRE_COUNT;
    this.paused = false;
    this.disposed = false;
    this.acc = 0;
    this.onFinish = null;
    this.player = null;
    this.laps = DEFAULT_LAPS;
    this.ttRecord = null;
    this.stats = { steps: 0, maxStepsHit: 0 };
    this.rng = mulberry32(hashString(`${this.opts.trackId}:${this.opts.playerCharacterId}:${this.opts.cc}`));
    this._timers = [];
    this._order = [];
    this._lastCount = null;
    this._engineSound = null;
    this._finishNotified = false;
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._sfxOpts = { volume: 1, pitch: 1, pan: 0 };
    this._hud = null; // reused HudState
    this._placeCmp = (a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress || a.index - b.index;
    };
    if (typeof window !== 'undefined') {
      window.__ssk = window.__ssk || {};
      window.__ssk.race = this;
    }
  }

  // ================================================================================================ loading

  async load(onProgress = () => {}) {
    const report = (p) => {
      try {
        onProgress(p);
      } catch {
        /* ignore */
      }
    };
    const { trackId, playerCharacterId } = this.opts;
    const quality = this.opts.quality || this.game?.settings?.quality || 'high';
    this.quality = quality;
    this.engine = ENGINE_CLASSES[this.opts.cc] || ENGINE_CLASSES[150];
    report(0.05);

    const def = await loadTrackDef(trackId);
    if (this.disposed) return;
    report(0.15);
    await yieldFrame();
    this.track = buildTrack(def, { quality });
    if (this.disposed) return this.track.dispose();
    const lapsOpt = Number(this.opts.laps);
    this.laps = lapsOpt >= 1 ? Math.round(lapsOpt) : this.track.laps || def.laps || DEFAULT_LAPS;
    this.scene.add(this.track.group);
    this.track.applyEnvironment(this.scene);
    this.track.setStartLights?.(0);
    this.pathLength = this.track.path.length;
    report(0.5);
    await yieldFrame();

    this.particles = new Particles(this.scene, { quality });

    // ---- roster, grid, karts
    const net = this.net;
    let order, playerId;
    if (net) {
      // online: the host's roster is the grid (slot 0 = pole); kart ids are roster ids (duplicates allowed)
      order = net.roster.map((e) => e.charId);
      playerId = null;
    } else {
      const roster = buildRoster({ mode: this.mode, playerCharacterId, rivalIds: this.opts.rivalIds });
      playerId = roster[0].id;
      order = buildGridOrder(roster, this.opts.gridOrder);
    }
    for (let slot = 0; slot < order.length; slot++) {
      const ch = getCharacter(order[slot]);
      const entry = net ? net.roster[slot] : null;
      const isPlayer = net ? entry.kartId === net.localKartId : ch.id === playerId;
      const kart = new Kart({ id: entry ? entry.kartId : ch.id, index: slot, character: ch, track: this.track, isPlayer, engine: this.engine, quality });
      if (entry?.name) kart.name = entry.name;
      kart.reset(this.track.path.gridSlot(slot, order.length));
      this._initBookkeeping(kart);
      this.karts.push(kart);
      this.scene.add(kart.object3d);
      if (isPlayer) this.player = kart;
      report(0.5 + (0.25 * (slot + 1)) / order.length);
      if (slot % 2 === 1) await yieldFrame();
      if (this.disposed) return;
    }

    // ---- AI (racing line is solved once per track and cached)
    for (const kart of this.karts) {
      if (kart.isPlayer && !this.opts.autopilot) continue;
      if (net && !kart.isPlayer && !net.simulates(net.entryFor(kart.id))) continue; // puppet
      this._addDriver(kart);
    }
    report(0.8);
    await yieldFrame();
    if (this.disposed) return;

    this.items = new ItemSystem({
      scene: this.scene,
      track: this.track,
      karts: this.karts,
      particles: this.particles,
      sfx: (name, pos, o) => this.sfx(name, pos, o),
      events: this.events,
      mode: this.mode,
      rng: this.rng,
      quality,
    });

    this.chase = new ChaseCamera(this.camera);
    this.chase.setTarget(this.player);
    this.chase.snap();

    this.world = {
      time: 0,
      phase: 'intro',
      countdownLeft: this.countdownLeft,
      track: this.track,
      karts: this.karts,
      player: this.player,
      particles: this.particles,
      items: this.items,
      mode: this.mode,
      engine: this.engine,
      sfx: (name, pos, o) => this.sfx(name, pos, o),
      events: this.events,
      camera: this.camera,
    };

    // ---- HUD
    const entry = getTrackEntry(trackId);
    this.subtitle = this._subtitle(entry);
    this.hud = new HUD(this.game.hudRoot, {
      racers: this.karts.map((k) => ({ id: k.id, characterId: k.characterId, name: k.name, isPlayer: k.isPlayer })),
      laps: this.laps,
      track: { name: this.track.name, outline: this.track.minimap.outline, bounds: this.track.minimap.bounds },
      portraits: this.game.portraits,
      mode: this.mode,
      settings: this.game.settings,
      subtitle: this.subtitle,
      cupName: this._cupName(entry),
    });
    this.hud.hide?.();
    this.feedback = new RaceFeedback(this);
    if (this.mode === 'tt') this.ttRecord = readTTRecord(trackId);
    this._updatePlaces();
    report(0.9);

    // ---- warm up: one visual update + shader precompile so GO does not hitch
    for (const k of this.karts) k.updateVisual(0, 1);
    this.items.updateVisual?.(0, 1);
    this.track.updateShadowFocus(this.player.position);
    await this._precompile();
    if (this.disposed) return;
    this.net?.attach(this);
    report(1);
    this.phase = 'intro';
  }

  _initBookkeeping(kart) {
    const path = this.track.path;
    kart.progress = path.deltaD(kart.proj.d, 0); // slightly negative behind the line
    kart.lap = 1;
    kart.lapTimes = [];
    kart.finished = false;
    kart.finishTime = null;
    kart._lastD = kart.proj.d;
    kart._sectors = FULL_MASK; // the grid counts as a complete lap-0
    kart._lapStart = 0;
    kart._lapIndex = 1; // lap the kart is currently on (validated)
  }

  _addDriver(kart) {
    const { skill, personality } = aiProfile(kart.characterId, this.engine, this.rng, { isPlayer: kart.isPlayer });
    const ai = new AIDriver(kart, { track: this.track, skill, engine: this.engine, personality });
    this.drivers.set(kart, ai);
    return ai;
  }

  _cupName(entry) {
    const cup = entry?.cup ? CUPS.find((c) => c.id === entry.cup) : null;
    return cup?.name || '';
  }

  _subtitle(entry) {
    const cc = `${this.engine?.cc ?? this.opts.cc}cc`;
    if (this.mode === 'tt') return 'Time Trial';
    if (this.mode === 'gp') {
      const cup = this._cupName(entry) || 'Grand Prix';
      const idx = this.game?.gp?.raceIndex;
      return typeof idx === 'number' ? `${cup} · Race ${idx + 1}/4 · ${cc}` : `${cup} · ${cc}`;
    }
    return `VS Race · ${cc}`;
  }

  async _precompile() {
    const r = this.game?.renderer;
    if (!r) return;
    try {
      if (typeof r.compileAsync === 'function') {
        await Promise.race([r.compileAsync(this.scene, this.camera), new Promise((res) => setTimeout(res, 2500))]);
      } else r.compile?.(this.scene, this.camera);
    } catch {
      /* optional */
    }
  }

  // ================================================================================================ flow

  async start() {
    if (this.disposed || !this.track || this._started) return;
    this._started = true;
    this.phase = 'intro';
    this.world.phase = 'intro';
    try {
      this.hud.show();
      this.hud.titleCard?.(this.track.name, this.subtitle);
    } catch (err) {
      console.error('[Race] HUD intro failed', err);
    }
    this.stats.introAt = performance.now();
    this.events.emit('intro', {});
    this._startEngine();
    await this.chase.playIntro(this.track, INTRO_DURATION);
    if (this.disposed) return;
    this._beginCountdown();
  }

  skipIntro() {
    if (this.phase === 'intro') this.chase?.skipIntro();
  }

  _beginCountdown() {
    if (this.phase !== 'intro') return;
    if (this.net && this.net.startAt == null) {
      this._awaitStart = true; // online: wait for the host's start time (see update)
      return;
    }
    this.phase = 'countdown';
    this.world.phase = 'countdown';
    this.stats.countdownAt = performance.now();
    this.countdownLeft = this.net ? this.net.secondsToGo() : COUNT_FROM + PRE_COUNT;
    this._lastCount = null;
    try {
      this.hud.hideTitleCard?.();
    } catch {
      /* ignore */
    }
  }

  _tickCountdown(dt) {
    if (this.net) this.countdownLeft = this.net.secondsToGo();
    else this.countdownLeft -= dt;
    const n = Math.ceil(this.countdownLeft);
    if (n <= COUNT_FROM && n > 0 && n !== this._lastCount) {
      this._lastCount = n;
      this._safe(() => this.hud.countdown(n));
      this.track.setStartLights?.(COUNT_FROM + 1 - n);
      this.sfx('countdownBeep', null);
      this.feedback?.rumble(0.1, 0.25, 90);
      this.events.emit('countdown', { n });
    }
    if (this.countdownLeft <= 0) this._go();
  }

  _go() {
    this.countdownLeft = 0;
    this.phase = 'racing';
    this.world.phase = 'racing';
    this.world.countdownLeft = 0;
    this.time = this.net ? clamp(-this.net.secondsToGo(), 0, 30) : 0; // online: a late client joins the shared clock
    this._lastCount = 0;
    this._safe(() => this.hud.countdown(0));
    this.track.setStartLights?.(4);
    this.sfx('countdownGo', null);
    for (const k of this.karts) {
      k._sectors = 0; // lap 1 must be driven for real
      this._safe(() => k.onRaceStart());
    }
    if (this.mode === 'tt' && this.player) this.items.giveItem(this.player, TIME_TRIAL_ITEM);
    const music = this.track.theme?.music ?? this.track.def?.theme?.music;
    try {
      this.game.audio?.setMusicTempo?.(1);
      this.game.audio?.playMusic?.(music || 'abydos', { fadeIn: 0.25, restart: true });
    } catch {
      /* ignore */
    }
    this.feedback?.rumble(0.3, 0.5, 200);
    this.stats.goAt = performance.now();
    this.events.emit('go', {});
    // lights go dark again a moment after GO (MK style)
    this.later(2.2, () => this.track?.setStartLights?.(0));
  }

  _startEngine() {
    if (this._engineSound || !this.player) return;
    try {
      this._engineSound = this.game.audio?.createEngine?.(this.player.characterId) || null;
    } catch {
      this._engineSound = null;
    }
  }

  // ================================================================================================ helpers

  later(seconds, fn) {
    this._timers.push({ t: seconds, fn });
  }

  _runTimers(dt) {
    const list = this._timers;
    if (!list.length) return;
    for (let i = 0; i < list.length; i++) list[i].t -= dt;
    for (let i = 0; i < list.length; ) {
      if (list[i].t <= 0) {
        const { fn } = list[i];
        list.splice(i, 1);
        this._safe(fn);
        if (this.disposed) return;
      } else i++;
    }
  }

  _safe(fn) {
    try {
      fn();
    } catch (err) {
      if ((this._errs = (this._errs || 0) + 1) <= 8) console.error('[Race]', err);
    }
  }

  /** Positional sfx: full volume for the player's own sounds, attenuated + panned for everything else. */
  sfx(name, pos, opts) {
    const audio = this.game?.audio;
    if (!audio || this.disposed || !name) return null;
    const o = this._sfxOpts;
    o.volume = opts?.volume ?? 1;
    o.pitch = opts?.pitch ?? 1;
    o.pan = opts?.pan ?? 0;
    const P = this.player;
    if (pos && P && pos !== P.position && pos !== P.object3d?.position) {
      const d = pos.distanceTo(P.position);
      if (d > 0.75) {
        if (d >= SFX_RANGE) return null;
        const f = 1 - d / SFX_RANGE;
        o.volume *= f * f * 0.9 + 0.1 * f;
        if (o.volume < 0.02) return null;
        _camRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
        _v.subVectors(pos, this.camera.position);
        const len = _v.length();
        if (len > 1e-3) o.pan = clamp((_v.dot(_camRight) / len) * 0.75, -0.75, 0.75);
      }
    }
    try {
      return audio.sfx(name, o);
    } catch {
      return null;
    }
  }

  isWrongWay(k) {
    return !!k && this.phase === 'racing' && !k.finished && !(k.respawnTime > 0) && (k.wrongWayTime || 0) > WRONG_WAY_TIME;
  }

  // ================================================================================================ pause

  pause() {
    if (this.paused || this.disposed) return;
    this.paused = true;
    try {
      this.game.audio?.setPaused?.(true);
    } catch {
      /* ignore */
    }
  }

  resume() {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    this.acc = 0;
    try {
      this.game.audio?.setPaused?.(false);
    } catch {
      /* ignore */
    }
  }

  // ================================================================================================ simulation

  _controlsFor(kart) {
    const ai = this.drivers.get(kart);
    if (ai) return ai.update(PHYSICS_DT, this.world);
    return this.game.input?.getDriveControls?.() || null;
  }

  _step(dt) {
    const w = this.world;
    this.simTime += dt;
    w.time = this.simTime;
    if (this.phase === 'racing' || this.phase === 'finished') {
      this.time += dt;
      w.phase = 'racing';
    }
    w.countdownLeft = this.phase === 'countdown' ? this.countdownLeft : this.phase === 'intro' ? COUNT_FROM + PRE_COUNT + 1 : 0;
    const racing = w.phase === 'racing';
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      if (k.netRemote) {
        this.net.applyRemote(k, dt); // online puppet: pose + flags from the network, no physics
        continue;
      }
      k.setControls(this._controlsFor(k));
      if (racing && k.controls.itemPressed && !(k.respawnTime > 0)) {
        this.net?.beforeUse(k);
        this.items.useItem(k);
      }
      k.update(dt, w);
    }
    resolveKartCollisions(this.karts, w);
    resolveHazardCollisions(this.karts, this.track.hazards, w);
    this.items.update(dt, w);
    this.net?.afterItems();
    if (racing) this._updateProgress(dt);
    else for (const k of this.karts) if (!k.netRemote) this._trackD(k);
    this._updatePlaces();
  }

  _trackD(k) {
    const path = this.track.path;
    const dd = path.deltaD(k.proj.d, k._lastD);
    k._lastD = k.proj.d;
    k.progress += dd;
    return dd;
  }

  _updateProgress(dt) {
    const L = this.pathLength;
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      if (k.netRemote) continue; // progress/laps reported by the owning client
      const dd = this._trackD(k);
      if (k.finished) continue;
      k._sectors |= 1 << Math.min(SECTORS - 1, Math.floor((k.proj.d / L) * SECTORS));
      const lapNow = Math.floor(k.progress / L) + 1;
      if (lapNow <= k._lapIndex) continue;
      // crossed the line forwards: anti-cheat (>= 50 % of the lap's sectors since the last crossing)
      if (popcount(k._sectors) < SECTORS / 2) {
        k.progress -= L; // does not count: the kart owes a full lap
        continue;
      }
      // sub-step crossing time for ms-accurate lap times
      const lineAt = (lapNow - 1) * L;
      const frac = dd > 1e-6 ? clamp((k.progress - lineAt) / dd, 0, 1) : 0;
      const crossTime = Math.max(0, this.time - frac * dt);
      const lapTime = crossTime - k._lapStart;
      k._lapStart = crossTime;
      k.lapTimes.push(lapTime);
      k._lapIndex = lapNow;
      k._sectors = 1 << Math.min(SECTORS - 1, Math.floor((k.proj.d / L) * SECTORS));
      if (lapNow > this.laps) {
        k.finished = true;
        k.finishTime = crossTime;
        k.lap = this.laps;
        this._updatePlaces();
        this.events.emit('finish', { kart: k, place: k.place, time: crossTime });
        if (k.isPlayer) this._playerFinished();
        else if (this.phase === 'finished' || this.player?.finished) this._rivalFinishedAfterPlayer(k);
      } else {
        k.lap = lapNow;
        const final = lapNow === this.laps;
        this.events.emit('lap', { kart: k, lap: lapNow, final, lapTime });
        if (final) this.events.emit('finalLap', { kart: k });
        if (k.isPlayer) this._safe(() => this.feedback.lap(lapNow, this.laps, lapTime, k.lapTimes));
      }
    }
  }

  _updatePlaces() {
    const order = this._order;
    if (order.length !== this.karts.length) {
      order.length = 0;
      for (const k of this.karts) order.push(k);
    }
    order.sort(this._placeCmp);
    for (let i = 0; i < order.length; i++) order[i].place = i + 1;
  }

  _rivalFinishedAfterPlayer(k) {
    const d = this.player ? k.position.distanceTo(this.player.position) : 999;
    if (d < 40) this.sfx('finish', k.position, { volume: 0.35 });
  }

  _playerFinished() {
    const P = this.player;
    this.phase = 'finished';
    // AI takes over the player's kart
    if (!this.drivers.has(P)) this._addDriver(P);
    this.chase.setMode?.('finish');
    let newRecord = false;
    if (this.mode === 'tt') {
      const rec = this.ttRecord;
      newRecord = !rec || P.finishTime < rec.time - 1e-4;
      if (newRecord) writeTTRecord(this.opts.trackId, { time: P.finishTime, lapTimes: P.lapTimes, characterId: P.characterId });
    }
    this.newRecord = newRecord;
    this._safe(() => this.feedback.finish(P.place, { newRecord, time: P.finishTime, mode: this.mode }));
    if (this.net) {
      this.net.onLocalFinish(); // online: the host decides when results are final
      return;
    }
    this.later(FINISH_DELAY, () => {
      if (this._finishNotified) return;
      this._finishNotified = true;
      const results = this.getResults();
      this.events.emit('raceEnd', { results });
      this.onFinish?.(results);
    });
  }

  // ================================================================================================ frame

  update(dt) {
    if (this.paused || this.disposed || this.phase === 'loading' || !this.track) return;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const input = this.game.input;

    if (this.phase === 'intro') {
      if (this._started && input?.menuPressed?.('confirm')) this.skipIntro();
      const net = this.net;
      if (net && net.startAt != null && (this._awaitStart || net.secondsToGo() <= COUNT_FROM + PRE_COUNT)) {
        this._awaitStart = false;
        this.chase?.skipIntro();
        this._beginCountdown();
      }
    } else if (this.phase === 'countdown') {
      this._tickCountdown(dt);
    }

    // fixed-step simulation
    this.acc += dt;
    let steps = 0;
    while (this.acc >= PHYSICS_DT && steps < MAX_STEPS) {
      this._step(PHYSICS_DT);
      this.acc -= PHYSICS_DT;
      steps++;
      if (this.disposed) return;
    }
    if (steps >= MAX_STEPS && this.acc >= PHYSICS_DT) {
      this.acc = 0;
      this.stats.maxStepsHit++;
    }
    this.stats.steps += steps;
    const alpha = clamp(this.acc / PHYSICS_DT, 0, 1);

    this._runTimers(dt);
    if (this.disposed) return;

    // visuals
    for (let i = 0; i < this.karts.length; i++) this.karts[i].updateVisual(dt, alpha);
    this.items.updateVisual(dt, alpha);
    this.track.update(dt, this.simTime, this.camera);
    this.track.updateShadowFocus(this.player.object3d?.position || this.player.position);
    const humanDriving = !this.drivers.has(this.player);
    const lookBack = humanDriving && this.phase === 'racing' ? !!(input?.lookBack ?? input?.peekDriveControls?.().lookBack) : false;
    this.chase.update(dt, { lookBack });
    this.particles.update(dt, this.camera);

    // audio: player engine
    const e = this._engineSound;
    if (e) {
      const P = this.player;
      const top = Math.max(1, P.topSpeed || 36);
      const c = P.controls;
      try {
        e.update(clamp(Math.abs(P.speed) / top, 0, 1.6), c ? c.throttle : 0, P.boostTime > 0, !!P.drift?.active);
        const vol = this.phase === 'finished' ? 0.55 : P.respawnTime > 0 ? 0.4 : 1;
        if (vol !== this._engineVol) {
          this._engineVol = vol;
          e.setVolume?.(vol);
        }
      } catch {
        /* ignore */
      }
    }

    this.feedback.update(dt);
    this.hud.update(this.getHudState(), dt);
    if (this.net) this._safe(() => this.net.update(dt));
  }

  /** Online (host): a puppet whose player left becomes a locally simulated CPU kart. */
  netTakeOver(k) {
    if (!k || this.disposed) return;
    k.netRemote = false;
    const L = this.pathLength || 1;
    k._lastD = k.proj?.d ?? 0;
    k._lapIndex = Math.max(1, Math.floor((k.progress || 0) / L) + 1);
    k._sectors = FULL_MASK;
    k._lapStart = (k.lapTimes || []).reduce((a, b) => a + b, 0);
    k.lapTimes = [...(k.lapTimes || [])];
    if (!this.drivers.has(k)) this._addDriver(k);
  }

  render(renderer) {
    if (this.disposed) return;
    renderer.render(this.scene, this.camera);
  }

  // ================================================================================================ state

  getHudState() {
    const P = this.player;
    if (!P) return null;
    let s = this._hud;
    if (!s) {
      s = this._hud = {
        mode: this.mode,
        item: { id: null, uses: 0, roulette: false, rouletteProgress: 0, cardTime: 0 },
        racers: this.karts.map(() => ({})),
        player: { x: 0, z: 0, yaw: 0 },
        incoming: [],
      };
    }
    s.phase = this.phase;
    s.time = this.phase === 'racing' || this.phase === 'finished' ? this.time : 0;
    s.countdown = this.phase === 'countdown' ? Math.max(0, this.countdownLeft) : null;
    s.lap = clamp(P.lap || 1, 1, this.laps);
    s.laps = this.laps;
    s.place = this.feedback?.hudPlace ?? P.place;
    s.racerCount = this.karts.length;
    s.coins = P.coins || 0;
    s.maxCoins = MAX_CREDITS;
    const it = s.item;
    const r = P.roulette;
    it.id = P.item || null;
    it.uses = P.itemUses || 0;
    it.roulette = !!r?.active;
    it.rouletteProgress = r?.active && r.duration ? clamp(r.time / r.duration, 0, 1) : 0;
    it.cardTime = P.cardTime || 0;
    s.speed = Math.abs(P.speed || 0);
    s.topSpeed = P.topSpeed;
    s.boosting = P.boostTime > 0;
    s.drifting = !!P.drift?.active;
    s.driftLevel = P.drift?.level || 0;
    s.wrongWay = this.isWrongWay(P);
    s.finished = !!P.finished;
    s.respawning = P.respawnTime > 0;
    s.shrunk = P.shrinkTime > 0;
    s.invincible = P.invincibleTime > 0;
    s.incoming = Array.isArray(P.incoming) ? P.incoming : [];
    s.lapTimes = P.lapTimes;
    const lt = P.lapTimes;
    s.lastLapTime = lt.length ? lt[lt.length - 1] : null;
    let best = null;
    for (let i = 0; i < lt.length; i++) if (best === null || lt[i] < best) best = lt[i];
    s.bestLapTime = best;
    s.ttRecord = this.ttRecord ? this.ttRecord.time : null;
    const order = this._order;
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      const o = s.racers[i];
      o.id = k.id;
      o.characterId = k.characterId;
      o.name = k.name;
      o.place = k.place;
      o.isPlayer = k.isPlayer;
      const p = k.object3d?.position || k.position;
      o.x = p.x;
      o.y = p.y;
      o.z = p.z;
      o.yaw = k.visualYaw ?? k.yaw;
      o.finished = k.finished;
      o.lap = k.lap;
    }
    const pp = P.object3d?.position || P.position;
    s.player.x = pp.x;
    s.player.z = pp.z;
    s.player.yaw = P.visualYaw ?? P.yaw;
    return s;
  }

  getResults() {
    const L = this.pathLength || 1;
    const total = this.laps * L;
    const order = [...this.karts].sort(this._placeCmp);
    let prevTime = 0;
    return order.map((k, i) => {
      let time;
      if (k.finished) time = k.finishTime;
      else {
        // estimate from the kart's own average pace (bounded), keeping the current order
        const t = Math.max(1, this.time);
        const pace = clamp(Math.max(0, k.progress) / t, (k.topSpeed || 36) * 0.55, (k.topSpeed || 36) * 1.05);
        time = this.time + Math.max(0, total - k.progress) / pace;
        time = Math.max(time, prevTime + 0.05 + 0.01 * i);
      }
      prevTime = time;
      const laps = k.lapTimes.slice(0, this.laps);
      return {
        id: k.id,
        characterId: k.characterId,
        name: k.name,
        place: i + 1,
        isPlayer: k.isPlayer,
        time: Math.round(time * 1000) / 1000,
        finished: !!k.finished,
        lapTimes: laps,
        bestLap: laps.length ? Math.min(...laps) : null,
        coins: k.coins || 0,
      };
    });
  }

  // ================================================================================================ cleanup

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.phase = 'disposed';
    this._timers.length = 0;
    this.onFinish = null;
    const safe = (fn) => {
      try {
        fn();
      } catch (err) {
        console.warn('[Race] dispose step failed', err);
      }
    };
    safe(() => this.net?.detach?.());
    safe(() => this._engineSound?.stop());
    this._engineSound = null;
    safe(() => this.game?.audio?.setMusicTempo?.(1));
    if (this.paused) safe(() => this.game?.audio?.setPaused?.(false));
    safe(() => this.chase?.skipIntro()); // resolves a pending intro promise (start() bails out)
    if (this.chase) this.chase.enabled = false;
    safe(() => this.feedback?.dispose());
    safe(() => this.hud?.dispose());
    safe(() => this.items?.dispose());
    safe(() => this.particles?.dispose());
    for (const k of this.karts) safe(() => k.dispose());
    this.drivers.clear();
    safe(() => this.track?.dispose());
    // sweep whatever is left in the scene graph (environment leftovers, effects added by other modules)
    safe(() => {
      const res = collectResources(this.scene);
      if (this.scene.background?.isTexture) res.textures.add(this.scene.background);
      if (this.scene.environment?.isTexture) res.textures.add(this.scene.environment);
      disposeResources(res);
      this.scene.traverse((o) => {
        if (o.isLight && o.shadow?.map) {
          o.shadow.map.dispose();
          o.shadow.map = null;
        }
        if (o.isInstancedMesh) o.dispose?.();
      });
      this.scene.clear();
      this.scene.fog = null;
      this.scene.background = null;
      this.scene.environment = null;
    });
    this.events.clear();
    this.karts.length = 0;
    this._order.length = 0;
    this.player = null;
    this.world = null;
    this._hud = null;
    if (typeof window !== 'undefined' && window.__ssk?.race === this) window.__ssk.race = null;
  }
}

export default Race;
