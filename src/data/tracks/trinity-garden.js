// Trinity Garden Speedway (owner: tracks-B) — Credit Cup race 3.
// Rolling Trinity General School grounds: cathedral straight, Sisterhood Hill S-bends + crest jump, the Tea
// Party hairpin around a gazebo, Justice Bridge between two ponds, Fountain Court esses and Cathedral Rise.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Turtle path helper (shared text copied into both track files).
// cmds: { len } straight | { arc (deg, + = right), r } arc, plus y (end height), n (points), attrs (w, bank, off...)
// len may be a string placeholder ('A' / 'B') solved so the loop closes onto `close` ({x,z}).
function turtle(start, cmds, close) {
  const run = (lens) => {
    let { x, z, yaw, y } = start;
    const R2 = (v) => Math.round(v * 100) / 100;
    const out = [{ x, y, z, ...(start.attrs || {}) }];
    const marks = {};
    let dist = 0;
    for (const c of cmds) {
      const { len: len0, arc, r, step = 30, n: nn, y: yEnd, mark, ...attrs } = c;
      const len = typeof len0 === 'string' ? lens[len0] : len0;
      if (mark) marks[mark] = dist;
      const n = nn ?? (arc ? Math.max(1, Math.round(Math.abs(arc) / step)) : Math.max(1, Math.round(len / 60)));
      const y0 = y;
      const y1 = yEnd ?? y;
      const sx = x, sz = z, syaw = yaw;
      for (let k = 1; k <= n; k++) {
        const u = k / n;
        let px, pz, pyaw;
        if (arc) {
          const sg = Math.sign(arc);
          const cx = sx - Math.cos(syaw) * r * sg;
          const cz = sz + Math.sin(syaw) * r * sg;
          pyaw = syaw - ((arc * Math.PI) / 180) * u;
          px = cx + Math.cos(pyaw) * r * sg;
          pz = cz - Math.sin(pyaw) * r * sg;
        } else {
          px = sx + Math.sin(syaw) * len * u;
          pz = sz + Math.cos(syaw) * len * u;
          pyaw = syaw;
        }
        // smoothstep-eased height inside a segment
        const e = u * u * (3 - 2 * u);
        out.push({ x: R2(px), y: R2(y0 + (y1 - y0) * (arc ? u : e)), z: R2(pz), ...attrs });
        x = px;
        z = pz;
        yaw = pyaw;
      }
      dist += arc ? (Math.abs(arc) * Math.PI * r) / 180 : len;
      y = y1;
    }
    return { pts: out, end: { x, z }, marks, dist };
  };
  if (!close) return run({});
  const e0 = run({ A: 0, B: 0 }).end;
  const eA = run({ A: 1, B: 0 }).end;
  const eB = run({ A: 0, B: 1 }).end;
  const ax = eA.x - e0.x, az = eA.z - e0.z, bx = eB.x - e0.x, bz = eB.z - e0.z;
  const rx = close.x - e0.x, rz = close.z - e0.z;
  const det = ax * bz - az * bx;
  const A = (rx * bz - rz * bx) / det;
  const B = (ax * rz - az * rx) / det;
  const res = run({ A, B });
  res.solved = { A, B };
  return res;
}

// ---- merged-geometry builder (one mesh per material) --------------------------------------------------------
function merger(ctx) {
  const { THREE } = ctx;
  const buckets = new Map();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  return {
    /** add(geometry, material, { p:[x,y,z], r:[rx,ry,rz], s:n|[sx,sy,sz], shadow }) — geometry is consumed */
    add(geo, mat, o = {}) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      geo.dispose();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      g.clearGroups();
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

// ---- layout ----------------------------------------------------------------------------------------------------
const LAYOUT = turtle(
  { x: 0, z: 0, y: 0, yaw: Math.PI / 2, attrs: { w: 26, off: 8 } },
  [
    // Cathedral straight (east). Grid sits behind the line.
    { len: 170, n: 3, w: 25, off: 8, mark: 'start' },
    // T1 "Rose Window" — long fast right sweeper, gently rising
    { arc: 90, r: 74, y: 2, w: 24, bank: 8, off: 7, mark: 't1' },
    // climb onto Sisterhood Hill
    { len: 60, y: 9, w: 22, off: 6, mark: 'climb' },
    // rose-garden S up the hill
    { arc: -55, r: 58, y: 14, w: 20, bank: -6, off: 5, mark: 's1' },
    { arc: 55, r: 58, y: 18, w: 20, bank: 6, off: 5, mark: 's2' },
    // hill-top (ramp at the crest) and the drop
    { len: 44, n: 1, y: 18, w: 22, off: 6, mark: 'crest' },
    { len: 50, n: 2, y: 11, w: 22, off: 6, mark: 'drop' },
    // Tea Party hairpin (right) around the gazebo
    { arc: 180, r: 33, y: 9, w: 20, bank: 8, offL: 7, offR: 4, step: 36, mark: 'hairpin' },
    { len: 50, y: 6, w: 21, off: 6, mark: 'back' },
    // left onto the pond bridge
    { arc: -90, r: 50, y: 5, w: 21, bank: -7, off: 6, mark: 't3' },
    { len: 54, n: 2, y: 5, w: 21, off: 3, mark: 'bridge' },
    // fountain-court esses (wide: a fountain splits the road at the flick)
    { arc: 50, r: 64, y: 4, w: 24, bank: 5, off: 5, mark: 'esses' },
    { arc: -50, r: 64, y: 3, w: 23, bank: -5, off: 5, mark: 'esses2' },
    // Cathedral hill: long rise west, crest in the right-hander
    { len: 'A', y: 10, w: 23, off: 7, mark: 'west' },
    { arc: 90, r: 56, y: 12, w: 22, bank: 7, off: 6, mark: 't5' },
    { len: 'B', y: 3, w: 23, off: 7, mark: 'descent' },
    // final right onto the cathedral straight
    { arc: 90, r: 60, y: 0, w: 24, bank: 7, off: 7, mark: 't6' },
    { len: 36, n: 1, y: 0, w: 26, off: 8, mark: 'home' },
  ],
  { x: -12, z: 0 },
);
export const MARKS = LAYOUT.marks;
const LEN = LAYOUT.dist;
const D = (mark, off = 0) => ((((MARKS[mark] + off) % LEN) + LEN) % LEN);
const T = (mark, off = 0) => D(mark, off) / LEN;

// ---- palette -------------------------------------------------------------------------------------------------
const STONE = '#f4f0e6';
const STONE_D = '#d9d1c2';
const ROOF = '#6b8fd8';
const GOLD = '#f0c75a';
const GLASS = '#86b8ff';
const HEDGE = '#3f9a3c';
const ROSE = '#e8304f';
const PINK = '#ff9ec7';
const CREAM = '#fff3dc';

// pointed (gothic) arch outline, base at y=0, width w, straight side height h
function gothicShape(THREE, w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, h);
  s.quadraticCurveTo(-w / 2, h + w * 0.55, 0, h + w * 0.85);
  s.quadraticCurveTo(w / 2, h + w * 0.55, w / 2, h);
  s.lineTo(w / 2, 0);
  s.lineTo(-w / 2, 0);
  return s;
}
function gothic(THREE, w, h, depth = 0) {
  const sh = gothicShape(THREE, w, h);
  return depth > 0 ? new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 6 }) : new THREE.ShapeGeometry(sh, 6);
}
function prism(THREE, w, h, depth) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth); // front face at z = 0, extends to -Z
  return g;
}

