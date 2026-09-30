// Shibaseki Ramen Street (owner: tracks-A) — Credit Cup race 2.
// Kivotos city blocks at sunset: a lantern-lit shopping street past the famous Shibaseki ramen shop, square
// city corners, a side-street jog with delivery scooters, an on-ramp up to the elevated highway that crosses
// OVER the shopping street (11.5 units of clearance), a descent through the west blocks and the underpass run
// back onto the main straight.

import { course, makeMerger } from './abydos-desert.js';

// ---- layout (figure-8: right-hand loop east, left-hand loop west, crossing at the underpass) --------------
const C = course({ x: 0, z: 0, y: 0, yaw: Math.PI / 2, attrs: { w: 24, off: 5 } }, [
  { len: 115, w: 24, off: 5, mark: 'shop' }, // shopping street (start), ramen shop on the left
  { arc: 90, r: 36, w: 21, off: 5, bank: 4, mark: 'c1' },
  { len: 45, w: 21, off: 5, mark: 'side' }, // side street: delivery scooters
  { arc: -60, r: 40, n: 2, w: 20, off: 4, bank: -4, mark: 'jog1' }, // city jog (S-bend)
  { arc: 60, r: 40, n: 2, w: 20, off: 4, bank: 4, mark: 'jog2' },
  { len: 35, w: 21, off: 5, mark: 'side2' },
  { arc: 90, r: 36, w: 21, off: 5, bank: 4, mark: 'c2' },
  { len: 25, w: 22, off: 5, mark: 'back' },
  { len: 125, n: 2, w: 21, off: 4, y: 11, mark: 'onramp' }, // on-ramp up to the highway
  { len: 25, w: 20, off: 3, y: 11.5, mark: 'hwy' },
  { arc: 90, r: 44, w: 20, off: 3, bank: 7, y: 11.5, mark: 'c3' }, // banked highway curve
  { len: 230, n: 3, w: 20, off: 3, y: 11.5, mark: 'bridge' }, // elevated highway over the shopping street
  { arc: -90, r: 40, w: 20, off: 4, bank: -6, y: 8, mark: 'c4' },
  { len: 45, w: 21, off: 5, y: 3.5, mark: 'west' },
  { arc: -90, r: 36, w: 21, off: 5, bank: -4, y: 0.5, mark: 'c5' },
  { close: true, r: 36, turn: 'left', mark: 'c6', markA: 'north', markB: 'final', yA: 0, attrsArc: { w: 21, off: 5, bank: -4 }, attrsB: { w: 24, off: 5 } },
]);

export const MARKS = C.marks;
export const CLOSE = C.closeInfo;
const T = (mark, off = 0) => {
  const t = (C.marks[mark] + off) / C.length;
  return ((t % 1) + 1) % 1;
};

const RED = '#d8322e';
const WOOD = '#7a4a2c';
const WOOD_D = '#56331f';

