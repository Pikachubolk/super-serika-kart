// Track features: start/finish gantry + start lights, checkered line, grid marks, dash panels, ramps, slow
// patches, hazards, item-box / coin spots (owner: world agent).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, mulberry32 } from '../core/utils.js';
import { createProp, getToonMaterial, PROP_META } from './Props.js';
import { glowTexture, shade } from './textures.js';
import { mergeSimple } from './RoadBuilder.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Ramp wedge height: H at the lip, profile t^1.35 over the zone length. */
export function rampHeight(power = 1) {
  return 0.55 + 0.35 * power;
}
export function rampProfile(t) {
  return Math.pow(clamp(t, 0, 1), 1.35);
}

/**
 * A road-conforming patch between distances d0..d1 and laterals lat0..lat1 (world units), lifted by dy.
 * uvFn(t, s) -> [u, v] with t = along fraction 0..1, s = across fraction 0..1.
 */
export function roadPatch(path, d0, d1, lat0, lat1, { dy = 0.03, step = 1, across = 2, uvFn, heightFn } = {}) {
  const len = d1 - d0;
  const na = Math.max(1, Math.ceil(len / step));
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const f = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), rightH: new THREE.Vector3(), up: new THREE.Vector3() };
  for (let a = 0; a <= na; a++) {
    const t = a / na;
    path.frameAt(d0 + len * t, f);
    for (let c = 0; c <= across; c++) {
      const s = c / across;
      const lat = lat0 + (lat1 - lat0) * s;
      const h = heightFn ? heightFn(t, s) : 0;
      pos.push(f.pos.x + f.rightH.x * lat, f.pos.y + lat * f.slope + dy + h, f.pos.z + f.rightH.z * lat);
      nor.push(f.up.x, f.up.y, f.up.z);
      const [u, v] = uvFn ? uvFn(t, s) : [s, t];
      uv.push(u, v);
    }
    if (a < na)
      for (let c = 0; c < across; c++) {
        const i0 = a * (across + 1) + c;
        const i1 = i0 + 1;
        const i2 = i0 + across + 1;
        const i3 = i2 + 1;
        idx.push(i0, i1, i2, i1, i3, i2);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (heightFn) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function decalMat(opts) {
  return new THREE.MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...opts });
}

