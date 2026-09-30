// Abydos Desert Circuit (owner: tracks-A) — Credit Cup race 1: the friendly, wide and flowing opener.
// Sun-baked, half-sand-buried streets around Abydos High School: a long start straight past the school,
// a fast banked sweeper, a crest hop into the ruined old town S-bends, a dune run with a ramp over the dune
// crest, a switchback with a hairpin around the sand hill and a long oasis straight home.
//
// Also exports two small helpers reused by shibaseki-street.js (same owner):
//   course(start, cmds)  turtle layout (straights + exact-radius arcs) that closes itself, with distance marks
//   makeMerger(ctx)      collects primitive geometries per material and merges them (few draw calls)

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---- course(): turtle layout -----------------------------------------------------------------------------
// cmd: { len } straight | { arc (deg, + = right), r } | { close: true, r, turn: 'right'|'left' } (last).
// Other fields (w, bank, off, offL, offR, wall, wallL, wallR) go onto the generated control points.
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
    const { len = 0, arc = 0, r = 50, step = 30, n: nn, y: yEnd, mark, ...attrs } = c;
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
      pts.push({ x: R2(x), y: R2(y0 + (y1 - y0) * u), z: R2(z), ...attrs });
    }
    y = y1;
    dist += arc ? Math.abs(arc) * D2R * r : len;
  };
  for (const c of cmds) {
    if (!c.close) {
      run(c);
      continue;
    }
    // closing: straight a, arc (back to the start heading), straight b onto the start point
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
    if (a > 0.5) run({ len: a, n: c.nA ?? 1, y: c.yA ?? y, mark: c.markA, ...(c.attrsA || {}) });
    run({ arc: dd, r, n: c.nArc, y: c.yArc ?? y, mark: c.mark, ...(c.attrsArc || {}) });
    if (b > 0.5) run({ len: b, n: Math.max(1, Math.round(b / 60)), y: start.y, mark: c.markB, ...(c.attrsB || {}) });
    pts.pop(); // the last point coincides with the start point
  }
  return { points: pts, marks, length: dist, closeInfo };
}

// ---- makeMerger(): batch primitive parts into one mesh per material ---------------------------------------
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
    /** add(geometry, material, { p:[x,y,z], r:[rx,ry,rz], s:n|[sx,sy,sz], shadow }) — geometry is consumed */
    add(geo, mat, o = {}) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      geo.dispose();
      for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      const p = o.p || [0, 0, 0];
      const r = o.r || [0, 0, 0];
      const sc = o.s === undefined ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s;
      e.set(r[0], r[1], r[2]);
      q.setFromEuler(e);
      m4.compose(v.set(p[0], p[1], p[2]), q, s.set(sc[0], sc[1], sc[2]));
      g.applyMatrix4(m4);
      const shadow = o.shadow !== false;
      const key = mat.uuid + (shadow ? ':s' : ':n');
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat, shadow, geos: [] }));
      b.geos.push(g);
    },
    /** build(): Group with one Mesh per material bucket */
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

// ---- layout ------------------------------------------------------------------------------------------------
const C = course({ x: 0, z: 0, y: 0, yaw: Math.PI / 2, attrs: { w: 26, off: 8 } }, [
  { len: 140, w: 25, off: 8, mark: 'straight' }, // start straight past Abydos High (left)
  { arc: 90, r: 75, w: 24, off: 8, bank: 8, y: 2, mark: 't1' }, // fast banked right sweeper (water tower)
  { len: 85, w: 22, off: 7, y: 7, mark: 'climb' }, // climb to the crest
  { len: 34, w: 21, off: 6, y: 3.5, mark: 'crest' }, // hop over the crest into the old town
  { arc: -55, r: 48, n: 1, w: 19, off: 5, bank: -5, y: 1.5, mark: 's1' }, // old-town S-bends (ruins)
  { arc: 55, r: 48, n: 1, w: 19, off: 5, bank: 5, y: 0, mark: 's2' },
  { len: 14, w: 20, off: 6, mark: 'town' },
  { arc: 90, r: 44, w: 20, off: 6, bank: 6, mark: 't2' },
  { len: 50, w: 22, off: 9, y: 2, mark: 'duneRun' }, // the dune run: up the dune ...
  { arc: -24, r: 170, n: 1, w: 22, off: 9, y: 8, mark: 'duneUp' },
  { len: 48, w: 22, off: 9, y: 11, mark: 'duneTop' }, // ... ramp over the crest ...
  { arc: 24, r: 170, n: 1, w: 22, off: 9, y: 4, mark: 'duneDrop' },
  { len: 79, w: 22, off: 8, y: 0, mark: 'duneOut' }, // ... and down
  { arc: 90, r: 42, n: 2, w: 21, off: 7, bank: 6, mark: 't3' },
  { len: 18, w: 20, off: 6, y: 1, mark: 'hillFoot' },
  { arc: 90, r: 32, w: 20, off: 6, bank: 5, y: 3.5, mark: 'sw1' }, // switchback around the sand hill
  { len: 45, w: 20, off: 6, y: 5.5, mark: 'sw2' },
  { arc: -180, r: 29, w: 20, offL: 8, offR: 6, bank: -6, y: 5, mark: 'hairpin' },
  { len: 45, w: 20, off: 6, y: 3.5, mark: 'sw3' },
  { arc: 90, r: 32, w: 21, off: 6, bank: 5, y: 1.5, mark: 'sw4' },
  { close: true, r: 66, turn: 'right', mark: 't4', markA: 'oasis', markB: 'home', yA: 0, attrsA: { w: 23, off: 8 }, attrsArc: { w: 24, off: 8, bank: 7 }, attrsB: { w: 26, off: 8 } },
]);

