// Debug scene (owner: physics agent): drive a kart on a real track.
//   /?scene=drive&track=test-oval&char=serika&cc=150&bots=0..7
// Extra params:
//   countdown=1        3-2-1-GO with start lights + rocket start / stall check
//   intro=1            camera intro flyover first (Enter skips)
//   autopilot=1        the AI drives your kart (camera / physics soak test)
//   d=<dist>&lat=<l>   start the player somewhere on the track (e.g. d=600 right before a feature)
//   speed=<u/s>        start rolling at this speed
//   quality=high|medium|low,  hud=0 hides the readout,  audio=1 plays the synthesized sfx
//   nowall=1 (&void=lava|water|sky) removes all walls to test falling / drone respawn
//   demo=1             real-time demo pilot drives the player (drifts, tricks) for screenshots
//   pose=drift|ramp|boost|wall|offroad|spin|launch|respawn   deterministic test pose at load (poseTime=<s>),
//                      then a scripted pilot keeps driving (arrow keys take over); freeze=1 pauses there
// Hotkeys: 1 spinOut, 2 launch, 3 shrink, 4 halo, 5 boost, 6 respawn, 7 +coin, 8 autopilot on/off,
//          9 replay intro, 0 finish-orbit camera on/off, R reset to grid, H toggle readout
// window.__ssk = { kart, karts, camera (ChaseCamera), threeCamera, track, input, world, log, stats, teleport(d, lat, speed),
//                  simulate(script, seconds, opts), fmt, steerTo, pose(name), setPilot(fn), paused, timeScale }

import * as THREE from 'three';
import { createRenderer, bindResize } from '../core/renderer.js';
import { loadTrackDef } from '../data/tracks/index.js';
import { buildTrack } from '../world/TrackBuilder.js';
import { CHARACTERS, getCharacter } from '../data/characters.js';
import { ENGINE_CLASSES, PHYSICS_DT, MAX_CREDITS } from '../data/engine.js';
import { Kart, resolveKartCollisions, resolveHazardCollisions } from '../entities/Kart.js';
import { AIDriver } from '../entities/AIDriver.js';
import { Particles } from '../race/Particles.js';
import { ChaseCamera } from '../race/Camera.js';
import { Input } from '../core/Input.js';
import { EventBus } from '../core/EventBus.js';
import { clamp, formatRaceTime } from '../core/utils.js';

const LEVEL_NAMES = ['-', 'BLUE', 'ORANGE', 'PURPLE'];
const LEVEL_COLORS = ['#9aa3b5', '#39b8ff', '#ff9a1a', '#c35cff'];

