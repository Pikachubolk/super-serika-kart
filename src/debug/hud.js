// Debug scene (owner: hud agent): /?scene=hud
//
// A simple 3D backdrop (a ribbon road along a real track path with toy karts) plus the real HUD driven by a
// scripted fake HudState timeline that cycles through every HUD feature.
//
// Params:
//   &demo=all|intro|countdown|race|roulette|finallap|wrongway|finish   timeline segment (default all, loops)
//   &demo=icons   item icon gallery (&size=<px>, &img=1 to render through the data: URLs)
//   &demo=places  the eight place-indicator colour ramps side by side
//   &freeze=<s>   seconds from the start of the chosen segment: play up to that moment, then pause everything
//                 (state + CSS/WAAPI animations) so screenshots are deterministic. Use --wait >= 5000.
//   &track=<id>   track outline for the minimap / backdrop (default abydos-desert)
//   &mode=vs|gp|tt  &map=both|map|ranks|none  &speed=<timeline speed multiplier>
//
// window.__ssk.hudState (current fake HudState), window.__ssk.hud (HUD instance), window.__ssk.hudTime.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createRenderer, bindResize } from '../core/renderer.js';
import { TrackPath } from '../world/TrackPath.js';
import { loadTrackDef, getTrackEntry, TEST_TRACKS } from '../data/tracks/index.js';
import { CHARACTERS } from '../data/characters.js';
import { ITEMS } from '../data/items.js';
import { MAX_CREDITS } from '../data/engine.js';
import { HUD } from '../ui/HUD.js';
import { Portraits } from '../ui/Portraits.js';
import { itemIconSVG, itemIconURL, coinIconSVG, crystalIconSVG, ITEM_ICON_IDS } from '../ui/itemIcons.js';
import { clamp, lerp, mulberry32, ordinalSuffix } from '../core/utils.js';
import '../styles/hud.css';

// ---------------------------------------------------------------------------------------------------------
// Timeline (absolute seconds). Race time starts at GO (t = 7).
// ---------------------------------------------------------------------------------------------------------

const GO = 7;
const FINISH = 53;
const END = 59;
const SEGMENTS = {
  all: [0, END],
  intro: [0, 4.2],
  countdown: [3.4, 9.5],
  race: [7, 15],
  roulette: [10.6, 26],
  finallap: [42.4, 46],
  wrongway: [44.4, 51],
  finish: [52, END],
};

const ROULETTE_TIME = 2.4;
const ROULETTES = [
  { start: 11.0, result: 'missile', uses: [[15.0, 0]] },
  { start: 15.6, result: 'drink3', uses: [[19.0, 2], [19.8, 1], [20.6, 0]] },
  { start: 21.2, result: 'card', card: 24.2 },
  { start: 35.2, result: 'halo', uses: [[38.2, 0]] },
];
const COIN_PICKUPS = [8.2, 8.7, 9.2, 10.0, 10.4, 12.2, 12.5, 33.0, 33.4, 33.8, 34.2, 39.0, 39.3, 39.6, 39.9, 40.2];
const COIN_LOSSES = [[27.0, 3]];
const BOOSTS = [
  [7.0, 7.9],
  [19.0, 20.1],
  [19.8, 20.9],
  [20.6, 21.7],
  [24.2, 25.2],
  [26.0, 27.0],
  [28.2, 29.2],
  [30.0, 31.0],
  [38.2, 42.5],
];
// player place keyframes over race time (rt = t - GO)
const PLACE_KEYS = [
  [0, 8],
  [1.5, 7],
  [3, 6],
  [4.5, 5],
  [6, 4],
  [9, 3],
  [14, 3],
  [17, 2],
  [19.8, 2.2],
  [20.6, 4.3],
  [26, 3],
  [30, 2],
  [31.2, 2],
  [33, 1],
  [37.6, 1],
  [38.8, 2],
  [41.3, 2],
  [42.6, 3],
  [44.6, 2],
  [60, 2],
];
const LAP_TIMES = [
  [28.5, 21.5],
  [43.0, 14.5],
  [FINISH, 10.0],
];

const within = (t, a, b) => t >= a && t < b;

