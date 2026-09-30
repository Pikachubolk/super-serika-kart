// Procedural karts (owner: characters agent) — see ARCHITECTURE.md §6.
//
// Each kart is ONE skinned, vertex-coloured toon mesh (+ outline): chassis/body parts are merged, the four
// wheels and the steering wheel are driven by bones (spin, front-wheel steering, wheel rotation), and the
// decals (emblem badge, side badges, number plate) sample a small per-character canvas atlas.
//
//   createKartModel(character, { quality }) -> KartModel
//   KartModel = { group, bodyBone, layout, update(dt, state, motion), getHandTargets(outL, outR), setTint(), dispose() }
//   layout (kart space, +Z forward): { seat, steer: { center, axis, up, side, radius }, exhausts[], exhaustTilt,
//            wheels: { FL, FR, RL, RR: { pos, r, w } }, rear, front, bodyPivot }

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  MeshBuilder,
  QUALITY_DETAIL,
  alignedCapsule,
  alignedCylinder,
  createToonMaterial,
  ellipsoidGeo,
  getOutlineMaterial,
  latheGeo,
  mixHex,
  shadeHex,
  strandGeo,
} from './CharacterModel.js';
import { clamp, damp, lerp, smoothstep } from '../core/utils.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Steering wheel relative to the driver's seat (driver space) — shared by all karts so the arms line up.
const STEER_REL = V(0, 0.175, 0.235);
const STEER_ELEV = 0.96; // elevation of the wheel face normal (towards the driver), radians
const STEER_R = 0.115;

const TIRE = '#2a2a31';
const CHROME = '#d8dee8';
const METAL = '#9aa1ad';
const DARK = '#34343c';

const STYLES = {
  standard: {
    front: { x: 0.6, z: 0.74, r: 0.25, w: 0.21 },
    rear: { x: 0.64, z: -0.7, r: 0.3, w: 0.29 },
    seat: V(0, 0.4, -0.2),
    exhausts: [V(0.21, 0.62, -1.06), V(-0.21, 0.62, -1.06)],
    exhaustTilt: 0.5,
  },
  sport: {
    front: { x: 0.6, z: 0.8, r: 0.24, w: 0.22 },
    rear: { x: 0.63, z: -0.72, r: 0.29, w: 0.31 },
    seat: V(0, 0.34, -0.24),
    exhausts: [V(0.11, 0.37, -1.12), V(-0.11, 0.37, -1.12)],
    exhaustTilt: 0.12,
  },
  heavy: {
    front: { x: 0.64, z: 0.72, r: 0.31, w: 0.27 },
    rear: { x: 0.66, z: -0.72, r: 0.36, w: 0.34 },
    seat: V(0, 0.5, -0.18),
    exhausts: [V(0.44, 1.08, -0.88), V(-0.44, 1.08, -0.88)],
    exhaustTilt: 1.05,
  },
  light: {
    front: { x: 0.56, z: 0.7, r: 0.21, w: 0.17 },
    rear: { x: 0.6, z: -0.68, r: 0.25, w: 0.23 },
    seat: V(0, 0.36, -0.18),
    exhausts: [V(0.15, 0.5, -1.02), V(-0.15, 0.5, -1.02)],
    exhaustTilt: 0.35,
  },
  luxury: {
    front: { x: 0.62, z: 0.78, r: 0.27, w: 0.22 },
    rear: { x: 0.63, z: -0.74, r: 0.29, w: 0.26 },
    seat: V(0, 0.42, -0.24),
    exhausts: [V(0.3, 0.27, -1.2), V(-0.3, 0.27, -1.2)],
    exhaustTilt: 0.05,
  },
};

// =========================================================================================================
// Decal atlas: emblem (left 256x256), number plate (top-right 256x128), white (bottom-right)
// =========================================================================================================

const SCHOOL_SHORT = (s = '') => (s.split(' ')[0] || 'KIVOTOS').toUpperCase();

function drawEmblemSymbol(g, kind, c) {
  g.fillStyle = c;
  g.strokeStyle = c;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  switch (kind) {
    case 'cat': {
      g.beginPath();
      g.moveTo(-58, -8);
      g.lineTo(-62, -70);
      g.lineTo(-18, -40);
      g.quadraticCurveTo(0, -46, 18, -40);
      g.lineTo(62, -70);
      g.lineTo(58, -8);
      g.bezierCurveTo(62, 48, -62, 48, -58, -8);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.ellipse(-24, -2, 9, 15, 0, 0, TAU);
      g.ellipse(24, -2, 9, 15, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(-8, 16);
      g.lineTo(8, 16);
      g.lineTo(0, 24);
      g.fill();
      g.lineWidth = 4;
      g.beginPath();
      for (const s of [-1, 1]) {
        g.moveTo(s * 34, 16);
        g.lineTo(s * 58, 10);
        g.moveTo(s * 34, 24);
        g.lineTo(s * 58, 28);
      }
      g.stroke();
      g.globalCompositeOperation = 'source-over';
      break;
    }
    case 'wolf': {
      g.beginPath();
      g.moveTo(-50, -20);
      g.lineTo(-42, -76);
      g.lineTo(-12, -38);
      g.lineTo(12, -38);
      g.lineTo(42, -76);
      g.lineTo(50, -20);
      g.lineTo(40, 18);
      g.lineTo(12, 30);
      g.lineTo(0, 62);
      g.lineTo(-12, 30);
      g.lineTo(-40, 18);
      g.closePath();
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 14, -6);
        g.lineTo(s * 36, -12);
        g.lineTo(s * 30, 2);
        g.closePath();
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      break;
    }
    case 'whale': {
      g.beginPath();
      g.ellipse(-8, 12, 52, 34, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(36, 8);
      g.quadraticCurveTo(58, -6, 70, -30);
      g.quadraticCurveTo(62, -8, 76, 6);
      g.quadraticCurveTo(60, 8, 40, 26);
      g.fill();
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(-18, -26);
      g.quadraticCurveTo(-24, -52, -38, -58);
      g.moveTo(-18, -26);
      g.quadraticCurveTo(-10, -54, 4, -60);
      g.stroke();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(-34, 6, 6, 0, TAU);
      g.fill();
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-48, 26);
      g.quadraticCurveTo(-10, 42, 30, 24);
      g.stroke();
      g.globalCompositeOperation = 'source-over';
      break;
    }
    case 'card': {
      g.save();
      g.rotate(-0.18);
      roundRect(g, -64, -40, 128, 82, 12);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(-64, -22, 128, 14);
      roundRect(g, -46, 4, 26, 20, 4);
      g.fill();
      g.fillRect(4, 16, 44, 6);
      g.globalCompositeOperation = 'source-over';
      g.restore();
      break;
    }
    case 'plus':
      g.fillRect(-20, -62, 40, 124);
      g.fillRect(-62, -20, 124, 40);
      break;
    case 'star':
      star(g, 0, 4, 68, 28, 5);
      g.fill();
      break;
    case 'sword': {
      g.beginPath();
      g.moveTo(0, -74);
      g.lineTo(13, -52);
      g.lineTo(11, 22);
      g.lineTo(-11, 22);
      g.lineTo(-13, -52);
      g.closePath();
      g.fill();
      roundRect(g, -40, 22, 80, 13, 6);
      g.fill();
      g.fillRect(-7, 35, 14, 30);
      g.beginPath();
      g.arc(0, 70, 10, 0, TAU);
      g.fill();
      break;
    }
    case 'wing': {
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.ellipse(-10 + i * 4, -30 + i * 22, 58 - i * 9, 13, -0.35 - i * 0.05, 0, TAU);
        g.fill();
      }
      g.beginPath();
      g.ellipse(-40, -10, 22, 46, 0.2, 0, TAU);
      g.fill();
      break;
    }
    default:
      g.beginPath();
      g.arc(0, 0, 50, 0, TAU);
      g.fill();
  }
}

