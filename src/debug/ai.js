// AI debug scene (owner: AI agent) — /?scene=ai&track=<id>&n=8&cc=150&speed=2
//
// 8 AI karts race on a real track with items (ItemSystem + Particles). Readout per kart: place, lap, last/best
// lap, speed, AI mode, drift level, off-road %, wall hits, stuck/reverse counts, respawns, item, rubber band.
//
// Params: track (test-oval), n (8), cc (150), laps (3), speed (1, time scale), items (1), skill (engine default),
//         follow (0 = kart index to follow), cam (chase|high|overview), rb (0: no rubber band; 1 = kart n-1 acts
//         as "the player" for rubber-banding), seed (1), quality (medium), log (1 = AI drift log for kart 0)
//         sim=1  fast headless-ish simulation: no rendering, many physics steps per frame, prints a summary to
//                the console and stores it in window.__ssk.aiReport (simtime = max simulated seconds).
//         ref=1  kart 0 uses the player's autopilot profile (the competent reference), starts at the back and is
//                "the player" for rubber-banding; the report gains pace { aiAvgLap, refAvgLap, slowerPct, refPlace }
//         ghost=1 karts do not collide and do not pass each other (clean-air pace of every driver)
// Keys: C cycles camera (chase / high / overview), 1..8 follow kart, [ / ] time scale, P pause, R restart.
//
// window.__ssk = { karts, drivers, track, world, items, report(), aiReport (sim), setFollow(i), setCam(m) }

import * as THREE from 'three';
import { createRenderer, bindResize } from '../core/renderer.js';
import { loadTrackDef } from '../data/tracks/index.js';
import { buildTrack } from '../world/TrackBuilder.js';
import { CHARACTERS } from '../data/characters.js';
import { ENGINE_CLASSES, PHYSICS_DT } from '../data/engine.js';
import { Kart, resolveKartCollisions, resolveHazardCollisions } from '../entities/Kart.js';
import { AIDriver, getRacingLine } from '../entities/AIDriver.js';
import { ItemSystem } from '../entities/ItemSystem.js';
import { Particles } from '../race/Particles.js';
import { ChaseCamera } from '../race/Camera.js';
import { EventBus } from '../core/EventBus.js';
import { clamp, mulberry32 } from '../core/utils.js';

const COLORS = ['#ff5a7a', '#5ac8ff', '#ffd23f', '#7dff8a', '#c28bff', '#ff9d3f', '#3fffe0', '#ffffff'];
const CAMS = ['chase', 'high', 'overview'];
const fmt = (t) => {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};
const pad = (s, n) => {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
};
const lpad = (s, n) => {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
};

