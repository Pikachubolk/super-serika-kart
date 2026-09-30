// Millennium Cyber Loop (owner: tracks-B) — Credit Cup race 4 (cup finale: technical and fast).
// Night-time Millennium Science School campus: Neon Boulevard, data-stream chicane, a 450-degree helix climb
// under a giant hologram pixel sword, the skybridge over the boulevard, a platform jump and a fast dive home.
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
      const { len: len0, arc, r, step = 30, n: nn, y: yEnd, mark, lin, ...attrs } = c;
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
        const e = lin ? u : u * u * (3 - 2 * u);
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

// ---- palette ---------------------------------------------------------------------------------------------------
const CYAN = '#39d0ff';
const MAGENTA = '#ff4fd8';
const VIOLET = '#8a5cff';
const GOLDN = '#ffd23f';
const DARK = '#141828';

function canvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function tex(THREE, c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// glass-tower window grid (lit windows in cyan / violet / white)
function windowGrid(THREE, seed) {
  const c = canvas(128, 256);
  if (!c) return null;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1024';
  g.fillRect(0, 0, 128, 256);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cols = ['#39d0ff', '#8a5cff', '#e8f6ff', '#ff4fd8', '#1d3a6e'];
  for (let y = 4; y < 256; y += 12) {
    for (let x = 4; x < 128; x += 10) {
      const r = rnd();
      g.fillStyle = r < 0.6 ? '#131d3a' : cols[(rnd() * (r < 0.85 ? 3 : 5)) | 0];
      g.fillRect(x, y, 7, 8);
    }
  }
  // vertical mullion light strips
  g.fillStyle = 'rgba(57,208,255,0.55)';
  g.fillRect(0, 0, 2, 256);
  g.fillRect(126, 0, 2, 256);
  return tex(THREE, c, true);
}

// scrolling data-stream texture (binary rain)
function dataStream(THREE) {
  const c = canvas(64, 256);
  if (!c) return null;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 256);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let x = 2; x < 64; x += 8) {
    for (let y = 0; y < 256; y += 10) {
      if (rnd() < 0.45) continue;
      const a = 0.35 + rnd() * 0.65;
      g.fillStyle = rnd() < 0.8 ? `rgba(90,220,255,${a})` : `rgba(255,120,230,${a})`;
      g.fillRect(x, y, 4, rnd() < 0.5 ? 6 : 3);
    }
  }
  return tex(THREE, c, true);
}

// pixel-art sign: text rendered small, then scaled up without smoothing
function pixelSign(THREE, lines, { w = 512, h = 256, color = '#7df9ff', color2 = '#ff6ad5', bg = 'rgba(10,14,40,0.82)', icon = true } = {}) {
  const c = canvas(w, h);
  if (!c) return null;
  const g = c.getContext('2d');
  const sw = w / 4;
  const sh = h / 4;
  const small = canvas(sw, sh);
  const s = small.getContext('2d');
  s.clearRect(0, 0, sw, sh);
  s.textAlign = 'center';
  s.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((line, i) => {
    s.font = `bold ${i === 0 ? 14 : 9}px monospace`;
    s.fillStyle = i === 0 ? color : color2;
    s.fillText(line, sw / 2 + (icon ? 8 : 0), sh * ((i + 1) / (n + 1)) + (i === 0 ? -2 : 2));
  });
  if (icon) {
    // tiny pixel game controller
    const px = [
      '.XXXXXXX.',
      'XX.XXXOXX',
      'X...XXXXX',
      'XX.XXOXOX',
      'XXXXXXXXX',
      'XX.....XX',
    ];
    px.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      s.fillStyle = ch === 'O' ? color2 : color;
      s.fillRect(6 + x, sh / 2 - 3 + y, 1, 1);
    }));
  }
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, w, h);
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.strokeRect(6, 6, w - 12, h - 12);
  // scanlines
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  return tex(THREE, c);
}

