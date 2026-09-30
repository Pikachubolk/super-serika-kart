// Red Winter Snow Fortress (Pyroxene Cup race 2) — owner: tracks-C.
//
// The Red Winter Federal Academy under a pale low winter sun: a wide parade straight past the Grand Palace
// (red walls, candy-striped onion domes) behind a crenellated brick fortress wall, a banked sweeper onto the
// Avenue of Ice Arches, a long descending sweeper down to the frozen lake, wide icy S-bends across the ice,
// a climb up Tank Hill with a jump over the crest and a long banked left back onto the parade straight.
// Global grip is 0.8 (snowy); the lake section is dressed as clear blue ice and is the widest part.

function scalePoints(pts) {
  return pts.map((p) => ({ ...p, x: +(p.x * SCALE).toFixed(2), z: +(p.z * SCALE).toFixed(2) }));
}

/** n control points on a circular arc (x = cx + R cos a, z = cz + R sin a), y eased from y0 to y1. */
function arc(cx, cz, R, a0, a1, n, y0, y1, extra = {}) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const u = n === 1 ? 0.5 : k / (n - 1);
    const a = a0 + (a1 - a0) * u;
    out.push({ x: +(cx + R * Math.cos(a)).toFixed(2), y: +(y0 + (y1 - y0) * u).toFixed(2), z: +(cz + R * Math.sin(a)).toFixed(2), ...extra });
  }
  return out;
}

// palette
const RED = '#c8283a';
const RED_D = '#9c1c2c';
const BRICK = '#b33a33';
const GOLD = '#f0c24a';
const WHITE = '#f4f1ea';
const ICE = '#a8e4ff';
const STEEL = '#6f7a86';

// The layout is authored at 1/1.18 scale and scaled up uniformly (XZ) — distances below are final.
const SCALE = 1.18;

// key distances (see the validator dump)
const D_ARCH0 = 342;
const D_ARCH1 = 451;
const D_LAKE0 = 664;
const D_LAKE1 = 894;

// ---------------------------------------------------------------------------------------------------------
// scenery helpers
// ---------------------------------------------------------------------------------------------------------
function box(THREE, mat, w, h, d, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  return m;
}
function cyl(THREE, mat, r0, r1, h, x, y, z, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const stripeCache = new Map();
/** Candy-stripe material for onion domes (vertical stripes via the lathe's U coordinate). */
function stripeMat(ctx, a, b, n = 8) {
  const key = `${a}|${b}|${n}`;
  if (stripeCache.has(key)) return stripeCache.get(key);
  const { THREE } = ctx;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 8;
  const g = c.getContext('2d');
  for (let i = 0; i < n * 2; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect((i * 256) / (n * 2), 0, 256 / (n * 2) + 1, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshLambertMaterial({ map: tex });
  stripeCache.set(key, m);
  return m;
}

/** Onion dome (+ spire + small gold orb) of radius r sitting at y. */
function onionDome(ctx, mat, r, x, y, z) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const prof = [[0, 0], [0.62, 0.05], [0.95, 0.38], [1.02, 0.7], [0.88, 1.02], [0.58, 1.32], [0.26, 1.62], [0.08, 1.9], [0, 2.05]];
  const pts = prof.map(([px, py]) => new THREE.Vector2(px * r, py * r));
  const dome = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), mat);
  dome.position.set(x, y, z);
  dome.castShadow = true;
  g.add(dome);
  const gold = ctx.mat(GOLD, { emissive: '#7a5a10', emissiveIntensity: 0.35 });
  g.add(cyl(THREE, gold, r * 0.05, r * 0.08, r * 0.9, x, y + r * 2.4, z, 6));
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(r * 0.16, 0), gold);
  orb.position.set(x, y + r * 2.95, z);
  g.add(orb);
  return g;
}

