// Gehenna Inferno Rally — Pyroxene Cup race 3 (owner: tracks-D).
//
// Layout (clockwise, start heading east): castle straight -> T1 sweeper -> wall-less bridge over the lava chasm
// -> T2 -> rock-canyon left hairpin under the lava fall -> climb -> T3 -> crest jump under the Horn Gate ->
// descending T4 -> wall-less Geyser Ridge across the lava lake -> T5 -> skull esses -> lava-river back straight
// (open on the left) -> final sweeper.
//
// Exports (besides the default track def): course(), makeMerger() — shared with arona-sky.js — and MARKS/CLOSE.

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---- course(): turtle-style layout (straights + arcs with exact radii) that closes itself -----------------
// cmd: { len } straight | { arc (deg, + = right), r } | { close: true, r, turn: 'right'|'left' } (last)
// Any other fields (w, bank, off, offL, offR, wall, wallL, wallR) go onto the generated control points.
// `y` = height at the end of the command, `mark` records the distance at the start of the command.
export function course(start, cmds) {
  const D2R = Math.PI / 180;
  const R2 = (v) => Math.round(v * 100) / 100;
  let { x, z, y, yaw } = start;
  const pts = [{ x, y, z, ...(start.attrs || {}) }];
  const marks = {};
  let dist = 0;
  let closeInfo = null;
  const run = (c) => {
    const { len = 0, arc = 0, r = 50, step = 30, n: nn, y: yEnd, mark, ease, ...attrs } = c;
    if (mark) marks[mark] = dist;
    const n = nn ?? (arc ? Math.max(1, Math.round(Math.abs(arc) / step)) : 1);
    const y0 = y;
    const y1 = yEnd ?? y;
    const sx = x;
    const sz = z;
    const syaw = yaw;
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      if (arc) {
        const sg = Math.sign(arc);
        const cx = sx - Math.cos(syaw) * r * sg;
        const cz = sz + Math.sin(syaw) * r * sg;
        yaw = syaw - arc * D2R * u;
        x = cx + Math.cos(yaw) * r * sg;
        z = cz - Math.sin(yaw) * r * sg;
      } else {
        x = sx + Math.sin(syaw) * len * u;
        z = sz + Math.cos(syaw) * len * u;
      }
      const e = ease ? u * u * (3 - 2 * u) : u;
      pts.push({ x: R2(x), y: R2(y0 + (y1 - y0) * e), z: R2(z), ...attrs });
    }
    y = y1;
    dist += arc ? Math.abs(arc) * D2R * r : len;
  };
  for (const c of cmds) {
    if (!c.close) {
      run(c);
      continue;
    }
    // closing: straight a, arc (heading back to the start yaw), straight b onto the start point
    const r = c.r ?? 50;
    let dd = (yaw - start.yaw) / D2R;
    dd = ((((dd + 180) % 360) + 360) % 360) - 180;
    if (c.turn === 'right' && dd < 0) dd += 360;
    if (c.turn === 'left' && dd > 0) dd -= 360;
    const sg = Math.sign(dd) || 1;
    const yawE = yaw - dd * D2R;
    const Dx = r * sg * (Math.cos(yawE) - Math.cos(yaw));
    const Dz = r * sg * (Math.sin(yaw) - Math.sin(yawE));
    const ex = start.x - x - Dx;
    const ez = start.z - z - Dz;
    const ux = Math.sin(yaw), uz = Math.cos(yaw), vx = Math.sin(start.yaw), vz = Math.cos(start.yaw);
    const det = ux * vz - uz * vx;
    const a = (ex * vz - ez * vx) / det;
    const b = (ux * ez - uz * ex) / det;
    closeInfo = { a: R2(a), b: R2(b), arc: R2(dd) };
    if (a > 0.5) run({ len: a, n: Math.max(1, Math.round(a / 60)), y: c.yA ?? y, mark: c.markA, ...(c.attrsA || {}) });
    run({ arc: dd, r, y: c.yArc ?? y, mark: c.mark, ...(c.attrsArc || {}) });
    if (b > 0.5) {
      const nb = Math.max(1, Math.round(b / 60));
      run({ len: b, n: nb, y: start.y, mark: c.markB, ...(c.attrsB || {}) });
    }
    pts.pop(); // the last point coincides with the start point
  }
  return { points: pts, marks, length: dist, closeInfo };
}

/** Static-geometry batcher: add(geometry, material, { p, r, s, shadow }) ... build(name) -> Group (1 mesh per material). */
export function makeMerger(ctx) {
  const { THREE } = ctx;
  const buckets = new Map();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const KEEP = ['position', 'normal', 'uv'];
  return {
    add(geo, mat, o = {}) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      geo.dispose();
      for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      const p = o.p || [0, 0, 0];
      const sc = o.s === undefined ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s;
      if (o.q) q.copy(o.q);
      else {
        const r = o.r || [0, 0, 0];
        e.set(r[0], r[1], r[2]);
        q.setFromEuler(e);
      }
      m4.compose(v.set(p[0], p[1], p[2]), q, s.set(sc[0], sc[1], sc[2]));
      g.applyMatrix4(m4);
      const shadow = o.shadow !== false;
      const key = mat.uuid + (shadow ? ':s' : ':n');
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat, shadow, geos: [] }));
      b.geos.push(g);
    },
    build(name = 'merged') {
      const grp = new THREE.Group();
      grp.name = name;
      for (const b of buckets.values()) {
        const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
        if (!merged) continue;
        if (b.geos.length > 1) for (const g of b.geos) g.dispose();
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, b.mat);
        mesh.castShadow = b.shadow && ctx.quality !== 'low';
        mesh.receiveShadow = true;
        grp.add(mesh);
      }
      buckets.clear();
      return grp;
    },
  };
}