// stained-glass rose window texture (drawn once)
function roseWindowTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const C = 128;
  g.fillStyle = '#2a3566';
  g.fillRect(0, 0, 256, 256);
  const cols = ['#3a7bff', '#ff4f7b', '#ffd23f', '#6fe0ff', '#b58cff', '#39c46b'];
  // outer ring of 16 petals
  for (let ring = 0; ring < 3; ring++) {
    const n = [16, 12, 8][ring];
    const R = [100, 70, 42][ring];
    const pr = [18, 16, 14][ring];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.2;
      g.fillStyle = cols[(k + ring * 2) % cols.length];
      g.beginPath();
      g.ellipse(C + Math.cos(a) * R, C + Math.sin(a) * R, pr, pr * 0.62, a, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1b1f3a';
      g.lineWidth = 4;
      g.stroke();
    }
  }
  g.fillStyle = '#fff2b0';
  g.beginPath();
  g.arc(C, C, 20, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#1b1f3a';
  g.lineWidth = 5;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    g.beginPath();
    g.moveTo(C + Math.cos(a) * 22, C + Math.sin(a) * 22);
    g.lineTo(C + Math.cos(a) * 124, C + Math.sin(a) * 124);
    g.stroke();
  }
  g.lineWidth = 6;
  for (const R of [22, 56, 86, 122]) {
    g.beginPath();
    g.arc(C, C, R, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- landmarks -------------------------------------------------------------------------------------------------
function buildCathedral(ctx) {
  const { THREE } = ctx;
  const M = merger(ctx);
  const stone = ctx.mat(STONE, { toon: true });
  const stoneD = ctx.mat(STONE_D, { toon: true });
  const roof = ctx.mat(ROOF, { toon: true });
  const gold = ctx.mat(GOLD, { toon: true, emissive: '#b88a1c', emissiveIntensity: 0.35 });
  const glass = ctx.mat(GLASS, { toon: true, emissive: '#4f7fe0', emissiveIntensity: 0.45, side: THREE.DoubleSide });
  const door = ctx.mat('#6b4a32', { toon: true, side: THREE.DoubleSide });
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // plinth + front steps (base sunk into the ground for uneven terrain)
  M.add(B(58, 6, 84), stoneD, { p: [0, -2.2, -38] });
  for (let k = 0; k < 4; k++) M.add(B(30 - k * 2, 0.4, 3), stoneD, { p: [0, 0.8 - k * 0.4 + 0.2, 5.5 - k * 1.4 + 1.4] });
  // nave + gabled roof
  M.add(B(24, 22, 58), stone, { p: [0, 11, -31] });
  M.add(prism(THREE, 26, 12, 59), roof, { p: [0, 22, -1.5] });
  M.add(B(26.4, 0.8, 59.6), gold, { p: [0, 22.2, -31], shadow: false });
  // aisles with lean-to roofs + buttresses
  for (const sx of [-1, 1]) {
    M.add(B(8, 12, 52), stone, { p: [sx * 16, 6, -33] });
    M.add(B(9.5, 0.7, 53), roof, { p: [sx * 16.2, 13.2, -33], r: [0, 0, sx * -0.38] });
    for (let z = -10; z >= -56; z -= 9.2) {
      M.add(B(2.2, 14, 3), stoneD, { p: [sx * 20.6, 7, z] });
      M.add(new THREE.ConeGeometry(1.4, 3.2, 4), stoneD, { p: [sx * 20.6, 15.6, z], r: [0, Math.PI / 4, 0] });
      // flying buttress to the nave
      M.add(B(0.9, 0.9, 7.5), stoneD, { p: [sx * 16.4, 17.4, z], r: [0, Math.PI / 2, sx * 0.62], s: [1, 1, 1] });
      // lancet windows: clerestory (nave) + aisle
      M.add(gothic(THREE, 2.4, 3.4), glass, { p: [sx * 12.06, 14.8, z - 4.6], r: [0, (sx * Math.PI) / 2, 0], shadow: false });
      M.add(gothic(THREE, 2.2, 3.2), glass, { p: [sx * 20.06, 3.2, z - 4.6], r: [0, (sx * Math.PI) / 2, 0], shadow: false });
    }
  }
  // twin west towers + spires + pinnacles
  for (const sx of [-1, 1]) {
    const x = sx * 15.5;
    M.add(B(11, 40, 11), stone, { p: [x, 20, -3] });
    for (const y of [10, 22, 34]) M.add(B(11.8, 0.8, 11.8), stoneD, { p: [x, y, -3] });
    M.add(B(12.4, 1.4, 12.4), gold, { p: [x, 40.3, -3] });
    // belfry openings on the front + outer faces
    M.add(gothic(THREE, 3.2, 3.6), door, { p: [x, 28.4, 2.56], shadow: false });
    M.add(gothic(THREE, 3.2, 3.6), door, { p: [x + sx * 5.56, 28.4, -3], r: [0, (sx * Math.PI) / 2, 0], shadow: false });
    M.add(gothic(THREE, 2.4, 3.2), glass, { p: [x, 15.4, 2.56], shadow: false });
    M.add(new THREE.ConeGeometry(7, 26, 4), roof, { p: [x, 54, -3], r: [0, Math.PI / 4, 0] });
    M.add(new THREE.SphereGeometry(0.9, 10, 8), gold, { p: [x, 67.6, -3] });
    M.add(new THREE.CylinderGeometry(0.12, 0.12, 4, 5), gold, { p: [x, 69.5, -3], shadow: false });
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      M.add(new THREE.ConeGeometry(1.1, 6, 4), stone, { p: [x + px * 5, 44, -3 + pz * 5], r: [0, Math.PI / 4, 0] });
    }
    // side portal
    M.add(gothic(THREE, 4.4, 4.2, 0.6), stoneD, { p: [x, 0.9, 2.3], s: [1.25, 1.12, 1] });
    M.add(gothic(THREE, 4.4, 4.2), door, { p: [x, 0.9, 2.95], shadow: false });
  }
  // central portal with gold trim, rose window, gable halo
  M.add(gothic(THREE, 7, 6.5, 1.2), stoneD, { p: [0, 0.9, -2.2], s: [1.3, 1.15, 1] });
  M.add(gothic(THREE, 7, 6.5), door, { p: [0, 0.9, -0.95], shadow: false });
  M.add(new THREE.BoxGeometry(0.3, 12.5, 0.2), gold, { p: [0, 7.1, -0.9], shadow: false });
  M.add(new THREE.TorusGeometry(6.6, 0.7, 8, 32), stoneD, { p: [0, 17.5, -1.7] });
  M.add(new THREE.TorusGeometry(8.5, 0.35, 6, 32), gold, { p: [0, 17.5, -1.7], shadow: false });
  // crossing tower + flèche
  M.add(B(13, 8, 13), stone, { p: [0, 26, -40] });
  M.add(B(14, 1, 14), gold, { p: [0, 30.2, -40] });
  M.add(new THREE.ConeGeometry(5, 22, 8), roof, { p: [0, 41.5, -40] });
  M.add(new THREE.SphereGeometry(0.8, 10, 8), gold, { p: [0, 53, -40] });
  // apse
  M.add(new THREE.CylinderGeometry(12, 12, 20, 16, 1, false, Math.PI / 2, Math.PI), stone, { p: [0, 10, -60] });
  M.add(new THREE.SphereGeometry(12.6, 16, 8, Math.PI / 2, Math.PI, 0, Math.PI / 2), roof, { p: [0, 20, -60], s: [1, 0.7, 1] });
  const grp = M.build('cathedral');

  // rose window (textured) + floating Trinity halo over the gable
  const tex = roseWindowTexture(THREE);
  const rw = new THREE.Mesh(
    new THREE.CircleGeometry(6.2, 40),
    ctx.mat('#ffffff', tex ? { map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.55 } : { emissive: GLASS, emissiveIntensity: 0.5 }),
  );
  rw.position.set(0, 17.5, -1.4);
  grp.add(rw);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.32, 8, 40), ctx.mat('#ffe27a', { emissive: '#ffcf3a', emissiveIntensity: 1.2 }));
  halo.position.set(0, 38.5, -1.5);
  halo.rotation.x = -0.35;
  grp.add(halo);
  ctx.addAnimated((dt, time) => {
    halo.position.y = 38.5 + Math.sin(time * 1.3) * 0.5;
    halo.rotation.z = time * 0.4;
  });
  // name board over the portal
  const tt = ctx.textTexture('TRINITY GENERAL SCHOOL', { width: 1024, height: 128, bg: '#2e4a8a', color: '#ffffff', stroke: '#1a2550', size: 72 });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(20, 2.5), ctx.mat('#ffffff', { map: tt, emissiveMap: tt, emissive: '#ffffff', emissiveIntensity: 0.2 }));
  plate.position.set(0, 12.2, 2.9);
  grp.add(plate);
  return grp;
}