/** The Grand Palace of Red Winter, facing +Z. Footprint ~ 80 x 44. */
function palace(ctx) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const red = ctx.mat(RED);
  const redD = ctx.mat(RED_D);
  const white = ctx.mat(WHITE);
  const stone = ctx.mat('#d9d6d0');
  const roof = ctx.mat('#3f5f58');
  const win = ctx.mat('#ffe7a8', { emissive: '#ffb74a', emissiveIntensity: 0.55 });
  const gold = ctx.mat(GOLD, { emissive: '#7a5a10', emissiveIntensity: 0.35 });
  // plinth + stairs
  g.add(box(THREE, stone, 84, 5, 46, 0, 0.5, 0));
  for (let i = 0; i < 4; i++) g.add(box(THREE, stone, 22 - i * 2, 1, 3, 0, 0.5 + i * 1.0, 24.5 + (3 - i) * 2.4));
  // main block
  g.add(box(THREE, red, 64, 16, 30, 0, 11, 0));
  g.add(box(THREE, white, 65, 1.2, 31, 0, 3.6, 0));
  g.add(box(THREE, white, 65, 1.4, 31, 0, 11.2, 0));
  g.add(box(THREE, white, 66, 1.6, 32, 0, 19.2, 0));
  g.add(box(THREE, roof, 62, 3.5, 28, 0, 21.6, 0));
  // windows (two storeys) on the front + sides
  for (const yy of [7.2, 15]) {
    for (let x = -28; x <= 28; x += 5.6) if (Math.abs(x) > 5) g.add(box(THREE, win, 2.2, 3.4, 0.3, x, yy, 15.1));
    for (let z = -11; z <= 11; z += 5.5) for (const s of [-1, 1]) g.add(box(THREE, win, 0.3, 3.4, 2.2, s * 32.1, yy, z));
  }
  // portal
  g.add(box(THREE, white, 12, 13, 2, 0, 9.5, 15.5));
  g.add(box(THREE, ctx.mat('#3a1f1f'), 7, 9, 0.4, 0, 7.5, 16.6));
  g.add(box(THREE, gold, 12.6, 0.8, 2.4, 0, 16.3, 15.6));
  // central tower + big gold dome
  g.add(box(THREE, red, 16, 12, 16, 0, 29, 0));
  g.add(box(THREE, white, 17, 1.2, 17, 0, 35.4, 0));
  for (const s of [-1, 1]) {
    g.add(box(THREE, win, 3, 5, 0.3, s * 3.5, 29, 8.05));
    g.add(box(THREE, win, 0.3, 5, 3, s * 8.05, 29, 3.5));
  }
  g.add(cyl(THREE, redD, 6.5, 7, 5, 0, 38.3, 0, 16));
  g.add(onionDome(ctx, gold, 7.5, 0, 40.5, 0));
  // corner towers with striped domes
  const domeMats = [stripeMat(ctx, RED, GOLD), stripeMat(ctx, '#ffffff', RED), stripeMat(ctx, '#2f8f86', GOLD), stripeMat(ctx, RED, '#ffffff')];
  let k = 0;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 36;
      const z = sz * 17;
      g.add(cyl(THREE, red, 5.2, 5.6, 26, x, 13, z, 14));
      g.add(cyl(THREE, white, 5.9, 5.9, 1.2, x, 25.6, z, 14));
      g.add(cyl(THREE, redD, 3.8, 4.2, 4, x, 28.2, z, 12));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(box(THREE, win, 1.2, 3, 0.3, x + Math.sin(a) * 5.35, 17, z + Math.cos(a) * 5.35, a));
      }
      g.add(onionDome(ctx, domeMats[k++ % 4], 5, x, 30, z));
    }
  // two smaller front domes flanking the portal
  for (const sx of [-1, 1]) {
    g.add(cyl(THREE, red, 3.2, 3.4, 8, sx * 12, 23.2, 12, 12));
    g.add(onionDome(ctx, stripeMat(ctx, '#2f8f86', GOLD), 3.2, sx * 12, 27.2, 12));
  }
  // banners on the facade
  const tex = ctx.textTexture('RED WINTER', { width: 512, height: 128, bg: RED_D, color: GOLD, size: 64 });
  const bm = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
  for (const x of [-20, 20]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), bm);
    p.position.set(x, 19.9, 16.1);
    g.add(p);
  }
  const vb = ctx.mat(RED_D);
  for (const x of [-9, 9, -27, 27]) {
    g.add(box(THREE, vb, 3.2, 9, 0.2, x, 12.5, 15.4));
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), gold);
    star.scale.set(1, 1, 0.25);
    star.position.set(x, 14.2, 15.6);
    g.add(star);
  }
  return g;
}

/** Crenellated fortress-wall segment (10 long, along Z), plus merlons. */
function wallSegment(ctx, len = 10) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const brick = ctx.mat(BRICK);
  const snow = ctx.mat('#ffffff');
  g.add(box(THREE, brick, 3.2, 9, len + 0.05, 0, 4.5, 0));
  g.add(box(THREE, snow, 3.4, 0.35, len + 0.05, 0, 9.1, 0));
  for (let i = 0; i < 3; i++) {
    const z = -len / 2 + len / 6 + (i * len) / 3;
    g.add(box(THREE, brick, 2.8, 1.8, 1.6, 0, 10.1, z));
    // swallowtail notch
    g.add(box(THREE, snow, 2.9, 0.3, 1.7, 0, 11.1, z));
  }
  return g;
}

