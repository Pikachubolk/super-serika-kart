// Procedural low-poly prop library shared by all tracks (owner: world agent).
//
// API (ARCHITECTURE.md §5.3):
//   createProp(kind, { scale=1, color?, color2?, seed=0, variant?, night?, text?, width? }) -> THREE.Group
//       origin at ground level, +Y up, faces +Z. Parts sharing a material are merged, so one prop is only a
//       handful of meshes. For MANY copies use the instancing helpers (ctx.instanced / createInstancedProps).
//   PROP_KINDS: string[]              every kind below
//   PROP_META[kind]: { r, h, facing?, float?, wet?, big? }
//       r = footprint radius at scale 1 (for isClear / spacing), h = approximate height,
//       facing = the prop has a front that should face the road, float = [minY, maxY] default height above
//       the road for floating kinds (cloud, balloon), wet = fine standing in lava/water.
//   getToonMaterial(color, opts) -> shared cached material (MeshToonMaterial by default)
//   getMaterial(color, opts)     -> shared cached material (MeshLambertMaterial by default; opts.toon for toon)
//       opts: { emissive, emissiveIntensity, opacity, transparent, side, toon, lambert, standard, basic,
//               map, emissiveMap, alphaTest, additive, depthWrite, fog, roughness, metalness, vertexColors }
//   getPropParts(kind, opts) -> [{ geometry, material, castShadow }]   flattened (cached) — used for batching
//
// Extra options: `night: true` adds glow halos / light pools to lamps & lights; `variant` picks a model
// variant (see each kind); `text` sets the text of billboard / neonSign / sign / banner; `width` sets the span
// of torii / arch (road-spanning gates). Unknown kinds fall back to a generic prop (warning logged once).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32, hashString } from '../core/utils.js';
import {
  makeCanvas,
  canvasTexture,
  sharedTexture,
  chunkyText,
  paintWithFonts,
  shade,
  mixHex,
  rgba,
  glowTexture,
  addNoise,
  roundRect,
  FONT_DISPLAY,
  FONT_UI,
} from './textures.js';

export const PROP_KINDS = [
  'palm', 'cactus', 'rock', 'boulder', 'dune', 'pine', 'tree', 'bush', 'sakuraTree', 'flowerBed', 'hedge',
  'lamp', 'streetLight', 'building', 'tower', 'ruin', 'fence', 'torii', 'lantern', 'stoneLantern', 'snowman',
  'crystal', 'cloud', 'sign', 'billboard', 'tire', 'cone', 'barrel', 'crate', 'banner', 'flag', 'grandstand',
  'balloon', 'pillar', 'arch', 'fountain', 'bench', 'vendingMachine', 'neonSign', 'hologram', 'pagoda',
  'iceSpike', 'lavaRock', 'skull', 'gear', 'desk', 'book',
];

export const PROP_META = {
  palm: { r: 1.2, h: 8.5 },
  cactus: { r: 1.0, h: 3.6 },
  rock: { r: 1.2, h: 1.2, wet: true },
  boulder: { r: 2.8, h: 3.2, wet: true },
  dune: { r: 11, h: 4.5, big: true },
  pine: { r: 2.4, h: 9 },
  tree: { r: 2.4, h: 6.5 },
  bush: { r: 1.2, h: 1.3 },
  sakuraTree: { r: 3, h: 6.5 },
  flowerBed: { r: 1.8, h: 0.6 },
  hedge: { r: 1.7, h: 1.4 },
  lamp: { r: 0.4, h: 4.2, facing: true },
  streetLight: { r: 0.5, h: 8, facing: true },
  building: { r: 7, h: 24, facing: true, big: true },
  tower: { r: 5, h: 42, big: true },
  ruin: { r: 3.5, h: 5, wet: true },
  fence: { r: 2.1, h: 1.3, facing: true },
  torii: { r: 4.2, h: 7.2, facing: true },
  lantern: { r: 0.6, h: 2.6, facing: true },
  stoneLantern: { r: 0.7, h: 2.2, facing: true },
  snowman: { r: 0.9, h: 2.4, facing: true },
  crystal: { r: 1.3, h: 3.4, wet: true },
  cloud: { r: 6, h: 4, float: [-10, 18] },
  sign: { r: 1.3, h: 2.6, facing: true },
  billboard: { r: 5.2, h: 8.5, facing: true },
  tire: { r: 0.7, h: 1.3 },
  cone: { r: 0.35, h: 0.8 },
  barrel: { r: 0.6, h: 1.3 },
  crate: { r: 0.8, h: 1.3 },
  banner: { r: 0.6, h: 4.3, facing: true },
  flag: { r: 0.5, h: 6.3, facing: true },
  grandstand: { r: 10.5, h: 7.5, facing: true, big: true },
  balloon: { r: 3.6, h: 11, float: [14, 42] },
  pillar: { r: 0.8, h: 6.2, wet: true },
  arch: { r: 5.8, h: 9, facing: true },
  fountain: { r: 2.8, h: 2.8 },
  bench: { r: 1.1, h: 1.0, facing: true },
  vendingMachine: { r: 0.7, h: 2.1, facing: true },
  neonSign: { r: 1.6, h: 4.8, facing: true },
  hologram: { r: 1.6, h: 3.8, facing: true },
  pagoda: { r: 5, h: 17, big: true },
  iceSpike: { r: 1.2, h: 5, wet: true },
  lavaRock: { r: 1.6, h: 2, wet: true },
  skull: { r: 1.3, h: 2.2, facing: true, wet: true },
  gear: { r: 2.1, h: 4.3 },
  desk: { r: 1.0, h: 1.3, facing: true },
  book: { r: 1.3, h: 1.1 },
  islet: { r: 1, h: 0.4 },
};

// ---------------------------------------------------------------------------------------------------------
// Materials (shared cache)
// ---------------------------------------------------------------------------------------------------------
let _gradient = null;
export function toonGradient() {
  if (!_gradient) {
    const data = new Uint8Array([84, 150, 214, 255]);
    _gradient = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
    _gradient.minFilter = THREE.NearestFilter;
    _gradient.magFilter = THREE.NearestFilter;
    _gradient.generateMipmaps = false;
    _gradient.needsUpdate = true;
  }
  return _gradient;
}

const matCache = new Map();

function matKey(color, o) {
  return [
    color,
    o.type,
    o.emissive || '',
    o.emissiveIntensity ?? '',
    o.opacity ?? 1,
    o.transparent ? 1 : 0,
    o.side ?? 0,
    o.map?.uuid || '',
    o.emissiveMap?.uuid || '',
    o.alphaTest ?? '',
    o.additive ? 1 : 0,
    o.depthWrite ?? '',
    o.fog ?? '',
    o.roughness ?? '',
    o.metalness ?? '',
    o.vertexColors ? 1 : 0,
    o.flatShading ? 1 : 0,
    o.toneMapped ?? '',
  ].join('|');
}

function makeMaterial(color, o) {
  const common = {};
  const opacity = o.opacity ?? 1;
  const transparent = o.transparent || opacity < 1 || !!o.additive;
  let m;
  if (o.type === 'basic') {
    m = new THREE.MeshBasicMaterial({ color });
  } else if (o.type === 'standard') {
    m = new THREE.MeshStandardMaterial({ color, roughness: Math.max(0.5, o.roughness ?? 0.8), metalness: o.metalness ?? 0 });
  } else if (o.type === 'lambert') {
    m = new THREE.MeshLambertMaterial({ color, flatShading: !!o.flatShading });
  } else {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
  }
  if (o.map) m.map = o.map;
  if (m.emissive !== undefined) {
    if (o.emissive) m.emissive = new THREE.Color(o.emissive);
    if (o.emissiveIntensity !== undefined) m.emissiveIntensity = o.emissiveIntensity;
    if (o.emissiveMap) {
      m.emissiveMap = o.emissiveMap;
      if (!o.emissive) m.emissive = new THREE.Color('#ffffff');
    }
  }
  m.transparent = transparent;
  m.opacity = opacity;
  if (o.side !== undefined) m.side = o.side;
  if (o.alphaTest !== undefined) m.alphaTest = o.alphaTest;
  if (o.additive) {
    m.blending = THREE.AdditiveBlending;
    m.depthWrite = false;
  }
  if (o.depthWrite !== undefined) m.depthWrite = o.depthWrite;
  if (o.fog !== undefined) m.fog = o.fog;
  if (o.vertexColors) m.vertexColors = true;
  if (o.toneMapped !== undefined) m.toneMapped = o.toneMapped;
  Object.assign(m, common);
  m.userData.shared = true;
  return m;
}

function getMat(color, opts, defType) {
  const o = { ...opts };
  o.type = o.basic ? 'basic' : o.standard ? 'standard' : o.lambert ? 'lambert' : o.toon ? 'toon' : defType;
  if (o.additive && o.type !== 'basic') o.type = 'basic';
  const key = matKey(color, o);
  let m = matCache.get(key);
  if (!m) {
    m = makeMaterial(color, o);
    matCache.set(key, m);
  }
  return m;
}

/** Shared toon material (default MeshToonMaterial). */
export function getToonMaterial(color, opts = {}) {
  return getMat(color, opts, 'toon');
}
/** Shared material (default MeshLambertMaterial; `toon: true` for toon). Used by the scenery ctx.mat(). */
export function getMaterial(color, opts = {}) {
  return getMat(color, opts, 'lambert');
}