function buildGazebo(ctx) {
  const { THREE } = ctx;
  const M = merger(ctx);
  const white = ctx.mat('#fbfaf6', { toon: true });
  const stoneD = ctx.mat(STONE_D, { toon: true });
  const roof = ctx.mat(ROOF, { toon: true });
  const gold = ctx.mat(GOLD, { toon: true, emissive: '#b88a1c', emissiveIntensity: 0.35 });
  const cloth = ctx.mat('#ffffff', { toon: true });
  const pink = ctx.mat(PINK, { toon: true });
  const cream = ctx.mat(CREAM, { toon: true });
  const berry = ctx.mat(ROSE, { toon: true });
  const teal = ctx.mat('#6fc3ff', { toon: true });
  const choco = ctx.mat('#7a4a2e', { toon: true });
  // platform + steps
  M.add(new THREE.CylinderGeometry(8.2, 8.8, 2.4, 8), stoneD, { p: [0, -0.4, 0], r: [0, Math.PI / 8, 0] });
  M.add(new THREE.CylinderGeometry(7.6, 7.6, 0.3, 8), white, { p: [0, 0.95, 0], r: [0, Math.PI / 8, 0] });
  // columns + ring beam
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = Math.cos(a) * 6.6;
    const z = Math.sin(a) * 6.6;
    M.add(new THREE.CylinderGeometry(0.32, 0.36, 4.6, 10), white, { p: [x, 3.4, z] });
    M.add(new THREE.BoxGeometry(0.9, 0.3, 0.9), white, { p: [x, 5.8, z] });
    M.add(new THREE.BoxGeometry(0.9, 0.3, 0.9), white, { p: [x, 1.2, z] });
  }
  M.add(new THREE.TorusGeometry(6.7, 0.42, 6, 8), white, { p: [0, 6.1, 0], r: [Math.PI / 2, 0, Math.PI / 8] });
  M.add(new THREE.TorusGeometry(6.9, 0.14, 4, 8), gold, { p: [0, 6.55, 0], r: [Math.PI / 2, 0, Math.PI / 8], shadow: false });
  // dome roof
  M.add(new THREE.SphereGeometry(7.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), roof, { p: [0, 6.3, 0], s: [1, 0.62, 1] });
  M.add(new THREE.CylinderGeometry(0.9, 1.3, 1.2, 10), white, { p: [0, 11.2, 0] });
  M.add(new THREE.ConeGeometry(0.9, 2.2, 10), roof, { p: [0, 12.9, 0] });
  M.add(new THREE.SphereGeometry(0.4, 8, 6), gold, { p: [0, 14.1, 0] });
  // tea table + chairs
  M.add(new THREE.CylinderGeometry(2.2, 2.2, 0.14, 24), cloth, { p: [0, 2.2, 0] });
  M.add(new THREE.CylinderGeometry(2.25, 2.45, 1.1, 24, 1, true), cloth, { p: [0, 1.65, 0] });
  M.add(new THREE.TorusGeometry(2.3, 0.06, 4, 24), pink, { p: [0, 1.6, 0], r: [Math.PI / 2, 0, 0], shadow: false });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 3.3;
    const z = Math.sin(a) * 3.3;
    M.add(new THREE.BoxGeometry(1.1, 0.16, 1.1), white, { p: [x, 1.85, z], r: [0, -a, 0] });
    M.add(new THREE.BoxGeometry(0.16, 1.5, 1.1), white, { p: [Math.cos(a) * 3.85, 2.55, Math.sin(a) * 3.85], r: [0, -a, 0] });
    M.add(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 5), white, { p: [x, 1.45, z], shadow: false });
    // cup + saucer at each seat
    const cx = Math.cos(a) * 1.5;
    const cz = Math.sin(a) * 1.5;
    M.add(new THREE.CylinderGeometry(0.34, 0.3, 0.05, 12), teal, { p: [cx, 2.3, cz], shadow: false });
    M.add(new THREE.CylinderGeometry(0.2, 0.15, 0.26, 10), white, { p: [cx, 2.45, cz], shadow: false });
    // cake slice
    const sx = Math.cos(a + 0.6) * 1.4;
    const sz = Math.sin(a + 0.6) * 1.4;
    M.add(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 3), k % 2 ? pink : cream, { p: [sx, 2.43, sz], r: [0, a, 0], shadow: false });
    M.add(new THREE.SphereGeometry(0.09, 6, 4), berry, { p: [sx, 2.63, sz], shadow: false });
  }
  // teapot
  M.add(new THREE.SphereGeometry(0.5, 12, 8), white, { p: [0.7, 2.7, -0.4], s: [1, 0.85, 1] });
  M.add(new THREE.CylinderGeometry(0.06, 0.1, 0.6, 6), white, { p: [1.25, 2.8, -0.4], r: [0, 0, -0.9], shadow: false });
  M.add(new THREE.TorusGeometry(0.22, 0.05, 4, 10), teal, { p: [0.2, 2.75, -0.4], shadow: false });
  M.add(new THREE.SphereGeometry(0.14, 8, 6), gold, { p: [0.7, 3.15, -0.4], shadow: false });
  // three-tier cake stand
  M.add(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), gold, { p: [-0.7, 3.05, 0.3], shadow: false });
  for (let k = 0; k < 3; k++) {
    const r = 0.75 - k * 0.2;
    const y = 2.35 + k * 0.62;
    M.add(new THREE.CylinderGeometry(r, r * 0.9, 0.05, 16), white, { p: [-0.7, y, 0.3], shadow: false });
    for (let j = 0; j < 4 - k; j++) {
      const a = (j / (4 - k)) * Math.PI * 2;
      M.add(new THREE.CylinderGeometry(0.14, 0.16, 0.16, 8), [pink, choco, cream][(j + k) % 3], { p: [-0.7 + Math.cos(a) * r * 0.6, y + 0.1, 0.3 + Math.sin(a) * r * 0.6], shadow: false });
    }
  }
  // the grand strawberry cake
  M.add(new THREE.CylinderGeometry(0.85, 0.85, 0.5, 20), cream, { p: [0.2, 2.52, 0.9] });
  M.add(new THREE.CylinderGeometry(0.6, 0.6, 0.4, 20), pink, { p: [0.2, 2.97, 0.9] });
  for (let j = 0; j < 8; j++) {
    const a = (j / 8) * Math.PI * 2;
    M.add(new THREE.SphereGeometry(0.1, 6, 4), berry, { p: [0.2 + Math.cos(a) * 0.5, 3.22, 0.9 + Math.sin(a) * 0.5], shadow: false });
  }
  M.add(new THREE.SphereGeometry(0.16, 8, 6), berry, { p: [0.2, 3.3, 0.9], shadow: false });
  const grp = M.build('gazebo');
  // floating halo above the dome
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 8, 32), ctx.mat('#ffe27a', { emissive: '#ffcf3a', emissiveIntensity: 1.2 }));
  halo.position.set(0, 15.6, 0);
  halo.rotation.x = Math.PI / 2 - 0.25;
  grp.add(halo);
  ctx.addAnimated((dt, time) => {
    halo.position.y = 15.6 + Math.sin(time * 1.7) * 0.35;
    halo.rotation.z = time * 0.8;
  });
  return grp;
}