const SWORD = [
  '....W....',
  '...WCW...',
  '...WCW...',
  '...WCW...',
  '...WCW...',
  '...WCW...',
  '...WCW...',
  '...WCW...',
  '...WCW...',
  '...WCW...',
  '...WCW...',
  '..GGGGG..',
  'GGGMGMGGG',
  '.G..H..G.',
  '....H....',
  '....H....',
  '...GGG...',
];

function buildSword(ctx) {
  const { THREE } = ctx;
  const M = merger(ctx);
  const mats = {
    W: ctx.mat('#e8fbff', { emissive: '#bff3ff', emissiveIntensity: 1.3 }),
    C: ctx.mat(CYAN, { emissive: CYAN, emissiveIntensity: 1.5 }),
    G: ctx.mat(GOLDN, { emissive: '#ffb020', emissiveIntensity: 1.1 }),
    M: ctx.mat(MAGENTA, { emissive: MAGENTA, emissiveIntensity: 1.6 }),
    H: ctx.mat(VIOLET, { emissive: VIOLET, emissiveIntensity: 1.2 }),
  };
  const vox = 3;
  const rows = SWORD.length;
  SWORD.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!mats[ch]) return;
    M.add(new THREE.BoxGeometry(vox * 0.94, vox * 0.94, vox * 0.94), mats[ch], { p: [(x - 4) * vox, (rows - y) * vox, 0], shadow: false });
  }));
  const sword = M.build('pixelSword');
  sword.rotation.z = Math.PI; // blade pointing down (hovering "stuck" in the air)
  const holder = new THREE.Group();
  holder.add(sword);
  sword.position.y = (rows + 1) * vox;
  // glowing rings
  const ringMat = ctx.mat(CYAN, { additive: true, opacity: 0.8, emissive: CYAN, emissiveIntensity: 1 });
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(11, 0.35, 6, 48), ringMat);
  r1.rotation.x = Math.PI / 2;
  r1.position.y = 3;
  const r2 = new THREE.Mesh(new THREE.TorusGeometry(7, 0.25, 6, 40), ctx.mat(MAGENTA, { additive: true, opacity: 0.8 }));
  r2.rotation.x = Math.PI / 2;
  r2.position.y = 9;
  holder.add(r1, r2);
  return { holder, sword, r1, r2 };
}

function towerObject(ctx, texA, variant) {
  const { THREE } = ctx;
  const M = merger(ctx);
  const glass = ctx.mat('#ffffff', texA ? { map: texA, emissiveMap: texA, emissive: '#ffffff', emissiveIntensity: 0.85 } : { emissive: '#223366' });
  const frame = ctx.mat('#1a1f33', { toon: true });
  const neon = ctx.mat(variant ? MAGENTA : CYAN, { emissive: variant ? MAGENTA : CYAN, emissiveIntensity: 1.6 });
  // unit tower: 1 x 1 footprint, 1 tall (scaled per instance); textures repeat by UV scale below
  const body = new THREE.BoxGeometry(1, 1, 1);
  const uv = body.attributes.uv;
  const nrm = body.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, 0.5, 0.995); // roofs: dark
    else uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * 3);
  }
  M.add(body, glass, { p: [0, 0.5, 0], shadow: false });
  for (const [x, z, w, d] of [[0, -0.5, 1.04, 0.03], [0, 0.5, 1.04, 0.03], [-0.5, 0, 0.03, 1.04], [0.5, 0, 0.03, 1.04]]) {
    M.add(new THREE.BoxGeometry(w, 0.012, d), neon, { p: [x, 1.0, z], shadow: false });
  }
  M.add(new THREE.BoxGeometry(1.06, 0.02, 1.06), frame, { p: [0, 0.01, 0], shadow: false });
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) M.add(new THREE.BoxGeometry(0.04, 1, 0.04), neon, { p: [x, 0.5, z], shadow: false });
  if (variant) {
    M.add(new THREE.BoxGeometry(0.6, 0.12, 0.6), glass, { p: [0, 1.06, 0], shadow: false });
    M.add(new THREE.CylinderGeometry(0.01, 0.02, 0.25, 4), neon, { p: [0, 1.24, 0], shadow: false });
  }
  return M.build('tower');
}