export function buildFeatures(W) {
  const { path, theme, kit, group, def, quality } = W;
  const rng = mulberry32(W.seed ^ 0xfea7);
  const itemBoxSpots = [];
  const coinSpots = [];
  const hazards = W.hazards;

  // ---------------------------------------------------------------------------------------------------
  // Start line (checkered) + grid slots
  // ---------------------------------------------------------------------------------------------------
  {
    const f0 = path.frameAt(0);
    const hw = f0.halfWidth;
    const ck = kit.checker();
    const g = roadPatch(path, -1.2, 1.2, -hw, hw, { dy: 0.02, step: 0.6, across: 6, uvFn: (t, s) => [(s * hw * 2) / 2.4, t] });
    const m = decalMat({ map: ck });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'startLine';
    mesh.receiveShadow = true;
    group.add(mesh);
    W.disposables.push(g, m);

    const marks = [];
    for (let slot = 0; slot < 8; slot++) {
      const gs = path.gridSlot(slot, 8);
      const d = gs.d > path.length / 2 ? gs.d - path.length : gs.d;
      const la = gs.lateral;
      marks.push(roadPatch(path, d + 1.45, d + 1.7, la - 1.2, la + 1.2, { dy: 0.018, step: 0.25, across: 1 }));
      for (const sx of [-1, 1]) marks.push(roadPatch(path, d + 0.6, d + 1.7, la + sx * 1.2 - 0.12, la + sx * 1.2 + 0.12, { dy: 0.018, step: 0.5, across: 1 }));
    }
    const mg = mergeSimple(marks);
    const mm = decalMat({ color: '#f4f4f4' });
    const mMesh = new THREE.Mesh(mg, mm);
    mMesh.name = 'gridMarks';
    mMesh.receiveShadow = true;
    group.add(mMesh);
    W.disposables.push(mg, mm);
  }

  // ---------------------------------------------------------------------------------------------------
  // Gantry
  // ---------------------------------------------------------------------------------------------------
  buildGantry(W);

  // ---------------------------------------------------------------------------------------------------
  // Features
  // ---------------------------------------------------------------------------------------------------
  const dashGeos = [];
  const rampTops = [];
  const rampSides = [];
  const slowGeos = [];
  const warnGeos = [];
  const slowKind = theme.offroad.type === 'sand' || theme.ground.type === 'sand' ? 'sand' : theme.offroad.type === 'snow' || theme.ground.type === 'snow' ? 'snow' : theme.ground.type === 'lava' || theme.road.style === 'neon' ? 'oil' : 'mud';
  const rampAccent = theme.road.style === 'rainbow' ? '#b18cff' : theme.edge.style === 'glow' ? theme.edge.colorA : '#1fb6ff';
  W.ramps = [];

  for (const f of def.features || []) {
    let d;
    try {
      d = path.resolveD(f);
    } catch {
      continue;
    }
    const fr = path.frameAt(d);
    const lat = f.lateral ?? 0;
    if (f.type === 'itemRow') {
      const n = f.count ?? 4;
      const spacing = f.spacing ?? Math.min(4.5, (fr.halfWidth * 1.6) / Math.max(1, n - 1));
      for (let k = 0; k < n; k++) {
        const la = lat + (k - (n - 1) / 2) * spacing;
        itemBoxSpots.push({ position: path.pointAt(d, la).add(new THREE.Vector3(0, 1.3, 0)), d, lateral: la });
      }
    } else if (f.type === 'coins') {
      const n = f.count ?? 5;
      for (let k = 0; k < n; k++) {
        const dd = d + (k - (n - 1) / 2) * (f.spacing ?? 4);
        const la = lat + (f.curve ? Math.sin((k / Math.max(1, n - 1)) * Math.PI) * f.curve : 0);
        coinSpots.push({ position: path.pointAt(dd, la).add(new THREE.Vector3(0, 0.9, 0)), d: path.wrapD(dd), lateral: la });
      }
    } else if (f.type === 'boost') {
      const len = f.length ?? 8;
      const w = f.width ?? 5;
      const tiles = Math.max(1, Math.round(len / 2.6));
      dashGeos.push(roadPatch(path, d - len / 2, d + len / 2, lat - w / 2, lat + w / 2, { dy: 0.035, step: 0.5, across: 1, uvFn: (t, s) => [s, t * tiles] }));
    } else if (f.type === 'ramp') {
      const len = f.length ?? 10;
      const w = f.width ?? fr.halfWidth * 2;
      const H = rampHeight(f.power ?? 1);
      const d0 = d - len / 2;
      const d1 = d + len / 2;
      const hFn = (t) => H * rampProfile(t);
      W.ramps.push({ d0, d1, lat0: lat - w / 2, lat1: lat + w / 2, height: H, power: f.power ?? 1 });
      rampTops.push(roadPatch(path, d0, d1, lat - w / 2, lat + w / 2, { dy: 0.02, step: 0.5, across: 2, heightFn: (t) => hFn(t), uvFn: (t, s) => [s, t * 2] }));
      // sides
      for (const sx of [-1, 1]) {
        const la = lat + (sx * w) / 2;
        rampSides.push(
          roadPatch(path, d0, d1, la, la, {
            dy: -0.1,
            step: 0.5,
            across: 1,
            heightFn: (t, s) => (s > 0.5 ? hFn(t) + 0.12 : 0),
            uvFn: (t, s) => [t, s],
          })
        );
      }
      // back face (vertical drop at the lip)
      rampSides.push(
        roadPatch(path, d1, d1 + 0.02, lat - w / 2, lat + w / 2, {
          dy: -0.1,
          step: 0.02,
          across: 1,
          heightFn: (t) => (t < 0.5 ? H + 0.12 : 0),
        })
      );
    } else if (f.type === 'slow') {
      const len = (f.length ?? 8) * 1.15;
      const w = (f.width ?? 5) * 1.2;
      slowGeos.push(roadPatch(path, d - len / 2, d + len / 2, lat - w / 2, lat + w / 2, { dy: 0.028, step: 0.5, across: 4, uvFn: (t, s) => [s, t] }));
    } else if (f.type === 'hazardZone') {
      const len = f.length ?? 8;
      const w = f.width ?? 5;
      warnGeos.push(roadPatch(path, d - len / 2, d + len / 2, lat - w / 2, lat + w / 2, { dy: 0.03, step: 0.5, across: 1, uvFn: (t, s) => [s * (w / 2), t * (len / 2)] }));
    } else if (f.type === 'hazard') {
      addFeatureHazard(W, f, d, lat, rng);
    }
  }

  if (dashGeos.length) {
    const tex = kit.dashPanel();
    const g = mergeSimple(dashGeos);
    const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'dashPanels';
    group.add(mesh);
    W.disposables.push(g, m);
    W.animated.push((dt) => (tex.offset.y = (tex.offset.y - dt * 2.4) % 1));
    // soft glow above each panel
    const gm = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ffb020', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 });
    W.disposables.push(gm);
  }
  if (rampTops.length) {
    const tex = kit.rampTop(rampAccent);
    const g = mergeSimple(rampTops);
    const m = new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.25 });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'rampTops';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const gs = mergeSimple(rampSides);
    const ms = new THREE.MeshLambertMaterial({ color: shade(rampAccent, -0.55), side: THREE.DoubleSide });
    const sm = new THREE.Mesh(gs, ms);
    sm.name = 'rampSides';
    sm.castShadow = true;
    group.add(sm);
    W.disposables.push(g, m, gs, ms);
  }
  if (slowGeos.length) {
    const tex = kit.slowPatch(slowKind);
    const g = mergeSimple(slowGeos);
    const m = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'slowPatches';
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    group.add(mesh);
    W.disposables.push(g, m);
  }
  if (warnGeos.length) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const cg = c.getContext('2d');
    cg.fillStyle = '#ffd23f';
    cg.fillRect(0, 0, 64, 64);
    cg.fillStyle = '#1a1a22';
    for (let k = -2; k < 4; k++) {
      cg.beginPath();
      cg.moveTo(k * 32, 64);
      cg.lineTo(k * 32 + 16, 64);
      cg.lineTo(k * 32 + 80, 0);
      cg.lineTo(k * 32 + 64, 0);
      cg.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const g = mergeSimple(warnGeos);
    const m = decalMat({ map: tex, transparent: true, opacity: 0.85 });
    group.add(new THREE.Mesh(g, m));
    W.disposables.push(g, m, tex);
  }
  void quality;
  return { itemBoxSpots, coinSpots };
}