// white marble angel statue on a plinth (instanced)
function statueObject(ctx) {
  const { THREE } = ctx;
  const M = merger(ctx);
  const marble = ctx.mat('#f7f5ef', { toon: true });
  const plinth = ctx.mat(STONE_D, { toon: true });
  const gold = ctx.mat(GOLD, { toon: true, emissive: '#c99a2a', emissiveIntensity: 0.5 });
  M.add(new THREE.BoxGeometry(2, 2.2, 2), plinth, { p: [0, 1.1, 0] });
  M.add(new THREE.BoxGeometry(2.3, 0.3, 2.3), plinth, { p: [0, 2.3, 0] });
  M.add(new THREE.ConeGeometry(0.9, 3, 10), marble, { p: [0, 3.95, 0] }); // robe
  M.add(new THREE.SphereGeometry(0.46, 10, 8), marble, { p: [0, 5.75, 0] });
  M.add(new THREE.SphereGeometry(0.52, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), marble, { p: [0, 5.8, -0.05], s: [1, 1.1, 1.15] }); // hair
  for (const s of [-1, 1]) {
    M.add(new THREE.SphereGeometry(1, 10, 6), marble, { p: [s * 0.75, 4.9, -0.45], s: [0.35, 1.3, 0.12], r: [0.25, 0, s * -0.5] }); // wings
    M.add(new THREE.CylinderGeometry(0.13, 0.12, 1.2, 6), marble, { p: [s * 0.35, 4.6, 0.35], r: [-1.0, 0, s * 0.4] }); // arms (praying)
  }
  M.add(new THREE.TorusGeometry(0.42, 0.06, 6, 20), gold, { p: [0, 6.55, 0], r: [Math.PI / 2 - 0.3, 0, 0], shadow: false });
  return M.build('statue');
}