export async function run({ params, container, hudRoot }) {
  const sim = params.get('sim') === '1';
  const quality = params.get('quality') || (sim ? 'low' : 'medium');
  const trackId = params.get('track') || 'test-oval';
  const cc = Number(params.get('cc') || 150);
  const engine = ENGINE_CLASSES[cc] || ENGINE_CLASSES[150];
  const n = clamp(parseInt(params.get('n') || '8', 10) || 8, 1, 8);
  const laps = clamp(parseInt(params.get('laps') || '3', 10) || 3, 1, 9);
  let timeScale = Number(params.get('speed') || 1) || 1;
  const itemsOn = params.get('items') !== '0';
  const skillOverride = params.get('skill') != null ? Number(params.get('skill')) : null;
  const seed = Number(params.get('seed') || 1);
  const refOn = params.get('ref') === '1';
  const ghost = params.get('ghost') === '1';
  const rbOn = params.get('rb') === '1' || refOn;
  if (params.get('log') === '1') globalThis.__AILOG = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000);
  let renderer = null;
  if (!sim) {
    renderer = createRenderer(container, { quality });
    bindResize(renderer, () => [camera]);
  }

  const def = await loadTrackDef(trackId);
  const track = buildTrack(def, { quality });
  scene.add(track.group);
  track.applyEnvironment(scene);
  const path = track.path;
  const L = path.length;

  const t0 = performance.now();
  const line = getRacingLine(track);
  const lineMs = performance.now() - t0;

  const particles = sim ? { emit() {}, update() {}, clear() {}, dispose() {} } : new Particles(scene, { quality });
  const events = new EventBus();
  const rng = mulberry32(seed);

  // optional race personalities from the race agent's roster helper
  let aiProfile = null;
  try {
    aiProfile = (await import('../race/roster.js')).aiProfile || null;
  } catch {
    aiProfile = null;
  }

  // roster: serika first ... (kart 0 = pole)
  const chars = CHARACTERS.slice(0, n);
  const karts = [];
  const drivers = new Map();
  chars.forEach((ch, i) => {
    const k = new Kart({ id: ch.id, index: i, character: ch, track, isPlayer: false, engine, quality });
    karts.push(k);
    scene.add(k.object3d);
  });
  // ref=1: kart 0 is driven by the player's autopilot profile (the competent reference) and acts as "the player"
  // for rubber-banding; rb=1 alone: the last kart acts as the player (plain AI profile)
  const refKart = refOn ? karts[0] : null;
  const fakePlayer = refOn ? refKart : rbOn ? karts[karts.length - 1] : null;

  const stats = new Map();
  const setupKart = (k, slot) => {
    k.reset(path.gridSlot(slot, karts.length));
    k.progress = path.deltaD(k.proj.d, 0);
    if (k.progress > L / 2) k.progress -= L;
    k._lastD = k.proj.d;
    k.lap = 1;
    k.lapTimes = [];
    k.finished = false;
    k.finishTime = null;
    k.place = slot + 1;
    stats.set(k, { steps: 0, offSteps: 0, lapsDone: 0, lapStart: 0, slowT: 0, hardStuck: 0, maxSlow: 0, topV: 0, sumV: 0 });
  };
  const makeDriver = (k) => {
    let skill = skillOverride ?? engine.aiSkill;
    let personality = { lineOffset: (rng() - 0.5) * 3, aggression: 0.6, driftiness: 0.7 };
    if (aiProfile) {
      try {
        const pr = aiProfile(k.characterId, engine, rng, { isPlayer: k === refKart });
        if (skillOverride == null) skill = pr.skill;
        personality = pr.personality;
      } catch {
        /* fall back */
      }
    }
    return new AIDriver(k, { track, skill, engine, personality });
  };
  // the reference kart starts at the back of the grid like the real player
  const slotOf = (i) => (refOn ? (i === 0 ? karts.length - 1 : i - 1) : i);
  karts.forEach((k, i) => {
    setupKart(k, slotOf(i));
    drivers.set(k, makeDriver(k));
  });

  const sfx = () => {};
  const items = new ItemSystem({ scene, track, karts, particles, sfx, events, mode: itemsOn ? 'vs' : 'tt', rng, quality });

  const chase = new ChaseCamera(camera);
  let follow = clamp(parseInt(params.get('follow') || '0', 10) || 0, 0, karts.length - 1);
  let camMode = CAMS.includes(params.get('cam')) ? params.get('cam') : 'chase';
  chase.setTarget(karts[follow]);

  const world = {
    time: 0,
    phase: 'countdown',
    countdownLeft: 3,
    track,
    karts,
    player: fakePlayer,
    particles,
    items,
    mode: 'vs',
    engine,
    sfx,
    events,
    camera: chase,
    noTraffic: ghost, // AIDriver: no passing manoeuvres (karts are ghosts)
  };
  let raceTime = 0;
  let finishedAll = false;
  let paused = false;

  const hitLog = { hits: 0, byItem: {} };
  events.on?.('hit', (e) => {
    hitLog.hits++;
    const id = e?.itemId || '?';
    hitLog.byItem[id] = (hitLog.byItem[id] || 0) + 1;
  });

  const restart = () => {
    karts.forEach((k, i) => {
      setupKart(k, slotOf(i));
      drivers.get(k).reset();
    });
    world.time = 0;
    world.phase = 'countdown';
    world.countdownLeft = 3;
    raceTime = 0;
    finishedAll = false;
    chase.snap?.();
  };

  // ------------------------------------------------------------------------------------------------ step
  const order = [];
  const step = (dt) => {
    world.time += dt;
    if (world.phase === 'countdown') {
      world.countdownLeft -= dt;
      if (world.countdownLeft <= 0) {
        world.phase = 'racing';
        world.countdownLeft = 0;
        for (const k of karts) k.onRaceStart?.();
      }
    } else raceTime += dt;

    for (const k of karts) {
      const ai = drivers.get(k);
      const c = ai.update(dt, world);
      k.setControls(c);
      if (c.itemPressed && (k.item || k.roulette?.active)) items.useItem(k);
      k.update(dt, world);
    }
    if (!ghost) resolveKartCollisions(karts, world);
    resolveHazardCollisions(karts, track.hazards || [], world);
    items.update(dt, world);

    // progress, laps, places
    for (const k of karts) {
      const st = stats.get(k);
      if (k.proj) {
        k.progress += path.deltaD(k.proj.d, k._lastD);
        k._lastD = k.proj.d;
      }
      if (world.phase !== 'racing' || k.finished) continue;
      const done = Math.floor(k.progress / L);
      if (done > st.lapsDone) {
        st.lapsDone = done;
        k.lapTimes.push(raceTime - st.lapStart);
        st.lapStart = raceTime;
        if (done >= laps) {
          k.finished = true;
          k.finishTime = raceTime;
        }
      }
      k.lap = clamp(done + 1, 1, laps);
      st.steps++;
      if (k.offroad) st.offSteps++;
      const v = Math.abs(k.speed || 0);
      st.sumV += v;
      if (v > st.topV) st.topV = v;
      const stunned = k.respawnTime > 0 || k.spinTime > 0 || k.launchTime > 0;
      if (v < 2 && !stunned) {
        st.slowT += dt;
        if (st.slowT > st.maxSlow) st.maxSlow = st.slowT;
      } else {
        if (st.slowT > 3) st.hardStuck++;
        st.slowT = 0;
      }
    }
    order.length = 0;
    for (const k of karts) order.push(k);
    order.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    order.forEach((k, i) => (k.place = i + 1));
    if (!finishedAll && karts.every((k) => k.finished)) finishedAll = true;
  };

  // ------------------------------------------------------------------------------------------------ report
  const report = () => {
    const rows = karts.map((k) => {
      const st = stats.get(k);
      const ai = drivers.get(k);
      const s = ai.stats;
      const best = k.lapTimes.length ? Math.min(...k.lapTimes) : null;
      return {
        kart: k.characterId,
        place: k.place,
        skill: +ai.skill.toFixed(2),
        pace: +(ai.diff?.pace ?? 1).toFixed(3),
        rival: !!ai.isRival,
        finished: !!k.finished,
        time: k.finished ? +k.finishTime.toFixed(2) : null,
        laps: k.lapTimes.map((t) => +t.toFixed(2)),
        best: best != null ? +best.toFixed(2) : null,
        avgSpeed: st.steps ? +(st.sumV / st.steps).toFixed(1) : 0,
        topSpeed: +st.topV.toFixed(1),
        offroadPct: st.steps ? +((100 * st.offSteps) / st.steps).toFixed(1) : 0,
        wallHits: s.wallHits,
        respawns: s.respawns,
        stuck: s.stuck,
        reverses: s.reverses,
        hardStuck: st.hardStuck,
        maxSlow: +st.maxSlow.toFixed(1),
        drifts: s.drifts,
        miniTurbos: s.miniTurbos.slice(),
        tricks: s.tricks,
        itemsUsed: s.itemsUsed,
        dodges: s.dodges,
      };
    });
    rows.sort((a, b) => a.place - b.place);
    const bestLap = Math.min(...rows.map((r) => r.best ?? Infinity));
    // pace summary: average AI lap (all AI laps, excluding the reference kart) vs the reference autopilot
    const refRow = refKart ? rows.find((r) => r.kart === refKart.characterId) : null;
    const aiRows = rows.filter((r) => r !== refRow);
    const aiLaps = aiRows.flatMap((r) => r.laps);
    const aiAvgLap = aiLaps.length ? aiLaps.reduce((a, b) => a + b, 0) / aiLaps.length : null;
    const refAvgLap = refRow && refRow.laps.length ? refRow.laps.reduce((a, b) => a + b, 0) / refRow.laps.length : null;
    const pace = {
      aiAvgLap: aiAvgLap != null ? +aiAvgLap.toFixed(2) : null,
      aiBestLap: aiRows.length ? Math.min(...aiRows.map((r) => r.best ?? Infinity)) : null,
      refAvgLap: refAvgLap != null ? +refAvgLap.toFixed(2) : null,
      refPlace: refRow ? refRow.place : null,
      // + = AI slower than the reference, in %
      slowerPct: aiAvgLap != null && refAvgLap ? +((100 * (aiAvgLap - refAvgLap)) / refAvgLap).toFixed(1) : null,
    };
    return {
      track: trackId,
      length: +L.toFixed(1),
      cc,
      laps,
      items: itemsOn,
      simTime: +raceTime.toFixed(1),
      allFinished: finishedAll,
      lineMs: +lineMs.toFixed(1),
      corners: line.segs.length,
      bestLap: isFinite(bestLap) ? bestLap : null,
      ref: refKart ? refKart.characterId : null,
      pace,
      totals: {
        wallHits: rows.reduce((a, r) => a + r.wallHits, 0),
        respawns: rows.reduce((a, r) => a + r.respawns, 0),
        stuck: rows.reduce((a, r) => a + r.stuck, 0),
        hardStuck: rows.reduce((a, r) => a + r.hardStuck, 0),
        drifts: rows.reduce((a, r) => a + r.drifts, 0),
        mt: [0, 1, 2].map((i) => rows.reduce((a, r) => a + r.miniTurbos[i], 0)),
        itemsUsed: rows.reduce((a, r) => a + r.itemsUsed, 0),
        hits: hitLog.hits,
        hitsByItem: { ...hitLog.byItem },
      },
      rows,
    };
  };
  const reportText = (r) => {
    const lines = [
      `AI report ${r.track} (${r.length}u, ${r.cc}cc, ${r.laps} laps, items ${r.items ? 'on' : 'off'}) sim ${r.simTime}s all finished: ${r.allFinished}  line ${r.lineMs}ms, ${r.corners} drift corners`,
      `  # kart     skill  time      best     laps                          avgV  off%  wall resp stuck rev hard  drifts mt(b/o/p)  items`,
    ];
    for (const x of r.rows) {
      lines.push(
        `  ${x.place} ${pad(x.kart, 8)} ${x.skill.toFixed(2)}  ${pad(x.time != null ? fmt(x.time) : 'DNF', 9)} ${pad(fmt(x.best), 8)} ${pad(x.laps.map((t) => t.toFixed(1)).join(' '), 29)} ${lpad(x.avgSpeed, 4)} ${lpad(x.offroadPct, 5)} ${lpad(x.wallHits, 4)} ${lpad(x.respawns, 4)} ${lpad(x.stuck, 5)} ${lpad(x.reverses, 3)} ${lpad(x.hardStuck, 4)}  ${lpad(x.drifts, 6)} ${pad(x.miniTurbos.join('/'), 10)} ${lpad(x.itemsUsed, 5)}`,
      );
    }
    const T = r.totals;
    if (r.pace && r.ref) lines.push(`  pace: AI avg lap ${r.pace.aiAvgLap}s vs ref (${r.ref}, autopilot) ${r.pace.refAvgLap}s -> AI ${r.pace.slowerPct}% slower; ref place ${r.pace.refPlace}`);
    lines.push(`  totals: walls ${T.wallHits}, respawns ${T.respawns}, stuck ${T.stuck}, hardStuck ${T.hardStuck}, drifts ${T.drifts}, MT ${T.mt.join('/')}, items ${T.itemsUsed}, hits ${T.hits} ${JSON.stringify(T.hitsByItem)}`);
    return lines.join('\n');
  };

  // ------------------------------------------------------------------------------------------------ panel
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:absolute;left:8px;top:8px;padding:8px 10px;background:#0b1530d9;color:#e8f3ff;font:12px/1.4 ui-monospace,Consolas,monospace;border-radius:8px;white-space:pre;pointer-events:none;border:1px solid #3a6bd6;z-index:5';
  hudRoot.appendChild(panel);
  const tags = karts.map((k, i) => {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;transform:translate(-50%,-100%);font:bold 11px ui-monospace,Consolas,monospace;color:${COLORS[i]};text-shadow:0 0 3px #000,0 0 2px #000;pointer-events:none;white-space:nowrap`;
    el.textContent = k.characterId;
    hudRoot.appendChild(el);
    return el;
  });

  const panelText = () => {
    const head = `AI  ${trackId}  ${cc}cc  t=${raceTime.toFixed(1)}s  x${timeScale}${paused ? ' PAUSED' : ''}  cam ${camMode} -> ${karts[follow].characterId}  ${world.phase === 'countdown' ? 'GO in ' + world.countdownLeft.toFixed(1) : ''}`;
    const lines = [head, ' # kart     lap  last      best      v    mode     drift off%  wall stk rev rsp  item      rb'];
    for (const k of order.length ? order : karts) {
      const st = stats.get(k);
      const ai = drivers.get(k);
      const s = ai.stats;
      const last = k.lapTimes.length ? k.lapTimes[k.lapTimes.length - 1] : null;
      const best = k.lapTimes.length ? Math.min(...k.lapTimes) : null;
      const off = st.steps ? ((100 * st.offSteps) / st.steps).toFixed(1) : '0.0';
      const dl = k.drift?.active ? ['d', 'B', 'O', 'P'][k.drift.level] || 'd' : '-';
      lines.push(
        `${k.place} ${pad(k.characterId, 8)} ${k.finished ? 'FIN' : k.lap + '/' + laps} ${pad(fmt(last), 9)} ${pad(fmt(best), 9)} ${lpad(Math.abs(k.speed).toFixed(0), 3)}  ${pad(ai.debug.mode + (ai.tacKind ? ':' + ai.tacKind : ''), 9)} ${pad(dl, 5)} ${lpad(off, 4)} ${lpad(s.wallHits, 4)} ${lpad(s.stuck, 3)} ${lpad(s.reverses, 3)} ${lpad(s.respawns, 3)}  ${pad(ai.debug.item || '', 8)} ${(k.topSpeedScale ?? 1).toFixed(2)}`,
      );
    }
    lines.push('C: camera  1-8: follow  [ ]: speed  P: pause  R: restart');
    return lines.join('\n');
  };

  window.__ssk = Object.assign(window.__ssk || {}, {
    karts,
    drivers,
    track,
    world,
    items,
    line,
    report,
    reportText: () => reportText(report()),
    setFollow: (i) => {
      follow = clamp(i | 0, 0, karts.length - 1);
      chase.setTarget(karts[follow]);
      chase.snap?.();
    },
    setCam: (m) => {
      if (CAMS.includes(m)) camMode = m;
    },
  });

  // ------------------------------------------------------------------------------------------------ sim mode
  if (sim) {
    const maxT = Number(params.get('simtime') || laps * 150);
    panel.textContent = `AI sim ${trackId}: running...`;
    const wall0 = performance.now();
    await new Promise((resolve) => {
      const chunk = () => {
        const tEnd = performance.now() + 40;
        while (performance.now() < tEnd && !finishedAll && raceTime < maxT) {
          for (let i = 0; i < 60; i++) step(PHYSICS_DT);
        }
        panel.textContent = `AI sim ${trackId}: t=${raceTime.toFixed(0)}s / ${maxT}s\n` + panelText();
        if (finishedAll || raceTime >= maxT) resolve();
        else setTimeout(chunk, 0);
      };
      chunk();
    });
    const r = report();
    r.wallMs = Math.round(performance.now() - wall0);
    window.__ssk.aiReport = r;
    const txt = reportText(r);
    console.log(txt);
    panel.textContent = txt;
    return;
  }

  // ------------------------------------------------------------------------------------------------ input
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC') camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length];
    else if (/^Digit[1-8]$/.test(e.code)) window.__ssk.setFollow(Number(e.code.slice(5)) - 1);
    else if (e.code === 'BracketRight') timeScale = Math.min(16, timeScale * 2);
    else if (e.code === 'BracketLeft') timeScale = Math.max(0.125, timeScale / 2);
    else if (e.code === 'KeyP') paused = !paused;
    else if (e.code === 'KeyR') restart();
  });

  // ------------------------------------------------------------------------------------------------ render loop
  const b = path.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  const _v = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const timer = new THREE.Timer();
  let acc = 0;
  let panelT = 0;
  chase.snap?.();
  renderer.setAnimationLoop(() => {
    timer.update();
    const rawDt = Math.min(timer.getDelta(), 0.1);
    const dt = paused ? 0 : rawDt * timeScale;
    acc += dt;
    let steps = 0;
    const maxSteps = Math.ceil(24 * Math.max(1, timeScale));
    while (acc >= PHYSICS_DT && steps < maxSteps) {
      step(PHYSICS_DT);
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps >= maxSteps) acc = 0;
    const alpha = acc / PHYSICS_DT;
    for (const k of karts) k.updateVisual(dt, alpha);
    items.updateVisual(dt, alpha);
    track.update?.(dt, world.time, camera);
    const tgt = karts[follow];
    track.updateShadowFocus?.(tgt.object3d.position);
    if (camMode === 'chase') chase.update(rawDt);
    else if (camMode === 'high') {
      const p = tgt.object3d.position;
      _v.set(p.x - tgt.forward.x * 26, p.y + 30, p.z - tgt.forward.z * 26);
      camera.position.lerp(_v, 1 - Math.exp(-4 * rawDt));
      _look.set(p.x + tgt.forward.x * 8, p.y, p.z + tgt.forward.z * 8);
      camera.lookAt(_look);
    } else {
      camera.position.set(cx, (b.max.y || 0) + span * 0.95, cz + span * 0.25);
      camera.lookAt(cx, b.min.y || 0, cz);
    }
    particles.update(rawDt, camera);
    renderer.render(scene, camera);
    // name tags
    const w = window.innerWidth;
    const h = window.innerHeight;
    karts.forEach((k, i) => {
      _v.copy(k.object3d.position);
      _v.y += 2.6;
      _v.project(camera);
      const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      tags[i].style.display = vis ? 'block' : 'none';
      if (vis) {
        tags[i].style.left = `${((_v.x + 1) / 2) * w}px`;
        tags[i].style.top = `${((1 - _v.y) / 2) * h}px`;
        tags[i].textContent = `${k.place} ${k.characterId}${k.drift?.active ? ' ~' + (k.drift.level || '') : ''}`;
      }
    });
    panelT -= rawDt;
    if (panelT <= 0) {
      panelT = 0.2;
      panel.textContent = panelText() + (finishedAll ? '\n\n' + reportText(report()) : '');
    }
  });
}