function placeKey(rt) {
  if (rt <= PLACE_KEYS[0][0]) return PLACE_KEYS[0][1];
  for (let i = 1; i < PLACE_KEYS.length; i++) {
    const [t1, p1] = PLACE_KEYS[i];
    const [t0, p0] = PLACE_KEYS[i - 1];
    if (rt <= t1) return lerp(p0, p1, (rt - t0) / (t1 - t0));
  }
  return PLACE_KEYS[PLACE_KEYS.length - 1][1];
}

function itemAt(t) {
  let r = null;
  for (const x of ROULETTES) if (t >= x.start) r = x;
  const empty = { id: null, uses: 0, roulette: false, rouletteProgress: 0, cardTime: 0 };
  if (!r) return empty;
  if (t < r.start + ROULETTE_TIME) return { ...empty, roulette: true, rouletteProgress: (t - r.start) / ROULETTE_TIME };
  const it = { ...empty, id: r.result, uses: ITEMS[r.result]?.uses ?? 1 };
  if (r.card != null && t >= r.card) {
    it.cardTime = Math.max(0, 7 - (t - r.card));
    if (it.cardTime <= 0) return empty;
  }
  for (const [time, u] of r.uses || []) if (t >= time) it.uses = u;
  if (it.uses <= 0) return empty;
  return it;
}

function coinsAt(t) {
  let c = 0;
  const ev = [...COIN_PICKUPS.map((x) => [x, 1]), ...COIN_LOSSES.map(([x, n]) => [x, -n])].sort((a, b) => a[0] - b[0]);
  for (const [x, d] of ev) if (t >= x) c = clamp(c + d, 0, MAX_CREDITS);
  return c;
}

// ---------------------------------------------------------------------------------------------------------
// Fake race: rivals drive along the path, the player is slotted between them by the scripted place
// ---------------------------------------------------------------------------------------------------------

class FakeRace {
  constructor(path, playerId, mode) {
    this.path = path;
    this.mode = mode;
    this.L = path.length;
    const rng = mulberry32(7);
    const ids = CHARACTERS.map((c) => c.id);
    const order = [playerId, ...ids.filter((i) => i !== playerId)];
    const solo = mode === 'tt';
    this.racers = (solo ? order.slice(0, 1) : order).map((cid, i) => {
      const c = CHARACTERS.find((x) => x.id === cid);
      return {
        id: `k${i}`,
        characterId: cid,
        name: c.name,
        isPlayer: i === 0,
        slot: i === 0 ? 7 : i - 1,
        v: this.L / 21.5 + (rng() - 0.5) * 3,
        a: 6 + rng() * 10,
        w: 0.15 + rng() * 0.25,
        ph: rng() * 6.28,
        lat: (rng() - 0.5) * 10,
        progress: 0,
      };
    });
    this.player = this.racers[0];
  }

  stateAt(t) {
    const rt = Math.max(0, t - GO);
    const racing = t >= GO;
    const others = this.racers.filter((r) => !r.isPlayer);
    for (const r of others) {
      const grid = -r.slot * 5 - 4;
      r.progress = grid + (racing ? r.v * rt + r.a * Math.sin(r.w * rt + r.ph) - r.a * Math.sin(r.ph) : 0);
    }
    const sortedO = [...others].sort((a, b) => b.progress - a.progress);
    const P = (p) => {
      if (!sortedO.length) return rt * (this.L / 21.5);
      if (p <= 1) return sortedO[0].progress + 6;
      if (p > sortedO.length) return sortedO[sortedO.length - 1].progress - 6;
      return (sortedO[p - 2].progress + sortedO[p - 1].progress) / 2;
    };
    const pf = clamp(placeKey(rt), 1, others.length + 1);
    const p0 = Math.floor(pf);
    this.player.progress = racing ? lerp(P(p0), P(Math.min(others.length + 1, p0 + 1)), pf - p0) : -7 * 5 - 4;
    if (!racing && others.length) this.player.progress = -others.length * 5 - 4;
    const all = [...this.racers].sort((a, b) => b.progress - a.progress);
    const L = this.L;
    const out = all.map((r, i) => {
      const d = ((r.progress % L) + L) % L;
      const f = this.path.frameAt(d);
      const lat = r.isPlayer ? Math.sin(t * 0.7) * 3 : r.lat + Math.sin(t * 0.5 + r.ph) * 2;
      const pos = this.path.pointAt(d, lat);
      const lapN = Math.max(1, Math.floor(r.progress / L) + 1);
      const leaderDone = !r.isPlayer && i === 0 && t >= FINISH - 2;
      return {
        id: r.id,
        characterId: r.characterId,
        name: r.name,
        place: i + 1,
        isPlayer: r.isPlayer,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw: f.yaw,
        finished: r.isPlayer ? t >= FINISH : leaderDone,
        lap: lapN,
        d,
        lateral: lat,
      };
    });
    return out;
  }
}