/** Tapered curved horn along a quadratic Bezier (p0 -> p1 control -> p2 tip), added to a merger. */
export function addHorn(ctx, M, mat, p0, p1, p2, r0, segs = 9, radial = 8) {
  const { THREE } = ctx;
  const A = new THREE.Vector3(...p0);
  const B = new THREE.Vector3(...p1);
  const Cc = new THREE.Vector3(...p2);
  const bez = (t, out) => out.set(0, 0, 0).addScaledVector(A, (1 - t) * (1 - t)).addScaledVector(B, 2 * (1 - t) * t).addScaledVector(Cc, t * t);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const qq = new THREE.Quaternion();
  for (let k = 0; k < segs; k++) {
    bez(k / segs, a);
    bez((k + 1) / segs, b);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    qq.setFromUnitVectors(up, dir);
    const rb = r0 * (1 - k / segs) + 0.04;
    const rt = r0 * (1 - (k + 1) / segs) + 0.02;
    const mid = a.clone().addScaledVector(dir, len / 2);
    M.add(new THREE.CylinderGeometry(rt, rb, len * 1.08, radial, 1), mat, { p: [mid.x, mid.y, mid.z], q: qq });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------------------
const C = course({ x: 0, z: 0, y: 0, yaw: Math.PI / 2, attrs: { w: 26, off: 7 } }, [
  { len: 130, w: 26, off: 7, mark: 'straight' },
  { arc: 90, r: 60, w: 24, off: 6, bank: 8, y: 2, mark: 't1' },
  { len: 20, w: 22, off: 4, y: 3.5, mark: 'preBridge' },
  { len: 70, n: 3, w: 20, off: 2, wall: false, y: 5, mark: 'bridge' },
  { arc: 90, r: 50, w: 22, off: 6, bank: 7, y: 5, mark: 't2' },
  { len: 40, w: 21, off: 5, y: 4.5, mark: 'approach' },
  { arc: -180, r: 27, step: 20, w: 20, off: 5, bank: -8, y: 4, mark: 'hairpin' },
  { len: 80, n: 3, w: 22, off: 5, y: 13, ease: true, mark: 'climb' },
  { arc: 90, r: 45, w: 22, off: 5, bank: 7, y: 14, mark: 't3' },
  { len: 40, w: 22, off: 5, y: 13, mark: 'crest' },
  { arc: 90, r: 60, w: 23, off: 5, bank: 9, y: 9, mark: 't4' },
  { len: 170, n: 4, w: 21, off: 3, wall: false, y: 4, mark: 'ridge' },
  { arc: 90, r: 55, w: 22, off: 6, bank: 7, y: 3.5, mark: 't5' },
  { arc: -60, r: 60, w: 20, off: 6, bank: -6, y: 2.5, mark: 'esses' },
  { arc: 60, r: 60, w: 20, off: 6, bank: 6, y: 2, mark: 'esses2' },
  {
    close: true,
    r: 60,
    turn: 'right',
    mark: 'final',
    markA: 'river',
    markB: 'home',
    yA: 1,
    attrsA: { w: 24, off: 5, wallL: false },
    attrsArc: { w: 24, off: 7, bank: 7 },
    attrsB: { w: 26, off: 7 },
  },
]);

export const MARKS = C.marks;
export const CLOSE = C.closeInfo;
const LEN = C.length;
const T = (mark, off = 0) => {
  const t = (C.marks[mark] + off) / LEN;
  return ((t % 1) + 1) % 1;
};
const D = (mark, off = 0) => {
  const d = C.marks[mark] + off;
  return ((d % LEN) + LEN) % LEN;
};

// ---------------------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------------------
const STONE = '#3b2f3d';
const STONE_D = '#2a2130';
const CRIMSON = '#8a1c2c';
const ROOF = '#5e1224';
const HORN = '#4a3a52';
const GLOW = '#ff8a3a';
const LAVA = '#ff5a1f';
const PURPLE = '#7a3cff';

// ---------------------------------------------------------------------------------------------------------
// Textures (browser only: scenery never runs in Node)
// ---------------------------------------------------------------------------------------------------------
function lavaFlowTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, '#ff3a10');
  grd.addColorStop(0.5, '#ffb030');
  grd.addColorStop(1, '#ff3a10');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 60; k++) {
    const x = rnd() * 64;
    const y = rnd() * 256;
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,240,150,0.7)' : 'rgba(120,20,10,0.55)';
    g.fillRect(x, y, 2 + rnd() * 5, 20 + rnd() * 50);
    g.fillRect(x, y - 256, 2 + rnd() * 5, 20 + rnd() * 50);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function lavaLakeTexture(THREE) {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#ff7a1f';
  g.fillRect(0, 0, N, N);
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // hot glow spots
  for (let k = 0; k < 18; k++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const r = 20 + rnd() * 40;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grd.addColorStop(0, 'rgba(255,230,120,0.9)');
      grd.addColorStop(1, 'rgba(255,230,120,0)');
      g.fillStyle = grd;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  // dark crust plates (tile-wrapped)
  for (let k = 0; k < 26; k++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const r = 8 + rnd() * 22;
    const n = 6 + ((rnd() * 4) | 0);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.6 + rnd() * 0.5);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(x + ox + px, y + oy + py) : g.moveTo(x + ox + px, y + oy + py)));
      g.closePath();
      g.fillStyle = rnd() < 0.5 ? '#3a1810' : '#56200f';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,160,60,0.8)';
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function emblemTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  // shield disc
  g.fillStyle = '#1c1420';
  g.beginPath();
  g.arc(128, 132, 110, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = '#d8a93a';
  g.stroke();
  // horns
  g.fillStyle = '#e8e0f0';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(128 + s * 26, 130);
    g.quadraticCurveTo(128 + s * 92, 110, 128 + s * 70, 40);
    g.quadraticCurveTo(128 + s * 64, 96, 128 + s * 12, 104);
    g.closePath();
    g.fill();
  }
  // wings of a stylised bat below + central gem
  g.fillStyle = '#c0283a';
  g.beginPath();
  g.moveTo(128, 150);
  for (const s of [1, -1]) {
    g.lineTo(128 + s * 80, 140);
    g.lineTo(128 + s * 60, 170);
    g.lineTo(128 + s * 40, 160);
    g.lineTo(128 + s * 22, 196);
    g.lineTo(128, 180);
  }
  g.closePath();
  g.fill();
  g.fillStyle = '#ff9a3a';
  g.beginPath();
  g.moveTo(128, 104);
  g.lineTo(146, 132);
  g.lineTo(128, 160);
  g.lineTo(110, 132);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------------------------------------