export const MARKS = C.marks;
export const CLOSE = C.closeInfo;
const T = (mark, off = 0) => {
  const t = (C.marks[mark] + off) / C.length;
  return ((t % 1) + 1) % 1;
};

// ---- scenery -------------------------------------------------------------------------------------------------
const SAND = '#e9c688';
const SAND_D = '#d6ab66';
const CREAM = '#f1e6cc';
const NAVY = '#2f4f86';
const SKYBLUE = '#5fb4e8';

function box(THREE, w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

function buildSchool(ctx) {
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const wall = ctx.mat(CREAM, { toon: true });
  const wallD = ctx.mat('#dccfb2', { toon: true });
  const trim = ctx.mat(NAVY, { toon: true });
  const plinth = ctx.mat('#b58c5a', { toon: true });
  const glass = ctx.mat('#86c3ea', { toon: true, emissive: '#4a8fc0', emissiveIntensity: 0.25 });
  const board = ctx.mat('#8a6440', { toon: true });
  const sand = ctx.mat(SAND, { toon: true });
  const dark = ctx.mat('#3a3440', { toon: true });
  const W = 58;
  const H = 15;
  const D = 14;
  // main block (front face at z = 0), wings
  M.add(box(THREE, W, H, D), wall, { p: [0, H / 2, -D / 2] });
  M.add(box(THREE, W + 1, 1.2, D + 0.8), plinth, { p: [0, 0.6, -D / 2] });
  M.add(box(THREE, W + 1.2, 0.9, D + 1.2), trim, { p: [0, H + 0.45, -D / 2] });
  for (let f = 1; f < 4; f++) M.add(box(THREE, W + 0.3, 0.35, 0.5), wallD, { p: [0, f * 3.6 + 0.6, 0.1] });
  // side annex (gym) on the right
  M.add(box(THREE, 18, 10, 18), wallD, { p: [W / 2 + 8, 5, -12] });
  M.add(new THREE.CylinderGeometry(9.6, 9.6, 18.6, 16, 1, false, 0, Math.PI), trim, { p: [W / 2 + 8, 10, -12], r: [0, 0, Math.PI / 2], s: [1, 1, 0.35] });
  // windows: 4 floors, skipping the central tower
  const rng = ctx.rng;
  for (let f = 0; f < 4; f++) {
    const y = 2.5 + f * 3.6;
    for (let x = -W / 2 + 2.8; x <= W / 2 - 2.8; x += 3.4) {
      if (Math.abs(x) < 6.5) continue;
      const boarded = rng() < 0.12;
      M.add(box(THREE, 2.3, 1.9, 0.25), boarded ? board : glass, { p: [x, y, 0.05], r: [0, 0, boarded ? (rng() - 0.5) * 0.25 : 0] });
    }
  }
  // gym windows
  for (let x = -6; x <= 6; x += 4) M.add(box(THREE, 2.6, 1.6, 0.25), glass, { p: [W / 2 + 8 + x, 6.5, -2.9] });
  // central clock tower
  M.add(box(THREE, 11, 25, 13), wall, { p: [0, 12.5, -6] });
  M.add(box(THREE, 11.8, 0.9, 13.8), trim, { p: [0, 25.2, -6] });
  M.add(new THREE.ConeGeometry(8.6, 5, 4), trim, { p: [0, 28.2, -6], r: [0, Math.PI / 4, 0] });
  M.add(new THREE.CylinderGeometry(0.1, 0.1, 3, 5), dark, { p: [0, 31.8, -6], shadow: false });
  for (let f = 0; f < 3; f++) M.add(box(THREE, 3, 2.2, 0.3), glass, { p: [0, 6.2 + f * 3.6, 0.55] });
  // entrance: steps, door, canopy
  M.add(box(THREE, 7, 3.4, 0.4), dark, { p: [0, 1.9, 0.55] });
  M.add(box(THREE, 9, 0.35, 3.2), trim, { p: [0, 3.9, 1.6] });
  for (const sx of [-4, 4]) M.add(new THREE.CylinderGeometry(0.22, 0.22, 3.7, 8), wallD, { p: [sx, 1.9, 2.9] });
  for (let k = 0; k < 3; k++) M.add(box(THREE, 9 - k, 0.3, 1.2), plinth, { p: [0, 0.15 + k * 0.3, 3.8 - k * 0.8] });
  // clock face (disc + ring); hands animated separately
  M.add(new THREE.CylinderGeometry(3.1, 3.1, 0.3, 28), trim, { p: [0, 19.5, 0.6], r: [Math.PI / 2, 0, 0] });
  M.add(new THREE.CylinderGeometry(2.7, 2.7, 0.3, 28), ctx.mat('#fffaf0', { toon: true, emissive: '#fff4d0', emissiveIntensity: 0.25 }), { p: [0, 19.5, 0.75], r: [Math.PI / 2, 0, 0], shadow: false });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    M.add(box(THREE, 0.25, k % 3 ? 0.4 : 0.8, 0.1), dark, { p: [Math.sin(a) * 2.3, 19.5 + Math.cos(a) * 2.3, 0.95], r: [0, 0, -a], shadow: false });
  }
  // sand drifted against the building
  for (const [x, sx, sz] of [[-24, 12, 6], [-9, 7, 4], [21, 10, 5], [34, 9, 7], [-31, 5, 8]]) {
    M.add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), sand, { p: [x, 0, 0.6], s: [sx, 2.4 + sx * 0.12, sz] });
  }
  // front courtyard wall with a gap for the gate
  for (const sx of [-1, 1]) {
    M.add(box(THREE, 20, 1.6, 0.8), wallD, { p: [sx * 17, 0.8, 14] });
    M.add(box(THREE, 20.4, 0.3, 1.0), trim, { p: [sx * 17, 1.7, 14] });
    M.add(box(THREE, 1.6, 3.4, 1.6), wall, { p: [sx * 6.2, 1.7, 14] });
    M.add(box(THREE, 1.9, 0.4, 1.9), trim, { p: [sx * 6.2, 3.55, 14] });
    // Abydos emblem on the gate pillars: navy disc + light-blue triangle
    M.add(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 16), trim, { p: [sx * 6.2, 2.3, 14.85], r: [Math.PI / 2, 0, 0], shadow: false });
    M.add(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 3), ctx.mat(SKYBLUE, { toon: true, emissive: SKYBLUE, emissiveIntensity: 0.3 }), { p: [sx * 6.2, 2.3, 14.9], r: [Math.PI / 2, 0, 0], shadow: false });
  }
  // flagpole
  M.add(new THREE.CylinderGeometry(0.12, 0.16, 12, 6), ctx.mat('#d8dde4', { toon: true }), { p: [-12, 6, 9] });
  const g = M.build('abydosSchool');

  // text: ABYDOS lettering on the tower + school plate over the entrance
  const abydos = ctx.textTexture('ABYDOS', { width: 512, height: 128, color: '#ffffff', stroke: NAVY, strokeW: 0.14 });
  const tl = new THREE.Mesh(new THREE.PlaneGeometry(10.2, 2.55), ctx.mat('#ffffff', { map: abydos, alphaTest: 0.35, basic: true }));
  tl.position.set(0, 23.2, 0.52);
  g.add(tl);
  const plate = ctx.textTexture('ABYDOS HIGH SCHOOL', { width: 1024, height: 128, bg: NAVY, color: '#ffffff', stroke: '#16213a', size: 70 });
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 1.08), ctx.mat('#ffffff', { map: plate, basic: true }));
  pl.position.set(0, 4.55, 3.22);
  g.add(pl);
  // "Foreclosure Task Force" banner hanging on the left wing
  const bt = ctx.textTexture('FORECLOSURE TASK FORCE', { width: 1024, height: 160, bg: '#fff8ea', color: '#e03a3a', stroke: '#2a1a1a', size: 84 });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(19, 2.95), ctx.mat('#ffffff', { map: bt, side: 2 }));
  banner.position.set(-17.5, 11.6, 0.42);
  g.add(banner);
  const bt2 = ctx.textTexture('SAVE ABYDOS! ♥', { width: 1024, height: 160, bg: '#fff8ea', color: '#2f6fd1', stroke: '#16213a', size: 90 });
  const banner2 = new THREE.Mesh(new THREE.PlaneGeometry(15, 2.3), ctx.mat('#ffffff', { map: bt2, side: 2 }));
  banner2.position.set(18, 11.6, 0.42);
  g.add(banner2);

  // clock hands (animated)
  const handMat = ctx.mat('#2a2430', { toon: true });
  const hour = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.5, 0.1), handMat);
  hour.geometry.translate(0, 0.6, 0);
  const minute = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.1), handMat);
  minute.geometry.translate(0, 0.95, 0);
  hour.position.set(0, 19.5, 1.02);
  minute.position.set(0, 19.5, 1.08);
  g.add(hour, minute);
  // flag (waves)
  const flagTex = ctx.textTexture('▲', { width: 256, height: 160, bg: NAVY, color: SKYBLUE, stroke: '#ffffff', strokeW: 0.08, size: 110 });
  const flagGeo = new THREE.PlaneGeometry(3.6, 2.2, 8, 1);
  flagGeo.translate(1.8, 0, 0);
  const flag = new THREE.Mesh(flagGeo, ctx.mat('#ffffff', { map: flagTex, side: 2 }));
  flag.position.set(-12, 10.7, 9);
  g.add(flag);
  const fpos = flagGeo.attributes.position;
  const base = Float32Array.from(fpos.array);
  ctx.addAnimated((dt, time) => {
    minute.rotation.z = -time * 0.35;
    hour.rotation.z = -time * 0.35 / 12 - 1.2;
    for (let i = 0; i < fpos.count; i++) {
      const x = base[i * 3];
      fpos.setZ(i, Math.sin(time * 5 - x * 1.4) * 0.22 * (x / 3.6));
    }
    fpos.needsUpdate = true;
  });
  return g;
}