// ---- the Shibaseki ramen shop ------------------------------------------------------------------------------
function buildRamenShop(ctx) {
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const wood = ctx.mat(WOOD, { toon: true });
  const woodD = ctx.mat(WOOD_D, { toon: true });
  const plaster = ctx.mat('#f3e6cf', { toon: true });
  const roof = ctx.mat('#3b3f52', { toon: true });
  const red = ctx.mat(RED, { toon: true });
  const warm = ctx.mat('#ffcf7a', { toon: true, emissive: '#ffb347', emissiveIntensity: 0.9 });
  const counter = ctx.mat('#c89a64', { toon: true });
  const W = 18;
  const D = 11;
  // ground floor (front at z = 0): posts, warm-lit interior, counter
  M.add(new THREE.BoxGeometry(W, 4.4, D), plaster, { p: [0, 2.2, -D / 2 - 0.4] });
  M.add(new THREE.BoxGeometry(W - 2, 3.4, 0.2), warm, { p: [0, 2.1, -0.35], shadow: false });
  M.add(new THREE.BoxGeometry(W - 3, 1.1, 1), counter, { p: [0, 0.55, 0.2] });
  for (let x = -W / 2; x <= W / 2 + 0.01; x += W / 4) M.add(new THREE.BoxGeometry(0.5, 4.4, 0.5), woodD, { p: [x, 2.2, 0] });
  // stools
  for (let x = -6; x <= 6; x += 2.4) M.add(new THREE.CylinderGeometry(0.35, 0.3, 0.8, 8), red, { p: [x, 0.4, 1.2] });
  // first-floor eave (sloped tiles)
  M.add(new THREE.BoxGeometry(W + 1.6, 0.35, 2.6), roof, { p: [0, 4.75, 0.6], r: [0.32, 0, 0] });
  // upper floor: wooden façade with lit windows
  M.add(new THREE.BoxGeometry(W - 0.6, 4.6, D - 1), wood, { p: [0, 7.3, -D / 2 - 0.2] });
  for (let x = -6; x <= 6; x += 4) {
    M.add(new THREE.BoxGeometry(2.6, 1.8, 0.2), warm, { p: [x, 7.3, 0.12], shadow: false });
    M.add(new THREE.BoxGeometry(0.12, 1.8, 0.25), woodD, { p: [x, 7.3, 0.2], shadow: false });
  }
  // main gabled roof
  const gable = new THREE.CylinderGeometry(1, 1, W + 1.8, 3, 1);
  M.add(gable, roof, { p: [0, 10.5, -D / 2 - 0.2], r: [0, 0, Math.PI / 2], s: [1.5, 1, D * 0.62] });
  M.add(new THREE.BoxGeometry(W + 2, 0.4, 0.5), roof, { p: [0, 12.0, -D / 2 - 0.2] });
  // noren curtains (four red panels with a white stripe) + rod
  M.add(new THREE.CylinderGeometry(0.06, 0.06, W - 3, 6), woodD, { p: [0, 3.9, 0.55], r: [0, 0, Math.PI / 2], shadow: false });
  const g = M.build('ramenShop');

  const noren = ctx.textTexture('RAMEN', { width: 512, height: 160, bg: RED, color: '#ffffff', stroke: '#6a1010', size: 96 });
  const nm = ctx.mat('#ffffff', { map: noren, side: 2, toon: true });
  for (let k = 0; k < 4; k++) {
    const x = -4.5 + k * 3;
    const n = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.5), nm);
    n.position.set(x, 3.15, 0.56);
    g.add(n);
  }
  // big SHIBASEKI signboard over the eave
  const st = ctx.textTexture('SHIBASEKI', { width: 1024, height: 200, bg: '#fff4de', color: RED, stroke: '#3a0c0c', size: 150 });
  const sb = new THREE.Mesh(new THREE.BoxGeometry(13, 2.4, 0.4), [woodD, woodD, woodD, woodD, ctx.mat('#ffffff', { map: st, emissive: '#ffffff', emissiveMap: st, emissiveIntensity: 0.35, toon: true }), woodD]);
  sb.position.set(0, 10.4, 0.6);
  g.add(sb);

  // giant ramen bowl on the roof (+ noodles, naruto, egg, chopsticks), tilted towards the road
  const bowl = new THREE.Group();
  const BM = makeMerger(ctx);
  BM.add(new THREE.SphereGeometry(4.2, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), red, {});
  BM.add(new THREE.TorusGeometry(4.2, 0.25, 6, 28), ctx.mat('#ffffff', { toon: true }), { r: [Math.PI / 2, 0, 0] });
  BM.add(new THREE.CylinderGeometry(4.0, 4.0, 0.2, 28), ctx.mat('#f0b25a', { toon: true }), { p: [0, -0.35, 0] }); // broth
  for (let k = 0; k < 7; k++) BM.add(new THREE.TorusGeometry(0.9 + (k % 3) * 0.5, 0.12, 4, 14), ctx.mat('#ffe08a', { toon: true }), { p: [((k * 37) % 5) - 2, -0.2, ((k * 23) % 5) - 2], r: [Math.PI / 2, 0, k] });
  BM.add(new THREE.CylinderGeometry(0.9, 0.9, 0.25, 16), ctx.mat('#ffffff', { toon: true }), { p: [1.8, -0.1, -1.2] });
  BM.add(new THREE.TorusGeometry(0.45, 0.1, 4, 14), ctx.mat('#ff6fa5', { toon: true }), { p: [1.8, 0.05, -1.2], r: [Math.PI / 2, 0, 0] });
  BM.add(new THREE.SphereGeometry(0.9, 12, 8), ctx.mat('#ffffff', { toon: true }), { p: [-1.6, -0.1, 1.3], s: [1, 0.45, 1.3] });
  BM.add(new THREE.SphereGeometry(0.5, 10, 6), ctx.mat('#ffb020', { toon: true }), { p: [-1.6, 0.18, 1.3], s: [1, 0.4, 1] });
  BM.add(new THREE.BoxGeometry(2.2, 0.15, 2.2), ctx.mat('#2c5a2e', { toon: true }), { p: [-0.5, -0.05, -2.2], r: [0, 0.4, 0] }); // nori
  for (const sx of [0.2, 0.7]) BM.add(new THREE.CylinderGeometry(0.1, 0.14, 8, 6), ctx.mat('#caa06a', { toon: true }), { p: [sx + 1.2, 2.2, 0.4], r: [0.25, 0, -0.55] });
  // base stand
  BM.add(new THREE.CylinderGeometry(1.4, 2.0, 1.2, 12), woodD, { p: [0, -4.4, 0] });
  bowl.add(BM.build('bowl'));
  bowl.position.set(0, 16.8, -D / 2);
  bowl.rotation.x = 0.28;
  g.add(bowl);

  // steam puffs rising from the bowl (and the kitchen chimney)
  const steamMat = ctx.mat('#ffffff', { opacity: 0.55, depthWrite: false, toon: false });
  const puffGeo = new THREE.SphereGeometry(1, 10, 8);
  const puffs = [];
  const sources = [[0, 17.4, -D / 2 + 0.6], [6, 12.5, -D + 2]];
  for (let k = 0; k < 10; k++) {
    const m = new THREE.Mesh(puffGeo, steamMat);
    m.castShadow = false;
    const src = sources[k < 7 ? 0 : 1];
    g.add(m);
    puffs.push({ m, src, ph: k / (k < 7 ? 7 : 3), sp: 0.3 + (k % 3) * 0.06 });
  }
  M.add(new THREE.CylinderGeometry(0.5, 0.5, 3, 8), ctx.mat('#707480', { toon: true }), { p: [6, 11, -D + 2] });
  g.add(M.build('chimney'));
  ctx.addAnimated((dt, time) => {
    for (const p of puffs) {
      const u = (time * p.sp + p.ph) % 1;
      const s = (0.6 + u * 1.9) * (1 - u * 0.35);
      p.m.position.set(p.src[0] + Math.sin(u * 6 + p.ph * 9) * 0.9, p.src[1] + u * 7, p.src[2] + Math.cos(u * 5 + p.ph * 7) * 0.7);
      p.m.scale.setScalar(u > 0.85 ? s * (1 - (u - 0.85) / 0.15) : s);
    }
  });
  // bowl gently bobbing
  ctx.addAnimated((dt, time) => {
    bowl.rotation.z = Math.sin(time * 1.2) * 0.05;
  });
  return g;
}