function buildState(t, fake, mode) {
  const racers = fake.stateAt(t);
  const me = racers.find((r) => r.isPlayer);
  const phase = t < 3.9 ? 'intro' : t < GO ? 'countdown' : t < FINISH ? 'racing' : 'finished';
  const lapTimes = LAP_TIMES.filter(([x]) => t >= x).map(([, v]) => v);
  const lap = Math.min(3, lapTimes.length + 1);
  const incoming = [];
  if (within(t, 25, 27)) incoming.push({ kind: 'missile', distance: ((27 - t) / 2) * 90 });
  if (within(t, 50.3, 52.4)) incoming.push({ kind: 'seeker', distance: 40 + Math.sin(t * 2) * 30 });
  const item = mode === 'tt' ? (t >= GO ? { id: 'drink3', uses: t < 20 ? 3 : t < 30 ? 2 : 1, roulette: false, rouletteProgress: 0, cardTime: 0 } : { id: null, uses: 0 }) : itemAt(t);
  return {
    mode,
    phase,
    time: Math.max(0, t - GO),
    countdown: phase === 'countdown' ? GO - t : null,
    lap,
    laps: 3,
    place: me.place,
    racerCount: racers.length,
    coins: coinsAt(t),
    maxCoins: MAX_CREDITS,
    item,
    speed: phase === 'racing' ? 34 : 0,
    topSpeed: 36,
    boosting: BOOSTS.some(([a, b]) => within(t, a, b)),
    drifting: within(t, 12, 14),
    driftLevel: within(t, 12, 14) ? Math.min(3, Math.floor((t - 12) * 1.5) + 1) : 0,
    wrongWay: within(t, 45, 48),
    finished: t >= FINISH,
    respawning: within(t, 48.5, 50.1),
    shrunk: within(t, 31.5, 35),
    invincible: within(t, 38.2, 42.5),
    incoming,
    lapTimes,
    lastLapTime: lapTimes[lapTimes.length - 1] ?? null,
    bestLapTime: lapTimes.length ? Math.min(...lapTimes) : null,
    ttRecord: 44.321,
    racers,
    player: { x: me.x, z: me.z, yaw: me.yaw },
  };
}

function buildEvents(trackName, mode) {
  return [
    [0.3, (hud) => hud.titleCard(trackName, `${mode === 'tt' ? 'Time Trial' : 'Credit Cup'}  ·  ${mode === 'tt' ? 'Solo' : 'Race 1 / 4'}  ·  150cc`)],
    [4.0, (hud) => hud.countdown(3)],
    [5.0, (hud) => hud.countdown(2)],
    [6.0, (hud) => hud.countdown(1)],
    [GO, (hud) => hud.countdown(0)],
    [GO + 0.05, (hud) => (hud.flash('boost'), hud.notify('Rocket start!', { icon: 'drink', color: '#27d3f0', duration: 1.8 }))],
    [27.0, (hud) => (hud.flash('hit'), hud.notify('Hina hit you with a Drone Missile!', { icon: 'missile', color: '#ff4040' }))],
    [28.5, (hud) => hud.lapBanner(2, 3)],
    [31.5, (hud) => (hud.flash('tablet'), hud.notify('Arisu zapped everyone with the Shittim Tablet!', { icon: 'tablet', color: '#35c8ff' }))],
    [38.2, (hud) => hud.flash('halo')],
    [43.0, (hud) => hud.lapBanner(3, 3)],
    [48.5, (hud) => hud.flash('respawn')],
    [FINISH, (hud) => hud.finishBanner(2)],
  ];
}