function buildWaterTower(ctx) {
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const steel = ctx.mat('#a9a197', { toon: true });
  const tank = ctx.mat('#ece4d4', { toon: true });
  const band = ctx.mat(SKYBLUE, { toon: true });
  const rust = ctx.mat('#b8744a', { toon: true });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    M.add(new THREE.CylinderGeometry(0.35, 0.45, 18, 6), steel, { p: [Math.sin(a) * 3.6, 9, Math.cos(a) * 3.6], r: [Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12] });
  }
  for (const y of [5, 11]) M.add(new THREE.TorusGeometry(3.6 - y * 0.04, 0.12, 4, 16), steel, { p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
  M.add(new THREE.CylinderGeometry(5, 5, 7, 20), tank, { p: [0, 21.5, 0] });
  M.add(new THREE.CylinderGeometry(5.08, 5.08, 1.3, 20), band, { p: [0, 21.5, 0] });
  M.add(new THREE.CylinderGeometry(5.1, 5.1, 0.6, 20), rust, { p: [0, 18.3, 0] });
  M.add(new THREE.ConeGeometry(5.4, 3, 20), tank, { p: [0, 26.5, 0] });
  M.add(new THREE.SphereGeometry(0.5, 8, 6), band, { p: [0, 28.2, 0] });
  M.add(new THREE.CylinderGeometry(5.3, 5.3, 0.25, 20), steel, { p: [0, 18.05, 0] });
  const g = M.build('waterTower');
  const lt = ctx.textTexture('ABYDOS', { width: 512, height: 128, color: NAVY, stroke: '#ffffff', strokeW: 0.1 });
  const lm = ctx.mat('#ffffff', { map: lt, alphaTest: 0.35 });
  for (const a of [0, Math.PI]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(5.12, 5.12, 1.9, 20, 1, true, a - 0.75, 1.5), lm);
    p.position.y = 23.6;
    g.add(p);
  }
  return g;
}