function scenery(ctx) {
  const { THREE } = ctx;
  const rng = ctx.rng;
  const hi = ctx.quality !== 'low';
  const gy = (x, z, fb = 0) => {
    const g = ctx.groundAt(x, z);
    return g === null || g === undefined ? fb : g;
  };
  const at = (d, lat) => {
    const p = ctx.pointAt(d, lat);
    return { x: p.x, z: p.z, y: p.y, yaw: ctx.frameAt(d).yaw };
  };
  const anim = [];
  ctx.addAnimated((dt, time) => {
    for (const fn of anim) fn(dt, time);
  });

  // --- Giant hologram pixel sword hovering over the helix ---
  {
    const f = ctx.frameAt(D('helix', 0));
    const cx = f.pos.x + f.rightH.x * 38;
    const cz = f.pos.z + f.rightH.z * 38;
    const { holder, sword, r1, r2 } = buildSword(ctx);
    holder.position.set(cx, 40, cz);
    ctx.group.add(holder);
    // projector column in the helix centre
    const M = merger(ctx);
    const g0 = gy(cx, cz, 0);
    M.add(new THREE.CylinderGeometry(5, 7, 4, 24), ctx.mat('#1c2033', { toon: true }), { p: [cx, g0 + 2, cz] });
    M.add(new THREE.TorusGeometry(5.2, 0.3, 6, 32), ctx.mat(CYAN, { emissive: CYAN, emissiveIntensity: 1.8 }), { p: [cx, g0 + 4, cz], r: [Math.PI / 2, 0, 0], shadow: false });
    M.add(new THREE.CylinderGeometry(3, 5, 40 - g0 - 4, 24, 1, true), ctx.mat(CYAN, { additive: true, opacity: 0.12, side: THREE.DoubleSide }), { p: [cx, (40 + g0 + 4) / 2, cz], shadow: false });
    ctx.group.add(M.build('projector'));
    ctx.reserve(cx, cz, 14);
    anim.push((dt, time) => {
      holder.rotation.y = time * 0.45;
      holder.position.y = 40 + Math.sin(time * 0.9) * 1.5;
      r1.rotation.z = time * 0.8;
      r2.rotation.z = -time * 1.3;
      r1.scale.setScalar(1 + Math.sin(time * 2) * 0.05);
    });
  }

  // --- Glass towers (instanced; two variants) ---
  {
    const texA = windowGrid(THREE, 11);
    const texB = windowGrid(THREE, 29);
    const A = [];
    const B = [];
    const b = ctx.bounds;
    let tries = 0;
    const want = hi ? 90 : 55;
    while (A.length + B.length < want && tries++ < 1500) {
      const x = b.min.x - 220 + rng() * (b.max.x - b.min.x + 440);
      const z = b.min.z - 220 + rng() * (b.max.z - b.min.z + 440);
      const w = 12 + rng() * 12;
      if (!ctx.isClear(x, z, w * 0.75 + 14)) continue;
      const dc = Math.hypot(x - ctx.center.x, z - ctx.center.z);
      const h = 30 + rng() * 60 + Math.min(80, dc * 0.12);
      const t = { x, y: gy(x, z) - 0.5, z, rotY: ((rng() * 4) | 0) * (Math.PI / 2) + (rng() < 0.3 ? Math.PI / 4 : 0), scale: [w, h, w * (0.7 + rng() * 0.6)] };
      (rng() < 0.5 ? A : B).push(t);
      ctx.reserve(x, z, w * 0.75);
    }
    ctx.instanced(towerObject(ctx, texA, 0), A, { castShadow: false, brightness: 0.12, chunk: 4000 });
    ctx.instanced(towerObject(ctx, texB, 1), B, { castShadow: false, brightness: 0.12, chunk: 4000 });
  }

  // --- Data-stream light pillars (scrolling binary rain) ---
  {
    const t = dataStream(THREE);
    const mat = ctx.mat(CYAN, t ? { map: t, additive: true, opacity: 0.9, side: THREE.DoubleSide } : { additive: true, opacity: 0.4 });
    const core = ctx.mat('#bff3ff', { additive: true, opacity: 0.35 });
    const M = merger(ctx);
    const spots = [
      ['start', 60, -34], ['start', 140, 34], ['t1', 40, -30], ['south', 30, -26], ['chic2', 10, 26], ['t2', 40, -28],
      ['sky', 60, -26], ['sky', 190, 26], ['platA', 20, -26], ['gap', 30, 24], ['descent', 30, 26], ['dive', 10, 28],
      ['home', 20, -34],
    ];
    for (const [mk, off, lat] of spots) {
      const p = at(D(mk, off), lat);
      if (!ctx.isClear(p.x, p.z, 3)) continue;
      const g0 = gy(p.x, p.z, p.y);
      const H = 110;
      const geo = new THREE.CylinderGeometry(2.2, 2.2, H, 10, 1, true);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 5);
      M.add(geo, mat, { p: [p.x, g0 + H / 2, p.z], shadow: false });
      M.add(new THREE.CylinderGeometry(0.5, 0.5, H, 6, 1, true), core, { p: [p.x, g0 + H / 2, p.z], shadow: false });
      M.add(new THREE.CylinderGeometry(3, 3.6, 1.6, 12), ctx.mat('#1c2033', { toon: true }), { p: [p.x, g0 + 0.8, p.z] });
      M.add(new THREE.TorusGeometry(3, 0.22, 6, 20), ctx.mat(MAGENTA, { emissive: MAGENTA, emissiveIntensity: 2 }), { p: [p.x, g0 + 1.7, p.z], r: [Math.PI / 2, 0, 0], shadow: false });
      ctx.reserve(p.x, p.z, 4);
    }
    ctx.group.add(M.build('dataPillars'));
    if (t) anim.push((dt) => { t.offset.y -= dt * 0.35; });
  }

  // --- Neon gates spanning the road (start straight, skybridge, landing) ---
  {
    const M = merger(ctx);
    const post = ctx.mat('#1a1f33', { toon: true });
    const nc = ctx.mat(CYAN, { emissive: CYAN, emissiveIntensity: 2 });
    const nm = ctx.mat(MAGENTA, { emissive: MAGENTA, emissiveIntensity: 2 });
    const gate = (d, k) => {
      const f = ctx.frameAt(d);
      const half = f.halfWidth + Math.max(f.offL, f.offR) + 1.6;
      const H = 9;
      const neon = k % 2 ? nm : nc;
      const yaw = f.yaw;
      for (const s of [-1, 1]) {
        const x = f.pos.x + f.rightH.x * half * s;
        const z = f.pos.z + f.rightH.z * half * s;
        const y0 = f.pos.y + half * s * f.slope - 0.2;
        M.add(new THREE.BoxGeometry(1.2, H, 1.2), post, { p: [x, y0 + H / 2, z], r: [0, yaw, 0] });
        M.add(new THREE.BoxGeometry(0.3, H - 1, 0.3), neon, { p: [x - f.rightH.x * s * 0.62, y0 + H / 2, z - f.rightH.z * s * 0.62], r: [0, yaw, 0], shadow: false });
      }
      const y = f.pos.y + H;
      M.add(new THREE.BoxGeometry(half * 2 + 1.2, 1.2, 1.2), post, { p: [f.pos.x, y, f.pos.z], r: [0, yaw, 0] });
      M.add(new THREE.BoxGeometry(half * 2 - 0.4, 0.3, 0.3), neon, { p: [f.pos.x, y - 0.75, f.pos.z], r: [0, yaw, 0], shadow: false });
    };
    let k = 0;
    for (let d = D('start', 40); d < D('start', 180); d += 35) gate(d, k++);
    for (let d = D('sky', 20); d < D('sky', 230); d += 30) gate(d, k++);
    for (let d = D('descent', 10); d < D('descent', 70); d += 30) gate(d, k++);
    gate(D('helixIn', 12), k++);
    ctx.group.add(M.build('gates'));
  }

  // --- Holographic signs ---
  {
    const signs = [
      { lines: ['GAME DEV', 'DEPARTMENT'], mk: 'start', off: 120, lat: -32, w: 26, h: 13, y: 14, c1: '#7df9ff', c2: '#ff6ad5' },
      { lines: ['MILLENNIUM', 'SCIENCE SCHOOL'], mk: 't2', off: 30, lat: -30, w: 28, h: 14, y: 12, c1: '#9fb8ff', c2: '#7df9ff', icon: false },
      { lines: ['LEVEL UP!', 'PRESS BOOST'], mk: 'platA', off: 10, lat: 22, w: 18, h: 9, y: 8, c1: '#ffd23f', c2: '#7df9ff' },
      { lines: ['VERITAS', 'SERVER FARM'], mk: 'dive', off: 0, lat: 30, w: 20, h: 10, y: 10, c1: '#8aff9a', c2: '#39d0ff', icon: false },
    ];
    const frame = ctx.mat('#1a1f33', { toon: true });
    for (const s of signs) {
      const t = pixelSign(THREE, s.lines, { color: s.c1, color2: s.c2, icon: s.icon !== false });
      const grp = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), ctx.mat('#ffffff', t ? { map: t, additive: true, opacity: 0.95, side: THREE.DoubleSide } : { emissive: CYAN }));
      panel.position.y = s.y + s.h / 2;
      grp.add(panel);
      const M = merger(ctx);
      M.add(new THREE.BoxGeometry(0.8, s.y + 0.5, 0.8), frame, { p: [-s.w * 0.3, (s.y + 0.5) / 2, -0.3] });
      M.add(new THREE.BoxGeometry(0.8, s.y + 0.5, 0.8), frame, { p: [s.w * 0.3, (s.y + 0.5) / 2, -0.3] });
      M.add(new THREE.BoxGeometry(s.w * 0.8, 0.6, 1.4), ctx.mat(s.c1, { emissive: s.c1, emissiveIntensity: 1.5 }), { p: [0, s.y, 0], shadow: false });
      grp.add(M.build('signFrame'));
      ctx.place(grp, { d: D(s.mk, s.off), lateral: s.lat, yaw: s.lat > 0 ? Math.PI / 2 + 0.5 : -Math.PI / 2 - 0.5, ground: true });
      const ph = rng() * 6;
      anim.push((dt, time) => {
        panel.material.opacity = 0.85 + Math.sin(time * 7 + ph) * 0.05 + (Math.sin(time * 23 + ph) > 0.97 ? -0.3 : 0);
      });
    }
  }

  // --- Security drones sweeping across the skybridge (moving hazards) ---
  {
    const M = merger(ctx);
    M.add(new THREE.OctahedronGeometry(1.2, 0), ctx.mat('#20263d', { toon: true }), { p: [0, 0, 0] });
    M.add(new THREE.TorusGeometry(1.5, 0.12, 6, 20), ctx.mat('#ff3b5c', { emissive: '#ff3b5c', emissiveIntensity: 2 }), { p: [0, 0, 0], r: [Math.PI / 2, 0, 0], shadow: false });
    M.add(new THREE.SphereGeometry(0.45, 10, 8), ctx.mat('#ff3b5c', { emissive: '#ff3b5c', emissiveIntensity: 2.5 }), { p: [0, 0, 0.95], shadow: false });
    const proto = M.build('drone');
    for (const [off, ph] of [[110, 0], [175, Math.PI]]) {
      const d = D('sky', off);
      const obj = proto.clone();
      const f = ctx.frameAt(d);
      const hz = ctx.addHazard({ position: f.pos.clone(), radius: 1.5, kind: 'drone', effect: 'spin', object3d: obj, moving: true });
      ctx.group.add(obj);
      const base = f.pos.clone();
      const right = f.rightH.clone();
      const amp = f.halfWidth - 2.5;
      anim.push((dt, time) => {
        const lat = Math.sin(time * 1.1 + ph) * amp;
        obj.position.set(base.x + right.x * lat, base.y + 1.3 + Math.sin(time * 4 + ph) * 0.2, base.z + right.z * lat);
        obj.rotation.y = time * 2;
        hz.position.copy(obj.position);
        hz.position.y = base.y + 0.5;
      });
    }
  }

  // --- Distant Millennium skyline (tall buildings with lit windows) ---
  {
    const far = [];
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2 + rng() * 0.15;
      const r = 480 + rng() * 150;
      const x = ctx.center.x + Math.cos(a) * r;
      const z = ctx.center.z + Math.sin(a) * r;
      far.push({ x, y: gy(x, z) - 1, z, rotY: rng() * 3, scale: 2.2 + rng() * 1.8 });
    }
    ctx.instanced('building', far, { variant: 'tall', color: '#2a3152', color2: '#39d0ff', castShadow: false, chunk: 4000 });
  }
}
const LAYOUT = turtle(
  { x: 0, z: 0, y: 0, yaw: Math.PI / 2, attrs: { w: 26, off: 3 } },
  [
    // Neon Boulevard: start straight east (grid behind the line)
    { len: 190, n: 2, w: 26, off: 3, mark: 'start' },
    // T1 "Kernel" right-hander
    { arc: 90, r: 46, y: 1, w: 23, bank: 8, off: 3, step: 45, mark: 't1' },
    { len: 50, y: 2, w: 22, off: 3, mark: 'south' },
    // data-stream chicane
    { arc: -40, r: 48, y: 2, w: 20, bank: -6, off: 2, n: 2, mark: 'chic' },
    { arc: 40, r: 48, y: 2, w: 20, bank: 6, off: 2, n: 2, mark: 'chic2' },
    // T2 onto the helix approach
    { arc: 90, r: 42, y: 3, w: 21, bank: 7, off: 2, mark: 't2' },
    { len: 24, n: 1, y: 3, w: 21, off: 2, mark: 'helixIn' },
    // Spiral climb: 450 deg right-hand helix
    { arc: 450, r: 38, y: 29, w: 19, bank: 7, off: 2, step: 45, mark: 'helix' },
    // Skybridge north over Neon Boulevard
    { len: 'A', n: 2, y: 29, w: 20, off: 2, lin: true, mark: 'sky' },
    { arc: -90, r: 44, y: 27, w: 20, bank: -7, off: 2, step: 45, mark: 't4' },
    // launch platform -> gap dip -> landing platform
    { len: 56, n: 1, y: 26, w: 20, off: 2, lin: true, mark: 'platA' },
    { len: 50, n: 1, y: 19, w: 18, off: 1, lin: true, mark: 'gap' },
    { len: 20, n: 1, y: 20, w: 18, off: 1, lin: true, mark: 'gapUp' },
    { len: 'B', n: 1, y: 12, w: 21, off: 2, mark: 'descent' },
    { arc: -90, r: 44, y: 5, w: 21, bank: -8, off: 3, step: 45, mark: 't5' },
    { len: 24, n: 1, y: 1.5, w: 22, off: 3, lin: true, mark: 'dive' },
    { arc: -90, r: 50, y: 0, w: 24, bank: -7, off: 3, mark: 't6' },
    { len: 40, n: 1, y: 0, w: 26, off: 3, mark: 'home' },
  ],
  { x: -40, z: 0 },
);
export const MARKS = LAYOUT.marks;
export const SOLVED = LAYOUT.solved;
const LEN = LAYOUT.dist;
const D = (mark, off = 0) => ((((MARKS[mark] + off) % LEN) + LEN) % LEN);
const T = (mark, off = 0) => D(mark, off) / LEN;