function frameYaw(ctx, d) {
  return ctx.frameAt(d).yaw;
}

/** Gehenna Academy castle: dark keep, crimson spires, two great curved horns, glowing gothic windows. */
function buildCastle(ctx, lavaMatFlow) {
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const stone = ctx.mat(STONE, { toon: true });
  const stoneD = ctx.mat(STONE_D, { toon: true });
  const trim = ctx.mat(CRIMSON, { toon: true });
  const roof = ctx.mat(ROOF, { toon: true });
  const horn = ctx.mat(HORN, { toon: true });
  const hornTip = ctx.mat('#d8cfe6', { toon: true });
  const win = ctx.mat(GLOW, { emissive: GLOW, emissiveIntensity: 1.4, basic: true });
  const winP = ctx.mat('#ff4a6a', { emissive: '#ff4a6a', emissiveIntensity: 1.2, basic: true });
  const gold = ctx.mat('#d8a93a', { toon: true, emissive: '#6a4a10', emissiveIntensity: 0.3 });
  const rock = ctx.mat('#2c2226', { toon: true, flatShading: true });

  // rocky plinth
  M.add(new THREE.CylinderGeometry(46, 58, 14, 9), rock, { p: [0, -6, -8] });
  M.add(new THREE.CylinderGeometry(34, 46, 6, 9), rock, { p: [0, 3, -10] });
  // main keep
  M.add(new THREE.BoxGeometry(46, 30, 26), stone, { p: [0, 21, -14] });
  M.add(new THREE.BoxGeometry(47.5, 2, 27.5), trim, { p: [0, 36.5, -14] });
  for (let x = -22; x <= 22; x += 4) M.add(new THREE.BoxGeometry(2, 2.6, 27.5), stoneD, { p: [x, 38.8, -14] });
  M.add(new THREE.BoxGeometry(47, 1.2, 1), trim, { p: [0, 14, -0.6] });
  // gothic windows (two rows) with pointed tops
  for (const row of [0, 1]) {
    const y = 12 + row * 13;
    for (let x = -19; x <= 19; x += 5.5) {
      if (Math.abs(x) < 6) continue;
      const m = row === 1 && Math.abs(x) > 15 ? winP : win;
      M.add(new THREE.BoxGeometry(2, 5.5, 0.6), m, { p: [x, y, -0.8], shadow: false });
      M.add(new THREE.ConeGeometry(1.42, 2.2, 4), m, { p: [x, y + 3.8, -0.8], r: [0, Math.PI / 4, 0], s: [1, 1, 0.3], shadow: false });
      M.add(new THREE.BoxGeometry(2.8, 0.5, 1.2), stoneD, { p: [x, y - 3, -0.4] });
    }
  }
  // great gate
  M.add(new THREE.BoxGeometry(10, 12, 1), stoneD, { p: [0, 12, -0.5] });
  M.add(new THREE.CylinderGeometry(5, 5, 1, 16, 1, false, 0, Math.PI), stoneD, { p: [0, 18, -0.5], r: [Math.PI / 2, 0, Math.PI / 2] });
  M.add(new THREE.BoxGeometry(7.6, 10.5, 0.4), ctx.mat('#1a0d10', { toon: true }), { p: [0, 11.5, 0.1] });
  M.add(new THREE.BoxGeometry(7.6, 0.5, 0.5), win, { p: [0, 6.5, 0.3], shadow: false });
  // central spire
  M.add(new THREE.BoxGeometry(14, 58, 14), stone, { p: [0, 29, -16] });
  M.add(new THREE.BoxGeometry(15, 2, 15), trim, { p: [0, 58, -16] });
  M.add(new THREE.ConeGeometry(11, 30, 4), roof, { p: [0, 74, -16], r: [0, Math.PI / 4, 0] });
  M.add(new THREE.CylinderGeometry(0.25, 0.25, 8, 6), gold, { p: [0, 92, -16] });
  M.add(new THREE.TorusGeometry(2.2, 0.35, 6, 20), gold, { p: [0, 97, -16], shadow: false });
  // rose window on the spire
  M.add(new THREE.CylinderGeometry(4.2, 4.2, 0.6, 20), winP, { p: [0, 46, -8.8], r: [Math.PI / 2, 0, 0], shadow: false });
  M.add(new THREE.TorusGeometry(4.4, 0.5, 6, 24), gold, { p: [0, 46, -8.6] });
  // front corner towers with spires
  for (const sx of [-1, 1]) {
    const x = sx * 25;
    M.add(new THREE.CylinderGeometry(5.5, 6.2, 44, 12), stone, { p: [x, 22, -2] });
    M.add(new THREE.CylinderGeometry(6.6, 6.6, 2, 12), trim, { p: [x, 44.5, -2] });
    M.add(new THREE.ConeGeometry(7, 24, 12), roof, { p: [x, 57, -2] });
    M.add(new THREE.CylinderGeometry(0.18, 0.18, 5, 5), gold, { p: [x, 71, -2] });
    for (let k = 0; k < 3; k++) M.add(new THREE.BoxGeometry(1.4, 3.6, 0.5), win, { p: [x, 14 + k * 9, 4.2], shadow: false });
    // rear towers (taller, thinner)
    const xr = sx * 17;
    M.add(new THREE.CylinderGeometry(4, 4.6, 54, 10), stoneD, { p: [xr, 27, -26] });
    M.add(new THREE.ConeGeometry(5.2, 22, 10), roof, { p: [xr, 65, -26] });
    // flying buttresses
    M.add(new THREE.BoxGeometry(1.4, 1.4, 16), stoneD, { p: [sx * 30, 26, -16], r: [0.6, 0, 0] });
    // the great horns, curving outward and up from the keep top
    addHorn(ctx, M, horn, [sx * 9, 36, -14], [sx * 40, 44, -12], [sx * 38, 82, -20], 5.2, 12, 10);
    M.add(new THREE.ConeGeometry(0.7, 5, 8), hornTip, { p: [sx * 38.2, 83.5, -20.2], r: [0, 0, sx * 0.08] });
  }
  // emblem over the gate
  if (typeof document !== 'undefined') {
    M.add(new THREE.CircleGeometry(6, 32), ctx.mat('#ffffff', { map: emblemTexture(THREE), alphaTest: 0.3, basic: true }), { p: [0, 26.5, 0.25], shadow: false });
  }
  const castle = M.build('gehennaCastle');
  // lava moat falls either side of the plinth
  if (lavaMatFlow) {
    for (const sx of [-1, 1]) {
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(6, 20), lavaMatFlow);
      fall.position.set(sx * 38, -4, 8);
      fall.rotation.y = sx * 0.4;
      castle.add(fall);
    }
  }
  // Pandemonium banners hanging from the battlements
  const tex = ctx.textTexture('GEHENNA', { width: 512, height: 128, bg: CRIMSON, color: '#ffe0a0', stroke: '#1a0d10', size: 88 });
  tex.rotation = Math.PI / 2;
  tex.center.set(0.5, 0.5);
  const bm = ctx.mat('#ffffff', { map: tex, side: 2 });
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 15), bm);
    b.position.set(sx * 11, 28, -0.4);
    castle.add(b);
  }
  // castle sits north of the start straight, facing the road
  const P = ctx.pointAt(D('straight', 55), -125);
  castle.scale.setScalar(1.35);
  castle.position.set(P.x, (ctx.groundAt(P.x, P.z) ?? P.y) - 1, P.z);
  castle.rotation.y = frameYaw(ctx, D('straight', 55)) - Math.PI / 2; // +Z (front) faces the road on its right
  ctx.group.add(castle);
  ctx.reserve(P.x, P.z, 72);
}