// ---- delivery scooter (moving hazard) ----------------------------------------------------------------------
function buildScooter(ctx, color) {
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const body = ctx.mat(color, { toon: true });
  const dark = ctx.mat('#25252c', { toon: true });
  const white = ctx.mat('#f4f4f4', { toon: true });
  M.add(new THREE.BoxGeometry(0.7, 0.35, 1.9), body, { p: [0, 0.55, 0] });
  M.add(new THREE.BoxGeometry(0.7, 1.0, 0.35), body, { p: [0, 0.95, 0.75], r: [-0.25, 0, 0] });
  M.add(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), dark, { p: [0, 1.55, 0.85], r: [0, 0, Math.PI / 2] });
  for (const z of [-0.75, 0.8]) M.add(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12), dark, { p: [0, 0.34, z], r: [0, 0, Math.PI / 2] });
  M.add(new THREE.BoxGeometry(0.95, 0.85, 0.85), white, { p: [0, 1.15, -0.65] }); // delivery box
  M.add(new THREE.BoxGeometry(0.97, 0.22, 0.87), ctx.mat(RED, { toon: true }), { p: [0, 1.25, -0.65] });
  // rider: chibi-ish body + helmet
  M.add(new THREE.CylinderGeometry(0.28, 0.34, 0.8, 8), ctx.mat('#3a78d8', { toon: true }), { p: [0, 1.2, 0.05] });
  M.add(new THREE.SphereGeometry(0.34, 12, 8), ctx.mat('#ffd23f', { toon: true }), { p: [0, 1.85, 0.1] });
  M.add(new THREE.SphereGeometry(0.12, 8, 6), ctx.mat('#fff1c0', { toon: true, emissive: '#ffe08a', emissiveIntensity: 1 }), { p: [0, 1.1, 0.98] });
  return M.build('scooter');
}