function buildOverpass(ctx) {
  // A broken highway overpass: a silhouette on the horizon (no collision, far from the corridor)
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const conc = ctx.mat('#cbbfae', { toon: true });
  const concD = ctx.mat('#a99c8a', { toon: true });
  const rail = ctx.mat('#e8e0d2', { toon: true });
  const span = 26;
  for (let i = 0; i < 6; i++) {
    const x = i * span;
    M.add(box(THREE, 3, 16, 3), concD, { p: [x, 8, 0] });
    M.add(box(THREE, 5, 1.6, 12), conc, { p: [x, 16.4, 0] });
    if (i < 5) {
      const broken = i === 4;
      const len = broken ? span * 0.55 : span;
      M.add(box(THREE, len, 1.8, 14), conc, { p: [x + len / 2, 18, 0] });
      for (const sz of [-1, 1]) M.add(box(THREE, len, 1.2, 0.5), rail, { p: [x + len / 2, 19.5, sz * 6.8] });
    }
  }
  // fallen slab of the broken end, half buried
  M.add(box(THREE, 18, 1.8, 14), conc, { p: [4 * span + 20, 8, 0], r: [0, 0.1, -0.85] });
  // sand dunes swallowing the pillars
  const sand = ctx.mat(SAND, { toon: true });
  for (let i = 0; i < 6; i++) M.add(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), sand, { p: [i * span + 3, 0, 2], s: [9 + (i % 3) * 3, 3 + (i % 2) * 2, 7] });
  return M.build('brokenOverpass');
}