/** Distant volcano with a glowing crater and a slow ash plume. */
function buildVolcano(ctx) {
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const rock = ctx.mat('#2a1a1c', { toon: true, flatShading: true });
  const rock2 = ctx.mat('#3a2226', { toon: true, flatShading: true });
  const lava = ctx.mat(LAVA, { emissive: LAVA, emissiveIntensity: 1.6, basic: true });
  const g = new THREE.CylinderGeometry(26, 170, 150, 14, 4, true);
  const pos = g.attributes.position;
  const rng = ctx.rng;
  for (let i = 0; i < pos.count; i++) {
    const yy = pos.getY(i);
    if (yy > 74 || yy < -74) continue;
    const f = 1 + (rng() - 0.5) * 0.18;
    pos.setX(i, pos.getX(i) * f);
    pos.setZ(i, pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  M.add(g, rock, { p: [0, 60, 0] });
  M.add(new THREE.CylinderGeometry(24, 24, 2, 14), lava, { p: [0, 131, 0], shadow: false });
  // lava streaks down the flanks
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const len = 60 + rng() * 70;
    const dir = new THREE.Vector3(Math.cos(a) * 144, -150, Math.sin(a) * 144).normalize();
    const sc = len / 2 / 208;
    const r = 26 + 144 * sc + 1.2;
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    M.add(new THREE.BoxGeometry(3 + rng() * 3, len, 1.2), lava, { p: [Math.cos(a) * r, 135 - 150 * sc, Math.sin(a) * r], q, shadow: false });
  }
  // shoulder ridges
  for (let k = 0; k < 5; k++) {
    const a = rng() * Math.PI * 2;
    M.add(new THREE.ConeGeometry(50 + rng() * 30, 60 + rng() * 40, 7), rock2, { p: [Math.cos(a) * 140, 20, Math.sin(a) * 140] });
  }
  const v = M.build('volcano');
  const b = ctx.path.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  v.position.set(cx - 260, b.min.y - 16, cz - 420);
  ctx.group.add(v);
  // ash plume
  const ash = ctx.mat('#4a3034', { opacity: 0.3, depthWrite: false, toon: true });
  const puffs = [];
  for (let k = 0; k < 5; k++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), ash);
    m.userData.ph = k / 5;
    v.add(m);
    puffs.push(m);
  }
  ctx.addAnimated((dt, time) => {
    for (const m of puffs) {
      const u = (time * 0.02 + m.userData.ph) % 1;
      const s = 20 + u * 60;
      m.scale.set(s * 1.3, s * 0.7, s);
      m.position.set(u * 180, 145 + u * 110, u * 60);
    }
  });
}

/** Icosphere with deterministic per-position jitter (no cracks between faces). */
function lumpyRock(THREE, r, seed = 1) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
    const k = 1 + ((h - Math.floor(h)) - 0.5) * 0.35;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Scrolling lava-fall planes (shared material, animated offset). */
function makeLavaFlowMat(ctx) {
  const { THREE } = ctx;
  if (typeof document === 'undefined') return null;
  const tex = lavaFlowTexture(THREE);
  tex.repeat.set(1, 2);
  const m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false, fog: true });
  ctx.addAnimated((dt) => {
    tex.offset.y = (tex.offset.y + dt * 0.9) % 1;
  });
  return m;
}