// ---------------------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------------------
const box = (w, h, d, ws = 1, hs = 1, ds = 1) => new THREE.BoxGeometry(w, h, d, ws, hs, ds);
const rbox = (w, h, d, r = 0.1, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
const cyl = (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const sph = (r, ws = 12, hs = 9) => new THREE.SphereGeometry(r, ws, hs);
const cone = (r, h, seg = 10) => new THREE.ConeGeometry(r, h, seg);
const ico = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
const torus = (R, r, rs = 8, ts = 18, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc);
const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
const plane = (w, h, ws = 1, hs = 1) => new THREE.PlaneGeometry(w, h, ws, hs);

/** Displace vertices by a smooth pseudo-random amount keyed on position (keeps shared vertices welded). */
function jitter(geo, amt, rng, { y = 1, keepBottom = false } = {}) {
  const pos = geo.attributes.position;
  const map = new Map();
  if (keepBottom) geo.computeBoundingBox();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const yy = pos.getY(i);
    const z = pos.getZ(i);
    const k = `${x.toFixed(3)},${yy.toFixed(3)},${z.toFixed(3)}`;
    let off = map.get(k);
    if (!off) {
      off = [(rng() - 0.5) * 2 * amt, (rng() - 0.5) * 2 * amt * y, (rng() - 0.5) * 2 * amt];
      map.set(k, off);
    }
    if (keepBottom && yy <= geo.boundingBox.min.y + 1e-3) continue;
    pos.setXYZ(i, x + off[0], yy + off[1], z + off[2]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Faceted (flat-shaded) version of a geometry. */
function facet(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

/** Bend a geometry: y += k * (x / halfSpan)^2 (upturned beams / roofs). */
function bendUp(geo, halfSpan, k) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / halfSpan;
    pos.setY(i, pos.getY(i) + k * x * x * x * x);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** A drooping leaf blade (palm frond) along +Z. */
function leafBlade(len, width, droop, segs = 7) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = len * t;
    const y = -droop * t * t;
    const w = width * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.35);
    pos.push(-w, y - w * 0.25, z, 0, y, z, w, y - w * 0.25, z);
    uv.push(0, t, 0.5, t, 1, t);
    if (i < segs) {
      const a = i * 3;
      const b = (i + 1) * 3;
      idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Crossed quads (3 planes) with the glow sprite, for halos visible from every direction. */
function glowCross(size) {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const p = plane(size, size);
    p.rotateY((k * Math.PI) / 3);
    parts.push(p);
  }
  return mergeGeometries(parts);
}

function glowMat(color, intensity = 1) {
  return getMat(color, { basic: true, additive: true, map: glowTexture(), opacity: intensity, fog: true, side: THREE.DoubleSide, toneMapped: false }, 'basic');
}

// ---------------------------------------------------------------------------------------------------------
// Prop builder
// ---------------------------------------------------------------------------------------------------------
class PB {
  constructor(o) {
    this.root = new THREE.Group();
    this.o = o;
  }
  add(geo, mat, { p, r, s, flat = false, shadow = true, parent } = {}) {
    if (flat) geo = facet(geo);
    const m = new THREE.Mesh(geo, mat);
    if (p) m.position.set(p[0], p[1], p[2]);
    if (r) m.rotation.set(r[0], r[1], r[2]);
    if (s !== undefined) typeof s === 'number' ? m.scale.setScalar(s) : m.scale.set(s[0], s[1], s[2]);
    m.castShadow = shadow;
    m.receiveShadow = true;
    (parent || this.root).add(m);
    return m;
  }
  group({ p, r, s } = {}) {
    const g = new THREE.Group();
    if (p) g.position.set(p[0], p[1], p[2]);
    if (r) g.rotation.set(r[0], r[1], r[2]);
    if (s !== undefined) typeof s === 'number' ? g.scale.setScalar(s) : g.scale.set(s[0], s[1], s[2]);
    this.root.add(g);
    return g;
  }
  glow(color, size, p, intensity = 0.9) {
    return this.add(glowCross(size), glowMat(color, intensity), { p, shadow: false });
  }
}

const T = (c, o) => getToonMaterial(c, o);
const L = (c, o) => getMaterial(c, o);

// ---------------------------------------------------------------------------------------------------------
// Canvas decals for props (shared across tracks)
// ---------------------------------------------------------------------------------------------------------
const BILLBOARD_ADS = [
  { bg: ['#ff8fc4', '#ff5aa0'], title: 'MOMOTALK', sub: 'Chat with your students!', icon: 'bubble', ink: '#ffffff' },
  { bg: ['#ffe066', '#ffb020'], title: 'SHIBASEKI RAMEN', sub: 'Extra-large bowls - 580 Credits', icon: 'ramen', ink: '#7a2a00' },
  { bg: ['#6fd0ff', '#1f7ae0'], title: 'KIVOTOS CREDIT BANK', sub: 'Low interest! (Honest!)', icon: 'coin', ink: '#ffffff' },
  { bg: ['#ffffff', '#dff3ff'], title: 'SAVE ABYDOS!', sub: 'Help pay off the loan - every Credit counts', icon: 'halo', ink: '#1d2a4d' },
  { bg: ['#1b2a4a', '#0b1530'], title: 'MILLENNIUM', sub: 'Science School - Game Dev Dept.', icon: 'gear', ink: '#39d0ff' },
  { bg: ['#b18cff', '#6a3cff'], title: 'PYROXENE SALE', sub: 'x1200 bonus this week only', icon: 'gem', ink: '#ffffff' },
  { bg: ['#9fe6ff', '#4fb8ff'], title: 'DRIVE SAFE, SENSEI!', sub: '- Arona, Shittim Chest OS', icon: 'halo', ink: '#0b3a7a' },
  { bg: ['#ff5a6e', '#d8243a'], title: 'SERIKA FAN CLUB', sub: "It's NOT like I asked for this!", icon: 'cat', ink: '#ffffff' },
];

function drawIcon(g, kind, x, y, r, ink) {
  g.save();
  g.translate(x, y);
  g.lineWidth = r * 0.14;
  g.strokeStyle = ink;
  g.fillStyle = ink;
  if (kind === 'bubble') {
    roundRect(g, -r, -r * 0.75, r * 2, r * 1.4, r * 0.4);
    g.fill();
    g.beginPath();
    g.moveTo(-r * 0.4, r * 0.6);
    g.lineTo(-r * 0.7, r * 1.05);
    g.lineTo(0, r * 0.62);
    g.fill();
    g.fillStyle = '#ff5aa0';
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.arc(k * r * 0.5, -r * 0.05, r * 0.16, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'ramen') {
    g.beginPath();
    g.arc(0, -r * 0.1, r, 0, Math.PI);
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillRect(-r * 1.05, -r * 0.2, r * 2.1, r * 0.16);
    g.strokeStyle = ink;
    g.beginPath();
    g.moveTo(r * 0.2, -r * 0.3);
    g.lineTo(r * 0.9, -r * 1.2);
    g.moveTo(r * 0.45, -r * 0.3);
    g.lineTo(r * 1.1, -r * 1.1);
    g.stroke();
  } else if (kind === 'coin') {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fillStyle = '#ffd23f';
    g.fill();
    g.stroke();
    g.fillStyle = '#b8860b';
    g.font = `${r * 1.2}px ${FONT_DISPLAY}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('C', 0, r * 0.05);
  } else if (kind === 'halo') {
    g.strokeStyle = '#ff3355';
    g.lineWidth = r * 0.16;
    g.beginPath();
    g.arc(0, 0, r * 0.85, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.35, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
      g.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15);
      g.stroke();
    }
  } else if (kind === 'gear') {
    g.beginPath();
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const rr = k % 2 ? r * 0.75 : r;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(0, 0, r * 0.35, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  } else if (kind === 'gem') {
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r * 0.8, -r * 0.2);
    g.lineTo(0, r);
    g.lineTo(-r * 0.8, -r * 0.2);
    g.closePath();
    g.fillStyle = '#7ee8ff';
    g.fill();
    g.stroke();
  } else if (kind === 'cat') {
    g.beginPath();
    g.arc(0, r * 0.1, r * 0.8, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(-r * 0.75, -r * 0.1);
    g.lineTo(-r * 0.6, -r * 1.05);
    g.lineTo(-r * 0.1, -r * 0.6);
    g.moveTo(r * 0.75, -r * 0.1);
    g.lineTo(r * 0.6, -r * 1.05);
    g.lineTo(r * 0.1, -r * 0.6);
    g.fill();
    g.fillStyle = '#ff5a6e';
    g.beginPath();
    g.arc(-r * 0.3, r * 0.05, r * 0.12, 0, Math.PI * 2);
    g.arc(r * 0.3, r * 0.05, r * 0.12, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function billboardTexture(idx, text) {
  const ad = BILLBOARD_ADS[idx % BILLBOARD_ADS.length];
  return sharedTexture(`billboard:${idx}:${text || ''}`, () => {
    const W = 1024;
    const H = 512;
    const { c, g } = makeCanvas(W, H);
    const tex = canvasTexture(c, { repeat: false, anisotropy: 8 });
    paintWithFonts(tex, () => {
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, ad.bg[0]);
      bg.addColorStop(1, ad.bg[1]);
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let x = -H; x < W; x += 120) {
        g.beginPath();
        g.moveTo(x, H);
        g.lineTo(x + H * 0.6, 0);
        g.lineTo(x + H * 0.6 + 50, 0);
        g.lineTo(x + 50, H);
        g.fill();
      }
      drawIcon(g, ad.icon, W * 0.17, H * 0.5, H * 0.22, ad.ink);
      const title = text || ad.title;
      chunkyText(g, title, W * 0.6, H * 0.4, 110, { fill: ad.ink, stroke: ad.ink === '#ffffff' ? '#16213a' : '#ffffff', strokeW: 0.09, maxWidth: W * 0.7 });
      if (!text) {
        g.font = `800 44px ${FONT_UI}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = ad.ink;
        g.fillText(ad.sub, W * 0.6, H * 0.68, W * 0.7);
      }
    });
    return tex;
  });
}

const NEON_WORDS = ['RAMEN', 'ARCADE', '24H', 'KARAOKE', 'CAFE', 'GAME', 'MOMO', 'HOTEL', 'SHOP', 'BA'];
const NEON_COLORS = ['#ff4fd8', '#39d0ff', '#ffd23f', '#7cff6b', '#ff5a6e', '#b18cff'];

function neonTexture(text, color) {
  return sharedTexture(`neon:${text}:${color}`, () => {
    const W = 512;
    const H = 256;
    const { c, g } = makeCanvas(W, H);
    const tex = canvasTexture(c, { repeat: false, anisotropy: 8 });
    paintWithFonts(tex, () => {
      g.fillStyle = '#0c0c16';
      g.fillRect(0, 0, W, H);
      g.save();
      g.font = `${Math.min(170, (W * 1.5) / Math.max(3, text.length))}px ${FONT_DISPLAY}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = color;
      g.shadowBlur = 28;
      g.lineWidth = 12;
      g.strokeStyle = color;
      g.strokeText(text, W / 2, H / 2 + 6);
      g.shadowBlur = 10;
      g.lineWidth = 4;
      g.strokeStyle = mixHex(color, '#ffffff', 0.7);
      g.strokeText(text, W / 2, H / 2 + 6);
      g.restore();
      // border tube
      g.save();
      g.strokeStyle = color;
      g.shadowColor = color;
      g.shadowBlur = 16;
      g.lineWidth = 7;
      roundRect(g, 14, 14, W - 28, H - 28, 26);
      g.stroke();
      g.restore();
    });
    return tex;
  });
}

function windowTexture(style) {
  return sharedTexture(`windows:${style}`, () => {
    const S = 256;
    const cells = 4;
    const cs = S / cells;
    const map = makeCanvas(S, S);
    const em = makeCanvas(S, S);
    const rng = mulberry32(hashString(`win${style}`));
    const g = map.g;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    em.g.fillStyle = '#000000';
    em.g.fillRect(0, 0, S, S);
    for (let i = 0; i < cells; i++)
      for (let j = 0; j < cells; j++) {
        const x = i * cs;
        const y = j * cs;
        const m = cs * (style === 1 ? 0.1 : 0.18);
        const wh = style === 1 ? cs - m * 2 : cs * 0.55;
        // glass
        const gr = g.createLinearGradient(x, y, x + cs, y + cs);
        gr.addColorStop(0, '#6f8fb8');
        gr.addColorStop(0.5, '#2f4a73');
        gr.addColorStop(1, '#1d2f4d');
        g.fillStyle = gr;
        g.fillRect(x + m, y + m, cs - m * 2, wh);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.beginPath();
        g.moveTo(x + m, y + m + wh * 0.6);
        g.lineTo(x + m + (cs - m * 2) * 0.5, y + m);
        g.lineTo(x + m + (cs - m * 2) * 0.7, y + m);
        g.lineTo(x + m, y + m + wh);
        g.fill();
        // frame + sill
        g.strokeStyle = 'rgba(40,40,50,0.6)';
        g.lineWidth = 2;
        g.strokeRect(x + m, y + m, cs - m * 2, wh);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x + m - 2, y + m + wh, cs - m * 2 + 4, 4);
        if (rng() < 0.45) {
          const warm = rng() < 0.7;
          em.g.fillStyle = warm ? `rgb(255,${200 + rng() * 40},${120 + rng() * 60})` : 'rgb(170,220,255)';
          em.g.fillRect(x + m, y + m, cs - m * 2, wh);
        }
      }
    addNoise(g, S, S, 5, rng);
    return { map: canvasTexture(map.c, { anisotropy: 8 }), emissiveMap: canvasTexture(em.c, { anisotropy: 8 }) };
  });
}

function crateTexture(variant) {
  return sharedTexture(`crate:${variant}`, () => {
    const S = 256;
    const { c, g } = makeCanvas(S, S);
    const rng = mulberry32(77 + variant);
    const base = variant === 1 ? '#7a8a9a' : '#c08a4a';
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    for (let k = 0; k < 5; k++) {
      g.fillStyle = shade(base, (rng() - 0.5) * 0.2);
      g.fillRect(0, (k * S) / 5 + 2, S, S / 5 - 4);
      g.strokeStyle = rgba(shade(base, -0.4), 0.3);
      for (let q = 0; q < 5; q++) {
        g.beginPath();
        const yy = (k * S) / 5 + rng() * (S / 5);
        g.moveTo(0, yy);
        g.bezierCurveTo(S * 0.3, yy + 4, S * 0.6, yy - 4, S, yy + 2);
        g.stroke();
      }
    }
    const frame = shade(base, -0.25);
    g.fillStyle = frame;
    g.fillRect(0, 0, S, 26);
    g.fillRect(0, S - 26, S, 26);
    g.fillRect(0, 0, 26, S);
    g.fillRect(S - 26, 0, 26, S);
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(Math.PI / 4);
    g.fillRect(-S * 0.7, -12, S * 1.4, 24);
    g.restore();
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (const [x, y] of [[13, 13], [S - 13, 13], [13, S - 13], [S - 13, S - 13]]) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
    if (variant !== 1) {
      g.save();
      g.globalAlpha = 0.55;
      chunkyText(g, 'SSK', S / 2, S / 2, 44, { fill: '#5a3510', strokeW: 0, shadow: false });
      g.restore();
    }
    addNoise(g, S, S, 8, rng);
    return canvasTexture(c, { anisotropy: 8 });
  });
}

function vendingTexture(color) {
  return sharedTexture(`vending:${color}`, () => {
    const W = 256;
    const H = 512;
    const map = makeCanvas(W, H);
    const em = makeCanvas(W, H);
    const g = map.g;
    const e = em.g;
    const tex = canvasTexture(map.c, { repeat: false, anisotropy: 8 });
    const etex = canvasTexture(em.c, { repeat: false, anisotropy: 8 });
    paintWithFonts(tex, () => {
      g.fillStyle = color;
      g.fillRect(0, 0, W, H);
      e.fillStyle = '#000';
      e.fillRect(0, 0, W, H);
      // header
      g.fillStyle = '#ffffff';
      roundRect(g, 14, 14, W - 28, 64, 12);
      g.fill();
      chunkyText(g, 'KIVOTOS', W / 2, 38, 30, { fill: color, strokeW: 0, shadow: false });
      g.font = `800 18px ${FONT_UI}`;
      g.textAlign = 'center';
      g.fillStyle = '#16213a';
      g.fillText('DRINKS', W / 2, 64);
      // display window with drinks
      g.fillStyle = '#dff3ff';
      g.fillRect(18, 92, W * 0.64, 250);
      e.fillStyle = '#b8e6ff';
      e.fillRect(18, 92, W * 0.64, 250);
      const cols = ['#ff5a6e', '#39d0ff', '#ffd23f', '#7cff6b', '#ff9a3c', '#b18cff', '#ffffff', '#2c7be5'];
      for (let r = 0; r < 4; r++) {
        for (let k = 0; k < 4; k++) {
          const x = 30 + k * 38;
          const y = 104 + r * 60;
          const col = cols[(r * 3 + k) % cols.length];
          g.fillStyle = col;
          roundRect(g, x, y + 8, 24, 40, 6);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.6)';
          g.fillRect(x + 4, y + 14, 5, 28);
          g.fillStyle = '#333';
          g.fillRect(x + 6, y + 2, 12, 7);
          g.fillStyle = '#ff3355';
          g.fillRect(x + 4, y + 52, 16, 5);
          e.fillStyle = '#ff6a7a';
          e.fillRect(x + 4, y + 52, 16, 5);
        }
      }
      // buttons / coin slot panel
      g.fillStyle = shade(color, -0.3);
      g.fillRect(W * 0.72, 92, W * 0.24, 250);
      g.fillStyle = '#16213a';
      g.fillRect(W * 0.76, 110, W * 0.16, 36);
      e.fillStyle = '#39ff9a';
      e.fillRect(W * 0.77, 116, W * 0.14, 24);
      g.fillStyle = '#39ff9a';
      g.fillRect(W * 0.77, 116, W * 0.14, 24);
      g.fillStyle = '#c0c6d0';
      g.fillRect(W * 0.8, 170, 18, 44);
      g.fillStyle = '#222';
      g.fillRect(W * 0.835, 176, 4, 32);
      // pickup bay
      g.fillStyle = '#1a1a22';
      roundRect(g, 30, H - 120, W - 60, 60, 10);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.fillRect(30, H - 120, W - 60, 8);
      // bottom stripe
      g.fillStyle = '#ffffff';
      g.fillRect(0, H - 40, W, 12);
      etex.needsUpdate = true;
    });
    return { map: tex, emissiveMap: etex };
  });
}

function hologramTexture(variant) {
  return sharedTexture(`holo:${variant}`, () => {
    const W = 512;
    const H = 320;
    const { c, g } = makeCanvas(W, H);
    const tex = canvasTexture(c, { repeat: false, anisotropy: 8 });
    const col = variant % 2 ? '#ff7ae0' : '#4fe3ff';
    paintWithFonts(tex, () => {
      g.clearRect(0, 0, W, H);
      g.fillStyle = rgba(col, 0.18);
      g.fillRect(0, 0, W, H);
      g.strokeStyle = col;
      g.lineWidth = 6;
      roundRect(g, 8, 8, W - 16, H - 16, 18);
      g.stroke();
      for (let y = 0; y < H; y += 6) {
        g.fillStyle = rgba(col, 0.12);
        g.fillRect(0, y, W, 2);
      }
      const titles = ['MILLENNIUM', 'SHITTIM OS', 'KIVOTOS NET', 'LAP DATA'];
      chunkyText(g, titles[variant % titles.length], W / 2, 54, 52, { fill: '#ffffff', stroke: col, strokeW: 0.08, shadow: false });
      // graph bars
      const rng = mulberry32(31 + variant);
      for (let k = 0; k < 9; k++) {
        const h = 40 + rng() * 120;
        g.fillStyle = rgba(col, 0.8);
        g.fillRect(40 + k * 30, H - 40 - h, 20, h);
      }
      // radar circle
      g.strokeStyle = col;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(W * 0.78, H * 0.6, 70, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(W * 0.78, H * 0.6, 40, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(W * 0.78, H * 0.6);
      g.lineTo(W * 0.78 + 60, H * 0.6 - 36);
      g.stroke();
    });
    return tex;
  });
}

function signTexture(variant, text) {
  return sharedTexture(`sign:${variant}:${text || ''}`, () => {
    const W = 512;
    const H = 256;
    const { c, g } = makeCanvas(W, H);
    const tex = canvasTexture(c, { repeat: false, anisotropy: 8 });
    paintWithFonts(tex, () => {
      if (variant === 'text') {
        g.fillStyle = '#1f7ae0';
        g.fillRect(0, 0, W, H);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 12;
        roundRect(g, 14, 14, W - 28, H - 28, 20);
        g.stroke();
        chunkyText(g, text || 'KIVOTOS', W / 2, H / 2, 90, { fill: '#ffffff', strokeW: 0, maxWidth: W - 80 });
        return;
      }
      g.fillStyle = '#ffd23f';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#16181f';
      g.fillRect(0, 0, W, 14);
      g.fillRect(0, H - 14, W, 14);
      if (variant === 'caution') {
        chunkyText(g, text || '!', W / 2, H / 2, 170, { fill: '#16181f', strokeW: 0, shadow: false });
        return;
      }
      const dir = variant === 'left' ? -1 : 1;
      for (let k = 0; k < 3; k++) {
        const x = W / 2 + (k - 1) * 150 * dir;
        g.beginPath();
        g.moveTo(x - 40 * dir, 40);
        g.lineTo(x + 40 * dir, H / 2);
        g.lineTo(x - 40 * dir, H - 40);
        g.lineTo(x - 90 * dir, H - 40);
        g.lineTo(x - 10 * dir, H / 2);
        g.lineTo(x - 90 * dir, 40);
        g.closePath();
        g.fill();
      }
    });
    return tex;
  });
}

function stripeTexture(a, b, n = 8, vertical = true) {
  return sharedTexture(`stripes:${a}:${b}:${n}:${vertical}`, () => {
    const S = 256;
    const { c, g } = makeCanvas(S, S);
    for (let k = 0; k < n; k++) {
      g.fillStyle = k % 2 ? b : a;
      if (vertical) g.fillRect((k * S) / n, 0, S / n + 1, S);
      else g.fillRect(0, (k * S) / n, S, S / n + 1);
    }
    return canvasTexture(c, { anisotropy: 8 });
  });
}

function crowdTexture() {
  return sharedTexture('crowd', () => {
    const W = 512;
    const H = 64;
    const { c, g } = makeCanvas(W, H);
    const rng = mulberry32(4242);
    g.fillStyle = '#2b3350';
    g.fillRect(0, 0, W, H);
    const shirts = ['#ff5a6e', '#39d0ff', '#ffd23f', '#7cff6b', '#ffffff', '#b18cff', '#ff9a3c', '#1f7ae0', '#ff7ab8'];
    const hairs = ['#1c2235', '#f5d06a', '#ff9ab8', '#ffffff', '#6a3a22', '#c43a3a', '#3a2a5a'];
    for (let x = 6; x < W; x += 14 + rng() * 4) {
      const y = 36 + rng() * 6;
      g.fillStyle = shirts[(rng() * shirts.length) | 0];
      roundRect(g, x - 7, y, 14, 30, 6);
      g.fill();
      g.fillStyle = '#ffe3d3';
      g.beginPath();
      g.arc(x, y - 7, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = hairs[(rng() * hairs.length) | 0];
      g.beginPath();
      g.arc(x, y - 9, 7.5, Math.PI, 0);
      g.fill();
      // halo!
      if (rng() < 0.5) {
        g.strokeStyle = shirts[(rng() * shirts.length) | 0];
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(x, y - 20, 6, 2.2, 0, 0, Math.PI * 2);
        g.stroke();
      }
      if (rng() < 0.25) {
        g.strokeStyle = '#ffe3d3';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x + 5, y + 4);
        g.lineTo(x + 10, y - 14);
        g.stroke();
      }
    }
    return canvasTexture(c, { anisotropy: 8 });
  });
}

function lavaRockTexture() {
  return sharedTexture('lavarock', () => {
    const S = 256;
    const map = makeCanvas(S, S);
    const em = makeCanvas(S, S);
    const rng = mulberry32(666);
    map.g.fillStyle = '#ffffff';
    map.g.fillRect(0, 0, S, S);
    em.g.fillStyle = '#000';
    em.g.fillRect(0, 0, S, S);
    for (let i = 0; i < 16; i++) {
      let x = rng() * S;
      let y = rng() * S;
      let a = rng() * Math.PI * 2;
      for (const ctx of [map.g, em.g]) {
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
      const pts = [];
      for (let s = 0; s < 10; s++) {
        a += (rng() - 0.5) * 1.2;
        x += Math.cos(a) * 12;
        y += Math.sin(a) * 12;
        pts.push([x, y]);
      }
      for (const [ctx, col, w] of [[map.g, '#ffb03a', 4], [em.g, '#ff6a1f', 7], [em.g, '#ffd27a', 2.5]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts) ctx.lineTo(p[0], p[1]);
        ctx.stroke();
      }
    }
    addNoise(map.g, S, S, 30, rng);
    return { map: canvasTexture(map.c, { anisotropy: 8 }), emissiveMap: canvasTexture(em.c, { anisotropy: 8 }) };
  });
}

function bookTexture(color) {
  return sharedTexture(`book:${color}`, () => {
    const W = 256;
    const H = 128;
    const { c, g } = makeCanvas(W, H);
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
    g.fillStyle = shade(color, 0.35);
    g.fillRect(0, 12, W, 8);
    g.fillRect(0, H - 20, W, 8);
    g.fillStyle = '#ffd23f';
    g.fillRect(W * 0.3, H * 0.4, W * 0.4, H * 0.2);
    return canvasTexture(c, { anisotropy: 8 });
  });
}

function clockTexture() {
  return sharedTexture('clock', () => {
    const S = 256;
    const { c, g } = makeCanvas(S, S);
    g.fillStyle = '#fff8e8';
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.48, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3a2a1a';
    g.lineWidth = 10;
    g.stroke();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.lineWidth = k % 3 ? 4 : 8;
      g.beginPath();
      g.moveTo(S / 2 + Math.cos(a) * S * 0.36, S / 2 + Math.sin(a) * S * 0.36);
      g.lineTo(S / 2 + Math.cos(a) * S * 0.43, S / 2 + Math.sin(a) * S * 0.43);
      g.stroke();
    }
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2, S * 0.2);
    g.moveTo(S / 2, S / 2);
    g.lineTo(S * 0.7, S * 0.56);
    g.stroke();
    return canvasTexture(c, { repeat: false, anisotropy: 8 });
  });
}

// ---------------------------------------------------------------------------------------------------------
// Prop models. Each builder: (B: PB, o: options, rng) -> void. Dimensions in metres, facing +Z.
// ---------------------------------------------------------------------------------------------------------
const BUILDERS = {
  palm(B, o, rng) {
    const trunkA = o.color2 || '#9a7446';
    const trunkB = shade(trunkA, -0.15);
    const leafA = o.color || '#3fb04e';
    const leafB = shade(leafA, -0.18);
    const segs = 7;
    const H = 7 + rng() * 1.5;
    const bend = 1.2 + rng() * 1.3;
    let top = [0, 0, 0];
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const x0 = bend * t0 * t0;
      const x1 = bend * t1 * t1;
      const y0 = H * t0;
      const y1 = H * t1;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const r = 0.34 - t0 * 0.12;
      const g = cyl(r * 0.92, r * 1.08, len * 1.04, 8);
      const ang = Math.atan2(x1 - x0, y1 - y0);
      B.add(g, T(i % 2 ? trunkA : trunkB), { p: [(x0 + x1) / 2, (y0 + y1) / 2, 0], r: [0, 0, -ang], flat: true });
      top = [x1, y1, 0];
    }
    const n = 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng() * 0.3;
      const len = 3.4 + rng() * 0.8;
      const leaf = leafBlade(len, 0.55, 1.6 + rng() * 0.8);
      B.add(leaf, T(k % 2 ? leafA : leafB, { side: THREE.DoubleSide }), { p: [top[0], top[1] + 0.1, 0], r: [-0.25, a, 0] });
    }
    B.add(sph(0.45, 8, 6), T(leafB), { p: [top[0], top[1] + 0.15, 0], s: [1, 0.6, 1] });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      B.add(sph(0.2, 8, 6), T('#6b4a2a'), { p: [top[0] + Math.cos(a) * 0.3, top[1] - 0.25, Math.sin(a) * 0.3], shadow: false });
    }
  },

  cactus(B, o, rng) {
    const col = o.color || '#3f9a4a';
    const m = T(col);
    const h = 2.8 + rng() * 0.8;
    B.add(new THREE.CapsuleGeometry(0.42, h - 0.84, 3, 8), m, { p: [0, h / 2, 0], flat: true });
    const arms = rng() < 0.3 ? 1 : 2;
    for (let k = 0; k < arms; k++) {
      const s = k === 0 ? 1 : -1;
      const y = h * (0.35 + rng() * 0.2);
      const up = 0.8 + rng() * 0.7;
      B.add(new THREE.CapsuleGeometry(0.26, 0.5, 3, 8), m, { p: [s * 0.55, y, 0], r: [0, 0, Math.PI / 2], flat: true });
      B.add(new THREE.CapsuleGeometry(0.26, up, 3, 8), m, { p: [s * 0.85, y + up / 2, 0], flat: true });
    }
    if (rng() < 0.6) {
      const fc = o.color2 || '#ff6fa8';
      for (let k = 0; k < 3; k++) B.add(sph(0.12, 6, 5), T(fc), { p: [(k - 1) * 0.16, h + 0.02, (rng() - 0.5) * 0.2], shadow: false });
    }
  },

  rock(B, o, rng) {
    const col = o.color || '#8e8a86';
    const g = jitter(ico(1, 1), 0.22, rng);
    B.add(g, T(col), { p: [0, 0.55, 0], s: [1.2, 0.75, 1.0], flat: true });
    if (rng() < 0.5) B.add(jitter(ico(0.45, 0), 0.1, rng), T(shade(col, -0.1)), { p: [0.95, 0.25, 0.4], flat: true });
  },

  boulder(B, o, rng) {
    const col = o.color || '#8a847c';
    const c2 = o.color2 || shade(col, -0.12);
    B.add(jitter(ico(2, 1), 0.4, rng), T(col), { p: [0, 1.5, 0], s: [1.1, 0.85, 1], flat: true });
    B.add(jitter(ico(1.2, 1), 0.25, rng), T(c2), { p: [1.9, 0.8, 0.6], s: [1, 0.8, 1], flat: true });
    B.add(jitter(ico(0.8, 0), 0.2, rng), T(col), { p: [-1.6, 0.5, 1.0], flat: true });
  },

  dune(B, o, rng) {
    const col = o.color || '#e8c27d';
    const g = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y = pos.getY(i);
      // asymmetric crest: steeper on +x
      y *= 1 + 0.35 * x;
      y += Math.sin(z * 3 + x * 2) * 0.04 * y;
      pos.setY(i, Math.max(0, y));
    }
    g.computeVertexNormals();
    B.add(g, T(col), { p: [0, -0.2, 0], s: [11 + rng() * 4, 4 + rng() * 1.5, 7 + rng() * 3], shadow: false });
  },

  pine(B, o, rng) {
    const col = o.color || '#2f7d4a';
    const snowy = o.variant === 'snowy';
    B.add(cyl(0.22, 0.32, 2.2, 7), T('#6b4a2a'), { p: [0, 1.1, 0], flat: true });
    const tiers = 4;
    for (let k = 0; k < tiers; k++) {
      const r = 2.5 - k * 0.5;
      const h = 2.6 - k * 0.25;
      const y = 1.7 + k * 1.55 + h / 2;
      const g = jitter(cone(r, h, 9), 0.08, rng);
      B.add(g, T(k % 2 ? col : shade(col, 0.1)), { p: [0, y, 0], r: [0, rng() * 3, 0], flat: true });
      if (snowy) B.add(cone(r * 0.55, h * 0.45, 9), T('#f4f8ff'), { p: [0, y + h * 0.28, 0], flat: true, shadow: false });
    }
  },

  tree(B, o, rng) {
    const leaf = o.color || '#4fae3f';
    const leaf2 = o.color2 || shade(leaf, -0.15);
    const trunk = T('#8b5a2b');
    const th = 2.4 + rng() * 0.6;
    B.add(cyl(0.22, 0.36, th, 8), trunk, { p: [0, th / 2, 0], flat: true });
    B.add(cyl(0.08, 0.13, 1.2, 6), trunk, { p: [0.4, th * 0.8, 0], r: [0, 0, -0.8], flat: true });
    const n = 4 + ((rng() * 2) | 0);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng();
      const r = 1.2 + rng() * 0.6;
      const dist = k === 0 ? 0 : 0.9 + rng() * 0.4;
      const y = th + 1.1 + (k === 0 ? 0.6 : rng() * 1.1);
      B.add(jitter(ico(r, 1), 0.12, rng), T(k % 2 ? leaf : leaf2), { p: [Math.cos(a) * dist, y, Math.sin(a) * dist], flat: true });
    }
  },

  bush(B, o, rng) {
    const col = o.color || '#46a044';
    const n = 3 + ((rng() * 2) | 0);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng();
      const r = 0.55 + rng() * 0.35;
      B.add(jitter(ico(r, 1), 0.07, rng), T(k % 2 ? col : shade(col, 0.12)), { p: [Math.cos(a) * 0.45, r * 0.8, Math.sin(a) * 0.45], flat: true });
    }
    if (o.variant === 'berries' || o.color2) {
      const bc = o.color2 || '#ff4d6d';
      for (let k = 0; k < 6; k++) {
        const a = rng() * Math.PI * 2;
        B.add(sph(0.1, 6, 4), T(bc), { p: [Math.cos(a) * 0.8, 0.6 + rng() * 0.6, Math.sin(a) * 0.8], shadow: false });
      }
    }
  },

  sakuraTree(B, o, rng) {
    const pinkA = o.color || '#ffb3d1';
    const pinkB = o.color2 || '#ff8fbf';
    const trunk = T('#5b3a2e');
    B.add(cyl(0.28, 0.45, 2.6, 8), trunk, { p: [0, 1.3, 0], flat: true });
    B.add(cyl(0.16, 0.26, 2.2, 7), trunk, { p: [0.6, 3.0, 0.1], r: [0.1, 0, -0.55], flat: true });
    B.add(cyl(0.14, 0.24, 2.0, 7), trunk, { p: [-0.55, 3.0, -0.2], r: [-0.15, 0, 0.6], flat: true });
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng();
      const dist = k === 0 ? 0 : 1.3 + rng() * 0.8;
      const r = 1.0 + rng() * 0.6;
      const y = 4.2 + (k === 0 ? 0.8 : rng() * 1.2);
      const col = [pinkA, pinkB, '#ffe0ee'][k % 3];
      B.add(jitter(ico(r, 1), 0.12, rng), T(col), { p: [Math.cos(a) * dist, y, Math.sin(a) * dist], s: [1, 0.8, 1], flat: true });
    }
  },

  flowerBed(B, o, rng) {
    const w = 3.2;
    const d = 1.5;
    B.add(box(w, 0.3, d), T('#6b4a2a'), { p: [0, 0.15, 0], shadow: false });
    const stone = T(o.color2 || '#d8d2c6');
    B.add(box(w + 0.2, 0.36, 0.14), stone, { p: [0, 0.18, d / 2 + 0.05], shadow: false });
    B.add(box(w + 0.2, 0.36, 0.14), stone, { p: [0, 0.18, -d / 2 - 0.05], shadow: false });
    B.add(box(0.14, 0.36, d), stone, { p: [w / 2 + 0.05, 0.18, 0], shadow: false });
    B.add(box(0.14, 0.36, d), stone, { p: [-w / 2 - 0.05, 0.18, 0], shadow: false });
    const leaf = T('#4fa046');
    for (let k = 0; k < 7; k++) B.add(ico(0.28, 0), leaf, { p: [-w / 2 + 0.3 + (k / 6) * (w - 0.6), 0.38, (rng() - 0.5) * 0.7], flat: true, shadow: false });
    const pal = o.color ? [o.color, shade(o.color, 0.3)] : ['#ff5a8a', '#ffd23f', '#ffffff', '#b58cff', '#ff8a3c'];
    for (let k = 0; k < 22; k++) {
      const col = pal[(rng() * pal.length) | 0];
      B.add(ico(0.13, 0), T(col), { p: [(rng() - 0.5) * (w - 0.3), 0.5 + rng() * 0.15, (rng() - 0.5) * (d - 0.3)], flat: true, shadow: false });
    }
  },

  hedge(B, o, rng) {
    const col = o.color || '#3f9a3c';
    const g = jitter(rbox(3.2, 1.3, 1.1, 0.35, 3), 0.05, rng);
    B.add(g, T(col), { p: [0, 0.65, 0] });
    for (let k = 0; k < 4; k++) B.add(jitter(ico(0.35, 1), 0.05, rng), T(shade(col, 0.1)), { p: [-1.2 + k * 0.8, 1.3, (rng() - 0.5) * 0.4], flat: true, shadow: false });
  },

  lamp(B, o) {
    const metal = T(o.color2 || '#2d3436');
    const glass = T(o.color || '#fff2c4', { emissive: o.color || '#ffe6a0', emissiveIntensity: o.night ? 1.6 : 0.35 });
    B.add(cyl(0.22, 0.28, 0.35, 8), metal, { p: [0, 0.18, 0] });
    B.add(cyl(0.07, 0.09, 3.3, 8), metal, { p: [0, 1.95, 0] });
    B.add(torus(0.12, 0.03, 6, 12), metal, { p: [0, 3.55, 0], r: [Math.PI / 2, 0, 0], shadow: false });
    B.add(cyl(0.2, 0.26, 0.55, 6), glass, { p: [0, 3.9, 0], shadow: false });
    B.add(cone(0.38, 0.32, 6), metal, { p: [0, 4.33, 0] });
    B.add(sph(0.07, 6, 4), metal, { p: [0, 4.52, 0], shadow: false });
    if (o.night) B.glow(o.color || '#ffe2a0', 3.2, [0, 3.9, 0], 0.85);
  },

  streetLight(B, o) {
    const metal = T(o.color2 || '#8d96a3');
    const lightCol = o.color || '#fff4d6';
    B.add(cyl(0.2, 0.28, 0.5, 8), metal, { p: [0, 0.25, 0] });
    B.add(cyl(0.1, 0.14, 7.2, 8), metal, { p: [0, 3.8, 0] });
    // arm towards +Z (the road)
    B.add(torus(0.9, 0.07, 6, 10, Math.PI / 2), metal, { p: [0, 7.4, 0.9], r: [0, -Math.PI / 2, 0], shadow: false });
    B.add(cyl(0.07, 0.07, 1.6, 6), metal, { p: [0, 8.3, 1.7], r: [Math.PI / 2, 0, 0], shadow: false });
    B.add(rbox(0.55, 0.22, 1.2, 0.08), metal, { p: [0, 8.25, 2.6] });
    B.add(box(0.4, 0.04, 1.0), L(lightCol, { emissive: lightCol, emissiveIntensity: o.night ? 2.0 : 0.4 }), { p: [0, 8.12, 2.6], shadow: false });
    if (o.night) {
      B.glow(lightCol, 3.5, [0, 7.95, 2.6], 0.9);
      // light pool on the ground
      const pool = new THREE.CircleGeometry(3.6, 20);
      pool.rotateX(-Math.PI / 2);
      B.add(pool, glowMat(lightCol, 0.28), { p: [0, 0.08, 2.8], shadow: false });
    }
  },

  building(B, o, rng) {
    const palette = ['#f2efe8', '#d9e4f2', '#f5d7c3', '#c9d6e3', '#e8e0f5', '#ffe9b8', '#bfe0d8'];
    const col = o.color || palette[(rng() * palette.length) | 0];
    const floors = o.variant === 'tall' ? 10 + ((rng() * 6) | 0) : o.variant === 'low' ? 3 + ((rng() * 2) | 0) : 5 + ((rng() * 6) | 0);
    const w = 9 + rng() * 5;
    const d = 8 + rng() * 4;
    const h = floors * 3;
    const wt = windowTexture(rng() < 0.5 ? 0 : 1);
    const mat = T(col, { map: wt.map, emissiveMap: wt.emissiveMap, emissive: '#ffd89a', emissiveIntensity: o.night ? 1.1 : 0.08 });
    const g = box(w, h, d);
    // UVs: one texture tile = 4x4 windows = 12 x 12 m
    const uv = g.attributes.uv;
    const nrm = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(nrm.getX(i));
      const ny = Math.abs(nrm.getY(i));
      if (ny > 0.5) {
        uv.setXY(i, 0.02, 0.02);
        continue;
      }
      const sx = nx > 0.5 ? d : w;
      uv.setXY(i, (uv.getX(i) * sx) / 12, (uv.getY(i) * h) / 12);
    }
    B.add(g, mat, { p: [0, h / 2, 0] });
    const trim = T(o.color2 || shade(col, -0.35));
    B.add(box(w + 0.4, 0.6, d + 0.4), trim, { p: [0, h + 0.3, 0] });
    B.add(box(w + 0.2, 1.0, d + 0.2), trim, { p: [0, 0.5, 0] });
    // roof details
    const roof = T('#9aa3ad');
    for (let k = 0; k < 2; k++) B.add(box(1.4, 0.9, 1.1), roof, { p: [(rng() - 0.5) * (w - 3), h + 1.05, (rng() - 0.5) * (d - 3)] });
    if (rng() < 0.6) {
      B.add(cyl(1.1, 1.1, 1.8, 10), T('#c0c6ce'), { p: [w * 0.25, h + 2.2, -d * 0.2] });
      for (const s of [-1, 1]) B.add(box(0.12, 1.0, 0.12), roof, { p: [w * 0.25 + s * 0.8, h + 1.0, -d * 0.2] });
    }
    if (rng() < 0.4) {
      B.add(cyl(0.05, 0.05, 4, 4), roof, { p: [-w * 0.3, h + 2.6, d * 0.2], shadow: false });
      B.add(sph(0.15, 6, 4), L('#ff3355', { emissive: '#ff3355', emissiveIntensity: 1.5 }), { p: [-w * 0.3, h + 4.6, d * 0.2], shadow: false });
    }
    // awning on the ground floor front
    B.add(box(w * 0.6, 0.15, 1.4), T(o.color2 || '#ff7a45'), { p: [0, 3.2, d / 2 + 0.7], r: [0.15, 0, 0] });
  },

  tower(B, o, rng) {
    const col = o.color || '#e9eef5';
    const acc = o.color2 || '#39d0ff';
    const accMat = L(acc, { emissive: acc, emissiveIntensity: o.night ? 1.6 : 0.6 });
    const m = T(col);
    if (o.variant === 'clock') {
      B.add(box(6, 26, 6), T(col), { p: [0, 13, 0] });
      B.add(box(6.6, 1, 6.6), T(shade(col, -0.2)), { p: [0, 26.5, 0] });
      B.add(box(5, 5, 5), m, { p: [0, 29.5, 0] });
      const clock = L('#ffffff', { map: clockTexture() });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        B.add(new THREE.CircleGeometry(1.9, 24), clock, { p: [Math.sin(a) * 2.52, 29.5, Math.cos(a) * 2.52], r: [0, a, 0], shadow: false });
      }
      B.add(cone(4.2, 7, 4), T(o.color2 || '#3b5a8a'), { p: [0, 35.5, 0], r: [0, Math.PI / 4, 0], flat: true });
      B.add(cyl(0.08, 0.08, 3, 4), T('#ffd23f'), { p: [0, 40, 0], shadow: false });
      return;
    }
    // modern spire tower (Millennium-ish)
    const tiers = [
      [7, 12],
      [5.5, 12],
      [4.2, 10],
      [3, 6],
    ];
    let y = 0;
    for (let i = 0; i < tiers.length; i++) {
      const [w, h] = tiers[i];
      B.add(cyl(w * 0.55, w * 0.62, h, 8), m, { p: [0, y + h / 2, 0], r: [0, Math.PI / 8, 0], flat: true });
      B.add(cyl(w * 0.64, w * 0.64, 0.45, 8), accMat, { p: [0, y + h, 0], r: [0, Math.PI / 8, 0], shadow: false });
      y += h;
    }
    B.add(cyl(0.12, 0.3, 6, 6), T('#b8c0cc'), { p: [0, y + 3, 0] });
    B.add(sph(0.35, 8, 6), L('#ff3355', { emissive: '#ff3355', emissiveIntensity: 2 }), { p: [0, y + 6.1, 0], shadow: false });
    // halo ring near the top
    B.add(torus(3.4, 0.18, 6, 32), accMat, { p: [0, y - 2, 0], r: [Math.PI / 2 + 0.15, 0, 0], shadow: false });
    if (o.night) B.glow(acc, 7, [0, y - 2, 0], 0.4);
    void rng;
  },

  ruin(B, o, rng) {
    const col = o.color || '#d8c7a0';
    const m = T(col);
    const m2 = T(shade(col, -0.12));
    const cols = 2 + ((rng() * 2) | 0);
    for (let k = 0; k < cols; k++) {
      const h = 2 + rng() * 3;
      const g = cyl(0.5, 0.55, h, 10);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > h / 2 - 0.01) pos.setY(i, pos.getY(i) - rng() * 0.6);
      g.computeVertexNormals();
      const x = (k - (cols - 1) / 2) * 2.4;
      B.add(g, m, { p: [x, h / 2 + 0.3, 0], flat: true });
      B.add(box(1.4, 0.3, 1.4), m2, { p: [x, 0.15, 0] });
    }
    B.add(jitter(cyl(0.5, 0.5, 2.4, 10), 0.05, rng), m, { p: [0.8, 0.5, 1.6], r: [0, 0.6, Math.PI / 2], flat: true });
    const wall = jitter(box(3.5, 2.2, 0.7, 4, 3, 1), 0.12, rng);
    B.add(wall, m2, { p: [-0.6, 1.1, -1.3], r: [0, 0.2, 0], flat: true });
    for (let k = 0; k < 3; k++) B.add(jitter(box(0.7, 0.5, 0.6), 0.06, rng), m, { p: [(rng() - 0.5) * 4, 0.25, 1 + rng() * 1.5], r: [0, rng() * 3, 0], flat: true });
  },

  fence(B, o) {
    const col = o.color || '#f4efe6';
    const m = T(col);
    const len = 4;
    for (let k = 0; k < 4; k++) B.add(box(0.14, 1.25, 0.14), m, { p: [-len / 2 + (k * len) / 3, 0.62, 0] });
    for (const y of [0.45, 0.95]) B.add(box(len, 0.1, 0.06), m, { p: [0, y, 0.08] });
    if (o.variant !== 'rail') {
      for (let k = 0; k < 13; k++) {
        const x = -len / 2 + 0.15 + (k / 12) * (len - 0.3);
        B.add(box(0.12, 1.05, 0.04), m, { p: [x, 0.55, 0.13], shadow: false });
        B.add(cone(0.085, 0.14, 4), m, { p: [x, 1.14, 0.13], r: [0, Math.PI / 4, 0], shadow: false });
      }
    }
  },

  torii(B, o) {
    const red = T(o.color || '#d8342c');
    const black = T(o.color2 || '#23201f');
    const span = o.width ?? 6.4;
    const H = Math.max(6.5, span * 0.62 + 2.5);
    for (const s of [-1, 1]) {
      B.add(cyl(0.32, 0.38, H, 12), red, { p: [(s * span) / 2, H / 2, 0] });
      B.add(cyl(0.45, 0.45, 0.5, 12), black, { p: [(s * span) / 2, 0.25, 0] });
    }
    B.add(box(span + 1.6, 0.38, 0.38), red, { p: [0, H - 1.5, 0] });
    const shimaki = bendUp(box(span + 2.6, 0.45, 0.62, 16, 1, 1), (span + 2.6) / 2, 0.45);
    B.add(shimaki, red, { p: [0, H - 0.2, 0] });
    const kasagi = bendUp(box(span + 3.2, 0.32, 0.8, 16, 1, 1), (span + 3.2) / 2, 0.6);
    B.add(kasagi, black, { p: [0, H + 0.2, 0] });
    B.add(box(0.28, 1.1, 0.3), red, { p: [0, H - 0.9, 0] });
    B.add(box(0.9, 0.65, 0.12), black, { p: [0, H - 0.95, 0.2], shadow: false });
  },

  lantern(B, o) {
    const post = T('#5b3a2e');
    const col = o.color || '#e8342c';
    B.add(cyl(0.08, 0.1, 2.4, 6), post, { p: [0, 1.2, 0] });
    B.add(box(0.08, 0.08, 0.7), post, { p: [0, 2.3, 0.3], shadow: false });
    const lm = T(col, { emissive: col, emissiveIntensity: o.night ? 1.2 : 0.3 });
    B.add(sph(0.36, 12, 10), lm, { p: [0, 1.75, 0.6], s: [1, 1.35, 1], shadow: false });
    const cap = T('#1c1c1c');
    B.add(cyl(0.2, 0.2, 0.1, 10), cap, { p: [0, 2.24, 0.6], shadow: false });
    B.add(cyl(0.2, 0.2, 0.1, 10), cap, { p: [0, 1.26, 0.6], shadow: false });
    B.add(cyl(0.012, 0.012, 0.3, 4), cap, { p: [0, 2.32, 0.6], shadow: false });
    // ribs
    for (let k = -2; k <= 2; k++) B.add(torus(0.36 * Math.cos(k * 0.32), 0.012, 3, 16), T(shade(col, -0.3)), { p: [0, 1.75 + k * 0.16, 0.6], r: [Math.PI / 2, 0, 0], shadow: false });
    if (o.night) B.glow(col, 2.4, [0, 1.75, 0.6], 0.8);
  },

  stoneLantern(B, o) {
    const st = T(o.color || '#a8a39a');
    const st2 = T(shade(o.color || '#a8a39a', -0.12));
    B.add(cyl(0.5, 0.55, 0.25, 6), st2, { p: [0, 0.12, 0], flat: true });
    B.add(cyl(0.16, 0.2, 0.75, 8), st, { p: [0, 0.62, 0], flat: true });
    B.add(cyl(0.5, 0.42, 0.2, 6), st2, { p: [0, 1.08, 0], flat: true });
    B.add(box(0.55, 0.5, 0.55), st, { p: [0, 1.43, 0] });
    const lit = L('#ffd98a', { emissive: '#ffc860', emissiveIntensity: o.night ? 1.8 : 0.5 });
    B.add(box(0.3, 0.26, 0.58), lit, { p: [0, 1.45, 0], shadow: false });
    B.add(box(0.58, 0.26, 0.3), lit, { p: [0, 1.45, 0], shadow: false });
    B.add(cone(0.72, 0.45, 6), st2, { p: [0, 1.9, 0], flat: true });
    B.add(sph(0.12, 6, 5), st, { p: [0, 2.18, 0] });
    if (o.night) B.glow('#ffc860', 2.2, [0, 1.45, 0], 0.8);
  },

  snowman(B, o) {
    const snow = T('#f7fbff');
    B.add(sph(0.8, 14, 10), snow, { p: [0, 0.72, 0] });
    B.add(sph(0.58, 14, 10), snow, { p: [0, 1.7, 0] });
    B.add(sph(0.42, 14, 10), snow, { p: [0, 2.4, 0] });
    const coal = T('#1c1c22');
    for (const s of [-1, 1]) B.add(sph(0.06, 6, 4), coal, { p: [s * 0.15, 2.5, 0.37], shadow: false });
    for (let k = 0; k < 3; k++) B.add(sph(0.06, 6, 4), coal, { p: [0, 1.95 - k * 0.22, 0.56 - k * 0.02], shadow: false });
    B.add(cone(0.08, 0.45, 8), T('#ff8a1f'), { p: [0, 2.4, 0.6], r: [Math.PI / 2, 0, 0], shadow: false });
    const scarf = T(o.color || '#e8304f');
    B.add(torus(0.42, 0.1, 6, 16), scarf, { p: [0, 2.08, 0], r: [Math.PI / 2, 0, 0] });
    B.add(box(0.2, 0.45, 0.08), scarf, { p: [0.25, 1.85, 0.4], r: [0, 0, 0.2], shadow: false });
    const stick = T('#6b4a2a');
    for (const s of [-1, 1]) B.add(cyl(0.035, 0.045, 0.9, 5), stick, { p: [s * 0.8, 1.9, 0], r: [0, 0, s * 1.0], shadow: false });
    const hat = T(o.color2 || '#2b3a5a');
    B.add(cyl(0.3, 0.26, 0.35, 12), hat, { p: [0, 2.9, 0], r: [0.1, 0, 0] });
    B.add(cyl(0.42, 0.42, 0.05, 12), hat, { p: [0, 2.74, 0], r: [0.1, 0, 0] });
  },

  crystal(B, o, rng) {
    const col = o.color || '#7ee8ff';
    const m = T(col, { emissive: col, emissiveIntensity: o.night ? 0.9 : 0.45 });
    const m2 = T(o.color2 || shade(col, 0.4), { emissive: col, emissiveIntensity: o.night ? 1.0 : 0.5 });
    B.add(jitter(ico(0.9, 0), 0.15, rng), T('#6d6a78'), { p: [0, 0.3, 0], s: [1.2, 0.5, 1.2], flat: true });
    const n = 5 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng();
      const tilt = k === 0 ? 0 : 0.3 + rng() * 0.4;
      const h = k === 0 ? 3 : 1.2 + rng() * 1.6;
      const r = k === 0 ? 0.45 : 0.22 + rng() * 0.18;
      const g = new THREE.Group();
      g.position.set(Math.cos(a) * (k === 0 ? 0 : 0.5), 0.3, Math.sin(a) * (k === 0 ? 0 : 0.5));
      g.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
      B.root.add(g);
      B.add(cyl(r, r * 0.9, h, 6), k % 2 ? m : m2, { p: [0, h / 2, 0], flat: true, parent: g });
      B.add(cone(r, r * 1.6, 6), k % 2 ? m : m2, { p: [0, h + r * 0.8, 0], flat: true, parent: g });
    }
    if (o.night) B.glow(col, 4, [0, 1.8, 0], 0.5);
  },

  cloud(B, o, rng) {
    const col = o.color || '#ffffff';
    const m = T(col);
    const m2 = T(o.color2 || shade(col, -0.08));
    const n = 6 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const r = 1.6 + Math.sin(t * Math.PI) * 1.4 + rng() * 0.6;
      B.add(sph(r, 12, 9), k % 2 ? m : m2, { p: [(t - 0.5) * 9 + (rng() - 0.5), r * 0.55, (rng() - 0.5) * 2.5], s: [1, 0.78, 1], shadow: false });
    }
  },

  sign(B, o) {
    const variant = o.variant || 'right';
    const post = T('#8d96a3');
    for (const s of [-1, 1]) B.add(cyl(0.06, 0.06, 2.4, 6), post, { p: [s * 0.8, 1.2, -0.05] });
    const face = L('#ffffff', { map: signTexture(variant, o.text) });
    const g = box(2.4, 1.2, 0.08);
    B.add(g, [T('#dfe3ea'), T('#dfe3ea'), T('#dfe3ea'), T('#dfe3ea'), face, T('#dfe3ea')], { p: [0, 1.9, 0.02] });
  },

  billboard(B, o, rng) {
    const idx = o.variant !== undefined && typeof o.variant === 'number' ? o.variant : (rng() * BILLBOARD_ADS.length) | 0;
    const frame = T(o.color2 || '#3a4252');
    for (const s of [-1, 1]) {
      B.add(box(0.35, 5, 0.35), frame, { p: [s * 3.2, 2.5, -0.1] });
      B.add(box(0.6, 0.2, 0.6), frame, { p: [s * 3.2, 0.1, -0.1] });
    }
    B.add(box(10.4, 5.4, 0.3), frame, { p: [0, 5.6, -0.2] });
    const face = L('#ffffff', { map: billboardTexture(idx, o.text), emissive: '#ffffff', emissiveIntensity: o.night ? 0.55 : 0.12, emissiveMap: billboardTexture(idx, o.text) });
    B.add(plane(10, 5), face, { p: [0, 5.6, -0.04], shadow: false });
    // catwalk + lamps
    B.add(box(10.4, 0.1, 0.8), frame, { p: [0, 2.85, 0.3] });
    const lampM = L('#fff4d6', { emissive: '#fff4d6', emissiveIntensity: o.night ? 2 : 0.2 });
    for (const x of [-3.5, 0, 3.5]) {
      B.add(box(0.08, 0.08, 0.9), frame, { p: [x, 8.4, 0.35], shadow: false });
      B.add(box(0.5, 0.18, 0.25), lampM, { p: [x, 8.35, 0.8], shadow: false });
    }
  },

  tire(B, o) {
    const rub = T('#232329');
    const paint = T(o.color || '#ffffff');
    const n = o.variant === 'single' ? 1 : 3;
    for (let k = 0; k < n; k++) {
      B.add(torus(0.45, 0.2, 8, 16), rub, { p: [0, 0.2 + k * 0.4, 0], r: [Math.PI / 2, 0, k * 0.3] });
      B.add(torus(0.45, 0.205, 4, 16, Math.PI * 0.5), paint, { p: [0, 0.2 + k * 0.4, 0], r: [Math.PI / 2, 0, k * 1.7], shadow: false });
    }
  },

  cone(B, o) {
    const col = o.color || '#ff7a1f';
    B.add(box(0.62, 0.06, 0.62), T(col), { p: [0, 0.03, 0] });
    B.add(cone(0.28, 0.72, 12), T(col), { p: [0, 0.42, 0] });
    B.add(cyl(0.155, 0.19, 0.13, 12), T(o.color2 || '#ffffff'), { p: [0, 0.46, 0], shadow: false });
  },

  barrel(B, o) {
    const col = o.color || '#d8342c';
    const m = T(col);
    const ring = T(shade(col, -0.35));
    B.add(cyl(0.52, 0.52, 1.24, 16), m, { p: [0, 0.62, 0] });
    for (const y of [0.3, 0.94]) B.add(cyl(0.545, 0.545, 0.07, 16), ring, { p: [0, y, 0], shadow: false });
    B.add(cyl(0.44, 0.44, 0.03, 16), ring, { p: [0, 1.25, 0], shadow: false });
    // hazard band
    B.add(cyl(0.53, 0.53, 0.2, 16), T(o.color2 || '#ffd23f'), { p: [0, 0.62, 0], shadow: false });
  },

  crate(B, o) {
    const v = o.variant === 'metal' ? 1 : 0;
    const m = T(o.color || '#ffffff', { map: crateTexture(v) });
    B.add(box(1.3, 1.3, 1.3), m, { p: [0, 0.65, 0] });
  },

  banner(B, o, rng) {
    const words = ['GO!', 'SSK', 'RAMEN', 'ABYDOS', 'FIGHT!', 'CREDIT', 'SENSEI'];
    const text = o.text || words[(rng() * words.length) | 0];
    const col = o.color || ['#ff3355', '#1fb6ff', '#ffd23f', '#7cff6b', '#ff7ab8'][(rng() * 5) | 0];
    const tex = sharedTexture(`nobori:${text}:${col}`, () => {
      const { c, g } = makeCanvas(128, 512);
      const t = canvasTexture(c, { repeat: false, anisotropy: 8 });
      paintWithFonts(t, () => {
        g.fillStyle = col;
        g.fillRect(0, 0, 128, 512);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, 18, 512);
        g.fillStyle = shade(col, -0.25);
        g.fillRect(110, 0, 18, 512);
        const letters = text.split('');
        const step = Math.min(90, 440 / letters.length);
        letters.forEach((ch, i) => chunkyText(g, ch, 66, 40 + step * (i + 0.5), step * 0.95, { fill: '#ffffff', stroke: shade(col, -0.5), strokeW: 0.08, shadow: false }));
      });
      return t;
    });
    const pole = T('#6b4a2a');
    B.add(cyl(0.05, 0.06, 4.3, 6), pole, { p: [0, 2.15, 0] });
    B.add(cyl(0.04, 0.04, 1.0, 5), pole, { p: [0.45, 4.1, 0], r: [0, 0, Math.PI / 2], shadow: false });
    B.add(plane(0.9, 3.4), L('#ffffff', { map: tex, side: THREE.DoubleSide }), { p: [0.47, 2.4, 0.02], shadow: true });
  },

  flag(B, o) {
    const pole = T('#d8dde5');
    B.add(cyl(0.06, 0.08, 6, 8), pole, { p: [0, 3, 0] });
    B.add(sph(0.14, 8, 6), T('#ffd23f'), { p: [0, 6.08, 0], shadow: false });
    const g = plane(2.4, 1.5, 10, 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + 1.2;
      pos.setZ(i, Math.sin(x * 2.2) * 0.18 * (x / 2.4));
      pos.setY(i, pos.getY(i) - x * 0.06);
    }
    g.computeVertexNormals();
    let map;
    if (o.variant === 'checker') {
      map = sharedTexture('flagchecker', () => {
        const { c, g: cg } = makeCanvas(128, 80);
        for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) {
          cg.fillStyle = (i + j) % 2 ? '#111' : '#fff';
          cg.fillRect(i * 16, j * 16, 16, 16);
        }
        return canvasTexture(c, { repeat: false, anisotropy: 8 });
      });
    } else {
      const col = o.color || '#1fb6ff';
      map = sharedTexture(`flag:${col}`, () => {
        const { c, g: cg } = makeCanvas(256, 160);
        cg.fillStyle = col;
        cg.fillRect(0, 0, 256, 160);
        cg.fillStyle = 'rgba(255,255,255,0.9)';
        cg.fillRect(0, 128, 256, 14);
        cg.strokeStyle = '#ffffff';
        cg.lineWidth = 10;
        cg.beginPath();
        cg.arc(128, 70, 38, 0, Math.PI * 2);
        cg.stroke();
        cg.beginPath();
        cg.arc(128, 70, 14, 0, Math.PI * 2);
        cg.stroke();
        return canvasTexture(c, { repeat: false, anisotropy: 8 });
      });
    }
    B.add(g, L('#ffffff', { map, side: THREE.DoubleSide }), { p: [1.25, 5.2, 0] });
  },

  grandstand(B, o) {
    const W = 20;
    const steps = 5;
    const body = T(o.color || '#e9eef5');
    const acc = T(o.color2 || '#1fb6ff');
    const crowd = L('#ffffff', { map: crowdTexture() });
    for (let k = 0; k < steps; k++) {
      const y = 0.5 + k * 0.9;
      const z = 2.8 - k * 1.3;
      B.add(box(W, y * 2 > 0 ? y + 0.45 : 1, 1.3), body, { p: [0, (y + 0.45) / 2, z] });
      const crowdG = plane(W - 0.4, 0.95);
      const uv = crowdG.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 2.5 + k * 0.37);
      B.add(crowdG, crowd, { p: [0, y + 0.45 + 0.47, z - 0.25], shadow: false });
    }
    B.add(box(W, 0.4, 1.4), acc, { p: [0, 0.2, 3.9] });
    B.add(box(0.4, 7, 7), body, { p: [-W / 2, 3.5, 0.2] });
    B.add(box(0.4, 7, 7), body, { p: [W / 2, 3.5, 0.2] });
    // roof
    for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) B.add(box(0.3, 7.5, 0.3), T('#8d96a3'), { p: [x, 3.75, -3] });
    B.add(box(W + 1, 0.3, 8), acc, { p: [0, 7.6, 0.4], r: [-0.1, 0, 0] });
    B.add(box(W + 1, 0.8, 0.2), T('#ffffff'), { p: [0, 7.5, 4.4], r: [-0.1, 0, 0] });
  },

  balloon(B, o, rng) {
    const a = o.color || ['#ff5a6e', '#1fb6ff', '#ffd23f', '#7cff6b', '#b18cff'][(rng() * 5) | 0];
    const b = o.color2 || '#ffffff';
    if (o.variant === 'party') {
      for (let k = 0; k < 5; k++) {
        const col = ['#ff5a6e', '#1fb6ff', '#ffd23f', '#7cff6b', '#ff9ec7'][k];
        const x = (rng() - 0.5) * 1.2;
        const z = (rng() - 0.5) * 1.2;
        const y = 2.4 + rng() * 0.8;
        B.add(sph(0.4, 10, 8), T(col), { p: [x, y, z], s: [1, 1.2, 1] });
        B.add(cyl(0.01, 0.01, y - 0.4, 3), T('#ffffff'), { p: [x / 2, (y - 0.4) / 2, z / 2], r: [z * 0.2, 0, -x * 0.2], shadow: false });
      }
      B.add(box(0.3, 0.2, 0.3), T('#888'), { p: [0, 0.1, 0] });
      return;
    }
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const ang = t * Math.PI;
      let r = Math.sin(ang) * 3.4;
      if (t < 0.35) r = Math.max(0.55, r * (0.45 + t * 1.6));
      pts.push([Math.max(0.01, r), t * 7.2]);
    }
    pts[0][0] = 0.55;
    const env = lathe(pts, 16);
    B.add(env, T('#ffffff', { map: stripeTexture(a, b, 8, true) }), { p: [0, 3.2, 0] });
    B.add(cyl(0.6, 0.5, 0.3, 12), T(shade(a, -0.3)), { p: [0, 3.15, 0] });
    B.add(box(1.1, 0.8, 1.1), T('#9a6a3a'), { p: [0, 0.4, 0] });
    const rope = T('#5b3a2e');
    for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      B.add(cyl(0.02, 0.02, 2.5, 3), rope, { p: [x * 0.8, 2.0, z * 0.8], r: [z * 0.1, 0, -x * 0.1], shadow: false });
    }
    B.add(cone(0.3, 0.5, 8), L('#ffb03a', { emissive: '#ff8a1f', emissiveIntensity: 1.2 }), { p: [0, 1.6, 0], shadow: false });
  },

  pillar(B, o) {
    const col = o.color || '#efe9dc';
    const m = T(col);
    const m2 = T(shade(col, -0.08));
    B.add(box(1.5, 0.35, 1.5), m2, { p: [0, 0.18, 0] });
    B.add(cyl(0.62, 0.66, 0.3, 16), m, { p: [0, 0.5, 0] });
    B.add(cyl(0.48, 0.54, 4.6, 12), m, { p: [0, 2.95, 0], flat: true });
    B.add(cyl(0.66, 0.5, 0.35, 16), m, { p: [0, 5.4, 0] });
    B.add(box(1.5, 0.35, 1.5), m2, { p: [0, 5.75, 0] });
    if (o.color2) B.add(torus(0.5, 0.06, 6, 16), T(o.color2), { p: [0, 4.9, 0], r: [Math.PI / 2, 0, 0], shadow: false });
  },

  arch(B, o) {
    const col = o.color || '#dcd3c3';
    const m = T(col);
    const span = o.width ?? 9;
    const R = span / 2 + 1.2;
    const r = span / 2;
    const legH = Math.max(4, span * 0.45);
    const shape = new THREE.Shape();
    shape.moveTo(-R, 0);
    shape.absarc(0, 0, R, Math.PI, 0, true);
    shape.lineTo(r, 0);
    shape.absarc(0, 0, r, 0, Math.PI, false);
    shape.lineTo(-R, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false, curveSegments: 20 });
    g.translate(0, 0, -0.7);
    B.add(g, m, { p: [0, legH, 0] });
    for (const s of [-1, 1]) {
      B.add(box(1.2, legH, 1.4), m, { p: [s * (r + 0.6), legH / 2, 0] });
      B.add(box(1.6, 0.5, 1.8), T(shade(col, -0.1)), { p: [s * (r + 0.6), 0.25, 0] });
    }
    B.add(box(1.0, 1.4, 1.6), T(o.color2 || '#1fb6ff'), { p: [0, legH + R - 0.5, 0] });
  },

  fountain(B, o) {
    const stone = T(o.color || '#d8d2c6');
    const water = L(o.color2 || '#7fd3ff', { emissive: '#3aa8e8', emissiveIntensity: 0.35 });
    B.add(lathe([[0.01, 0], [2.7, 0], [2.8, 0.7], [2.5, 0.75], [2.4, 0.3], [0.01, 0.3]], 20), stone, { p: [0, 0, 0] });
    B.add(new THREE.CircleGeometry(2.45, 20), water, { p: [0, 0.55, 0], r: [-Math.PI / 2, 0, 0], shadow: false });
    B.add(cyl(0.35, 0.45, 1.6, 10), stone, { p: [0, 1.1, 0] });
    B.add(lathe([[0.01, 0], [0.4, 0], [1.2, 0.35], [1.1, 0.45], [0.01, 0.2]], 16), stone, { p: [0, 1.8, 0] });
    B.add(new THREE.CircleGeometry(1.05, 16), water, { p: [0, 2.2, 0], r: [-Math.PI / 2, 0, 0], shadow: false });
    B.add(cone(0.18, 0.9, 8), water, { p: [0, 2.6, 0], shadow: false });
    B.add(sph(0.16, 8, 6), water, { p: [0, 3.05, 0], shadow: false });
    const fall = L('#bfeaff', { opacity: 0.55, emissive: '#7fd3ff', emissiveIntensity: 0.4 });
    B.add(cyl(1.1, 1.3, 1.4, 16, true), fall, { p: [0, 1.5, 0], shadow: false });
  },

  bench(B, o) {
    const wood = T(o.color || '#b5733a');
    const iron = T(o.color2 || '#2d3436');
    for (const s of [-1, 1]) {
      B.add(box(0.08, 0.45, 0.5), iron, { p: [s * 0.85, 0.22, 0] });
      B.add(box(0.08, 0.6, 0.08), iron, { p: [s * 0.85, 0.65, -0.24], r: [-0.15, 0, 0] });
    }
    for (let k = 0; k < 3; k++) B.add(box(2, 0.06, 0.15), wood, { p: [0, 0.47, -0.18 + k * 0.18] });
    for (let k = 0; k < 2; k++) B.add(box(2, 0.14, 0.05), wood, { p: [0, 0.72 + k * 0.2, -0.28 - k * 0.03], r: [-0.15, 0, 0] });
  },

  vendingMachine(B, o, rng) {
    const col = o.color || ['#e8304f', '#1fb6ff', '#f4f4f4', '#2cc36b'][(rng() * 4) | 0];
    const vt = vendingTexture(col);
    const body = T(col);
    const front = L('#ffffff', { map: vt.map, emissiveMap: vt.emissiveMap, emissive: '#ffffff', emissiveIntensity: o.night ? 1.0 : 0.35 });
    const g = box(1.1, 2.0, 0.8);
    B.add(g, [body, body, body, body, front, body], { p: [0, 1.0, 0] });
    B.add(box(1.16, 0.1, 0.86), T(shade(col, -0.3)), { p: [0, 2.03, 0], shadow: false });
    if (o.night) B.glow('#bfe8ff', 2.4, [0, 1.3, 0.6], 0.4);
  },

  neonSign(B, o, rng) {
    const text = o.text || NEON_WORDS[(rng() * NEON_WORDS.length) | 0];
    const col = o.color || NEON_COLORS[(rng() * NEON_COLORS.length) | 0];
    const tex = neonTexture(text, col);
    const frame = T(o.color2 || '#23232e');
    B.add(cyl(0.1, 0.12, 3.2, 8), frame, { p: [0, 1.6, -0.1] });
    B.add(box(3.3, 1.75, 0.22), frame, { p: [0, 3.8, -0.1] });
    const face = L('#ffffff', { map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: o.night ? 1.6 : 0.9 });
    B.add(plane(3.1, 1.55), face, { p: [0, 3.8, 0.02], shadow: false });
    B.add(plane(3.1, 1.55), face, { p: [0, 3.8, -0.22], r: [0, Math.PI, 0], shadow: false });
    B.glow(col, 4.5, [0, 3.8, 0.4], o.night ? 0.5 : 0.18);
  },

  hologram(B, o, rng) {
    const v = typeof o.variant === 'number' ? o.variant : (rng() * 4) | 0;
    const col = v % 2 ? '#ff7ae0' : '#4fe3ff';
    B.add(cyl(0.6, 0.75, 0.35, 12), T('#2b2f3a'), { p: [0, 0.18, 0] });
    B.add(torus(0.55, 0.05, 4, 20), L(col, { emissive: col, emissiveIntensity: 2 }), { p: [0, 0.37, 0], r: [Math.PI / 2, 0, 0], shadow: false });
    const beam = L(col, { additive: true, opacity: 0.22, side: THREE.DoubleSide, fog: true });
    B.add(cyl(1.4, 0.4, 1.8, 12, true), beam, { p: [0, 1.25, 0], shadow: false });
    const panel = L('#ffffff', { map: hologramTexture(v), additive: true, opacity: 0.95, side: THREE.DoubleSide });
    B.add(plane(3, 1.9), panel, { p: [0, 2.9, 0], shadow: false });
    B.glow(col, 3.2, [0, 0.8, 0], 0.35);
  },

  pagoda(B, o, rng) {
    const wall = T(o.color || '#c0392b');
    const roof = T(o.color2 || '#3b4a4f');
    const white = T('#f4efe6');
    const tiers = o.variant === 'small' ? 3 : 5;
    let y = 0;
    B.add(box(9, 0.8, 9), T('#a8a39a'), { p: [0, 0.4, 0] });
    y = 0.8;
    for (let k = 0; k < tiers; k++) {
      const w = 6.2 - k * 0.8;
      const h = k === 0 ? 3 : 2.2;
      B.add(box(w, h, w), k === 0 ? white : wall, { p: [0, y + h / 2, 0] });
      // corner posts
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.add(box(0.3, h, 0.3), wall, { p: [(sx * w) / 2, y + h / 2, (sz * w) / 2], shadow: false });
      y += h;
      const rw = w + 2.6;
      const r = new THREE.ConeGeometry(rw * 0.72, 1.3, 4, 1);
      r.rotateY(Math.PI / 4);
      const pos = r.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const d = Math.max(Math.abs(x), Math.abs(z)) / (rw / 2);
        if (pos.getY(i) < 0) pos.setY(i, pos.getY(i) + Math.pow(Math.max(0, d), 4) * 0.6);
      }
      r.computeVertexNormals();
      B.add(r, roof, { p: [0, y + 0.45, 0], flat: true });
      y += 0.5;
    }
    B.add(cyl(0.12, 0.2, 3.2, 8), T('#c9a227'), { p: [0, y + 1.6, 0] });
    for (let k = 0; k < 5; k++) B.add(torus(0.28, 0.05, 4, 12), T('#c9a227'), { p: [0, y + 0.8 + k * 0.4, 0], r: [Math.PI / 2, 0, 0], shadow: false });
    void rng;
  },

  iceSpike(B, o, rng) {
    const col = o.color || '#bfe6ff';
    const m = T(col, { emissive: '#8fd0ff', emissiveIntensity: 0.25 });
    const m2 = T(o.color2 || '#e8f7ff', { emissive: '#8fd0ff', emissiveIntensity: 0.2 });
    const n = 3 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng();
      const h = k === 0 ? 5 : 2 + rng() * 2.5;
      const r = k === 0 ? 0.9 : 0.4 + rng() * 0.3;
      const tilt = k === 0 ? 0 : 0.25 + rng() * 0.3;
      const g = new THREE.Group();
      g.position.set(Math.cos(a) * (k === 0 ? 0 : 0.7), 0, Math.sin(a) * (k === 0 ? 0 : 0.7));
      g.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
      B.root.add(g);
      B.add(jitter(cone(r, h, 5), 0.06, rng), k % 2 ? m : m2, { p: [0, h / 2 - 0.2, 0], flat: true, parent: g });
    }
  },

  lavaRock(B, o, rng) {
    const lt = lavaRockTexture();
    const m = T(o.color || '#3a2e30', { map: lt.map, emissiveMap: lt.emissiveMap, emissive: '#ffffff', emissiveIntensity: 1.3 });
    B.add(jitter(ico(1.4, 1), 0.3, rng), m, { p: [0, 0.9, 0], s: [1.15, 0.85, 1], flat: true });
    if (rng() < 0.6) B.add(jitter(ico(0.6, 1), 0.12, rng), m, { p: [1.3, 0.35, 0.5], flat: true });
  },

  skull(B, o) {
    const bone = T(o.color || '#efe6d0');
    const dark = T('#1c1418');
    B.add(sph(1.0, 16, 12), bone, { p: [0, 1.35, -0.05], s: [1, 0.92, 1.05] });
    B.add(rbox(1.3, 0.7, 1.0, 0.25), bone, { p: [0, 0.62, 0.2] });
    for (const s of [-1, 1]) B.add(sph(0.3, 10, 8), dark, { p: [s * 0.38, 1.2, 0.8], s: [1, 1.1, 0.6], shadow: false });
    B.add(cone(0.14, 0.3, 3), dark, { p: [0, 0.88, 0.95], r: [Math.PI, 0, 0], shadow: false });
    for (let k = -2; k <= 2; k++) B.add(box(0.17, 0.22, 0.1), T('#fffaf0'), { p: [k * 0.2, 0.45, 0.72], shadow: false });
    if (o.color2) for (const s of [-1, 1]) B.add(sph(0.12, 8, 6), L(o.color2, { emissive: o.color2, emissiveIntensity: 2 }), { p: [s * 0.38, 1.2, 0.86], shadow: false });
  },

  gear(B, o) {
    const col = o.color || '#9aa3ad';
    const teeth = 12;
    const R = 2;
    const r = 1.65;
    const shape = new THREE.Shape();
    for (let k = 0; k < teeth; k++) {
      const a0 = (k / teeth) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / teeth;
      const pts = [
        [r, a0],
        [R, a0 + (a1 - a0) * 0.2],
        [R, a0 + (a1 - a0) * 0.5],
        [r, a0 + (a1 - a0) * 0.7],
      ];
      pts.forEach(([rr, a], i) => {
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (k === 0 && i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      });
    }
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.55, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1, curveSegments: 12 });
    g.translate(0, 0, -0.25);
    B.add(g, T(col), { p: [0, R + 0.1, 0] });
    B.add(cyl(0.7, 0.7, 0.8, 12), T(o.color2 || shade(col, -0.3)), { p: [0, R + 0.1, 0], r: [Math.PI / 2, 0, 0] });
    B.add(box(1.2, 0.3, 0.9), T(shade(col, -0.3)), { p: [0, 0.15, 0] });
  },

  desk(B, o) {
    const wood = T(o.color || '#d9a867');
    const metal = T(o.color2 || '#7b8794');
    B.add(box(1.2, 0.06, 0.62), wood, { p: [0, 0.76, 0.35] });
    for (const [x, z] of [[-0.55, 0.1], [0.55, 0.1], [-0.55, 0.6], [0.55, 0.6]]) B.add(box(0.05, 0.74, 0.05), metal, { p: [x, 0.37, z], shadow: false });
    B.add(box(1.1, 0.04, 0.5), metal, { p: [0, 0.6, 0.35], shadow: false });
    // chair behind the desk (facing +Z)
    B.add(box(0.5, 0.05, 0.48), wood, { p: [0, 0.46, -0.3] });
    B.add(box(0.5, 0.36, 0.04), wood, { p: [0, 0.78, -0.53] });
    for (const [x, z] of [[-0.22, -0.1], [0.22, -0.1], [-0.22, -0.52], [0.22, -0.52]]) B.add(box(0.04, 0.46, 0.04), metal, { p: [x, 0.23, z], shadow: false });
  },

  book(B, o, rng) {
    const cols = [o.color || '#1f7ae0', o.color2 || '#e8304f', '#2cc36b', '#ffd23f', '#b18cff'];
    const pages = T('#fbf6e8');
    if (o.variant === 'open') {
      const cover = T(cols[0]);
      for (const s of [-1, 1]) {
        B.add(box(1.1, 0.06, 1.5), cover, { p: [s * 0.58, 0.1, 0], r: [0, 0, s * 0.12] });
        B.add(box(1.0, 0.12, 1.4), pages, { p: [s * 0.54, 0.2, 0], r: [0, 0, s * 0.12] });
      }
      return;
    }
    let y = 0;
    const n = 3;
    for (let k = 0; k < n; k++) {
      const w = 1.6 - k * 0.15 + rng() * 0.1;
      const d = 1.1 - k * 0.08;
      const h = 0.28 + rng() * 0.08;
      const col = cols[k % cols.length];
      const cover = T(col, { map: bookTexture(col) });
      const g = box(w, h, d);
      B.add(g, [pages, cover, cover, cover, pages, pages], { p: [0, y + h / 2, 0], r: [0, (rng() - 0.5) * 0.5, 0] });
      y += h;
    }
  },

  islet(B, o, rng) {
    const style = o.variant || 'sky';
    if (style === 'sky') {
      B.add(cyl(1, 0.95, 0.35, 10), T(o.color || '#7cc85a'), { p: [0, 0.18, 0], flat: true });
      B.add(jitter(cone(0.95, 1.8, 8), 0.1, rng), T(o.color2 || '#8a6a4a'), { p: [0, -0.9, 0], r: [Math.PI, 0, 0], flat: true });
    } else {
      // mound rising out of lava / water; top at y = 0
      B.add(jitter(cyl(0.9, 1.35, 2.4, 9), 0.08, rng), T(o.color || (style === 'lava' ? '#3a2e2c' : '#d9c28a')), { p: [0, -1.0, 0], flat: true });
      B.add(cyl(0.92, 0.92, 0.2, 9), T(o.color2 || (style === 'lava' ? '#4a3a36' : '#7cc85a')), { p: [0, 0.1, 0], flat: true });
    }
  },
};

const warned = new Set();
function genericProp(B, o) {
  B.add(rbox(1.2, 1.6, 1.2, 0.2), T(o.color || '#b18cff'), { p: [0, 0.8, 0] });
  B.add(sph(0.35, 10, 8), T(o.color2 || '#ffd23f', { emissive: '#ffd23f', emissiveIntensity: 0.4 }), { p: [0, 1.95, 0] });
}

// ---------------------------------------------------------------------------------------------------------
// Flattening (per-material merge) + public API
// ---------------------------------------------------------------------------------------------------------
function normalizeGeometry(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  return g;
}

/** Build the raw (unmerged) prop group. */
function buildRaw(kind, o) {
  const seed = (o.seed ?? 0) + hashString(kind);
  const rng = mulberry32(seed);
  const B = new PB(o);
  const fn = BUILDERS[kind];
  if (fn) fn(B, o, rng);
  else {
    if (!warned.has(kind)) {
      warned.add(kind);
      console.warn(`[Props] unknown prop kind "${kind}" - using a generic prop`);
    }
    genericProp(B, o);
  }
  return B.root;
}

const partsCache = new Map();

function optsKey(kind, o) {
  return `${kind}|${o.color || ''}|${o.color2 || ''}|${o.seed ?? 0}|${o.variant ?? ''}|${o.night ? 1 : 0}|${o.text || ''}|${o.width ?? ''}`;
}

/**
 * Flattened prop: [{ geometry, material, castShadow }] with all transforms baked (scale 1).
 * Cached: the returned geometries are shared — do not modify them.
 */
export function getPropParts(kind, opts = {}) {
  const key = optsKey(kind, opts);
  let parts = partsCache.get(key);
  if (parts) return parts;
  const root = buildRaw(kind, opts);
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse((m) => {
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (Array.isArray(m.material)) {
      // split multi-material geometry by groups
      const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      for (const grp of m.geometry.groups) {
        const mat = mats[grp.materialIndex];
        const start = grp.start;
        const sub = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
          const a = src.attributes[name];
          if (!a) continue;
          sub.setAttribute(name, new THREE.Float32BufferAttribute(a.array.slice(start * a.itemSize, (start + grp.count) * a.itemSize), a.itemSize));
        }
        sub.applyMatrix4(m.matrixWorld);
        const e = byMat.get(mat) || { geos: [], shadow: false };
        e.geos.push(normalizeGeometry(sub));
        e.shadow ||= m.castShadow;
        byMat.set(mat, e);
      }
      return;
    }
    const g = normalizeGeometry(m.geometry);
    g.applyMatrix4(m.matrixWorld);
    const e = byMat.get(m.material) || { geos: [], shadow: false };
    e.geos.push(g);
    e.shadow ||= m.castShadow;
    byMat.set(m.material, e);
  });
  parts = [];
  for (const [material, e] of byMat) {
    const geometry = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.shared = true;
    parts.push({ geometry, material, castShadow: e.shadow && !material.transparent });
  }
  // raw geometries are no longer needed
  root.traverse((m) => m.isMesh && m.geometry.dispose());
  partsCache.set(key, parts);
  return parts;
}

/**
 * Create a prop (merged per material). Origin at ground, faces +Z.
 * @param {string} kind
 * @param {{scale?:number, color?:string, color2?:string, seed?:number, variant?:any, night?:boolean, text?:string, width?:number, castShadow?:boolean}} opts
 */
export function createProp(kind, opts = {}) {
  const parts = getPropParts(kind, opts);
  const g = new THREE.Group();
  g.name = `prop:${kind}`;
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.castShadow = opts.castShadow === false ? false : p.castShadow;
    m.receiveShadow = !p.material.transparent;
    g.add(m);
  }
  const s = opts.scale ?? 1;
  if (Array.isArray(s)) g.scale.set(s[0], s[1], s[2]);
  else g.scale.setScalar(s);
  g.userData.kind = kind;
  g.userData.meta = PROP_META[kind] || { r: 1, h: 2 };
  return g;
}

/** Footprint radius of a prop kind at scale 1. */
export function propRadius(kind) {
  return (PROP_META[kind] || { r: 1 }).r;
}

/** Building window textures { map, emissiveMap } (style 0 | 1), shared. */
export const windowTextures = (style = 0) => windowTexture(style);