function star(g, x, y, r0, r1, n) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? r0 : r1;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const _atlasCache = new Map();
function getKartAtlas(character) {
  let tex = _atlasCache.get(character.id);
  if (tex) return tex;
  const k = character.kart || {};
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 256);
  // emblem badge
  g.save();
  g.translate(128, 128);
  g.fillStyle = k.trim || '#ffffff';
  g.beginPath();
  g.arc(0, 0, 124, 0, TAU);
  g.fill();
  g.fillStyle = shadeHex(k.trim || '#ffffff', 0.7);
  g.beginPath();
  g.arc(0, 0, 112, 0, TAU);
  g.fill();
  const bg = g.createLinearGradient(0, -104, 0, 104);
  bg.addColorStop(0, shadeHex(k.accent || '#1d2a4d', 1.25));
  bg.addColorStop(1, shadeHex(k.accent || '#1d2a4d', 0.8));
  g.fillStyle = bg;
  g.beginPath();
  g.arc(0, 0, 104, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.14)';
  g.beginPath();
  g.ellipse(-20, -52, 70, 34, -0.3, 0, TAU);
  g.fill();
  const symbolCol = (k.accent || '').toLowerCase() === '#ffffff' ? k.body || '#e8304f' : '#ffffff';
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 3;
  drawEmblemSymbol(g, k.emblem || 'star', symbolCol);
  g.restore();
  // number plate
  g.save();
  g.translate(256, 0);
  roundRect(g, 4, 4, 248, 120, 16);
  g.fillStyle = '#1d1f2a';
  g.fill();
  roundRect(g, 10, 10, 236, 108, 12);
  g.fillStyle = '#fbf7e8';
  g.fill();
  g.fillStyle = k.body || '#e8304f';
  g.fillRect(10, 10, 236, 26);
  g.fillStyle = '#ffffff';
  g.font = 'bold 20px "Arial Black", "Segoe UI Black", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(SCHOOL_SHORT(character.school), 128, 24);
  g.fillStyle = '#1d1f2a';
  const name = (character.name || character.id || '').toUpperCase();
  let size = 58;
  g.font = `900 ${size}px "Arial Black", "Segoe UI Black", Arial, sans-serif`;
  while (g.measureText(name).width > 214 && size > 24) {
    size -= 2;
    g.font = `900 ${size}px "Arial Black", "Segoe UI Black", Arial, sans-serif`;
  }
  g.fillText(name, 128, 80);
  g.restore();
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.name = `kartAtlas:${character.id}`;
  _atlasCache.set(character.id, tex);
  return tex;
}

/** Plane with UVs mapped into an atlas rect, facing +Z before the matrix. */
function decalGeo(w, h, rect, matrix) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(rect[0], rect[2], uv.getX(i)), lerp(rect[1], rect[3], uv.getY(i)));
  g.applyMatrix4(matrix);
  return g;
}
const RECT_EMBLEM = [0.004, 0.008, 0.496, 0.992];
const RECT_PLATE = [0.504, 0.508, 0.996, 0.996];
const WHITE_UV = [0.75, 0.25];

// =========================================================================================================
// Asset builder
// =========================================================================================================

const _kartCache = new Map();
export function getKartAsset(character, quality = 'high') {
  const key = `${character.id}|${quality}`;
  let a = _kartCache.get(key);
  if (!a) {
    a = buildKartAsset(character, quality);
    _kartCache.set(key, a);
  }
  return a;
}

function rbox(w, h, d, r, seg, deform) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2 - 0.001));
  if (deform) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const o = deform(p.getX(i), p.getY(i), p.getZ(i));
      p.setXYZ(i, o[0], o[1], o[2]);
    }
    g.computeVertexNormals();
  }
  return g;
}
const at = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1));