/** Lava falls pouring into the chasm under the bridge + a cliff fall behind the hairpin. */
function buildLavaFalls(ctx, flowMat) {
  const { THREE } = ctx;
  if (!flowMat) return;
  const vy = ctx.voidY ?? -14;
  const M = makeMerger(ctx);
  const rock = ctx.mat('#4a3430', { toon: true, flatShading: true });
  const glowM = ctx.mat('#ffb040', { additive: true, opacity: 0.35, depthWrite: false, basic: true });
  const falls = [];
  // hairpin cliff: tall crag outside the hairpin with a fall into a lava pool
  {
    const d = D('hairpin', 42);
    const f = ctx.frameAt(d);
    const P = ctx.pointAt(d, 42); // outside of a left hairpin = right side
    const gy = ctx.groundAt(P.x, P.z) ?? P.y;
    const crag = [
      [8, 6, 16, [1.3, 0.6, 1.2]],
      [10, 18, 13, [1, 0.9, 1]],
      [12, 30, 10, [1, 1, 0.9]],
      [15, 39, 8, [1.1, 0.8, 1.2]],
      [22, 12, 12, [1, 1.3, 1]],
    ];
    for (const [o, y, r, sc] of crag) M.add(lumpyRock(THREE, r, o * 7 + y), rock, { p: [P.x + f.rightH.x * o, gy + y, P.z + f.rightH.z * o], s: sc, r: [0, o, 0] });
    falls.push({ x: P.x - f.rightH.x * 1.5, z: P.z - f.rightH.z * 1.5, y: gy + 18, h: 40, w: 8, yaw: f.yaw + Math.PI / 2 + Math.PI });
    M.add(new THREE.CylinderGeometry(9, 9, 0.6, 20), ctx.mat(LAVA, { emissive: LAVA, emissiveIntensity: 1.3, basic: true }), { p: [P.x - f.rightH.x * 6, gy + 0.3, P.z - f.rightH.z * 6], shadow: false });
    M.add(new THREE.TorusGeometry(9.2, 1.2, 6, 20), rock, { p: [P.x - f.rightH.x * 6, gy + 0.3, P.z - f.rightH.z * 6], r: [Math.PI / 2, 0, 0] });
    ctx.reserve(P.x, P.z, 16);
  }
  const g = M.build('lavaFallRocks');
  ctx.group.add(g);
  for (const fl of falls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(fl.w, fl.h, 1, 1), flowMat);
    m.position.set(fl.x, fl.y, fl.z);
    m.rotation.y = fl.yaw;
    ctx.group.add(m);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(fl.w * 2.4, fl.h * 0.5), glowM);
    gl.position.set(fl.x, fl.y - fl.h * 0.3, fl.z);
    gl.rotation.y = fl.yaw;
    gl.position.x += Math.sin(fl.yaw) * 0.4;
    gl.position.z += Math.cos(fl.yaw) * 0.4;
    ctx.group.add(gl);
  }
}

/** Lava river crossing under the bridge + lava lakes around Geyser Ridge + the river beside the back straight. */
function buildLavaRivers(ctx) {
  const { THREE } = ctx;
  if (typeof document === 'undefined') return;
  const base = lavaFlowTexture(THREE);
  const riverTex = base.clone();
  riverTex.needsUpdate = true;
  riverTex.repeat.set(1, 1);
  const lakeTex = lavaLakeTexture(THREE);
  const riverMat = new THREE.MeshBasicMaterial({ map: riverTex, color: '#ffd0b0', toneMapped: false });
  const lakeMat = new THREE.MeshBasicMaterial({ map: lakeTex, color: '#ffc8a8', toneMapped: false });
  ctx.addAnimated((dt) => {
    riverTex.offset.y = (riverTex.offset.y + dt * 0.12) % 1;
    lakeTex.offset.y = (lakeTex.offset.y + dt * 0.02) % 1;
    lakeTex.offset.x = (lakeTex.offset.x + dt * 0.006) % 1;
  });
  const hAt = (x, z) => Math.max(ctx.groundAt(x, z) ?? -1, -1.2) + 0.35;

  // ribbon along a 2D polyline [[x, z, w], ...] (v runs along the flow)
  const ribbon = (pts, mat, bank) => {
    const pos = [];
    const uv = [];
    const idx = [];
    let v = 0;
    const cpos = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, z, w] = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      if (i > 0) v += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]) / 40;
      for (const s of [-1, 0, 1]) {
        const px = x - tz * s * w * 0.5;
        const pz = z + tx * s * w * 0.5;
        pos.push(px, hAt(px, pz), pz);
        uv.push((s + 1) / 2, v);
      }
      if (bank) for (const s of [-1, 1]) cpos.push([x - tz * s * (w * 0.5 + 1.2), z + tx * s * (w * 0.5 + 1.2)]);
      if (i < pts.length - 1) for (let c = 0; c < 2; c++) {
        const i0 = i * 3 + c;
        idx.push(i0, i0 + 1, i0 + 3, i0 + 1, i0 + 4, i0 + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.name = 'lavaRiver';
    ctx.group.add(m);
    return cpos;
  };
  const rocks = [];
  const alongTrack = (d, lats, meander, wFn) => {
    const f = ctx.frameAt(d);
    return lats.map((lat, i) => {
      const x = f.pos.x + f.rightH.x * lat + f.tan.x * Math.sin(i * 0.7) * meander;
      const z = f.pos.z + f.rightH.z * lat + f.tan.z * Math.sin(i * 0.7) * meander;
      return [x, z, wFn(i)];
    });
  };
  // 1) the river under the bridge, crossing from far left to far right
  {
    const lats = [];
    for (let l = -320; l <= 320; l += 16) lats.push(l);
    const pts = alongTrack(D('bridge', 36), lats, 10, (i) => 16 + 5 * Math.sin(i * 0.45));
    const edge = ribbon(pts, riverMat, true);
    for (let k = 0; k < edge.length; k += 3) rocks.push(edge[k]);
  }
  // 2) the river beside the back straight (left side, flowing along)
  {
    const pts = [];
    for (let k = -2; k <= 13; k++) {
      const d = D('river', k * 18);
      const f = ctx.frameAt(d);
      const lat = -(f.halfWidth + f.offL + 16 + 6 * Math.sin(k * 0.8));
      pts.push([f.pos.x + f.rightH.x * lat, f.pos.z + f.rightH.z * lat, 20 + 4 * Math.sin(k)]);
    }
    const edge = ribbon(pts, riverMat, true);
    for (let k = 0; k < edge.length; k += 4) rocks.push(edge[k]);
  }
  // 3) lava lakes either side of Geyser Ridge (flat sheets: terrain rises through them as rocky islands)
  const lakeY = -0.35;
  for (const [off, lat, r] of [[70, -62, 58], [100, 64, 60], [150, -40, 34], [30, 40, 36]]) {
    const P = ctx.pointAt(D('ridge', off), lat);
    const g = new THREE.CircleGeometry(r, 48);
    const pos = g.attributes.position;
    for (let i = 1; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i));
      const k = 1 + 0.16 * Math.sin(a * 3 + off) + 0.08 * Math.sin(a * 7 + lat);
      pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k);
    }
    g.rotateX(-Math.PI / 2);
    g.translate(P.x, lakeY, P.z);
    const uvA = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uvA.setXY(i, pos.getX(i) / 38, pos.getZ(i) / 38);
    const m = new THREE.Mesh(g, lakeMat);
    m.name = 'lavaLake';
    ctx.group.add(m);
  }
  // crusty rocks along the river banks
  const rk = [];
  const rng = ctx.rng;
  for (const [x, z] of rocks) {
    if (!ctx.isClear(x, z, 3)) continue;
    const gy = ctx.groundAt(x, z);
    if (gy === null || gy === undefined || gy < -3) continue;
    rk.push({ x, y: gy, z, rotY: rng() * 6, scale: 0.8 + rng() * 1.2 });
  }
  if (rk.length) ctx.instanced('lavaRock', rk, {});
}