function buildOasis(ctx) {
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  // dried-up oasis basin: cracked clay pan, a sad puddle, a rim of sand, an old well
  M.add(new THREE.CylinderGeometry(15, 17, 0.6, 28), ctx.mat('#c9a878', { toon: true }), { p: [0, 0.05, 0] });
  M.add(new THREE.CylinderGeometry(12, 12, 0.3, 28), ctx.mat('#b08a5c', { toon: true }), { p: [0, 0.3, 0] });
  M.add(new THREE.CylinderGeometry(2.4, 2.4, 0.3, 16), ctx.mat('#62b6d8', { toon: true, emissive: '#3a8fb8', emissiveIntensity: 0.2 }), { p: [3, 0.36, -2], s: [1.4, 1, 0.8], shadow: false });
  const crack = ctx.mat('#8a6a44', { toon: true });
  const rng = ctx.rng;
  for (let k = 0; k < 16; k++) {
    const a = rng() * Math.PI * 2;
    const r = 3 + rng() * 7;
    M.add(box(THREE, 0.18, 0.1, 2 + rng() * 3), crack, { p: [Math.sin(a) * r, 0.47, Math.cos(a) * r], r: [0, a + (rng() - 0.5), 0], shadow: false });
  }
  // well
  const stone = ctx.mat('#b9a68a', { toon: true });
  M.add(new THREE.CylinderGeometry(1.6, 1.7, 1.3, 12, 1, true), stone, { p: [-8, 0.9, 5] });
  M.add(new THREE.TorusGeometry(1.65, 0.2, 5, 14), stone, { p: [-8, 1.55, 5], r: [Math.PI / 2, 0, 0] });
  for (const sx of [-1, 1]) M.add(box(THREE, 0.2, 2.6, 0.2), ctx.mat('#7a5634', { toon: true }), { p: [-8 + sx * 1.5, 2.6, 5] });
  M.add(new THREE.ConeGeometry(2.4, 1.2, 4), ctx.mat('#a0442e', { toon: true }), { p: [-8, 4.3, 5], r: [0, Math.PI / 4, 0] });
  return M.build('dryOasis');
}

function buildRuins(ctx, list) {
  // half-sand-buried abandoned shops/houses: blocky shells with dark window holes, tilted, sand drifts
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const cols = ['#e3cfae', '#d8c0a0', '#eadbc0', '#cdb49a', '#e6c9a8'];
  const hole = ctx.mat('#4a3a36', { toon: true });
  const sand = ctx.mat(SAND, { toon: true });
  const sandD = ctx.mat(SAND_D, { toon: true });
  const rng = ctx.rng;
  const v = new THREE.Vector3();
  for (const it of list) {
    const P = ctx.pointAt(it.d, it.lat);
    const fr = ctx.frameAt(it.d);
    const gy = ctx.groundAt(P.x, P.z) ?? P.y;
    const w = it.w ?? 10 + rng() * 5;
    const h = it.h ?? 6 + rng() * 6;
    const dp = 8 + rng() * 3;
    const yaw = fr.yaw + (it.lat < 0 ? -Math.PI / 2 : Math.PI / 2) + (rng() - 0.5) * 0.3;
    const sink = 1 + rng() * 1.8;
    const tilt = (rng() - 0.5) * 0.08;
    const wallM = ctx.mat(cols[(rng() * cols.length) | 0], { toon: true });
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const L = (lx, lz) => [P.x + lx * cy + lz * sy, P.z - lx * sy + lz * cy];
    const [bx, bz] = L(0, 0);
    M.add(box(THREE, w, h, dp), wallM, { p: [bx, gy + h / 2 - sink, bz], r: [tilt, yaw, tilt * 0.6] });
    // broken top edge: a few staggered blocks
    for (let k = 0; k < 3; k++) {
      const lx = (rng() - 0.5) * w * 0.7;
      const [x, z] = L(lx, (rng() - 0.5) * dp * 0.5);
      M.add(box(THREE, 2 + rng() * 3, 1 + rng() * 2, dp * 0.9), wallM, { p: [x, gy + h - sink + 0.4, z], r: [tilt, yaw, tilt] });
    }
    // window holes on the front (+Z local) face
    const floors = Math.max(1, Math.floor((h - sink) / 3.2));
    for (let f = 0; f < floors; f++) {
      for (let lx = -w / 2 + 2; lx <= w / 2 - 2; lx += 3) {
        if (rng() < 0.2) continue;
        const [x, z] = L(lx, dp / 2 + 0.05);
        M.add(box(THREE, 1.6, 1.5, 0.2), hole, { p: [x, gy - sink + 2.4 + f * 3.2, z], r: [0, yaw, 0], shadow: false });
      }
    }
    // sand drifted against it (front and side)
    for (let k = 0; k < 2; k++) {
      const [x, z] = L((k ? 1 : -1) * w * 0.35, dp / 2 + 0.5);
      M.add(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), k ? sand : sandD, { p: [x, gy - 0.2, z], s: [w * 0.45, 1.8 + rng() * 1.6, 3.5], r: [0, yaw, 0] });
    }
    ctx.reserve(bx, bz, Math.max(w, dp) * 0.6);
    void v;
  }
  return M.build('ruins');
}