/** Fortress tower with a tent roof and a gold star finial. */
function wallTower(ctx) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const brick = ctx.mat(BRICK);
  g.add(box(THREE, brick, 7, 15, 7, 0, 7.5, 0));
  g.add(box(THREE, ctx.mat(WHITE), 7.6, 0.8, 7.6, 0, 15.2, 0));
  g.add(box(THREE, brick, 5.5, 4, 5.5, 0, 17.4, 0));
  const r = new THREE.Mesh(new THREE.ConeGeometry(4.6, 9, 4, 1), ctx.mat('#2f6f5c'));
  r.rotation.y = Math.PI / 4;
  r.position.y = 23.9;
  r.castShadow = true;
  g.add(r);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), ctx.mat(GOLD, { emissive: '#a0700a', emissiveIntensity: 0.6 }));
  star.position.y = 29.2;
  g.add(star);
  g.add(box(THREE, ctx.mat('#ffe7a8', { emissive: '#ffb74a', emissiveIntensity: 0.5 }), 1.4, 2.4, 0.3, 0, 10, 3.55));
  return g;
}

/** Winter-camo tank, facing +Z. */
function tank(ctx) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const hull = ctx.mat('#e4e8ec');
  const camo = ctx.mat('#8e98a3');
  const dark = ctx.mat('#3c4148');
  const red = ctx.mat(RED);
  for (const s of [-1, 1]) {
    g.add(box(THREE, dark, 1.4, 1.5, 8.4, s * 2.3, 0.75, 0));
    for (let i = 0; i < 5; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.5, 10), camo);
      w.rotation.z = Math.PI / 2;
      w.position.set(s * 2.3, 0.7, -3.2 + i * 1.6);
      g.add(w);
    }
  }
  g.add(box(THREE, hull, 4.2, 1.5, 7.6, 0, 1.9, 0));
  g.add(box(THREE, camo, 2.2, 0.1, 3, 0.8, 2.66, -1.5));
  const tur = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 1.3, 12), hull);
  tur.position.set(0, 3.3, -0.4);
  tur.castShadow = true;
  g.add(tur);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 5.2, 8), camo);
  barrel.rotation.x = Math.PI / 2 - 0.12;
  barrel.position.set(0, 3.6, 2.6);
  g.add(barrel);
  g.add(box(THREE, red, 4.25, 0.35, 0.8, 0, 2.2, 3.2)); // red school stripe
  g.add(cyl(THREE, dark, 0.5, 0.5, 0.5, 0.6, 4.1, -0.9, 8)); // hatch
  return g;
}

/** Ice arch spanning `span` (road-spanning, along X), semi-elliptic, height h. */
function iceArch(ctx, span, h) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const ice = ctx.mat(ICE, { emissive: '#3fa9e0', emissiveIntensity: 0.3, opacity: 0.82 });
  const tor = new THREE.Mesh(new THREE.TorusGeometry(span / 2, 1.3, 7, 22, Math.PI), ice);
  tor.scale.set(1, (h / span) * 2, 1.4);
  tor.castShadow = false;
  g.add(tor);
  for (const s of [-1, 1]) g.add(box(THREE, ice, 3.4, 3, 3.4, (s * span) / 2, 0.6, 0));
  // icicles hanging from the crown
  for (let i = -3; i <= 3; i++) {
    const x = (i / 3.4) * span * 0.38;
    const yy = Math.sqrt(Math.max(0, 1 - (x / (span / 2)) ** 2)) * h - 1.2;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8 + (i % 2 ? 0.8 : 0), 5), ice);
    c.rotation.x = Math.PI;
    c.position.set(x, yy - 0.9, 0);
    g.add(c);
  }
  return g;
}