// stone lamp-post-ish column with a rose urn (instanced)
function urnObject(ctx) {
  const { THREE } = ctx;
  const M = merger(ctx);
  const stone = ctx.mat(STONE, { toon: true });
  const leaf = ctx.mat('#3d9440', { toon: true });
  const rose = ctx.mat(ROSE, { toon: true });
  const pinkM = ctx.mat(PINK, { toon: true });
  M.add(new THREE.BoxGeometry(1.2, 1.6, 1.2), stone, { p: [0, 0.8, 0] });
  M.add(new THREE.CylinderGeometry(0.8, 0.4, 0.9, 10), stone, { p: [0, 2.05, 0] });
  M.add(new THREE.SphereGeometry(0.85, 8, 6), leaf, { p: [0, 2.6, 0], s: [1, 0.7, 1] });
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    M.add(new THREE.IcosahedronGeometry(0.2, 0), k % 2 ? pinkM : rose, { p: [Math.cos(a) * 0.6, 2.85, Math.sin(a) * 0.6], shadow: false });
  }
  return M.build('urn');
}

// procedural hedge maze (recursive backtracker), returned as wall-segment transforms
function mazeSegments(rng, cols, rows) {
  const H = Array.from({ length: rows + 1 }, () => new Array(cols).fill(true)); // horizontal walls
  const V = Array.from({ length: rows }, () => new Array(cols + 1).fill(true)); // vertical walls
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const nb = [];
    if (r > 0 && !seen[r - 1][c]) nb.push([r - 1, c, 'n']);
    if (r < rows - 1 && !seen[r + 1][c]) nb.push([r + 1, c, 's']);
    if (c > 0 && !seen[r][c - 1]) nb.push([r, c - 1, 'w']);
    if (c < cols - 1 && !seen[r][c + 1]) nb.push([r, c + 1, 'e']);
    if (!nb.length) {
      stack.pop();
      continue;
    }
    const [nr, nc, dir] = nb[(rng() * nb.length) | 0];
    if (dir === 'n') H[r][c] = false;
    if (dir === 's') H[r + 1][c] = false;
    if (dir === 'w') V[r][c] = false;
    if (dir === 'e') V[r][c + 1] = false;
    seen[nr][nc] = true;
    stack.push([nr, nc]);
  }
  // entrances + open centre
  H[rows][Math.floor(cols / 2)] = false;
  H[0][Math.floor(cols / 2)] = false;
  const segs = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) if (H[r][c]) segs.push({ x: c + 0.5, z: r, horiz: true });
  for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) if (V[r][c]) segs.push({ x: c, z: r + 0.5, horiz: false });
  return segs;
}