/** Erupting lava geysers: road-side vents (launch hazards while erupting) + big decorative ones in the lake. */
function buildGeysers(ctx) {
  const { THREE } = ctx;
  const ventRock = ctx.mat('#2a2024', { toon: true, flatShading: true });
  const core = ctx.mat('#ff7a2a', { emissive: '#ff7a2a', emissiveIntensity: 1.2, basic: true });
  const colMat = ctx.mat('#ffb040', { emissive: '#ff8a2a', emissiveIntensity: 1.6, basic: true, opacity: 0.92 });
  const colOuter = ctx.mat('#ff4a14', { additive: true, opacity: 0.5, depthWrite: false, basic: true });
  const vents = [];
  const PERIOD = 5.2;
  const mk = (x, y, z, big, phase, hazard) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(big ? 3.4 : 1.7, big ? 1.3 : 0.6, 6, 12), ventRock);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    g.add(ring);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(big ? 3.4 : 1.7, 14), core);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.12;
    g.add(pool);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(big ? 1.6 : 0.9, big ? 2.8 : 1.5, 1, 10, 1, true), colMat);
    const halo = new THREE.Mesh(new THREE.CylinderGeometry(big ? 3.2 : 1.8, big ? 4.2 : 2.3, 1, 10, 1, true), colOuter);
    const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(big ? 3 : 1.7, 0), colMat);
    g.add(col, halo, cap);
    col.visible = halo.visible = cap.visible = false;
    ctx.group.add(g);
    const v = { g, col, halo, cap, pool, big, phase, hazard: null, H: big ? 26 : 11 };
    if (hazard) {
      v.hazard = ctx.addHazard({ position: new THREE.Vector3(x, y, z), radius: 2.1, kind: 'geyser', effect: 'launch', object3d: g, moving: false });
      if (v.hazard) {
        v.hazard.height = 12;
        v.hazard.active = false;
      }
    }
    vents.push(v);
  };
  // road-side vents on Geyser Ridge (alternating sides, the centre line stays clear)
  const spots = [
    [30, -6.2, 0.0],
    [72, 6.4, 0.35],
    [112, -6.4, 0.7],
    [148, 6.0, 0.15],
  ];
  for (const [off, lat, ph] of spots) {
    const P = ctx.pointAt(D('ridge', off), lat);
    mk(P.x, P.y + 0.02, P.z, false, ph, true);
  }
  // big decorative geysers in the lava lake beside the ridge
  for (const [off, lat, ph] of [[20, -40, 0.5], [95, 45, 0.1], [140, -52, 0.8], [60, -70, 0.3]]) {
    const P = ctx.pointAt(D('ridge', off), lat);
    mk(P.x, (ctx.voidY ?? -12) + 0.4, P.z, true, ph, false);
  }
  ctx.addAnimated((dt, time) => {
    for (const v of vents) {
      const u = ((time / PERIOD + v.phase) % 1 + 1) % 1;
      // 0.00-0.30 idle, 0.30-0.45 warning (bubbling), 0.45-0.78 eruption, 0.78-1 dying down
      const warn = u > 0.3 && u < 0.45;
      const erupt = u >= 0.45 && u < 0.78;
      const fall = u >= 0.78 && u < 0.86;
      let h = 0;
      if (erupt) h = Math.min(1, (u - 0.45) / 0.05) * (0.9 + 0.1 * Math.sin(time * 20 + v.phase * 9));
      else if (fall) h = 1 - (u - 0.78) / 0.08;
      const on = h > 0.02;
      v.col.visible = v.halo.visible = v.cap.visible = on;
      if (on) {
        const H = v.H * h;
        v.col.scale.set(1, H, 1);
        v.col.position.y = H / 2;
        v.halo.scale.set(1, H * 0.85, 1);
        v.halo.position.y = H * 0.42;
        v.cap.position.y = H;
        const cs = 1 + 0.25 * Math.sin(time * 14 + v.phase * 5);
        v.cap.scale.set(cs, cs * 0.8, cs);
        v.cap.rotation.y += dt * 3;
      }
      v.pool.scale.setScalar(warn ? 1 + 0.25 * Math.abs(Math.sin(time * 18)) : 1);
      if (v.hazard) v.hazard.active = h > 0.3;
    }
  });
}