// ---------------------------------------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------------------------------------
function addFeatureHazard(W, f, d, lat, rng) {
  const kind = f.kind || 'barrel';
  const radius = f.radius ?? 1.2;
  const meta = PROP_META[kind] || { r: 1 };
  const scale = f.scale ?? clamp(radius / meta.r, 0.4, 4);
  const obj = createProp(kind, { seed: f.seed ?? Math.floor(rng() * 1000), color: f.color, color2: f.color2, variant: f.variant, night: W.theme.night, scale });
  const fr = W.path.frameAt(d);
  const position = W.path.pointAt(d, lat);
  obj.position.copy(position);
  obj.rotation.y = fr.yaw + (f.yaw ?? (rng() - 0.5) * 1.2);
  W.group.add(obj);
  const moving = !!(f.move || f.moving);
  const hz = { position: position.clone(), radius, kind, effect: f.effect || 'bump', object3d: obj, active: true, moving };
  W.hazards.push(hz);
  if (moving) {
    const mv = typeof f.move === 'object' ? f.move : {};
    const amp = mv.lateral ?? mv.amplitude ?? f.amplitude ?? 5;
    const along = mv.along ?? 0;
    const speed = mv.speed ?? (mv.period ? (Math.PI * 2) / mv.period : 1.2);
    const phase = mv.phase ?? rng() * Math.PI * 2;
    const roll = kind === 'barrel' || kind === 'tire' || kind === 'boulder' || kind === 'rock';
    const tmp = new THREE.Vector3();
    let prevLat = lat;
    W.animated.push((dt, time) => {
      const la = lat + Math.sin(time * speed + phase) * amp;
      const dd = d + Math.sin(time * speed * 0.5 + phase) * along;
      W.path.pointAt(dd, la, tmp);
      obj.position.copy(tmp);
      hz.position.copy(tmp);
      if (roll) obj.rotation.z += ((la - prevLat) / Math.max(0.3, radius)) * -1;
      prevLat = la;
    });
  }
  if (f.spin) W.animated.push((dt) => (obj.rotation.y += dt * (typeof f.spin === 'number' ? f.spin : 1.5)));
  return hz;
}
export { addFeatureHazard };