function scenery(ctx) {
  const { THREE } = ctx;
  const rng = ctx.rng;
  const hi = ctx.quality !== 'low';
  const gy = (x, z, fb = 0) => {
    const g = ctx.groundAt(x, z);
    return g === null || g === undefined ? fb : g;
  };
  // world point at (d, lateral) + ground height
  const at = (d, lat) => {
    const p = ctx.pointAt(d, lat);
    return { x: p.x, z: p.z, y: gy(p.x, p.z, p.y), yaw: ctx.frameAt(d).yaw };
  };

  // --- Cathedral beside the start straight (outside the loop, facing the road) ---
  const cath = buildCathedral(ctx);
  {
    const x = 70;
    const z = -58;
    cath.scale.setScalar(1.2);
    cath.position.set(x, gy(x, z + 10, 0) - 0.3, z);
    cath.rotation.y = 0;
    ctx.group.add(cath);
    ctx.reserve(x, z - 30, 44);
    ctx.reserve(x, z - 4, 30);
  }
  // cathedral plaza: fountains + statues + urns between the road and the facade
  const statue = statueObject(ctx);
  const urn = urnObject(ctx);
  const statues = [];
  const urns = [];
  for (const sx of [-1, 1]) {
    const fx = 70 + sx * 26;
    const f = ctx.props.create('fountain', { scale: 1.3 });
    f.position.set(fx, gy(fx, -40, 0), -40);
    ctx.group.add(f);
    ctx.reserve(fx, -40, 4);
    for (const dz of [-6, 4]) {
      const x = 70 + sx * 12;
      statues.push({ x, y: gy(x, -40 + dz), z: -40 + dz, rotY: 0 });
    }
  }
  // statues and urns along the circuit
  for (const [mk, off, lat] of [
    ['climb', 10, -21], ['climb', 50, -20], ['crest', 6, -21], ['crest', 6, 21], ['west', 15, -22], ['west', 55, -22],
    ['t5', 40, 24], ['home', 10, 30], ['back', 25, -20],
  ]) {
    const p = at(D(mk, off), lat);
    statues.push({ x: p.x, y: Math.max(p.y, ctx.pointAt(D(mk, off), 0).y - 1.8), z: p.z, rotY: p.yaw + (lat > 0 ? Math.PI / 2 : -Math.PI / 2) });
  }
  for (let d = D('start', 12); d < D('start', 168); d += 26) {
    for (const lat of [-24, 24]) {
      const p = at(d, lat);
      urns.push({ x: p.x, y: p.y, z: p.z, rotY: 0 });
    }
  }
  for (let d = D('bridge', 2); d < D('bridge', 54); d += 13) {
    for (const lat of [-16, 16]) {
      const p = at(d, lat);
      urns.push({ x: p.x, y: p.y, z: p.z, rotY: 0 });
    }
  }
  ctx.instanced(statue, statues);
  ctx.instanced(urn, urns);

  // --- Gothic arches spanning the road ---
  for (const [mk, off] of [['start', 150], ['climb', 30], ['descent', 30], ['bridge', 27]]) {
    const d = D(mk, off);
    const f = ctx.frameAt(d);
    const span = f.halfWidth * 2 + f.offL + f.offR + 3;
    const a = ctx.props.create('arch', { width: span, color: STONE, color2: GOLD });
    ctx.place(a, { d, lateral: (f.offR - f.offL) / 2, reserve: false });
  }

  // --- Tea Party gazebo inside the hairpin ---
  {
    const f = ctx.frameAt(D('hairpin', 0));
    const cx = f.pos.x + f.rightH.x * 33;
    const cz = f.pos.z + f.rightH.z * 33;
    const gz = buildGazebo(ctx);
    const g0 = gy(cx, cz, f.pos.y);
    const top = Math.max(g0 + 0.3, f.pos.y - 0.6);
    gz.position.set(cx, top, cz);
    ctx.group.add(gz);
    if (top - g0 > 1) {
      // grassy terraced mound raising the gazebo to road level
      const mound = new THREE.Mesh(new THREE.CylinderGeometry(13, 16.5, top - g0 + 2, 24), ctx.mat('#6fbf4f', { toon: true }));
      mound.position.set(cx, (top + g0) / 2 - 1.3, cz);
      mound.receiveShadow = true;
      ctx.group.add(mound);
    }
    ctx.reserve(cx, cz, 12);
    // ring of rose bushes + lamps around it
    const roses = [];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const x = cx + Math.cos(a) * 11.5;
      const z = cz + Math.sin(a) * 11.5;
      if (ctx.isClear(x, z, 1.3)) roses.push({ x, y: top - 0.3, z, rotY: a, scale: 1.2 });
    }
    ctx.instanced('bush', roses, { color: '#3b8f3a', color2: ROSE });
    const sign = ctx.props.create('sign', { variant: 'text', text: 'TEA PARTY ♥' });
    const sp = at(D('hairpin', 52), 17);
    sign.position.set(sp.x, sp.y, sp.z);
    sign.rotation.y = sp.yaw + Math.PI / 2;
    ctx.group.add(sign);
  }

  // --- Pond + stone bridge (the road crosses an ornamental canal) ---
  {
    const dm = D('bridge', 27);
    const f = ctx.frameAt(dm);
    const water = ctx.mat('#5ab4f0', { emissive: '#2f86d0', emissiveIntensity: 0.25, opacity: 0.92 });
    const rim = ctx.mat(STONE_D, { toon: true });
    const M = merger(ctx);
    const ponds = [];
    for (const side of [-1, 1]) {
      const R = 17;
      const dist = f.halfWidth + f.offL + R + 5;
      const x = f.pos.x + f.rightH.x * dist * side;
      const z = f.pos.z + f.rightH.z * dist * side;
      let y = Infinity;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        y = Math.min(y, gy(x + Math.cos(a) * R, z + Math.sin(a) * R, 0));
      }
      y = Math.min(y, gy(x, z, 0));
      ponds.push({ x, z, y, R });
      M.add(new THREE.CircleGeometry(R, 40), water, { p: [x, y + 0.45, z], r: [-Math.PI / 2, 0, 0], shadow: false });
      M.add(new THREE.TorusGeometry(R, 0.6, 6, 40), rim, { p: [x, y + 0.45, z], r: [Math.PI / 2, 0, 0] });
      M.add(new THREE.CylinderGeometry(R + 0.4, R + 0.4, 3, 40, 1, true), rim, { p: [x, y - 1.1, z] });
      // lily pads
      for (let k = 0; k < 10; k++) {
        const a = rng() * Math.PI * 2;
        const rr = 4 + rng() * (R - 6);
        M.add(new THREE.CircleGeometry(0.8 + rng() * 0.5, 8, 0.4, Math.PI * 1.8), ctx.mat('#4caf50', { toon: true }), { p: [x + Math.cos(a) * rr, y + 0.5, z + Math.sin(a) * rr], r: [-Math.PI / 2, 0, rng() * 6], shadow: false });
        if (k % 3 === 0) M.add(new THREE.IcosahedronGeometry(0.28, 0), ctx.mat(PINK, { toon: true }), { p: [x + Math.cos(a) * rr, y + 0.7, z + Math.sin(a) * rr], shadow: false });
      }
      ctx.reserve(x, z, R + 1);
      // bridge facade: stone arches on the embankment facing the pond
      const fx = f.pos.x + f.rightH.x * (f.halfWidth + f.offL + 1.2) * side;
      const fz = f.pos.z + f.rightH.z * (f.halfWidth + f.offL + 1.2) * side;
      const baseY = y + 0.4;
      const topY = f.pos.y;
      const h = Math.max(2, topY - baseY);
      const yaw = f.yaw;
      const along = [Math.sin(yaw), Math.cos(yaw)];
      const wallLen = 60;
      const wgeo = new THREE.BoxGeometry(wallLen, h + 1.2, 1.6);
      M.add(wgeo, rim, { p: [fx, baseY + (h + 1.2) / 2 - 0.6, fz], r: [0, yaw + Math.PI / 2, 0] });
      for (let k = -2; k <= 2; k++) {
        const ax = fx + along[0] * k * 11 + f.rightH.x * side * 0.9;
        const az = fz + along[1] * k * 11 + f.rightH.z * side * 0.9;
        M.add(gothic(THREE, 6, Math.max(0.5, h - 4.6)), ctx.mat('#2a4f6e', { toon: true, side: THREE.DoubleSide }), { p: [ax, baseY, az], r: [0, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), 0], shadow: false });
      }
      // balustrade cap
      M.add(new THREE.BoxGeometry(wallLen + 1, 0.5, 2.2), ctx.mat(STONE, { toon: true }), { p: [fx, topY + 0.85, fz], r: [0, yaw + Math.PI / 2, 0] });
    }
    ctx.group.add(M.build('pond'));
    // swans: two white birds bobbing on each pond
    const swanM = merger(ctx);
    const white = ctx.mat('#ffffff', { toon: true });
    const beak = ctx.mat('#ff9a3c', { toon: true });
    swanM.add(new THREE.SphereGeometry(0.7, 10, 8), white, { p: [0, 0.35, 0], s: [0.8, 0.6, 1.3] });
    swanM.add(new THREE.CylinderGeometry(0.12, 0.16, 1.1, 6), white, { p: [0, 0.95, 0.55], r: [0.25, 0, 0] });
    swanM.add(new THREE.SphereGeometry(0.2, 8, 6), white, { p: [0, 1.5, 0.7] });
    swanM.add(new THREE.ConeGeometry(0.08, 0.3, 5), beak, { p: [0, 1.48, 0.95], r: [Math.PI / 2, 0, 0] });
    const swanProto = swanM.build('swan');
    const swans = [];
    for (const p of ponds) {
      for (let k = 0; k < 2; k++) {
        const s = swanProto.clone();
        s.position.set(p.x, p.y + 0.4, p.z);
        ctx.group.add(s);
        swans.push({ s, p, ph: k * Math.PI + rng() });
      }
    }
    ctx.addAnimated((dt, time) => {
      for (const w of swans) {
        const a = time * 0.12 + w.ph;
        const r = w.p.R * 0.55;
        w.s.position.x = w.p.x + Math.cos(a) * r;
        w.s.position.z = w.p.z + Math.sin(a) * r;
        w.s.position.y = w.p.y + 0.45 + Math.sin(time * 2 + w.ph) * 0.05;
        w.s.rotation.y = -a;
      }
    });
  }

  // --- Hedge maze in the infield ---
  {
    const cols = hi ? 9 : 7;
    const rows = hi ? 7 : 5;
    const cell = 7;
    const ox = 70 - (cols * cell) / 2;
    const oz = 100 - (rows * cell) / 2;
    const segs = mazeSegments(rng, cols, rows);
    const hedgeBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ctx.mat(HEDGE, { toon: true }));
    const T0 = [];
    for (const s of segs) {
      const x = ox + s.x * cell;
      const z = oz + s.z * cell;
      T0.push({ x, y: gy(x, z) + 1.2, z, rotY: s.horiz ? 0 : Math.PI / 2, scale: [cell + 1.4, 3.2, 1.6] });
    }
    ctx.instanced(hedgeBox, T0, { brightness: 0.05 });
    ctx.reserve(70, 100, 36);
    const cf = ctx.props.create('fountain', { scale: 0.9 });
    const mx = ox + (Math.floor(cols / 2) + 0.5) * cell;
    const mz = oz + (Math.floor(rows / 2) + 0.5) * cell;
    cf.position.set(mx, gy(mx, mz), mz);
    ctx.group.add(cf);
  }

  // --- Rose gardens: flower beds along the start straight and the S-bends ---
  {
    const beds = [];
    const push = (d, lat, rot = 0) => {
      const p = at(d, lat);
      if (ctx.isClear(p.x, p.z, 1.9)) beds.push({ x: p.x, y: p.y, z: p.z, rotY: p.yaw + rot });
    };
    for (let d = D('start', 20); d < D('start', 160); d += 8) {
      push(d, -27.5);
      push(d, 27.5);
    }
    for (let d = D('s1', 5); d < D('crest', 0); d += 7) {
      push(d, -19);
      push(d, 19);
    }
    ctx.instanced('flowerBed', beds.filter((_, i) => i % 2 === 0), { color: ROSE, color2: STONE_D });
    ctx.instanced('flowerBed', beds.filter((_, i) => i % 2 === 1), { color: PINK, color2: STONE_D });
  }

  // --- Trinity banners + signs ---
  {
    const bannersA = [];
    const bannersB = [];
    let i = 0;
    for (let d = D('t6', 20); ; d += 20) {
      const dd = ((d % LEN) + LEN) % LEN;
      if (i > 0 && dd > D('start', 145) && dd < D('t6', 0)) break;
      if (i > 12) break;
      for (const lat of [-22.5, 22.5]) {
        const p = at(dd, lat);
        (i % 2 ? bannersB : bannersA).push({ x: p.x, y: p.y, z: p.z, rotY: p.yaw + (lat > 0 ? Math.PI / 2 : -Math.PI / 2) });
      }
      i++;
    }
    ctx.instanced(ctx.props.create('banner', { text: 'TRINITY', color: '#3f6fd8' }), bannersA);
    ctx.instanced(ctx.props.create('banner', { text: 'TEA PARTY', color: '#ff7aa8' }), bannersB);
    const signs = [
      ['climb', 5, 16, 'SISTERHOOD HILL'],
      ['t3', 10, -16, 'JUSTICE BRIDGE'],
      ['west', 5, 18, 'CATHEDRAL RISE'],
    ];
    for (const [mk, off, lat, text] of signs) {
      const s = ctx.props.create('sign', { variant: 'text', text });
      ctx.place(s, { d: D(mk, off), lateral: lat, yaw: lat > 0 ? Math.PI - 0.6 : -Math.PI + 0.6, ground: true });
    }
  }

  // --- Colonnade on Cathedral Rise (white columns with gold rings) ---
  {
    const cols = [];
    for (let d = D('west', 4); d < D('t5', 0); d += 9) {
      for (const lat of [-21.5, 21.5]) {
        const p = at(d, lat);
        if (ctx.isClear(p.x, p.z, 0.6)) cols.push({ x: p.x, y: Math.max(p.y, ctx.pointAt(d, 0).y - 0.8), z: p.z, rotY: 0 });
      }
    }
    ctx.instanced('pillar', cols, { color: STONE, color2: GOLD });
  }

  // --- Distant Trinity campus: a few white halls with blue roofs on the horizon ---
  {
    const M = merger(ctx);
    const wall = ctx.mat(STONE, { toon: true });
    const roofM = ctx.mat(ROOF, { toon: true });
    const win = ctx.mat('#8fb6e8', { toon: true });
    M.add(new THREE.BoxGeometry(40, 14, 16), wall, { p: [0, 5, 0] });
    M.add(prism(THREE, 17, 7, 41), roofM, { p: [0, 12, 20.5], r: [0, 0, 0] });
    for (let x = -17; x <= 17; x += 4.2) for (const y of [4, 8.5]) M.add(new THREE.BoxGeometry(1.8, 2.6, 0.3), win, { p: [x, y, 8.1], shadow: false });
    M.add(new THREE.BoxGeometry(8, 26, 8), wall, { p: [14, 11, 0] });
    M.add(new THREE.ConeGeometry(6, 12, 4), roofM, { p: [14, 30, 0], r: [0, Math.PI / 4, 0] });
    const hall = M.build('hall');
    const halls = [];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rng() * 0.2;
      const r = 330 + rng() * 120;
      const x = ctx.center.x + Math.cos(a) * r;
      const z = ctx.center.z + Math.sin(a) * r;
      if (!ctx.isClear(x, z, 30)) continue;
      halls.push({ x, y: gy(x, z) - 1.5, z, rotY: Math.atan2(-Math.cos(a), -Math.sin(a)), scale: 1.1 + rng() * 0.5 });
    }
    ctx.instanced(hall, halls, { castShadow: false });
  }
}