export default {
  id: 'millennium-cyber',
  name: 'Millennium Cyber Loop',
  laps: 3,
  width: 22,
  offroad: 3,
  wall: true,
  points: LAYOUT.pts,
  features: [
    // Neon Boulevard
    { type: 'itemRow', t: T('start', 105), count: 5, spacing: 4.6 },
    { type: 'boost', t: T('start', 150), lateral: -5, length: 8, width: 5 },
    { type: 'coins', t: T('t1', 30), count: 5, spacing: 4.5, lateral: 8 },
    // south run + chicane
    { type: 'boost', t: T('south', 14), lateral: 4, length: 8, width: 5 },
    { type: 'itemRow', t: T('south', 38), count: 4, spacing: 4.4 },
    { type: 'coins', t: T('chic', 20), count: 4, spacing: 4, lateral: -6.5 },
    { type: 'hazard', t: T('chic2', 8), lateral: 6.5, kind: 'crystal', radius: 1.2, effect: 'bump' },
    // helix: dash panels on the inside line
    { type: 'boost', t: T('helix', 70), lateral: 4, length: 8, width: 5 },
    { type: 'coins', t: T('helix', 140), count: 5, spacing: 4.5, lateral: 6 },
    { type: 'boost', t: T('helix', 215), lateral: 4, length: 8, width: 5 },
    // skybridge
    { type: 'boost', t: T('sky', 30), lateral: 0, length: 8, width: 6 },
    { type: 'itemRow', t: T('sky', 75), count: 5, spacing: 3.8 },
    { type: 'coins', t: T('sky', 140), count: 6, spacing: 4.5, lateral: -7.5 },
    { type: 'boost', t: T('sky', 205), lateral: 3, length: 8, width: 5 },
    // platform jump: boost + ramp clears the gap onto the landing platform
    { type: 'boost', t: T('platA', 26), lateral: 0, length: 8, width: 6 },
    { type: 'ramp', t: T('platA', 44), lateral: 0, length: 10, width: 16, power: 1.35 },
    { type: 'coins', t: T('gap', 22), count: 5, spacing: 4.5, lateral: 0 },
    // descent + dive
    { type: 'itemRow', t: T('descent', 30), count: 4, spacing: 4.4 },
    { type: 'boost', t: T('descent', 55), lateral: -4, length: 8, width: 5 },
    { type: 'coins', t: T('t5', 35), count: 4, spacing: 4.5, lateral: -7 },
    { type: 'boost', t: T('dive', 6), lateral: 3, length: 8, width: 5 },
    { type: 'coins', t: T('t6', 42), count: 4, spacing: 4.5, lateral: -8 },
    { type: 'hazard', t: T('t6', 20), lateral: 6, kind: 'crystal', radius: 1.2, effect: 'bump' },
  ],
  decorations: [
    { kind: 'streetLight', every: 30, side: 'both', offset: 1.0, tRange: [T('t6', 60), T('t1', 40)] },
    { kind: 'streetLight', every: 36, side: 'both', offset: 1.0, tRange: [T('south', 0), T('helixIn', 10)] },
    { kind: 'neonSign', count: 14, side: 'both', minOffset: 2, maxOffset: 12, seed: 3 },
    { kind: 'hologram', count: 10, side: 'both', minOffset: 2, maxOffset: 14, seed: 4, variant: [0, 1, 2, 3] },
    { kind: 'vendingMachine', count: 8, side: 'both', minOffset: 1, maxOffset: 6, seed: 5 },
    { kind: 'crystal', count: 30, side: 'both', minOffset: 3, maxOffset: 40, seed: 6, color: '#6a5cff', scale: [0.8, 1.6] },
  ],
  theme: {
    preset: 'neon-night',
    sky: { top: '#03041a', bottom: '#1c1150', horizon: '#4a1f86', stars: true, sunDisc: false, clouds: false },
    fog: { color: '#1a1245', near: 140, far: 720 },
    sun: { color: '#a8bcff', intensity: 0.95, dir: [0.3, 1.0, 0.25] },
    ambient: { sky: '#5a6cff', ground: '#2a1450', intensity: 0.95 },
    ground: { type: 'asphalt', color: '#161a2c', color2: '#10131f' },
    road: { style: 'neon', color: '#161b30', color2: CYAN, lines: true },
    edge: { style: 'glow', colorA: CYAN, colorB: MAGENTA },
    offroad: { type: 'none', color: '#232842' },
    wall: { style: 'glow', color: '#1c2033', color2: CYAN },
    particles: 'sparkles',
    music: 'millennium',
    night: true,
  },
  scenery,
};