function buildKartAsset(character, quality) {
  const q = QUALITY_DETAIL[quality] ?? 1;
  const k = character.kart || {};
  const styleName = STYLES[k.style] ? k.style : 'standard';
  const S = STYLES[styleName];
  const body = k.body || '#e8304f';
  const accent = k.accent || '#1d2a4d';
  const trim = k.trim || '#27d3f0';
  const mb = new MeshBuilder({ whiteUV: WHITE_UV, outlines: quality !== 'low' });

  // ---- skeleton ------------------------------------------------------------------------------------
  const bones = [];
  const addBone = (name, parent, pos) => {
    bones.push({ name, parent, pos: pos.clone() });
    return bones.length - 1;
  };
  const B_ROOT = addBone('kroot', -1, V(0, 0, 0));
  const B_BODY = addBone('body', B_ROOT, V(0, 0.36, -0.05));
  const seat = S.seat.clone();
  const steerCenter = seat.clone().add(STEER_REL);
  const B_STEER = addBone('steer', B_BODY, steerCenter);
  const wheels = {
    FL: { pos: V(S.front.x, S.front.r, S.front.z), r: S.front.r, w: S.front.w, side: 1, front: true },
    FR: { pos: V(-S.front.x, S.front.r, S.front.z), r: S.front.r, w: S.front.w, side: -1, front: true },
    RL: { pos: V(S.rear.x, S.rear.r, S.rear.z), r: S.rear.r, w: S.rear.w, side: 1, front: false },
    RR: { pos: V(-S.rear.x, S.rear.r, S.rear.z), r: S.rear.r, w: S.rear.w, side: -1, front: false },
  };
  for (const [name, wh] of Object.entries(wheels)) {
    if (wh.front) {
      wh.pivot = addBone(`pivot${name}`, B_ROOT, wh.pos);
      wh.spin = addBone(`spin${name}`, wh.pivot, wh.pos);
    } else {
      wh.pivot = -1;
      wh.spin = addBone(`spin${name}`, B_ROOT, wh.pos);
    }
  }

  // ---- steering wheel ------------------------------------------------------------------------------
  const faceN = V(0, Math.sin(STEER_ELEV), -Math.cos(STEER_ELEV)); // towards the driver
  const axisF = faceN.clone().negate(); // along the column, away from the driver
  const upU = V(0, Math.cos(STEER_ELEV), Math.sin(STEER_ELEV));
  const sideX = V(1, 0, 0);
  {
    const ring = new THREE.TorusGeometry(STEER_R, 0.019, Math.round(6 * q) + 2, Math.round(20 * q));
    // torus lies in XY with normal +Z: map (X, Y, Z) -> (sideX, upU, faceN)
    const m = new THREE.Matrix4().makeBasis(sideX, upU, faceN).setPosition(steerCenter);
    ring.applyMatrix4(m);
    mb.add(ring, { bone: B_STEER, color: DARK, outline: 0.7 });
    const hub = new THREE.CylinderGeometry(0.045, 0.05, 0.035, 12);
    hub.rotateX(Math.PI / 2);
    hub.applyMatrix4(m);
    mb.add(hub, { bone: B_STEER, color: trim, outline: 0.6 });
    for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
      const dir = sideX.clone().multiplyScalar(Math.sin(a + Math.PI)).addScaledVector(upU, Math.cos(a + Math.PI));
      mb.add(alignedCylinder(steerCenter, steerCenter.clone().addScaledVector(dir, STEER_R), 0.011, 0.011, 5), { bone: B_STEER, color: DARK, outline: 0 });
    }
    // grips in trim colour at 10 & 2
    for (const s of [-1, 1]) {
      const c = steerCenter.clone().addScaledVector(sideX, s * STEER_R * 0.87).addScaledVector(upU, STEER_R * 0.5);
      mb.add(ellipsoidGeo(c, 0.026, 0.026, 0.026, null, 8, 6), { bone: B_STEER, color: shadeHex(trim, 0.85), outline: 0 });
    }
    // column (static, body)
    const colEnd = steerCenter.clone().addScaledVector(axisF, 0.3);
    mb.add(alignedCylinder(steerCenter.clone().addScaledVector(axisF, 0.02), colEnd, 0.022, 0.028, 8), { bone: B_BODY, color: METAL, outline: 0.6 });
  }

  // ---- wheels --------------------------------------------------------------------------------------
  const whitewall = styleName === 'luxury';
  for (const wh of Object.values(wheels)) buildWheel(mb, wh, { q, trim, accent, whitewall, sporty: styleName === 'sport', heavy: styleName === 'heavy' });

  // ---- seat ----------------------------------------------------------------------------------------
  const seatCol = styleName === 'luxury' ? shadeHex(accent, 1.25) : accent;
  mb.add(rbox(0.46, 0.1, 0.44, 0.05, 2), { matrix: at(seat.x, seat.y - 0.05, seat.z + 0.02), bone: B_BODY, color: seatCol });
  mb.add(rbox(0.5, 0.34, 0.09, 0.045, 2), { matrix: at(seat.x, seat.y + 0.14, seat.z - 0.19, -0.22), bone: B_BODY, color: seatCol });
  mb.add(rbox(0.52, 0.04, 0.1, 0.02, 1), { matrix: at(seat.x, seat.y + 0.31, seat.z - 0.23, -0.22), bone: B_BODY, color: trim, outline: 0.7 });
  for (const s of [-1, 1]) {
    mb.add(rbox(0.07, 0.22, 0.34, 0.035, 1), { matrix: at(s * 0.25, seat.y + 0.04, seat.z - 0.04), bone: B_BODY, color: seatCol });
  }

  // ---- body by style ---------------------------------------------------------------------------------
  const ctx = { mb, q, S, body, accent, trim, seat, B_BODY, steerCenter, axisF, character };
  const decals = STYLE_BUILDERS[styleName](ctx);

  // ---- decals -----------------------------------------------------------------------------------------
  const dm = (m) => ({ bone: B_BODY, keepUV: true, outline: 0, matrix: m });
  if (decals.emblem) mb.add(decalGeo(decals.emblem.size, decals.emblem.size, RECT_EMBLEM, decals.emblem.m), dm());
  for (const d of decals.sides || []) mb.add(decalGeo(d.size, d.size, RECT_EMBLEM, d.m), dm());
  if (decals.plate) mb.add(decalGeo(decals.plate.w, decals.plate.w / 2, RECT_PLATE, decals.plate.m), dm());

  const built = mb.build();
  const layout = {
    style: styleName,
    seat,
    steer: { center: steerCenter, axis: axisF, up: upU, side: sideX, radius: STEER_R },
    exhausts: S.exhausts.map((e) => e.clone()),
    exhaustTilt: S.exhaustTilt,
    wheels: Object.fromEntries(Object.entries(wheels).map(([n, w]) => [n, { pos: w.pos.clone(), r: w.r, w: w.w, side: w.side, front: w.front }])),
    rear: decals.rear || V(0, 0.45, -1.1),
    front: decals.front || V(0, 0.4, 1.1),
    bodyPivot: bones[B_BODY].pos.clone(),
  };
  return {
    id: character.id,
    geometry: built.geometry,
    outlineGeometry: built.outlineGeometry,
    tris: built.tris,
    outlineTris: built.outlineTris,
    bones,
    boneIds: {
      root: B_ROOT,
      body: B_BODY,
      steer: B_STEER,
      pivotFL: wheels.FL.pivot,
      pivotFR: wheels.FR.pivot,
      spinFL: wheels.FL.spin,
      spinFR: wheels.FR.spin,
      spinRL: wheels.RL.spin,
      spinRR: wheels.RR.spin,
    },
    layout,
    texture: getKartAtlas(character),
  };
}