/** Road-conforming strip between d0..d1, lateral lat0..lat1, lifted dy. uv: u across (0..1)*uScale, v = d / vScale. */
function roadStrip(ctx, d0, d1, lat0, lat1, dy, vScale, uScale = 1, step = 1.5) {
  const { THREE } = ctx;
  const pos = [];
  const uv = [];
  const idx = [];
  const n = Math.ceil((d1 - d0) / step);
  for (let a = 0; a <= n; a++) {
    const d = d0 + ((d1 - d0) * a) / n;
    for (let c = 0; c <= 1; c++) {
      const p = ctx.pointAt(d, c ? lat1 : lat0);
      pos.push(p.x, p.y + dy, p.z);
      uv.push(c * uScale, (d - d0) / vScale);
    }
    if (a < n) {
      const i = a * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (geo.attributes.normal.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  return geo;
}

/** Clear-ice texture with cracks and frost (used for the lake road overlay and the lake). */
function iceTexture(ctx, seed, size = 256, alphaBase = 0.55) {
  const { THREE } = ctx;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const grd = g.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, `rgba(150,215,255,${alphaBase})`);
  grd.addColorStop(0.5, `rgba(190,235,255,${alphaBase + 0.1})`);
  grd.addColorStop(1, `rgba(140,205,250,${alphaBase})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  // frost patches
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.14})`;
    g.beginPath();
    g.ellipse(r() * size, r() * size, 6 + r() * 30, 3 + r() * 14, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // cracks
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 1.3;
  for (let i = 0; i < 9; i++) {
    let x = r() * size;
    let y = r() * size;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 50;
      y += (r() - 0.5) * 50;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Jitter a cone's vertices (seam-consistent) so distant mountains look craggy instead of pyramidal. */
function jagged(geo, seed) {
  const p = geo.attributes.position;
  const h = (x, y, z) => {
    const v = Math.sin(Math.round(x * 10) * 12.9898 + Math.round(y * 10) * 78.233 + Math.round(z * 10) * 37.719 + seed * 4.1) * 43758.5453;
    return v - Math.floor(v);
  };
  geo.computeBoundingBox();
  const top = geo.boundingBox.max.y;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (y > top - 0.01) continue;
    const k = 0.82 + h(x, y, z) * 0.36;
    p.setXYZ(i, x * k, y + (h(z, x, y) - 0.5) * 8, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function scenery(ctx) {
  const { THREE } = ctx;
  const rng = ctx.rng;
  const hi = ctx.quality !== 'low';
  const path = ctx.path;
  const gy = (x, z, fb = 0) => {
    const g = ctx.groundAt(x, z);
    return g === null || g === undefined ? fb : g;
  };
  const edgeLat = (d, side) => {
    const f = ctx.frameAt(d);
    return side * (f.halfWidth + (side > 0 ? f.offR : f.offL));
  };
  const at = (d, lat) => {
    const p = ctx.pointAt(((d % path.length) + path.length) % path.length, lat);
    return { x: p.x, y: gy(p.x, p.z, p.y), z: p.z, yaw: ctx.frameAt(((d % path.length) + path.length) % path.length).yaw };
  };

  // ---------------------------------------------------------------- Grand Palace + fortress wall (west of the parade straight)
  {
    const px = -140 * SCALE;
    const pz = 45 * SCALE;
    const pal = palace(ctx);
    let py = Infinity;
    for (const [dx, dz] of [[-30, -52], [30, -52], [-30, 52], [30, 52], [0, 0]]) py = Math.min(py, gy(px + dx, pz + dz, 0));
    ctx.instanced(pal, [{ x: px, y: py - 0.5, z: pz, rotY: Math.PI / 2, scale: 1.35 }], { brightness: 0, chunk: 4000 });
    ctx.reserve(px, pz, 64);
    ctx.reserve(px + 45, pz, 22); // plaza in front of the portal

    // crenellated wall between the road and the palace, with towers and a gate opposite the portal
    const segs = [];
    const towers = [];
    for (let d = -90; d <= 178; d += 10) {
      const p = at(d, ctx.frameAt(((d % path.length) + path.length) % path.length).halfWidth + 8 + 7);
      if (Math.abs(p.z - pz) < 7) continue; // gate gap
      segs.push({ x: p.x, y: p.y - 0.3, z: p.z, rotY: p.yaw });
      if (((d + 90) / 10) % 5 === 0) towers.push({ x: p.x, y: p.y - 0.3, z: p.z, rotY: p.yaw });
    }
    ctx.instanced(wallSegment(ctx), segs, { brightness: 0.03, chunk: 4000 });
    // gate towers
    const gA = at(0, 0);
    const lat = ctx.frameAt(pz).halfWidth + 15;
    for (const dz of [-8, 8]) {
      const q = ctx.pointAt(pz + dz, lat);
      towers.push({ x: q.x, y: gy(q.x, q.z, q.y) - 0.3, z: q.z, rotY: 0, scale: 1.15 });
    }
    void gA;
    ctx.instanced(wallTower(ctx), towers, { brightness: 0.03, chunk: 4000 });

    // parade banners + flags along the straight (right side = spectator side)
    const bans = [];
    for (let d = -60; d <= 142; d += 17) {
      const p = at(d, edgeLat(((d % path.length) + path.length) % path.length, -1) - 1.8);
      bans.push({ x: p.x, y: p.y, z: p.z, rotY: p.yaw - Math.PI / 2 });
    }
    ctx.instanced(ctx.props.create('banner', { text: 'RED WINTER', color: RED, color2: GOLD }), bans, { brightness: 0, chunk: 4000 });
    const stands = ctx.props.create('grandstand', { color: RED, color2: '#ffffff' });
    const sp = at(71, edgeLat(71, -1) - 14);
    stands.position.set(sp.x, sp.y, sp.z);
    stands.rotation.y = sp.yaw - Math.PI / 2;
    ctx.group.add(stands);
    ctx.reserve(sp.x, sp.z, 12);
    const bb = ctx.props.create('billboard', { text: 'RED WINTER FEDERAL ACADEMY', color: RED });
    const bp = at(-47, edgeLat(path.length - 47, -1) - 10);
    bb.position.set(bp.x, bp.y, bp.z);
    bb.rotation.y = bp.yaw - Math.PI / 2 + 0.35;
    ctx.group.add(bb);
    ctx.reserve(bp.x, bp.z, 6);
  }

  // ---------------------------------------------------------------- avenue of ice arches (north straight)
  {
    const arches = [];
    for (let d = D_ARCH0; d <= D_ARCH1; d += 7.5) {
      const f = ctx.frameAt(d);
      const lc = (f.offR - f.offL) / 2;
      const p = ctx.pointAt(d, lc);
      const span = f.halfWidth * 2 + f.offL + f.offR + 2;
      arches.push({ x: p.x, y: p.y - 0.4, z: p.z, rotY: f.yaw, scale: [1, 1, 1], _span: span });
    }
    const span = arches.length ? arches[0]._span : 38;
    ctx.instanced(iceArch(ctx, span, 13), arches.map(({ _span, ...t }) => t), { castShadow: false, brightness: 0.05, chunk: 4000 });
    // street lamps along the avenue approach
    const lamps = [];
    for (let d = 224; d < 555; d += 26) {
      if (d > D_ARCH0 - 6 && d < D_ARCH1 + 6) continue;
      for (const side of [-1, 1]) {
        const p = at(d, edgeLat(d, side) + 1.2);
        lamps.push({ x: p.x, y: p.y, z: p.z, rotY: p.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
      }
    }
    ctx.instanced('streetLight', lamps, { brightness: 0, chunk: 4000 });

    // academy buildings lining the avenue (snowy gable roofs, warm windows)
    const bld = new THREE.Group();
    const wallM = ctx.mat('#e9d9c2');
    const trim = ctx.mat(RED_D);
    const winM = ctx.mat('#ffe7a8', { emissive: '#ffb74a', emissiveIntensity: 0.55 });
    bld.add(box(THREE, trim, 16, 1.2, 11, 0, 0.6, 0));
    bld.add(box(THREE, wallM, 15, 10, 10, 0, 6, 0));
    bld.add(box(THREE, trim, 15.4, 0.8, 10.4, 0, 11, 0));
    for (let i = -2; i <= 2; i++) for (const yy of [4, 8]) bld.add(box(THREE, winM, 1.6, 2.2, 0.2, i * 2.9, yy, 5.05));
    const shp = new THREE.Shape();
    shp.moveTo(-6.2, 0);
    shp.lineTo(6.2, 0);
    shp.lineTo(0, 5);
    shp.closePath();
    const rg = new THREE.ExtrudeGeometry(shp, { depth: 16.4, bevelEnabled: false });
    rg.translate(0, 0, -8.2);
    rg.rotateY(Math.PI / 2);
    const roofM = new THREE.Mesh(rg, ctx.mat('#ffffff'));
    roofM.position.y = 11.4;
    roofM.castShadow = true;
    bld.add(roofM);
    bld.add(onionDome(ctx, stripeMat(ctx, RED, GOLD), 1.6, 0, 15.6, 0));
    const blds = [];
    for (let d = 201; d < 555; d += 22) {
      for (const side of [-1, 1]) {
        const p = at(d + side * 5, edgeLat(d, side) + side * (11 + rng() * 4));
        if (!ctx.isClear(p.x, p.z, 8.5)) continue;
        blds.push({ x: p.x, y: p.y - 0.4, z: p.z, rotY: p.yaw - side * (Math.PI / 2), scale: 0.9 + rng() * 0.25 });
        ctx.reserve(p.x, p.z, 9);
      }
    }
    ctx.instanced(bld, blds, { brightness: 0.06, chunk: 4000 });
  }

  // ---------------------------------------------------------------- the frozen lake
  {
    // lake surface: an ice disc around the lake road, just under the road level
    const cx = 225 * SCALE;
    const cz = 15 * SCALE;
    const R = 80 * SCALE;
    const lakeY = -0.45;
    const tex = iceTexture(ctx, 91, 256, 0.9);
    tex.repeat.set(7, 7);
    const lake = new THREE.Mesh(
      new THREE.CircleGeometry(R, 48),
      new THREE.MeshStandardMaterial({ map: tex, color: '#b9e4fb', roughness: 0.75, metalness: 0.0, emissive: '#1d5f8e', emissiveIntensity: 0.2 }),
    );
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(cx, lakeY, cz);
    lake.scale.set(1, 1.25, 1);
    lake.receiveShadow = true;
    ctx.group.add(lake);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      ctx.reserve(cx + Math.cos(a) * R * 0.55, cz + Math.sin(a) * R * 0.69, R * 0.5);
    }
    ctx.reserve(cx, cz, R * 0.6);
    // snow rim + ice spikes + crystals around the shore
    const spikes = [];
    const crystals = [];
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 2;
      const rr = R * (0.72 + rng() * 0.35);
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr * 1.25;
      if (!ctx.isClear(x, z, 3)) continue;
      const y = Math.max(lakeY, gy(x, z, lakeY)) - 0.2;
      if (rng() < 0.65) spikes.push({ x, y, z, rotY: rng() * 6, scale: 0.8 + rng() * 1.3 });
      else crystals.push({ x, y, z, rotY: rng() * 6, scale: 1 + rng() * 1.2 });
    }
    ctx.instanced('iceSpike', spikes, { chunk: 4000, color: '#bfe9ff' });
    ctx.instanced('crystal', crystals, { chunk: 4000, color: '#9fdcff' });

    // clear-ice overlay on the lake road
    const itex = iceTexture(ctx, 17, 256, 0.72);
    const f0 = ctx.frameAt((D_LAKE0 + D_LAKE1) / 2);
    const hw = f0.halfWidth - 1.1;
    itex.repeat.set(1, 1);
    const overlay = new THREE.Mesh(
      roadStrip(ctx, D_LAKE0, D_LAKE1, -hw, hw, 0.04, hw * 2),
      new THREE.MeshStandardMaterial({ map: itex, transparent: true, roughness: 0.5, metalness: 0, emissive: '#2a7fb8', emissiveIntensity: 0.12, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, depthWrite: false }),
    );
    overlay.receiveShadow = true;
    ctx.group.add(overlay);
    // fading ends so the transition to cobbles is soft
    // (the ice fades in over the first/last 12 units via vertex-less trick: short extra strips at lower opacity)
    for (const [a, b] of [[D_LAKE0 - 14, D_LAKE0], [D_LAKE1, D_LAKE1 + 14]]) {
      const m = new THREE.Mesh(roadStrip(ctx, a, b, -hw, hw, 0.04, hw * 2), overlay.material.clone());
      m.material.opacity = 0.5;
      ctx.group.add(m);
    }

    // ice-fishing huts + a tank on the shore
    const hut = new THREE.Group();
    hut.add(box(THREE, ctx.mat('#8a5a3a'), 3.2, 2.6, 3.2, 0, 1.3, 0));
    const hr = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.6, 4), ctx.mat('#ffffff'));
    hr.rotation.y = Math.PI / 4;
    hr.position.y = 3.4;
    hut.add(hr);
    hut.add(box(THREE, ctx.mat(RED), 0.9, 1.6, 0.1, 0, 1.0, 1.62));
    const huts = [];
    for (const [d, lat] of [[661, 34], [755, 38], [708, -40], [814, -30]]) {
      const p = at(d, lat);
      if (!ctx.isClear(p.x, p.z, 3)) continue;
      huts.push({ x: p.x, y: Math.max(lakeY, p.y), z: p.z, rotY: rng() * 6 });
    }
    ctx.instanced(hut, huts, { chunk: 4000 });
  }

  // ---------------------------------------------------------------- tanks
  {
    const tanks = [];
    for (const [d, lat, dy] of [[30, -27, 0.4], [985, -26, 0.8], [1027, 25, -0.5], [555, -30, 0.3]]) {
      const p = at(d, lat);
      if (!ctx.isClear(p.x, p.z, 4)) continue;
      tanks.push({ x: p.x, y: p.y - 0.1, z: p.z, rotY: p.yaw + Math.PI / 2 * Math.sign(-lat) + dy, scale: 1.3 });
      ctx.reserve(p.x, p.z, 6);
    }
    ctx.instanced(tank(ctx), tanks, { brightness: 0.02, chunk: 4000 });
  }

  // ---------------------------------------------------------------- snowmen with Red Winter scarves, signs
  {
    const sm = [];
    for (let i = 0; i < 40; i++) {
      const d = rng() * path.length;
      const side = rng() < 0.5 ? -1 : 1;
      const p = at(d, edgeLat(d, side) + side * (2 + rng() * 12));
      if (!ctx.isClear(p.x, p.z, 1.2)) continue;
      sm.push({ x: p.x, y: p.y, z: p.z, rotY: p.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (rng() - 0.5), scale: 0.9 + rng() * 0.8 });
    }
    ctx.instanced('snowman', sm, { chunk: 4000 });
    const s1 = ctx.props.create('sign', { text: 'THIN ICE!', color: '#39c0ff' });
    const a1 = at(D_LAKE0 - 30, edgeLat(D_LAKE0 - 30, 1) + 2);
    s1.position.set(a1.x, a1.y, a1.z);
    s1.rotation.y = a1.yaw - 0.6;
    ctx.group.add(s1);
    const s2 = ctx.props.create('sign', { text: 'CREDITS!', color: '#ffd23f' });
    const a2 = at(1097, edgeLat(1097, -1) - 2);
    s2.position.set(a2.x, a2.y, a2.z);
    s2.rotation.y = a2.yaw + 0.6;
    ctx.group.add(s2);
    const s3 = ctx.props.create('sign', { text: 'JUMP!', color: RED });
    const a3 = at(991, edgeLat(991, 1) + 2);
    s3.position.set(a3.x, a3.y, a3.z);
    s3.rotation.y = a3.yaw - 0.6;
    ctx.group.add(s3);
  }

  // ---------------------------------------------------------------- distant snowy mountains ring
  {
    const peaks = new THREE.Group();
    const rockM = ctx.mat('#9aa8bd', { flatShading: true });
    const snowM = ctx.mat('#ffffff', { flatShading: true });
    const c = ctx.center;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const dist = 560 + (i % 3) * 70;
      const r = 130 + (i % 4) * 30;
      const h = 150 + ((i * 37) % 90);
      const x = c.x + Math.cos(a) * dist;
      const z = c.z + Math.sin(a) * dist;
      const m = new THREE.Mesh(jagged(new THREE.ConeGeometry(r, h, 11, 4), i), rockM);
      m.position.set(x, h / 2 - 30, z);
      m.rotation.y = a * 3;
      peaks.add(m);
      const s = new THREE.Mesh(jagged(new THREE.ConeGeometry(r * 0.5, h * 0.5, 11, 2), i + 50), snowM);
      s.position.set(x, h - 30 - h * 0.25 + 0.3, z);
      s.rotation.y = a * 3;
      peaks.add(s);
    }
    ctx.instanced(peaks, [{ x: 0, y: 0, z: 0 }], { castShadow: false, brightness: 0, chunk: 10000 });
  }
  void hi;
}

export default {
  id: 'red-winter',
  name: 'Red Winter Snow Fortress',
  laps: 3,
  width: 22,
  offroad: 7,
  wall: true,
  points: scalePoints([
    // parade straight past the Grand Palace, heading north
    { x: -40, y: 3, z: 0, w: 26, off: 8 },
    { x: -40, y: 3, z: 70, w: 26 },
    { x: -37, y: 3.5, z: 130, w: 24 },
    // T1: banked left-hander onto the avenue
    { x: -15, y: 4.5, z: 180, bank: -8 },
    { x: 35, y: 6, z: 212, bank: -6 },
    // avenue of ice arches, heading east
    { x: 110, y: 8, z: 224 },
    { x: 170, y: 8, z: 224 },
    // T2: descending sweeper down to the lake
    { x: 222, y: 6.5, z: 206, bank: -9 },
    { x: 246, y: 4, z: 165, bank: -6 },
    { x: 247, y: 1.5, z: 118, w: 24 },
    // the frozen lake: wide icy S-bends
    { x: 228, y: 0, z: 72, w: 26 },
    { x: 238, y: 0, z: 22, w: 26 },
    { x: 206, y: 0, z: -40, w: 26 },
    { x: 162, y: 0.5, z: -72, w: 24 },
    // Tank Hill: climbing kink + crest jump
    { x: 112, y: 2.5, z: -96 },
    { x: 70, y: 5.5, z: -116 },
    { x: 28, y: 8.5, z: -132 },
    // long banked turn back onto the parade straight
    ...arc(-8, -100, 38, -Math.PI / 2 - 0.25, -Math.PI, 5, 9, 4.2, { w: 22, off: 6, bank: -9 }),
    { x: -40, y: 3.2, z: -50, w: 24 },
  ]),
  features: [
    { type: 'itemRow', d: 89, count: 5, spacing: 4.6 },
    { type: 'coins', d: 212, count: 5, spacing: 4, lateral: -6 },
    { type: 'boost', d: 337, lateral: 0, length: 8, width: 5 },
    { type: 'coins', d: 394, count: 6, spacing: 4.5, lateral: 8.5 },
    { type: 'itemRow', d: 555, count: 4, spacing: 4.6 },
    { type: 'hazard', d: 682, lateral: -8, kind: 'snowman', radius: 1.1, effect: 'bump' },
    { type: 'boost', d: 715, lateral: 0, length: 8, width: 5 },
    { type: 'coins', d: 741, count: 5, spacing: 4, lateral: -7 },
    { type: 'hazard', d: 807, lateral: 8, kind: 'iceSpike', radius: 1.1, effect: 'bump' },
    { type: 'slow', d: 852, lateral: -9, length: 14, width: 5 },
    { type: 'itemRow', d: 911, count: 5, spacing: 4.6 },
    { type: 'ramp', d: 1017, lateral: 0, length: 10, width: 12, power: 1 },
    { type: 'coins', d: 1093, count: 4, spacing: 4, lateral: 0 },
    { type: 'coins', d: 1151, count: 4, spacing: 4, lateral: -7 },
    { type: 'boost', d: 1194, lateral: -3, length: 8, width: 5 },
    { type: 'itemRow', d: 1233, count: 5, spacing: 4.6 },
  ],
  decorations: [
    { kind: 'pine', count: 230, side: 'both', minOffset: 3, maxOffset: 90, scale: [0.9, 1.7], seed: 21, variant: 'snowy', color: '#2f6a4e' },
    { kind: 'pine', count: 60, side: 'both', minOffset: 90, maxOffset: 170, scale: [1.3, 2.0], seed: 22, variant: 'snowy', color: '#2a5f47' },
    { kind: 'iceSpike', count: 30, side: 'both', minOffset: 1, maxOffset: 20, scale: [0.7, 1.4], seed: 23, tRange: [0.36, 0.72] },
    { kind: 'rock', count: 30, side: 'both', minOffset: 1, maxOffset: 30, scale: [0.8, 1.8], seed: 24, color: '#aab4c2' },
    { kind: 'flag', every: 30, side: 'right', offset: 1.4, tRange: [0.72, 0.84], color: RED },
    { kind: 'lamp', every: 26, side: 'both', offset: 1.2, tRange: [0.84, 0.99] },
  ],
  theme: {
    preset: 'snow',
    sky: { top: '#7f9dc8', bottom: '#e9eef5', horizon: '#fae1cc', sunDisc: true, clouds: true },
    fog: { color: '#e0e7f1', near: 130, far: 680 },
    sun: { color: '#ffe0c0', intensity: 2.0, dir: [0.62, 0.3, -0.72] },
    ambient: { sky: '#e2ebff', ground: '#a9b6c8', intensity: 1.15 },
    ground: { type: 'snow', color: '#f3f7ff', color2: '#dce6f3' },
    road: { style: 'stone', color: '#a3a9b4', color2: '#8f96a3', lines: false },
    edge: { style: 'curb', colorA: '#d8243a', colorB: '#ffffff' },
    offroad: { type: 'snow', color: '#eef3fa' },
    wall: { style: 'snowbank', color: '#ffffff', color2: '#cfe0f2' },
    void: { type: 'water', color: '#2a6f9e' },
    grip: 0.8,
    particles: 'snow',
    music: 'redwinter',
    night: false,
  },
  scenery,
};
