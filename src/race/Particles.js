// Pooled GPU particle system (owner: items agent).
//
//   new Particles(scene, { quality = 'high' } = {})
//   particles.emit(type, position, { count, color, color2, velocity, spread, size, life, ... })
//   particles.update(dt, camera)      // once per rendered frame
//   particles.clear()
//   particles.dispose()
//
// Design
//   * One InstancedBufferGeometry (a unit quad) + one interleaved per-instance buffer (32 floats / particle).
//   * Simulation is ANALYTIC on the GPU: each particle stores its spawn state (position, velocity, spawn time,
//     life, gravity, linear drag, floor height ...) and the vertex shader evaluates position/velocity/size/
//     colour/alpha at `uTime - t0`. The CPU only writes a particle once, when it is emitted (ring buffer),
//     and uploads just the dirty ranges. Zero per-frame CPU cost per particle and no per-emit allocations.
//   * Premultiplied-alpha blending (ONE, ONE_MINUS_SRC_ALPHA) with a per-particle `additive` factor, so
//     glowing additive sparks and alpha-blended smoke share ONE draw call.
//   * Sprite atlas (4x4 cells) generated on a canvas at startup: glow, dot, cartoon star, twinkle, petal,
//     snowflake, smoke puff, streak, ring, confetti square, shard, coin, flame, droplet, debris chunk, bolt.
//   * Orientation modes: camera billboard (with rotation + optional "flutter" flip), velocity-stretched streak,
//     ground-aligned (horizontal) quad for shockwave rings.
//
// Types (ARCHITECTURE §8): spark, dust, smoke, boostFlame, explosion, confetti, coin, splash, snow, petal,
// ember, star, hitStars, itemBoxBurst, ring.
// Extra types: glow, flash, trail, debris, zap, smokeTrail, sparkle (=star), shockwave (=ring), noodle,
// puff (small white poof), halo (golden aura sparkle), speedLine.

import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------
// Sprite atlas
// ------------------------------------------------------------------------------------------------
export const SPRITE = {
  GLOW: 0,
  DOT: 1,
  STAR: 2,
  TWINKLE: 3,
  PETAL: 4,
  FLAKE: 5,
  PUFF: 6,
  STREAK: 7,
  RING: 8,
  SQUARE: 9,
  SHARD: 10,
  COIN: 11,
  FLAME: 12,
  DROP: 13,
  CHUNK: 14,
  BOLT: 15,
};

const ORIENT_BILLBOARD = 0;
const ORIENT_STRETCH = 1;
const ORIENT_GROUND = 2;

const CELL = 128;
const GRID = 4;

function makeAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CELL * GRID;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const cells = [];
  for (let i = 0; i < GRID * GRID; i++) cells.push({ x: (i % GRID) * CELL, y: Math.floor(i / GRID) * CELL });
  const S = CELL;
  const C = S / 2;
  const withCell = (idx, fn) => {
    const c = cells[idx];
    g.save();
    g.translate(c.x, c.y);
    g.beginPath();
    g.rect(0, 0, S, S);
    g.clip();
    fn();
    g.restore();
  };
  const radial = (r, stops) => {
    const grd = g.createRadialGradient(C, C, 0, C, C, r);
    for (const [o, col] of stops) grd.addColorStop(o, col);
    return grd;
  };
  const starPath = (cx, cy, points, rOut, rIn, rot = -Math.PI / 2) => {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? rOut : rIn;
      const a = rot + (i * Math.PI) / points;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  };

  // 0 GLOW — soft round glow
  withCell(SPRITE.GLOW, () => {
    g.fillStyle = radial(C * 0.96, [
      [0, 'rgba(255,255,255,1)'],
      [0.18, 'rgba(255,255,255,0.85)'],
      [0.45, 'rgba(255,255,255,0.32)'],
      [0.75, 'rgba(255,255,255,0.08)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    g.fillRect(0, 0, S, S);
  });
  // 1 DOT — crisp disc with soft rim
  withCell(SPRITE.DOT, () => {
    g.fillStyle = radial(C * 0.8, [
      [0, 'rgba(255,255,255,1)'],
      [0.7, 'rgba(255,255,255,1)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    g.fillRect(0, 0, S, S);
  });
  // 2 STAR — cartoon 5-point star, dark outline + highlight (tint = fill colour)
  withCell(SPRITE.STAR, () => {
    starPath(C, C + 4, 5, C * 0.78, C * 0.36);
    g.lineJoin = 'round';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(70,45,20,1)';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.fill();
    // inner shading
    starPath(C + 3, C + 8, 5, C * 0.5, C * 0.23);
    g.fillStyle = 'rgba(215,215,215,1)';
    g.fill();
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    g.ellipse(C - 12, C - 14, 9, 6, -0.6, 0, Math.PI * 2);
    g.fill();
  });
  // 3 TWINKLE — 4-point sparkle
  withCell(SPRITE.TWINKLE, () => {
    g.fillStyle = radial(C * 0.5, [
      [0, 'rgba(255,255,255,1)'],
      [0.35, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#fff';
    g.beginPath();
    const r1 = C * 0.95;
    const r2 = C * 0.09;
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? r1 : r2;
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const x = C + Math.cos(a) * r;
      const y = C + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  });
  // 4 PETAL — sakura petal (notched tip)
  withCell(SPRITE.PETAL, () => {
    g.translate(C, C);
    g.beginPath();
    g.moveTo(0, C * 0.8);
    g.bezierCurveTo(C * 0.75, C * 0.3, C * 0.55, -C * 0.7, C * 0.12, -C * 0.78);
    g.lineTo(0, -C * 0.6);
    g.lineTo(-C * 0.12, -C * 0.78);
    g.bezierCurveTo(-C * 0.55, -C * 0.7, -C * 0.75, C * 0.3, 0, C * 0.8);
    const grd = g.createLinearGradient(0, C * 0.8, 0, -C * 0.8);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(225,225,225,1)');
    g.fillStyle = grd;
    g.fill();
    g.strokeStyle = 'rgba(200,200,200,0.9)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, C * 0.6);
    g.lineTo(0, -C * 0.3);
    g.stroke();
  });
  // 5 FLAKE — snowflake
  withCell(SPRITE.FLAKE, () => {
    g.translate(C, C);
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.shadowColor = 'rgba(255,255,255,0.9)';
    g.shadowBlur = 6;
    for (let i = 0; i < 6; i++) {
      g.save();
      g.rotate((i * Math.PI) / 3);
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -C * 0.78);
      g.stroke();
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(0, -C * 0.45);
      g.lineTo(-C * 0.2, -C * 0.62);
      g.moveTo(0, -C * 0.45);
      g.lineTo(C * 0.2, -C * 0.62);
      g.stroke();
      g.restore();
    }
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, 8, 0, Math.PI * 2);
    g.fill();
  });
  // 6 PUFF — soft lumpy smoke puff with a lighter top
  withCell(SPRITE.PUFF, () => {
    const blobs = [
      [0, 6, 0.52],
      [-18, -4, 0.38],
      [17, -6, 0.4],
      [-6, -18, 0.36],
      [14, 14, 0.34],
      [-16, 14, 0.32],
    ];
    for (const [bx, by, br] of blobs) {
      const grd = g.createRadialGradient(C + bx, C + by, 0, C + bx, C + by, C * br * 1.25);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(0.55, 'rgba(250,250,250,0.7)');
      grd.addColorStop(1, 'rgba(240,240,240,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    }
    // bottom shade
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, C - 30, 0, C + 50);
    sh.addColorStop(0, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(175,178,190,0.9)');
    g.fillStyle = sh;
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
  });
  // 7 STREAK — long thin glow along +x (used by velocity-stretched sparks)
  withCell(SPRITE.STREAK, () => {
    g.translate(C, C);
    g.scale(1, 0.16);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, C * 0.95);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, C * 0.95, 0, Math.PI * 2);
    g.fill();
  });
  // 8 RING — soft ring (shockwave)
  withCell(SPRITE.RING, () => {
    const grd = g.createRadialGradient(C, C, 0, C, C, C * 0.95);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.62, 'rgba(255,255,255,0.05)');
    grd.addColorStop(0.8, 'rgba(255,255,255,1)');
    grd.addColorStop(0.88, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  });
  // 9 SQUARE — confetti (rounded rect with a slight sheen)
  withCell(SPRITE.SQUARE, () => {
    g.translate(C, C);
    const w = C * 0.62;
    const h = C * 0.9;
    g.beginPath();
    g.roundRect(-w / 2, -h / 2, w, h, 6);
    g.fillStyle = '#fff';
    g.fill();
    g.fillStyle = 'rgba(210,210,210,1)';
    g.fillRect(-w / 2, h * 0.1, w, h * 0.4);
  });
  // 10 SHARD — crystal shard with a bright edge
  withCell(SPRITE.SHARD, () => {
    g.translate(C, C);
    g.beginPath();
    g.moveTo(0, -C * 0.85);
    g.lineTo(C * 0.5, C * 0.25);
    g.lineTo(C * 0.05, C * 0.8);
    g.lineTo(-C * 0.45, C * 0.1);
    g.closePath();
    g.fillStyle = 'rgba(235,235,235,0.9)';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = '#fff';
    g.stroke();
    g.beginPath();
    g.moveTo(0, -C * 0.85);
    g.lineTo(C * 0.05, C * 0.8);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 3;
    g.stroke();
  });
  // 11 COIN — disc with rim and a cent mark (tint gold)
  withCell(SPRITE.COIN, () => {
    g.translate(C, C);
    g.beginPath();
    g.arc(0, 0, C * 0.82, 0, Math.PI * 2);
    g.fillStyle = 'rgb(190,150,60)';
    g.fill();
    g.beginPath();
    g.arc(0, 0, C * 0.66, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    g.fillStyle = 'rgb(200,160,70)';
    g.font = `900 ${Math.round(C * 1.05)}px Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('¢', 0, 4);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.ellipse(-C * 0.3, -C * 0.35, C * 0.16, C * 0.08, -0.7, 0, Math.PI * 2);
    g.fill();
  });
  // 12 FLAME — teardrop flame along +x (tail at -x)
  withCell(SPRITE.FLAME, () => {
    g.translate(C, C);
    const grd = g.createRadialGradient(C * 0.25, 0, 0, C * 0.25, 0, C * 0.75);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(C * 0.85, 0);
    g.bezierCurveTo(C * 0.8, -C * 0.55, -C * 0.2, -C * 0.4, -C * 0.9, 0);
    g.bezierCurveTo(-C * 0.2, C * 0.4, C * 0.8, C * 0.55, C * 0.85, 0);
    g.fill();
  });
  // 13 DROP — liquid droplet (round head at +x)
  withCell(SPRITE.DROP, () => {
    g.translate(C, C);
    g.beginPath();
    g.arc(C * 0.3, 0, C * 0.42, -Math.PI / 2, Math.PI / 2);
    g.quadraticCurveTo(-C * 0.3, C * 0.2, -C * 0.85, 0);
    g.quadraticCurveTo(-C * 0.3, -C * 0.2, C * 0.3, -C * 0.42);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(C * 0.38, -C * 0.14, C * 0.12, C * 0.07, 0, 0, Math.PI * 2);
    g.fill();
  });
  // 14 CHUNK — debris chunk (irregular, shaded)
  withCell(SPRITE.CHUNK, () => {
    g.translate(C, C);
    const pts = [
      [-0.62, -0.4],
      [-0.1, -0.72],
      [0.55, -0.5],
      [0.7, 0.15],
      [0.3, 0.66],
      [-0.4, 0.6],
      [-0.72, 0.1],
    ];
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * C * 0.9, y * C * 0.9) : g.moveTo(x * C * 0.9, y * C * 0.9)));
    g.closePath();
    g.fillStyle = 'rgb(150,150,150)';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = 'rgb(70,70,70)';
    g.stroke();
    g.beginPath();
    g.moveTo(-0.62 * C * 0.9, -0.4 * C * 0.9);
    g.lineTo(-0.1 * C * 0.9, -0.72 * C * 0.9);
    g.lineTo(0.55 * C * 0.9, -0.5 * C * 0.9);
    g.lineTo(0.1 * C, -0.05 * C);
    g.closePath();
    g.fillStyle = 'rgb(230,230,230)';
    g.fill();
  });
  // 15 BOLT — lightning zig-zag (vertical)
  withCell(SPRITE.BOLT, () => {
    g.translate(C, C);
    g.shadowColor = '#fff';
    g.shadowBlur = 12;
    g.beginPath();
    g.moveTo(8, -C * 0.9);
    g.lineTo(-C * 0.3, C * 0.05);
    g.lineTo(-2, C * 0.02);
    g.lineTo(-10, C * 0.9);
    g.lineTo(C * 0.32, -C * 0.12);
    g.lineTo(4, -C * 0.1);
    g.lineTo(C * 0.2, -C * 0.9);
    g.closePath();
    g.fillStyle = '#fff';
    g.fill();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // treated as linear multiplier (white = 1)
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------------------------------------
// Shader
// ------------------------------------------------------------------------------------------------
const VERT = /* glsl */ `
attribute vec4 a0; // p0.xyz, t0
attribute vec4 a1; // v0.xyz, life
attribute vec4 a2; // c0.rgb, size0
attribute vec4 a3; // c1.rgb, size1
attribute vec4 a4; // gravity, drag, floorY, stretch
attribute vec4 a5; // rot0, spin, sprite, orient
attribute vec4 a6; // additive, alpha, fadeIn, fadeOut
attribute vec4 a7; // flutter, sizeEase, intensity, colorEase

uniform float uTime;
uniform vec3 uFog; // near, far, enabled

varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;

void main() {
  float age = uTime - a0.w;
  float life = a1.w;
  float x = age / max(life, 1e-4);
  if (life <= 0.0 || x < 0.0 || x >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec4(0.0);
    return;
  }

  // --- analytic motion: dv/dt = g - k v
  float k = a4.y;
  vec3 g = vec3(0.0, -a4.x, 0.0);
  vec3 pos;
  vec3 vel;
  if (k < 0.002) {
    pos = a0.xyz + a1.xyz * age + 0.5 * g * age * age;
    vel = a1.xyz + g * age;
  } else {
    float e = exp(-k * age);
    vec3 term = g / k;
    pos = a0.xyz + term * age + (a1.xyz - term) * ((1.0 - e) / k);
    vel = term + (a1.xyz - term) * e;
  }
  if (pos.y < a4.z) { pos.y = a4.z; vel *= 0.0; }

  // --- size / colour / alpha over life
  float se = a7.y;
  float sx = se > 0.0 ? 1.0 - pow(1.0 - x, 1.0 + se) : (se < 0.0 ? pow(x, 1.0 - se) : x);
  float size = mix(a2.w, a3.w, sx);
  float ce = a7.w;
  float cx = ce > 0.0 ? 1.0 - pow(1.0 - x, 1.0 + ce) : x;
  vec3 col = mix(a2.rgb, a3.rgb, cx) * a7.z;
  float fin = max(a6.z, 1e-4);
  float alpha = a6.y * smoothstep(0.0, fin, x) * (1.0 - smoothstep(a6.w, 1.0, x));

  float rot = a5.x + a5.y * age;
  vec2 corner = position.xy;
  vec4 mv;
  float orient = a5.w;
  if (orient > 1.5) {
    // ground aligned (horizontal plane)
    float c = cos(rot), s = sin(rot);
    vec3 off = vec3(c * corner.x - s * corner.y, 0.0, s * corner.x + c * corner.y) * size;
    mv = modelViewMatrix * vec4(pos + off, 1.0);
  } else if (orient > 0.5) {
    // velocity-stretched streak (sprite u axis along the projected velocity)
    mv = modelViewMatrix * vec4(pos, 1.0);
    vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    vec2 dir = vv.xy;
    float len = length(dir);
    dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
    float L = size + len * a4.w;
    vec2 perp = vec2(-dir.y, dir.x);
    mv.xy += dir * corner.x * L + perp * corner.y * size;
  } else {
    mv = modelViewMatrix * vec4(pos, 1.0);
    float fl = a7.x > 0.0 ? max(abs(cos(a7.x * age + a5.x * 3.0)), 0.12) : 1.0;
    vec2 cr = corner * vec2(size * fl, size);
    float c = cos(rot), s = sin(rot);
    mv.xy += vec2(c * cr.x - s * cr.y, s * cr.x + c * cr.y);
  }

  // fade very near the camera (explosions in your face) and into the fog
  float depth = -mv.z;
  alpha *= smoothstep(0.4, 2.2, depth);
  if (uFog.z > 0.5) alpha *= 1.0 - 0.92 * smoothstep(uFog.x, uFog.y, depth);

  gl_Position = projectionMatrix * mv;

  float sprite = a5.z;
  vec2 cell = vec2(mod(sprite, 4.0), floor(sprite / 4.0));
  vUv = vec2((cell.x + uv.x) * 0.25, 1.0 - (cell.y + 1.0 - uv.y) * 0.25);
  vColor = vec4(col, alpha);
  vAdd = a6.x;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;

void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= a;
  gl_FragColor.a = a * (1.0 - vAdd);
}
`;

// ------------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------------
const STRIDE = 32;
const rand = Math.random;
const rr = (a, b) => a + (b - a) * rand();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const TAU = Math.PI * 2;

const _col = new THREE.Color();
const _colCache = new Map();
/** Resolve a colour option ('#hex' | number | THREE.Color | {r,g,b}) to a cached linear {r,g,b}. */
function resolveColor(c, fallback) {
  if (c === undefined || c === null) c = fallback;
  if (c && typeof c === 'object') {
    if (c.isColor) return c;
    if ('r' in c) return c;
  }
  let hit = _colCache.get(c);
  if (hit) return hit;
  try {
    if (typeof c === 'number') _col.setHex(c);
    else _col.set(c);
  } catch {
    _col.set(0xffffff);
  }
  hit = { r: _col.r, g: _col.g, b: _col.b };
  if (_colCache.size < 512) _colCache.set(c, hit);
  return hit;
}

const RAINBOW = ['#ff4d6d', '#ff9f1c', '#ffe14d', '#5ee06b', '#33c7ff', '#6a7bff', '#c86bff'].map((c) => resolveColor(c));
const CONFETTI = ['#ff3b6b', '#ffcc00', '#29d3ff', '#6cf06c', '#ff7ae0', '#ffffff', '#ff8c2a', '#7a6bff'].map((c) => resolveColor(c));
const WHITE = resolveColor('#ffffff');

// ------------------------------------------------------------------------------------------------
// Particles
// ------------------------------------------------------------------------------------------------
export class Particles {
  constructor(scene, { quality = 'high' } = {}) {
    this.scene = scene;
    this.quality = quality;
    this.capacity = quality === 'low' ? 4096 : quality === 'medium' ? 6144 : 8192;
    this.density = quality === 'low' ? 0.55 : quality === 'medium' ? 0.8 : 1;
    this.time = 0;
    this.cursor = 0;
    this.highWater = 0;
    this.emitted = 0;
    this._ranges = []; // [start, end) pairs of dirty particle indices
    this._disposed = false;

    // spawn scratch (reused, no per-emit allocation)
    this.S = {
      px: 0, py: 0, pz: 0,
      vx: 0, vy: 0, vz: 0,
      life: 1,
      c0: WHITE, c1: WHITE,
      size0: 1, size1: 1,
      gravity: 0, drag: 0, floor: -1e5, stretch: 0,
      rot: 0, spin: 0, sprite: 0, orient: 0,
      additive: 0, alpha: 1, fadeIn: 0.05, fadeOut: 0.6,
      flutter: 0, sizeEase: 0, intensity: 1, colorEase: 0,
    };
    this._v = new THREE.Vector3();

    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3)
    );
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.data = new Float32Array(this.capacity * STRIDE);
    // mark every slot dead (life = 0)
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 8; i++) {
      quad.setAttribute(`a${i}`, new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4));
    }
    quad.instanceCount = 0;
    this.geometry = quad;

    this.atlas = makeAtlas();
    this.material = new THREE.ShaderMaterial({
      name: 'SSKParticles',
      uniforms: {
        uTime: { value: 0 },
        uAtlas: { value: this.atlas },
        uFog: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'particles';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.matrixAutoUpdate = false;
    scene?.add(this.mesh);
  }

  // ----------------------------------------------------------------------------------------------
  // low level
  // ----------------------------------------------------------------------------------------------

  /** Write the spawn scratch `this.S` into the next ring-buffer slot. */
  _spawn() {
    const S = this.S;
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    if (i + 1 > this.highWater) this.highWater = i + 1;
    this.emitted++;
    const o = i * STRIDE;
    const d = this.data;
    d[o] = S.px;
    d[o + 1] = S.py;
    d[o + 2] = S.pz;
    d[o + 3] = this.time;
    d[o + 4] = S.vx;
    d[o + 5] = S.vy;
    d[o + 6] = S.vz;
    d[o + 7] = S.life;
    d[o + 8] = S.c0.r;
    d[o + 9] = S.c0.g;
    d[o + 10] = S.c0.b;
    d[o + 11] = S.size0;
    d[o + 12] = S.c1.r;
    d[o + 13] = S.c1.g;
    d[o + 14] = S.c1.b;
    d[o + 15] = S.size1;
    d[o + 16] = S.gravity;
    d[o + 17] = S.drag;
    d[o + 18] = S.floor;
    d[o + 19] = S.stretch;
    d[o + 20] = S.rot;
    d[o + 21] = S.spin;
    d[o + 22] = S.sprite;
    d[o + 23] = S.orient;
    d[o + 24] = S.additive;
    d[o + 25] = S.alpha;
    d[o + 26] = S.fadeIn;
    d[o + 27] = S.fadeOut;
    d[o + 28] = S.flutter;
    d[o + 29] = S.sizeEase;
    d[o + 30] = S.intensity;
    d[o + 31] = S.colorEase;
    // dirty range bookkeeping (contiguous runs)
    const r = this._ranges;
    const n = r.length;
    if (n > 0 && r[n - 1] === i) r[n - 1] = i + 1;
    else r.push(i, i + 1);
  }

  /** Reset the scratch to defaults. */
  _reset(sprite, life) {
    const S = this.S;
    S.vx = S.vy = S.vz = 0;
    S.life = life;
    S.c0 = WHITE;
    S.c1 = WHITE;
    S.size0 = 1;
    S.size1 = 1;
    S.gravity = 0;
    S.drag = 0;
    S.floor = -1e5;
    S.stretch = 0;
    S.rot = 0;
    S.spin = 0;
    S.sprite = sprite;
    S.orient = ORIENT_BILLBOARD;
    S.additive = 0;
    S.alpha = 1;
    S.fadeIn = 0.05;
    S.fadeOut = 0.6;
    S.flutter = 0;
    S.sizeEase = 0;
    S.intensity = 1;
    S.colorEase = 0;
    return S;
  }

  _at(p, jitter = 0) {
    const S = this.S;
    S.px = p.x + (jitter ? (rand() - 0.5) * 2 * jitter : 0);
    S.py = p.y + (jitter ? (rand() - 0.5) * 2 * jitter : 0);
    S.pz = p.z + (jitter ? (rand() - 0.5) * 2 * jitter : 0);
  }

  /** Random unit vector into this._v (optionally a hemisphere biased up). */
  _randDir(upBias = 0) {
    const v = this._v;
    const u = rand() * 2 - 1;
    const th = rand() * TAU;
    const s = Math.sqrt(1 - u * u);
    v.set(s * Math.cos(th), u, s * Math.sin(th));
    if (upBias > 0) {
      v.y = Math.abs(v.y) * (1 - upBias) + upBias * (0.4 + 0.6 * Math.abs(v.y));
      v.normalize();
    }
    return v;
  }

  _baseVel(o, scale = 1) {
    const S = this.S;
    const v = o.velocity;
    if (v) {
      S.vx = v.x * scale;
      S.vy = v.y * scale;
      S.vz = v.z * scale;
    } else S.vx = S.vy = S.vz = 0;
  }

  _count(o, def) {
    const n = o.count ?? def;
    return Math.max(n > 0 ? 1 : 0, Math.round(n * this.density));
  }

  // ----------------------------------------------------------------------------------------------
  // public API
  // ----------------------------------------------------------------------------------------------

  /**
   * Emit a burst of particles.
   * @param {string} type
   * @param {{x:number,y:number,z:number}} p world position
   * @param {object} [o] { count, color, color2, velocity: Vector3 (inherited/base), spread, size, life,
   *                       floor (y below which particles stop), dir: Vector3 (preferred direction), intensity }
   */
  emit(type, p, o = {}) {
    if (this._disposed || !p) return;
    o = o || {};
    const fn = PRESETS[type];
    if (!fn) {
      if (!this._warned) this._warned = new Set();
      if (!this._warned.has(type)) {
        this._warned.add(type);
        console.warn(`[Particles] unknown type "${type}"`);
      }
      return;
    }
    fn(this, p, o);
  }

  update(dt, camera) {
    if (this._disposed) return;
    this.time += Math.max(0, Math.min(dt || 0, 0.25));
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    const fog = this.scene?.fog;
    if (fog && fog.isFog) u.uFog.value.set(fog.near, fog.far, 1);
    else if (fog && fog.isFogExp2) u.uFog.value.set(0, 2.2 / Math.max(1e-4, fog.density), 1);
    else u.uFog.value.set(0, 1, 0);

    const r = this._ranges;
    if (r.length) {
      if (r.length > 16) {
        this.buffer.clearUpdateRanges();
        this.buffer.addUpdateRange(0, this.highWater * STRIDE);
      } else {
        for (let k = 0; k < r.length; k += 2) this.buffer.addUpdateRange(r[k] * STRIDE, (r[k + 1] - r[k]) * STRIDE);
      }
      this.buffer.needsUpdate = true;
      r.length = 0;
    }
    this.geometry.instanceCount = this.highWater;
    void camera;
  }

  /** Number of particles currently alive (debug; O(n)). */
  liveCount() {
    let n = 0;
    const d = this.data;
    for (let i = 0; i < this.highWater; i++) {
      const o = i * STRIDE;
      const age = this.time - d[o + 3];
      if (d[o + 7] > 0 && age >= 0 && age < d[o + 7]) n++;
    }
    return n;
  }

  clear() {
    for (let i = 0; i < this.capacity; i++) this.data[i * STRIDE + 7] = 0;
    this._ranges.length = 0;
    this.buffer.clearUpdateRanges();
    this.buffer.needsUpdate = true;
    this.cursor = 0;
    this.highWater = 0;
    this.geometry.instanceCount = 0;
  }

  dispose() {
    this._disposed = true;
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.atlas.dispose();
  }

  // ----------------------------------------------------------------------------------------------
  // building blocks used by presets
  // ----------------------------------------------------------------------------------------------

  _glowFlash(p, color, size, life, intensity = 2) {
    const S = this._reset(SPRITE.GLOW, life);
    this._at(p);
    S.c0 = color;
    S.c1 = color;
    S.size0 = size * 0.6;
    S.size1 = size;
    S.sizeEase = 2;
    S.additive = 1;
    S.alpha = 1;
    S.fadeIn = 0.01;
    S.fadeOut = 0.2;
    S.intensity = intensity;
    this._spawn();
  }

  _sparks(p, n, speed, c0, c1, o = {}) {
    for (let i = 0; i < n; i++) {
      const S = this._reset(SPRITE.STREAK, rr(0.3, 0.6) * (o.lifeScale ?? 1));
      this._at(p, o.jitter ?? 0.2);
      this._baseVel(o, 1);
      const d = this._randDir(o.upBias ?? 0.3);
      const s = speed * rr(0.45, 1);
      S.vx += d.x * s;
      S.vy += d.y * s;
      S.vz += d.z * s;
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = (o.size ?? 0.16) * rr(0.8, 1.2);
      S.size1 = S.size0 * 0.3;
      S.gravity = o.gravity ?? 16;
      S.drag = o.drag ?? 1.6;
      S.stretch = o.stretch ?? 0.045;
      S.orient = ORIENT_STRETCH;
      S.additive = 1;
      S.fadeIn = 0.01;
      S.fadeOut = 0.55;
      S.intensity = o.intensity ?? 2.2;
      S.floor = o.floor ?? -1e5;
      this._spawn();
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Presets
// ------------------------------------------------------------------------------------------------
const C_SPARK0 = resolveColor('#fff1b3');
const C_SPARK1 = resolveColor('#ff8a1f');
const C_FIRE0 = resolveColor('#fff4c2');
const C_FIRE1 = resolveColor('#ff6a1a');
const C_FIRE2 = resolveColor('#ff3b0f');
const C_SMOKE0 = resolveColor('#8d9199');
const C_SMOKE1 = resolveColor('#4a4d55');
const C_SMOKE_DARK = resolveColor('#2d2c30');
const C_DEBRIS0 = resolveColor('#4a3f36');
const C_DEBRIS1 = resolveColor('#6d6660');
const C_GOLD0 = resolveColor('#ffe066');
const C_GOLD1 = resolveColor('#ffb81f');
const C_STARY = resolveColor('#ffe45c');
const C_STARO = resolveColor('#ffb13b');
const C_WATER0 = resolveColor('#d9f3ff');
const C_WATER1 = resolveColor('#7fd0ff');
const C_PINK0 = resolveColor('#ffd0e3');
const C_PINK1 = resolveColor('#ff8fbf');
const C_EMBER0 = resolveColor('#ffd27a');
const C_EMBER1 = resolveColor('#ff3d00');
const C_ZAP0 = resolveColor('#e8fbff');
const C_ZAP1 = resolveColor('#35c8ff');
const C_DUST = resolveColor('#d9c7a3');
const C_NOODLE = resolveColor('#ffe08a');

// `size` is an ABSOLUTE world size (≈ particle diameter) for simple types; for composite bursts (explosion,
// itemBoxBurst, zap, halo) it is the effect radius; for ring it is the final diameter.
const PRESETS = {
  // ----- small sparks (drift sparks, wall scrapes). Streaks stretched along velocity, additive.
  spark(P, p, o) {
    const n = P._count(o, 6);
    const c0 = resolveColor(o.color, C_SPARK0);
    const c1 = resolveColor(o.color2 ?? o.color, C_SPARK1);
    const spread = o.spread ?? 7;
    const size = o.size ?? 0.16;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.STREAK, (o.life ?? 0.38) * rr(0.65, 1.25));
      P._at(p, 0.08);
      P._baseVel(o);
      const d = P._randDir(0.4);
      const s = spread * rr(0.4, 1);
      S.vx += d.x * s;
      S.vy += d.y * s;
      S.vz += d.z * s;
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = size * rr(0.8, 1.3);
      S.size1 = S.size0 * 0.25;
      S.gravity = 14;
      S.drag = 1.5;
      S.stretch = 0.04;
      S.orient = ORIENT_STRETCH;
      S.additive = 1;
      S.fadeIn = 0.01;
      S.fadeOut = 0.5;
      S.intensity = 2.2;
      S.floor = o.floor ?? -1e5;
      P._spawn();
    }
  },

  // ----- off-road / landing dust (size = grown puff size)
  dust(P, p, o) {
    const n = P._count(o, 3);
    const c = resolveColor(o.color, C_DUST);
    const c2 = resolveColor(o.color2 ?? o.color, C_DUST);
    const spread = o.spread ?? 1.6;
    const size = o.size ?? 1.4;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.PUFF, (o.life ?? 0.8) * rr(0.7, 1.2));
      P._at(p, 0.25);
      P._baseVel(o, 0.35);
      const d = P._randDir(0.6);
      S.vx += d.x * spread;
      S.vy += d.y * spread * 0.6 + 0.8;
      S.vz += d.z * spread;
      S.c0 = c;
      S.c1 = c2;
      S.size0 = 0.35 * size * rr(0.8, 1.2);
      S.size1 = 1.25 * size * rr(0.8, 1.2);
      S.sizeEase = 1.5;
      S.gravity = -0.4;
      S.drag = 3;
      S.rot = rand() * TAU;
      S.spin = rr(-1.5, 1.5);
      S.alpha = 0.6;
      S.fadeIn = 0.08;
      S.fadeOut = 0.35;
      P._spawn();
    }
  },

  // ----- rising smoke puffs (size = grown puff size)
  smoke(P, p, o) {
    const n = P._count(o, 4);
    const c0 = resolveColor(o.color, C_SMOKE0);
    const c1 = resolveColor(o.color2 ?? o.color, C_SMOKE1);
    const spread = o.spread ?? 1.4;
    const size = o.size ?? 2.2;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.PUFF, (o.life ?? 1.7) * rr(0.7, 1.25));
      P._at(p, 0.15 * size);
      P._baseVel(o, 0.3);
      const d = P._randDir(0.5);
      S.vx += d.x * spread;
      S.vy += 1.2 + d.y * spread;
      S.vz += d.z * spread;
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = 0.4 * size * rr(0.8, 1.2);
      S.size1 = 1.4 * size * rr(0.8, 1.2);
      S.sizeEase = 1.2;
      S.gravity = -1.2;
      S.drag = 1.3;
      S.rot = rand() * TAU;
      S.spin = rr(-0.8, 0.8);
      S.alpha = 0.55;
      S.fadeIn = 0.1;
      S.fadeOut = 0.4;
      P._spawn();
    }
  },

  // ----- exhaust boost flames (velocity = exhaust direction * speed + kart velocity; size = flame size)
  boostFlame(P, p, o) {
    const n = P._count(o, 2);
    const c0 = resolveColor(o.color, C_FIRE0);
    const c1 = resolveColor(o.color2, C_FIRE2);
    const spread = o.spread ?? 1.2;
    const size = o.size ?? 0.6;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.FLAME, (o.life ?? 0.18) * rr(0.7, 1.3));
      P._at(p, 0.06);
      P._baseVel(o);
      const d = P._randDir(0);
      S.vx += d.x * spread;
      S.vy += d.y * spread + 0.6;
      S.vz += d.z * spread;
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = size * rr(0.85, 1.2);
      S.size1 = 0.2 * size;
      S.sizeEase = -0.3;
      S.drag = 3.5;
      S.stretch = 0.03;
      S.orient = ORIENT_STRETCH;
      S.additive = 0.9;
      S.fadeIn = 0.02;
      S.fadeOut = 0.45;
      S.intensity = 2.4;
      S.colorEase = 0.5;
      P._spawn();
    }
    // a hot core glow now and then
    if (rand() < 0.5) {
      const S = P._reset(SPRITE.GLOW, 0.08);
      P._at(p);
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = 1.6 * size;
      S.size1 = 0.9 * size;
      S.additive = 1;
      S.alpha = 0.7;
      S.fadeIn = 0.01;
      S.fadeOut = 0.3;
      S.intensity = 2;
      P._spawn();
    }
  },

  // ----- big explosion (size = blast radius): flash + fireball + fire->smoke + smoke column + debris + sparks +
  //       embers + ground shockwave ring
  explosion(P, p, o) {
    const radius = o.size ?? 4;
    const s = radius / 4;
    const dens = o.count && o.count > 1 ? clamp01(o.count / 60) + 0.3 : 1;
    const floor = o.floor ?? p.y - 0.15;
    const cHot = resolveColor(o.color, C_FIRE0);
    const cMid = resolveColor(o.color2, C_FIRE1);
    const n = (k) => Math.max(1, Math.round(k * dens * P.density));
    // flash
    P._glowFlash(p, resolveColor('#fffbe6'), 9 * s, 0.16, 3);
    // fireball (additive glows)
    for (let i = 0; i < n(16); i++) {
      const S = P._reset(SPRITE.GLOW, rr(0.35, 0.7));
      P._at(p, 0.6 * s);
      S.py += 0.6 * s;
      const d = P._randDir(0.55);
      const sp = rr(3, 8) * s;
      S.vx = d.x * sp;
      S.vy = d.y * sp + 2;
      S.vz = d.z * sp;
      S.c0 = cHot;
      S.c1 = cMid;
      S.colorEase = 1.5;
      S.size0 = 1.6 * s * rr(0.8, 1.2);
      S.size1 = 3.6 * s * rr(0.8, 1.2);
      S.sizeEase = 2.5;
      S.gravity = -3;
      S.drag = 4;
      S.additive = 0.85;
      S.fadeIn = 0.02;
      S.fadeOut = 0.35;
      S.intensity = 2.4;
      P._spawn();
    }
    // fire turning into smoke (alpha puffs)
    for (let i = 0; i < n(12); i++) {
      const S = P._reset(SPRITE.PUFF, rr(0.7, 1.1));
      P._at(p, 0.8 * s);
      S.py += 0.8 * s;
      const d = P._randDir(0.6);
      const sp = rr(3, 7) * s;
      S.vx = d.x * sp;
      S.vy = d.y * sp + 3;
      S.vz = d.z * sp;
      S.c0 = o.color2 ? cMid : C_FIRE1;
      S.c1 = C_SMOKE_DARK;
      S.colorEase = 2.5;
      S.size0 = 1.4 * s;
      S.size1 = 4.0 * s * rr(0.8, 1.2);
      S.sizeEase = 2;
      S.gravity = -2.5;
      S.drag = 2.5;
      S.rot = rand() * TAU;
      S.spin = rr(-1, 1);
      S.additive = 0.35;
      S.alpha = 0.95;
      S.fadeIn = 0.05;
      S.fadeOut = 0.5;
      S.intensity = 1.3;
      P._spawn();
    }
    // lingering smoke column
    for (let i = 0; i < n(12); i++) {
      const S = P._reset(SPRITE.PUFF, rr(1.5, 2.6));
      P._at(p, 1.2 * s);
      S.py += 1 * s;
      const d = P._randDir(0.7);
      const sp = rr(1.5, 4) * s;
      S.vx = d.x * sp;
      S.vy = d.y * sp + 2.5;
      S.vz = d.z * sp;
      S.c0 = C_SMOKE0;
      S.c1 = C_SMOKE1;
      S.size0 = 1.8 * s;
      S.size1 = 5.2 * s * rr(0.8, 1.2);
      S.sizeEase = 1.2;
      S.gravity = -1.6;
      S.drag = 1.4;
      S.rot = rand() * TAU;
      S.spin = rr(-0.6, 0.6);
      S.alpha = 0.55;
      S.fadeIn = 0.25;
      S.fadeOut = 0.45;
      P._spawn();
    }
    // debris chunks
    for (let i = 0; i < n(12); i++) {
      const S = P._reset(SPRITE.CHUNK, rr(1.1, 1.8));
      P._at(p, 0.4 * s);
      S.py += 0.3;
      const d = P._randDir(0.75);
      const sp = rr(7, 15) * Math.sqrt(s);
      S.vx = d.x * sp;
      S.vy = d.y * sp + 4;
      S.vz = d.z * sp;
      S.c0 = C_DEBRIS0;
      S.c1 = C_DEBRIS1;
      S.size0 = S.size1 = rr(0.22, 0.5) * Math.sqrt(s);
      S.gravity = 30;
      S.drag = 0.6;
      S.floor = floor;
      S.rot = rand() * TAU;
      S.spin = rr(-12, 12);
      S.fadeIn = 0.01;
      S.fadeOut = 0.75;
      P._spawn();
    }
    // sparks
    P._sparks(p, n(22), 22 * Math.sqrt(s), C_SPARK0, C_SPARK1, { size: 0.2, upBias: 0.4, floor, jitter: 0.5 });
    // embers drifting up
    for (let i = 0; i < n(10); i++) {
      const S = P._reset(SPRITE.DOT, rr(1.0, 2.0));
      P._at(p, 1.5 * s);
      S.py += 0.5 * s;
      S.vx = rr(-2, 2);
      S.vy = rr(2, 6);
      S.vz = rr(-2, 2);
      S.c0 = C_EMBER0;
      S.c1 = C_EMBER1;
      S.size0 = 0.14;
      S.size1 = 0.04;
      S.gravity = -1;
      S.drag = 1;
      S.additive = 1;
      S.intensity = 2.5;
      S.fadeOut = 0.5;
      P._spawn();
    }
    // ground shockwave ring + a billboard ring
    {
      const S = P._reset(SPRITE.RING, 0.5);
      P._at(p);
      S.py = floor + 0.12;
      S.c0 = resolveColor('#fff3d0');
      S.c1 = resolveColor(o.color2 ?? '#ffb347');
      S.size0 = 1.5 * s;
      S.size1 = radius * 2.8;
      S.sizeEase = 2.2;
      S.orient = ORIENT_GROUND;
      S.additive = 0.8;
      S.alpha = 1;
      S.fadeIn = 0.01;
      S.fadeOut = 0.25;
      S.intensity = 1.8;
      P._spawn();
      const R = P._reset(SPRITE.RING, 0.32);
      P._at(p);
      R.py += 1.0 * s;
      R.c0 = R.c1 = WHITE;
      R.size0 = 2 * s;
      R.size1 = radius * 2.2;
      R.sizeEase = 2;
      R.additive = 1;
      R.alpha = 0.6;
      R.fadeIn = 0.01;
      R.fadeOut = 0.1;
      R.intensity = 1.2;
      P._spawn();
    }
  },

  // ----- celebration confetti (size = piece size)
  confetti(P, p, o) {
    const n = P._count(o, 40);
    const spread = o.spread ?? 9;
    const size = o.size ?? 0.32;
    const custom = o.color ? [resolveColor(o.color), resolveColor(o.color2 ?? o.color)] : null;
    for (let i = 0; i < n; i++) {
      const S = P._reset(i % 3 === 0 ? SPRITE.PETAL : SPRITE.SQUARE, (o.life ?? 3.2) * rr(0.75, 1.2));
      P._at(p, 0.4);
      P._baseVel(o);
      const d = P._randDir(0.8);
      const sp = spread * rr(0.4, 1);
      S.vx += d.x * sp;
      S.vy += d.y * sp;
      S.vz += d.z * sp;
      const c = custom ? custom[i % 2] : CONFETTI[(rand() * CONFETTI.length) | 0];
      S.c0 = c;
      S.c1 = c;
      S.size0 = S.size1 = size * rr(0.8, 1.2);
      S.gravity = 7;
      S.drag = 2.4;
      S.rot = rand() * TAU;
      S.spin = rr(-6, 6);
      S.flutter = rr(6, 14);
      S.fadeIn = 0.01;
      S.fadeOut = 0.85;
      S.floor = o.floor ?? -1e5;
      P._spawn();
    }
  },

  // ----- coin pickup: spinning golden coins popping up + sparkle (size = coin size)
  coin(P, p, o) {
    const n = P._count(o, 5);
    const c0 = resolveColor(o.color, C_GOLD0);
    const c1 = resolveColor(o.color2 ?? o.color, C_GOLD1);
    const spread = o.spread ?? 3;
    const size = o.size ?? 0.5;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.COIN, (o.life ?? 0.75) * rr(0.8, 1.2));
      P._at(p, 0.15);
      P._baseVel(o, 0.8);
      const d = P._randDir(0.9);
      S.vx += d.x * spread;
      S.vy += 6 + d.y * spread;
      S.vz += d.z * spread;
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = S.size1 = size;
      S.gravity = 20;
      S.drag = 0.6;
      S.flutter = rr(12, 18);
      S.fadeIn = 0.01;
      S.fadeOut = 0.7;
      S.intensity = 1.25;
      S.floor = o.floor ?? p.y - 0.8;
      P._spawn();
    }
    _sub.velocity = o.velocity;
    _sub.count = 2;
    _sub.color = '#fff6c8';
    _sub.spread = 1.2;
    _sub.size = 1.3 * size;
    PRESETS.star(P, p, _sub);
  },

  // ----- liquid splash (water, ramen broth with color option; size = droplet size)
  splash(P, p, o) {
    const n = P._count(o, 16);
    const c0 = resolveColor(o.color, C_WATER0);
    const c1 = resolveColor(o.color2 ?? o.color, C_WATER1);
    const spread = o.spread ?? 5;
    const size = o.size ?? 0.32;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.DROP, (o.life ?? 0.7) * rr(0.7, 1.2));
      P._at(p, 0.3);
      P._baseVel(o, 0.5);
      const d = P._randDir(0.7);
      const sp = spread * rr(0.5, 1.2);
      S.vx += d.x * sp;
      S.vy += 5 + d.y * sp;
      S.vz += d.z * sp;
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = size * rr(0.8, 1.2);
      S.size1 = 0.4 * size;
      S.gravity = 22;
      S.drag = 0.8;
      S.stretch = 0.035;
      S.orient = ORIENT_STRETCH;
      S.alpha = 0.95;
      S.fadeIn = 0.01;
      S.fadeOut = 0.7;
      S.floor = o.floor ?? p.y - 1;
      S.intensity = 1.1;
      P._spawn();
    }
    // mist
    for (let i = 0; i < Math.ceil(n / 4); i++) {
      const S = P._reset(SPRITE.PUFF, 0.55);
      P._at(p, 0.4);
      const d = P._randDir(0.5);
      S.vx = d.x * 2;
      S.vy = 1.5 + d.y;
      S.vz = d.z * 2;
      S.c0 = S.c1 = c0;
      S.size0 = 1.8 * size;
      S.size1 = 5.5 * size;
      S.sizeEase = 2;
      S.drag = 2.5;
      S.alpha = 0.45;
      S.fadeOut = 0.3;
      P._spawn();
    }
  },

  // ----- weather (size = flake / petal size; `area` jitters the spawn position)
  snow(P, p, o) {
    const n = P._count(o, 1);
    const c = resolveColor(o.color, WHITE);
    const spread = o.spread ?? 0.6;
    const size = o.size ?? 0.22;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.FLAKE, (o.life ?? 4) * rr(0.8, 1.2));
      P._at(p, o.area ?? 0);
      P._baseVel(o);
      S.vx += rr(-spread, spread);
      S.vy += -1.4 + rr(-0.3, 0.3);
      S.vz += rr(-spread, spread);
      S.c0 = S.c1 = c;
      S.size0 = S.size1 = size * rr(0.65, 1.35);
      S.rot = rand() * TAU;
      S.spin = rr(-1.5, 1.5);
      S.alpha = 0.95;
      S.fadeIn = 0.12;
      S.fadeOut = 0.8;
      S.floor = o.floor ?? -1e5;
      P._spawn();
    }
  },

  petal(P, p, o) {
    const n = P._count(o, 1);
    const c0 = resolveColor(o.color, C_PINK0);
    const c1 = resolveColor(o.color2 ?? o.color, C_PINK1);
    const spread = o.spread ?? 1;
    const size = o.size ?? 0.28;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.PETAL, (o.life ?? 4.5) * rr(0.8, 1.2));
      P._at(p, o.area ?? 0);
      P._baseVel(o);
      S.vx += rr(-spread, spread) + 0.8;
      S.vy += -1.1 + rr(-0.3, 0.3);
      S.vz += rr(-spread, spread);
      S.c0 = c0;
      S.c1 = rand() < 0.5 ? c0 : c1;
      S.size0 = S.size1 = size * rr(0.8, 1.2);
      S.rot = rand() * TAU;
      S.spin = rr(-2.5, 2.5);
      S.flutter = rr(2, 5);
      S.fadeIn = 0.1;
      S.fadeOut = 0.8;
      S.floor = o.floor ?? -1e5;
      P._spawn();
    }
  },

  // ----- glowing embers (size = ember size at birth)
  ember(P, p, o) {
    const n = P._count(o, 1);
    const c0 = resolveColor(o.color, C_EMBER0);
    const c1 = resolveColor(o.color2 ?? o.color, C_EMBER1);
    const spread = o.spread ?? 1;
    const size = o.size ?? 0.16;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.DOT, (o.life ?? 1.6) * rr(0.7, 1.3));
      P._at(p, o.area ?? 0.2);
      P._baseVel(o);
      S.vx += rr(-spread, spread);
      S.vy += rr(1, 2.5);
      S.vz += rr(-spread, spread);
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = size * rr(0.7, 1.3);
      S.size1 = 0.3 * size;
      S.gravity = o.velocity ? 6 : -0.8;
      S.drag = 0.7;
      S.additive = 1;
      S.intensity = 2.6;
      S.fadeIn = 0.1;
      S.fadeOut = 0.6;
      P._spawn();
    }
  },

  // ----- twinkly sparkle (halo, coin shine, item get; size = sparkle size)
  star(P, p, o) {
    const n = P._count(o, 1);
    const c0 = resolveColor(o.color, '#fff7c2');
    const c1 = resolveColor(o.color2 ?? o.color, '#fff7c2');
    const spread = o.spread ?? 1.2;
    const size = o.size ?? 0.55;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.TWINKLE, (o.life ?? 0.5) * rr(0.7, 1.3));
      P._at(p, o.area ?? 0.2);
      P._baseVel(o);
      const d = P._randDir(0.3);
      S.vx += d.x * spread;
      S.vy += d.y * spread;
      S.vz += d.z * spread;
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = size * rr(0.7, 1.3);
      S.size1 = 0;
      S.sizeEase = -0.6;
      S.rot = rand() * TAU;
      S.spin = rr(-2, 2);
      S.drag = 2;
      S.additive = 1;
      S.intensity = 2;
      S.fadeIn = 0.15;
      S.fadeOut = 0.7;
      P._spawn();
    }
  },

  // ----- cartoon stars circling out of a hit kart (size = star size)
  hitStars(P, p, o) {
    const n = P._count(o, 7);
    const c0 = resolveColor(o.color, C_STARY);
    const c1 = resolveColor(o.color2, C_STARO);
    const spread = o.spread ?? 4.5;
    const size = o.size ?? 0.6;
    const phase = rand() * TAU;
    P._glowFlash(p, WHITE, 5 * size, 0.14, 2);
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.STAR, (o.life ?? 0.95) * rr(0.85, 1.15));
      P._at(p, 0.1);
      P._baseVel(o, 0.6);
      const a = phase + (i / n) * TAU;
      S.vx += Math.cos(a) * spread;
      S.vy += 5.5 + rr(-1, 1.5);
      S.vz += Math.sin(a) * spread;
      S.c0 = S.c1 = i % 3 === 2 ? c1 : c0;
      S.size0 = size * rr(0.9, 1.25);
      S.size1 = 0.5 * size;
      S.sizeEase = -1;
      S.gravity = 11;
      S.drag = 1.6;
      S.rot = rand() * TAU;
      S.spin = rr(5, 9) * (rand() < 0.5 ? -1 : 1);
      S.fadeIn = 0.01;
      S.fadeOut = 0.75;
      S.intensity = 1.15;
      P._spawn();
    }
    P._sparks(p, Math.ceil(n * 0.8), 9, WHITE, c0, { size: 0.13, upBias: 0.3, velocity: o.velocity });
  },

  // ----- item box shatter: rainbow shards + flash + twinkles (size = burst radius, box ≈ 1.5)
  itemBoxBurst(P, p, o) {
    const n = P._count(o, 24);
    const spread = o.spread ?? 9;
    const size = (o.size ?? 1.5) / 1.5;
    P._glowFlash(p, WHITE, 4.2 * size, 0.2, 2.2);
    const hue0 = (rand() * RAINBOW.length) | 0;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.SHARD, (o.life ?? 0.9) * rr(0.7, 1.2));
      P._at(p, 0.5 * size);
      P._baseVel(o, 0.55);
      const d = P._randDir(0.35);
      const sp = spread * rr(0.35, 1);
      S.vx += d.x * sp;
      S.vy += d.y * sp + 2.5;
      S.vz += d.z * sp;
      const c = RAINBOW[(hue0 + i) % RAINBOW.length];
      S.c0 = WHITE;
      S.c1 = c;
      S.colorEase = 3;
      S.size0 = 0.55 * size * rr(0.7, 1.3);
      S.size1 = 0.2 * size;
      S.gravity = 13;
      S.drag = 1.8;
      S.rot = rand() * TAU;
      S.spin = rr(-10, 10);
      S.flutter = rr(6, 14);
      S.additive = 0.4;
      S.alpha = 0.95;
      S.fadeIn = 0.01;
      S.fadeOut = 0.6;
      S.intensity = 1.4;
      P._spawn();
    }
    for (let i = 0; i < Math.ceil(n / 3); i++) {
      const S = P._reset(SPRITE.TWINKLE, rr(0.35, 0.6));
      P._at(p, 0.9 * size);
      P._baseVel(o, 0.5);
      const d = P._randDir(0.3);
      S.vx += d.x * 3;
      S.vy += d.y * 3 + 1;
      S.vz += d.z * 3;
      S.c0 = S.c1 = RAINBOW[(hue0 + i * 2) % RAINBOW.length];
      S.size0 = 0.8 * size;
      S.size1 = 0;
      S.sizeEase = -0.5;
      S.additive = 1;
      S.intensity = 2.2;
      S.rot = rand() * TAU;
      S.drag = 2;
      P._spawn();
    }
    // expanding billboard ring
    const R = P._reset(SPRITE.RING, 0.3);
    P._at(p);
    R.c0 = WHITE;
    R.c1 = RAINBOW[hue0];
    R.size0 = 1.2 * size;
    R.size1 = 4.5 * size;
    R.sizeEase = 2;
    R.additive = 1;
    R.alpha = 0.8;
    R.fadeIn = 0.01;
    R.fadeOut = 0.2;
    R.intensity = 1.6;
    P._spawn();
  },

  // ----- shockwave ring (ground aligned by default; { billboard: true } faces the camera). size = final diameter
  ring(P, p, o) {
    const size = o.size ?? 6;
    const S = P._reset(SPRITE.RING, o.life ?? 0.45);
    P._at(p);
    S.py += o.billboard ? 0 : 0.1;
    const c = resolveColor(o.color, WHITE);
    S.c0 = c;
    S.c1 = resolveColor(o.color2 ?? o.color, WHITE);
    S.size0 = size * 0.15;
    S.size1 = size;
    S.sizeEase = 2;
    S.orient = o.billboard ? ORIENT_BILLBOARD : ORIENT_GROUND;
    S.additive = o.additive ?? 0.9;
    S.alpha = 1;
    S.fadeIn = 0.01;
    S.fadeOut = 0.3;
    S.intensity = o.intensity ?? 1.6;
    P._spawn();
  },

  // ======== extras ========

  /** single soft glow (optionally moving). size = diameter */
  glow(P, p, o) {
    const n = P._count(o, 1);
    const c0 = resolveColor(o.color, WHITE);
    const c1 = resolveColor(o.color2 ?? o.color, c0);
    const size = o.size ?? 1;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.GLOW, o.life ?? 0.3);
      P._at(p, o.spread ? o.spread * 0.2 : 0);
      P._baseVel(o);
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = size;
      S.size1 = size * (o.endScale ?? 0.4);
      S.additive = o.additive ?? 1;
      S.alpha = o.alpha ?? 0.9;
      S.fadeIn = 0.02;
      S.fadeOut = 0.3;
      S.intensity = o.intensity ?? 1.8;
      S.drag = 2;
      P._spawn();
    }
  },

  /** bright flash (size = diameter) */
  flash(P, p, o) {
    P._glowFlash(p, resolveColor(o.color, WHITE), o.size ?? 5, o.life ?? 0.18, o.intensity ?? 2.5);
  },

  /** projectile trails: glowing blobs left in place that shrink (size = diameter) */
  trail(P, p, o) {
    const n = P._count(o, 1);
    const c0 = resolveColor(o.color, WHITE);
    const c1 = resolveColor(o.color2 ?? o.color, c0);
    const size = o.size ?? 0.6;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.GLOW, (o.life ?? 0.35) * rr(0.85, 1.15));
      P._at(p, o.spread ?? 0.05);
      P._baseVel(o);
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = size;
      S.size1 = size * 0.15;
      S.additive = 1;
      S.alpha = o.alpha ?? 0.75;
      S.fadeIn = 0.01;
      S.fadeOut = 0.2;
      S.intensity = o.intensity ?? 1.8;
      S.drag = 3;
      P._spawn();
    }
  },

  /** small grey smoke trail puffs (missiles). size = grown puff size */
  smokeTrail(P, p, o) {
    const n = P._count(o, 1);
    const c0 = resolveColor(o.color, '#e9ecf2');
    const c1 = resolveColor(o.color2, '#9aa0aa');
    const size = o.size ?? 1;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.PUFF, (o.life ?? 0.7) * rr(0.8, 1.2));
      P._at(p, 0.08);
      P._baseVel(o);
      S.vx += rr(-0.4, 0.4);
      S.vy += rr(0.2, 0.9);
      S.vz += rr(-0.4, 0.4);
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = 0.3 * size;
      S.size1 = 1.1 * size;
      S.sizeEase = 1.5;
      S.drag = 2.5;
      S.rot = rand() * TAU;
      S.spin = rr(-1, 1);
      S.alpha = o.alpha ?? 0.55;
      S.fadeIn = 0.05;
      S.fadeOut = 0.3;
      P._spawn();
    }
  },

  /** tumbling debris chunks (size = chunk size) */
  debris(P, p, o) {
    const n = P._count(o, 8);
    const c0 = resolveColor(o.color, C_DEBRIS0);
    const c1 = resolveColor(o.color2 ?? o.color, C_DEBRIS1);
    const spread = o.spread ?? 8;
    const size = o.size ?? 0.3;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.CHUNK, (o.life ?? 1.3) * rr(0.8, 1.2));
      P._at(p, 0.3);
      P._baseVel(o, 0.5);
      const d = P._randDir(0.7);
      const sp = spread * rr(0.4, 1);
      S.vx += d.x * sp;
      S.vy += d.y * sp + 3;
      S.vz += d.z * sp;
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = S.size1 = size * rr(0.7, 1.3);
      S.gravity = 28;
      S.drag = 0.6;
      S.floor = o.floor ?? p.y - 0.5;
      S.rot = rand() * TAU;
      S.spin = rr(-12, 12);
      S.fadeOut = 0.75;
      P._spawn();
    }
  },

  /** electric zap (Shittim Tablet): blue sparks + bolt sprites + flash. size = radius */
  zap(P, p, o) {
    const size = o.size ?? 1.2;
    const c0 = resolveColor(o.color, C_ZAP0);
    const c1 = resolveColor(o.color2, C_ZAP1);
    P._glowFlash(p, c1, 3.8 * size, 0.25, 2.4);
    P._sparks(p, P._count(o, 16), 10 * size, c0, c1, { size: 0.16, upBias: 0.2, gravity: 4, drag: 3, stretch: 0.05, jitter: 0.6 });
    for (let i = 0; i < 4; i++) {
      const S = P._reset(SPRITE.BOLT, rr(0.12, 0.22));
      P._at(p, 0.8 * size);
      S.py += 0.5;
      S.c0 = c0;
      S.c1 = c1;
      S.size0 = S.size1 = rr(1.0, 1.7) * size;
      S.rot = rr(-0.6, 0.6);
      S.additive = 1;
      S.intensity = 2.6;
      S.fadeIn = 0.01;
      S.fadeOut = 0.5;
      P._spawn();
    }
  },

  /** yellow noodle strands (ramen splat). size = strand width */
  noodle(P, p, o) {
    const n = P._count(o, 10);
    const c0 = resolveColor(o.color, C_NOODLE);
    const size = o.size ?? 0.22;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.STREAK, rr(0.6, 0.9));
      P._at(p, 0.3);
      P._baseVel(o, 0.4);
      const d = P._randDir(0.7);
      const sp = rr(3, 7);
      S.vx += d.x * sp;
      S.vy += d.y * sp + 4;
      S.vz += d.z * sp;
      S.c0 = S.c1 = c0;
      S.size0 = S.size1 = size;
      S.gravity = 20;
      S.drag = 1;
      S.stretch = 0.09;
      S.orient = ORIENT_STRETCH;
      S.floor = o.floor ?? p.y - 0.6;
      S.fadeOut = 0.7;
      S.intensity = 1.1;
      P._spawn();
    }
  },

  /** small white poof (item destroyed, pickup vanish). size = grown puff size */
  puff(P, p, o) {
    const n = P._count(o, 6);
    const c = resolveColor(o.color, WHITE);
    const size = o.size ?? 1.3;
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.PUFF, rr(0.35, 0.55));
      P._at(p, 0.15 * size);
      P._baseVel(o, 0.3);
      const d = P._randDir(0.3);
      S.vx += d.x * 2.3 * size;
      S.vy += d.y * 2.3 * size + 0.5;
      S.vz += d.z * 2.3 * size;
      S.c0 = S.c1 = c;
      S.size0 = 0.4 * size;
      S.size1 = size;
      S.sizeEase = 2;
      S.drag = 5;
      S.alpha = 0.85;
      S.rot = rand() * TAU;
      S.fadeOut = 0.3;
      P._spawn();
    }
  },

  /** golden / rainbow aura sparkle around an invincible kart. size = radius around p */
  halo(P, p, o) {
    const n = P._count(o, 2);
    const size = o.size ?? 1.2;
    for (let i = 0; i < n; i++) {
      const tw = (i + P.emitted) % 2 === 1;
      const S = P._reset(tw ? SPRITE.TWINKLE : SPRITE.GLOW, rr(0.35, 0.6));
      const a = rand() * TAU;
      const r = rr(0.75, 1.15) * size;
      S.px = p.x + Math.cos(a) * r;
      S.py = p.y + rr(0.15, 1.5) * size;
      S.pz = p.z + Math.sin(a) * r;
      P._baseVel(o, 0.9);
      S.vy += rr(0.8, 2);
      const c = RAINBOW[(rand() * RAINBOW.length) | 0];
      S.c0 = resolveColor(o.color, '#fff4b8');
      S.c1 = o.color ? S.c0 : c;
      S.size0 = (tw ? 0.5 : 0.35) * size;
      S.size1 = 0;
      S.sizeEase = -0.5;
      S.rot = rand() * TAU;
      S.spin = rr(-3, 3);
      S.drag = 1;
      S.additive = 1;
      S.intensity = 2.2;
      S.fadeIn = 0.15;
      S.fadeOut = 0.6;
      P._spawn();
    }
  },

  /** speed line streak (boost feel around a kart). size = width */
  speedLine(P, p, o) {
    const n = P._count(o, 1);
    const c = resolveColor(o.color, WHITE);
    for (let i = 0; i < n; i++) {
      const S = P._reset(SPRITE.STREAK, o.life ?? 0.2);
      P._at(p, o.spread ?? 1);
      P._baseVel(o);
      S.c0 = S.c1 = c;
      S.size0 = S.size1 = o.size ?? 0.1;
      S.stretch = 0.08;
      S.orient = ORIENT_STRETCH;
      S.additive = 1;
      S.alpha = 0.5;
      S.intensity = 1.5;
      S.fadeIn = 0.2;
      S.fadeOut = 0.5;
      P._spawn();
    }
  },
};
const _sub = { count: 1 };
PRESETS.sparkle = PRESETS.star;
PRESETS.twinkle = PRESETS.star;
PRESETS.shockwave = PRESETS.ring;
PRESETS.fire = PRESETS.boostFlame;
PRESETS.leaf = PRESETS.petal;
PRESETS.leaves = PRESETS.petal;
PRESETS.petals = PRESETS.petal;
PRESETS.embers = PRESETS.ember;
PRESETS.sparkles = PRESETS.star;

export const PARTICLE_TYPES = Object.keys(PRESETS);
export default Particles;