// ---------------------------------------------------------------------------------------------------------
// Start / finish gantry
// ---------------------------------------------------------------------------------------------------------
function buildGantry(W) {
  const { path, kit, group, theme } = W;
  const f0 = path.frameAt(0);
  const hw = f0.halfWidth;
  const offMin = Math.min(f0.offL, f0.offR);
  const lat = hw + clamp(offMin * 0.5, 0.9, 2.4) + 0.2;
  const root = new THREE.Group();
  root.name = 'gantry';
  root.position.copy(f0.pos);
  root.rotation.y = f0.yaw;
  group.add(root);

  const white = getToonMaterial('#f4f7fb');
  const blue = getToonMaterial('#1fb6ff');
  const navy = getToonMaterial('#1d2a4d');
  const red = getToonMaterial('#ff3355', { emissive: '#ff3355', emissiveIntensity: 0.6 });
  const H = 8.2;
  const below = W.analysis.floating || W.analysis.hasVoid ? 4 : 1.5;
  const parts = [];
  const add = (geo, mat, x, y, z, ry = 0) => {
    geo.rotateY(ry);
    geo.translate(x, y, z);
    parts.push({ geo, mat });
  };
  for (const sx of [-1, 1]) {
    const x = sx * lat;
    add(new RoundedBoxGeometry(1.5, H + below, 1.5, 2, 0.18), white, x, (H - below) / 2, 0);
    add(new THREE.BoxGeometry(1.56, H * 0.6, 0.5), blue, x, H * 0.45, -0.55);
    add(new THREE.BoxGeometry(1.56, H * 0.6, 0.5), blue, x, H * 0.45, 0.55);
    add(new THREE.BoxGeometry(2.1, 0.5, 2.1), navy, x, 0.25, 0);
    add(new THREE.BoxGeometry(1.8, 0.35, 1.8), navy, x, H + 2.1, 0);
  }
  const span = lat * 2 + 1.5;
  add(new RoundedBoxGeometry(span, 2.1, 1.1, 2, 0.2), white, 0, H + 0.95, 0);
  add(new THREE.BoxGeometry(span + 0.02, 0.22, 1.14), blue, 0, H - 0.05, 0);
  add(new THREE.BoxGeometry(span + 0.02, 0.22, 1.14), blue, 0, H + 1.95, 0);
  // light housing under the beam
  add(new RoundedBoxGeometry(4.2, 1.35, 0.8, 2, 0.2), navy, 0, H - 0.75, -0.1);
  for (let k = 0; k < 3; k++) {
    const visor = new THREE.CylinderGeometry(0.52, 0.52, 0.5, 16, 1, true, -Math.PI / 2, Math.PI);
    visor.rotateX(Math.PI / 2);
    add(visor, navy, (k - 1) * 1.3, H - 0.62, -0.72);
  }
  // merge per material
  const byMat = new Map();
  for (const p of parts) {
    const list = byMat.get(p.mat) || [];
    list.push(p.geo);
    byMat.set(p.mat, list);
  }
  for (const [mat, geos] of byMat) {
    const g = mergeSimple(geos);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    W.disposables.push(g);
  }
  // banner on both faces
  const bt = kit.banner();
  const bm = new THREE.MeshLambertMaterial({ map: bt, emissive: new THREE.Color('#ffffff'), emissiveMap: bt, emissiveIntensity: theme.night ? 0.8 : 0.25 });
  const bw = span - 0.6;
  const bh = Math.min(1.9, bw / 8);
  for (const [z, ry] of [
    [-0.57, Math.PI],
    [0.57, 0],
  ]) {
    const g = new THREE.PlaneGeometry(bw, bh);
    const m = new THREE.Mesh(g, bm);
    m.position.set(0, H + 0.95, z);
    m.rotation.y = ry;
    root.add(m);
    W.disposables.push(g);
  }
  W.disposables.push(bm);

  // start lamps (face the approaching racers: local -Z)
  const lamps = [];
  const glowM = [];
  for (let k = 0; k < 3; k++) {
    const m = new THREE.MeshBasicMaterial({ color: '#3a1216', toneMapped: false });
    const g = new THREE.CircleGeometry(0.42, 20);
    const lamp = new THREE.Mesh(g, m);
    lamp.position.set((k - 1) * 1.3, H - 0.8, -0.52);
    lamp.rotation.y = Math.PI;
    root.add(lamp);
    const gm = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff2a2a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), gm);
    glow.position.set((k - 1) * 1.3, H - 0.8, -0.62);
    glow.rotation.y = Math.PI;
    root.add(glow);
    lamps.push(m);
    glowM.push(gm);
    W.disposables.push(g, m, glow.geometry, gm);
  }
  // also a mirrored set on the back so the finish side shows state
  const lampState = { n: 0 };
  W.setStartLights = (n) => {
    lampState.n = n;
    for (let k = 0; k < 3; k++) {
      let col = '#3a1216';
      let glow = 0;
      let gc = '#ff2a2a';
      if (n >= 4) {
        col = '#3dffc8';
        gc = '#3dffc8';
        glow = 0.95;
      } else if (n >= k + 1) {
        col = '#ff2a2a';
        glow = 0.9;
      }
      lamps[k].color.set(col);
      glowM[k].color.set(gc);
      glowM[k].opacity = glow;
    }
  };
  W.setStartLights(0);

  // Serika's crosshair halo on top (slowly turning)
  const halo = new THREE.Group();
  halo.position.set(0, H + 3.6, 0);
  const hm = getToonMaterial('#ff3355', { emissive: '#ff3355', emissiveIntensity: 0.9 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.14, 8, 40), hm);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 8, 28), hm);
  halo.add(ring, ring2);
  for (let k = 0; k < 4; k++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 0.16), hm);
    const a = (k * Math.PI) / 2;
    bar.position.set(Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0);
    bar.rotation.z = a + Math.PI / 2;
    halo.add(bar);
  }
  const hg = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff5a78', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
  halo.add(hg);
  halo.traverse((o) => o.isMesh && W.disposables.push(o.geometry));
  W.disposables.push(hg.material);
  root.add(halo);
  W.animated.push((dt, time) => {
    halo.rotation.y = time * 0.8;
    halo.position.y = H + 3.6 + Math.sin(time * 1.6) * 0.18;
    hg.rotation.y = -time * 0.8; // keep glow facing roughly forward
  });
  // flags on pillar tops
  for (const sx of [-1, 1]) {
    const fl = createProp('flag', { variant: 'checker', scale: 0.55 });
    fl.position.set(sx * lat, H + 2.25, 0);
    fl.rotation.y = sx > 0 ? Math.PI : 0;
    root.add(fl);
  }
  void UP;
  void red;
}