function buildDustDevils(ctx, spots) {
  const { THREE } = ctx;
  const mat = ctx.mat('#e8c890', { opacity: 0.28, depthWrite: false, side: 2, basic: true });
  const geo = new THREE.CylinderGeometry(3.2, 0.5, 14, 14, 6, true);
  // twist the funnel
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const a = y * 0.18;
    const x = p.getX(i), z = p.getZ(i);
    p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a) + Math.sin(y * 0.3) * 0.8, y + 7, x * Math.sin(a) + z * Math.cos(a));
  }
  geo.computeVertexNormals();
  const devils = spots.map(([x, z], i) => {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 3;
    const gy = ctx.groundAt(x, z) ?? 0;
    m.position.set(x, gy - 0.5, z);
    ctx.group.add(m);
    return { m, x, z, ph: i * 2.1 };
  });
  ctx.addAnimated((dt, time) => {
    for (const d of devils) {
      d.m.rotation.y += dt * 3.2;
      d.m.position.x = d.x + Math.sin(time * 0.21 + d.ph) * 18;
      d.m.position.z = d.z + Math.cos(time * 0.17 + d.ph) * 14;
      const s = 0.85 + Math.sin(time * 1.3 + d.ph) * 0.15;
      d.m.scale.set(s, 1 + Math.sin(time * 0.7 + d.ph) * 0.12, s);
    }
  });
}