function buildWheel(mb, wh, { q, trim, accent, whitewall, sporty, heavy }) {
  const { r, w, side, spin } = wh;
  const p = wh.pos;
  const segs = Math.round(16 * q);
  const ri = r * 0.62;
  const h = w / 2;
  const prof = [
    [ri, -h],
    [r * 0.88, -h],
    [r * 0.975, -h + w * 0.12],
    [r, -h + w * 0.3],
    [r, h - w * 0.3],
    [r * 0.975, h - w * 0.12],
    [r * 0.88, h],
    [ri, h],
  ];
  const knob = heavy ? 0.06 : 0.035;
  const tire = latheGeo(prof, {
    segs,
    rFn: (rr, y, a, k) => {
      if (k < 2 || k > 5) return rr;
      const j = Math.round((a - Math.PI) / (TAU / segs));
      return rr * (1 + (j % 2 === 0 ? knob : 0) * (k === 3 || k === 4 ? 1 : 0.5));
    },
  });
  // lathe axis Y -> wheel axle X ; outer face towards +side
  const toAxle = new THREE.Matrix4().makeRotationZ((-side * Math.PI) / 2).setPosition(p);
  const wwCol = new THREE.Color('#f4f1ea');
  const tireC = new THREE.Color(TIRE);
  mb.add(tire, {
    matrix: toAxle,
    bone: spin,
    colorFn: whitewall
      ? (x, y, z, i, t, out) => {
          const lx = (x - p.x) * side;
          const rr = Math.hypot(y - p.y, z - p.z);
          out.copy(lx > h * 0.6 && rr > r * 0.7 && rr < r * 0.86 ? wwCol : tireC);
        }
      : undefined,
    color: TIRE,
  });
  // rim barrel (closes the tire)
  const rim = new THREE.CylinderGeometry(ri * 1.01, ri * 1.01, w * 0.86, segs, 1, true);
  mb.add(rim, { matrix: toAxle, bone: spin, color: '#50535e', outline: 0 });
  // hubcap on the outer face
  const capH = 0.03;
  const cap = new THREE.CylinderGeometry(ri * 0.94, ri * 1.0, capH, segs, 1, false);
  cap.translate(0, h * 0.86 * 0.5 - capH * 0.3, 0);
  mb.add(cap, { matrix: toAxle, bone: spin, color: trim, outline: 0 });
  const hub = new THREE.CylinderGeometry(ri * 0.3, ri * 0.36, 0.05, 10, 1, false);
  hub.translate(0, h * 0.86 * 0.5 + 0.018, 0);
  mb.add(hub, { matrix: toAxle, bone: spin, color: shadeHex(accent, 1.1), outline: 0 });
  const nSpokes = sporty ? 6 : 5;
  for (let i = 0; i < nSpokes; i++) {
    const a = (i / nSpokes) * TAU;
    const sp = new THREE.BoxGeometry(ri * 0.62, 0.024, sporty ? 0.03 : 0.045);
    sp.translate(ri * 0.55, 0, 0);
    sp.rotateY(a);
    sp.translate(0, h * 0.86 * 0.5 + 0.004, 0);
    mb.add(sp, { matrix: toAxle, bone: spin, color: shadeHex(accent, 0.9), outline: 0 });
  }
  // inner hub disc so the wheel never looks hollow from the inside
  const inner = new THREE.CylinderGeometry(ri * 0.95, ri * 0.95, 0.01, 10);
  inner.translate(0, -h * 0.8, 0);
  mb.add(inner, { matrix: toAxle, bone: spin, color: '#3a3c45', outline: 0 });
}

// ---- per-style bodies -----------------------------------------------------------------------------------

const noseDeform = (topDrop, taper, zStart = -0.2) => (x, y, z) => {
  const f = smoothstep(zStart, 0.5, z);
  return [x * lerp(1, taper, f), y > 0 ? y * lerp(1, topDrop, f) : y, z];
};

