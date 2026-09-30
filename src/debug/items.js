// Debug scene (owner: items agent): items, pickups, projectiles and particles on a real track.
//   /?scene=items&track=test-oval
// Params:
//   item=<id>        give the player this item at start (and after every auto use)
//   bots=0..7        number of AI rivals (default 3)
//   auto=1           everybody auto-uses items every few seconds (player is driven by the AI too)
//   autopilot=1      the AI drives the player's kart
//   botitem=<id>     give every bot this item at start (e.g. missile to test incoming warnings)
//   ahead=1          bots start ahead of the player (targets for missiles / seekers)
//   still=1          bots do not drive (sitting targets); playerstill=1 same for the player
//   fire=<ms>        the player uses its item after <ms> (repeats every 4 s with fireEvery=<ms>)
//   hold=<ms>        with fire: keep the item button held for <ms> (drag ramen / rounds behind)
//   back=1           with fire: look-back held while firing (backward shots / forward tosses)
//   cam=chase|side|high|top|front|watch|orbit    camera (watch = follows the newest free item)
//   showcase=1       re-emit the particle showcase every 2 s;  slowmo=<0.1..1> time scale
//   d=<dist>         start distance along the track;  quality=high|medium|low;  hud=0 hides the panel
// Hotkeys: 1..9,0,-,=,[,],\  give the player ITEMS in order (drink drink3 card ramen ramen3 bullet bullet3 missile
//          missile3 grenade halo tablet seeker credits decoy);  F = item button (hold to drag);  B = give the
//          player's current item to every bot;  K = bots use their items;  P = particle showcase;
//          V = cycle camera;  M = slow motion;  H = toggle panel.
// window.__ssk = { items, karts, particles, player, track, world, chase, give(id, i?), fire(i?), showcase(), stats(), setCam(m) }

import * as THREE from 'three';
import { createRenderer, bindResize } from '../core/renderer.js';
import { loadTrackDef } from '../data/tracks/index.js';
import { buildTrack } from '../world/TrackBuilder.js';
import { CHARACTERS, getCharacter } from '../data/characters.js';
import { ENGINE_CLASSES, PHYSICS_DT } from '../data/engine.js';
import { ITEMS, ITEM_IDS } from '../data/items.js';
import { Kart, resolveKartCollisions, resolveHazardCollisions } from '../entities/Kart.js';
import { AIDriver } from '../entities/AIDriver.js';
import { ItemSystem } from '../entities/ItemSystem.js';
import { Particles, PARTICLE_TYPES } from '../race/Particles.js';
import { ChaseCamera } from '../race/Camera.js';
import { Input } from '../core/Input.js';
import { EventBus } from '../core/EventBus.js';
import { clamp } from '../core/utils.js';

const HOTKEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash'];
const CAMS = ['chase', 'side', 'high', 'front', 'top', 'watch', 'orbit'];