function scenery(ctx) {
  const { THREE, path } = ctx;
  const L = path.length;
  const dOf = (mark, off = 0) => T(mark, off) * L;

  // --- Abydos High School: left of the start straight, facing the road --------------------------------
  const school = buildSchool(ctx);
  ctx.place(school, { d: dOf('straight', 62), lateral: -52, yaw: -Math.PI / 2, ground: true });

  // grandstand for the Foreclosure Task Force fan club on the inside of the start straight
  const gs = ctx.props.create('grandstand', { color: SKYBLUE, color2: NAVY });
  ctx.place(gs, { d: dOf('straight', 30), lateral: 27, yaw: Math.PI / 2, ground: true });

  // welcome sign at the start
  const sign = ctx.props.create('billboard', { text: 'WELCOME TO ABYDOS', variant: 0 });
  ctx.place(sign, { d: dOf('straight', 118), lateral: 26, yaw: Math.PI / 2 - 0.35, ground: true });

  // --- water tower on the outside of T1 ------------------------------------------------------------
  const wt = buildWaterTower(ctx);
  ctx.place(wt, { d: dOf('t1', 55), lateral: -34, ground: true, align: false });

  // --- old town ruins along the crest descent and the S-bends -----------------------------------------
  const ruinSpots = [
    { d: dOf('climb', 70), lat: -30 },
    { d: dOf('crest', 20), lat: 28, h: 11 },
    { d: dOf('s1', 10), lat: -27 },
    { d: dOf('s1', 30), lat: 30, h: 8 },
    { d: dOf('s2', 12), lat: -28, h: 12 },
    { d: dOf('s2', 34), lat: 27 },
    { d: dOf('town', 8), lat: -30, h: 9 },
    { d: dOf('t2', 30), lat: -32, h: 7 },
  ];
  ctx.group.add(buildRuins(ctx, ruinSpots));
  // old shop signs in the town
  const shopSign = ctx.props.create('sign', { variant: 'text', text: 'SHOP (CLOSED)' });
  ctx.place(shopSign, { d: dOf('s1', 20), lateral: 18, yaw: Math.PI / 2 - 0.4, ground: true });

  // --- dry oasis on the inside of the oasis straight ------------------------------------------------
  const oasis = buildOasis(ctx);
  ctx.place(oasis, { d: dOf('oasis', 55), lateral: 42, ground: true, align: false });
  const oasisSign = ctx.props.create('sign', { variant: 'text', text: 'OASIS (DRY)' });
  ctx.place(oasisSign, { d: dOf('oasis', 40), lateral: 17, yaw: Math.PI / 2 - 0.3, ground: true });
  // palms around the oasis (some dried out)
  {
    const c = ctx.pointAt(dOf('oasis', 55), 42);
    const green = [];
    const dry = [];
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2 + 0.3;
      const r = 19 + (k % 3) * 2.5;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      if (!ctx.isClear(x, z, 2)) continue;
      const t = { x, y: ctx.groundAt(x, z) ?? c.y, z, rotY: a * 3, scale: 0.9 + (k % 4) * 0.12 };
      (k % 3 === 0 ? dry : green).push(t);
    }
    if (green.length) ctx.instanced('palm', green, { seed: 4 });
    if (dry.length) ctx.instanced('palm', dry, { seed: 9, color: '#a89048' });
  }

  // --- broken highway overpass on the horizon ------------------------------------------------------
  const ov = buildOverpass(ctx);
  {
    const b = path.bounds;
    const x = b.min.x - 120;
    const z = (b.min.z + b.max.z) / 2 + 60;
    ov.position.set(x, (ctx.groundAt(x, z) ?? 0) - 1, z);
    ov.rotation.y = Math.PI / 2 + 0.25;
    ctx.group.add(ov);
  }

  // --- dust devils wandering in the open desert ----------------------------------------------------
  if (ctx.quality !== 'low') {
    const b = path.bounds;
    buildDustDevils(ctx, [
      [b.max.x + 60, (b.min.z + b.max.z) / 2],
      [(b.min.x + b.max.x) / 2, b.max.z + 70],
    ]);
  }

  // --- dune crest markers: chevron signs before the ramp ------------------------------------------
  for (const [off, lat] of [[-10, 16], [-10, -16]]) {
    const s = ctx.props.create('sign', { variant: 'caution' });
    ctx.place(s, { d: dOf('duneTop', off), lateral: lat, yaw: lat > 0 ? Math.PI / 2 - 0.6 : -Math.PI / 2 + 0.6, ground: true });
  }
  const dj = ctx.props.create('billboard', { text: 'DUNE JUMP!', variant: 1 });
  ctx.place(dj, { d: dOf('duneUp', 20), lateral: -24, yaw: -Math.PI / 2 + 0.45, ground: true });
  // a half-buried old school bus stranded beside the dune top
  {
    const M = makeMerger(ctx);
    const body = ctx.mat('#f2c230', { toon: true });
    const glassM = ctx.mat('#5a7a90', { toon: true });
    const blk = ctx.mat('#2b2b33', { toon: true });
    M.add(box(THREE, 3.2, 3.2, 11), body, { p: [0, 1.6, 0] });
    M.add(box(THREE, 3.25, 0.5, 11.05), blk, { p: [0, 1.1, 0] });
    for (let k = -2; k <= 2; k++) for (const sx of [-1, 1]) M.add(box(THREE, 0.1, 1, 1.6), glassM, { p: [sx * 1.62, 2.4, k * 2] });
    M.add(box(THREE, 2.8, 1.1, 0.1), glassM, { p: [0, 2.4, 5.52] });
    M.add(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), ctx.mat(SAND, { toon: true }), { p: [0.5, -0.2, -2], s: [4.2, 2.2, 7] });
    const bus = M.build('bus');
    bus.rotation.set(0.12, 0, -0.18);
    const holder = new THREE.Group();
    holder.add(bus);
    ctx.place(holder, { d: dOf('duneTop', 20), lateral: 26, yaw: 0.6, ground: true, y: -0.8 });
  }
  // hairpin arrows
  for (const off of [10, 30, 50, 70]) {
    const s = ctx.props.create('sign', { variant: 'left' });
    ctx.place(s, { d: dOf('hairpin', off), lateral: 18, yaw: Math.PI, ground: true, reserve: false });
  }

  // nobori banners lining the home straight
  const noboriL = [];
  for (let k = 0; k < 7; k++) {
    for (const lat of [-22.5, 22.5]) {
      if (lat > 0 && k < 3) continue; // grandstand there
      const P = ctx.pointAt(dOf('straight', 10 + k * 18), lat);
      noboriL.push({ x: P.x, y: ctx.groundAt(P.x, P.z) ?? P.y, z: P.z, rotY: Math.PI / 2 + (lat < 0 ? -Math.PI / 2 : Math.PI / 2) });
    }
  }
  ctx.instanced(ctx.props.create('banner', { text: 'ABYDOS', color: SKYBLUE }), noboriL.filter((_, i) => i % 2 === 0));
  ctx.instanced(ctx.props.create('banner', { text: 'TASK FORCE', color: '#ff5a6a' }), noboriL.filter((_, i) => i % 2 === 1));
}