// ---------------------------------------------------------------------------------------------------------
// 3D backdrop
// ---------------------------------------------------------------------------------------------------------

function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
  }
  return tex;
}

function buildBackdrop(scene, path, racers) {
  scene.background = canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#3a8cff');
    gr.addColorStop(0.55, '#9fd4ff');
    gr.addColorStop(0.75, '#fff1d6');
    gr.addColorStop(1, '#fff1d6');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog('#dcecff', 140, 620);
  scene.add(new THREE.HemisphereLight('#dff0ff', '#b89868', 1.6));
  const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
  sun.position.set(80, 140, 40);
  scene.add(sun);

  let minY = Infinity;
  for (const s of path.samples) minY = Math.min(minY, s.pos.y);
  const b = path.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;

  const groundTex = canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#e8c889';
      g.fillRect(0, 0, w, h);
      const rng = mulberry32(3);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = rng() < 0.5 ? 'rgba(200,160,90,.25)' : 'rgba(255,240,200,.3)';
        g.fillRect(rng() * w, rng() * h, 2 + rng() * 4, 1 + rng() * 2);
      }
    },
    true,
  );
  groundTex.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, minY - 0.4, cz);
  scene.add(ground);

  // road ribbon
  const roadTex = canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#5a5d66';
      g.fillRect(0, 0, w, h);
      const rng = mulberry32(9);
      for (let i = 0; i < 2500; i++) {
        g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.06)';
        g.fillRect(rng() * w, rng() * h, 2, 2);
      }
      g.fillStyle = '#f4f4f4';
      g.fillRect(10, 0, 6, h);
      g.fillRect(w - 16, 0, 6, h);
      g.fillRect(w / 2 - 3, 0, 6, h * 0.5);
    },
    true,
  );
  const curbTex = canvasTex(
    32,
    64,
    (g, w, h) => {
      g.fillStyle = '#e8304f';
      g.fillRect(0, 0, w, h / 2);
      g.fillStyle = '#ffffff';
      g.fillRect(0, h / 2, w, h / 2);
    },
    true,
  );
  const n = path.count;
  const mk = (off0, off1, vScale) => {
    const pos = new Float32Array((n + 1) * 2 * 3);
    const uv = new Float32Array((n + 1) * 2 * 2);
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const s = path.samples[i % n];
      const d = i === n ? path.length : s.d;
      const hw = s.halfWidth;
      for (let k = 0; k < 2; k++) {
        const o = k === 0 ? off0(hw) : off1(hw);
        const j = (i * 2 + k) * 3;
        pos[j] = s.pos.x + s.right.x * o;
        pos[j + 1] = s.pos.y + s.right.y * o + 0.05;
        pos[j + 2] = s.pos.z + s.right.z * o;
        uv[(i * 2 + k) * 2] = k;
        uv[(i * 2 + k) * 2 + 1] = d / vScale;
      }
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(mk((hw) => -hw, (hw) => hw, 10), roadMat));
  const curbMat = new THREE.MeshLambertMaterial({ map: curbTex, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(mk((hw) => -hw - 1.6, (hw) => -hw, 3), curbMat));
  scene.add(new THREE.Mesh(mk((hw) => hw, (hw) => hw + 1.6, 3), curbMat));

  // scenery: instanced palms / rocks away from the road
  const rng = mulberry32(21);
  const spots = [];
  for (let tries = 0; spots.length < 170 && tries < 3000; tries++) {
    const s = path.samples[Math.floor(rng() * n)];
    const side = rng() < 0.5 ? -1 : 1;
    const off = s.halfWidth + 8 + rng() * 60;
    const x = s.pos.x + s.rightH.x * off * side;
    const z = s.pos.z + s.rightH.z * off * side;
    let ok = true;
    for (let i = 0; i < n; i += 4) {
      const q = path.samples[i];
      if ((q.pos.x - x) ** 2 + (q.pos.z - z) ** 2 < (q.halfWidth + 6) ** 2) {
        ok = false;
        break;
      }
    }
    if (ok) spots.push({ x, z, s: 0.8 + rng() * 0.8, r: rng() * 6.28, kind: rng() < 0.7 ? 0 : 1 });
  }
  const palms = spots.filter((p) => p.kind === 0);
  const rocks = spots.filter((p) => p.kind === 1);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.55, 7, 7), new THREE.MeshLambertMaterial({ color: '#a7784a' }), palms.length);
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(3.4, 2.6, 7), new THREE.MeshLambertMaterial({ color: '#3fae5b' }), palms.length);
  const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(2.2, 0), new THREE.MeshLambertMaterial({ color: '#d9a86a' }), rocks.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  palms.forEach((p, i) => {
    const y = minY - 0.4;
    m.compose(new THREE.Vector3(p.x, y + 3.5 * p.s, p.z), q.setFromEuler(e.set(0, p.r, 0.08)), new THREE.Vector3(p.s, p.s, p.s));
    trunk.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, y + 7.4 * p.s, p.z), q.setFromEuler(e.set(0, p.r, 0)), new THREE.Vector3(p.s, p.s, p.s));
    crown.setMatrixAt(i, m);
  });
  rocks.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x, minY + 0.4, p.z), q.setFromEuler(e.set(p.r, p.r * 2, 0)), new THREE.Vector3(p.s * 1.4, p.s, p.s * 1.2));
    rock.setMatrixAt(i, m);
  });
  scene.add(trunk, crown, rock);

  // start gantry
  const s0 = path.samples[0];
  const gantry = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: '#e9eef5' });
  const w = s0.halfWidth + 2;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 1), postMat);
    post.position.set(side * w, 4, 0);
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 1, 2, 1), new THREE.MeshLambertMaterial({ color: '#1fb6ff' }));
  beam.position.y = 8.5;
  gantry.add(beam);
  gantry.position.copy(s0.pos);
  gantry.rotation.y = s0.yaw + Math.PI / 2;
  gantry.rotation.y = Math.atan2(s0.rightH.x, s0.rightH.z);
  scene.add(gantry);

  // toy karts
  const karts = new Map();
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12).rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: '#23262e' });
  for (const r of racers) {
    const c = CHARACTERS.find((x) => x.id === r.characterId);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.55, 2.2, 3, 0.2), new THREE.MeshToonMaterial({ color: c.kart.body }));
    body.position.y = 0.55;
    g.add(body);
    for (const [x, z] of [
      [-0.75, 0.7],
      [0.75, 0.7],
      [-0.75, -0.7],
      [0.75, -0.7],
    ]) {
      const wh = new THREE.Mesh(wheelGeo, wheelMat);
      wh.position.set(x, 0.42, z);
      g.add(wh);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshToonMaterial({ color: c.look.hair }));
    head.position.set(0, 1.45, -0.2);
    g.add(head);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 6, 24), new THREE.MeshBasicMaterial({ color: c.look.halo.color }));
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 2.2, -0.2);
    g.add(halo);
    scene.add(g);
    karts.set(r.id, g);
  }
  return { karts, center: new THREE.Vector3(cx, 0, cz), size: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) };
}