const STYLE_BUILDERS = {
  standard({ mb, q, body, accent, trim, seat, B_BODY, steerCenter, axisF }) {
    const seg2 = q >= 0.8 ? 2 : 1;
    mb.add(rbox(0.98, 0.1, 1.9, 0.045, 1), { matrix: at(0, 0.2, -0.04), bone: B_BODY, color: accent });
    // nose
    mb.add(rbox(0.86, 0.32, 0.92, 0.14, seg2, noseDeform(0.45, 0.8)), { matrix: at(0, 0.37, 0.62), bone: B_BODY, color: body });
    mb.add(rbox(0.3, 0.05, 0.62, 0.02, 1, noseDeform(1, 0.7)), { matrix: at(0, 0.5, 0.56, -0.2), bone: B_BODY, color: trim, outline: 0.6 });
    // bumper + lights
    mb.add(alignedCapsule(V(-0.52, 0.23, 1.08), V(0.52, 0.23, 1.08), 0.06, 3, 8), { bone: B_BODY, color: accent });
    for (const s of [-1, 1]) {
      mb.add(ellipsoidGeo(V(s * 0.25, 0.4, 1.03), 0.07, 0.06, 0.04, null, 10, 6), { bone: B_BODY, color: '#fff4c4', outline: 0.6 });
      mb.add(ellipsoidGeo(V(s * 0.56, 0.23, 1.08), 0.07, 0.07, 0.07, null, 8, 6), { bone: B_BODY, color: trim, outline: 0.6 });
    }
    // side pods
    for (const s of [-1, 1]) {
      mb.add(rbox(0.28, 0.26, 0.98, 0.1, seg2), { matrix: at(s * 0.5, 0.36, -0.08), bone: B_BODY, color: body });
      mb.add(rbox(0.29, 0.035, 0.86, 0.015, 1), { matrix: at(s * 0.5, 0.49, -0.08), bone: B_BODY, color: trim, outline: 0 });
    }
    // dash
    mb.add(rbox(0.62, 0.14, 0.24, 0.06, 1), { matrix: at(0, 0.49, steerCenter.z + 0.3), bone: B_BODY, color: accent });
    // engine + exhausts
    mb.add(rbox(0.54, 0.28, 0.38, 0.07, 1), { matrix: at(0, 0.42, -0.74), bone: B_BODY, color: METAL });
    mb.add(alignedCylinder(V(0, 0.55, -0.68), V(0, 0.64, -0.68), 0.1, 0.11, 12), { bone: B_BODY, color: trim });
    for (let i = 0; i < 3; i++) mb.add(new THREE.BoxGeometry(0.5, 0.02, 0.05), { matrix: at(0, 0.35 + i * 0.07, -0.935), bone: B_BODY, color: shadeHex(METAL, 0.7), outline: 0 });
    for (const s of [-1, 1]) {
      mb.add(alignedCylinder(V(s * 0.17, 0.44, -0.86), V(s * 0.21, 0.6, -1.03), 0.042, 0.045, 8), { bone: B_BODY, color: CHROME });
      mb.add(alignedCylinder(V(s * 0.205, 0.585, -1.015), V(s * 0.215, 0.625, -1.07), 0.06, 0.062, 10), { bone: B_BODY, color: CHROME });
      mb.add(alignedCylinder(V(s * 0.214, 0.622, -1.068), V(s * 0.215, 0.626, -1.072), 0.045, 0.045, 10), { bone: B_BODY, color: '#1a1a1e', outline: 0 });
    }
    mb.add(alignedCapsule(V(-0.46, 0.25, -1.1), V(0.46, 0.25, -1.1), 0.055, 3, 8), { bone: B_BODY, color: accent });
    return {
      emblem: { size: 0.3, m: at(0, 0.508, 0.6, -Math.PI / 2 + 0.33) },
      sides: [1, -1].map((s) => ({ size: 0.2, m: at(s * 0.646, 0.36, -0.06, 0, (s * Math.PI) / 2) })),
      plate: { w: 0.3, m: at(0, 0.3, -1.03, 0, Math.PI) },
      rear: V(0, 0.45, -1.12),
      front: V(0, 0.35, 1.12),
    };
  },

  sport({ mb, q, body, accent, trim, B_BODY, steerCenter }) {
    const seg2 = q >= 0.8 ? 2 : 1;
    mb.add(rbox(0.92, 0.08, 1.95, 0.035, 1), { matrix: at(0, 0.17, -0.04), bone: B_BODY, color: accent });
    mb.add(rbox(0.56, 0.24, 1.25, 0.1, seg2, noseDeform(0.45, 0.5, -0.4)), { matrix: at(0, 0.3, 0.52), bone: B_BODY, color: body });
    mb.add(rbox(0.1, 0.04, 1.0, 0.02, 1, noseDeform(1, 0.6, -0.3)), { matrix: at(0, 0.415, 0.5, -0.12), bone: B_BODY, color: trim, outline: 0 });
    // front wing
    mb.add(rbox(1.3, 0.04, 0.24, 0.02, 1), { matrix: at(0, 0.17, 1.12), bone: B_BODY, color: trim });
    for (const s of [-1, 1]) mb.add(rbox(0.03, 0.14, 0.28, 0.012, 1), { matrix: at(s * 0.66, 0.22, 1.1), bone: B_BODY, color: accent });
    // side pods
    for (const s of [-1, 1]) {
      mb.add(rbox(0.3, 0.22, 1.02, 0.1, seg2, noseDeform(0.7, 0.75, -0.3)), { matrix: at(s * 0.44, 0.3, -0.16), bone: B_BODY, color: body });
      mb.add(rbox(0.31, 0.03, 0.8, 0.012, 1), { matrix: at(s * 0.44, 0.405, -0.2), bone: B_BODY, color: trim, outline: 0 });
    }
    mb.add(rbox(0.5, 0.12, 0.2, 0.05, 1), { matrix: at(0, 0.43, steerCenter.z + 0.3), bone: B_BODY, color: accent });
    // engine cowl + shark fin
    mb.add(rbox(0.5, 0.28, 0.66, 0.12, seg2), { matrix: at(0, 0.4, -0.76), bone: B_BODY, color: body });
    mb.add(rbox(0.03, 0.18, 0.5, 0.015, 1, (x, y, z) => [x, y > 0 ? y - (z + 0.25) * 0.25 : y, z]), { matrix: at(0, 0.6, -0.78), bone: B_BODY, color: trim, outline: 0.6 });
    // spoiler
    mb.add(rbox(1.24, 0.045, 0.3, 0.02, 1), { matrix: at(0, 0.84, -1.04, 0.12), bone: B_BODY, color: body });
    mb.add(rbox(1.25, 0.02, 0.05, 0.008, 1), { matrix: at(0, 0.865, -1.17, 0.12), bone: B_BODY, color: trim, outline: 0 });
    for (const s of [-1, 1]) {
      mb.add(rbox(0.035, 0.2, 0.34, 0.012, 1), { matrix: at(s * 0.63, 0.8, -1.04), bone: B_BODY, color: accent });
      mb.add(alignedCylinder(V(s * 0.22, 0.5, -0.95), V(s * 0.22, 0.84, -1.02), 0.02, 0.02, 6), { bone: B_BODY, color: DARK, outline: 0.6 });
    }
    for (const s of [-1, 1]) {
      mb.add(alignedCylinder(V(s * 0.1, 0.36, -1.0), V(s * 0.11, 0.37, -1.12), 0.045, 0.05, 10), { bone: B_BODY, color: CHROME });
      mb.add(alignedCylinder(V(s * 0.11, 0.37, -1.118), V(s * 0.11, 0.37, -1.122), 0.036, 0.036, 10), { bone: B_BODY, color: '#1a1a1e', outline: 0 });
    }
    mb.add(rbox(0.9, 0.06, 0.14, 0.02, 1), { matrix: at(0, 0.2, -1.1), bone: B_BODY, color: DARK });
    return {
      emblem: { size: 0.24, m: at(0, 0.415, 0.72, -Math.PI / 2 + 0.2) },
      sides: [1, -1].map((s) => ({ size: 0.18, m: at(s * 0.596, 0.3, -0.12, 0, (s * Math.PI) / 2) })),
      plate: { w: 0.26, m: at(0, 0.3, -1.095, 0, Math.PI) },
      rear: V(0, 0.4, -1.15),
      front: V(0, 0.25, 1.2),
    };
  },

  heavy({ mb, q, body, accent, trim, seat, B_BODY, steerCenter }) {
    const seg2 = q >= 0.8 ? 2 : 1;
    mb.add(rbox(1.04, 0.2, 1.9, 0.08, 1), { matrix: at(0, 0.34, -0.02), bone: B_BODY, color: accent });
    mb.add(rbox(1.08, 0.36, 0.76, 0.15, seg2, noseDeform(0.78, 0.9, -0.1)), { matrix: at(0, 0.58, 0.62), bone: B_BODY, color: body });
    mb.add(rbox(1.08, 0.46, 0.62, 0.15, seg2), { matrix: at(0, 0.62, -0.74), bone: B_BODY, color: body });
    for (const s of [-1, 1]) mb.add(rbox(0.2, 0.28, 0.74, 0.08, 1), { matrix: at(s * 0.46, 0.6, -0.08), bone: B_BODY, color: body });
    mb.add(rbox(0.7, 0.16, 0.22, 0.06, 1), { matrix: at(0, 0.7, steerCenter.z + 0.32), bone: B_BODY, color: accent });
    // fenders
    for (const wx of [1, -1]) {
      for (const [wz, wr, ww] of [
        [0.72, 0.31, 0.27],
        [-0.72, 0.36, 0.34],
      ]) {
        const f = new THREE.CylinderGeometry(wr + 0.07, wr + 0.07, ww + 0.1, Math.round(14 * q), 1, true, -Math.PI / 2 - 0.2, Math.PI + 0.4);
        f.rotateZ(Math.PI / 2);
        f.translate(wx * (wz > 0 ? 0.64 : 0.66), wr, wz);
        mb.add(f, { bone: B_BODY, color: shadeHex(body, 0.92), outline: 0.8 });
      }
    }
    // grille + bull bar
    for (let i = 0; i < 3; i++) mb.add(rbox(0.5, 0.035, 0.04, 0.015, 1), { matrix: at(0, 0.5 + i * 0.07, 1.0), bone: B_BODY, color: trim, outline: 0 });
    mb.add(alignedCapsule(V(-0.5, 0.5, 1.12), V(0.5, 0.5, 1.12), 0.045, 3, 8), { bone: B_BODY, color: trim });
    mb.add(alignedCapsule(V(-0.56, 0.3, 1.1), V(0.56, 0.3, 1.1), 0.06, 3, 8), { bone: B_BODY, color: accent });
    for (const s of [-1, 1]) {
      mb.add(alignedCylinder(V(s * 0.32, 0.3, 1.1), V(s * 0.32, 0.52, 1.12), 0.035, 0.035, 8), { bone: B_BODY, color: trim });
      mb.add(ellipsoidGeo(V(s * 0.36, 0.64, 0.99), 0.085, 0.075, 0.04, null, 12, 7), { bone: B_BODY, color: '#fff4c4', outline: 0.6 });
    }
    // exhaust stacks
    for (const s of [-1, 1]) {
      mb.add(alignedCylinder(V(s * 0.42, 0.78, -0.86), V(s * 0.44, 1.02, -0.88), 0.05, 0.05, 10), { bone: B_BODY, color: CHROME });
      mb.add(alignedCylinder(V(s * 0.44, 1.0, -0.88), V(s * 0.44, 1.08, -0.88), 0.066, 0.066, 10), { bone: B_BODY, color: CHROME });
      mb.add(alignedCylinder(V(s * 0.44, 1.078, -0.88), V(s * 0.44, 1.082, -0.88), 0.05, 0.05, 10), { bone: B_BODY, color: '#1a1a1e', outline: 0 });
    }
    mb.add(alignedCapsule(V(-0.56, 0.36, -1.08), V(0.56, 0.36, -1.08), 0.06, 3, 8), { bone: B_BODY, color: accent });
    mb.add(rbox(0.9, 0.04, 0.4, 0.02, 1), { matrix: at(0, 0.86, -0.74), bone: B_BODY, color: trim, outline: 0 });
    void seat;
    return {
      emblem: { size: 0.36, m: at(0, 0.765, 0.6, -Math.PI / 2 + 0.12) },
      sides: [1, -1].map((s) => ({ size: 0.24, m: at(s * 0.543, 0.64, -0.74, 0, (s * Math.PI) / 2) })),
      plate: { w: 0.34, m: at(0, 0.56, -1.052, 0, Math.PI) },
      rear: V(0, 0.6, -1.1),
      front: V(0, 0.45, 1.16),
    };
  },

  light({ mb, q, body, accent, trim, seat, B_BODY, steerCenter }) {
    const seg2 = q >= 0.8 ? 2 : 1;
    mb.add(rbox(0.78, 0.05, 1.55, 0.02, 1), { matrix: at(0, 0.19, -0.02), bone: B_BODY, color: shadeHex(accent, 0.8) });
    const tube = (a, b, r = 0.03) => mb.add(alignedCapsule(a, b, r, 2, 6), { bone: B_BODY, color: accent, outline: 0.7 });
    for (const s of [-1, 1]) {
      tube(V(s * 0.42, 0.22, -0.9), V(s * 0.42, 0.22, 0.62));
      tube(V(s * 0.42, 0.22, 0.62), V(s * 0.16, 0.3, 0.98));
    }
    tube(V(-0.42, 0.22, -0.9), V(0.42, 0.22, -0.9));
    tube(V(-0.16, 0.3, 0.98), V(0.16, 0.3, 0.98));
    // roll hoop
    const hoop = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const a = lerp(-Math.PI / 2, Math.PI / 2, u);
      hoop.push(V(Math.sin(a) * 0.3, seat.y + 0.02 + Math.cos(a) * 0.36, seat.z - 0.3));
    }
    mb.add(strandGeo(hoop, { r0: 0.028, r1: 0.028, seg: 12, radial: 6 }), { bone: B_BODY, color: trim, outline: 0.7 });
    // nose pod + fairings
    mb.add(rbox(0.58, 0.26, 0.56, 0.12, seg2, noseDeform(0.6, 0.8, -0.2)), { matrix: at(0, 0.36, 0.72), bone: B_BODY, color: body });
    mb.add(ellipsoidGeo(V(0, 0.36, 1.0), 0.07, 0.07, 0.04, null, 10, 6), { bone: B_BODY, color: '#fff4c4', outline: 0.6 });
    for (const s of [-1, 1]) {
      mb.add(rbox(0.14, 0.18, 0.62, 0.06, seg2), { matrix: at(s * 0.4, 0.33, 0.02), bone: B_BODY, color: body });
      mb.add(rbox(0.145, 0.03, 0.5, 0.012, 1), { matrix: at(s * 0.4, 0.42, 0.02), bone: B_BODY, color: trim, outline: 0 });
    }
    mb.add(rbox(0.46, 0.12, 0.18, 0.05, 1), { matrix: at(0, 0.45, steerCenter.z + 0.28), bone: B_BODY, color: body });
    // compact engine
    mb.add(rbox(0.42, 0.24, 0.3, 0.07, 1), { matrix: at(0, 0.36, -0.76), bone: B_BODY, color: METAL });
    mb.add(ellipsoidGeo(V(0, 0.5, -0.74), 0.09, 0.05, 0.09, null, 10, 6), { bone: B_BODY, color: body });
    for (const s of [-1, 1]) {
      mb.add(alignedCylinder(V(s * 0.12, 0.38, -0.88), V(s * 0.15, 0.49, -1.0), 0.035, 0.038, 8), { bone: B_BODY, color: CHROME });
      mb.add(alignedCylinder(V(s * 0.15, 0.49, -1.0), V(s * 0.151, 0.5, -1.03), 0.05, 0.05, 10), { bone: B_BODY, color: CHROME });
      mb.add(alignedCylinder(V(s * 0.151, 0.5, -1.028), V(s * 0.151, 0.502, -1.032), 0.037, 0.037, 10), { bone: B_BODY, color: '#1a1a1e', outline: 0 });
    }
    return {
      emblem: { size: 0.24, m: at(0, 0.475, 0.72, -Math.PI / 2 + 0.28) },
      sides: [1, -1].map((s) => ({ size: 0.13, m: at(s * 0.4725, 0.32, 0.02, 0, (s * Math.PI) / 2) })),
      plate: { w: 0.24, m: at(0, 0.3, -0.912, 0, Math.PI) },
      rear: V(0, 0.4, -1.05),
      front: V(0, 0.33, 1.05),
    };
  },

  luxury({ mb, q, body, accent, trim, B_BODY, steerCenter }) {
    const seg2 = q >= 0.8 ? 2 : 1;
    mb.add(rbox(0.9, 0.14, 1.96, 0.06, 1), { matrix: at(0, 0.26, -0.02), bone: B_BODY, color: accent });
    mb.add(rbox(0.78, 0.3, 0.9, 0.13, seg2, noseDeform(0.82, 0.92, -0.2)), { matrix: at(0, 0.44, 0.62), bone: B_BODY, color: body });
    mb.add(rbox(0.06, 0.02, 0.8, 0.01, 1), { matrix: at(0, 0.596, 0.6), bone: B_BODY, color: trim, outline: 0 });
    // grille
    mb.add(rbox(0.5, 0.24, 0.06, 0.04, 1), { matrix: at(0, 0.42, 1.07), bone: B_BODY, color: trim });
    for (let i = -3; i <= 3; i++) mb.add(new THREE.BoxGeometry(0.02, 0.18, 0.02), { matrix: at(i * 0.06, 0.42, 1.1), bone: B_BODY, color: accent, outline: 0 });
    // fenders
    const S = STYLES.luxury;
    for (const s of [-1, 1]) {
      for (const w of [S.front, S.rear]) {
        mb.add(ellipsoidGeo(V(s * w.x, w.r + 0.06, w.z), w.w * 0.75, w.r * 0.72, w.r * 1.45, null, Math.round(14 * q), 9), { bone: B_BODY, color: body });
      }
      mb.add(rbox(0.2, 0.05, 0.8, 0.02, 1), { matrix: at(s * 0.58, 0.3, 0.0), bone: B_BODY, color: accent });
      mb.add(ellipsoidGeo(V(s * 0.32, 0.5, 1.03), 0.07, 0.07, 0.04, null, 10, 6), { bone: B_BODY, color: '#fff4c4', outline: 0.6 });
    }
    // cowl / dash with a gold windscreen frame
    mb.add(rbox(0.66, 0.16, 0.26, 0.07, 1), { matrix: at(0, 0.54, steerCenter.z + 0.32), bone: B_BODY, color: body });
    const frame = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const a = lerp(-1.25, 1.25, u);
      frame.push(V(Math.sin(a) * 0.34, 0.6 + Math.cos(a) * 0.14, steerCenter.z + 0.38));
    }
    mb.add(strandGeo(frame, { r0: 0.016, r1: 0.016, seg: 12, radial: 5 }), { bone: B_BODY, color: trim, outline: 0.6 });
    // trunk + fins
    mb.add(rbox(0.82, 0.3, 0.64, 0.13, seg2), { matrix: at(0, 0.45, -0.8), bone: B_BODY, color: body });
    for (const s of [-1, 1]) {
      mb.add(rbox(0.05, 0.16, 0.34, 0.02, 1, (x, y, z) => [x, y > 0 ? y - Math.max(0, z) * 0.35 : y, z]), { matrix: at(s * 0.36, 0.64, -0.94), bone: B_BODY, color: body });
      mb.add(ellipsoidGeo(V(s * 0.3, 0.46, -1.12), 0.06, 0.04, 0.02, null, 8, 5), { bone: B_BODY, color: '#ff4d5e', outline: 0 });
    }
    // chrome bumpers + hood ornament
    mb.add(alignedCapsule(V(-0.5, 0.28, 1.12), V(0.5, 0.28, 1.12), 0.045, 3, 8), { bone: B_BODY, color: trim });
    mb.add(alignedCapsule(V(-0.46, 0.3, -1.14), V(0.46, 0.3, -1.14), 0.045, 3, 8), { bone: B_BODY, color: trim });
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 0.075 : 0.032;
      if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const sg = new THREE.ExtrudeGeometry(starShape, { depth: 0.02, bevelEnabled: false });
    sg.translate(0, 0, -0.01);
    mb.add(sg, { matrix: at(0, 0.68, 1.0), bone: B_BODY, color: trim, outline: 0.7 });
    mb.add(alignedCylinder(V(0, 0.58, 1.0), V(0, 0.62, 1.0), 0.012, 0.012, 6), { bone: B_BODY, color: trim, outline: 0 });
    for (const s of [-1, 1]) {
      mb.add(alignedCylinder(V(s * 0.3, 0.26, -1.0), V(s * 0.3, 0.27, -1.2), 0.035, 0.04, 10), { bone: B_BODY, color: CHROME });
      mb.add(alignedCylinder(V(s * 0.3, 0.27, -1.198), V(s * 0.3, 0.27, -1.202), 0.03, 0.03, 10), { bone: B_BODY, color: '#1a1a1e', outline: 0 });
    }
    return {
      emblem: { size: 0.24, m: at(0, 0.597, 0.62, -Math.PI / 2 + 0.06) },
      sides: [1, -1].map((s) => ({ size: 0.18, m: at(s * 0.411, 0.46, -0.8, 0, (s * Math.PI) / 2) })),
      plate: { w: 0.26, m: at(0, 0.42, -1.121, 0, Math.PI) },
      rear: V(0, 0.45, -1.2),
      front: V(0, 0.4, 1.18),
    };
  },
};