/** The Horn Gate: two gigantic horns rising from both sides of the crest and crossing above the road. */
function buildHornGate(ctx) {
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const horn = ctx.mat(HORN, { toon: true });
  const ring = ctx.mat('#d8a93a', { toon: true, emissive: '#7a4a10', emissiveIntensity: 0.4 });
  const rock = ctx.mat('#2c2226', { toon: true, flatShading: true });
  const d = D('crest', 4);
  const f = ctx.frameAt(d);
  const hw = f.halfWidth + f.offL + 3;
  for (const sx of [-1, 1]) {
    // horns in the gate's local frame: x = lateral, z = along the road
    addHorn(ctx, M, horn, [sx * hw, -2, 0], [sx * (hw + 6), 22, 0], [-sx * 4, 26, 2], 3.6, 14, 10);
    M.add(new THREE.TorusGeometry(3.8, 0.55, 6, 18), ring, { p: [sx * (hw + 1.2), 4, 0], r: [Math.PI / 2, 0, 0] });
    M.add(new THREE.DodecahedronGeometry(5, 0), rock, { p: [sx * (hw + 2), -1, 0], s: [1, 0.7, 1.2] });
  }
  const gate = M.build('hornGate');
  const tex = ctx.textTexture('PREFECT TEAM CHECKPOINT', { width: 1024, height: 128, bg: '#1a0d10', color: '#ff6a4a', stroke: '#000000', size: 70 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2), ctx.mat('#ffffff', { map: tex, side: 2, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.5 }));
  sign.position.set(0, 18.5, 0.4);
  sign.rotation.y = Math.PI;
  gate.add(sign);
  // chains hanging the sign
  for (const sx of [-1, 1]) {
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 4), ctx.mat('#888090', { toon: true }));
    ch.position.set(sx * 7, 22, 0.4);
    gate.add(ch);
  }
  ctx.place(gate, { d, lateral: 0, y: 0 });
}

/** Giant skull rock at the esses + ancient pillars. */
function buildSkullRock(ctx) {
  const { THREE } = ctx;
  const skull = ctx.props.create('skull', { color: '#d8ccb4', color2: '#ff5a1f' });
  skull.scale.setScalar(9);
  const d = D('esses', 20);
  const f = ctx.frameAt(d);
  // esses start with a left turn: outside = right side
  ctx.place(skull, { d, lateral: f.halfWidth + f.offR + 16, yaw: -Math.PI / 2 - 0.4, ground: true, y: -2 });
  const P = ctx.pointAt(d, f.halfWidth + f.offR + 16);
  ctx.reserve(P.x, P.z, 14);
}

/** Prefect Team banners, "HOT" warning signs and Gehenna flags along the start straight / bridge. */
function buildBanners(ctx) {
  const list1 = [];
  const list2 = [];
  for (let k = 0; k < 8; k++) {
    for (const side of [-1, 1]) {
      const d = D('home', 10 + k * 22);
      const f = ctx.frameAt(d);
      const lat = side * (f.halfWidth + f.offL + 2.8);
      const P = ctx.pointAt(d, lat);
      const gy = ctx.groundAt(P.x, P.z);
      if (gy === null || gy === undefined) continue;
      (k % 2 ? list2 : list1).push({ x: P.x, y: gy, z: P.z, rotY: f.yaw + (side < 0 ? Math.PI / 2 : -Math.PI / 2) });
    }
  }
  if (list1.length) ctx.instanced(ctx.props.create('banner', { text: 'PREFECT TEAM', color: '#b3182c' }), list1);
  if (list2.length) ctx.instanced(ctx.props.create('banner', { text: 'GEHENNA', color: '#3a1a4a' }), list2);
  // warning signs before the bridge / ridge
  const signs = [
    ['bridge', -14, 'NO RAILS!'],
    ['ridge', -10, 'GEYSERS!'],
    ['hairpin', -18, 'HAIRPIN'],
  ];
  for (const [mark, off, text] of signs) {
    const s = ctx.props.create('sign', { variant: 'text', text });
    const d = D(mark, off);
    const f = ctx.frameAt(d);
    ctx.place(s, { d, lateral: -(f.halfWidth + f.offL + 1.5), yaw: 0.3, ground: true, reserve: false });
  }
}

/** Obsidian shards + lava rocks + skull piles scattered in hand-picked spots (instanced). */
function buildRockField(ctx) {
  const rng = ctx.rng;
  const obs = [];
  const skulls = [];
  for (let k = 0; k < 40; k++) {
    const d = rng() * LEN;
    const f = ctx.frameAt(d);
    const side = rng() < 0.5 ? -1 : 1;
    const lat = side * (f.halfWidth + (side < 0 ? f.offL : f.offR) + 6 + rng() * 30);
    const P = ctx.pointAt(d, lat);
    if (!ctx.isClear(P.x, P.z, 3)) continue;
    const gy = ctx.groundAt(P.x, P.z);
    if (gy === null || gy === undefined) continue;
    if (k % 4 === 0) skulls.push({ x: P.x, y: gy - 0.3, z: P.z, rotY: f.yaw + (side < 0 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5), scale: 1.2 + rng() * 1.4 });
    else obs.push({ x: P.x, y: gy - 0.2, z: P.z, rotY: rng() * 6.28, scale: 1 + rng() * 1.8 });
  }
  if (obs.length) ctx.instanced('crystal', obs, { color: '#4a1f6a', color2: '#1c0c28' });
  if (skulls.length) ctx.instanced('skull', skulls, { color: '#d8ccb4', color2: '#ff5a1f' });
}

