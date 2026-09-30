// Hyakkiyako Sakura Pass (Pyroxene Cup race 1) — owner: tracks-C.
//
// A golden-hour mountain pass in the Hyakkiyako Alliance: a lantern-lit festival street (start), a fast left
// sweeper, a red taiko bridge over a deep river gorge with a waterfall, two climbing hairpins, a ridge-top
// tunnel of ~70 vermilion torii gates, a wall-less cliff road above the abyss, a crest jump and descending
// S-bends back into town. Landmarks: five-storey pagoda, shrine hall with a big bronze bell, koi pond.

const L = 1580; // approximate lap length (only used for comments / sanity; features use absolute d)

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
const VERMILION = '#e2432d';
const VERMILION_D = '#b8321f';
const INK = '#2a2224';
const WOOD = '#6b4a33';
const PLASTER = '#f3ead8';
const ROOF = '#3f4658';
const BRONZE = '#b0802e';
const STONE = '#b8b0a2';
const LANTERN = '#ff9a3c';

// ---------------------------------------------------------------------------------------------------------
// scenery helpers (only run in the browser build; never at import time)
// ---------------------------------------------------------------------------------------------------------
function box(THREE, mat, w, h, d, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  return m;
}
function cyl(THREE, mat, r0, r1, h, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
/** Gable roof prism: ridge along X, width w (x), depth d (z), height h, base at y. */
function gableRoof(THREE, mat, w, d, h, y, overhang = 1) {
  const s = new THREE.Shape();
  const hd = d / 2 + overhang;
  s.moveTo(-hd, 0);
  s.lineTo(hd, 0);
  s.lineTo(hd * 0.18, h);
  s.lineTo(-hd * 0.18, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w + overhang * 2, bevelEnabled: false });
  g.translate(0, 0, -(w + overhang * 2) / 2);
  g.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

/** A single vermilion torii gate spanning `span` between pillar centres, top beam at height h. */
function toriiGate(ctx, span, h, { plaque = null } = {}) {
  const { THREE } = ctx;
  const red = ctx.mat(VERMILION, { emissive: '#7a1a0a', emissiveIntensity: 0.35 });
  const ink = ctx.mat(INK);
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(cyl(THREE, red, 0.42, 0.52, h + 2, (s * span) / 2, (h + 2) / 2 - 2, 0, 10));
    g.add(cyl(THREE, ink, 0.66, 0.66, 1.3, (s * span) / 2, -0.35, 0, 10));
  }
  g.add(box(THREE, red, span + 1.8, 0.5, 0.42, 0, h - 1.45, 0)); // nuki
  g.add(box(THREE, red, span + 3.4, 0.7, 0.95, 0, h, 0)); // kasagi
  g.add(box(THREE, ink, span + 4.2, 0.36, 1.25, 0, h + 0.52, 0)); // black cap
  // upturned cap ends
  for (const s of [-1, 1]) {
    const e = box(THREE, ink, 1.6, 0.36, 1.25, s * (span / 2 + 2.6), h + 0.72, 0);
    e.rotation.z = s * 0.28;
    g.add(e);
  }
  g.add(box(THREE, red, 0.5, 1.0, 0.4, 0, h - 0.7, 0)); // centre strut
  if (plaque) {
    const tex = ctx.textTexture(plaque, { width: 512, height: 160, bg: INK, color: '#ffd76a', size: 70 });
    g.add(box(THREE, ink, 3.8, 1.3, 0.45, 0, h - 0.7, 0));
    const pm = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.05), pm);
      p.position.set(0, h - 0.7, s * 0.24);
      if (s < 0) p.rotation.y = Math.PI;
      g.add(p);
    }
  }
  return g;
}

/** Hanging paper lantern (chochin), origin at the hook. */
function chochin(ctx) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const glow = ctx.mat(LANTERN, { emissive: '#ff7a1c', emissiveIntensity: 0.9 });
  const ink = ctx.mat(INK);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 6), glow);
  body.scale.set(1, 1.35, 1);
  body.position.y = -1.0;
  g.add(body);
  g.add(cyl(THREE, ink, 0.34, 0.34, 0.18, 0, -0.2, 0, 8));
  g.add(cyl(THREE, ink, 0.34, 0.34, 0.18, 0, -1.8, 0, 8));
  return g;
}

/** Machiya townhouse: plaster walls, dark timber, tiled gable roof, glowing noren doorway. Faces +Z. */
function townHouse(ctx) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const wall = ctx.mat(PLASTER);
  const wood = ctx.mat(WOOD);
  const roof = ctx.mat(ROOF);
  const glow = ctx.mat('#ffc47a', { emissive: '#ff9d3a', emissiveIntensity: 0.8 });
  g.add(box(THREE, wood, 9, 1.4, 7, 0, 0.2, 0));
  g.add(box(THREE, wall, 8.6, 3.6, 6.6, 0, 2.6, 0));
  g.add(box(THREE, wood, 9.2, 0.35, 7.2, 0, 4.4, 0));
  g.add(box(THREE, wall, 7.6, 2.2, 5.6, 0, 5.6, 0));
  g.add(gableRoof(THREE, roof, 9, 7.2, 2.6, 6.5, 0.9));
  g.add(box(THREE, roof, 10.4, 0.3, 1.8, 0, 4.7, 3.9)); // front eave
  g.add(box(THREE, glow, 3.2, 2.0, 0.1, -1.6, 1.8, 3.34)); // lit shop front
  g.add(box(THREE, ctx.mat('#2f3c6e'), 3.4, 0.9, 0.12, -1.6, 2.9, 3.42)); // indigo noren
  g.add(box(THREE, glow, 1.6, 1.2, 0.1, 2.4, 2.4, 3.34)); // window
  for (const x of [-4.2, 0.2, 4.2]) g.add(box(THREE, wood, 0.3, 3.6, 0.3, x, 2.6, 3.35));
  return g;
}

