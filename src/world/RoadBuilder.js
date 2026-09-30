// Road ribbon, off-road strips, edge curbs/lines/glow, walls, embankments / cliffs / bridge decks, pillars
// (owner: world agent). buildRoad(W) adds meshes to W.group and animation callbacks to W.animated.
//
// Geometry follows TrackPath exactly: a point at lateral L of sample s is
//   s.pos + s.rightH * L + (0, L * s.slope, 0)
// which is the surface TrackPath.project() reports (groundY), so karts sit exactly on the mesh.

import * as THREE from 'three';
import { clamp, smoothstep, lerp } from '../core/utils.js';
import { shade, mixHex } from './textures.js';
import { WALL_THICKNESS } from './Corridor.js';
import { skirtProfile } from './Terrain.js';

const UP = new THREE.Vector3(0, 1, 0);

/** rows: [{ i, d }] (sample index + distance used for v). fn(row, k, out) fills out.p/out.n/out.u/out.v/out.c */
export function buildStrip(rows, K, fn, { flip = false, colors = false, normals = true } = {}) {
  const R = rows.length;
  const cols = K + 1;
  const pos = new Float32Array(R * cols * 3);
  const nor = new Float32Array(R * cols * 3);
  const uv = new Float32Array(R * cols * 2);
  const col = colors ? new Float32Array(R * cols * 3) : null;
  const o = { p: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0), u: 0, v: 0, c: new THREE.Color(1, 1, 1) };
  let hasN = false;
  for (let r = 0; r < R; r++)
    for (let k = 0; k < cols; k++) {
      o.n.set(0, 0, 0);
      fn(rows[r], k, o);
      const j = r * cols + k;
      pos[j * 3] = o.p.x;
      pos[j * 3 + 1] = o.p.y;
      pos[j * 3 + 2] = o.p.z;
      if (o.n.lengthSq() > 0) hasN = true;
      nor[j * 3] = o.n.x;
      nor[j * 3 + 1] = o.n.y;
      nor[j * 3 + 2] = o.n.z;
      uv[j * 2] = o.u;
      uv[j * 2 + 1] = o.v;
      if (col) {
        col[j * 3] = o.c.r;
        col[j * 3 + 1] = o.c.g;
        col[j * 3 + 2] = o.c.b;
      }
    }
  const idx = [];
  for (let r = 0; r < R - 1; r++)
    for (let k = 0; k < K; k++) {
      const a = r * cols + k;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  if (!normals || !hasN) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Position on the (banked) road plane at lateral `lat` of sample s, raised by dy along world up. */
export function surf(s, lat, dy, out) {
  return out.set(s.pos.x + s.rightH.x * lat, s.pos.y + lat * s.slope + dy, s.pos.z + s.rightH.z * lat);
}

/** Rows for a full closed loop (last row repeats sample 0 at d = length). */
function loopRows(path) {
  const rows = [];
  for (let i = 0; i < path.count; i++) rows.push({ i, d: path.samples[i].d });
  rows.push({ i: 0, d: path.length });
  return rows;
}

/** Split samples into runs where pred(i) is true. Returns arrays of rows (closed loop aware). */
function runs(path, pred, pad = 0) {
  const N = path.count;
  const S = path.samples;
  const flags = new Uint8Array(N);
  let any = false;
  let all = true;
  for (let i = 0; i < N; i++) {
    flags[i] = pred(i) ? 1 : 0;
    any ||= flags[i];
    all &&= !!flags[i];
  }
  if (!any) return [];
  if (all) return [loopRows(path)];
  if (pad > 0) {
    const f2 = flags.slice();
    for (let i = 0; i < N; i++) if (flags[i]) for (let k = 1; k <= pad; k++) f2[(i + k) % N] = 1;
    flags.set(f2);
  }
  // find a start index where the flag is off
  let start = 0;
  while (flags[start]) start++;
  const out = [];
  let cur = null;
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    if (flags[i]) {
      if (!cur) cur = [];
      const prev = cur.length ? cur[cur.length - 1] : null;
      let d = S[i].d;
      if (prev && d < prev.d) d += path.length;
      cur.push({ i, d });
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.filter((r) => r.length >= 2);
}

function tileFor(length, want) {
  return length / Math.max(1, Math.round(length / want));
}

// ---------------------------------------------------------------------------------------------------------
// Wall profiles: points [o, h] (o = outward from the corridor edge, h = up), road-side first.
// ---------------------------------------------------------------------------------------------------------
function profileU(pts) {
  const u = [0];
  let acc = 0;
  for (let k = 1; k < pts.length; k++) {
    acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    u.push(acc);
  }
  return u.map((x) => x / acc);
}

const WALL_PROFILES = {
  barrier: { pts: [[0, -0.6], [0, 0.22], [0.1, 0.4], [0.15, 1.02], [0.22, 1.14], [0.5, 1.14], [0.57, 1.02], [0.62, 0.4], [0.72, 0.22], [0.72, -0.6]], smooth: false, tile: 8 },
  stone: { pts: [[0, -0.6], [0, 1.3], [0.07, 1.46], [0.73, 1.46], [0.8, 1.3], [0.8, -0.6]], smooth: false, tile: 6 },
  hedge: { pts: [[0, -0.5], [0, 0.95], [0.07, 1.3], [0.3, 1.52], [0.6, 1.58], [0.88, 1.48], [1.02, 1.2], [1.08, -0.5]], smooth: true, tile: 5, lumpy: 0.12 },
  snowbank: { pts: [[0, -0.5], [0, 0.35], [0.14, 0.78], [0.48, 1.12], [0.95, 1.24], [1.42, 1.0], [1.82, 0.5], [2.05, -0.5]], smooth: true, tile: 7, lumpy: 0.18 },
  tires: {
    pts: [[0.1, -0.5], [0.1, 0.0], [0, 0.18], [0.1, 0.36], [0, 0.54], [0.1, 0.72], [0, 0.9], [0.1, 1.08], [0.35, 1.13], [0.6, 1.08], [0.7, 0.9], [0.6, 0.72], [0.7, 0.54], [0.6, 0.36], [0.7, 0.18], [0.6, 0.0], [0.6, -0.5]],
    smooth: true,
    tile: 4.4,
  },
  glowBase: { pts: [[0, -0.5], [0, 0.28], [0.3, 0.28], [0.3, -0.5]], smooth: false, tile: 8 },
  fenceBase: { pts: [[0, -0.5], [0, 0.32], [0.26, 0.32], [0.26, -0.5]], smooth: false, tile: 6 },
};

/** Outward reach of each wall style beyond the corridor edge (used to tuck skirts / decks under the wall). */
export const WALL_WIDTH = { barrier: 0.72, stone: 0.8, hedge: 1.08, snowbank: 2.05, tires: 0.7, glow: 0.34, fence: 0.3 };

function rail(h, o0 = 0.03, w = 0.12, t = 0.1) {
  return [[o0, h - t / 2], [o0, h + t / 2], [o0 + w, h + t / 2], [o0 + w, h - t / 2], [o0, h - t / 2]];
}

export function buildRoad(W) {
  const { path, theme, kit, group, analysis: A, quality } = W;
  const S = path.samples;
  const N = path.count;
  const L = path.length;
  const tmpP = new THREE.Vector3();
  const avgW = S.reduce((a, s) => a + s.halfWidth * 2, 0) / N;

  // smoothed |curvature| for curb widths
  const curvS = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = -8; k <= 8; k++) sum += S[(i + k + N) % N].curvature;
    curvS[i] = sum / 17;
  }

  // =====================================================================================================
  // Road surface
  // =====================================================================================================
  const road = theme.road;
  const rt = kit.road(road, avgW);
  const vTile = tileFor(L, rt.lengthPerTile);
  let roadMat;
  if (road.style === 'ice') {
    roadMat = new THREE.MeshStandardMaterial({ map: rt.map, roughness: 0.5, metalness: 0.05, emissive: new THREE.Color(road.color2), emissiveIntensity: 0.12 });
  } else if (road.style === 'neon') {
    roadMat = new THREE.MeshLambertMaterial({ map: rt.map, emissiveMap: rt.emissiveMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.0 });
    W.animated.push((dt, time) => (roadMat.emissiveIntensity = 0.85 + 0.25 * Math.sin(time * 2.2)));
  } else if (road.style === 'rainbow') {
    roadMat = new THREE.MeshLambertMaterial({ map: rt.map, emissiveMap: rt.emissiveMap || rt.map, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.62 });
    W.animated.push((dt) => {
      rt.map.offset.x = (rt.map.offset.x + dt * 0.06) % 1;
    });
  } else {
    roadMat = new THREE.MeshLambertMaterial({ map: rt.map });
  }
  roadMat.name = `road:${road.style}`;
  const K = 6;
  const roadGeo = buildStrip(loopRows(path), K, (row, k, o) => {
    const s = S[row.i];
    const u = k / K;
    const lat = -s.halfWidth + 2 * s.halfWidth * u;
    surf(s, lat, 0, o.p);
    o.n.copy(s.up);
    o.u = u;
    o.v = row.d / vTile;
  });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.name = 'road';
  roadMesh.receiveShadow = true;
  group.add(roadMesh);
  W.disposables.push(roadGeo, roadMat);
  W.roadMesh = roadMesh;

  // =====================================================================================================
  // Off-road strips
  // =====================================================================================================
  const ot = kit.offroad(theme.offroad, road);
  const oTile = ot.tile;
  const offMat = new THREE.MeshLambertMaterial({ map: ot.map });
  offMat.name = `offroad:${theme.offroad.type}`;
  for (const side of [-1, 1]) {
    const g = buildStrip(
      loopRows(path),
      2,
      (row, k, o) => {
        const s = S[row.i];
        const off = side > 0 ? s.offR : s.offL;
        const lat = side * (s.halfWidth + (off * k) / 2);
        surf(s, lat, 0, o.p);
        o.n.copy(s.up);
        o.u = lat / oTile;
        o.v = row.d / tileFor(L, oTile);
      },
      { flip: side < 0 }
    );
    const m = new THREE.Mesh(g, offMat);
    m.name = `offroad${side > 0 ? 'R' : 'L'}`;
    m.receiveShadow = true;
    group.add(m);
    W.disposables.push(g);
  }
  W.disposables.push(offMat);

  // =====================================================================================================
  // Edges
  // =====================================================================================================
  const edge = theme.edge;
  if (edge.style === 'curb') {
    const ct = kit.curb(edge.colorA, edge.colorB);
    const cm = new THREE.MeshLambertMaterial({ map: ct, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const prof = [[0, 0.01], [0.3, 0.085], [1, 0.1], [1.25, 0.012]]; // x: 0 = inner edge .. 1 = road edge, >1 outside
    for (const side of [-1, 1]) {
      const g = buildStrip(
        loopRows(path),
        prof.length - 1,
        (row, k, o) => {
          const s = S[row.i];
          const cw = 0.6 + 0.9 * smoothstep(0.004, 0.022, Math.abs(curvS[row.i]));
          const [x, h] = prof[k];
          const lat = side * (s.halfWidth - cw + x * cw + (x > 1 ? (x - 1) * 1.2 - (x - 1) * cw : 0));
          surf(s, lat, h, o.p);
          o.u = k / (prof.length - 1);
          o.v = row.d / tileFor(L, 4);
        },
        { flip: side < 0, normals: false }
      );
      const m = new THREE.Mesh(g, cm);
      m.name = 'curb';
      m.receiveShadow = true;
      group.add(m);
      W.disposables.push(g);
    }
    W.disposables.push(cm);
  } else if (edge.style === 'line') {
    const lm = new THREE.MeshLambertMaterial({ color: edge.colorA, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    for (const side of [-1, 1]) {
      const g = buildStrip(
        loopRows(path),
        1,
        (row, k, o) => {
          const s = S[row.i];
          const lat = side * (s.halfWidth - 0.62 + k * 0.36);
          surf(s, lat, 0.012, o.p);
          o.n.copy(s.up);
          o.u = k;
          o.v = row.d;
        },
        { flip: side < 0 }
      );
      const m = new THREE.Mesh(g, lm);
      m.name = 'edgeLine';
      m.receiveShadow = true;
      group.add(m);
      W.disposables.push(g);
    }
    // secondary dashed line in colorB (only if different), inside the solid one
    if (edge.colorB && edge.colorB.toLowerCase() !== edge.colorA.toLowerCase() && edge.colorB.toLowerCase() !== '#ffffff') {
      const lm2 = new THREE.MeshLambertMaterial({ color: edge.colorB, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      for (const side of [-1, 1]) {
        const g = buildStrip(
          loopRows(path),
          1,
          (row, k, o) => {
            const s = S[row.i];
            const lat = side * (s.halfWidth - 0.95 + k * 0.18);
            surf(s, lat, 0.012, o.p);
            o.n.copy(s.up);
          },
          { flip: side < 0 }
        );
        const m = new THREE.Mesh(g, lm2);
        m.receiveShadow = true;
        group.add(m);
        W.disposables.push(g);
      }
      W.disposables.push(lm2);
    }
    W.disposables.push(lm);
  } else if (edge.style === 'glow') {
    const gt = kit.glowStrip(edge.colorA, edge.colorB);
    const gm = new THREE.MeshBasicMaterial({ map: gt, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const tileG = tileFor(L, 12);
    for (const side of [-1, 1]) {
      // flat light strip on the road + raised rail at the edge
      const prof = [[-0.5, 0.012], [-0.18, 0.012], [0.06, 0.0], [0.06, 0.2], [0.32, 0.2], [0.32, 0.0]];
      const g = buildStrip(
        loopRows(path),
        prof.length - 1,
        (row, k, o) => {
          const s = S[row.i];
          const [x, h] = prof[k];
          surf(s, side * (s.halfWidth + x), h, o.p);
          o.u = k / (prof.length - 1);
          o.v = row.d / tileG;
        },
        { flip: side < 0, normals: false }
      );
      const m = new THREE.Mesh(g, gm);
      m.name = 'edgeGlow';
      group.add(m);
      W.disposables.push(g);
    }
    W.disposables.push(gm);
    W.animated.push((dt) => (gt.offset.y = (gt.offset.y - dt * 0.9) % 1));
  }

  // =====================================================================================================
  // Walls
  // =====================================================================================================
  const wallStyle = theme.wall.style;
  const wallParts = []; // { geos[], material }
  const addWallStrip = (side, rows, pts, material, { smooth = false, tile = 8, lumpy = 0, caps = true, uMode = 'profile' } = {}) => {
    const u = profileU(pts);
    const segs = pts.length - 1;
    // per-sample lumpiness (hedges, snow)
    const lump = (d, k) => {
      if (!lumpy) return 1;
      const t = d * 0.35 + k * 0.7;
      return 1 + lumpy * (Math.sin(t) * 0.6 + Math.sin(t * 2.7 + 1.3) * 0.4);
    };
    // 2D normals of profile segments (o, h) -> outward normal (-dh, do)
    const segN = [];
    for (let k = 0; k < segs; k++) {
      const dOut = pts[k + 1][0] - pts[k][0];
      const dh = pts[k + 1][1] - pts[k][1];
      const l = Math.hypot(dOut, dh) || 1;
      segN.push([-dh / l, dOut / l]);
    }
    const vTileW = tileFor(L, tile);
    let geo;
    const place = (row, k, o, nrm2) => {
      const s = S[row.i];
      const lim = side > 0 ? s.halfWidth + s.offR : s.halfWidth + s.offL;
      const edgeY = s.pos.y + side * lim * s.slope;
      const f = lump(row.d, k);
      const [po, ph] = pts[k];
      const oo = po * (lumpy ? 0.9 + 0.1 * f : 1);
      const hh = ph > 0 ? ph * f : ph;
      const out = side * (lim + oo);
      o.p.set(s.pos.x + s.rightH.x * out, edgeY + hh, s.pos.z + s.rightH.z * out);
      if (nrm2) o.n.set(s.rightH.x * side * nrm2[0], nrm2[1], s.rightH.z * side * nrm2[0]);
      o.u = uMode === 'profile' ? u[k] : ph;
      o.v = row.d / vTileW;
    };
    if (smooth) {
      geo = buildStrip(
        rows,
        segs,
        (row, k, o) => {
          const a = segN[Math.max(0, k - 1)];
          const b = segN[Math.min(segs - 1, k)];
          place(row, k, o, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
          o.n.normalize();
        },
        { flip: side < 0 }
      );
    } else {
      // hard edges: duplicate vertices per segment (2 columns per segment)
      const gs = [];
      for (let k = 0; k < segs; k++) {
        gs.push(
          buildStrip(
            rows,
            1,
            (row, c, o) => {
              place(row, k + c, o, segN[k]);
            },
            { flip: side < 0 }
          )
        );
      }
      geo = mergeSimple(gs);
    }
    const all = [geo];
    // end caps
    if (caps && rows.length && !(rows[0].i === rows[rows.length - 1].i)) {
      for (const [row, dirSign] of [
        [rows[0], -1],
        [rows[rows.length - 1], 1],
      ]) {
        const s = S[row.i];
        const vs = [];
        for (let k = 0; k < pts.length; k++) {
          const o = { p: new THREE.Vector3(), n: new THREE.Vector3(), u: 0, v: 0 };
          place(row, k, o, null);
          vs.push(o.p);
        }
        const cx = vs.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / vs.length);
        const posA = [];
        const nrmA = [];
        const uvA = [];
        const n = new THREE.Vector3(s.tan.x, 0, s.tan.z).normalize().multiplyScalar(dirSign);
        for (let k = 0; k < vs.length - 1; k++) {
          let a = vs[k];
          let b = vs[k + 1];
          // orient triangle (cx, a, b) so that its normal matches n
          const cr = new THREE.Vector3().subVectors(a, cx).cross(new THREE.Vector3().subVectors(b, cx));
          if (cr.dot(n) < 0) [a, b] = [b, a];
          for (const p of [cx, a, b]) {
            posA.push(p.x, p.y, p.z);
            nrmA.push(n.x, n.y, n.z);
            uvA.push(0.5, 0.5);
          }
        }
        const cg = new THREE.BufferGeometry();
        cg.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
        cg.setAttribute('normal', new THREE.Float32BufferAttribute(nrmA, 3));
        cg.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
        all.push(cg);
      }
    }
    let entry = wallParts.find((w) => w.material === material);
    if (!entry) wallParts.push((entry = { material, geos: [] }));
    entry.geos.push(...all);
  };

  if (wallStyle !== 'none') {
    const wall = theme.wall;
    for (const side of [-1, 1]) {
      const wallRuns = runs(path, (i) => (side > 0 ? S[i].wallR : S[i].wallL));
      for (const rows of wallRuns) {
        if (wallStyle === 'barrier' || wallStyle === 'stone' || wallStyle === 'hedge' || wallStyle === 'snowbank' || wallStyle === 'tires') {
          const P = WALL_PROFILES[wallStyle];
          const u = profileU(P.pts);
          let bands = {};
          if (wallStyle === 'barrier') bands = { stripe: [lerp(u[2], u[3], 0.3), lerp(u[2], u[3], 0.62)], stripe2: [lerp(u[6], u[7], 0.38), lerp(u[6], u[7], 0.7)] };
          if (wallStyle === 'stone') bands = { cap: [u[1], u[4]] };
          if (wallStyle === 'tires') {
            const t = [];
            for (let k = 1; k < 7; k += 2) t.push([u[k], u[k + 2]]);
            for (let k = 9; k < 15; k += 2) t.push([u[k], u[k + 2]]);
            bands = { tires: t.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]) };
          }
          const wt = kit.wall(wallStyle, wall, bands);
          const key = `wallmat:${wallStyle}`;
          let mat = W.matCache.get(key);
          if (!mat) {
            mat = new THREE.MeshLambertMaterial({ map: wt.map });
            if (wallStyle === 'stone' && wall.color2 && theme.ground.type === 'lava') {
              mat.emissive = new THREE.Color(wall.color2);
              mat.emissiveIntensity = 0.0;
            }
            W.matCache.set(key, mat);
            W.disposables.push(mat);
          }
          addWallStrip(side, rows, P.pts, mat, P);
        } else if (wallStyle === 'fence') {
          const base = WALL_PROFILES.fenceBase;
          const bm = W.matCache.get('fenceBase') || new THREE.MeshLambertMaterial({ color: shade(wall.color2 || '#888888', 0.35) });
          W.matCache.set('fenceBase', bm);
          addWallStrip(side, rows, base.pts, bm, base);
          const ft = kit.wall('fence', wall, { panel: [0.06, 0.96] });
          const pm = W.matCache.get('fencePanel') || new THREE.MeshLambertMaterial({ map: ft.map, color: '#ffffff', alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
          W.matCache.set('fencePanel', pm);
          addWallStrip(side, rows, [[0.12, 0.3], [0.12, 2.1]], pm, { tile: 3.2, caps: false });
          // posts
          const postM = W.matCache.get('fencePost') || new THREE.MeshLambertMaterial({ color: wall.color2 || wall.color });
          W.matCache.set('fencePost', postM);
          const pg = [];
          for (let r = 0; r < rows.length; r += 3) {
            const s = S[rows[r].i];
            const lim = side > 0 ? s.halfWidth + s.offR : s.halfWidth + s.offL;
            const b = new THREE.BoxGeometry(0.16, 2.5, 0.16);
            b.rotateY(s.yaw);
            surf(s, side * (lim + 0.12), 0, tmpP);
            b.translate(tmpP.x, s.pos.y + side * lim * s.slope + 0.75, tmpP.z);
            pg.push(b);
          }
          if (pg.length) {
            let e = wallParts.find((w) => w.material === postM);
            if (!e) wallParts.push((e = { material: postM, geos: [] }));
            e.geos.push(...pg.map((g) => g.toNonIndexed()));
          }
          W.disposables.push(bm, pm, postM);
        } else if (wallStyle === 'glow') {
          const base = WALL_PROFILES.glowBase;
          const bm = W.matCache.get('glowBase') || new THREE.MeshLambertMaterial({ color: wall.color, emissive: new THREE.Color(wall.color2), emissiveIntensity: 0.12 });
          W.matCache.set('glowBase', bm);
          addWallStrip(side, rows, base.pts, bm, base);
          const rm = W.matCache.get('glowRail') || new THREE.MeshBasicMaterial({ color: wall.color2, toneMapped: false });
          W.matCache.set('glowRail', rm);
          addWallStrip(side, rows, rail(0.72, 0.06, 0.14, 0.1), rm, { tile: 8 });
          addWallStrip(side, rows, rail(1.12, 0.06, 0.14, 0.1), rm, { tile: 8 });
          const pm = W.matCache.get('glowPanel') || new THREE.MeshBasicMaterial({ color: wall.color2, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
          W.matCache.set('glowPanel', pm);
          addWallStrip(side, rows, [[0.13, 0.28], [0.13, 1.12]], pm, { tile: 8, caps: false });
          // posts
          const postM = W.matCache.get('glowPost') || new THREE.MeshLambertMaterial({ color: shade(wall.color, 0.2) });
          W.matCache.set('glowPost', postM);
          const pg = [];
          for (let r = 0; r < rows.length; r += 4) {
            const s = S[rows[r].i];
            const lim = side > 0 ? s.halfWidth + s.offR : s.halfWidth + s.offL;
            const b = new THREE.BoxGeometry(0.14, 1.0, 0.14);
            b.rotateY(s.yaw);
            surf(s, side * (lim + 0.13), 0, tmpP);
            b.translate(tmpP.x, s.pos.y + side * lim * s.slope + 0.75, tmpP.z);
            pg.push(b.toNonIndexed());
          }
          let e = wallParts.find((w) => w.material === postM);
          if (!e) wallParts.push((e = { material: postM, geos: [] }));
          e.geos.push(...pg);
          W.disposables.push(bm, rm, pm, postM);
        }
      }
    }
  }
  for (const wp of wallParts) {
    const g = mergeSimple(wp.geos);
    const m = new THREE.Mesh(g, wp.material);
    m.name = 'walls';
    m.castShadow = !wp.material.transparent && quality !== 'low';
    m.receiveShadow = !wp.material.transparent;
    group.add(m);
    W.disposables.push(g);
  }

  // =====================================================================================================
  // Embankments / cliffs / bridge decks (+ underside) + pillars
  // =====================================================================================================
  buildSkirts(W);
  buildPillars(W);

  // =====================================================================================================
  // Night: road-edge reflectors
  // =====================================================================================================
  if (theme.night && edge.style !== 'glow') {
    const every = 7;
    const n = Math.floor(L / every) * 2;
    const g = new THREE.BoxGeometry(0.28, 0.07, 0.16);
    const m = new THREE.MeshBasicMaterial({ color: edge.colorA, toneMapped: false });
    const im = new THREE.InstancedMesh(g, m, n);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let c = 0;
    for (let k = 0; k < n / 2; k++) {
      const s = path.sampleAt(k * every);
      for (const side of [-1, 1]) {
        surf(s, side * (s.halfWidth - 0.15), 0.04, tmpP);
        q.setFromAxisAngle(UP, s.yaw);
        mtx.compose(tmpP, q, new THREE.Vector3(1, 1, 1));
        im.setMatrixAt(c++, mtx);
      }
    }
    im.count = c;
    im.computeBoundingSphere();
    im.name = 'reflectors';
    group.add(im);
    W.disposables.push(g, m);
  }
}

/** Merge geometries that all have position/normal/uv(/color) (indexed or not) without extra checks. */
export function mergeSimple(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const hasColor = list.every((g) => g.attributes.color);
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const col = hasColor ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array.subarray(0, n * 3), o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), o * 2);
    if (col) col.set(g.attributes.color.array.subarray(0, n * 3), o * 3);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  for (const g of geos) g.dispose();
  return out;
}

// ---------------------------------------------------------------------------------------------------------
function rockColorFor(theme) {
  const g = theme.ground.type;
  if (g === 'lava') return '#3a2c2a';
  if (g === 'water') return '#7a7064';
  if (g === 'snow') return '#8394ab';
  if (g === 'sand') return '#b98a55';
  if (g === 'cloud' || g === 'none') return '#e9eefb';
  if (g === 'space') return '#2a2d45';
  if (g === 'asphalt') return '#8a8790';
  return mixHex(shade(theme.ground.color2, -0.35), '#7d7468', 0.5);
}

function slabColorFor(theme) {
  const g = theme.ground.type;
  if (g === 'cloud' || g === 'none') return mixHex('#ffffff', theme.sky.top, 0.12);
  if (theme.road.style === 'neon') return '#1a1d30';
  if (theme.road.style === 'wood') return shade(theme.road.color2, -0.3);
  if (theme.road.style === 'rainbow') return '#e8ecff';
  return mixHex(shade(theme.road.color2, -0.2), '#9aa0aa', 0.5);
}

function buildSkirts(W) {
  const { path, theme, kit, group, analysis: A, terrain } = W;
  const S = path.samples;
  const N = path.count;
  const L = path.length;
  const P = 6; // profile points (7 incl. foot)
  const modeOf = (i, side) => {
    if (A.bridge[i] || A.floating) return 'slab';
    const isVoid = side > 0 ? !S[i].wallR : !S[i].wallL;
    if (isVoid) return 'cliff';
    return 'bank';
  };
  const rockC = new THREE.Color(rockColorFor(theme));
  const slabC = new THREE.Color(slabColorFor(theme));
  const offC = new THREE.Color(theme.offroad.type === 'none' ? theme.offroad.color || theme.ground.color : theme.offroad.color);
  const gA = new THREE.Color(theme.ground.color);
  const gB = new THREE.Color(theme.ground.color2);
  const lavaGlow = new THREE.Color(theme.ground.type === 'lava' ? '#ff6a1f' : theme.void.type === 'lava' ? '#ff6a1f' : '#000000');
  const tmp = new THREE.Color();
  const rockTile = 10;
  const bankTile = 14;
  const deckTile = 8;
  // how far each wall style reaches outward from the corridor edge (skirts start beyond it so walls never float)
  const ws = theme.wall.style;
  const wallW = ws === 'none' ? 0 : WALL_WIDTH[ws] ?? 0.8;
  const wallWidthAt = (i, side) => ((side > 0 ? S[i].wallR : S[i].wallL) ? wallW : 0);

  // per-sample, per-side profile [o, y, colorT] computed once
  const prof = [new Array(N), new Array(N)];
  const profileFor = (i, side, mode, ww) => {
      const s = S[i];
      const lim = side > 0 ? s.halfWidth + s.offR : s.halfWidth + s.offL;
      const edgeY = s.pos.y + side * lim * s.slope;
      const pts = [];
      if (mode === 'bank') {
        let foot = A.liquid ? A.voidY - 0.8 : A.groundBase;
        const H0 = Math.max(0.3, edgeY - foot);
        const reach0 = terrain.skirtReach(H0);
        const fx = s.pos.x + s.rightH.x * side * (lim + ww + reach0);
        const fz = s.pos.z + s.rightH.z * side * (lim + ww + reach0);
        const th = terrain.terrainHeight(fx, fz);
        if (th !== null && !A.liquid) foot = Math.min(foot, th);
        // the first segment runs under the wall; the slope starts at the wall's outer foot
        const top = ww > 0 ? Math.min(0.35, Math.max(0, edgeY - foot) * 0.5) : 0;
        const H = Math.max(0.3, edgeY - top - foot);
        const reach = terrain.skirtReach(H);
        pts.push([lim, edgeY, 0]);
        for (let k = 0; k < P - 1; k++) {
          const t = k / (P - 2);
          pts.push([lim + ww + reach * t, edgeY - top - H * skirtProfile(t), 0.02 + t * 0.98]);
        }
        pts.push([lim + ww + reach + 0.2, foot - 3, 1]);
      } else if (mode === 'cliff') {
        const depth = Math.max(4, edgeY - A.voidY + 2);
        const os = [0, 0.12, 0.45, 0.9, 1.4, 1.7, 1.7];
        const ys = [0, 0.7, depth * 0.3, depth * 0.6, depth * 0.85, depth, depth + 3];
        for (let k = 0; k < 7; k++) pts.push([lim + ww + os[k], edgeY - ys[k], k / 6]);
      } else {
        // bridge deck / floating road fascia: tucks under the wall, then a chamfered slab edge
        const e = ww > 0 ? ww + 0.05 : 0;
        const os = [0, e, e, e, e - 0.05, e - 0.4, e - 0.8];
        const ys = [0, ww > 0 ? 0.45 : 0.3, 0.62, 0.95, 1.18, 1.36, 1.42];
        for (let k = 0; k < 7; k++) pts.push([lim + os[k], edgeY - ys[k], k / 6]);
      }
      return { mode, pts, lim };
  };
  for (let i = 0; i < N; i++) {
    for (const [si, side] of [
      [0, -1],
      [1, 1],
    ]) {
      prof[si][i] = profileFor(i, side, modeOf(i, side), wallWidthAt(i, side));
    }
  }
  // Blend bank <-> cliff profiles over a few samples around wall / no-wall transitions. Without this, the
  // single segment between a wide embankment and a narrow cliff face becomes a long dark sliver ("spike").
  const BLEND = 6;
  for (const [si, side] of [
    [0, -1],
    [1, 1],
  ]) {
    const P0 = prof[si];
    const blended = [];
    for (let i = 0; i < N; i++) {
      const m = P0[i].mode;
      if (m === 'slab') continue;
      let k = 0;
      let other = null;
      for (k = 1; k <= BLEND; k++) {
        const a = P0[(i + k) % N].mode;
        const b = P0[(i - k + N) % N].mode;
        if (a !== m && a !== 'slab') other = a;
        else if (b !== m && b !== 'slab') other = b;
        if (other) break;
      }
      if (!other) continue;
      const w = 0.5 * (1 - (k - 1) / BLEND);
      const alt = profileFor(i, side, other, other === 'cliff' ? 0 : wallW);
      blended.push([i, P0[i].pts.map((p, j) => [p[0] + (alt.pts[j][0] - p[0]) * w, p[1] + (alt.pts[j][1] - p[1]) * w, p[2]])]);
    }
    for (const [i, pts] of blended) P0[i] = { ...P0[i], pts };
  }

  const rockTex = kit.rockFace(A.solid ? '#d8d0c4' : '#cfc6bc', rockTile);
  const rockMat = new THREE.MeshLambertMaterial({ map: rockTex.map, vertexColors: true });
  W.disposables.push(rockMat);
  const bankMat = A.solid ? W.terrainMaterial : rockMat;
  // decks: light concrete panels, lifted a little so undersides never read as black holes
  const deckTex = kit.deckPanel(deckTile);
  const deckMat = new THREE.MeshLambertMaterial({ map: deckTex.map, vertexColors: true, emissive: slabC.clone().multiplyScalar(A.floating ? 0.32 : 0.2) });
  W.disposables.push(deckMat);

  for (const [si, side] of [
    [0, -1],
    [1, 1],
  ]) {
    const cls = (i) => (prof[si][i].mode === 'bank' && A.solid ? 'bank' : prof[si][i].mode === 'slab' ? 'slab' : 'rock');
    for (const want of ['bank', 'rock', 'slab']) {
      const rr = runs(path, (i) => cls(i) === want, 1);
      for (const rows of rr) {
        const g = buildStrip(
          rows,
          6,
          (row, k, o) => {
            const s = S[row.i];
            const pr = prof[si][row.i];
            const [oo, y, t] = pr.pts[k];
            o.p.set(s.pos.x + s.rightH.x * side * oo, y, s.pos.z + s.rightH.z * side * oo);
            if (want === 'bank') {
              o.u = (side * oo) / bankTile;
              o.v = row.d / bankTile;
              // grass lip at the top, ground colours below
              if (t < 0.08) tmp.copy(offC);
              else tmp.copy(gA).lerp(gB, 0.4 + 0.3 * Math.sin(row.d * 0.05 + k));
              tmp.multiplyScalar(0.94 - t * 0.12);
              o.c.copy(tmp);
            } else if (want === 'slab') {
              o.u = row.d / deckTile;
              o.v = (s.pos.y - y) / deckTile;
              tmp.copy(slabC);
              if (k === 3 || k === 4) tmp.multiplyScalar(1.06); // bright fascia band
              else if (k >= 5) tmp.multiplyScalar(0.82);
              if (pr.mode !== 'slab') tmp.copy(t < 0.08 ? offC : rockC);
              o.c.copy(tmp);
            } else {
              o.u = row.d / rockTile;
              o.v = y / rockTile;
              if (pr.mode === 'slab') tmp.copy(slabC).multiplyScalar(1 - t * 0.25);
              else if (pr.mode === 'bank') {
                // liquid-theme embankment: offroad lip, rock below, glowing near lava
                tmp.copy(t < 0.08 ? offC : rockC);
                if (t > 0.6) tmp.lerp(lavaGlow, (t - 0.6) * 0.9);
              } else {
                tmp.copy(t < 0.05 ? offC : rockC).multiplyScalar(1 - t * 0.35);
                if (t > 0.7) tmp.lerp(lavaGlow, (t - 0.7) * 1.2);
              }
              o.c.copy(tmp);
            }
          },
          { flip: side > 0, colors: true, normals: false }
        );
        const m = new THREE.Mesh(g, want === 'bank' ? bankMat : want === 'slab' ? deckMat : rockMat);
        m.name = `skirt:${want}`;
        m.receiveShadow = true;
        m.castShadow = want === 'slab';
        group.add(m);
        W.disposables.push(g);
      }
    }
  }

  // underside where either side is a slab (floating / bridge)
  const under = runs(path, (i) => prof[0][i].mode === 'slab' || prof[1][i].mode === 'slab', 1);
  for (const rows of under) {
    const g = buildStrip(
      rows,
      2,
      (row, k, o) => {
        const s = S[row.i];
        const l = prof[0][row.i].pts[6];
        const r = prof[1][row.i].pts[6];
        const oo = k === 0 ? -l[0] : k === 2 ? r[0] : 0;
        const y = k === 0 ? l[1] : k === 2 ? r[1] : (l[1] + r[1]) / 2 - 0.25;
        o.p.set(s.pos.x + s.rightH.x * oo, y, s.pos.z + s.rightH.z * oo);
        o.u = row.d / deckTile;
        o.v = oo / deckTile;
        o.c.copy(slabC).multiplyScalar(0.9);
      },
      { flip: true, colors: true, normals: false }
    );
    const m = new THREE.Mesh(g, deckMat);
    m.name = 'underside';
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    W.disposables.push(g);
  }
  void L;
}

function buildPillars(W) {
  const { path, theme, group, analysis: A, corridor, terrain } = W;
  if (!A.bridgeCount || A.floating) return;
  const S = path.samples;
  const N = path.count;
  const geos = [];
  const every = 16;
  const tmp = new THREE.Vector3();
  let last = -1e9;
  for (let i = 0; i < N; i++) {
    if (!A.bridge[i]) continue;
    // skip the dilated ends
    if (!A.bridge[(i + 6) % N] || !A.bridge[(i - 6 + N) % N]) continue;
    const s = S[i];
    if (s.d - last < every) continue;
    const deckBottom = s.pos.y - 1.35;
    const lats = s.halfWidth * 2 > 15 ? [-s.halfWidth * 0.55, s.halfWidth * 0.55] : [0];
    let placed = false;
    for (const lat of lats) {
      const cand = [lat, lat * 1.3, lat * 0.6];
      for (const la of cand) {
        surf(s, la, 0, tmp);
        if (!corridor.isClear(tmp.x, tmp.z, 1.4, { ignoreIndex: i, ignoreSpan: 70, margin: 0.4 })) continue;
        const gy = A.liquid ? A.voidY - 1 : terrain.terrainHeight(tmp.x, tmp.z) ?? A.groundBase;
        const H = deckBottom - gy + 0.5;
        if (H < 2.5) break;
        const col = new THREE.CylinderGeometry(0.85, 1.0, H, 12);
        col.translate(tmp.x, gy - 0.5 + H / 2, tmp.z);
        geos.push(col.toNonIndexed());
        const cap = new THREE.BoxGeometry(2.6, 0.6, 2.2);
        cap.rotateY(s.yaw);
        cap.translate(tmp.x, deckBottom - 0.25, tmp.z);
        geos.push(cap.toNonIndexed());
        const foot = new THREE.BoxGeometry(2.4, 0.6, 2.4);
        foot.rotateY(s.yaw);
        foot.translate(tmp.x, gy + 0.1, tmp.z);
        geos.push(foot.toNonIndexed());
        placed = true;
        break;
      }
    }
    if (placed) last = s.d;
  }
  if (!geos.length) return;
  const g = mergeSimple(geos);
  const st = theme.road.style;
  const color = st === 'wood' ? '#7a5230' : st === 'stone' || st === 'brick' ? mixHex(theme.road.color, '#ffffff', 0.25) : st === 'neon' ? '#2a2f45' : '#c9ccd4';
  const m = new THREE.MeshLambertMaterial({ color, emissive: st === 'neon' ? new THREE.Color(theme.road.color2) : new THREE.Color(0), emissiveIntensity: st === 'neon' ? 0.15 : 0 });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'pillars';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  W.disposables.push(g, m);
  void clamp;
}