function scenery(ctx) {
  const { THREE, path } = ctx;
  const L = path.length;
  const dOf = (mark, off = 0) => T(mark, off) * L;
  const rng = ctx.rng;
  const hw = (d) => path.frameAt(d).halfWidth;

  // --- the ramen shop, left of the shopping street, facing the road ----------------------------------
  const shop = buildRamenShop(ctx);
  ctx.place(shop, { d: dOf('shop', 58), lateral: -24, yaw: -Math.PI / 2, ground: true });
  for (const off of [49, 67]) {
    const lan = ctx.props.create('lantern', { color: RED, night: true });
    ctx.place(lan, { d: dOf('shop', off), lateral: -18.5, yaw: -Math.PI / 2, ground: true });
  }

  // --- lantern strings across the shopping street (and the final approach) ---------------------------
  {
    const { THREE: T3 } = ctx;
    const M = makeMerger(ctx);
    const wire = ctx.mat('#2a2230', { toon: true });
    const cols = [RED, '#ff9a2e', RED, '#ffd23f', RED];
    const span = 28;
    M.add(new T3.CylinderGeometry(0.035, 0.035, span, 4), wire, { p: [0, 0, 0], r: [0, 0, Math.PI / 2], shadow: false });
    for (let k = 0; k < 7; k++) {
      const x = -span / 2 + 2 + k * ((span - 4) / 6);
      const sag = -Math.cos((x / span) * Math.PI) * 1.2;
      const c = cols[k % cols.length];
      M.add(new T3.SphereGeometry(0.55, 10, 8), ctx.mat(c, { toon: true, emissive: c, emissiveIntensity: 0.85 }), { p: [x, sag - 0.8, 0], s: [1, 1.3, 1], shadow: false });
      M.add(new T3.CylinderGeometry(0.3, 0.3, 0.12, 8), wire, { p: [x, sag - 0.02, 0], shadow: false });
    }
    const string = M.build('lanternString');
    const PM = makeMerger(ctx);
    PM.add(new T3.CylinderGeometry(0.16, 0.2, 10.5, 6), ctx.mat('#4a4450', { toon: true }), { p: [0, 5.25, 0] });
    const pole = PM.build('lanternPole');
    const strings = [];
    const poles = [];
    const addRow = (d) => {
      const f = path.frameAt(d);
      const half = f.halfWidth + 1.8;
      strings.push({ x: f.pos.x, y: f.pos.y + 10, z: f.pos.z, rotY: f.yaw, scale: [(2 * half) / span + 0.02, 1, 1] });
      for (const s of [-1, 1]) {
        const p = path.pointAt(d, s * half);
        poles.push({ x: p.x, y: p.y - 0.2, z: p.z });
      }
    };
    for (let d = dOf('shop', 16); d < dOf('shop', 108); d += 16) addRow(d);
    for (let d = dOf('final', 95); d < dOf('final', 146); d += 16) addRow(d);
    ctx.instanced(string, strings, { castShadow: false, reserve: false });
    ctx.instanced(pole, poles, { reserve: false });
  }

  // --- city blocks: lit buildings lining every street ---------------------------------------------------
  {
    const groups = [[], [], []];
    const tints = ['#ffffff', '#ffe2cc', '#e6dcff', '#ffd9e6', '#dcefff'];
    let i = 0;
    const placed = [];
    const far = (x, z, r) => placed.every((q) => (q.x - x) ** 2 + (q.z - z) ** 2 > r * r);
    for (const [base, step, gap] of [[10, 21, 14], [33, 26, 16], [58, 32, 17], [86, 40, 18]]) for (let d = 8 + base * 0.3; d < L; d += step) {
      const f = path.frameAt(d);
      for (const s of [-1, 1]) {
        const lat = s * (f.halfWidth + (s < 0 ? f.offL : f.offR) + base + rng() * 5);
        const p = path.pointAt(d, lat);
        if (!ctx.isClear(p.x, p.z, 8.5) || !far(p.x, p.z, gap)) continue;
        // keep the shop front and the grid view open
        if (base < 30 && d > dOf('shop', 40) && d < dOf('shop', 80) && s < 0) continue;
        placed.push(p);
        const gy = ctx.groundAt(p.x, p.z);
        const y = Math.min(gy ?? 0, 0.5) - 0.5;
        groups[i % 3].push({ x: p.x, y, z: p.z, rotY: f.yaw + (s < 0 ? -Math.PI / 2 : Math.PI / 2), tint: tints[(rng() * tints.length) | 0], scale: 0.95 + rng() * 0.2 });
        ctx.reserve(p.x, p.z, 8);
        i++;
      }
    }
    ctx.instanced('building', groups[0], { seed: 3, night: true, variant: 'tall', reserve: false, chunk: 0 });
    ctx.instanced('building', groups[1], { seed: 8, night: true, reserve: false, chunk: 0 });
    ctx.instanced('building', groups[2], { seed: 21, night: true, variant: 'low', reserve: false, chunk: 0 });
  }

  // --- street furniture: street lights, vending machines, neon signs ---------------------------------
  {
    const lights = [];
    const vend = [];
    for (let d = 10; d < L; d += 34) {
      const f = path.frameAt(d);
      if (f.pos.y > 3) continue; // highway has its own lights
      for (const s of [-1, 1]) {
        const off = s < 0 ? f.offL : f.offR;
        const p = path.pointAt(d + (s > 0 ? 17 : 0), s * (f.halfWidth + off + 0.9));
        const ff = path.frameAt(d + (s > 0 ? 17 : 0));
        if (!ctx.isClear(p.x, p.z, 0.6)) continue;
        lights.push({ x: p.x, y: ctx.groundAt(p.x, p.z) ?? p.y, z: p.z, rotY: ff.yaw + (s < 0 ? Math.PI / 2 : -Math.PI / 2) });
      }
    }
    ctx.instanced('streetLight', lights, { night: true, reserve: false, chunk: 0 });
    // highway lamps on the barriers
    const hl = [];
    for (let d = dOf('hwy'); d < dOf('c4'); d += 30) {
      const f = path.frameAt(d);
      const p = path.pointAt(d, f.halfWidth + f.offR + 0.3);
      hl.push({ x: p.x, y: p.y, z: p.z, rotY: f.yaw - Math.PI / 2 });
    }
    ctx.instanced('streetLight', hl, { night: true, color: '#ffd8a0', reserve: false });
    for (const [mark, off, s] of [['shop', 30, -1], ['shop', 86, -1], ['shop', 95, 1], ['side', 10, 1], ['side2', 20, -1], ['final', 40, 1], ['final', 120, -1], ['west', 20, 1]]) {
      const d = dOf(mark, off);
      const f = path.frameAt(d);
      const p = path.pointAt(d, s * (f.halfWidth + (s < 0 ? f.offL : f.offR) + 1.2));
      if (!ctx.isClear(p.x, p.z, 0.7)) continue;
      vend.push({ x: p.x, y: ctx.groundAt(p.x, p.z) ?? p.y, z: p.z, rotY: f.yaw + (s < 0 ? Math.PI / 2 : -Math.PI / 2) });
      vend.push({ x: p.x + Math.sin(f.yaw) * 1.25, y: ctx.groundAt(p.x, p.z) ?? p.y, z: p.z + Math.cos(f.yaw) * 1.25, rotY: f.yaw + (s < 0 ? Math.PI / 2 : -Math.PI / 2) });
    }
    ctx.instanced('vendingMachine', vend, { night: true, reserve: false, seed: 4 });
    const neon = [['RAMEN', 'shop', 20, 1], ['OPEN', 'shop', 100, -1], ['KIVOTOS', 'c1', 30, -1], ['CAFE', 'side2', 5, 1], ['24H', 'west', 30, -1], ['KARAOKE', 'final', 60, -1], ['ARCADE', 'final', 80, 1], ['MOMO', 'north', 10, 1]];
    for (const [text, mark, off, s] of neon) {
      const d = dOf(mark, off);
      const f = path.frameAt(d);
      const lat = s * (f.halfWidth + (s < 0 ? f.offL : f.offR) + 2);
      const p = path.pointAt(d, lat);
      if (!ctx.isClear(p.x, p.z, 1.5)) continue;
      const n = ctx.props.create('neonSign', { text, night: true });
      ctx.place(n, { d, lateral: lat, yaw: s < 0 ? -Math.PI / 2 : Math.PI / 2, ground: true });
    }
  }

  // --- crosswalk stripes before the corners -----------------------------------------------------------
  {
    const M = makeMerger(ctx);
    const white = ctx.mat('#f2f2ee', { toon: true, polygonOffset: true });
    for (const d of [dOf('shop', 104), dOf('side2', 26), dOf('back', 12), dOf('north', 8), dOf('final', 12)]) {
      const f = path.frameAt(d);
      const n = Math.floor((f.halfWidth * 2 - 2) / 1.6);
      for (let k = 0; k < n; k++) {
        const lat = -f.halfWidth + 1.4 + k * 1.6;
        const p = path.pointAt(d, lat);
        M.add(new THREE.BoxGeometry(0.8, 0.04, 4.2), white, { p: [p.x, p.y + 0.05, p.z], r: [0, f.yaw, 0], shadow: false });
      }
    }
    const cw = M.build('crosswalks');
    cw.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.renderOrder = 1;
      }
    });
    ctx.group.add(cw);
  }

  // --- highway gantry sign over the on-ramp ------------------------------------------------------------
  {
    const d = dOf('onramp', 90);
    const f = path.frameAt(d);
    const M = makeMerger(ctx);
    const steel = ctx.mat('#8d96a3', { toon: true });
    const half = f.halfWidth + f.offL + 1.2;
    for (const s of [-1, 1]) M.add(new THREE.BoxGeometry(0.5, 9, 0.5), steel, { p: [s * half, 4.5, 0] });
    M.add(new THREE.BoxGeometry(half * 2 + 0.6, 0.5, 0.5), steel, { p: [0, 8.9, 0] });
    const gantry = M.build('hwyGantry');
    const tex = ctx.textTexture('SHIBASEKI  EXPWY  ↑', { width: 1024, height: 160, bg: '#1f7a4a', color: '#ffffff', stroke: '#0c3a22', size: 84 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(13, 2.1), ctx.mat('#ffffff', { map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.25 }));
    board.position.set(0, 7.6, -0.3);
    board.rotation.y = Math.PI;
    gantry.add(board);
    const board2 = board.clone();
    board2.rotation.y = 0;
    board2.position.z = 0.3;
    gantry.add(board2);
    ctx.place(gantry, { d, lateral: 0, ground: false, reserve: false });
  }

  // --- delivery scooters weaving across the side street (moving hazards) -------------------------------
  {
    const specs = [
      { d: dOf('side', 18), lat0: 5.5, amp: 4.2, speed: 0.9, ph: 0, color: '#ff7a45' },
      { d: dOf('side', 36), lat0: -5.5, amp: 4.2, speed: 0.75, ph: 2.4, color: '#1fb6ff' },
    ];
    for (const sp of specs) {
      const obj = buildScooter(ctx, sp.color);
      ctx.group.add(obj);
      const pos = path.pointAt(sp.d, sp.lat0);
      obj.position.copy(pos);
      const hz = ctx.addHazard({ position: pos, radius: 1.2, kind: 'scooter', effect: 'spin', object3d: obj, moving: true });
      const f = path.frameAt(sp.d);
      const tmp = new THREE.Vector3();
      ctx.addAnimated((dt, time) => {
        const s = Math.sin(time * sp.speed + sp.ph);
        const lat = sp.lat0 + s * sp.amp;
        path.pointAt(sp.d, lat, tmp);
        obj.position.copy(tmp);
        hz.position.copy(tmp);
        // face the direction of travel (across the road) with a little lean
        const dir = Math.cos(time * sp.speed + sp.ph) >= 0 ? 1 : -1;
        obj.rotation.set(0, f.yaw + (dir > 0 ? -Math.PI / 2 : Math.PI / 2), 0);
      });
    }
    // warning sign for the scooter crossing
    const s = ctx.props.create('sign', { variant: 'text', text: 'DELIVERY X-ING' });
    ctx.place(s, { d: dOf('side', 2), lateral: hw(dOf('side', 2)) + 6.5, yaw: Math.PI / 2 - 0.5, ground: true });
  }

  // --- road works on the highway: cones + barrier board ------------------------------------------------
  {
    const cones = [];
    for (let k = 0; k < 9; k++) {
      const d = dOf('bridge', 118 + k * 3.2);
      const f = path.frameAt(d);
      const p = path.pointAt(d, f.halfWidth - 4.8 + (k === 0 || k === 8 ? 1.5 : 0));
      cones.push({ x: p.x, y: p.y, z: p.z, rotY: 0 });
    }
    ctx.instanced('cone', cones, { reserve: false });
    const board = ctx.props.create('sign', { variant: 'caution' });
    ctx.place(board, { d: dOf('bridge', 112), lateral: hw(dOf('bridge', 112)) - 2.5, yaw: Math.PI, reserve: false });
  }

  // --- welcome arch over the shopping street -------------------------------------------------------------
  {
    const d = dOf('shop', 8);
    const f = path.frameAt(d);
    const M = makeMerger(ctx);
    const half = f.halfWidth + f.offL + 1;
    const red = ctx.mat(RED, { toon: true });
    for (const s of [-1, 1]) M.add(new THREE.CylinderGeometry(0.5, 0.6, 12, 10), red, { p: [s * half, 6, 0] });
    M.add(new THREE.BoxGeometry(half * 2 + 3, 0.8, 1.0), ctx.mat('#2a2230', { toon: true }), { p: [0, 12.4, 0] });
    M.add(new THREE.BoxGeometry(half * 2 + 1, 0.5, 0.8), red, { p: [0, 11.0, 0] });
    const arch = M.build('shopArch');
    const tex = ctx.textTexture('SHIBASEKI SHOPPING STREET', { width: 1024, height: 128, bg: '#fff4de', color: RED, stroke: '#3a0c0c', size: 72 });
    const face = ctx.mat('#ffffff', { map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.4 });
    for (const [z, ry] of [[0.52, 0], [-0.52, Math.PI]]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.25), face);
      pl.position.set(0, 13.9, z);
      pl.rotation.y = ry;
      arch.add(pl);
    }
    M.add(new THREE.BoxGeometry(18.6, 2.6, 0.9), ctx.mat('#2a2230', { toon: true }), { p: [0, 13.9, 0] });
    arch.add(M.build('archBoard'));
    ctx.place(arch, { d, lateral: 0, reserve: false });
  }
}