function scenery(ctx) {
  const flow = makeLavaFlowMat(ctx);
  const parts = [
    () => buildCastle(ctx, flow),
    () => buildVolcano(ctx),
    () => buildLavaFalls(ctx, flow),
    () => buildLavaRivers(ctx),
    () => buildGeysers(ctx),
    () => buildHornGate(ctx),
    () => buildSkullRock(ctx),
    () => buildBanners(ctx),
    () => buildRockField(ctx),
  ];
  for (const p of parts) {
    try {
      p();
    } catch (e) {
      console.warn('[gehenna-inferno] scenery part failed', e);
    }
  }
}

export default {
  id: 'gehenna-inferno',
  name: 'Gehenna Inferno Rally',
  laps: 3,
  width: 22,
  offroad: 6,
  wall: true,
  points: C.points,
  features: [
    // castle straight
    { type: 'itemRow', t: T('straight', 75), count: 4, spacing: 4.5 },
    { type: 'coins', t: T('t1', 50), count: 5, spacing: 4.5, lateral: 7.5 },
    // bridge: dash onto the rail-less bridge, Credits hugging the drop
    { type: 'boost', t: T('preBridge', 12), lateral: 2, length: 8, width: 5 },
    { type: 'coins', t: T('bridge', 38), count: 5, spacing: 4.5, lateral: -7 },
    // hairpin: tight inside line pays
    { type: 'coins', t: T('hairpin', 44), count: 4, spacing: 4, lateral: -6.5 },
    { type: 'hazard', t: T('approach', 26), lateral: 6.5, kind: 'lavaRock', radius: 1.5 },
    // climb + crest jump
    { type: 'itemRow', t: T('climb', 18), count: 4, spacing: 4.5 },
    { type: 'boost', t: T('climb', 52), lateral: -4, length: 8, width: 5 },
    { type: 'ramp', t: T('crest', 24), lateral: 0, length: 10, width: 15, power: 1.15 },
    // geyser ridge (wall-less over the lava lake)
    { type: 'itemRow', t: T('ridge', 8), count: 3, spacing: 5 },
    { type: 'hazardZone', t: T('ridge', 30), lateral: -6.2, length: 6, width: 5 },
    { type: 'hazardZone', t: T('ridge', 72), lateral: 6.4, length: 6, width: 5 },
    { type: 'hazardZone', t: T('ridge', 112), lateral: -6.4, length: 6, width: 5 },
    { type: 'hazardZone', t: T('ridge', 148), lateral: 6.0, length: 6, width: 5 },
    { type: 'coins', t: T('ridge', 92), count: 6, spacing: 4, lateral: 7.5 },
    // skull esses
    { type: 'hazard', t: T('t5', 44), lateral: 7.5, kind: 'skull', radius: 1.4 },
    { type: 'coins', t: T('esses2', 20), count: 5, spacing: 4, lateral: 5, curve: -3 },
    // lava-river back straight + final sweeper
    { type: 'itemRow', t: T('river', 45), count: 4, spacing: 4.5 },
    { type: 'boost', t: T('river', 130), lateral: -5, length: 8, width: 5 },
    { type: 'coins', t: T('final', 50), count: 5, spacing: 5, lateral: 8 },
  ],
  decorations: [
    { kind: 'lavaRock', count: 50, side: 'both', minOffset: 1, maxOffset: 45, scale: [0.7, 1.8], seed: 31 },
    { kind: 'boulder', count: 26, side: 'both', minOffset: 4, maxOffset: 70, scale: [1.0, 2.6], seed: 32, color: '#3a2c30' },
    { kind: 'rock', count: 40, side: 'both', minOffset: -3, maxOffset: 20, scale: [0.6, 1.5], seed: 33, color: '#4a3a3c' },
    { kind: 'crystal', count: 24, side: 'both', minOffset: 2, maxOffset: 40, scale: [0.9, 2.2], seed: 34, color: '#5a2a8a', color2: '#1c0c28' },
    { kind: 'skull', count: 8, side: 'outside', minOffset: 2, maxOffset: 18, scale: [1, 1.8], seed: 35, color: '#d8ccb4', color2: '#ff5a1f', face: 'road', tRange: [T('t5'), T('river', 20)] },
    { kind: 'pillar', count: 10, side: 'both', minOffset: 2, maxOffset: 14, scale: [1.2, 1.8], seed: 36, color: '#4a3a44', color2: '#ff5a1f', tRange: [T('t2'), T('climb', 60)] },
    { kind: 'flag', every: 45, side: 'both', offset: 2, color: '#b3182c', tRange: [T('t3'), T('t4', 60)] },
    { kind: 'lamp', every: 40, side: 'both', offset: 1.5, tRange: [T('t1', 20), T('preBridge', 10)] },
    { kind: 'ruin', count: 8, side: 'outside', minOffset: 6, maxOffset: 30, scale: [1.2, 2], seed: 37, color: '#4a3a44', tRange: [T('t2'), T('t3')] },
  ],
  theme: {
    preset: 'lava',
    sky: { top: '#16040a', bottom: '#a8281a', horizon: '#ff6a2a', stars: false, sunDisc: false, clouds: true },
    fog: { color: '#5a1a14', near: 120, far: 640 },
    sun: { color: '#ffb07a', intensity: 1.9, dir: [-0.35, 0.75, 0.45] },
    ambient: { sky: '#ffa27a', ground: '#4a2218', intensity: 1.2 },
    ground: { type: 'rock', color: '#6e4234', color2: '#4e2e28' },
    road: { style: 'stone', color: '#4a3d3a', color2: '#3b302e', lines: false },
    edge: { style: 'glow', colorA: '#ff6a1f', colorB: '#ffd23f' },
    offroad: { type: 'gravel', color: '#4a3a36' },
    wall: { style: 'stone', color: '#3d3337', color2: '#ff5a1f' },
    void: { type: 'lava', color: '#ff5a1f' },
    particles: 'embers',
    music: 'gehenna',
  },
  scenery,
};
