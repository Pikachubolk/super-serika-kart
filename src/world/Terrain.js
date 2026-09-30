// Terrain, void surfaces and the distant backdrop (owner: world agent).
//
// buildTerrain(W) where W is the TrackBuilder build context. Returns:
//   { terrainHeight(x, z) -> number|null   height of the terrain mesh (null = no solid ground here),
//     groundAt(x, z) -> number|null        terrain OR embankment surface under (x, z) (null = nothing solid),
//     voidY, voidMesh, update(dt, time) }
//
// Solid ground (sand/grass/asphalt/snow/rock): a heightfield grid, dense around the track and growing
// towards the horizon. Heights = natural rolling terrain (hills rise away from the track) clamped by
// constraints from every track sample, so the ground always stays under the road, lower roads stay visible
// under bridges, and wall-less edges open into a chasm with the void surface at the bottom.
// Liquid ground (lava/water): the animated liquid plane is the ground; roads sit on embankments.
// Floating ground (cloud/space/none): only the void surface far below (cloud sea / starry abyss).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, clamp, smoothstep, lerp } from '../core/utils.js';
import { createVoidMaterial } from './shaders.js';
import { mixHex, shade, cloudTexture, glowTexture } from './textures.js';
import { WALL_THICKNESS } from './Corridor.js';
import { windowTextures } from './Props.js';

// ---------------------------------------------------------------------------------------------------------
// JS value noise
// ---------------------------------------------------------------------------------------------------------
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  const rng = mulberry32(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rng();
  const h = (x, z) => vals[perm[(perm[x & 255] + z) & 511]];
  const noise = (x, z) => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const xf = x - xi;
    const zf = z - zi;
    const u = xf * xf * (3 - 2 * xf);
    const v = zf * zf * (3 - 2 * zf);
    const a = h(xi, zi);
    const b = h(xi + 1, zi);
    const c = h(xi, zi + 1);
    const d = h(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, z, oct = 4) => {
    let s = 0;
    let a = 0.5;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      s += a * noise(x, z);
      norm += a;
      x = x * 2.03 + 17.1;
      z = z * 2.03 - 9.3;
      a *= 0.5;
    }
    return s / norm;
  };
  return { noise, fbm };
}

const GROUND_SHAPE = {
  sand: { amp1: 3.2, amp2: 0.7, hills: 26 },
  grass: { amp1: 2.2, amp2: 0.45, hills: 34 },
  asphalt: { amp1: 0, amp2: 0, hills: 0 },
  snow: { amp1: 2.6, amp2: 0.6, hills: 55 },
  rock: { amp1: 3.8, amp2: 1.1, hills: 48 },
};

function axis(lo, hi, center, fine, far) {
  const pts = [];
  const n = Math.max(2, Math.ceil((hi - lo) / fine));
  for (let i = 0; i <= n; i++) pts.push(lo + ((hi - lo) * i) / n);
  const left = [];
  let s = fine;
  let x = lo;
  while (x > center - far) {
    s *= 1.25;
    x = Math.max(center - far, x - s);
    left.push(x);
  }
  const right = [];
  s = fine;
  x = hi;
  while (x < center + far) {
    s *= 1.25;
    x = Math.min(center + far, x + s);
    right.push(x);
  }
  return [...left.reverse(), ...pts, ...right];
}