/** Shrine hall (haiden) on a stone plinth, facing +Z. ~22 wide. */
function shrineHall(ctx) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const stone = ctx.mat(STONE);
  const red = ctx.mat(VERMILION);
  const wood = ctx.mat(WOOD);
  const wall = ctx.mat(PLASTER);
  const roof = ctx.mat('#394052');
  const gold = ctx.mat('#e9b949', { emissive: '#6b4a0c', emissiveIntensity: 0.4 });
  g.add(box(THREE, stone, 24, 4, 18, 0, 0, 0));
  g.add(box(THREE, stone, 8, 1, 4, 0, 1.6, 10.5)); // steps
  g.add(box(THREE, stone, 8, 1, 2.5, 0, 0.6, 12.4));
  g.add(box(THREE, wood, 21, 0.6, 15, 0, 2.3, 0));
  g.add(box(THREE, wall, 17, 5.5, 11, 0, 5.3, -0.5));
  for (const x of [-9.6, -4.8, 0, 4.8, 9.6]) for (const z of [-6.8, 6.8]) g.add(cyl(THREE, red, 0.42, 0.42, 6.6, x, 5.6, z, 10));
  g.add(box(THREE, red, 20.4, 0.7, 0.7, 0, 8.6, 6.8));
  g.add(box(THREE, red, 20.4, 0.7, 0.7, 0, 8.6, -6.8));
  // double roof
  g.add(gableRoof(THREE, roof, 20, 14.5, 3.4, 9.0, 2.2));
  g.add(gableRoof(THREE, roof, 12, 8, 3.6, 12.2, 1.6));
  g.add(box(THREE, gold, 16.5, 0.45, 0.6, 0, 15.9, 0)); // ridge
  for (const s of [-1, 1]) g.add(box(THREE, gold, 0.6, 1.4, 0.8, s * 8.2, 16.3, 0));
  // shimenawa rope + offertory box + plaque
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 12, 8), ctx.mat('#e8d9a8'));
  rope.rotation.z = Math.PI / 2;
  rope.position.set(0, 8.0, 7.3);
  g.add(rope);
  for (const x of [-3.5, 0, 3.5]) g.add(box(THREE, ctx.mat('#ffffff'), 0.5, 1.4, 0.05, x, 7.0, 7.45));
  g.add(box(THREE, wood, 3.4, 1.3, 1.6, 0, 3.3, 8.3));
  const tex = ctx.textTexture('HYAKKIYAKO SHRINE', { width: 1024, height: 192, bg: INK, color: '#ffd76a', size: 96 });
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.4), new THREE.MeshLambertMaterial({ map: tex }));
  plaque.position.set(0, 9.9, 7.35);
  g.add(plaque);
  return g;
}

/** Bell tower (shoro) with a big bronze temple bell. Returns { tower, striker }. */
function bellTower(ctx) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const stone = ctx.mat(STONE);
  const red = ctx.mat(VERMILION);
  const roof = ctx.mat('#394052');
  const bronze = ctx.mat(BRONZE, { standard: true, roughness: 0.55, metalness: 0.5 });
  g.add(box(THREE, stone, 11, 2.4, 11, 0, 0, 0));
  for (const x of [-4, 4]) for (const z of [-4, 4]) g.add(cyl(THREE, red, 0.45, 0.5, 9, x, 5.6, z, 10));
  g.add(box(THREE, red, 9.4, 0.7, 0.7, 0, 9.6, 0));
  const r = new THREE.Mesh(new THREE.ConeGeometry(8.4, 4.2, 4, 1), roof);
  r.rotation.y = Math.PI / 4;
  r.position.y = 12.1;
  r.castShadow = true;
  g.add(r);
  g.add(cyl(THREE, ctx.mat('#e9b949'), 0.35, 0.6, 1.4, 0, 14.6, 0, 8));
  // the bell
  g.add(cyl(THREE, bronze, 1.25, 1.75, 3.8, 0, 7.1, 0, 18));
  const top = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), bronze);
  top.position.y = 9.0;
  g.add(top);
  g.add(cyl(THREE, bronze, 1.85, 1.85, 0.3, 0, 5.3, 0, 18));
  g.add(cyl(THREE, bronze, 1.4, 1.4, 0.25, 0, 7.6, 0, 18));
  // striker log (animated separately)
  const striker = new THREE.Group();
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 3.4, 8), ctx.mat('#caa27a'));
  log.rotation.x = Math.PI / 2;
  log.position.set(0, -2.2, 2.8);
  striker.add(log);
  for (const s of [-1.2, 1.2]) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 4), ctx.mat('#e8d9a8'));
    rope.position.set(0, -1.1, 2.8 + s);
    striker.add(rope);
  }
  striker.position.y = 9.3;
  return { tower: g, striker };
}

/** Waterfall sheet with a scrolling streak texture. */
function waterfallMaterial(ctx) {
  const { THREE } = ctx;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8fd0f2';
  g.fillRect(0, 0, 64, 256);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.75)' : 'rgba(70,150,210,0.5)';
    g.fillRect(r() * 64, r() * 256, 1 + r() * 3, 20 + r() * 70);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false });
}