export async function run({ params, container, hudRoot }) {
  const quality = params.get('quality') || 'high';
  const renderer = createRenderer(container, { quality });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000);
  bindResize(renderer, () => [camera]);

  const trackId = params.get('track') || 'test-oval';
  let def = await loadTrackDef(trackId);
  if (params.get('nowall') === '1') {
    // physics test: remove every wall so the karts can fall into the void (drone respawn)
    def = {
      ...def,
      id: def.id + '-nowall',
      wall: false,
      points: def.points.map((p) => ({ ...p, wall: false, wallL: false, wallR: false })),
      theme: { ...(def.theme || {}), void: { type: params.get('void') || 'lava', color: '#ff5a1f' } },
    };
  }
  const track = buildTrack(def, { quality });
  scene.add(track.group);
  track.applyEnvironment(scene);
  const path = track.path;

  let particles = null;
  try {
    particles = new Particles(scene, { quality });
  } catch (err) {
    console.error('[drive] Particles failed', err);
  }

  // optional real audio (audio=1; audio agent's module), never required
  let audio = null;
  if (params.get('audio') === '1') try {
    const mod = await import('../core/Audio.js');
    audio = new mod.AudioManager();
    const unlock = () => audio?.unlock?.();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  } catch {
    audio = null;
  }

  const input = new Input();
  const events = new EventBus();
  const cc = Number(params.get('cc') || 150);
  const engine = ENGINE_CLASSES[cc] || ENGINE_CLASSES[150];
  const playerChar = getCharacter(params.get('char') || 'serika');
  const nBots = clamp(parseInt(params.get('bots') || '0', 10) || 0, 0, 7);
  const rivals = CHARACTERS.filter((c) => c.id !== playerChar.id).slice(0, nBots);
  const total = nBots + 1;

  const karts = [];
  const drivers = new Map();
  rivals.forEach((ch, i) => {
    const k = new Kart({ id: ch.id, index: i, character: ch, track, isPlayer: false, engine, quality });
    karts.push(k);
  });
  const player = new Kart({ id: playerChar.id, index: nBots, character: playerChar, track, isPlayer: true, engine, quality });
  karts.push(player);
  for (const k of karts) scene.add(k.object3d);

  const makeAI = (k, skill) =>
    new AIDriver(k, {
      track,
      skill,
      engine,
      personality: { lineOffset: ((k.index * 37) % 7) - 3, aggression: 0.5, driftiness: 0.6 },
    });
  for (const k of karts) if (!k.isPlayer) drivers.set(k, makeAI(k, engine.aiSkill));
  let autopilot = params.get('autopilot') === '1';
  if (autopilot) drivers.set(player, makeAI(player, 0.9));

  // --- sfx log (+ real audio when available)
  const recentSfx = [];
  const log = [];
  const stats = { maxSpeed: 0, wallHits: 0, jumps: 0, tricks: 0, landings: 0, miniTurbos: [], boostPads: 0, respawns: 0, bumps: 0, sfx: {} };
  const sfx = (name, pos, opts) => {
    const isPlayerSound = pos === player.position;
    const entry = { t: Math.round(world.time * 1000) / 1000, name, player: isPlayerSound };
    log.push(entry);
    if (log.length > 400) log.shift();
    if (isPlayerSound) {
      stats.sfx[name] = (stats.sfx[name] || 0) + 1;
      if (name === 'wallBump') stats.wallHits++;
      if (name === 'jump') stats.jumps++;
      if (name === 'trick') stats.tricks++;
      if (name === 'land') stats.landings++;
      if (name === 'boostPad') stats.boostPads++;
      if (name === 'respawn') stats.respawns++;
      if (name === 'miniTurbo') stats.miniTurbos.push(player.drift.level || '?');
      recentSfx.unshift(name);
      if (recentSfx.length > 7) recentSfx.pop();
    }
    if (name === 'kartBump') stats.bumps++;
    if (audio) {
      let volume = opts?.volume ?? 1;
      if (!isPlayerSound && pos) {
        const d = pos.distanceTo(player.position);
        if (d > 60) return;
        volume *= 1 - d / 60;
      }
      try {
        audio.sfx(name, { volume, pitch: opts?.pitch ?? 1 });
      } catch {
        /* ignore */
      }
    }
  };

  const chase = new ChaseCamera(camera);
  const itemsStub = { getThreatsFor: () => [], update() {}, useItem() {}, updateVisual() {} };
  const world = {
    time: 0,
    phase: 'racing',
    countdownLeft: 0,
    track,
    karts,
    player,
    particles,
    items: itemsStub,
    mode: 'vs',
    engine,
    sfx,
    events,
    camera: chase,
  };

  // --- lap timing for the player
  const lapInfo = { progress: 0, lastD: 0, lap: 1, lapStart: 0, lapTimes: [], best: null, raceTime: 0 };

  const useCountdown = params.get('countdown') === '1';
  let introRunning = false;

  function placeGrid() {
    karts.forEach((k, slot) => {
      k.reset(path.gridSlot(slot, total));
      k.coins = 0;
      k.finished = false;
    });
    const dParam = params.get('d');
    if (dParam !== null) {
      teleport(Number(dParam), Number(params.get('lat') || 0), Number(params.get('speed') || 0));
    } else if (params.get('speed')) {
      player.speed = Number(params.get('speed'));
    }
    for (const ai of drivers.values()) ai.reset?.();
    lapInfo.progress = path.deltaD(player.proj.d, 0);
    lapInfo.lastD = player.proj.d;
    lapInfo.lap = 1;
    lapInfo.lapStart = world.time;
    lapInfo.raceTime = 0;
    world.phase = useCountdown ? 'countdown' : 'racing';
    world.countdownLeft = useCountdown ? 3.999 : 0;
    lastCount = 99;
    if (!useCountdown) track.setStartLights?.(4);
    chase.setMode('chase');
    chase.snap();
  }

  function teleport(d, lat = 0, speed = 0) {
    const f = path.frameAt(d);
    const pos = f.pos.clone().addScaledVector(f.right, lat);
    player.reset({ position: pos, yaw: f.yaw, d });
    if (speed) player.speed = speed;
    chase.snap();
    return player.proj.d;
  }

  let lastCount = 99;
  function updateCountdown(dt) {
    if (world.phase !== 'countdown') return;
    world.countdownLeft -= dt;
    const n = Math.ceil(world.countdownLeft);
    if (n !== lastCount) {
      lastCount = n;
      track.setStartLights?.(n > 0 ? Math.min(3, 4 - n) : 4);
      if (n > 0 && n <= 3) sfx('countdownBeep', null);
    }
    if (world.countdownLeft <= 0) {
      world.phase = 'racing';
      world.countdownLeft = 0;
      track.setStartLights?.(4);
      sfx('countdownGo', null);
      for (const k of karts) k.onRaceStart();
      lapInfo.lapStart = world.time;
    }
  }

  function step(dt) {
    world.time += dt;
    for (const k of karts) {
      const ai = k === player && playerOverride ? null : drivers.get(k);
      let c = null;
      if (ai) {
        try {
          c = ai.update(dt, world);
        } catch (err) {
          if (!ai._err) console.error('[drive] AI update failed', err);
          ai._err = true;
        }
      } else if (k === player && pilot && !playerOverride) c = pilotControls(pilot);
      else c = playerOverride || (demo.on && k === player ? demoControls(k) : input.getDriveControls());
      k.setControls(c);
      k.update(dt, world);
    }
    resolveKartCollisions(karts, world);
    resolveHazardCollisions(karts, track.hazards || [], world);
    // player progress / laps
    const dd = path.deltaD(player.proj.d, lapInfo.lastD);
    lapInfo.progress += dd;
    lapInfo.lastD = player.proj.d;
    if (world.phase === 'racing') lapInfo.raceTime += dt;
    const lap = Math.floor(lapInfo.progress / path.length) + 1;
    if (lap > lapInfo.lap) {
      const t = world.time - lapInfo.lapStart;
      lapInfo.lapTimes.push(t);
      lapInfo.best = lapInfo.best == null ? t : Math.min(lapInfo.best, t);
      lapInfo.lapStart = world.time;
      sfx('lap', null);
    }
    lapInfo.lap = Math.max(lapInfo.lap, lap);
    stats.maxSpeed = Math.max(stats.maxSpeed, player.speed);
    traceAcc += dt;
    if (traceAcc >= 0.1) {
      traceAcc -= 0.1;
      trace.push([
        Math.round(world.time * 100) / 100,
        Math.round(player.speed * 10) / 10,
        player.drift.active ? player.drift.dir * (player.drift.level + 1) : 0,
        Math.round(player.boostTime * 100) / 100,
        player.grounded ? 0 : Math.round((player.position.y - player.proj.groundY) * 100) / 100,
        player.surface,
        Math.round(player.proj.lateral * 10) / 10,
        Math.round(player.proj.d),
      ]);
      if (trace.length > 900) trace.shift();
    }
  }
  let traceAcc = 0;
  let playerOverride = null;

  /**
   * Deterministic synchronous test drive (no rendering): runs the physics for `seconds` with the player
   * controlled by `script` — either [[t, controlsPatch], ...] or a function (t, kart, path) => controlsPatch.
   * A rising edge on `drift` / `item` also sets driftPressed / itemPressed for one step.
   * opts: { reset=true, d, lat, speed, sample=0.1 }. Returns { rows, log, end } where
   * rows = [t, speed, drift(dir*(level+1)), charge, boost, height, surface, lateral, d, yaw].
   */
  function simulate(script = [], seconds = 5, opts = {}) {
    const { reset = true, sample = 0.1 } = opts;
    if (reset) {
      placeGrid();
      if (opts.d !== undefined) teleport(opts.d, opts.lat || 0, opts.speed || 0);
      else if (opts.speed) player.speed = opts.speed;
    }
    world.phase = opts.phase || 'racing';
    if (opts.countdown) {
      world.phase = 'countdown';
      world.countdownLeft = opts.countdown;
    }
    const c = { throttle: 0, brake: 0, steer: 0, drift: false, driftPressed: false, item: false, itemPressed: false, lookBack: false };
    const rows = [];
    const logStart = log.length;
    const list = Array.isArray(script) ? [...script].sort((a, b) => a[0] - b[0]) : null;
    let idx = 0;
    let t = 0;
    let sampleAcc = sample;
    const steps = Math.round(seconds / PHYSICS_DT);
    for (let i = 0; i < steps; i++) {
      const prevDrift = c.drift;
      const prevItem = c.item;
      if (list) {
        while (idx < list.length && list[idx][0] <= t + 1e-9) Object.assign(c, list[idx++][1]);
      } else Object.assign(c, script(t, player, path) || {});
      c.driftPressed = c.drift && !prevDrift;
      c.itemPressed = c.item && !prevItem;
      playerOverride = c;
      if (world.phase === 'countdown' && world.countdownLeft < 10) {
        world.countdownLeft -= PHYSICS_DT;
        if (world.countdownLeft <= 0) {
          world.phase = 'racing';
          for (const k of karts) k.onRaceStart();
        }
      }
      step(PHYSICS_DT);
      if (opts.visual !== false) {
        for (const k of karts) k.updateVisual(PHYSICS_DT, 1);
        particles?.update?.(PHYSICS_DT, camera);
        chase.update(PHYSICS_DT, { lookBack: !!c.lookBack });
      }
      t += PHYSICS_DT;
      sampleAcc += PHYSICS_DT;
      if (sample && sampleAcc >= sample - 1e-9) {
        sampleAcc = 0;
        const k = player;
        rows.push([
          Math.round(t * 100) / 100,
          Math.round(k.speed * 10) / 10,
          k.drift.active ? k.drift.dir * (k.drift.level + 1) : 0,
          Math.round(k.drift.charge * 100) / 100,
          Math.round(k.boostTime * 100) / 100,
          k.grounded ? 0 : Math.round((k.position.y - k.proj.groundY) * 100) / 100,
          k.surface,
          Math.round(k.proj.lateral * 10) / 10,
          Math.round(k.proj.d * 10) / 10,
          Math.round(k.yaw * 100) / 100,
        ]);
      }
    }
    playerOverride = opts.hold ? c : null; // hold = keep the last controls applied afterwards
    for (const k of karts) {
      k.prevPosition.copy(k.position);
      k.prevYaw = k.yaw;
    }
    if (opts.visual === false) chase.snap();
    return { rows, log: log.slice(logStart).map((e) => e.t + ':' + e.name + (e.player ? '' : '*')), end: { speed: player.speed, d: player.proj.d, lat: player.proj.lateral, surface: player.surface } };
  }
  // --- scripted pilot: fn(t, kart, path) -> controls patch, used every step (real time) until cleared
  let pilot = null;
  let pilotT = 0;
  const pilotC = { throttle: 0, brake: 0, steer: 0, drift: false, driftPressed: false, item: false, itemPressed: false, lookBack: false };
  function pilotControls(fn) {
    const prevDrift = pilotC.drift;
    const prevItem = pilotC.item;
    pilotT += PHYSICS_DT;
    Object.assign(pilotC, fn(pilotT, player, path) || {});
    pilotC.driftPressed = pilotC.drift && !prevDrift;
    pilotC.itemPressed = pilotC.item && !prevItem;
    return pilotC;
  }
  function setPilot(fn, t0 = 0) {
    pilot = fn;
    pilotT = t0;
  }

  /**
   * Named test poses (pose=<name> URL param or __ssk.pose(name)): a deterministic simulation that puts the
   * player in an interesting state, then a scripted pilot keeps going in real time (freeze=1 pauses instead).
   */
  const L = path.length;
  const featureD = (type, n = 0) => {
    const fs = (def.features || []).filter((f) => f.type === type);
    return fs.length ? path.resolveD(fs[Math.min(n, fs.length - 1)]) : null;
  };
  const POSES = {
    drift: () => {
      const fn = (t, kk) => {
        if (t < 0.1) return { throttle: 1, steer: 0.6, drift: false };
        return { throttle: 1, drift: true, steer: kk.drift.active ? driftSteer(kk, 3) : 0.35 };
      };
      simulate(fn, Number(params.get('poseTime') || 2.4), { d: Number(params.get('d') ?? 55), lat: -4, speed: 34 });
      return fn;
    },
    ramp: () => {
      const dR = featureD('ramp') ?? L * 0.55;
      const fn = (t, kk) => ({ throttle: 1, steer: steerTo(kk, 0), drift: !kk.grounded && kk.airTime > 0.05 && kk.airTime < 0.15 });
      simulate(fn, Number(params.get('poseTime') || 1.05), { d: dR - 25, speed: 34 });
      return fn;
    },
    boost: () => {
      const dB = featureD('boost') ?? L * 0.3;
      const f = (def.features || []).find((x) => x.type === 'boost');
      const fn = (t, kk) => ({ throttle: 1, steer: steerTo(kk, f?.lateral ?? 0) });
      simulate(fn, Number(params.get('poseTime') || 0.75), { d: dB - 18, lat: f?.lateral ?? 0, speed: 34 });
      return fn;
    },
    wall: () => {
      const fn = (t) => ({ throttle: 1, steer: t < 0.7 ? 0.35 : 0 });
      simulate(fn, Number(params.get('poseTime') || 0.9), { d: 10, lat: 6, speed: 34 });
      return fn;
    },
    offroad: () => {
      const fn = (t, kk) => ({ throttle: 1, steer: steerTo(kk, 14) });
      simulate(fn, Number(params.get('poseTime') || 1.2), { d: 20, lat: 14, speed: 34 });
      return fn;
    },
    spin: () => {
      const fn = () => ({ throttle: 1, steer: 0 });
      simulate(fn, 0.1, { d: 20, speed: 30 });
      player.spinOut();
      simulate(fn, Number(params.get('poseTime') || 0.35), { reset: false });
      return fn;
    },
    launch: () => {
      const fn = () => ({ throttle: 1, steer: 0 });
      simulate(fn, 0.1, { d: 20, speed: 30 });
      player.launch(1);
      simulate(fn, Number(params.get('poseTime') || 0.45), { reset: false });
      return fn;
    },
    respawn: () => {
      const fn = () => ({ throttle: 1, steer: 0 });
      simulate(fn, 0.1, { d: 20, speed: 30 });
      player.respawn();
      simulate(fn, Number(params.get('poseTime') || 0.8), { reset: false });
      return fn;
    },
  };
  function pose(name) {
    const make = POSES[name];
    if (!make) return false;
    const fn = make();
    setPilot(fn, Number(params.get('poseTime') || 0));
    if (params.get('freeze') === '1') window.__ssk.paused = true;
    return true;
  }

  /** Real-time demo pilot (demo=1): lane keeping, drifts through bends, tricks off ramps. */
  const demo = { on: params.get('demo') === '1', drift: 0, c: { throttle: 1, brake: 0, steer: 0, drift: false, driftPressed: false, item: false, itemPressed: false, lookBack: false } };
  function demoControls(k) {
    const c = demo.c;
    const d = k.proj.d;
    const curv = path.curvatureAhead(d + 6 + k.speed * 0.1, 26, 4);
    const prevDrift = c.drift;
    c.throttle = 1;
    if (k.drift.active) {
      const dir = k.drift.dir;
      c.steer = steerTo(k, dir * 2.5, 14, 6);
      c.drift = Math.abs(path.curvatureAhead(d + 4, 18, 3)) > 1 / 260 || k.drift.time < 0.6;
    } else if (k._hopping || (k._driftArm > 0 && c.drift)) {
      c.steer = demo.dir || 0; // keep the drift direction through the hop
      c.drift = true;
    } else if (!k.grounded && k._rampAir && k.airTime > 0.04 && k.airTime < 0.3 && !k.trickPending) {
      c.drift = !prevDrift; // trick
      c.steer = steerTo(k, 0);
    } else if (k.grounded && Math.abs(curv) > 1 / 110 && k.speed > 22 && !k.isStunned()) {
      c.steer = demo.dir = Math.sign(curv);
      c.drift = true;
    } else {
      c.steer = steerTo(k, 0);
      c.drift = false;
    }
    c.driftPressed = c.drift && !prevDrift;
    return c;
  }

  /** Drift pilot: holds the drift along the track (heading error vs the road ahead + lateral error). */
  function driftSteer(k, lat = 0) {
    let err = k.yaw - path.sampleAt(k.proj.d + 6).yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    return clamp(err * 4 + (lat - k.proj.lateral) * 0.09, -1, 1);
  }
  /** Test pilot: steer value that aims at lateral `lat` `ahead` units down the track. */
  function steerTo(k, lat = 0, ahead = 14, gain = 2.2) {
    const tp = path.pointAt(k.proj.d + ahead + Math.abs(k.speed) * 0.25, lat);
    const want = Math.atan2(tp.x - k.position.x, tp.z - k.position.z);
    let diff = want - k.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return clamp(-diff * gain, -1, 1);
  }
  /** Compact text of simulate() rows (every nth). */
  const fmt = (res, every = 1) => res.rows.filter((r, i) => i % every === 0).map((r) => r.join(':')).join(' ') + ' | ' + res.log.join(' ');
  const trace = []; // [t, speed, drift(dir*(level+1)), boost, height, surface, lateral, d] every 0.1 s

  // --- readout
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:absolute;left:12px;top:12px;min-width:330px;padding:10px 12px 12px;border-radius:12px;' +
    'background:linear-gradient(160deg,rgba(12,22,48,.82),rgba(20,34,72,.72));border:2px solid rgba(255,255,255,.18);' +
    'box-shadow:0 6px 22px rgba(0,0,0,.35);color:#eaf2ff;font:12px/1.45 ui-monospace,Consolas,monospace;pointer-events:none;white-space:pre';
  const count = document.createElement('div');
  count.style.cssText =
    'position:absolute;left:50%;top:32%;transform:translate(-50%,-50%);font:bold 120px var(--ssk-font-display);color:#fff;' +
    '-webkit-text-stroke:6px #16213a;paint-order:stroke fill;text-shadow:0 8px 0 #16213a;pointer-events:none;display:none';
  const speedo = document.createElement('div');
  speedo.style.cssText =
    'position:absolute;right:18px;bottom:16px;font:bold 44px var(--ssk-font-display);color:#fff;-webkit-text-stroke:4px #16213a;' +
    'paint-order:stroke fill;text-align:right;pointer-events:none;line-height:1';
  hudRoot.append(panel, count, speedo);
  if (params.get('hud') === '0') panel.style.display = 'none';

  const bar = (v, color, w = 22) => {
    const n = Math.round(clamp(v, 0, 1) * w);
    return `<span style="color:${color}">${'█'.repeat(n)}</span><span style="color:#3a4668">${'█'.repeat(w - n)}</span>`;
  };
  const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
  let readoutT = 0;
  let fps = 60;
  function updateReadout(dt) {
    fps = fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    readoutT -= dt;
    if (readoutT > 0) return;
    readoutT = 0.08;
    const k = player;
    const p = k.proj;
    const D = k.drift;
    const c = k.controls;
    const sr = Math.abs(k.speed) / k.topSpeed;
    const zone = p?.zone ? p.zone.type : '-';
    const lvlCol = LEVEL_COLORS[D.level];
    const L = [3.0];
    speedo.innerHTML = `${Math.round(Math.abs(k.speed) * 3.6)}<span style="font-size:18px"> km/h</span>`;
    if (panel.style.display === 'none') return;
    panel.innerHTML =
      `<b style="font:15px var(--ssk-font-display);letter-spacing:.5px;color:#ffd23f">SUPER SERIKA KART</b>  <span style="color:#8fb4ff">physics debug</span>\n` +
      `${def.name} | ${k.name} | ${engine.label} | bots ${nBots}${autopilot ? ' | AUTOPILOT' : ''} | ${Math.round(fps)} fps\n` +
      `speed  ${f1(k.speed).padStart(5)} u/s  max ${f1(k.maxSpeed)}  top ${f1(k.topSpeed)}\n` +
      `       ${bar(sr / 1.4, k.boostTime > 0 ? '#ff9a1a' : '#39d98a')}\n` +
      `surface <b>${k.surface}</b>  zone ${zone}  lat ${f1(p?.lateral)}  d ${f1(p?.d)}\n` +
      `drift  ${D.active ? (D.dir > 0 ? 'RIGHT' : 'LEFT ') : 'off  '}  lvl <b style="color:${lvlCol}">${LEVEL_NAMES[D.level]}</b>  charge ${f2(D.charge)}\n` +
      `       ${bar(D.charge / L[0], lvlCol)}\n` +
      `boost  ${f2(k.boostTime)}s x${f2(k.boostStrength)}   air ${k.grounded ? 'no ' : 'YES'} ${f2(k.airTime)}s  vy ${f1(k.vy)}\n` +
      `coins  ${k.coins}/${MAX_CREDITS}  spin ${f1(k.spinTime)} launch ${f1(k.launchTime)} shrink ${f1(k.shrinkTime)}\n` +
      `halo   ${f1(k.invincibleTime)}  grace ${f1(k.graceTime)}  respawn ${f1(k.respawnTime)}  stall ${f1(k.stallTime)}\n` +
      `wrong  ${f1(k.wrongWayTime)}  lap ${lapInfo.lap}  ${formatRaceTime(world.time - lapInfo.lapStart)}  best ${lapInfo.best ? formatRaceTime(lapInfo.best) : '-'}\n` +
      `input  T${c.throttle.toFixed(1)} B${c.brake.toFixed(1)} S${c.steer >= 0 ? '+' : ''}${c.steer.toFixed(2)} D${c.drift ? 1 : 0} ${input.lastDevice}\n` +
      `sfx    <span style="color:#ffd9a8">${recentSfx.join(' ')}</span>\n` +
      `<span style="color:#7f8db3">1 spin 2 launch 3 shrink 4 halo 5 boost 6 respawn 7 +coin\n8 autopilot 9 intro 0 finish-cam R reset H hide</span>`;
    if (world.phase === 'countdown' && world.countdownLeft < 10) {
      const n = Math.ceil(world.countdownLeft);
      count.style.display = '';
      count.textContent = n > 0 ? String(n) : 'GO!';
    } else if (world.time - lapInfo.lapStart < 0.8 && useCountdown && lapInfo.lap === 1) {
      count.style.display = '';
      count.textContent = 'GO!';
    } else count.style.display = 'none';
  }

  function hotkeys() {
    const k = player;
    if (input.wasPressed('Digit1')) k.spinOut();
    if (input.wasPressed('Digit2')) k.launch(1);
    if (input.wasPressed('Digit3')) {
      if (k.shrink(6)) sfx('shrink', k.position);
    }
    if (input.wasPressed('Digit4')) {
      k.setInvincible(7.5);
      sfx('halo', k.position);
    }
    if (input.wasPressed('Digit5')) {
      k.applyBoost(1.1, 1);
      sfx('boost', k.position);
    }
    if (input.wasPressed('Digit6')) k.respawn();
    if (input.wasPressed('Digit7')) {
      k.addCoins(1);
      sfx('coin', k.position);
    }
    if (input.wasPressed('Digit8')) {
      autopilot = !autopilot;
      if (autopilot) drivers.set(player, makeAI(player, 0.9));
      else drivers.delete(player);
    }
    if (input.wasPressed('Digit9')) startIntro();
    if (input.wasPressed('Digit0')) chase.setMode(chase.mode === 'finish' ? 'chase' : 'finish');
    if (input.wasPressed('KeyR')) {
      setPilot(null);
      placeGrid();
    }
    if (pilot && (input.isDown('ArrowUp') || input.isDown('KeyW') || input.isDown('ArrowDown') || input.isDown('KeyS'))) setPilot(null);
    if (input.wasPressed('KeyH')) panel.style.display = panel.style.display === 'none' ? '' : 'none';
    if (introRunning && (input.wasPressed('Enter') || input.wasPressed('Escape'))) chase.skipIntro();
  }

  function startIntro() {
    if (introRunning) return;
    introRunning = true;
    const wasPhase = world.phase;
    world.phase = 'countdown';
    world.countdownLeft = 99;
    chase.playIntro(track, Number(params.get('introTime') || 4)).then(() => {
      introRunning = false;
      if (useCountdown) {
        world.phase = 'countdown';
        world.countdownLeft = 3.999;
        lastCount = 99;
      } else {
        world.phase = wasPhase === 'countdown' ? 'racing' : wasPhase;
        world.countdownLeft = 0;
      }
    });
  }

  chase.setTarget(player);
  placeGrid();
  if (params.get('intro') === '1') startIntro();

  window.__ssk = Object.assign(window.__ssk || {}, {
    kart: player,
    karts,
    camera: chase,
    threeCamera: camera,
    track,
    input,
    world,
    log,
    stats,
    trace,
    lapInfo,
    teleport,
    reset: placeGrid,
    simulate,
    fmt,
    steerTo,
    demo,
    demoControls,
    pose,
    setPilot,
    poses: Object.keys(POSES),
  });
  if (params.get('pose')) pose(params.get('pose'));

  const timer = new THREE.Timer();
  let acc = 0;
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    input.update();
    hotkeys();
    if (!introRunning) updateCountdown(dt);
    acc += window.__ssk.paused ? 0 : dt * (window.__ssk.timeScale ?? 1);
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < 12) {
      step(PHYSICS_DT);
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps >= 12) acc = 0;
    const alpha = acc / PHYSICS_DT;
    const vdt = window.__ssk.paused ? 0.0001 : dt * (window.__ssk.timeScale ?? 1);
    for (const k of karts) k.updateVisual(vdt, alpha);
    try {
      track.update?.(dt, world.time, camera);
      track.updateShadowFocus?.(player.object3d.position);
    } catch (err) {
      if (!run._trackErr) console.error('[drive] track.update failed', err);
      run._trackErr = true;
    }
    particles?.update?.(vdt, camera);
    chase.update(window.__ssk.paused ? 0 : dt, { lookBack: input.lookBack });
    renderer.render(scene, camera);
    updateReadout(dt);
    input.endFrame();
  });
}