// =========================================================================================================
// KartModel instance
// =========================================================================================================

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class KartModel {
  constructor(character, { quality = 'high' } = {}) {
    this.character = character;
    const asset = getKartAsset(character, quality);
    this.asset = asset;
    this.layout = asset.layout;
    this.group = new THREE.Group();
    this.group.name = `kart:${character.id}`;
    this.bones = asset.bones.map((def) => {
      const b = new THREE.Bone();
      b.name = def.name;
      return b;
    });
    asset.bones.forEach((def, i) => {
      const b = this.bones[i];
      if (def.parent >= 0) {
        this.bones[def.parent].add(b);
        b.position.copy(def.pos).sub(asset.bones[def.parent].pos);
      } else {
        this.group.add(b);
        b.position.copy(def.pos);
      }
      b.userData.rest = b.position.clone();
    });
    const id = asset.boneIds;
    this.bodyBone = this.bones[id.body];
    this.steerBone = this.bones[id.steer];
    this.pivotFL = this.bones[id.pivotFL];
    this.pivotFR = this.bones[id.pivotFR];
    this.spinFL = this.bones[id.spinFL];
    this.spinFR = this.bones[id.spinFR];
    this.spinRL = this.bones[id.spinRL];
    this.spinRR = this.bones[id.spinRR];
    this.skeleton = new THREE.Skeleton(this.bones);
    this.material = createToonMaterial({ map: asset.texture, faceLight: 0, rim: 0.22 });
    this.mesh = new THREE.SkinnedMesh(asset.geometry, this.material);
    this.mesh.name = `kartMesh:${character.id}`;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    if (asset.outlineGeometry) {
      this.outline = new THREE.SkinnedMesh(asset.outlineGeometry, getOutlineMaterial());
      this.outline.name = `kartOutline:${character.id}`;
      this.group.add(this.outline);
    }
    this.group.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.outline?.bind(this.skeleton);
    const bs = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.6);
    this.mesh.boundingSphere = bs;
    if (this.outline) this.outline.boundingSphere = bs.clone();

    // wheel anchors that do not spin (for particles)
    this.wheelAnchors = {};
    for (const [n, w] of Object.entries(this.layout.wheels)) {
      const o = new THREE.Object3D();
      o.name = `wheel${n}`;
      if (n === 'FL') this.pivotFL.add(o);
      else if (n === 'FR') this.pivotFR.add(o);
      else {
        o.position.copy(w.pos);
        this.group.add(o);
      }
      this.wheelAnchors[n] = o;
    }

    this.spinF = 0;
    this.spinR = 0;
    this.steerVis = 0;
    this.wheelAngle = 0;
    this.roll = 0;
    this.pitch = 0;
    this.lastSpeed = 0;
    this.time = 0;
  }

  /**
   * @param {number} dt
   * @param {object} st RacerVisualState
   * @param {object} m  { speedN, accel }
   */
  update(dt, st = {}, m = {}) {
    dt = clamp(dt || 0, 0, 0.1);
    this.time += dt;
    const t = this.time;
    const L = this.layout;
    const speed = st.speed || 0;
    const speedN = m.speedN ?? clamp(Math.abs(speed) / 36, 0, 1.5);
    // wheels
    const spinSpeed = st.stalled ? 0 : speed;
    this.spinF = (this.spinF + (spinSpeed / L.wheels.FL.r) * dt) % TAU;
    this.spinR = (this.spinR + ((st.stalled && st.throttle ? 30 : spinSpeed) / L.wheels.RL.r) * dt) % TAU;
    this.spinFL.rotation.x = this.spinFR.rotation.x = this.spinF;
    this.spinRL.rotation.x = this.spinRR.rotation.x = this.spinR;
    const steerIn = clamp(st.steer || 0, -1, 1);
    const drifting = !!st.drifting;
    const steerTarget = drifting ? clamp(steerIn * 0.6 + (st.driftDir || 0) * 0.55, -1, 1) : steerIn;
    this.steerVis = dt > 0 ? damp(this.steerVis, steerTarget, 14, dt) : steerTarget;
    this.pivotFL.rotation.y = this.pivotFR.rotation.y = -this.steerVis * 0.42;
    // steering wheel
    this.wheelAngle = this.steerVis * 1.25 + (st.spinning || st.tumbling ? Math.sin(t * 20) * 0.6 : 0);
    this.steerBone.quaternion.setFromAxisAngle(L.steer.axis, this.wheelAngle);
    // body motion (subtle: the Kart already applies drift slide / squash / wheelie on root)
    const accel = m.accel || 0;
    const rollT = clamp(steerIn * speedN * 0.05 + (drifting ? (st.driftDir || 0) * 0.035 : 0), -0.08, 0.08);
    const pitchT = clamp(-accel * 0.035 + (st.braking ? 0.03 : 0), -0.06, 0.06);
    this.roll = dt > 0 ? damp(this.roll, rollT, 6, dt) : rollT;
    this.pitch = dt > 0 ? damp(this.pitch, pitchT, 5, dt) : pitchT;
    const idle = Math.abs(speed) < 2 ? 0.004 + (st.throttle || 0) * 0.009 : 0.0015 + speedN * 0.0015;
    const vib = Math.sin(t * 71) * idle + Math.sin(t * 43.3) * idle * 0.5;
    this.bodyBone.position.y = this.bodyBone.userData.rest.y + vib;
    this.bodyBone.rotation.set(this.pitch + Math.sin(t * 57) * idle * 0.4, 0, this.roll + Math.sin(t * 39) * idle * 0.6);
  }

  /** Steering-wheel grip points (in body-bone-parent = kart space, following the wheel rotation). */
  getHandTargets(outL, outR) {
    const s = this.layout.steer;
    _q.setFromAxisAngle(s.axis, this.wheelAngle);
    for (const [out, side] of [
      [outL, 1],
      [outR, -1],
    ]) {
      _v.copy(s.side).multiplyScalar(side * s.radius * 0.87).addScaledVector(s.up, s.radius * 0.5).applyQuaternion(_q);
      out.copy(s.center).add(_v);
    }
  }

  setTint(color, amount) {
    const u = this.material.userData.u;
    if (color) u.uTint.value.copy(color);
    u.uTintAmt.value = amount;
  }

  dispose() {
    this.material.dispose();
    this.skeleton.dispose();
    this.group.removeFromParent();
  }
}

export function createKartModel(character, opts = {}) {
  return new KartModel(character, opts);
}

export function disposeKartCaches() {
  for (const a of _kartCache.values()) {
    a.geometry.dispose();
    a.outlineGeometry?.dispose();
  }
  _kartCache.clear();
  for (const t of _atlasCache.values()) t.dispose();
  _atlasCache.clear();
}

export { STYLES as KART_STYLES, mixHex };
