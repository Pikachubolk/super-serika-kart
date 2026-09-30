// Procedural item models (owner: items agent).
//
// Every model is ONE merged BufferGeometry with baked vertex colours and a per-vertex emissive factor (`aEmit`),
// rendered with ONE shared toon material (rim light + emissive patch). Geometries are built once per ItemModels
// instance and shared by every copy; Object3Ds are pooled per kind (acquire/release) so firing items does not
// allocate after warm-up.
//
// Kinds: ramen, bullet, missile, grenade, seeker, decoy, can, card, bag, tablet (+ 'rotor' part).
// Also: item-box shell/qmark shaders, halo ring, blob shadow, glow sprites, aura, seeker reticle, lightning bolts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  getQuestionTexture,
  getShadowTexture,
  getGlowTexture,
  getReticleTexture,
  getAuraTexture,
  getCoinTexture,
} from './textures.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// ------------------------------------------------------------------------------------------------
// Geometry builder: merge parts with vertex colours + emissive factor
// ------------------------------------------------------------------------------------------------
class GeoBuilder {
  constructor() {
    this.parts = [];
  }

  /**
   * @param {THREE.BufferGeometry} geo  (consumed)
   * @param {string|number|function} color  hex, or fn(x,y,z,nx,ny,nz) -> hex | [hex, emit]
   * @param {object} o { emit, pos:[x,y,z], rot:[x,y,z], scale:[x,y,z]|number }
   */
  add(geo, color, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const n = pos.count;
    const col = new Float32Array(n * 3);
    const em = new Float32Array(n);
    const baseEmit = o.emit ?? 0;
    if (typeof color === 'function') {
      // flat per-face colouring evaluated at the triangle centroid (crisp toon bands; geometry edges must line up
      // with the colour boundaries)
      for (let t = 0; t < n; t += 3) {
        let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
        for (let k = 0; k < 3; k++) {
          cx += pos.getX(t + k);
          cy += pos.getY(t + k);
          cz += pos.getZ(t + k);
          nx += nor.getX(t + k);
          ny += nor.getY(t + k);
          nz += nor.getZ(t + k);
        }
        const nl = Math.hypot(nx, ny, nz) || 1;
        let r = color(cx / 3, cy / 3, cz / 3, nx / nl, ny / nl, nz / nl);
        let e = baseEmit;
        if (Array.isArray(r)) {
          e = r[1];
          r = r[0];
        }
        _c.set(r);
        for (let k = t; k < t + 3; k++) {
          col[k * 3] = _c.r;
          col[k * 3 + 1] = _c.g;
          col[k * 3 + 2] = _c.b;
          em[k] = e;
        }
      }
    } else {
      _c.set(color);
      for (let i = 0; i < n; i++) {
        col[i * 3] = _c.r;
        col[i * 3 + 1] = _c.g;
        col[i * 3 + 2] = _c.b;
        em[i] = baseEmit;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
    const sc = o.scale ?? 1;
    _s.set(...(typeof sc === 'number' ? [sc, sc, sc] : sc));
    _p.set(...(o.pos || [0, 0, 0]));
    _e.set(...(o.rot || [0, 0, 0]), o.order || 'XYZ');
    _q.setFromEuler(_e);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    this.parts.push(g);
    return this;
  }

  build(transform) {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (transform) merged.applyMatrix4(transform);
    merged.computeBoundingSphere();
    return merged;
  }
}

function makeGradientMap() {
  const data = new Uint8Array([95, 170, 235, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Toon material with a rim light and (optionally) the per-vertex emissive attribute. */
function patchToon(mat, { emitAttr = true, rim = 0.5, key = 'ssk-item' } = {}) {
  mat.onBeforeCompile = (sh) => {
    if (emitAttr) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEmit;\nvarying float vEmit;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = aEmit;');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${emitAttr ? 'varying float vEmit;' : ''}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        ${emitAttr ? 'totalEmissiveRadiance += diffuseColor.rgb * vEmit * 1.6;' : ''}
        {
          float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          rimF = smoothstep(0.45, 0.95, rimF);
          totalEmissiveRadiance += (diffuseColor.rgb * 0.7 + vec3(0.25)) * rimF * ${rim.toFixed(3)};
        }`
      );
  };
  mat.customProgramCacheKey = () => `${key}-${emitAttr ? 1 : 0}-${rim}`;
  return mat;
}

// ------------------------------------------------------------------------------------------------
// Item-box shaders
// ------------------------------------------------------------------------------------------------
const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vWP;
varying vec2 vUv;
varying float vSeed;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  vSeed = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;
  #else
  vSeed = 0.0;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(m) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDecoy;
uniform float uBack;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vWP;
varying vec2 vUv;
varying float vSeed;
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vWP);
  float ndv = abs(dot(n, v));
  float fres = pow(1.0 - ndv, 2.5);
  vec2 e = abs(vUv - 0.5) * 2.0;
  float edge = smoothstep(0.7, 0.97, max(e.x, e.y));
  // iridescent rainbow flowing across each face, shifting with the view angle and time
  float hue = fract(vUv.x * 0.8 + vUv.y * 0.9 + ndv * 0.5 + uTime * 0.22 + vSeed);
  vec3 col = hsv2rgb(vec3(hue, 0.85, 1.0));
  float sweep = smoothstep(0.07, 0.0, abs(fract((vUv.x - vUv.y) * 0.5 - uTime * 0.55 + vSeed) - 0.5));
  col = mix(col, vec3(1.0), clamp(edge * edge * 0.3 + sweep * 0.45, 0.0, 1.0));
  float a = 0.42 + 0.45 * edge + 0.35 * fres + sweep * 0.3;
  if (uDecoy > 0.5) {
    // the fake: redder, less iridescent, slightly more opaque
    col = mix(col, vec3(1.0, 0.28, 0.42), 0.5);
    a += 0.1;
  }
  if (uBack > 0.5) { a *= 0.55; col *= 0.85; }
  a = clamp(a, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col * 1.2, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // premultiplied, partly additive: keeps the rainbow vivid over any background
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * 0.6);
}
`;

const QMARK_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  vec4 center = m * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(m[0].xyz);
  vec4 mv = viewMatrix * center;
  float ph = center.x * 0.37 + center.z * 0.21;
  float a = sin(uTime * 2.3 + ph) * 0.14;
  vec2 c = position.xy * s;
  mv.xy += vec2(cos(a) * c.x - sin(a) * c.y, sin(a) * c.x + cos(a) * c.y);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
}
`;
const QMARK_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.45) discard;
  gl_FragColor = vec4(t.rgb * 1.08, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------------------------------------
// Aura (invincibility) and bolts
// ------------------------------------------------------------------------------------------------
const AURA_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWP;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const AURA_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWP;
void main() {
  vec3 v = normalize(cameraPosition - vWP);
  float fres = pow(1.0 - abs(dot(normalize(vN), v)), 1.5);
  vec3 c = texture2D(uMap, vec2(vUv.x * 3.0, vUv.y * 0.6 - uTime * 0.9)).rgb;
  float streak = texture2D(uMap, vec2(vUv.x * 5.0 + 0.3, vUv.y * 0.3 - uTime * 1.7)).g;
  float fadeY = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float a = (0.35 + 0.65 * fres) * fadeY * uAlpha * (0.75 + 0.25 * streak);
  gl_FragColor = vec4(c * 1.6 * a, 0.0);
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------------------------------------
// ItemModels
// ------------------------------------------------------------------------------------------------
export class ItemModels {
  constructor({ quality = 'high' } = {}) {
    this.quality = quality;
    this.gradientMap = makeGradientMap();
    this.toon = patchToon(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradientMap }), { rim: 0.55 });
    this.time = { value: 0 };
    this.geos = {};
    this.pools = new Map();
    this.disposables = [this.gradientMap, this.toon];

    this._buildGeometries();
    this._buildBoxMaterials();
    this._buildMisc();
  }

  // ------------------------------------------------------------------------------------------
  _buildGeometries() {
    const G = this.geos;
    const seg = this.quality === 'low' ? 0.6 : 1;
    const S = (n) => Math.max(5, Math.round(n * seg));

    // ---------------- Ramen bowl ----------------
    {
      const b = new GeoBuilder();
      const prof = [
        [0.0, 0.0], [0.3, 0.0], [0.33, 0.06], [0.42, 0.12], [0.55, 0.22], [0.66, 0.35], [0.7, 0.42], [0.72, 0.47],
        [0.745, 0.54], [0.715, 0.56], [0.685, 0.5], [0.62, 0.38], [0.52, 0.27], [0.38, 0.18], [0.0, 0.16],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      b.add(new THREE.LatheGeometry(prof, S(36)), (x, y, z, nx, ny, nz) => {
        const outward = x * nx + z * nz > 0;
        if (!outward || y > 0.545) return '#fff7ea';
        if (y < 0.07) return '#f3e3c8';
        if (y > 0.47) return '#ffffff';
        if (y > 0.415) {
          // "raimon" key-fret band: alternate red/white blocks by angle
          const a = Math.atan2(z, x);
          return Math.floor((a / (Math.PI * 2)) * 36 + 36) % 2 === 0 ? '#d8342c' : '#ffffff';
        }
        return '#e0392e';
      });
      // broth
      b.add(new THREE.CircleGeometry(0.665, S(32)), '#e0923a', { rot: [-Math.PI / 2, 0, 0], pos: [0, 0.455, 0] });
      b.add(new THREE.CircleGeometry(0.5, S(28)), '#f0ad55', { rot: [-Math.PI / 2, 0, 0], pos: [0, 0.458, 0] });
      // shiny oil droplets
      for (let i = 0; i < 7; i++) {
        const a = i * 2.1 + 0.4;
        const r = 0.2 + (i % 3) * 0.14;
        b.add(new THREE.CircleGeometry(0.025 + (i % 2) * 0.015, 8), '#ffe2a0', { rot: [-Math.PI / 2, 0, 0], pos: [Math.cos(a) * r, 0.461, Math.sin(a) * r], emit: 0.4 });
      }
      // noodles
      for (let k = 0; k < 6; k++) {
        const z0 = (k - 2.5) * 0.085 + 0.05;
        const pts = [];
        for (let i = 0; i <= 8; i++) {
          const x = -0.48 + (i / 8) * 0.8;
          pts.push(new THREE.Vector3(x, 0.47 + Math.sin(i * 1.7 + k) * 0.02, z0 + Math.sin(i * 1.3 + k * 2.1) * 0.05));
        }
        b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), S(18), 0.028, 5), '#ffe08a');
      }
      // chashu slice
      b.add(new THREE.CylinderGeometry(0.19, 0.19, 0.05, S(16)), (x, y, z, nx, ny) => (ny > 0.5 ? (Math.hypot(x, z) < 0.12 ? '#f0b58f' : '#dd9870') : '#8a4b2a'), {
        pos: [0.26, 0.48, 0.16],
        rot: [0.15, 0, -0.2],
      });
      // soft-boiled egg half (dome down, yolk up)
      b.add(new THREE.SphereGeometry(0.15, S(14), 8, 0, Math.PI * 2, 0, Math.PI / 2), '#fffaf0', {
        pos: [-0.22, 0.5, 0.2],
        rot: [Math.PI, 0, 0.12],
        scale: [1, 0.6, 1.3],
      });
      b.add(new THREE.CircleGeometry(0.1, S(14)), '#ffb21f', { pos: [-0.22, 0.505, 0.2], rot: [-Math.PI / 2, 0, 0], scale: [1, 1.25, 1] });
      b.add(new THREE.CircleGeometry(0.055, S(12)), '#ff8a00', { pos: [-0.22, 0.508, 0.2], rot: [-Math.PI / 2, 0, 0], scale: [1, 1.25, 1], emit: 0.15 });
      // naruto (white disc with pink spiral)
      b.add(new THREE.CylinderGeometry(0.13, 0.13, 0.035, S(14)), '#fffdf8', { pos: [0.02, 0.48, -0.26], rot: [0.12, 0, 0.05] });
      {
        const pts = [];
        for (let i = 0; i <= 30; i++) {
          const t = i / 30;
          const a = t * Math.PI * 3.2;
          const r = 0.015 + t * 0.085;
          pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
        }
        b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), S(30), 0.012, 4), '#ff4f95', {
          pos: [0.02, 0.5, -0.26],
          rot: [0.12, 0, 0.05],
        });
      }
      // nori sheet leaning on the back
      b.add(new THREE.BoxGeometry(0.36, 0.42, 0.015), (x, y) => (y > 0.18 ? '#27402f' : '#1c3024'), {
        pos: [-0.18, 0.62, -0.42],
        rot: [-0.4, 0.35, 0],
      });
      // scallions
      for (let i = 0; i < 12; i++) {
        const a = i * 2.39;
        const r = 0.12 + (i % 4) * 0.08;
        b.add(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 6), i % 3 ? '#7fd64e' : '#c9f09a', {
          pos: [Math.cos(a) * r, 0.475, Math.sin(a) * r * 0.9],
        });
      }
      // chopsticks resting across the rim
      for (let k = 0; k < 2; k++) {
        b.add(new THREE.CylinderGeometry(0.016, 0.026, 1.25, 6, 4), (x, y) => (y > 0.3 ? '#9a5a28' : '#e0ae6e'), {
          pos: [0.18 + k * 0.08, 0.64, -0.02 - k * 0.06],
          rot: [0.2, 0.5 + k * 0.08, -1.25],
          order: 'YXZ',
        });
      }
      G.ramen = b.build();
    }

    // ---------------- Ricochet round (green) ----------------
    {
      const b = new GeoBuilder();
      const prof = [
        [0.0, 0.0], [0.2, 0.0], [0.225, 0.03], [0.225, 0.09], [0.195, 0.11], [0.205, 0.13], [0.205, 0.24], [0.212, 0.245],
        [0.212, 0.28], [0.205, 0.285], [0.205, 0.44], [0.212, 0.445], [0.212, 0.48], [0.205, 0.485], [0.205, 0.55],
        [0.19, 0.6], [0.175, 0.66], [0.15, 0.74], [0.115, 0.82], [0.07, 0.89], [0.025, 0.93], [0.0, 0.94],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      b.add(new THREE.LatheGeometry(prof, S(20)), (x, y) => {
        if (y < 0.12) return ['#17602e', 0.05];
        if (y > 0.575) return ['#c9ffd8', 0.8];
        if ((y > 0.24 && y < 0.285) || (y > 0.44 && y < 0.485)) return ['#a8ffbf', 0.75];
        return ['#2fcf58', 0.18];
      });
      // center at origin, point +Z
      _m.makeTranslation(0, -0.47, 0);
      const t = new THREE.Matrix4().makeRotationX(Math.PI / 2).multiply(_m);
      G.bullet = b.build(t.premultiply(new THREE.Matrix4().makeScale(1.35, 1.35, 1.35)));
    }

    // ---------------- Drone missile (red) + rotor ----------------
    {
      const b = new GeoBuilder();
      // body along +Z
      b.add(new THREE.CylinderGeometry(0.18, 0.18, 0.78, S(16)), '#ff3b3b', { rot: [Math.PI / 2, 0, 0], emit: 0.08 });
      b.add(new THREE.CylinderGeometry(0.186, 0.186, 0.08, S(16)), '#ffffff', { rot: [Math.PI / 2, 0, 0], pos: [0, 0, 0.26], emit: 0.1 });
      b.add(new THREE.CylinderGeometry(0.186, 0.186, 0.05, S(16)), '#ffd23f', { rot: [Math.PI / 2, 0, 0], pos: [0, 0, -0.28], emit: 0.2 });
      // nose
      b.add(new THREE.SphereGeometry(0.18, S(16), 10, 0, Math.PI * 2, 0, Math.PI / 2), '#ff4a4a', {
        pos: [0, 0, 0.39],
        rot: [Math.PI / 2, 0, 0],
        scale: [1, 1.6, 1],
        emit: 0.1,
      });
      // sensor eye
      b.add(new THREE.SphereGeometry(0.06, 10, 8), '#fff27a', { pos: [0, 0.05, 0.64], emit: 1.2 });
      // nozzle
      b.add(new THREE.CylinderGeometry(0.13, 0.1, 0.12, S(14)), '#3a3f4a', { pos: [0, 0, -0.44], rot: [Math.PI / 2, 0, 0] });
      b.add(new THREE.CircleGeometry(0.1, S(14)), '#ffcf5a', { pos: [0, 0, -0.501], rot: [0, Math.PI, 0], emit: 1.5 });
      // fins
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        b.add(new THREE.BoxGeometry(0.025, 0.2, 0.26), '#2f343e', {
          pos: [Math.cos(a) * 0.23, Math.sin(a) * 0.23, -0.28],
          rot: [0, 0, a - Math.PI / 2],
        });
      }
      // drone frame on top
      b.add(new THREE.BoxGeometry(0.08, 0.14, 0.12), '#4a4f5a', { pos: [0, 0.24, 0] }); // pylon
      b.add(new RoundedBoxGeometry(0.34, 0.1, 0.34, 2, 0.04), '#e9edf3', { pos: [0, 0.34, 0] }); // hub
      b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), '#35c8ff', { pos: [0, 0.4, 0], emit: 1.3 });
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        b.add(new THREE.BoxGeometry(0.44, 0.04, 0.05), '#5b606b', {
          pos: [Math.cos(a) * 0.26, 0.34, Math.sin(a) * 0.26],
          rot: [0, -a, 0],
        });
        b.add(new THREE.CylinderGeometry(0.055, 0.055, 0.09, 10), '#23262d', { pos: [Math.cos(a) * 0.46, 0.37, Math.sin(a) * 0.46] });
      }
      G.missile = b.build(new THREE.Matrix4().makeScale(1.25, 1.25, 1.25));
      this.rotorOffsets = [];
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        this.rotorOffsets.push(new THREE.Vector3(Math.cos(a) * 0.46 * 1.25, 0.43 * 1.25, Math.sin(a) * 0.46 * 1.25));
      }
      const r = new GeoBuilder();
      r.add(new THREE.BoxGeometry(0.36, 0.012, 0.045), '#d9dee6');
      r.add(new THREE.BoxGeometry(0.045, 0.012, 0.36), '#d9dee6');
      r.add(new THREE.CylinderGeometry(0.17, 0.17, 0.004, 16), '#ffffff', { emit: 0.2 });
      G.rotor = r.build(new THREE.Matrix4().makeScale(1.25, 1.25, 1.25));
    }

    // ---------------- Grenade (olive) ----------------
    {
      const b = new GeoBuilder();
      b.add(new THREE.SphereGeometry(0.3, S(20), S(14)), (x, y, z) => {
        const a = Math.atan2(z, x);
        const fa = ((a / (Math.PI * 2)) * 8 + 8) % 1;
        const fy = ((y + 0.4) * 6.5) % 1;
        if (fa < 0.12 || fy < 0.14) return '#3a4624';
        return '#5f7040';
      }, { scale: [1, 1.2, 1] });
      b.add(new THREE.CylinderGeometry(0.1, 0.13, 0.14, S(12)), '#9aa0a8', { pos: [0, 0.4, 0] });
      b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10), '#6d737c', { pos: [0, 0.49, 0] });
      // spoon lever
      b.add(new THREE.BoxGeometry(0.07, 0.42, 0.035), '#b3b9c2', { pos: [0.2, 0.26, 0], rot: [0, 0, -0.35] });
      // pull ring
      b.add(new THREE.TorusGeometry(0.085, 0.018, 6, 16), '#e8c64a', { pos: [-0.15, 0.44, 0], rot: [0, Math.PI / 2, 0.4], emit: 0.2 });
      G.grenade = b.build(new THREE.Matrix4().makeScale(1.15, 1.15, 1.15));
    }

    // ---------------- Blue seeker (winged) ----------------
    {
      const b = new GeoBuilder();
      const prof = [
        [0.0, 0.0], [0.11, 0.02], [0.19, 0.12], [0.225, 0.3], [0.225, 0.34], [0.232, 0.345], [0.232, 0.395], [0.225, 0.4],
        [0.225, 0.82], [0.232, 0.825], [0.232, 0.875], [0.225, 0.88], [0.225, 0.9], [0.2, 1.08], [0.15, 1.22], [0.08, 1.33], [0.0, 1.37],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      b.add(new THREE.LatheGeometry(prof, S(20)), (x, y) => {
        if (y > 1.08) return ['#d8efff', 0.8];
        if ((y > 0.34 && y < 0.4) || (y > 0.82 && y < 0.88)) return ['#ffffff', 0.5];
        if (y < 0.12) return ['#0c2f8a', 0.2];
        return ['#1f63f0', 0.2];
      }, { pos: [0, 0, -0.68], rot: [Math.PI / 2, 0, 0] });
      // wings (feathered, angel-like) built from shapes, both sides
      const wingShape = (m) => {
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.bezierCurveTo(0.3 * m, 0.25, 0.7 * m, 0.45, 1.15 * m, 0.42);
        s.lineTo(1.0 * m, 0.25);
        s.quadraticCurveTo(1.05 * m, 0.1, 0.92 * m, 0.1);
        s.lineTo(0.8 * m, -0.06);
        s.quadraticCurveTo(0.78 * m, -0.16, 0.62 * m, -0.12);
        s.lineTo(0.5 * m, -0.24);
        s.quadraticCurveTo(0.44 * m, -0.3, 0.3 * m, -0.22);
        s.lineTo(0.12 * m, -0.18);
        s.lineTo(0, -0.1);
        s.closePath();
        return s;
      };
      for (const m of [1, -1]) {
        const g = new THREE.ExtrudeGeometry(wingShape(m), { depth: 0.035, bevelEnabled: false, curveSegments: 6 });
        g.translate(0, 0, -0.0175);
        b.add(g, (x, y) => (y < -0.04 && Math.abs(x) > 0.25 ? ['#7fbfff', 0.35] : Math.abs(x) > 0.8 ? ['#b5dcff', 0.3] : ['#ffffff', 0.25]), {
          // shape +y -> +z (leading edge forward), then a little dihedral about the body axis
          pos: [0.1 * m, 0.06, -0.15],
          rot: [Math.PI / 2, 0, m * 0.28],
          order: 'ZYX',
        });
      }
      // tail fins
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3 + Math.PI / 2;
        b.add(new THREE.BoxGeometry(0.02, 0.2, 0.28), '#0f3fb0', {
          pos: [Math.cos(a) * 0.24, 0, -0.55],
          rot: [0, 0, a - Math.PI / 2],
          emit: 0.3,
        });
      }
      // exhaust
      b.add(new THREE.CircleGeometry(0.13, 14), '#bfe8ff', { pos: [0, 0, -0.69], rot: [0, Math.PI, 0], emit: 2 });
      // mini halo above
      b.add(new THREE.TorusGeometry(0.2, 0.025, 6, 24), '#bff0ff', { pos: [0, 0.42, -0.05], rot: [Math.PI / 2, 0, 0], emit: 1.4 });
      G.seeker = b.build(new THREE.Matrix4().makeScale(1.45, 1.45, 1.45));
    }

    // ---------------- Spent energy-drink can ----------------
    {
      const b = new GeoBuilder();
      b.add(new THREE.CylinderGeometry(0.12, 0.12, 0.28, S(14)), '#ffd23f');
      b.add(new THREE.CylinderGeometry(0.123, 0.123, 0.07, S(14)), '#e8304f', { emit: 0.05 });
      b.add(new THREE.CylinderGeometry(0.105, 0.12, 0.035, S(14)), '#d7dbe1', { pos: [0, 0.157, 0] });
      b.add(new THREE.CylinderGeometry(0.12, 0.105, 0.035, S(14)), '#c4c9d0', { pos: [0, -0.157, 0] });
      b.add(new THREE.CylinderGeometry(0.09, 0.09, 0.012, S(14)), '#eef1f5', { pos: [0, 0.178, 0] });
      b.add(new THREE.BoxGeometry(0.04, 0.01, 0.07), '#b8bec6', { pos: [0.02, 0.186, 0] });
      // lightning-bolt logo
      b.add(new THREE.BoxGeometry(0.03, 0.12, 0.012), '#1d2a4d', { pos: [0, 0.075, 0.122], rot: [0, 0, 0.35] });
      G.can = b.build(new THREE.Matrix4().makeScale(1.4, 1.4, 1.4));
    }

    // ---------------- Sensei's card ----------------
    {
      const b = new GeoBuilder();
      b.add(new RoundedBoxGeometry(0.66, 0.025, 0.42, 2, 0.02), '#ffd23f', { emit: 0.25 });
      b.add(new THREE.BoxGeometry(0.662, 0.028, 0.07), '#2b2110', { pos: [0, 0, -0.13] });
      b.add(new THREE.BoxGeometry(0.12, 0.03, 0.09), '#fff2c0', { pos: [-0.19, 0, 0.06], emit: 0.6 });
      b.add(new THREE.BoxGeometry(0.28, 0.03, 0.025), '#b8860b', { pos: [0.1, 0, 0.1] });
      b.add(new THREE.BoxGeometry(0.2, 0.03, 0.025), '#b8860b', { pos: [0.06, 0, 0.15] });
      G.card = b.build(new THREE.Matrix4().makeScale(1.3, 1.3, 1.3));
    }

    // ---------------- Credit bag ----------------
    {
      const b = new GeoBuilder();
      b.add(new THREE.SphereGeometry(0.32, S(16), S(12)), (x, y) => (y < -0.2 ? '#cf9f55' : '#e8c27a'), { scale: [1, 0.9, 1] });
      b.add(new THREE.CylinderGeometry(0.09, 0.16, 0.14, S(12)), '#e0b56a', { pos: [0, 0.32, 0] });
      b.add(new THREE.TorusGeometry(0.1, 0.03, 6, 14), '#8a5a2a', { pos: [0, 0.3, 0], rot: [Math.PI / 2, 0, 0] });
      b.add(new THREE.ConeGeometry(0.16, 0.14, S(12)), '#e8c27a', { pos: [0, 0.44, 0], rot: [Math.PI, 0, 0] });
      b.add(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16), '#ffd23f', { pos: [0, 0.02, 0.29], rot: [Math.PI / 2, 0, 0], emit: 0.8 });
      G.bag = b.build(new THREE.Matrix4().makeScale(1.3, 1.3, 1.3));
    }

    // ---------------- Shittim tablet ----------------
    {
      const b = new GeoBuilder();
      b.add(new RoundedBoxGeometry(0.82, 0.58, 0.06, 2, 0.05), '#2b3140');
      b.add(new THREE.PlaneGeometry(0.72, 0.24), '#6fdcff', { pos: [0, 0.12, 0.032], emit: 0.9 });
      b.add(new THREE.PlaneGeometry(0.72, 0.24), '#2fb8f5', { pos: [0, -0.12, 0.032], emit: 0.9 });
      b.add(new THREE.PlaneGeometry(0.5, 0.035), '#ffffff', { pos: [0, 0.1, 0.034], emit: 1.1 });
      b.add(new THREE.PlaneGeometry(0.34, 0.025), '#ffffff', { pos: [-0.08, 0.04, 0.034], emit: 1.1 });
      // little halo icon on the screen
      b.add(new THREE.TorusGeometry(0.07, 0.012, 6, 20), '#ffffff', { pos: [0, -0.1, 0.036], scale: [1.4, 0.55, 1], emit: 1.3 });
      G.tablet = b.build(new THREE.Matrix4().makeScale(1.3, 1.3, 1.3));
    }

    // ---------------- Item box parts ----------------
    G.boxShell = new RoundedBoxGeometry(1.5, 1.5, 1.5, 3, 0.24);
    G.qmark = new THREE.PlaneGeometry(1.3, 1.3);
    {
      const b = new GeoBuilder();
      b.add(new THREE.TorusGeometry(0.44, 0.06, 8, S(36)), '#fff09a', { rot: [Math.PI / 2, 0, 0] });
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        b.add(new THREE.BoxGeometry(0.2, 0.06, 0.07), '#fff09a', { pos: [Math.cos(a) * 0.58, 0, Math.sin(a) * 0.58], rot: [0, -a, 0] });
      }
      G.halo = b.build();
    }
    G.shadow = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

    // ---------------- Coin ----------------
    {
      const g = new THREE.CylinderGeometry(0.52, 0.52, 0.13, S(28), 1, false);
      // remap UVs: caps use the circle texture (bottom cap mirrored back), the side samples the rim colour corner
      const uv = g.attributes.uv;
      for (const grp of g.groups) {
        for (let k = grp.start; k < grp.start + grp.count; k++) {
          const i = g.index.getX(k);
          if (grp.materialIndex === 0) uv.setXY(i, 0.02, 0.02);
          else if (grp.materialIndex === 2) uv.setXY(i, 1 - uv.getX(i), 1 - uv.getY(i));
        }
      }
      g.clearGroups();
      g.rotateX(Math.PI / 2);
      g.rotateZ(Math.PI / 2);
      G.coin = g;
    }
  }

  // ------------------------------------------------------------------------------------------
  _buildBoxMaterials() {
    const mkShell = (back, decoy) =>
      new THREE.ShaderMaterial({
        name: 'SSKItemBoxShell',
        uniforms: {
          uTime: this.time,
          uDecoy: { value: decoy ? 1 : 0 },
          uBack: { value: back ? 1 : 0 },
          uOpacity: { value: 1 },
        },
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        side: back ? THREE.BackSide : THREE.FrontSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
    this.shellBack = mkShell(true, false);
    this.shellFront = mkShell(false, false);
    this.decoyShellBack = mkShell(true, true);
    this.decoyShellFront = mkShell(false, true);
    const mkQ = (inv) =>
      new THREE.ShaderMaterial({
        name: 'SSKItemBoxQ',
        uniforms: { uTime: this.time, uMap: { value: getQuestionTexture(inv) } },
        vertexShader: QMARK_VERT,
        fragmentShader: QMARK_FRAG,
        transparent: false,
      });
    this.qmat = mkQ(false);
    this.qmatDecoy = mkQ(true);
    this.haloMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      alphaMap: getShadowTexture(),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.coinMat = patchToon(
      new THREE.MeshToonMaterial({ map: getCoinTexture(), gradientMap: this.gradientMap, emissive: new THREE.Color('#6b4400'), emissiveIntensity: 0.55 }),
      { emitAttr: false, rim: 0.7, key: 'ssk-coin' }
    );
    this.disposables.push(this.shellBack, this.shellFront, this.decoyShellBack, this.decoyShellFront, this.qmat, this.qmatDecoy, this.haloMat, this.shadowMat, this.coinMat);
  }

  _buildMisc() {
    const glow = getGlowTexture();
    const mkGlow = (color, opacity = 0.9) =>
      new THREE.SpriteMaterial({
        map: glow,
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
    this.glowMats = {
      green: mkGlow('#4cff7a', 0.8),
      red: mkGlow('#ff5a3a', 0.7),
      blue: mkGlow('#3f8cff', 0.95),
      gold: mkGlow('#ffd23f', 0.8),
      orange: mkGlow('#ffae3a', 0.85),
    };
    this.disposables.push(...Object.values(this.glowMats));

    // reticle decal
    this.reticleMat = new THREE.MeshBasicMaterial({
      map: getReticleTexture(),
      color: new THREE.Color('#ff3355'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.geos.reticle = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.disposables.push(this.reticleMat);

    // invincibility aura
    this.auraMat = new THREE.ShaderMaterial({
      name: 'SSKAura',
      uniforms: { uMap: { value: getAuraTexture() }, uTime: this.time, uAlpha: { value: 1 } },
      vertexShader: AURA_VERT,
      fragmentShader: AURA_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.geos.aura = new THREE.CylinderGeometry(1.35, 1.6, 2.6, 24, 1, true).translate(0, 1.1, 0);
    this.disposables.push(this.auraMat);

    // lightning bolt material
    this.boltMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#bff0ff'),
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.disposables.push(this.boltMat);
  }

  // ------------------------------------------------------------------------------------------
  // Factories
  // ------------------------------------------------------------------------------------------

  _mesh(geo) {
    const m = new THREE.Mesh(geo, this.toon);
    m.castShadow = true;
    m.receiveShadow = false;
    return m;
  }

  _create(kind) {
    const root = new THREE.Group();
    root.name = `item:${kind}`;
    const parts = { root };
    switch (kind) {
      case 'ramen': {
        parts.body = this._mesh(this.geos.ramen);
        root.add(parts.body);
        break;
      }
      case 'bullet': {
        parts.body = this._mesh(this.geos.bullet);
        parts.body.position.y = 0.05;
        root.add(parts.body);
        parts.glow = new THREE.Sprite(this.glowMats.green);
        parts.glow.scale.setScalar(1.9);
        root.add(parts.glow);
        break;
      }
      case 'missile': {
        parts.body = this._mesh(this.geos.missile);
        root.add(parts.body);
        parts.rotors = this.rotorOffsets.map((o) => {
          const r = new THREE.Mesh(this.geos.rotor, this.toon);
          r.position.copy(o);
          parts.body.add(r);
          return r;
        });
        parts.glow = new THREE.Sprite(this.glowMats.orange);
        parts.glow.position.set(0, 0, -0.75);
        parts.glow.scale.setScalar(0.9);
        root.add(parts.glow);
        break;
      }
      case 'grenade': {
        parts.body = this._mesh(this.geos.grenade);
        root.add(parts.body);
        parts.glow = new THREE.Sprite(this.glowMats.red);
        parts.glow.position.set(0, 0.62, 0);
        parts.glow.scale.setScalar(0.6);
        root.add(parts.glow);
        break;
      }
      case 'seeker': {
        parts.body = this._mesh(this.geos.seeker);
        root.add(parts.body);
        parts.glow = new THREE.Sprite(this.glowMats.blue);
        parts.glow.scale.setScalar(3.6);
        root.add(parts.glow);
        break;
      }
      case 'decoy': {
        const back = new THREE.Mesh(this.geos.boxShell, this.decoyShellBack);
        const q = new THREE.Mesh(this.geos.qmark, this.qmatDecoy);
        const front = new THREE.Mesh(this.geos.boxShell, this.decoyShellFront);
        back.renderOrder = 1;
        q.renderOrder = 2;
        front.renderOrder = 3;
        q.frustumCulled = false;
        parts.body = new THREE.Group();
        parts.body.add(back, q, front);
        root.add(parts.body);
        parts.shadow = new THREE.Mesh(this.geos.shadow, this.shadowMat);
        parts.shadow.scale.setScalar(1.9);
        root.add(parts.shadow);
        break;
      }
      case 'can':
      case 'card':
      case 'bag':
      case 'tablet': {
        parts.body = this._mesh(this.geos[kind]);
        root.add(parts.body);
        break;
      }
      case 'reticle': {
        parts.body = new THREE.Mesh(this.geos.reticle, this.reticleMat.clone());
        parts.body.renderOrder = 5;
        root.add(parts.body);
        this.disposables.push(parts.body.material);
        break;
      }
      case 'aura': {
        const mat = this.auraMat.clone();
        mat.uniforms.uMap.value = this.auraMat.uniforms.uMap.value;
        mat.uniforms.uTime = { value: 0 };
        this.disposables.push(mat);
        parts.body = new THREE.Mesh(this.geos.aura, mat);
        parts.body.renderOrder = 6;
        parts.body.frustumCulled = false;
        root.add(parts.body);
        break;
      }
      case 'bolt': {
        const N = 12;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 4 * 3), 3));
        const idx = [];
        for (let i = 0; i < N; i++) {
          for (let r = 0; r < 2; r++) {
            const a = i * 4 + r * 2;
            const b = (i + 1) * 4 + r * 2;
            idx.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
        geo.setIndex(idx);
        parts.body = new THREE.Mesh(geo, this.boltMat.clone());
        parts.body.frustumCulled = false;
        parts.body.renderOrder = 7;
        parts.segments = N;
        root.add(parts.body);
        this.disposables.push(geo, parts.body.material);
        break;
      }
      default:
        parts.body = new THREE.Mesh(new THREE.SphereGeometry(0.4), this.toon);
        root.add(parts.body);
    }
    root.userData.parts = parts;
    return root;
  }

  /** Get a (pooled) Object3D for an item kind. `obj.userData.parts` holds { root, body, glow?, rotors? ... }. */
  acquire(kind) {
    const pool = this.pools.get(kind);
    const obj = pool && pool.length ? pool.pop() : this._create(kind);
    obj.visible = true;
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.quaternion.identity();
    obj.scale.setScalar(1);
    const p = obj.userData.parts;
    if (p.body) {
      p.body.position.set(0, p.body.position.y, 0);
      p.body.rotation.set(0, 0, 0);
      p.body.scale.setScalar(1);
    }
    return obj;
  }

  release(kind, obj) {
    if (!obj) return;
    obj.removeFromParent();
    let pool = this.pools.get(kind);
    if (!pool) this.pools.set(kind, (pool = []));
    if (pool.length < 24) pool.push(obj);
  }

  /** Write a jagged vertical bolt from `top` to `bottom` into a bolt object's geometry. */
  shapeBolt(obj, top, bottom, width = 0.5, jitter = 1.2) {
    const parts = obj.userData.parts;
    const N = parts.segments;
    const pos = parts.body.geometry.attributes.position;
    let ox = 0;
    let oz = 0;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = top.x + (bottom.x - top.x) * t + (i === 0 || i === N ? 0 : ox);
      const y = top.y + (bottom.y - top.y) * t;
      const z = top.z + (bottom.z - top.z) * t + (i === 0 || i === N ? 0 : oz);
      const w = width * (1 - t * 0.5);
      pos.setXYZ(i * 4, x - w, y, z);
      pos.setXYZ(i * 4 + 1, x + w, y, z);
      pos.setXYZ(i * 4 + 2, x, y, z - w);
      pos.setXYZ(i * 4 + 3, x, y, z + w);
      ox += (Math.random() - 0.5) * jitter;
      oz += (Math.random() - 0.5) * jitter;
      ox *= 0.8;
      oz *= 0.8;
    }
    pos.needsUpdate = true;
  }

  dispose() {
    for (const g of Object.values(this.geos)) g.dispose?.();
    for (const d of this.disposables) d.dispose?.();
    this.pools.clear();
  }
}