/** Wooden plank deck texture for the taiko bridge overlay. */
function planksMaterial(ctx) {
  const { THREE } = ctx;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    const v = 150 + ((i * 37) % 30);
    g.fillStyle = `rgb(${v},${Math.round(v * 0.68)},${Math.round(v * 0.45)})`;
    g.fillRect(0, i * 16, 128, 15);
    g.fillStyle = 'rgba(40,20,10,0.55)';
    g.fillRect(0, i * 16 + 15, 128, 1);
    g.fillStyle = 'rgba(40,20,10,0.25)';
    for (let k = 0; k < 3; k++) g.fillRect(((i * 53 + k * 41) % 128), i * 16 + 3, 18, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
}

/** Road-conforming strip between d0..d1, lateral lat0..lat1, lifted dy. uv: u across (0..1), v = d / vScale. */
function roadStrip(ctx, d0, d1, lat0, lat1, dy, vScale, step = 1) {
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
      uv.push(c, (d - d0) / vScale);
    }
    if (a < n) {
      const i = a * 2;
      idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // make sure the normals point up
  const nrm = geo.attributes.normal;
  if (nrm.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  return geo;
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The mountain the pass climbs: a heightfield mesh that stays under every road (terraces rising away from
 * each road at ~30 deg), opens into the chasm on wall-less edges and rises to snowy summits north and east.
 * It fades below the world terrain towards the valley (south), so the valley keeps the world's ground.
 * Returns { heightAt(x, z) -> y|null, slopeAt(x, z), x0, x1, z0, z1 }.
 */
function buildMountain(ctx) {
  const { THREE } = ctx;
  const S = ctx.path.samples;
  const voidY = ctx.voidY;
  const x0 = -250;
  const x1 = 350;
  const z0 = -360;
  const z1 = 96;
  const step = ctx.quality === 'low' ? 8 : 5;
  const nx = Math.ceil((x1 - x0) / step) + 1;
  const nz = Math.ceil((z1 - z0) / step) + 1;
  const H = new Float32Array(nx * nz);
  const sub = [];
  for (let i = 0; i < S.length; i += 2) {
    const s = S[i];
    sub.push({
      x: s.pos.x, y: s.pos.y, z: s.pos.z, rx: s.rightH.x, rz: s.rightH.z, slope: s.slope,
      extL: s.halfWidth + s.offL, extR: s.halfWidth + s.offR, voidL: !s.wallL, voidR: !s.wallR,
    });
  }
  const natural = (x, z) => {
    const north = smooth(92, -30, z);
    const summit = smooth(-110, -330, z) * 55 + smooth(230, 330, x) * 35 * smooth(60, -60, z);
    const wobble = Math.sin(x * 0.021 + z * 0.013) * 6 + Math.sin(x * 0.047 - z * 0.031) * 3 + Math.cos(z * 0.035 + 1.3) * 4;
    let m = -4 + north * (58 + summit + wobble);
    const fade = smooth(x0, x0 + 55, x) * smooth(x1, x1 - 55, x) * smooth(z0, z0 + 55, z);
    return -4 + (m + 4) * fade;
  };
  for (let gz = 0; gz < nz; gz++) {
    const z = z0 + gz * step;
    for (let gx = 0; gx < nx; gx++) {
      const x = x0 + gx * step;
      let h = natural(x, z);
      if (h > -4) {
        for (let k = 0; k < sub.length; k++) {
          const s = sub[k];
          const dx = x - s.x;
          const dz = z - s.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 40000) {
            // far: cheap bound (rises 0.6 per unit anyway)
            const c = s.y + (Math.sqrt(d2) - 40) * 0.6;
            if (c < h) h = c;
            continue;
          }
          const dist = Math.sqrt(d2);
          const lat = dx * s.rx + dz * s.rz;
          const side = lat >= 0;
          const ext = side ? s.extR : s.extL;
          const ed = dist - ext;
          const yRef = s.y + Math.max(-s.extL, Math.min(s.extR, lat)) * s.slope;
          let c = yRef - 0.8 + Math.max(0, ed - 3) * 0.6;
          if (side ? s.voidR : s.voidL) {
            const cv = voidY - 3 + Math.max(0, ed - 18) * 1.1;
            if (cv < c) c = cv;
          }
          if (c < h) h = c;
        }
      }
      H[gz * nx + gx] = h;
    }
  }
  const heightAt = (x, z) => {
    const fx = (x - x0) / step;
    const fz = (z - z0) / step;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return null;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const v = fz - iz;
    const a = H[iz * nx + ix];
    const b = H[iz * nx + ix + 1];
    const c = H[(iz + 1) * nx + ix];
    const d = H[(iz + 1) * nx + ix + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const slopeAt = (x, z) => {
    const a = heightAt(x - 2, z);
    const b = heightAt(x + 2, z);
    const c = heightAt(x, z - 2);
    const d = heightAt(x, z + 2);
    if (a === null || b === null || c === null || d === null) return 9;
    return Math.hypot(b - a, d - c) / 4;
  };

  // mesh (skip cells entirely below the world ground level to save triangles)
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const cGrass = new THREE.Color('#86b85a');
  const cGrass2 = new THREE.Color('#6a9c48');
  const cRock = new THREE.Color('#9a8c7c');
  const cRock2 = new THREE.Color('#7e7468');
  const cSnow = new THREE.Color('#f6f3f8');
  const cDeep = new THREE.Color('#4a4f5e');
  const t = new THREE.Color();
  for (let gz = 0; gz < nz; gz++)
    for (let gx = 0; gx < nx; gx++) {
      const v = gz * nx + gx;
      const x = x0 + gx * step;
      const z = z0 + gz * step;
      const h = H[v];
      pos[v * 3] = x;
      pos[v * 3 + 1] = h;
      pos[v * 3 + 2] = z;
      const sl = slopeAt(x, z);
      const n = 0.5 + 0.5 * Math.sin(x * 0.11 + Math.cos(z * 0.07) * 2);
      t.copy(cGrass).lerp(cGrass2, n);
      t.lerp(n > 0.5 ? cRock : cRock2, smooth(0.55, 1.05, sl));
      if (h > 70) t.lerp(cSnow, smooth(70, 88, h + n * 6) * (1 - smooth(1.0, 1.6, sl) * 0.5));
      if (h < -3) t.lerp(cDeep, smooth(-3, voidY, h) * 0.7);
      col[v * 3] = t.r;
      col[v * 3 + 1] = t.g;
      col[v * 3 + 2] = t.b;
    }
  const idx = [];
  for (let gz = 0; gz < nz - 1; gz++)
    for (let gx = 0; gx < nx - 1; gx++) {
      const a = gz * nx + gx;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (Math.max(H[a], H[b], H[c], H[d]) <= -3.6) continue;
      if (Math.abs(H[a] - H[d]) < Math.abs(H[b] - H[c])) idx.push(a, c, d, a, d, b);
      else idx.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.name = 'hyakkiyako-mountain';
  ctx.group.add(mesh);
  return { heightAt, slopeAt, x0, x1, z0, z1 };
}

// Key distances along the lap (from the validator's sample dump).
const D_BRIDGE0 = 252;
const D_BRIDGE1 = 304;
const D_TORII0 = 930;
const D_TORII1 = 1090;

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

  // ---------------------------------------------------------------- torii tunnel on the ridge
  {
    const transforms = [];
    const lanterns = [];
    let k = 0;
    for (let d = D_TORII0; d <= D_TORII1; d += 2.3, k++) {
      const f = ctx.frameAt(d);
      const span = f.halfWidth * 2 + f.offL + f.offR + 1.2;
      const lc = (f.offR - f.offL) / 2;
      const p = ctx.pointAt(d, lc);
      transforms.push({ x: p.x, y: p.y, z: p.z, rotY: f.yaw, scale: [span / 29.2, 1, 1] });
      if (k % 5 === 2) {
        for (const lat of [-6.5, 6.5]) {
          const q = ctx.pointAt(d, lat);
          lanterns.push({ x: q.x, y: q.y + 7.0, z: q.z, rotY: f.yaw });
        }
      }
    }
    // gates are authored with a 29.2 span and scaled on X per instance (pillar radius stays ~ok)
    ctx.instanced(toriiGate(ctx, 29.2, 8.6), transforms, { brightness: 0.06, chunk: 2000 });
    ctx.instanced(chochin(ctx), lanterns, { castShadow: false, brightness: 0.04, chunk: 2000 });
    // grand entrance / exit gates with plaques
    for (const [d, txt] of [[D_TORII0 - 6, 'SENBON TORII'], [D_TORII1 + 5, 'HYAKKIYAKO']]) {
      const f = ctx.frameAt(d);
      const span = f.halfWidth * 2 + f.offL + f.offR + 2.4;
      const g = toriiGate(ctx, span, 10.5, { plaque: txt });
      const p = ctx.pointAt(d, (f.offR - f.offL) / 2);
      ctx.instanced(g, [{ x: p.x, y: p.y, z: p.z, rotY: f.yaw }], { brightness: 0, chunk: 2000 });
    }
  }

  // ---------------------------------------------------------------- start: festival street
  {
    const chochinT = [];
    const poles = [];
    const ropes = new THREE.Group();
    const ropeMat = ctx.mat('#3a2a22');
    for (const d of [22, 50, 80, L - 26, L - 58, L - 92]) {
      const f = ctx.frameAt(d % path.length);
      const e = f.halfWidth + Math.max(f.offL, f.offR) + 1.2;
      const a = ctx.pointAt(d % path.length, -e);
      const b = ctx.pointAt(d % path.length, e);
      poles.push({ x: a.x, y: a.y - 0.5, z: a.z, rotY: f.yaw }, { x: b.x, y: b.y - 0.5, z: b.z, rotY: f.yaw });
      const n = 11;
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const sag = Math.sin(Math.PI * u) * 1.6;
        const p = new THREE.Vector3().lerpVectors(a, b, u);
        p.y += 9.6 - sag;
        if (prev) {
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, prev.distanceTo(p), 4), ropeMat);
          seg.position.copy(prev).add(p).multiplyScalar(0.5);
          seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().sub(prev).normalize());
          ropes.add(seg);
        }
        if (i > 0 && i < n) chochinT.push({ x: p.x, y: p.y, z: p.z, rotY: f.yaw });
        prev = p;
      }
    }
    ctx.instanced(chochin(ctx), chochinT, { castShadow: false, brightness: 0.05, chunk: 2000 });
    const pole = new THREE.Group();
    pole.add(cyl(THREE, ctx.mat(WOOD), 0.25, 0.3, 11, 0, 5.5, 0, 8));
    pole.add(cyl(THREE, ctx.mat(INK), 0.35, 0.35, 0.4, 0, 10.9, 0, 8));
    ctx.instanced(pole, poles, { brightness: 0, chunk: 2000 });
    ctx.instanced(ropes, [{ x: 0, y: 0, z: 0 }], { castShadow: false, brightness: 0 });

    // townhouses on both sides of the start / finish straight
    const houses = [];
    for (let d = -150; d <= 115; d += 13) {
      for (const side of [-1, 1]) {
        if (side < 0 && d > -100 && d < 60) continue; // shrine grounds on the inside
        const dd = (d + path.length) % path.length;
        const lat = edgeLat(dd, side) + 7.5 + rng() * 2;
        const p = ctx.pointAt(dd, lat);
        const f = ctx.frameAt(dd);
        if (!ctx.isClear(p.x, p.z, 5.5)) continue;
        houses.push({ x: p.x, y: gy(p.x, p.z, p.y) - 0.3, z: p.z, rotY: f.yaw + side * (Math.PI / 2), scale: 0.95 + rng() * 0.2 });
        ctx.reserve(p.x, p.z, 6);
      }
    }
    ctx.instanced(townHouse(ctx), houses, { brightness: 0.08, chunk: 2000 });

    // banners and signs
    const bannerA = [];
    const bannerB = [];
    for (let d = 8; d < 118; d += 18) {
      for (const side of [-1, 1]) {
        const p = ctx.pointAt(d, edgeLat(d, side) + 1.6);
        (side > 0 ? bannerA : bannerB).push({ x: p.x, y: p.y, z: p.z, rotY: ctx.frameAt(d).yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
      }
    }
    ctx.instanced(ctx.props.create('banner', { text: 'HYAKKIYAKO', color: VERMILION, color2: '#ffffff' }), bannerA, { brightness: 0, chunk: 2000 });
    ctx.instanced(ctx.props.create('banner', { text: 'SAKURA FEST', color: '#ff8fb8', color2: '#ffffff' }), bannerB, { brightness: 0, chunk: 2000 });
  }

  // ---------------------------------------------------------------- shrine grounds inside the loop
  {
    const hallX = -22;
    const hallZ = 128;
    const hall = shrineHall(ctx);
    hall.position.set(hallX, gy(hallX, hallZ, 0) + 0.2, hallZ);
    hall.rotation.y = 0; // faces +Z (towards the start straight)
    ctx.instanced(hall, [{ x: hall.position.x, y: hall.position.y, z: hallZ, rotY: 0 }], { brightness: 0 });
    ctx.reserve(hallX, hallZ, 16);

    const bx = -62;
    const bz = 142;
    const { tower, striker } = bellTower(ctx);
    const by = gy(bx, bz, 0) + 0.2;
    ctx.instanced(tower, [{ x: bx, y: by, z: bz, rotY: 0.4 }], { brightness: 0 });
    striker.position.set(bx, by + 9.3, bz);
    striker.rotation.y = 0.4;
    ctx.group.add(striker);
    ctx.reserve(bx, bz, 8);
    ctx.addAnimated((dt, time) => {
      striker.rotation.x = Math.sin(time * 1.3) * 0.28;
    });

    // approach: stone path lined by stone lanterns and a gate
    const path0 = new THREE.Vector3(hallX, 0, hallZ + 14);
    const lanterns = [];
    for (let z = hallZ + 16; z < hallZ + 48; z += 6) {
      for (const s of [-1, 1]) {
        const x = hallX + s * 5.5;
        lanterns.push({ x, y: gy(x, z), z, rotY: s > 0 ? -Math.PI / 2 : Math.PI / 2, scale: 1.1 });
      }
    }
    ctx.instanced('stoneLantern', lanterns, { brightness: 0.03, chunk: 2000 });
    const walk = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 38), ctx.mat('#cfc6b6'));
    walk.position.set(hallX, gy(hallX, hallZ + 32) + 0.05, hallZ + 32);
    walk.receiveShadow = true;
    ctx.group.add(walk);
    void path0;
    const g = toriiGate(ctx, 9, 8.5, { plaque: 'SHRINE' });
    const gz = hallZ + 44;
    ctx.instanced(g, [{ x: hallX, y: gy(hallX, gz), z: gz, rotY: 0 }], { brightness: 0 });
    ctx.reserve(hallX, hallZ + 30, 7);

    // five-storey pagoda on the hill behind
    const pgX = 38;
    const pgZ = 112;
    const pagoda = ctx.props.create('pagoda', { scale: 1.9, color: VERMILION, color2: '#353c4e' });
    pagoda.position.set(pgX, gy(pgX, pgZ, 0) - 0.2, pgZ);
    pagoda.rotation.y = 0.3;
    ctx.group.add(pagoda);
    ctx.reserve(pgX, pgZ, 11);

    // koi pond with stepping stones
    const pdX = 95;
    const pdZ = 148;
    let py = -Infinity;
    for (let a = 0; a < 8; a++) py = Math.max(py, gy(pdX + Math.cos(a) * 13, pdZ + Math.sin(a) * 13, 0));
    const pond = new THREE.Mesh(new THREE.CircleGeometry(15, 32), ctx.mat('#4fa4d8', { emissive: '#1c5f8a', emissiveIntensity: 0.25 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(pdX, py + 0.15, pdZ);
    pond.receiveShadow = true;
    ctx.group.add(pond);
    const rim = [];
    for (let a = 0; a < 26; a++) {
      const t = (a / 26) * Math.PI * 2;
      const r = 15 + rng() * 1.2;
      rim.push({ x: pdX + Math.cos(t) * r, y: py - 0.2, z: pdZ + Math.sin(t) * r, rotY: rng() * 6, scale: 0.8 + rng() * 0.7 });
    }
    ctx.instanced('rock', rim, { color: '#8e8a86', chunk: 2000 });
    // koi (bobbing slowly)
    const koi = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshLambertMaterial({ color: '#ffffff' }), 7);
    const koiCols = ['#ff6a2a', '#ffffff', '#ffb02a', '#ff4a3a'];
    const kc = new THREE.Color();
    for (let i = 0; i < 7; i++) koi.setColorAt(i, kc.set(koiCols[i % 4]));
    koi.position.set(pdX, py + 0.05, pdZ);
    koi.frustumCulled = false;
    ctx.group.add(koi);
    const km = new THREE.Object3D();
    ctx.addAnimated((dt, time) => {
      for (let i = 0; i < 7; i++) {
        const a = time * (0.25 + i * 0.04) + i * 0.9;
        const r = 4 + (i % 3) * 3;
        km.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        km.rotation.set(0, -a, 0);
        km.scale.set(0.6, 0.3, 1.6);
        km.updateMatrix();
        koi.setMatrixAt(i, km.matrix);
      }
      koi.instanceMatrix.needsUpdate = true;
    });
    ctx.reserve(pdX, pdZ, 17);
  }

  // ---------------------------------------------------------------- taiko bridge over the gorge
  {
    const deck = new THREE.Mesh(roadStrip(ctx, D_BRIDGE0 + 2, D_BRIDGE1 - 2, -9.2, 9.2, 0.035, 9.2), planksMaterial(ctx));
    deck.material.map.repeat.set(1, 1);
    deck.receiveShadow = true;
    ctx.group.add(deck);

    const bridge = new THREE.Group();
    const red = ctx.mat(VERMILION);
    const redD = ctx.mat(VERMILION_D);
    const wood = ctx.mat('#5a3d2a');
    const bronze = ctx.mat(BRONZE);
    // fascia beams along both edges (below the road edge) + posts down into the gorge
    for (const side of [-1, 1]) {
      let prev = null;
      for (let d = D_BRIDGE0; d <= D_BRIDGE1; d += 2) {
        const lat = edgeLat(d, side);
        const p = ctx.pointAt(d, lat);
        if (prev) {
          const len = prev.distanceTo(p);
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, len + 0.1), red);
          m.position.copy(prev).add(p).multiplyScalar(0.5);
          m.position.y -= 0.75;
          m.lookAt(p.x, p.y - 0.75, p.z);
          bridge.add(m);
        }
        prev = p;
      }
      // giboshi posts at the ends
      for (const d of [D_BRIDGE0 + 1, D_BRIDGE1 - 1]) {
        const p = ctx.pointAt(d, edgeLat(d, side) - 0.2);
        bridge.add(cyl(THREE, red, 0.35, 0.35, 2.2, p.x, p.y + 1.1, p.z, 8));
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), bronze);
        cap.scale.set(1, 1.3, 1);
        cap.position.set(p.x, p.y + 2.5, p.z);
        bridge.add(cap);
      }
    }
    // trestle bents down to the river
    const bottom = ctx.voidY - 1;
    for (const d of [D_BRIDGE0 + 14, (D_BRIDGE0 + D_BRIDGE1) / 2, D_BRIDGE1 - 14]) {
      const f = ctx.frameAt(d);
      const legs = [];
      for (const lat of [-edgeLat(d, 1) + 1.2, -4, 4, edgeLat(d, 1) - 1.2]) {
        const p = ctx.pointAt(d, lat);
        const h = p.y - 1.4 - bottom;
        bridge.add(cyl(THREE, wood, 0.55, 0.7, h, p.x, bottom + h / 2, p.z, 8));
        legs.push(p);
      }
      // cross beams
      for (const yy of [-6, -13]) {
        const a = legs[0];
        const b = legs[3];
        const m = new THREE.Mesh(new THREE.BoxGeometry(a.distanceTo(b) + 1, 0.6, 0.6), wood);
        m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + yy, (a.z + b.z) / 2);
        m.rotation.y = f.yaw + Math.PI / 2;
        bridge.add(m);
      }
    }
    // big decorative arch under the deck on both faces
    for (const side of [-1, 1]) {
      let prev = null;
      for (let i = 0; i <= 16; i++) {
        const u = i / 16;
        const d = D_BRIDGE0 + 4 + (D_BRIDGE1 - D_BRIDGE0 - 8) * u;
        const p = ctx.pointAt(d, edgeLat(d, side) - 0.4);
        p.y = p.y - 1.4 - (1 - Math.sin(Math.PI * u)) * 12;
        if (prev) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, prev.distanceTo(p) + 0.2), redD);
          m.position.copy(prev).add(p).multiplyScalar(0.5);
          m.lookAt(p);
          bridge.add(m);
        }
        prev = p;
      }
    }
    ctx.instanced(bridge, [{ x: 0, y: 0, z: 0 }], { brightness: 0 });

    // waterfall into the gorge on the east (right) side
    const dW = (D_BRIDGE0 + D_BRIDGE1) / 2;
    const fW = ctx.frameAt(dW);
    const base = ctx.pointAt(dW, 36);
    const top = 16;
    const H = top - bottom;
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(12, H, 1, 1), waterfallMaterial(ctx));
    fall.position.set(base.x, bottom + H / 2, base.z);
    fall.rotation.y = fW.yaw - Math.PI / 2; // face the bridge (towards -right)
    ctx.group.add(fall);
    const wm = fall.material.map;
    ctx.addAnimated((dt) => {
      wm.offset.y += dt * 1.1;
    });
    // rocky cliff behind the waterfall
    const rocks = [];
    for (let i = 0; i < 26; i++) {
      const lat = 38 + rng() * 14;
      const along = (rng() - 0.5) * 34;
      const p = ctx.pointAt(dW + along, lat);
      const y = bottom + rng() * (H + 4);
      if (Math.abs(along) < 7 && lat < 43 && y > bottom + 2) continue; // keep the fall visible
      rocks.push({ x: p.x, y, z: p.z, rotY: rng() * 6, scale: 1.3 + rng() * 1.4 });
    }
    ctx.instanced('boulder', rocks, { color: '#8c8a94', color2: '#747480', castShadow: false, chunk: 2000 });
    // foam at the base
    const foam = new THREE.Mesh(new THREE.CircleGeometry(8, 20), ctx.mat('#ffffff', { opacity: 0.75 }));
    foam.rotation.x = -Math.PI / 2;
    const fp = ctx.pointAt(dW, 32);
    foam.position.set(fp.x, ctx.voidY + 0.3, fp.z);
    ctx.group.add(foam);
    ctx.addAnimated((dt, time) => {
      const s = 1 + Math.sin(time * 3.1) * 0.08;
      foam.scale.set(s, s, 1);
    });
    ctx.reserve(base.x, base.z, 20);
  }

  // ---------------------------------------------------------------- the mountain (terraced slopes under the climb)
  {
    const M = buildMountain(ctx);
    const hAt = M.heightAt;
    // trees on the mountain (the regular decorations only cover the valley sections)
    const sak = [];
    const pines = [];
    const rocks = [];
    const nTry = hi ? 2600 : 1200;
    for (let i = 0; i < nTry; i++) {
      const x = M.x0 + rng() * (M.x1 - M.x0);
      const z = M.z0 + rng() * (M.z1 - M.z0);
      const h = hAt(x, z);
      if (h === null || h < gy(x, z, 0) + 1.5) continue; // not on the mountain
      if (M.slopeAt(x, z) > 1.25) continue;
      if (!ctx.isClear(x, z, 3.2)) continue;
      const r = rng();
      if (h > 62) {
        if (r < 0.5) pines.push({ x, y: h - 0.3, z, rotY: rng() * 6.28, scale: 0.9 + rng() * 0.6 });
      } else if (r < 0.45) sak.push({ x, y: h - 0.3, z, rotY: rng() * 6.28, scale: 1.0 + rng() * 0.7 });
      else if (r < 0.8) pines.push({ x, y: h - 0.3, z, rotY: rng() * 6.28, scale: 1.0 + rng() * 0.7 });
      else if (r < 0.9) rocks.push({ x, y: h - 0.4, z, rotY: rng() * 6.28, scale: 1 + rng() * 1.5 });
    }
    const cap = (arr, n) => arr.slice(0, n);
    ctx.instanced('sakuraTree', cap(sak, hi ? 105 : 60), { chunk: 300, castShadow: false });
    ctx.instanced('pine', cap(pines, hi ? 220 : 110), { chunk: 600, color: '#3f7a4a', castShadow: false });
    ctx.instanced('boulder', cap(rocks, 40), { chunk: 2000, color: '#8e8678', castShadow: false });

    // small torii and stone lanterns along the hairpin climb (on the terraces)
    const small = [];
    const stoneL = [];
    for (const d of [470, 520, 690, 735, 860, 1120]) {
      const f = ctx.frameAt(d);
      const side = f.curvature > 0 ? -1 : 1; // outside of the corner
      const p = ctx.pointAt(d, edgeLat(d, side) + 5);
      const h = hAt(p.x, p.z) ?? gy(p.x, p.z, p.y);
      if (!ctx.isClear(p.x, p.z, 2.5)) continue;
      small.push({ x: p.x, y: h, z: p.z, rotY: f.yaw + Math.PI / 2, scale: 0.42 });
      for (const s of [-1, 1]) {
        const q = ctx.pointAt(d + s * 5, edgeLat(d, side) + 5);
        stoneL.push({ x: q.x, y: hAt(q.x, q.z) ?? h, z: q.z, rotY: f.yaw });
      }
    }
    if (small.length) ctx.instanced(toriiGate(ctx, 10, 8), small, { brightness: 0.05, chunk: 2000 });
    if (stoneL.length) ctx.instanced('stoneLantern', stoneL, { brightness: 0.03, chunk: 2000 });
  }

  // ---------------------------------------------------------------- signs
  {
    const credits = ctx.props.create('sign', { text: 'CREDITS!', color: '#ffd23f' });
    ctx.place(credits, { d: 1194, lateral: -(ctx.frameAt(1194).halfWidth + ctx.frameAt(1194).offL + 2), yaw: 0.6, y: -0.5 });
    const warn = ctx.props.create('sign', { text: 'CLIFF AHEAD', color: '#ff5a3c' });
    ctx.place(warn, { d: 1146, lateral: -(ctx.frameAt(1146).halfWidth + ctx.frameAt(1146).offL + 2), yaw: 0.6, y: -0.5 });
    const jump = ctx.props.create('sign', { text: 'JUMP!', color: '#39c0ff' });
    ctx.place(jump, { d: 1300, lateral: -(ctx.frameAt(1300).halfWidth + ctx.frameAt(1300).offL + 2), yaw: 0.6, y: -0.5 });
  }
  void hi;
}