export default {
  id: 'abydos-desert',
  name: 'Abydos Desert Circuit',
  laps: 3,
  width: 22,
  offroad: 7,
  wall: true,
  points: C.points,
  features: [
    // start straight
    { type: 'itemRow', t: T('straight', 100), count: 4, spacing: 4.5 },
    // T1: Credits on the tight inside line
    { type: 'coins', t: T('t1', 58), count: 5, spacing: 5, lateral: 7.5 },
    // climb: dash panel on the left line, Credits over the crest
    { type: 'boost', t: T('climb', 45), lateral: -4.5, length: 8, width: 5 },
    { type: 'coins', t: T('crest', 6), count: 4, spacing: 4, lateral: -3 },
    // old town: crates/barrels on the apexes of the S-bends
    { type: 'hazard', t: T('s1', 22), lateral: -7, kind: 'crate', radius: 1.2 },
    { type: 'hazard', t: T('s1', 26), lateral: -5.2, kind: 'barrel', radius: 1.0 },
    { type: 'hazard', t: T('s2', 26), lateral: 6.8, kind: 'barrel', radius: 1.0 },
    { type: 'coins', t: T('s2', 4), count: 4, spacing: 4, lateral: 0 },
    // dune run
    { type: 'itemRow', t: T('duneRun', 18), count: 4, spacing: 4.5 },
    { type: 'slow', t: T('duneRun', 44), lateral: 8, length: 14, width: 5 },
    { type: 'slow', t: T('duneTop', 12), lateral: -8, length: 12, width: 5 },
    { type: 'ramp', t: T('duneTop', 42), lateral: 0, length: 10, width: 14, power: 1.2 },
    { type: 'coins', t: T('duneDrop', 36), count: 5, spacing: 4.5, lateral: 0 },
    { type: 'boost', t: T('duneOut', 34), lateral: 4, length: 8, width: 5 },
    // switchback + hairpin around the sand hill
    { type: 'itemRow', t: T('sw2', 22), count: 3, spacing: 4.5 },
    { type: 'coins', t: T('hairpin', 45), count: 5, spacing: 4.5, lateral: -6.5 },
    { type: 'hazard', t: T('sw3', 28), lateral: 6, kind: 'cactus', radius: 1.0 },
    // oasis straight + final sweeper
    { type: 'itemRow', t: T('oasis', 28), count: 4, spacing: 4.5 },
    { type: 'boost', t: T('oasis', 92), lateral: -3, length: 8, width: 5 },
    { type: 'coins', t: T('t4', 52), count: 5, spacing: 5, lateral: 8 },
  ],
  decorations: [
    { kind: 'dune', count: 30, side: 'both', minOffset: 28, maxOffset: 170, scale: [1.1, 2.6], seed: 11 },
    { kind: 'dune', count: 10, side: 'both', minOffset: 2, maxOffset: 22, scale: [0.6, 1.0], seed: 12, tRange: [T('duneRun'), T('t3')] },
    { kind: 'cactus', count: 14, side: 'both', minOffset: 1, maxOffset: 14, scale: [0.9, 1.5], seed: 17, tRange: [T('duneRun'), T('t3')] },
    { kind: 'palm', count: 26, side: 'both', minOffset: 3, maxOffset: 30, scale: [0.9, 1.3], seed: 3, tRange: [T('t4', -80), T('t1', 20)] },
    { kind: 'palm', count: 10, side: 'both', minOffset: 4, maxOffset: 40, scale: [0.9, 1.25], seed: 13 },
    { kind: 'cactus', count: 44, side: 'both', minOffset: 1, maxOffset: 60, scale: [0.8, 1.5], seed: 5 },
    { kind: 'rock', count: 50, side: 'both', minOffset: -2, maxOffset: 50, scale: [0.6, 1.6], seed: 7 },
    { kind: 'boulder', count: 16, side: 'both', minOffset: 5, maxOffset: 70, scale: [0.8, 1.8], seed: 8 },
    { kind: 'ruin', count: 12, side: 'both', minOffset: 4, maxOffset: 30, scale: [0.9, 1.4], seed: 9, tRange: [T('climb', 40), T('t2', 60)] },
    { kind: 'barrel', count: 10, side: 'both', minOffset: 0.5, maxOffset: 6, seed: 14, tRange: [T('crest'), T('t2')] },
    { kind: 'crate', count: 8, side: 'both', minOffset: 0.5, maxOffset: 6, seed: 15, tRange: [T('crest'), T('t2')] },
    { kind: 'lamp', every: 42, side: 'both', offset: 1.2, tRange: [T('t4', 40), T('climb', 60)] },
    { kind: 'lamp', every: 42, side: 'both', offset: 1.2, tRange: [T('crest'), T('t2', 40)] },
    { kind: 'vendingMachine', count: 3, side: 'outside', minOffset: 1, maxOffset: 3, seed: 16, tRange: [T('s1'), T('t2')] },
  ],
  theme: {
    preset: 'desert',
    sky: { top: '#3a86e0', bottom: '#ffe9c8', horizon: '#ffd79c', clouds: true, sunDisc: true },
    fog: { color: '#f4dcae', near: 170, far: 860 },
    sun: { color: '#fff0c8', intensity: 2.75, dir: [0.55, 0.9, 0.28] },
    ambient: { sky: '#d4e8ff', ground: '#dcb57a', intensity: 1.05 },
    ground: { type: 'sand', color: '#edc98c', color2: '#dcae6a' },
    road: { style: 'asphalt', color: '#6d6862', color2: '#5f5a54', lines: true },
    edge: { style: 'curb', colorA: '#2f6fd1', colorB: '#ffffff' },
    offroad: { type: 'sand', color: '#e6c07c' },
    wall: { style: 'stone', color: '#d9b67e', color2: '#b98f58' },
    particles: 'dust',
    music: 'abydos',
  },
  scenery,
};