export async function run({ params, container, hudRoot }) {
  const quality = params.get('quality') || 'high';
  const renderer = createRenderer(container, { quality });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000);
  bindResize(renderer, () => [camera]);

  const trackId = params.get('track') || 'test-oval';
  const def = await loadTrackDef(trackId);
  const track = buildTrack(def, { quality });
  scene.add(track.group);
  track.applyEnvironment(scene);
  const path = track.path;

  const particles = new Particles(scene, { quality });

  // optional audio
  let audio = null;
  try {
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
  const engine = ENGINE_CLASSES[Number(params.get('cc') || 150)] || ENGINE_CLASSES[150];
  const playerChar = getCharacter(params.get('char') || 'serika');
  const nBots = clamp(parseInt(params.get('bots') ?? '3', 10) || 0, 0, 7);
  const rivals = CHARACTERS.filter((c) => c.id !== playerChar.id).slice(0, nBots);
  const ahead = params.get('ahead') === '1';
  const auto = params.get('auto') === '1';
  const still = params.get('still') === '1';
  const playerStill = params.get('playerstill') === '1';
  let autopilot = auto || params.get('autopilot') === '1';
  const startD = params.get('d') ? Number(params.get('d')) : null;

  const karts = [];
  const drivers = new Map();
  const mkKart = (ch, i, isPlayer) => {
    const k = new Kart({ id: ch.id, index: i, character: ch, track, isPlayer, engine, quality });
    karts.push(k);
    scene.add(k.object3d);
    return k;
  };
  const player = mkKart(playerChar, 0, true);
  rivals.forEach((ch, i) => mkKart(ch, i + 1, false));

  // grid: player at the back unless ahead=0 ... (ahead=1 -> bots in front of the player)
  const total = karts.length;
  const slotFor = (k) => {
    const order = ahead ? [...karts.filter((x) => !x.isPlayer), player] : [player, ...karts.filter((x) => !x.isPlayer)];
    let slot = order.indexOf(k);
    if (!ahead) slot = k.isPlayer ? total - 1 : slot - 1; // player at the back (MK style)
    if (startD === null) {
      if (ahead) {
        // spread bots 12..60 units ahead of the player's grid slot
        const g = path.gridSlot(total - 1, total);
        if (k.isPlayer) return g;
        const d = path.wrapD(g.d + 14 + slot * 11);
        const f = path.frameAt(d);
        const lat = ((slot % 3) - 1) * 4;
        return { position: f.pos.clone().addScaledVector(f.right, lat), yaw: f.yaw, d, lateral: lat };
      }
      return path.gridSlot(slot, total);
    }
    const d = path.wrapD(startD + (ahead && !k.isPlayer ? 14 + slot * 11 : -slot * 5));
    const f = path.frameAt(d);
    const lat = k.isPlayer ? 0 : ((slot % 3) - 1) * 4;
    return { position: f.pos.clone().addScaledVector(f.right, lat), yaw: f.yaw, d, lateral: lat };
  };
  for (const k of karts) {
    k.reset(slotFor(k));
    k.progress = path.deltaD(k.proj.d, 0);
    k._lastD = k.proj.d;
  }

  const makeAI = (k, skill) =>
    new AIDriver(k, { track, skill, engine, personality: { lineOffset: ((k.index * 37) % 7) - 3, aggression: 0.6, driftiness: 0.5 } });
  for (const k of karts) if (!k.isPlayer) drivers.set(k, makeAI(k, engine.aiSkill));
  if (autopilot) drivers.set(player, makeAI(player, 0.9));

  const log = [];
  const sfx = (name, pos, opts) => {
    log.push(name);
    if (log.length > 200) log.shift();
    if (!audio) return;
    let volume = opts?.volume ?? 1;
    if (pos && pos !== player.position) {
      const dd = pos.distanceTo(player.position);
      if (dd > 60) return;
      volume *= 1 - dd / 60;
    }
    try {
      audio.sfx(name, { volume, pitch: opts?.pitch ?? 1 });
    } catch {
      /* ignore */
    }
  };

  const chase = new ChaseCamera(camera);
  chase.setTarget(player);
  chase.snap?.();

  const items = new ItemSystem({ scene, track, karts, particles, sfx, events, mode: params.get('mode') || 'vs', rng: Math.random, quality });
  const world = {
    time: 0,
    phase: 'racing',
    countdownLeft: 0,
    track,
    karts,
    player,
    particles,
    items,
    mode: 'vs',
    engine,
    sfx,
    events,
    camera: chase,
  };
  for (const k of karts) k.onRaceStart?.();

  // ------------------------------------------------------------------ HUD panel + overlays
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:absolute;left:10px;top:10px;padding:8px 10px;background:#0b1530cc;color:#e8f3ff;font:12px/1.45 ui-monospace,Consolas,monospace;border-radius:8px;white-space:pre;pointer-events:none;min-width:280px;border:1px solid #3a6bd6';
  hudRoot.appendChild(panel);
  if (params.get('hud') === '0') panel.style.display = 'none';
  const flashEl = document.createElement('div');
  flashEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s';
  hudRoot.appendChild(flashEl);
  const flash = (color, a = 0.55) => {
    flashEl.style.transition = 'none';
    flashEl.style.background = color;
    flashEl.style.opacity = String(a);
    requestAnimationFrame(() => {
      flashEl.style.transition = 'opacity .45s';
      flashEl.style.opacity = '0';
    });
  };
  const labels = document.createElement('div');
  labels.style.cssText = 'position:absolute;inset:0;pointer-events:none;font:bold 12px sans-serif;color:#fff;text-shadow:0 1px 2px #000';
  hudRoot.appendChild(labels);

  const hitLog = [];
  events.on('hit', ({ victim, attacker, itemId }) => {
    hitLog.unshift(`${attacker?.name || '?'} -> ${victim?.name} (${itemId})`);
    if (hitLog.length > 5) hitLog.pop();
    if (victim === player) flash('#ff2a2a', 0.35);
  });
  events.on('tablet', () => flash('#35c8ff', 0.5));
  events.on('explosion', ({ position }) => {
    const dd = position.distanceTo(player.position);
    if (dd < 25) chase.shake?.(clamp(1 - dd / 25, 0.2, 1));
  });
  const stats = { hits: 0, gets: 0, uses: 0, boxes: 0, coins: 0, explosions: 0 };
  events.on('hit', () => stats.hits++);
  events.on('itemGet', () => stats.gets++);
  events.on('itemUse', () => stats.uses++);
  events.on('itemBox', () => stats.boxes++);
  events.on('coin', () => stats.coins++);
  events.on('explosion', () => stats.explosions++);

  // ------------------------------------------------------------------ controls
  let fDown = false;
  let fPressed = false;
  let slowmo = Number(params.get('slowmo') || 1);
  let camMode = params.get('cam') || 'chase';
  const give = (id, i = 0) => {
    const k = karts[i];
    if (k && ITEMS[id]) items.giveItem(k, id);
  };
  const fire = (i = 0) => {
    const k = karts[i];
    if (k && (k.item || k.roulette?.active)) items.useItem(k);
  };
  let showcaseLabels = [];
  let showcaseT = 0;
  const showcase = () => {
    const types = PARTICLE_TYPES.filter((t) => !['sparkle', 'twinkle', 'shockwave', 'fire', 'leaf', 'leaves', 'petals', 'embers', 'sparkles'].includes(t));
    const f = path.frameAt(player.proj.d + 15);
    const cols = 6;
    showcaseLabels = [];
    types.forEach((t, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const p = f.pos.clone().addScaledVector(f.right, (col - (cols - 1) / 2) * 5.5).addScaledVector(f.tan, row * 5.5);
      p.y += 1.2;
      const o = { count: undefined };
      if (t === 'explosion') o.size = 3;
      if (t === 'snow' || t === 'petal' || t === 'ember') o.count = 20;
      if (t === 'snow' || t === 'petal') o.area = 1.5;
      if (t === 'glow' || t === 'trail' || t === 'flash') o.size = 2;
      particles.emit(t, p, o);
      showcaseLabels.push({ t, p });
    });
    showcaseT = 2.5;
  };

  window.addEventListener('keydown', (e) => {
    const hk = HOTKEYS.indexOf(e.code);
    if (hk >= 0 && ITEM_IDS[hk]) {
      give(ITEM_IDS[hk]);
      return;
    }
    switch (e.code) {
      case 'KeyF':
        if (!fDown) fPressed = true;
        fDown = true;
        break;
      case 'KeyB':
        if (player.item) for (let i = 1; i < karts.length; i++) give(player.item, i);
        break;
      case 'KeyK':
        for (let i = 1; i < karts.length; i++) fire(i);
        break;
      case 'KeyP':
        showcase();
        break;
      case 'KeyV':
        camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length];
        break;
      case 'KeyM':
        slowmo = slowmo < 1 ? 1 : 0.25;
        break;
      case 'KeyH':
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
        break;
      default:
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyF') fDown = false;
  });

  // scripted fire for screenshots
  const fireAt = params.get('fire') ? Number(params.get('fire')) / 1000 : null;
  const fireEvery = params.get('fireEvery') ? Number(params.get('fireEvery')) / 1000 : 4;
  const holdFor = params.get('hold') ? Number(params.get('hold')) / 1000 : 0;
  const scriptedBack = params.get('back') === '1';
  let nextFire = fireAt;
  let holdUntil = -1;
  const startItem = params.get('item');
  if (startItem && ITEMS[startItem]) give(startItem, 0);
  const botItem = params.get('botitem');
  if (botItem && ITEMS[botItem]) for (let i = 1; i < karts.length; i++) give(botItem, i);
  const autoNext = new Map(karts.map((k, i) => [k, 1.5 + i * 0.7]));

  // ------------------------------------------------------------------ simulation
  const updateProgress = () => {
    const L = path.length;
    for (const k of karts) {
      k.progress += path.deltaD(k.proj.d, k._lastD);
      k._lastD = k.proj.d;
      k.lap = Math.floor(k.progress / L) + 1;
    }
    const sorted = [...karts].sort((a, b) => b.progress - a.progress);
    sorted.forEach((k, i) => (k.place = i + 1));
  };

  const NO = { throttle: 0, brake: 0, steer: 0, drift: false, driftPressed: false, item: false, itemPressed: false, lookBack: false };
  const scriptCtl = new Map(); // kart -> scripted DriveControls (self-test)
  const pc = { ...NO };
  const step = (dt) => {
    world.time += dt;
    for (const k of karts) {
      let c;
      const ai = drivers.get(k);
      const sc = scriptCtl.get(k);
      if (sc) {
        // self-test: scripted controls (or the AI when sc.ai)
        c = sc.ai && ai ? ai.update(dt, world) : sc;
      } else if (k.isPlayer) {
        const src = ai ? ai.update(dt, world) : input.getDriveControls();
        Object.assign(pc, src);
        pc.item = !!src.item || fDown || world.time < holdUntil;
        pc.itemPressed = !!src.itemPressed || fPressed;
        if (scriptedBack && world.time < holdUntil + 0.2) pc.lookBack = true;
        if (playerStill) {
          pc.throttle = 0;
          pc.steer = 0;
        }
        c = pc;
        fPressed = false;
      } else {
        c = still ? NO : ai.update(dt, world);
      }
      k.setControls(c);
      if (c.itemPressed && (k.item || k.roulette?.active)) items.useItem(k);
      k.update(dt, world);
    }
    resolveKartCollisions(karts, world);
    resolveHazardCollisions(karts, track.hazards, world);
    items.update(dt, world);
    updateProgress();

    // scripted player fire
    if (nextFire !== null && world.time >= nextFire) {
      nextFire = world.time + fireEvery;
      if (!player.item && startItem) give(startItem, 0);
      if (player.item || player.roulette?.active) {
        if (holdFor > 0) holdUntil = world.time + holdFor;
        if (scriptedBack) pc.lookBack = true;
        player.controls.lookBack = scriptedBack;
        player.controls.item = holdFor > 0;
        items.useItem(player);
      }
    }
    // auto mode: everybody uses items periodically
    if (auto) {
      for (const k of karts) {
        const t = autoNext.get(k);
        if (world.time < t) continue;
        autoNext.set(k, world.time + 2.5 + Math.random() * 2.5);
        if (!k.item && !k.roulette?.active) {
          const id = k.isPlayer && startItem ? startItem : ITEM_IDS[(Math.random() * ITEM_IDS.length) | 0];
          give(id, karts.indexOf(k));
        }
        if (k.item) items.useItem(k);
      }
    }
  };

  // ------------------------------------------------------------------ cameras
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let watchEnt = null;
  let watchT = 0;
  const updateCamera = (dt, t) => {
    if (camMode === 'chase') {
      chase.update(dt, { lookBack: input.getDriveControls().lookBack });
      return;
    }
    const k = player;
    const p = k.object3d.position;
    let want = camPos;
    if (camMode === 'side') {
      want = new THREE.Vector3().copy(p).addScaledVector(k.right, 11).addScaledVector(k.forward, 5);
      want.y += 3.5;
      camLook.copy(p).addScaledVector(k.forward, 9);
      camLook.y += 1;
    } else if (camMode === 'high') {
      want = new THREE.Vector3().copy(p).addScaledVector(k.forward, -16);
      want.y += 11;
      camLook.copy(p).addScaledVector(k.forward, 18);
    } else if (camMode === 'front') {
      want = new THREE.Vector3().copy(p).addScaledVector(k.forward, 9).addScaledVector(k.right, 2);
      want.y += 3.2;
      camLook.copy(p).addScaledVector(k.forward, -5);
      camLook.y += 0.8;
    } else if (camMode === 'top') {
      want = new THREE.Vector3().copy(p);
      want.y += 55;
      want.addScaledVector(k.forward, -8);
      camLook.copy(p).addScaledVector(k.forward, 6);
    } else if (camMode === 'orbit') {
      want = new THREE.Vector3(p.x + Math.cos(t * 0.4) * 14, p.y + 6, p.z + Math.sin(t * 0.4) * 14);
      camLook.copy(p);
      camLook.y += 1;
    } else if (camMode === 'gallery') {
      const f0 = path.frameAt(player.proj.d + 9);
      const zoom = Number(params.get('zoom') || 1);
      want = new THREE.Vector3().copy(f0.pos).addScaledVector(f0.tan, -7 * zoom);
      want.y += 2.6 * zoom;
      camLook.copy(f0.pos);
      camLook.y += 0.7;
      for (const o of gallery) o.rotation.y += dt * Number(params.get('spin') ?? 0.6);
      camPos.copy(want);
    } else if (camMode === 'watch') {
      // follow the newest free-flying item
      if (!watchEnt || !watchEnt.alive || watchEnt.attached) {
        watchEnt = null;
        for (let i = items.entities.length - 1; i >= 0; i--) {
          const e = items.entities[i];
          if (e.alive && !e.attached && !e.static) {
            watchEnt = e;
            break;
          }
        }
      }
      if (watchEnt) {
        watchT = 0.6;
        const o = watchEnt.obj.position;
        const v = watchEnt.vel;
        const dir = v.lengthSq() > 1 ? new THREE.Vector3(v.x, 0, v.z).normalize() : k.forward.clone();
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        want = new THREE.Vector3().copy(o).addScaledVector(dir, -7).addScaledVector(side, 5);
        want.y += watchEnt.kind === 'seeker' ? 5 : 3.2;
        camLook.copy(o).addScaledVector(dir, 3);
      } else {
        watchT -= dt;
        if (watchT > 0) return;
        chase.update(dt, {});
        camPos.copy(camera.position);
        return;
      }
    }
    camPos.lerp(want, 1 - Math.exp(-8 * dt));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  };
  camPos.copy(camera.position);

  // ------------------------------------------------------------------ model gallery (gallery=1)
  const gallery = [];
  if (params.get('gallery') === '1') {
    const kinds = (params.get('kinds') || 'ramen,bullet,missile,grenade,seeker,decoy,can,card,bag,tablet').split(',');
    const f0 = path.frameAt(player.proj.d + 9);
    kinds.forEach((kind, i) => {
      const o = items.models.acquire(kind);
      const lat = (i - (kinds.length - 1) / 2) * 2.4;
      o.position.copy(f0.pos).addScaledVector(f0.right, lat);
      o.position.y += kind === 'ramen' ? 0.02 : kind === 'decoy' ? 1.2 : 0.9;
      o.rotation.y = f0.yaw + Math.PI;
      scene.add(o);
      gallery.push(o);
    });
    camMode = params.get('cam') || 'gallery';
  }

  // ------------------------------------------------------------------ loop
  const timer = new THREE.Timer();
  let acc = 0;
  let fps = 60;
  const v2 = new THREE.Vector3();
  let showcaseAuto = params.get('showcase') === '1' ? 0.5 : -1;
  renderer.setAnimationLoop(() => {
    timer.update();
    const rawDt = Math.min(timer.getDelta(), 0.1);
    fps = fps * 0.95 + (1 / Math.max(rawDt, 1e-3)) * 0.05;
    const dt = rawDt * slowmo;
    input.update?.();
    acc += dt;
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < 24) {
      step(PHYSICS_DT);
      acc -= PHYSICS_DT;
      steps++;
    }
    const alpha = acc / PHYSICS_DT;
    for (const k of karts) k.updateVisual(dt, alpha);
    items.updateVisual(dt, alpha);
    track.update?.(dt, world.time, camera);
    track.updateShadowFocus?.(player.position);
    updateCamera(dt, world.time);
    particles.update(dt, camera);
    if (showcaseAuto >= 0) {
      showcaseAuto -= dt;
      if (showcaseAuto < 0) {
        showcase();
        showcaseAuto = 2;
      }
    }
    // showcase labels
    if (showcaseT > 0) {
      showcaseT -= rawDt;
      let html = '';
      for (const l of showcaseLabels) {
        v2.copy(l.p);
        v2.y -= 1.4;
        v2.project(camera);
        if (v2.z > 1) continue;
        const x = (v2.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-v2.y * 0.5 + 0.5) * window.innerHeight;
        html += `<div style="position:absolute;left:${x | 0}px;top:${y | 0}px;transform:translateX(-50%)">${l.t}</div>`;
      }
      labels.innerHTML = html;
    } else if (labels.innerHTML) labels.innerHTML = '';
    renderer.render(scene, camera);
    input.endFrame?.();

    if (panel.style.display !== 'none') {
      const r = player.roulette;
      const inc = (player.incoming || []).map((w) => `${w.kind}@${w.distance.toFixed(0)}`).join(' ');
      panel.textContent =
        `ITEMS DEBUG  ${trackId}   fps ${fps.toFixed(0)}  cam ${camMode}${slowmo < 1 ? '  SLOWMO' : ''}\n` +
        `player: item ${player.item || '-'} x${player.itemUses}  ${r?.active ? `roulette ${(r.time / r.duration * 100) | 0}% -> ${r.result}` : ''}\n` +
        `        coins ${player.coins}  place ${player.place}/${karts.length}  card ${(player.cardTime || 0).toFixed(1)}  inv ${(player.invincibleTime || 0).toFixed(1)}\n` +
        `        incoming ${inc || '-'}  shields ${items.shieldCount(player)}\n` +
        `entities ${items.entities.length}  fx ${items.fx.length}  loose coins ${items.coins.looseCount()}  particles ${particles.liveCount()}/${particles.capacity}\n` +
        `boxes ${items.itemBoxes.filter((b) => b.active).length}/${items.itemBoxes.length}  hits ${stats.hits} gets ${stats.gets} uses ${stats.uses}\n` +
        `draw calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}\n` +
        hitLog.map((h) => `  ${h}`).join('\n') +
        `\n[1-9,0,-,=,[,],\\] give  F use  B bots copy  K bots fire  P fx  V cam  M slowmo`;
    }
  });

  // ------------------------------------------------------------------ self test
  // window.__ssk.selftest(names?) runs scripted scenarios synchronously (fixed steps, no rendering) and
  // returns { name: { pass, ...details } }. Use from tools/shot.mjs --eval "window.__ssk.selftest()".
  const selftest = (only = null) => {
    const L = path.length;
    const base = Number(params.get('testd') || 10);
    const hits = [];
    const offHit = events.on?.('hit', ({ victim, attacker, itemId }) =>
      hits.push({ v: victim?.index, a: attacker?.index ?? -1, item: itemId, coins: victim?.coins })
    );
    const sim = (sec, each) => {
      const n = Math.round(sec / PHYSICS_DT);
      for (let i = 0; i < n; i++) {
        step(PHYSICS_DT);
        if (each && each() === true) return i * PHYSICS_DT;
      }
      return -1;
    };
    // layout[i] = { d (relative to base), lat, yaw (offset), throttle, steer, ai, coins, item }
    const setup = (layout) => {
      items.clearAll();
      items.coins.clearLoose?.();
      hits.length = 0;
      scriptCtl.clear();
      karts.forEach((k, i) => {
        const o = layout[i] || { d: -300 - i * 12, lat: ((i % 3) - 1) * 5 };
        const f = path.frameAt(path.wrapD(base + o.d));
        const lat = o.lat || 0;
        k.reset({ position: f.pos.clone().addScaledVector(f.right, lat), yaw: f.yaw + (o.yaw || 0), d: f.d, lateral: lat });
        k.progress = L + o.d;
        k._lastD = k.proj.d;
        k.item = null;
        k.itemUses = 0;
        k.cardTime = 0;
        k.incoming = [];
        if (k.roulette) k.roulette.active = false;
        k.coins = o.coins ?? 5;
        k.topSpeedScale = 1;
        scriptCtl.set(k, { ...NO, throttle: o.throttle || 0, steer: o.steer || 0, ai: !!o.ai });
        if (o.item) items.giveItem(k, o.item);
      });
      updateProgress();
    };
    const use = (i, back = false) => {
      const k = karts[i];
      const sc = scriptCtl.get(k);
      sc.lookBack = back;
      k.controls.lookBack = back;
      items.useItem(k);
    };
    const hitOn = (i, item) => hits.some((h) => h.v === i && (!item || h.item === item));
    const ents = (kind) => items.entities.filter((e) => e.alive && e.kind === kind);
    const r2 = (x) => Math.round(x * 100) / 100;
    const tests = {
      drink() {
        setup([{ d: 0, throttle: 1 }]);
        sim(0.8);
        items.giveItem(player, 'drink');
        use(0);
        const b = player.boostTime;
        return { pass: b > 0.9 && !player.item, boost: r2(b) };
      },
      drink3() {
        setup([{ d: 0, throttle: 1 }]);
        items.giveItem(player, 'drink3');
        const b = [];
        for (let i = 0; i < 3; i++) {
          use(0);
          b.push(r2(player.boostTime));
          sim(1.4);
        }
        return { pass: b.every((x) => x > 0.9) && !player.item, boosts: b };
      },
      card() {
        setup([{ d: -40, throttle: 0.4 }]);
        items.giveItem(player, 'card');
        let n = 0;
        let prev = 0;
        for (let i = 0; i < 6; i++) {
          prev = player.boostTime;
          use(0);
          if (player.boostTime >= Math.max(1, prev)) n++;
          sim(1.05);
        }
        const during = player.item;
        sim(1.5);
        return { pass: n >= 6 && during === 'card' && !player.item, boosts: n, itemAfter: player.item };
      },
      ramen() {
        setup([{ d: 0 }, { d: -30, throttle: 1 }]);
        items.giveItem(player, 'ramen');
        use(0);
        sim(0.5);
        const r = ents('ramen')[0];
        const behind = r ? r2(path.deltaD(player.proj.d, r.proj.d)) : null;
        sim(3, () => hitOn(1));
        return { pass: hitOn(1, 'ramen') && !hitOn(0) && karts[1].coins === 2, behind, spin: r2(karts[1].spinTime), coins: karts[1].coins };
      },
      ramen3Shield() {
        setup([{ d: 0 }, { d: -22, item: 'bullet' }]);
        items.giveItem(player, 'ramen3');
        use(0);
        sim(0.4);
        const trail = items.states.get(player).trail.map((e) => r2(path.deltaD(player.proj.d, e.proj.d)));
        use(1); // bot fires a round into the trailing bowls
        sim(1.5);
        const left = items.shieldCount(player);
        use(0); // drop one
        sim(0.3);
        return { pass: trail.length === 3 && !hitOn(0) && left === 2 && player.itemUses === 1, trail, shieldsAfterBlock: left, usesAfterDrop: player.itemUses };
      },
      bullet() {
        setup([{ d: 0 }, { d: 32, lat: 0 }]);
        items.giveItem(player, 'bullet');
        use(0);
        const t = sim(2, () => hitOn(1));
        return { pass: hitOn(1, 'bullet') && karts[1].coins === 2 && karts[1].spinTime > 0, t: r2(t), coins: karts[1].coins };
      },
      ricochet() {
        setup([{ d: 0, yaw: 0.85 }]);
        items.giveItem(player, 'bullet');
        use(0);
        let maxB = 0;
        let maxDy = 0;
        let fell = false;
        sim(4, () => {
          const b = ents('bullet')[0];
          if (!b) return true;
          maxB = Math.max(maxB, b.bounces);
          if (b.falling) fell = true;
          else maxDy = Math.max(maxDy, Math.abs(b.pos.y - (b.proj.groundY + b.hover)));
          return false;
        });
        return { pass: maxB >= 2 && maxDy < 0.6 && !fell, bounces: maxB, maxDy: r2(maxDy) };
      },
      bullet3Orbit() {
        setup([{ d: 0 }, { d: -22, item: 'bullet' }, { d: 34 }]);
        items.giveItem(player, 'bullet3');
        use(0);
        sim(0.5);
        const orb = items.states.get(player).orbit;
        const a0 = orb.map((e) => Math.atan2(e.pos.x - player.position.x, e.pos.z - player.position.z));
        sim(0.25);
        const moved = orb.every((e, i) => Math.abs(Math.atan2(e.pos.x - player.position.x, e.pos.z - player.position.z) - a0[i]) > 0.05);
        const radii = orb.map((e) => r2(Math.hypot(e.pos.x - player.position.x, e.pos.z - player.position.z)));
        use(1); // bot behind fires into the orbit
        sim(1.2);
        const afterBlock = items.shieldCount(player);
        use(0); // fire one forward at the kart ahead
        sim(1.5, () => hitOn(2));
        return {
          pass: radii.length === 3 && moved && !hitOn(0) && afterBlock === 2 && hitOn(2, 'bullet3') && player.itemUses === 1,
          radii,
          moved,
          afterBlock,
          hitAhead: hitOn(2),
        };
      },
      missile() {
        // target around the corner, off-line; two more karts far ahead (places 1,2)
        setup([{ d: 0 }, { d: 85, lat: 6 }, { d: 170, lat: -4 }, { d: 240 }]);
        items.giveItem(player, 'missile');
        use(0);
        let warned = 0;
        let lock = false;
        const t = sim(5, () => {
          if (karts[1].incoming.length) warned++;
          if (ents('missile')[0]?.mode === 'home') lock = true;
          return hitOn(1);
        });
        return { pass: hitOn(1, 'missile') && karts[1].launchTime > 0 && !hitOn(2) && !hitOn(3) && warned > 10 && lock, t: r2(t), warnedSteps: warned, lock };
      },
      missile3() {
        setup([{ d: 0 }, { d: 40, lat: -6 }, { d: 170 }, { d: 240 }]);
        items.giveItem(player, 'missile3');
        use(0);
        sim(0.4);
        const orbit = items.shieldCount(player);
        use(0);
        const t = sim(3, () => hitOn(1));
        return { pass: orbit === 3 && hitOn(1, 'missile3') && player.itemUses === 2, orbit, t: r2(t) };
      },
      grenade() {
        setup([{ d: 0, throttle: 0.3 }, { d: 24, lat: 2 }]);
        items.giveItem(player, 'grenade');
        use(0);
        let peak = 0;
        const y0 = player.position.y;
        const t = sim(3, () => {
          const g = ents('grenade')[0];
          if (g) peak = Math.max(peak, g.pos.y - y0);
          return hitOn(1);
        });
        return { pass: hitOn(1, 'grenade') && karts[1].launchTime > 0 && !hitOn(0) && peak > 2, t: r2(t), arcPeak: r2(peak), hits: JSON.stringify(hits), launch: r2(karts[1].launchTime), dist: r2(player.position.distanceTo(karts[1].position)) };
      },
      halo() {
        setup([{ d: 0, throttle: 1 }, { d: 40, lat: 7, item: 'ramen' }]);
        use(1); // bot drops a bowl in the player's lane? (lat 7 -> move the bowl onto the player's line)
        sim(0.6);
        const r = ents('ramen')[0];
        if (r) {
          const f = path.frameAt(r.proj.d);
          r.pos.copy(f.pos).addScaledVector(f.right, 0);
          r.pos.y = f.pos.y + r.hover;
          r.ground();
        }
        items.giveItem(player, 'halo');
        use(0);
        const inv = player.invincibleTime;
        sim(2.2);
        return { pass: inv > 7 && !!r && !r.alive && !hitOn(0), invincible: r2(inv), bowlDestroyed: !!r && !r.alive };
      },
      tablet() {
        setup([{ d: 0 }, { d: 20, item: 'bullet' }, { d: 40, lat: 5 }, { d: 60, item: 'ramen3' }]);
        items.startRoulette(karts[2]);
        items.giveItem(player, 'tablet');
        use(0);
        sim(0.1);
        const sh = karts.slice(1).map((k) => r2(k.shrinkTime));
        const itemsLeft = karts.slice(1).map((k) => k.item || (k.roulette?.active ? 'roulette' : null));
        return {
          pass: sh.every((x) => x >= 3.5) && sh[2] > sh[0] && itemsLeft.every((x) => !x) && player.shrinkTime <= 0,
          shrink: sh,
          itemsLeft,
        };
      },
      seeker() {
        setup([{ d: 0 }, { d: 90, lat: -5 }, { d: 180, ai: true }, { d: 320, ai: true }]);
        items.giveItem(player, 'seeker');
        use(0);
        let warned = 0;
        const t = sim(12, () => {
          if (karts[3].incoming.some((w) => w.kind === 'seeker')) warned++;
          return hitOn(3);
        });
        return { pass: hitOn(3, 'seeker') && karts[3].launchTime > 0 && !hitOn(1) && warned > 30, t: r2(t), warnedSteps: warned, leaderPlace: karts[3].place };
      },
      credits() {
        setup([{ d: 0, coins: 5 }]);
        items.giveItem(player, 'credits');
        use(0);
        return { pass: player.coins === 8 && !player.item, coins: player.coins };
      },
      decoy() {
        setup([{ d: 0 }, { d: -30, throttle: 1 }]);
        items.giveItem(player, 'decoy');
        use(0);
        const t = sim(3, () => hitOn(1));
        return { pass: hitOn(1, 'decoy') && karts[1].launchTime > 0, t: r2(t) };
      },
      itemVsItem() {
        setup([{ d: 0, item: 'bullet' }, { d: 45, yaw: Math.PI, item: 'bullet' }]);
        // face each other exactly (the track curves, so a plain yaw + PI would miss laterally)
        const [ka, kb] = karts;
        const aim = (k, o) => {
          k.yaw = Math.atan2(o.position.x - k.position.x, o.position.z - k.position.z);
          k.forward.set(Math.sin(k.yaw), 0, Math.cos(k.yaw));
          k.right?.set(-Math.cos(k.yaw), 0, Math.sin(k.yaw));
        };
        aim(ka, kb);
        aim(kb, ka);
        use(0);
        use(1);
        sim(1.5);
        return { pass: hits.length === 0 && ents('bullet').length === 0, hits: JSON.stringify(hits), left: ents('bullet').length };
      },
      boxAndRoulette() {
        const box = items.itemBoxes[0];
        if (!box) return { pass: false, why: 'no boxes' };
        setup([{ d: box.d - base - 18, lat: box.lateral, throttle: 1 }]);
        sim(1.5, () => !box.active);
        const got = player.roulette?.active;
        const inactive = !box.active;
        items.useItem(player); // early stop only after 0.7 s -> ignored now
        const early = player.item;
        sim(2.6);
        const item = player.item;
        sim(1.2);
        return { pass: got && inactive && !early && !!item && box.active, roulette: got, item, respawned: box.active };
      },
      coinPickup() {
        const c = items.coinSpots[0];
        if (!c) return { pass: false, why: 'no coins' };
        setup([{ d: c.d - base - 15, lat: c.lateral, throttle: 1, coins: 0 }]);
        sim(1.5);
        return { pass: player.coins >= 1, coins: player.coins };
      },
    };
    const out = {};
    for (const name of Object.keys(tests)) {
      if (only && !only.includes(name)) continue;
      try {
        out[name] = tests[name]();
      } catch (err) {
        out[name] = { pass: false, error: String(err?.stack || err).slice(0, 300) };
      }
    }
    scriptCtl.clear();
    if (typeof offHit === 'function') offHit();
    else events.off?.('hit');
    out.summary = Object.entries(out).filter(([, v]) => !v.pass).map(([k]) => k);
    return out;
  };

  window.__ssk = Object.assign(window.__ssk || {}, {
    selftest,
    items,
    karts,
    particles,
    player,
    track,
    world,
    chase,
    give,
    fire,
    showcase,
    setCam: (m) => (camMode = m),
    /** Put kart i at track distance d (absolute) / lateral, facing along the track. */
    placeAt: (i, d, lat = 0) => {
      const k = karts[i];
      if (!k) return;
      const f = path.frameAt(path.wrapD(d));
      k.reset({ position: f.pos.clone().addScaledVector(f.right, lat), yaw: f.yaw, d: f.d, lateral: lat });
      k.progress += path.deltaD(k.proj.d, k._lastD); // keep places consistent with the teleport
      k._lastD = k.proj.d;
      updateProgress();
    },
    /** Put kart i `dist` units straight in front of the player (along its heading), facing the same way. */
    placeAhead: (i, dist, side = 0) => {
      const k = karts[i];
      if (!k) return;
      const p = player.position.clone().addScaledVector(player.forward, dist).addScaledVector(player.right, side);
      k.reset({ position: p, yaw: player.yaw });
      k.progress += path.deltaD(k.proj.d, k._lastD);
      k._lastD = k.proj.d;
      updateProgress();
    },
    setAutopilot: (on) => {
      autopilot = on;
      if (on) drivers.set(player, makeAI(player, 0.9));
      else drivers.delete(player);
    },
    stats: () => ({
      ...stats,
      entities: items.entities.map((e) => `${e.kind}:${e.mode}${e.attached ? '(att)' : ''}`),
      particles: particles.liveCount(),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      player: { item: player.item, uses: player.itemUses, coins: player.coins, place: player.place, incoming: player.incoming },
      log: log.slice(-30),
      fps: Math.round(fps),
    }),
  });
}