// ---------------------------------------------------------------------------------------------------------
// Galleries
// ---------------------------------------------------------------------------------------------------------

function iconGallery(params, root) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;inset:0;display:flex;flex-wrap:wrap;gap:18px;padding:24px;align-content:flex-start;background:linear-gradient(135deg,#bfe6ff,#e9f5ff 50%,#ffe9f3);pointer-events:auto;overflow:auto';
  const size = Number(params.get('size') || 150);
  const cell = (label, svg, url) => {
    const c = document.createElement('div');
    c.style.cssText = `width:${size}px;text-align:center;color:#1b2340;font:600 12px sans-serif`;
    c.innerHTML = `<div style="width:${size}px;height:${size}px;border-radius:50%;background:radial-gradient(circle at 50% 35%,#ffffffcc,#7fc8ffaa 70%,#2f7fe0aa);border:6px solid #fff;box-shadow:0 4px 10px #0004;display:grid;place-items:center">${
      url ? `<img src="${url}" style="width:78%;height:78%">` : `<div style="width:78%;height:78%">${svg}</div>`
    }</div>${label}`;
    el.appendChild(c);
  };
  for (const id of ITEM_ICON_IDS) cell(ITEMS[id]?.name || id, itemIconSVG(id), params.get('img') ? itemIconURL(id) : null);
  cell('Credit', coinIconSVG());
  cell('Pyroxene', crystalIconSVG());
  root.appendChild(el);
}