export default {
  id: 'hyakkiyako-sakura',
  name: 'Hyakkiyako Sakura Pass',
  laps: 3,
  width: 20,
  offroad: 6,
  wall: true,
  points: [
    // start straight (festival street), heading east
    { x: 0, y: 0, z: 200, w: 24, off: 7 },
    { x: 70, y: 0, z: 200, w: 24 },
    { x: 135, y: 0.5, z: 196, w: 22 },
    // T1: fast left sweeper to the north
    { x: 185, y: 1, z: 172, bank: -8 },
    { x: 208, y: 2, z: 134, bank: -4 },
    // red taiko bridge over the gorge (no walls: river far below)
    { x: 213, y: 5.5, z: 106, w: 20, off: 5, wall: false },
    { x: 218, y: 5.5, z: 82, w: 20, off: 5, wall: false },
    { x: 223, y: 3.5, z: 56 },
    // leg A: climbing north
    { x: 234, y: 12, z: -40 },
    // hairpin 1 (left)
    ...arc(207, -88, 29, 0.25, -Math.PI - 0.25, 7, 15.5, 18.5, { w: 19, offL: 3, bank: -7 }),
    // leg B: climbing south
    { x: 176, y: 22, z: -40 },
    // hairpin 2 (right)
    ...arc(147.5, 16, 28.5, -0.25, Math.PI + 0.25, 7, 26.5, 29.5, { w: 19, offR: 3, bank: 7 }),
    // leg C: climbing north
    { x: 119, y: 34, z: -50 },
    { x: 116, y: 37, z: -100, w: 20 },
    // left onto the ridge
    { x: 100, y: 38.5, z: -138, bank: -5 },
    { x: 60, y: 39, z: -152, w: 20, off: 4 },
    // senbon torii tunnel, heading west
    { x: -10, y: 40, z: -154, w: 20, off: 4 },
    { x: -80, y: 40, z: -152, w: 20, off: 4 },
    // left, down the west cliff (void on the right)
    { x: -126, y: 39.5, z: -136, bank: -5, w: 22, off: 8 },
    { x: -148, y: 37.5, z: -96, w: 22, offR: 10, wallR: false },
    { x: -156, y: 33, z: -40, w: 22, offR: 10, wallR: false },
    { x: -152, y: 28, z: 10, w: 22, offR: 10, wallR: false },
    { x: -146, y: 24.5, z: 50, w: 21 },
    // crest + jump, then the descent S-bends
    { x: -136, y: 19, z: 92, w: 21 },
    { x: -118, y: 13, z: 128, bank: 4 },
    { x: -112, y: 7, z: 160, bank: -4, offL: 10 },
    // final left into the start straight
    { x: -96, y: 2, z: 188, bank: -7, w: 22 },
    { x: -60, y: 0, z: 200, w: 24, off: 7 },
  ],
  features: [
    { type: 'itemRow', d: 62, count: 5, spacing: 4.4 },
    { type: 'hazard', d: 98, lateral: 9.5, kind: 'barrel', radius: 1.2, effect: 'bump' },
    { type: 'hazard', d: 101, lateral: 11, kind: 'barrel', radius: 1.2, effect: 'bump' },
    { type: 'coins', d: 150, count: 5, spacing: 4, lateral: -6 },
    { type: 'coins', d: 266, count: 6, spacing: 4, lateral: -12 }, // bridge edge, above the gorge
    { type: 'boost', d: 330, lateral: 3, length: 8, width: 5 },
    { type: 'coins', d: 500, count: 4, spacing: 4, lateral: -6 },
    { type: 'itemRow', d: 588, count: 4, spacing: 4.4 },
    { type: 'boost', d: 798, lateral: 0, length: 8, width: 5 },
    { type: 'itemRow', d: 968, count: 4, spacing: 4.4 },
    { type: 'boost', d: 1018, lateral: -4, length: 8, width: 5 },
    { type: 'coins', d: 1046, count: 6, spacing: 4, lateral: 5 },
    { type: 'hazard', d: 1142, lateral: -8.5, kind: 'stoneLantern', radius: 1.0, effect: 'bump' },
    { type: 'coins', d: 1211, count: 6, spacing: 4.5, lateral: 13 }, // cliff edge, above the abyss
    { type: 'itemRow', d: 1268, count: 5, spacing: 4.4 },
    { type: 'ramp', d: 1322, lateral: 0, length: 10, width: 13, power: 0.9 },
    { type: 'coins', d: 1446, count: 5, spacing: 5, lateral: 0 },
    { type: 'hazard', d: 1454, lateral: 7.5, kind: 'rock', radius: 1.3, effect: 'bump' },
    { type: 'boost', d: 1512, lateral: -3, length: 8, width: 5 },
  ],
  decorations: [
    // valley sections only (the mountain builds its own forest in scenery())
    { kind: 'sakuraTree', count: 100, side: 'both', minOffset: 2, maxOffset: 70, scale: [0.9, 1.6], seed: 11, tRange: [0.87, 0.19], variants: 1 },
    { kind: 'pine', count: 30, side: 'both', minOffset: 20, maxOffset: 110, scale: [1.0, 1.6], seed: 13, tRange: [0.87, 0.19] },
    { kind: 'bush', count: 40, side: 'both', minOffset: 0.5, maxOffset: 10, scale: [0.8, 1.4], seed: 14, color: '#5f9a44', tRange: [0.87, 0.19] },
    { kind: 'rock', count: 24, side: 'both', minOffset: 1, maxOffset: 30, scale: [0.8, 1.8], seed: 15, tRange: [0.87, 0.19] },
    { kind: 'lantern', every: 22, side: 'left', offset: 1.2, tRange: [0.86, 0.96] },
  ],
  theme: {
    preset: 'sakura',
    sky: { top: '#3a4796', bottom: '#ff9d7c', horizon: '#ffbf86', sunDisc: true, clouds: true },
    fog: { color: '#eea68e', near: 160, far: 800 },
    sun: { color: '#ffb577', intensity: 2.1, dir: [-0.75, 0.33, 0.45] },
    ambient: { sky: '#ffc4b4', ground: '#5e4a6a', intensity: 0.95 },
    ground: { type: 'grass', color: '#93bf62', color2: '#78a64e' },
    road: { style: 'stone', color: '#b8ab9a', color2: '#a39684', lines: false },
    edge: { style: 'curb', colorA: '#d6283a', colorB: '#fff4ea' },
    offroad: { type: 'grass', color: '#8fbf5f' },
    wall: { style: 'fence', color: INK, color2: VERMILION },
    void: { type: 'water', color: '#3f76b0' },
    grip: 1.0,
    particles: 'petals',
    music: 'hyakkiyako',
    night: false,
  },
  scenery,
};