function lowerIndex(arr, v) {
  let lo = 0;
  let hi = arr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function buildTerrain(W) {
  const { path, theme, analysis: A, corridor, kit, quality, group } = W;
  const S = path.samples;
  const N = path.count;
  const b = path.bounds;
  const center = W.center;
  const gType = theme.ground.type;
  const noise = makeNoise(W.seed ^ 0x5eed);
  const out = { voidY: A.voidY, terrainHeight: () => null, groundAt: () => null, update: () => {} };
  const animated = [];

  // ---------------------------------------------------------------------------------------------------
  // Heightfield (solid ground)
  // ---------------------------------------------------------------------------------------------------
  if (A.solid) {
    const shape = GROUND_SHAPE[gType] || GROUND_SHAPE.grass;
    const fine = quality === 'high' ? 7 : quality === 'medium' ? 9 : 12;
    const far = 2300;
    const xs = axis(b.min.x - 150, b.max.x + 150, center.x, fine, far);
    const zs = axis(b.min.z - 150, b.max.z + 150, center.z, fine, far);
    const nx = xs.length;
    const nz = zs.length;
    const V = nx * nz;
    const cons = new Float32Array(V).fill(Infinity);
    const edgeDist = new Float32Array(V).fill(Infinity);
    const base = A.groundBase;
    const chasmW = 16;

    // splat constraints from samples
    const flat = 12;
    const slopeUp = 0.5;
    const stride = 2;
    for (let i = 0; i < N; i += stride) {
      const s = S[i];
      const extL = s.halfWidth + s.offL;
      const extR = s.halfWidth + s.offR;
      const hasVoid = !s.wallL || !s.wallR;
      const R = Math.max(extL, extR) + (hasVoid ? chasmW + 60 : 55);
      const ix0 = lowerIndex(xs, s.pos.x - R);
      const ix1 = lowerIndex(xs, s.pos.x + R) + 1;
      const iz0 = lowerIndex(zs, s.pos.z - R);
      const iz1 = lowerIndex(zs, s.pos.z + R) + 1;
      for (let gz = iz0; gz <= iz1 && gz < nz; gz++) {
        const z = zs[gz];
        const dz = z - s.pos.z;
        for (let gx = ix0; gx <= ix1 && gx < nx; gx++) {
          const x = xs[gx];
          const dx = x - s.pos.x;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > R) continue;
          const lat = dx * s.rightH.x + dz * s.rightH.z;
          const side = lat >= 0 ? 1 : -1;
          const ext = side > 0 ? extR : extL;
          const ed = dist - ext;
          const v = gz * nx + gx;
          if (ed < edgeDist[v]) edgeDist[v] = ed;
          const yRef = s.pos.y + clamp(lat, -extL, extR) * s.slope;
          let c = yRef - 0.7 + Math.max(0, ed - flat) * slopeUp;
          const isVoid = side > 0 ? !s.wallR : !s.wallL;
          if (isVoid) {
            const cv = A.voidY - 2 + Math.max(0, ed - chasmW) * 1.1;
            if (cv < c) c = cv;
          }
          if (c < cons[v]) cons[v] = c;
        }
      }
    }
    // coarse distance for vertices far from the track
    const coarse = [];
    for (let i = 0; i < N; i += 8) coarse.push(S[i]);
    const extAvg = S.reduce((a, s) => a + s.halfWidth + (s.offL + s.offR) / 2, 0) / N;

    const hts = new Float32Array(V);
    const pos = new Float32Array(V * 3);
    const col = new Float32Array(V * 3);
    const uv = new Float32Array(V * 2);
    const cA = new THREE.Color(theme.ground.color);
    const cB = new THREE.Color(theme.ground.color2);
    const cHill = new THREE.Color(mixHex(theme.ground.color2, theme.ground.color, 0.3));
    const cSnowCap = new THREE.Color('#ffffff');
    const tmp = new THREE.Color();
    const tile = 14;
    for (let gz = 0; gz < nz; gz++) {
      for (let gx = 0; gx < nx; gx++) {
        const v = gz * nx + gx;
        const x = xs[gx];
        const z = zs[gz];
        let ed = edgeDist[v];
        if (!isFinite(ed)) {
          let best = Infinity;
          for (const s of coarse) {
            const d = (x - s.pos.x) ** 2 + (z - s.pos.z) ** 2;
            if (d < best) best = d;
          }
          ed = Math.sqrt(best) - extAvg;
        }
        const hill = smoothstep(45, 420, ed);
        const n1 = noise.fbm(x * 0.008, z * 0.008) - 0.5;
        const n2 = noise.fbm(x * 0.035, z * 0.035, 3) - 0.5;
        const n3 = noise.fbm(x * 0.0035 + 5, z * 0.0035 - 3, 3);
        let h = base + n1 * shape.amp1 * (0.35 + 0.65 * smoothstep(10, 80, ed)) + n2 * shape.amp2 + hill * shape.hills * (0.35 + 1.1 * n3);
        if (gType === 'sand') h += Math.pow(Math.abs(Math.sin(x * 0.012 + n1 * 3) * Math.cos(z * 0.009 + n2)), 2) * 6 * smoothstep(20, 140, ed);
        h = Math.min(h, cons[v]);
        hts[v] = h;
        pos[v * 3] = x;
        pos[v * 3 + 1] = h;
        pos[v * 3 + 2] = z;
        uv[v * 2] = x / tile;
        uv[v * 2 + 1] = z / tile;
        const m = noise.fbm(x * 0.02 + 40, z * 0.02 - 11, 3);
        tmp.copy(cA).lerp(cB, smoothstep(0.35, 0.65, m));
        tmp.lerp(cHill, clamp((h - base) / 40, 0, 0.5));
        if (gType === 'snow' || (gType === 'rock' && theme.particles === 'snow')) {
          tmp.lerp(cSnowCap, clamp((h - base - 25) / 20, 0, 0.8));
        }
        if (gType === 'grass' && h - base > 30) tmp.lerp(cSnowCap.clone().setHex(0x8fa07a), clamp((h - base - 30) / 30, 0, 0.5));
        // deep chasm walls darken
        if (h < base - 3) tmp.multiplyScalar(clamp(1 + (h - base) / 30, 0.35, 1));
        col[v * 3] = tmp.r;
        col[v * 3 + 1] = tmp.g;
        col[v * 3 + 2] = tmp.b;
      }
    }
    const idx = [];
    for (let gz = 0; gz < nz - 1; gz++)
      for (let gx = 0; gx < nx - 1; gx++) {
        const a = gz * nx + gx;
        const b2 = a + 1;
        const c = a + nx;
        const d = c + 1;
        // alternate diagonal to follow height changes better
        if (Math.abs(hts[a] - hts[d]) < Math.abs(hts[b2] - hts[c])) idx.push(a, c, d, a, d, b2);
        else idx.push(a, c, b2, b2, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const det = kit.groundDetail(gType === 'rock' ? 'rock' : gType);
    const mat = new THREE.MeshLambertMaterial({ map: det.map, vertexColors: true });
    W.terrainMaterial = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    mesh.receiveShadow = true;
    group.add(mesh);
    W.disposables.push(geo, mat);

    out.terrainHeight = (x, z) => {
      if (x < xs[0] || x > xs[nx - 1] || z < zs[0] || z > zs[nz - 1]) return base;
      const gx = lowerIndex(xs, x);
      const gz = lowerIndex(zs, z);
      const u = (x - xs[gx]) / (xs[gx + 1] - xs[gx]);
      const w = (z - zs[gz]) / (zs[gz + 1] - zs[gz]);
      const a = hts[gz * nx + gx];
      const b2 = hts[gz * nx + gx + 1];
      const c = hts[(gz + 1) * nx + gx];
      const d = hts[(gz + 1) * nx + gx + 1];
      return lerp(lerp(a, b2, u), lerp(c, d, u), w);
    };
  } else if (A.liquid) {
    out.terrainHeight = () => A.voidY;
  }

  // ---------------------------------------------------------------------------------------------------
  // Void / liquid surface
  // ---------------------------------------------------------------------------------------------------
  const needVoid = A.liquid || A.floating || A.hasVoid;
  if (needVoid) {
    let type = theme.void.type;
    if (A.liquid) type = gType; // lava / water ground IS the surface
    if (gType === 'cloud') type = 'sky';
    if (gType === 'space') type = 'abyss';
    const vc = A.liquid ? theme.ground.color : theme.void.color;
    const colors = {
      lava: { colA: vc || '#ff5a1f', colB: A.liquid ? theme.ground.color2 : '#ffd23f', colC: '#2a1411' },
      water: { colA: shade(vc || '#2f78b8', -0.25), colB: shade(vc || '#2f78b8', 0.15), colC: '#ffffff', sky: theme.sky.horizon },
      sky: { colA: '#ffffff', colB: mixHex(theme.sky.bottom, theme.sky.top, 0.45), colC: mixHex('#c9d6ea', theme.sky.bottom, 0.4) },
      abyss: { colA: vc || '#6a3cff', colB: theme.edge.colorB || '#ff4fd8', colC: '#04050d' },
    }[type];
    if (gType === 'cloud') {
      colors.colA = theme.ground.color || '#ffffff';
      colors.colC = mixHex(theme.ground.color2 || '#e3eeff', '#b8c6e0', 0.35);
    }
    const mat = createVoidMaterial(type, { ...colors, sunDir: W.sunDir, sunColor: theme.sun.color });
    const size = 9000;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `void:${type}`;
    mesh.position.set(center.x, A.voidY, center.z);
    mesh.frustumCulled = false;
    group.add(mesh);
    W.disposables.push(geo, mat);
    out.voidMesh = mesh;
    out.voidType = type;
    animated.push((dt, time) => (mat.uniforms.uTime.value = time));
    // lava glows: a faint warm hemisphere from below is handled by the theme ambient; add glow billboards
  }

  // ---------------------------------------------------------------------------------------------------
  // groundAt: terrain or embankment surface
  // ---------------------------------------------------------------------------------------------------
  const skirtReach = (H) => clamp(H * 1.4, 0.8, 55);
  out.skirtReach = skirtReach;
  out.groundAt = (x, z) => {
    let g = out.terrainHeight(x, z);
    const n = corridor.nearest(x, z, 120);
    if (n && n.dist < n.ext + 80) {
      const s = n.s;
      const i = n.index;
      const isVoid = n.side > 0 ? !s.wallR : !s.wallL;
      if (n.dist <= n.ext + 0.05) {
        // on the corridor itself
        return s.pos.y + clamp(n.lateral, -(s.halfWidth + s.offL), s.halfWidth + s.offR) * s.slope;
      }
      if (!A.bridge[i] && !isVoid && (A.solid || A.liquid)) {
        const edgeY = s.pos.y + n.side * n.ext * s.slope;
        const foot = g ?? A.voidY;
        const H = edgeY - foot;
        if (H > 0) {
          const o = n.dist - n.ext - (n.side > 0 ? (s.wallR ? WALL_THICKNESS : 0) : s.wallL ? WALL_THICKNESS : 0);
          const reach = skirtReach(H);
          if (o < reach) {
            const t = clamp(o / reach, 0, 1);
            const y = edgeY - H * skirtProfile(t);
            g = g === null ? y : Math.max(g, y);
          }
        }
      }
    }
    return g;
  };

  // ---------------------------------------------------------------------------------------------------
  // Backdrop silhouettes
  // ---------------------------------------------------------------------------------------------------
  buildBackdrop(W, out, animated);

  out.update = (dt, time) => {
    for (const f of animated) f(dt, time);
  };
  return out;
}

/** Embankment profile: t = 0 at the corridor edge .. 1 at the foot; returns fraction of the drop. Concave. */
export function skirtProfile(t) {
  return 1 - (1 - t) * (1 - t);
}

// ---------------------------------------------------------------------------------------------------------
// Backdrop rings
// ---------------------------------------------------------------------------------------------------------
function ridgeFn(rng, count, sharp) {
  const waves = [];
  for (let k = 0; k < count; k++) waves.push({ f: 2 + Math.floor(rng() * (6 + k * 5)), p: rng() * Math.PI * 2, a: 1 / (1 + k * 0.8) });
  const norm = waves.reduce((a, w) => a + w.a, 0);
  return (a) => {
    let s = 0;
    for (const w of waves) s += w.a * Math.pow(0.5 + 0.5 * Math.sin(a * w.f + w.p), sharp);
    return s / norm;
  };
}

function ringStrip({ R, baseY, segs, heightFn, colorFn, lean = 0.25 }) {
  const pos = [];
  const col = [];
  const idx = [];
  const rows = [0, 0.35, 0.7, 1];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const h = heightFn(a);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let r = 0; r < rows.length; r++) {
      const t = rows[r];
      const y = baseY - 40 + (h + 40) * t;
      const rr = R + h * lean * t;
      pos.push(ca * rr, y, sa * rr);
      const c = colorFn(t, h, a);
      col.push(c.r, c.g, c.b);
    }
    if (i < segs) {
      const k = i * rows.length;
      const n = rows.length;
      for (let r = 0; r < rows.length - 1; r++) idx.push(k + r, k + r + 1, k + n + r, k + r + 1, k + n + r + 1, k + n + r);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function buildBackdrop(W, out, animated) {
  const { theme, group, quality, center } = W;
  const gType = theme.ground.type;
  const rng = mulberry32(W.seed ^ 0xbac0);
  const fogC = new THREE.Color(theme.fog.color);
  const horizonC = new THREE.Color(theme.sky.horizon);
  const hazeTarget = fogC.clone().lerp(horizonC, 0.3);
  const rad = W.radius;
  const R1 = Math.min(1150, rad + 420);
  const R2 = Math.min(1450, rad + 800);
  const baseY = (W.analysis.solid ? W.analysis.groundBase : W.analysis.voidY) - 2;
  const segs = quality === 'low' ? 90 : 180;
  const geos = [];
  const night = theme.night;
  const hazed = (hex, amt) => new THREE.Color(hex).lerp(hazeTarget, amt);

  const addMountains = (R, H, sharp, colBase, colTop, haze, snowLine = 2) => {
    const f = ridgeFn(rng, 6, sharp);
    const cb = hazed(colBase, haze + 0.15);
    const ct = hazed(colTop, haze);
    const snow = hazed('#ffffff', haze * 0.8);
    geos.push(
      ringStrip({
        R,
        baseY,
        segs,
        heightFn: (a) => H * (0.25 + 0.75 * f(a)),
        colorFn: (t, h) => {
          const c = cb.clone().lerp(ct, t);
          if (t > 0.9 && h > H * snowLine) c.lerp(snow, 0.85);
          if (t < 0.01) c.copy(hazeTarget);
          return c;
        },
      })
    );
  };

  if (gType === 'grass') {
    addMountains(R2, 260, 3, mixHex(theme.ground.color2, '#5a7fb0', 0.6), '#8ea9d6', 0.55, 0.62);
    addMountains(R1, 70, 1.5, theme.ground.color2, mixHex(theme.ground.color, '#ffffff', 0.1), 0.35, 9);
  } else if (gType === 'sand') {
    addMountains(R2, 160, 1.2, mixHex('#c98a4a', theme.ground.color2, 0.4), '#e0a868', 0.5, 9);
    // mesas: flat topped
    const f = ridgeFn(rng, 5, 6);
    const cb = hazed(shade(theme.ground.color2, -0.2), 0.45);
    const ct = hazed(mixHex(theme.ground.color, '#d9824a', 0.5), 0.35);
    geos.push(
      ringStrip({
        R: R1,
        baseY,
        segs,
        heightFn: (a) => {
          const v = f(a);
          return v > 0.42 ? 55 + v * 20 : 12 + v * 20;
        },
        colorFn: (t) => cb.clone().lerp(ct, t),
        lean: 0.05,
      })
    );
  } else if (gType === 'snow' || gType === 'rock') {
    const snowy = gType === 'snow';
    addMountains(R2, 330, 4, snowy ? '#7f93b3' : '#6d6260', snowy ? '#c9d7ea' : '#9a8d86', 0.5, snowy ? 0.45 : 0.75);
    addMountains(R1, 120, 2.5, snowy ? '#9fb3cc' : shade(theme.ground.color2, -0.2), snowy ? '#eef4fb' : theme.ground.color, 0.3, snowy ? 0.5 : 9);
  } else if (gType === 'lava') {
    addMountains(R2, 300, 4, '#2a1716', '#4a2a26', 0.45, 9);
    addMountains(R1, 110, 3, '#1f1414', '#3a2424', 0.3, 9);
    // volcano with a glowing crater
    const a = rng() * Math.PI * 2;
    const vr = R1 * 0.95;
    const vx = Math.cos(a) * vr;
    const vz = Math.sin(a) * vr;
    const cone = new THREE.CylinderGeometry(40, 190, 230, 20, 1, true);
    cone.translate(vx, baseY + 115, vz);
    const cc = new THREE.Color('#2e1a18').lerp(hazeTarget, 0.3);
    const colArr = [];
    const p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - baseY) / 230;
      const c = cc.clone().lerp(new THREE.Color('#ff5a1f'), t > 0.95 ? 0.5 : 0);
      colArr.push(c.r, c.g, c.b);
    }
    cone.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    geos.push(cone.index ? cone : cone);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff6a1f', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.8 })
    );
    glow.position.set(center.x + vx, baseY + 240, center.z + vz);
    glow.lookAt(center.x, baseY + 240, center.z);
    group.add(glow);
    W.disposables.push(glow.geometry, glow.material);
    animated.push((dt, time) => (glow.material.opacity = 0.65 + 0.2 * Math.sin(time * 1.3)));
  } else if (gType === 'water') {
    const f = ridgeFn(rng, 5, 3);
    const cb = hazed('#4f8a5a', 0.45);
    const ct = hazed('#7cc070', 0.4);
    geos.push(
      ringStrip({
        R: R1,
        baseY: W.analysis.voidY - 1,
        segs,
        heightFn: (a) => Math.max(0, f(a) - 0.35) * 160,
        colorFn: (t) => cb.clone().lerp(ct, t),
      })
    );
  } else if (gType === 'asphalt') {
    // city skyline: boxes with windows (two rings)
    const wt = windowTextures(0);
    const skyline = [];
    for (const [R, count, hMin, hMax, haze] of [
      [R1, 70, 30, 110, 0.35],
      [R2, 90, 60, 200, 0.55],
    ]) {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng() * 0.03;
        const w = ((Math.PI * 2 * R) / count) * (0.55 + rng() * 0.4);
        const h = hMin + Math.pow(rng(), 1.8) * (hMax - hMin);
        const d = w * (0.6 + rng() * 0.6);
        const g = new THREE.BoxGeometry(w, h + 40, d);
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) * w) / 14, (uv.getY(k) * (h + 40)) / 14);
        g.rotateY(-a + Math.PI / 2);
        g.translate(Math.cos(a) * (R + d / 2), baseY + (h + 40) / 2 - 40, Math.sin(a) * (R + d / 2));
        const base = night ? new THREE.Color('#1a1d33') : hazed(pickCityColor(rng), haze);
        if (night) base.lerp(hazeTarget, haze * 0.5);
        const c = [];
        for (let k = 0; k < g.attributes.position.count; k++) c.push(base.r, base.g, base.b);
        g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
        skyline.push(g);
      }
    }
    const sg = mergeGeometries(skyline.map((g) => g.toNonIndexed()));
    const sm = new THREE.MeshBasicMaterial({ vertexColors: true, map: night ? wt.emissiveMap : wt.map, fog: false });
    if (night) {
      // windows glow on dark facades: use lit pattern as an additive-ish map by brightening colours
      sm.color = new THREE.Color(2.2, 2.0, 1.6);
    }
    const mesh = new THREE.Mesh(sg, sm);
    mesh.position.set(center.x, 0, center.z);
    mesh.name = 'backdrop:city';
    mesh.frustumCulled = false;
    group.add(mesh);
    W.disposables.push(sg, sm);
  } else if (gType === 'cloud' || gType === 'none') {
    // towering cloud banks around the horizon (billboards)
    const count = quality === 'low' ? 14 : 26;
    const cg = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.15;
      const r = R1 * (0.95 + rng() * 0.25);
      const w = 420 + rng() * 380;
      const h = w * 0.5;
      const g = new THREE.PlaneGeometry(w, h);
      g.rotateY(-a - Math.PI / 2);
      g.translate(Math.cos(a) * r, W.analysis.voidY + h * 0.3 + rng() * 40, Math.sin(a) * r);
      cg.push(g);
    }
    const geo = mergeGeometries(cg);
    const mat = new THREE.MeshBasicMaterial({
      map: cloudTexture(1),
      color: mixHex('#ffffff', theme.sky.horizon, 0.3),
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(center.x, 0, center.z);
    mesh.renderOrder = -800;
    mesh.frustumCulled = false;
    mesh.name = 'backdrop:cloudbanks';
    group.add(mesh);
    W.disposables.push(geo, mat);
    animated.push((dt, time) => (mesh.rotation.y = -time * 0.003));
  } else if (gType === 'space') {
    // planets
    const pl = [
      ['#ff9ec7', 160, 0.8, 0.35],
      ['#8fd8ff', 90, 2.6, 0.18],
    ];
    for (const [c, r, a, el] of pl) {
      const g = new THREE.SphereGeometry(r, 32, 16);
      const m = new THREE.MeshBasicMaterial({ color: c, fog: false });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(center.x + Math.cos(a) * 1300, 1300 * el, center.z + Math.sin(a) * 1300);
      group.add(mesh);
      W.disposables.push(g, m);
      const rg = new THREE.RingGeometry(r * 1.4, r * 1.9, 48);
      const rm = new THREE.MeshBasicMaterial({ color: mixHex(c, '#ffffff', 0.4), side: THREE.DoubleSide, transparent: true, opacity: 0.6, fog: false });
      const ring = new THREE.Mesh(rg, rm);
      ring.position.copy(mesh.position);
      ring.rotation.set(1.2, 0.3, 0.2);
      group.add(ring);
      W.disposables.push(rg, rm);
    }
  }

  if (geos.length) {
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
      return g;
    }));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.position.set(center.x, 0, center.z);
    mesh.name = 'backdrop';
    mesh.frustumCulled = false;
    mesh.renderOrder = -500;
    group.add(mesh);
    W.disposables.push(merged, mat);
  }
}

function pickCityColor(rng) {
  const p = ['#c9d6e3', '#e8e0f5', '#f5d7c3', '#d9e4f2', '#b8c4d6', '#f2efe8'];
  return p[(rng() * p.length) | 0];
}