export default {
  id: 'shibaseki-street',
  name: 'Shibaseki Ramen Street',
  laps: 3,
  width: 22,
  offroad: 5,
  wall: true,
  points: C.points,
  features: [
    // shopping street
    { type: 'itemRow', t: T('shop', 62), count: 4, spacing: 4.5 },
    { type: 'coins', t: T('c1', 28), count: 5, spacing: 4.5, lateral: 6.5 },
    // side street jog
    { type: 'coins', t: T('jog1', 38), count: 5, spacing: 4, lateral: -4.5 },
    { type: 'boost', t: T('jog2', 36), lateral: 2.5, length: 8, width: 5 },
    { type: 'coins', t: T('c2', 28), count: 4, spacing: 4.5, lateral: 6.5 },
    // on-ramp + highway
    { type: 'boost', t: T('onramp', 55), lateral: -4, length: 8, width: 5 },
    { type: 'itemRow', t: T('bridge', 40), count: 4, spacing: 4 },
    { type: 'hazardZone', t: T('bridge', 131), lateral: 6.2, length: 32, width: 7.5 },
    { type: 'coins', t: T('bridge', 131), count: 6, spacing: 4.5, lateral: 5.5 },
    { type: 'coins', t: T('c4', 30), count: 5, spacing: 4.5, lateral: -6 },
    // west blocks
    { type: 'itemRow', t: T('west', 22), count: 4, spacing: 4.2 },
    { type: 'hazard', t: T('c5', 30), lateral: -7.5, kind: 'cone', radius: 0.8 },
    { type: 'hazard', t: T('c6', 25), lateral: -7.5, kind: 'barrel', radius: 1.0 },
    // underpass run home: dash panel + optional kicker ramp on the left lane
    { type: 'boost', t: T('final', 30), lateral: 3.5, length: 8, width: 5 },
    { type: 'ramp', t: T('final', 70), lateral: -5.5, length: 9, width: 9, power: 1 },
    { type: 'coins', t: T('final', 88), count: 5, spacing: 4, lateral: -5.5 },
  ],
  decorations: [
    { kind: 'bush', count: 30, side: 'both', minOffset: 0.3, maxOffset: 3, scale: [0.7, 1.1], seed: 3 },
    { kind: 'cone', count: 14, side: 'both', minOffset: -2, maxOffset: 1, seed: 5, tRange: [T('side'), T('c2')] },
    { kind: 'crate', count: 10, side: 'both', minOffset: 0, maxOffset: 3, seed: 6, tRange: [T('west'), T('final', 20)] },
    { kind: 'tree', count: 18, side: 'both', minOffset: 1, maxOffset: 6, scale: [0.7, 1.0], seed: 7, color: '#e0883a' },
    { kind: 'bench', count: 6, side: 'both', minOffset: 0.3, maxOffset: 1.5, seed: 9, tRange: [T('shop', 20), T('c1')] },
  ],
  theme: {
    preset: 'city-sunset',
    sky: { top: '#2a2a70', bottom: '#ff8a5c', horizon: '#ffb46e', stars: false, sunDisc: true, clouds: true },
    fog: { color: '#d88a7c', near: 140, far: 720 },
    sun: { color: '#ffb47a', intensity: 2.3, dir: [-0.6, 0.42, 0.5] },
    ambient: { sky: '#ffc4a8', ground: '#6a5a78', intensity: 1.2 },
    ground: { type: 'asphalt', color: '#8c8690', color2: '#7a7580' },
    road: { style: 'asphalt', color: '#5a5862', color2: '#4f4d57', lines: true },
    edge: { style: 'line', colorA: '#ffd23f', colorB: '#ffffff' },
    offroad: { type: 'gravel', color: '#9a918c' },
    wall: { style: 'barrier', color: '#ecebf0', color2: '#ff7a45' },
    particles: 'leaves',
    music: 'shibaseki',
    night: false,
  },
  scenery,
};