function placesGallery(root) {
  const el = document.createElement('div');
  el.className = 'hud-root';
  el.style.cssText = 'background:linear-gradient(180deg,#4a90e2,#9fd4ff 60%,#e8c889 60%)';
  const row = document.createElement('div');
  row.style.cssText = 'position:absolute;inset:0;display:flex;flex-wrap:wrap;align-content:center;justify-content:center;gap:4vmin 6vmin;padding:4vmin';
  const ot = (cls, t) => `<span class="${cls}"><span class="hud-ot"><span class="hud-ot-b">${t}</span><span class="hud-ot-m">${t}</span><span class="hud-ot-f">${t}</span></span></span>`;
  for (let p = 1; p <= 8; p++) {
    row.insertAdjacentHTML(
      'beforeend',
      `<div class="hud-place hud-place-p${p}" style="position:relative;right:auto;bottom:auto"><div class="hud-place-inner"><div class="hud-place-halo"></div>${ot('hud-place-num', p)}${ot(
        'hud-place-suf',
        ordinalSuffix(p),
      )}</div></div>`,
    );
  }
  el.appendChild(row);
  root.appendChild(el);
}

// ---------------------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------------------

/** Built-in test shapes for the minimap (the cup tracks may still be stubs while they are being authored). */
function builtinTrack(id) {
  if (id === 'figure8') {
    const points = [];
    const n = 20;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      points.push({ x: 170 * Math.sin(t), y: 5 + 5 * Math.cos(t), z: 110 * Math.sin(t) * Math.cos(t), w: 20 });
    }
    return { id: 'figure8', name: 'Figure-8 Overpass', laps: 3, width: 20, points };
  }
  if (id === 'hook') {
    const P = [[0, 0], [120, 0], [190, 30], [210, 100], [170, 150], [110, 140], [90, 90], [40, 110], [10, 180], [-60, 190], [-110, 130], [-90, 50]];
    return { id: 'hook', name: 'Hook Test Circuit', laps: 3, width: 20, points: P.map(([x, z]) => ({ x, y: 0, z })) };
  }
  return null;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

// Other agents edit modules this scene imports while screenshots are being taken; accepting the update here
// stops Vite from full-reloading the page mid-capture (reload manually to pick up changes).
if (import.meta.hot) {
  import.meta.hot.accept(() => {});
}