export default {
  id: 'trinity-garden',
  name: 'Trinity Garden Speedway',
  laps: 3,
  width: 22,
  offroad: 7,
  wall: true,
  points: LAYOUT.pts,
  features: [
    // start straight
    { type: 'itemRow', t: T('start', 105), count: 5, spacing: 4.4 },
    { type: 'coins', t: T('t1', 52), count: 5, spacing: 4.5, lateral: 8.5 }, // tight inside of the Rose Window sweeper
    // Sisterhood Hill
    { type: 'boost', t: T('climb', 18), lateral: -4, length: 8, width: 5 },
    { type: 'itemRow', t: T('s1', 16), count: 4, spacing: 4.2 },
    { type: 'coins', t: T('s2', 10), count: 4, spacing: 4, lateral: -6.5 },
    // crest jump into the drop
    { type: 'ramp', t: T('crest', 16), lateral: 0, length: 10, width: 13, power: 1.1 },
    { type: 'coins', t: T('drop', 8), count: 4, spacing: 4.5, lateral: 0 },
    // Tea Party hairpin: inside line rewards the brave
    { type: 'coins', t: T('hairpin', 40), count: 5, spacing: 4.5, lateral: 7.5 },
    { type: 'boost', t: T('back', 12), lateral: 3, length: 8, width: 5 },
    { type: 'itemRow', t: T('back', 36), count: 4, spacing: 4.4 },
    // Justice Bridge + Fountain Court
    { type: 'coins', t: T('bridge', 8), count: 6, spacing: 4.2, lateral: -8 },
    { type: 'hazard', t: T('esses2', 0), lateral: 0, kind: 'fountain', radius: 2.4, effect: 'bump' },
    { type: 'hazard', t: T('west', 30), lateral: -6.5, kind: 'bush', radius: 1.3, effect: 'bump' },
    { type: 'hazard', t: T('west', 48), lateral: 6.5, kind: 'bush', radius: 1.3, effect: 'bump' },
    // Cathedral Rise
    { type: 'itemRow', t: T('west', 14), count: 5, spacing: 4.2 },
    { type: 'boost', t: T('west', 62), lateral: 0, length: 8, width: 5 },
    { type: 'slow', t: T('t5', 44), lateral: 9.5, length: 16, width: 6 },
    { type: 'coins', t: T('t5', 40), count: 4, spacing: 4.5, lateral: 7 },
    { type: 'boost', t: T('descent', 14), lateral: -4, length: 8, width: 5 },
  ],
  decorations: [
    { kind: 'tree', count: 200, side: 'both', minOffset: 4, maxOffset: 120, scale: [1.0, 1.8], seed: 3, color: '#4aa83f' },
    { kind: 'bush', count: 50, side: 'both', minOffset: 1, maxOffset: 18, scale: [0.9, 1.5], seed: 5, color: '#3f9a3c', color2: ROSE },
    { kind: 'flowerBed', count: 26, side: 'both', minOffset: 2, maxOffset: 22, seed: 6, color: '#ffd23f' },
    { kind: 'lamp', every: 34, side: 'both', offset: 1.4, tRange: [T('west', 0), T('t1', 30)] },
    { kind: 'lamp', every: 40, side: 'both', offset: 1.4, tRange: [T('back', 0), T('esses2', 60)] },
    { kind: 'bench', count: 10, side: 'both', minOffset: 2, maxOffset: 8, seed: 8, face: 'road' },
    { kind: 'cloud', count: 14, side: 'both', minOffset: 60, maxOffset: 260, scale: [1.2, 2.4], seed: 9, y: [45, 80] },
  ],
  theme: {
    preset: 'garden',
    sky: { top: '#3c8cff', bottom: '#d6ecff', horizon: '#fff8ea', clouds: true, sunDisc: true },
    fog: { color: '#e6f3ff', near: 220, far: 950 },
    sun: { color: '#fff6e6', intensity: 2.5, dir: [0.35, 1.0, -0.45] },
    ambient: { sky: '#dcefff', ground: '#78a456', intensity: 1.12 },
    ground: { type: 'grass', color: '#7cc85a', color2: '#62ad45' },
    road: { style: 'stone', color: '#d2cbbf', color2: '#b9b1a3', lines: false },
    edge: { style: 'line', colorA: '#ffffff', colorB: '#f0c75a' },
    offroad: { type: 'flowers', color: '#80cc5e' },
    wall: { style: 'hedge', color: HEDGE, color2: '#2f7f30' },
    particles: 'petals',
    music: 'trinity',
  },
  scenery,
};