export async function run({ params, container, hudRoot, overlayRoot }) {
  window.__ssk = window.__ssk || {};
  const demo = params.get('demo') || 'all';
  if (demo === 'icons') return iconGallery(params, overlayRoot);
  if (demo === 'places') return placesGallery(overlayRoot);

  const mode = params.get('mode') || 'vs';
  const trackId = params.get('track') || 'abydos-desert';
  let def = null;
  let path = null;
  try {
    def = builtinTrack(trackId) || (getTrackEntry(trackId) ? await loadTrackDef(trackId) : null);
    if (def) path = new TrackPath(def);
  } catch (err) {
    console.warn('[hud debug] track failed, using test-oval', err);
  }
  if (!path) {
    def = await TEST_TRACKS[0].load();
    path = new TrackPath(def);
  }
  const trackName = getTrackEntry(def.id)?.name || def.name || 'Test Oval';
  window.__ssk.hudTrack = def.id;

  const renderer = createRenderer(container);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 3000);
  bindResize(renderer, () => [camera]);

  const portraits = new Portraits(renderer);
  try {
    await withTimeout(portraits.generate(CHARACTERS), 10000);
  } catch (err) {
    console.warn('[hud debug] portraits failed', err);
  }
  try {
    await withTimeout(document.fonts?.ready ?? Promise.resolve(), 4000);
  } catch {
    /* ignore */
  }

  const playerId = params.get('char') || 'serika';
  const fake = new FakeRace(path, playerId, mode);
  const backdrop = buildBackdrop(scene, path, fake.racers);

  // minimap outline straight from the TrackPath (TrackBuilder exposes the same data as track.minimap)
  const outline = path.outline2D(4);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const settings = { hudMap: params.get('map') || 'both' };
  const makeHud = () => {
    const hud = new HUD(hudRoot, {
      racers: fake.racers.map((r) => ({ id: r.id, characterId: r.characterId, name: r.name, isPlayer: r.isPlayer })),
      laps: 3,
      track: { name: trackName, outline, bounds: { minX, maxX, minZ, maxZ } },
      portraits,
      mode,
      settings,
      cupName: 'Credit Cup',
    });
    hud.show();
    window.__ssk.hud = hud;
    return hud;
  };
  let hud = makeHud();

  const [segA, segB] = SEGMENTS[demo] || SEGMENTS.all;
  const freezeParam = params.get('freeze');
  const freezeAt = freezeParam != null ? segA + Number(freezeParam) : null;
  const speedMul = Number(params.get('speed') || 1);
  const events = buildEvents(trackName, mode);
  let t = freezeAt != null ? Math.max(segA, freezeAt - 2.2) : segA;
  let prevT = t - 1e-6;
  let frozen = false;
  let pausedAnims = false;

  const fire = (a, b) => {
    for (const [et, fn] of events) if (et > a && et <= b) fn(hud);
  };
  // catch up events of the segment that belong "just before" the start (e.g. phase-driven state)
  const timer = new THREE.Timer();
  const camPos = new THREE.Vector3();
  const look = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    timer.update();
    // while playing towards a freeze point, follow real time closely so CSS animations stay in sync
    const dt = Math.min(timer.getDelta(), freezeAt != null ? 0.5 : 0.1);
    if (!frozen) {
      t += dt * speedMul;
      if (freezeAt != null && t >= freezeAt) {
        t = freezeAt;
        frozen = true;
      }
      if (freezeAt == null && t > segB) {
        hud.dispose();
        hud = makeHud();
        t = segA;
        prevT = t - 1e-6;
      }
      fire(prevT, t);
      prevT = t;
      const state = buildState(t, fake, mode);
      window.__ssk.hudState = state;
      window.__ssk.hudTime = t;
      hud.update(state, dt * speedMul);

      // karts + camera
      for (const r of state.racers) {
        const g = backdrop.karts.get(r.id);
        if (!g) continue;
        g.position.set(r.x, r.y, r.z);
        g.rotation.y = r.yaw;
        g.scale.setScalar(r.isPlayer && state.shrunk ? 0.55 : 1);
      }
      const me = state.racers.find((r) => r.isPlayer);
      if (state.phase === 'intro') {
        const a = t * 0.35;
        const f0 = path.frameAt(0);
        camPos.set(f0.pos.x + Math.cos(a) * 55, f0.pos.y + 22 - t * 2, f0.pos.z + Math.sin(a) * 55);
        look.copy(f0.pos);
      } else {
        const back = state.wrongWay ? -1 : 1;
        const behind = path.pointAt(me.d - 7.5 * back, me.lateral * 0.8);
        const ahead = path.pointAt(me.d + 12 * back, me.lateral * 0.5);
        camPos.set(behind.x, behind.y + 3.1, behind.z);
        look.set(ahead.x, ahead.y + 1.2, ahead.z);
      }
      camera.position.copy(camPos);
      camera.lookAt(look);
      camera.fov = state.boosting ? 80 : 70;
      camera.updateProjectionMatrix();
    } else if (!pausedAnims) {
      // hold everything (CSS + WAAPI animations) on this exact frame for deterministic screenshots
      pausedAnims = true;
      requestAnimationFrame(() => {
        for (const a of document.getAnimations?.() || []) a.pause();
      });
    }
    renderer.render(scene, camera);
  });
}
