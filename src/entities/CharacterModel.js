// Chibi Kivotos students (owner: characters agent) — see ARCHITECTURE.md §6.
//
// Every driver is ONE skinned, vertex-coloured toon mesh (+ one inverted-hull outline mesh sharing the same
// skeleton), a halo and its glow plane: ~4 draw calls per character. The face is a CanvasTexture painted
// procedurally (big anime eyes, per-character colours, expressions) and mapped onto the head with a planar
// projection; every other part samples a white texel of the same texture and takes its colour from the
// vertex colours. Rigid parts (torso, head, arms) and hair chains (twin tails, long hair, scarf, ahoge) are
// driven by bones; hair chains use a damped spring so they sway with speed / steering / jumps.
//
// Exports (also used by KartModel.js / RacerModel.js / Portraits.js):
//   createCharacterModel(character, { quality }) -> CharacterModel
//   MeshBuilder, strandGeo, latheGeo, ellipsoidGeo, alignedCapsule, basisMatrix
//   createToonMaterial, getOutlineMaterial, getGradientMap, vc, shadeHex, mixHex, hexRgb, rgba
//   getFaceTexture(character, expression, size), EXPRESSIONS, getHaloGlowTexture()

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, damp, smoothstep, hashString, mulberry32 } from '../core/utils.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const QUALITY_DETAIL = { high: 1, medium: 0.8, low: 0.6 };
const FACE_SIZE = { high: 512, medium: 384, low: 256 };

// =========================================================================================================
// Colour helpers
// =========================================================================================================

export function hexRgb(hex) {
  if (typeof hex === 'number') return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  let s = String(hex || '#ff00ff').replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbHex(c) {
  return '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
/** f < 1 darkens towards black, f > 1 lightens towards white (sRGB space). */
export function shadeHex(hex, f) {
  const c = hexRgb(hex);
  return rgbHex(f <= 1 ? c.map((v) => v * f) : c.map((v) => v + (255 - v) * Math.min(1, f - 1)));
}
export function mixHex(a, b, t) {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return rgbHex(x.map((v, i) => v + (y[i] - v) * t));
}
export function rgba(hex, a = 1) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
const luminance = (hex) => {
  const [r, g, b] = hexRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
const _colorCache = new Map();
/** Cached THREE.Color (linear working space) from a hex string. Do not mutate. */
export function vc(hex) {
  const key = typeof hex === 'string' ? hex : `n${hex}`;
  let c = _colorCache.get(key);
  if (!c) {
    c = new THREE.Color(hex ?? '#ff00ff');
    _colorCache.set(key, c);
  }
  return c;
}

// =========================================================================================================
// Toon materials
// =========================================================================================================

let _gradientMap = null;
/** Shared 3-step toon ramp (shadow / mid / lit). */
export function getGradientMap() {
  if (_gradientMap) return _gradientMap;
  const v = [118, 186, 255];
  const data = new Uint8Array(v.length * 4);
  v.forEach((x, i) => data.set([x, x, x, 255], i * 4));
  const tex = new THREE.DataTexture(data, v.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _gradientMap = tex;
  return tex;
}

/**
 * MeshToonMaterial with vertex colours + an optional atlas map, an anime rim light, a "face light" floor
 * (keeps the painted face bright whatever the sun direction) and a tint uniform for flashes / invincibility.
 */
export function createToonMaterial({ map = null, faceLight = 0, rim = 0.3 } = {}) {
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, map, vertexColors: true, gradientMap: getGradientMap() });
  const u = {
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTintAmt: { value: 0 },
    uRim: { value: rim },
    uFaceLight: { value: faceLight },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uTint;\nuniform float uTintAmt;\nuniform float uRim;\nuniform float uFaceLight;'
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 sskV = normalize( vViewPosition );
          float sskNdv = clamp( dot( normal, sskV ), 0.0, 1.0 );
          float sskRim = smoothstep( 0.58, 0.86, 1.0 - sskNdv );
          outgoingLight += diffuseColor.rgb * sskRim * uRim;
          #ifdef USE_MAP
            float sskFace = step( vMapUv.y, 0.905 ) * uFaceLight;
            outgoingLight = mix( outgoingLight, max( outgoingLight, diffuseColor.rgb * 0.92 ), sskFace );
          #endif
          outgoingLight = mix( outgoingLight, uTint, uTintAmt );
        }
        #include <opaque_fragment>`
      );
  };
  mat.customProgramCacheKey = () => 'ssk-toon-v1';
  return mat;
}

export const OUTLINE_THICKNESS = 0.0105;
let _outlineMat = null;
/** Shared inverted-hull outline material (skinning + fog aware, colour derived from the vertex colour). */
export function getOutlineMaterial() {
  if (_outlineMat) return _outlineMat;
  _outlineMat = new THREE.ShaderMaterial({
    name: 'ssk-outline',
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uThickness: { value: OUTLINE_THICKNESS }, uInk: { value: new THREE.Color('#1c1024') } },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      #include <fog_pars_vertex>
      attribute float aOutline;
      uniform float uThickness;
      varying vec3 vCol;
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        vec3 n = normalize( normalMatrix * objectNormal );
        float sc = length( modelMatrix[0].xyz );
        float dist = max( -mvPosition.z, 0.01 );
        mvPosition.xyz += n * uThickness * aOutline * sc * clamp( dist / 6.5, 0.55, 2.4 );
        gl_Position = projectionMatrix * mvPosition;
        #ifdef USE_COLOR
          vCol = color;
        #else
          vCol = vec3( 0.0 );
        #endif
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uInk;
      varying vec3 vCol;
      void main() {
        gl_FragColor = vec4( mix( uInk, vCol * 0.3, 0.4 ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    side: THREE.BackSide,
    vertexColors: true,
    fog: true,
  });
  return _outlineMat;
}

// =========================================================================================================
// Geometry toolkit
// =========================================================================================================

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Matrix from basis vectors (each scaled) + position. Keeps winding if (x, y, z) is right-handed. */
export function basisMatrix(pos, x, y, z, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().set(
    x.x * sx, y.x * sy, z.x * sz, pos.x,
    x.y * sx, y.y * sy, z.y * sz, pos.y,
    x.z * sx, y.z * sy, z.z * sz, pos.z,
    0, 0, 0, 1
  );
}

/** Orthonormal right-handed frame with +Y along `up` and +Z as close as possible to `fwdHint`. */
export function frameFrom(up, fwdHint) {
  const Yv = up.clone().normalize();
  const Zv = fwdHint.clone().addScaledVector(Yv, -fwdHint.dot(Yv));
  if (Zv.lengthSq() < 1e-6) Zv.set(Math.abs(Yv.x) < 0.9 ? 1 : 0, 0, Math.abs(Yv.x) < 0.9 ? 0 : 1).addScaledVector(Yv, -Yv.x);
  Zv.normalize();
  const Xv = new THREE.Vector3().crossVectors(Yv, Zv).normalize();
  return { x: Xv, y: Yv, z: Zv };
}

/** Ellipsoid around `center` with semi-axes along a frame. */
export function ellipsoidGeo(center, rx, ry, rz, frame = null, w = 12, h = 8) {
  const g = new THREE.SphereGeometry(1, w, h);
  const f = frame || { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  g.applyMatrix4(basisMatrix(center, f.x, f.y, f.z, rx, ry, rz));
  return g;
}

/** Capsule from a to b. */
export function alignedCapsule(a, b, r, capSeg = 3, radial = 8) {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.0001, len), capSeg, radial);
  _v1.subVectors(b, a).normalize();
  _q1.setFromUnitVectors(Y_AXIS, _v1);
  g.applyQuaternion(_q1);
  _v2.addVectors(a, b).multiplyScalar(0.5);
  g.translate(_v2.x, _v2.y, _v2.z);
  return g;
}

/** Cylinder from a to b (radius r0 at a, r1 at b). */
export function alignedCylinder(a, b, r0, r1 = r0, radial = 8, open = false) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, Math.max(0.0001, len), radial, 1, open);
  _v1.subVectors(b, a).normalize();
  _q1.setFromUnitVectors(Y_AXIS, _v1);
  g.applyQuaternion(_q1);
  _v2.addVectors(a, b).multiplyScalar(0.5);
  g.translate(_v2.x, _v2.y, _v2.z);
  return g;
}

/**
 * Tapered tube along a Catmull-Rom curve with an elliptical cross-section (flat < 1 -> ribbon-like hair
 * strand). `hint(p, t, out)` gives the direction of the THIN axis (e.g. outward from the head).
 * Returns an indexed geometry; `geometry.userData.t` holds the curve parameter per vertex.
 */
export function strandGeo(points, o = {}) {
  const seg = Math.max(2, Math.round(o.seg ?? 10));
  const radial = Math.max(3, Math.round(o.radial ?? 6));
  const flat = o.flat ?? 1;
  const r0 = o.r0 ?? 0.05;
  const r1 = o.r1 ?? 0.0015;
  const radiusFn =
    o.radiusFn || ((t) => lerp(r0, r1, Math.pow(t, o.taperPow ?? 1)) * (1 + (o.bulge ?? 0) * Math.sin(Math.PI * Math.min(1, t * (o.bulgeAt ?? 1)))));
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const capBase = !!o.capBase;
  const nv = (seg + 1) * radial + (capBase ? 1 : 0);
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const tv = new Float32Array(nv);
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const H = new THREE.Vector3();
  const B = new THREE.Vector3();
  const N = new THREE.Vector3();
  const prevB = new THREE.Vector3();
  let havePrev = false;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    if (o.hint) o.hint(P, t, H);
    else H.set(0, 1, 0);
    B.crossVectors(T, H);
    if (B.lengthSq() < 1e-8) {
      if (havePrev) B.copy(prevB);
      else B.set(1, 0, 0).cross(T);
    }
    B.normalize();
    if (havePrev && B.dot(prevB) < 0) B.negate();
    prevB.copy(B);
    havePrev = true;
    N.crossVectors(B, T).normalize();
    const r = Math.max(radiusFn(t), 0.0012);
    const w = r * (o.widthFn ? o.widthFn(t) : 1);
    const h = r * flat;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * TAU + (o.phase ?? 0);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const k = (i * radial + j) * 3;
      pos[k] = P.x + B.x * ca * w + N.x * sa * h;
      pos[k + 1] = P.y + B.y * ca * w + N.y * sa * h;
      pos[k + 2] = P.z + B.z * ca * w + N.z * sa * h;
      let nx = B.x * ca * h + N.x * sa * w;
      let ny = B.y * ca * h + N.y * sa * w;
      let nz = B.z * ca * h + N.z * sa * w;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[k] = nx / l;
      nrm[k + 1] = ny / l;
      nrm[k + 2] = nz / l;
      tv[i * radial + j] = t;
    }
  }
  const idx = [];
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + ((j + 1) % radial);
      const d = (i + 1) * radial + j;
      idx.push(a, d, c, a, c, b);
    }
  }
  if (capBase) {
    const ci = (seg + 1) * radial;
    curve.getPointAt(0, P);
    curve.getTangentAt(0, T);
    pos.set([P.x, P.y, P.z], ci * 3);
    nrm.set([-T.x, -T.y, -T.z], ci * 3);
    tv[ci] = 0;
    for (let j = 0; j < radial; j++) idx.push(ci, j, (j + 1) % radial);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.userData.t = tv;
  return g;
}

/**
 * Lathe around +Y with angle measured from +Z towards +X. profile: [[r, y], ...] bottom -> top.
 * o.range(y) -> [a0, a1] makes a partial (open) ring per profile row (e.g. an open blazer front).
 * o.rFn(r, y, a) can modulate the radius (pleats, fur). o.inner flips the faces (linings).
 */
export function latheGeo(profile, o = {}) {
  const segs = Math.max(3, Math.round(o.segs ?? 16));
  const sx = o.sx ?? 1;
  const sz = o.sz ?? 1;
  const full = !o.range;
  const ringN = full ? segs : segs + 1;
  const K = profile.length;
  const pos = new Float32Array(K * ringN * 3);
  for (let k = 0; k < K; k++) {
    const [r, y] = profile[k];
    const [a0, a1] = full ? [Math.PI, Math.PI + TAU] : o.range(y, k);
    for (let j = 0; j < ringN; j++) {
      const a = a0 + ((a1 - a0) * j) / segs;
      const rr = o.rFn ? o.rFn(r, y, a, k) : r;
      const i = (k * ringN + j) * 3;
      pos[i] = Math.sin(a) * rr * sx;
      pos[i + 1] = y;
      pos[i + 2] = Math.cos(a) * rr * sz;
    }
  }
  const idx = [];
  for (let k = 0; k < K - 1; k++) {
    for (let j = 0; j < segs; j++) {
      const jn = full ? (j + 1) % segs : j + 1;
      const a = k * ringN + j;
      const b = k * ringN + jn;
      const c = (k + 1) * ringN + jn;
      const d = (k + 1) * ringN + j;
      if (o.inner) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Remove triangles (by centroid test) and compact the vertex buffers. */
export function filterTriangles(geo, keep) {
  const src = geo.index ? geo : ensureIndexed(geo);
  const index = src.index.array;
  const pos = src.attributes.position;
  const kept = [];
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i];
    const b = index[i + 1];
    const c = index[i + 2];
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    if (keep(cx, cy, cz)) kept.push(a, b, c);
  }
  const remap = new Map();
  const newIdx = kept.map((v) => {
    if (!remap.has(v)) remap.set(v, remap.size);
    return remap.get(v);
  });
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const attr = src.attributes[name];
    const arr = new Float32Array(remap.size * attr.itemSize);
    for (const [oldI, newI] of remap) for (let c = 0; c < attr.itemSize; c++) arr[newI * attr.itemSize + c] = attr.array[oldI * attr.itemSize + c];
    out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
  }
  out.setIndex(newIdx);
  return out;
}

function ensureIndexed(g) {
  if (g.index) return g;
  const n = g.attributes.position.count;
  const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Normals averaged over coincident positions (for crack-free inverted-hull outlines). */
function smoothedNormals(pos, nrm) {
  const n = pos.count;
  const map = new Map();
  const keys = new Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
    keys[i] = key;
    let acc = map.get(key);
    if (!acc) map.set(key, (acc = [0, 0, 0]));
    acc[0] += nrm.getX(i);
    acc[1] += nrm.getY(i);
    acc[2] += nrm.getZ(i);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = map.get(keys[i]);
    const l = Math.hypot(a[0], a[1], a[2]);
    if (l > 1e-4) {
      out[i * 3] = a[0] / l;
      out[i * 3 + 1] = a[1] / l;
      out[i * 3 + 2] = a[2] / l;
    } else {
      out[i * 3] = nrm.getX(i);
      out[i * 3 + 1] = nrm.getY(i);
      out[i * 3 + 2] = nrm.getZ(i);
    }
  }
  return out;
}

const WHITE = new THREE.Color(1, 1, 1);
const _tmpColor = new THREE.Color();

/**
 * Accumulates vertex-coloured, skinned parts and merges them into one geometry (+ an outline geometry
 * with smoothed normals and a per-vertex thickness `aOutline`).
 */
export class MeshBuilder {
  constructor({ whiteUV = [0.5, 0.96], outlines = true } = {}) {
    this.whiteUV = whiteUV;
    this.outlines = outlines;
    this.parts = [];
    this.outlineParts = [];
    this.tris = 0;
    this.outlineTris = 0;
  }

  /**
   * @param {THREE.BufferGeometry} geo
   * @param {object} o  color (hex) | colorFn(x,y,z,i,t,outColor) ; bone (index) | skin(x,y,z,i,idx4,w4) ;
   *   matrix ; keepUV (use the geometry's uv) ; outline (thickness multiplier, 0 = none) ;
   *   outlineColor (hex) ; taper (outline thins towards the strand tip)
   */
  add(geo, o = {}) {
    if (!geo) return;
    if (o.matrix) geo.applyMatrix4(o.matrix);
    ensureIndexed(geo);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const n = pos.count;
    const tv = geo.userData.t || null;
    const colors = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const base = o.color !== undefined ? vc(o.color) : WHITE;
    const srcUV = o.keepUV ? geo.attributes.uv : null;
    const idx4 = [0, 0, 0, 0];
    const w4 = [0, 0, 0, 0];
    const boneFixed = typeof o.bone === 'number' || o.bone === undefined ? o.bone ?? 0 : -1;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let c = base;
      if (o.colorFn) {
        o.colorFn(x, y, z, i, tv ? tv[i] : 0, _tmpColor);
        c = _tmpColor;
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      if (srcUV) {
        uvs[i * 2] = srcUV.getX(i);
        uvs[i * 2 + 1] = srcUV.getY(i);
      } else {
        uvs[i * 2] = this.whiteUV[0];
        uvs[i * 2 + 1] = this.whiteUV[1];
      }
      if (boneFixed >= 0) {
        si[i * 4] = boneFixed;
        sw[i * 4] = 1;
      } else {
        idx4[0] = idx4[1] = idx4[2] = idx4[3] = 0;
        w4[0] = 1;
        w4[1] = w4[2] = w4[3] = 0;
        o.bone(x, y, z, i, idx4, w4);
        for (let k = 0; k < 4; k++) {
          si[i * 4 + k] = idx4[k];
          sw[i * 4 + k] = w4[k];
        }
      }
    }
    const g = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(Float32Array.from(pos.array), 3);
    const siAttr = new THREE.BufferAttribute(si, 4);
    const swAttr = new THREE.BufferAttribute(sw, 4);
    g.setAttribute('position', posAttr);
    g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(nrm.array), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', siAttr);
    g.setAttribute('skinWeight', swAttr);
    const index = Array.from(geo.index.array);
    g.setIndex(index);
    this.parts.push(g);
    this.tris += index.length / 3;
    const thick = o.outline ?? 1;
    if (this.outlines && thick > 0) {
      const og = new THREE.BufferGeometry();
      og.setAttribute('position', posAttr);
      og.setAttribute('normal', new THREE.BufferAttribute(smoothedNormals(pos, nrm), 3));
      let oc = colors;
      if (o.outlineColor !== undefined) {
        const cc = vc(o.outlineColor);
        oc = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) oc.set([cc.r, cc.g, cc.b], i * 3);
      }
      og.setAttribute('color', new THREE.BufferAttribute(oc, 3));
      og.setAttribute('skinIndex', siAttr);
      og.setAttribute('skinWeight', swAttr);
      const ao = new Float32Array(n);
      for (let i = 0; i < n; i++) ao[i] = o.taper && tv ? thick * (1 - 0.75 * tv[i] * tv[i]) : thick;
      og.setAttribute('aOutline', new THREE.BufferAttribute(ao, 1));
      og.setIndex(index);
      this.outlineParts.push(og);
      this.outlineTris += index.length / 3;
    }
    geo.dispose();
  }

  build() {
    const geometry = this.parts.length ? mergeGeometries(this.parts, false) : new THREE.BufferGeometry();
    if (!geometry) throw new Error('MeshBuilder: mergeGeometries failed');
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    let outlineGeometry = null;
    if (this.outlineParts.length) {
      outlineGeometry = mergeGeometries(this.outlineParts, false);
      if (outlineGeometry) {
        outlineGeometry.computeBoundingSphere();
        outlineGeometry.computeBoundingBox();
      }
    }
    this.parts.length = 0;
    this.outlineParts.length = 0;
    return { geometry, outlineGeometry, tris: this.tris, outlineTris: this.outlineTris };
  }
}

/** Skin weights along a bone chain (joints[k] = pivot of bones[k]; last joint = chain end). */
export function chainSkin(joints, boneIdx, parentBone) {
  const n = boneIdx.length;
  const P = new THREE.Vector3();
  const AB = new THREE.Vector3();
  const AP = new THREE.Vector3();
  return (x, y, z, i, idx, w) => {
    P.set(x, y, z);
    let best = Infinity;
    let bk = 0;
    let bs = 0;
    for (let k = 0; k < n; k++) {
      AB.subVectors(joints[k + 1], joints[k]);
      AP.subVectors(P, joints[k]);
      const len2 = AB.lengthSq() || 1e-6;
      const sRaw = AP.dot(AB) / len2;
      const s = clamp(sRaw, 0, 1);
      const d = AP.addScaledVector(AB, -s).lengthSq();
      if (d < best - 1e-9) {
        best = d;
        bk = k;
        bs = sRaw;
      }
    }
    if (bk === 0 && bs < -0.15) {
      idx[0] = parentBone;
      w[0] = 1;
      return;
    }
    const s = clamp(bs, 0, 1);
    if (s < 0.5) {
      const prev = bk === 0 ? parentBone : boneIdx[bk - 1];
      const wp = 0.5 - s;
      idx[0] = boneIdx[bk];
      w[0] = 1 - wp;
      idx[1] = prev;
      w[1] = wp;
    } else if (bk < n - 1) {
      const wn = s - 0.5;
      idx[0] = boneIdx[bk];
      w[0] = 1 - wn;
      idx[1] = boneIdx[bk + 1];
      w[1] = wn;
    } else {
      idx[0] = boneIdx[bk];
      w[0] = 1;
    }
  };
}

// =========================================================================================================
// Driver proportions (driver space: origin = seat surface under the hips, +Z forward, +Y up)
// =========================================================================================================

const R = 0.315; // head radius
const NECK = new THREE.Vector3(0, 0.385, 0);
const HC = new THREE.Vector3(0, 0.655, 0.005); // head centre
const HEAD_SX = 1.04;
const SHOULDER_X = 0.146;
const SHOULDER_Y = 0.285;
const ARM_LEN = 0.265;
export const DRIVER_HEAD_CENTER = HC.clone();
export const DRIVER_HEAD_RADIUS = R;

/** Unit direction from azimuth (from +Z towards +X) and elevation. */
function dirAE(az, el, out = new THREE.Vector3()) {
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}
/** Point on (a shell around) the head, accounting for the head's horizontal stretch. */
function onHead(az, el, k = 1.0, out = new THREE.Vector3()) {
  dirAE(az, el, out);
  out.x *= HEAD_SX;
  return out.multiplyScalar(R * k).add(HC);
}
const radialHint = (p, t, out) => out.subVectors(p, HC).normalize();

// =========================================================================================================
// Face painting
// =========================================================================================================

export const EXPRESSIONS = ['neutral', 'blink', 'happy', 'determined', 'hurt', 'dizzy', 'sad'];
// (+ 'portrait': eyes-open friendly face used by Portraits.js; not pre-warmed for racers)

const EXPR_BASE = {
  tsundere: { lid: 0.1, browTilt: -0.4, browY: -0.01, mouth: 'pout', blush: 0.55 },
  neutral: { lid: 0.2, browTilt: 0.02, browY: 0, mouth: 'flat', blush: 0.32 },
  sleepy: { lid: 0.5, browTilt: 0.18, browY: 0.0, mouth: 'cat', blush: 0.42 },
  cheerful: { lid: 0.04, browTilt: 0.18, browY: 0.02, mouth: 'smile', blush: 0.5 },
  worried: { lid: 0.06, browTilt: 0.5, browY: 0.02, mouth: 'wavy', blush: 0.45 },
  smug: { lid: 0.28, browTilt: -0.12, browY: 0.03, mouth: 'smirk', blush: 0.38 },
  excited: { lid: 0.0, browTilt: 0.22, browY: 0.04, mouth: 'open', blush: 0.55, sparkle: true },
  stern: { lid: 0.3, browTilt: -0.25, browY: -0.01, mouth: 'flat', blush: 0.2 },
};

function exprParams(base, name) {
  const b = { eye: 'open', lid: 0.1, browTilt: 0, browY: 0, mouth: 'small', blush: 0.35, sparkle: false, ...(EXPR_BASE[base] || EXPR_BASE.neutral) };
  switch (name) {
    case 'blink':
      return { ...b, eye: 'closed' };
    case 'happy':
      return {
        ...b,
        eye: base === 'excited' || base === 'stern' ? 'open' : 'happy',
        lid: base === 'stern' ? 0.12 : 0,
        browTilt: 0.25,
        browY: 0.04,
        mouth: base === 'stern' ? 'smile' : base === 'tsundere' ? 'fanggrin' : 'grin',
        blush: b.blush + 0.25,
        sparkle: base === 'excited',
      };
    case 'determined':
      return {
        ...b,
        eye: 'open',
        lid: base === 'sleepy' ? 0.06 : base === 'stern' ? 0.3 : 0.2,
        browTilt: -0.6,
        browY: -0.02,
        mouth: base === 'tsundere' || base === 'smug' ? 'fanggrin' : base === 'stern' ? 'flat' : 'grit',
        blush: b.blush * 0.7,
        sparkle: false,
      };
    case 'hurt':
      return { ...b, eye: 'shut', browTilt: 0.55, browY: 0.02, mouth: 'wail', blush: 0.3, sweat: true, sparkle: false };
    case 'dizzy':
      return { ...b, eye: 'swirl', browTilt: 0.45, mouth: 'wavy', blush: 0.3, sweat: true, sparkle: false };
    case 'sad':
      return { ...b, eye: 'open', lid: 0.22, browTilt: 0.7, browY: 0.02, mouth: 'frown', blush: 0.35, tears: true, sparkle: false };
    case 'portrait': {
      // friendly "profile picture" face: eyes open (shows the iris colours), personality kept in brows/mouth
      const mouth = { tsundere: 'fanggrin', neutral: 'small', sleepy: 'cat', cheerful: 'grin', worried: 'smile', smug: 'smirk', excited: 'open', stern: 'smile' };
      return {
        ...b,
        eye: 'open',
        lid: base === 'sleepy' ? 0.36 : base === 'stern' || base === 'smug' ? 0.2 : Math.min(b.lid, 0.12),
        browTilt: base === 'tsundere' ? -0.18 : base === 'stern' ? -0.12 : b.browTilt,
        mouth: mouth[base] || 'smile',
        blush: Math.min(0.75, b.blush + 0.12),
        sparkle: base === 'excited' || base === 'cheerful',
      };
    }
    default:
      return b;
  }
}

function faceStyle(look) {
  const hair = look.hair || '#333333';
  const lightHair = luminance(hair) > 0.6;
  return {
    skin: look.skin || '#ffe6da',
    iris: look.eyes || '#5b8fe0',
    irisR: look.eyesRight || look.eyes || '#5b8fe0',
    pupil: look.pupil || 'round',
    lash: lightHair ? mixHex(shadeHex(hair, 0.42), '#2a2030', 0.5) : mixHex(shadeHex(hair, 0.55), '#170f16', 0.55),
    brow: lightHair ? shadeHex(hair, 0.72) : mixHex(hair, '#241820', 0.35),
    hair,
    fang: !!look.fang,
    glasses: look.glasses || null,
    base: look.expression || 'neutral',
  };
}

// Eye layout in head units (head radius = 1; +x = viewer's right, +y = up).
const EX = 0.37;
const EY = -0.2;
const EW = 0.36;
const EH = 0.44;

function drawEye(g, st, p, side) {
  const ex = side * EX;
  const ey = EY;
  const w = EW;
  const h = EH;
  const irisCol = side < 0 ? st.iris : st.irisR;
  const innerX = ex - side * w * 0.47;
  const outerX = ex + side * w * 0.53;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (p.eye === 'open') {
    const lid = p.lid;
    const inY = ey + h * 0.14 - lid * h * 0.4;
    const outY = ey + h * 0.27 - lid * h * 0.62;
    const cpx = ex + side * w * 0.04;
    const cpy = ey + h * (0.74 - lid * 1.05);
    const eyePath = () => {
      g.beginPath();
      g.moveTo(innerX, inY);
      g.quadraticCurveTo(cpx, cpy, outerX, outY);
      g.bezierCurveTo(outerX + side * w * 0.03, ey - h * 0.14, ex + side * w * 0.36, ey - h * 0.53, ex, ey - h * 0.53);
      g.bezierCurveTo(ex - side * w * 0.34, ey - h * 0.53, innerX - side * w * 0.03, ey - h * 0.18, innerX, inY);
      g.closePath();
    };
    g.save();
    eyePath();
    g.clip();
    g.fillStyle = '#fdfcff';
    g.fillRect(ex - w, ey - h, 2 * w, 2 * h);
    // sclera shading near the lid
    const sg = g.createLinearGradient(0, ey + h * 0.5, 0, ey);
    sg.addColorStop(0, 'rgba(120,110,150,0.45)');
    sg.addColorStop(1, 'rgba(120,110,150,0)');
    g.fillStyle = sg;
    g.fillRect(ex - w, ey - h, 2 * w, 2 * h);
    // iris
    const ix = ex + side * w * 0.03;
    const iy = ey - h * 0.06;
    const irx = w * 0.37;
    const iry = h * 0.48;
    const ig = g.createLinearGradient(0, iy + iry, 0, iy - iry);
    ig.addColorStop(0, shadeHex(irisCol, 0.28));
    ig.addColorStop(0.42, shadeHex(irisCol, 0.85));
    ig.addColorStop(0.75, irisCol);
    ig.addColorStop(1, shadeHex(irisCol, 1.45));
    g.fillStyle = ig;
    g.beginPath();
    g.ellipse(ix, iy, irx, iry, 0, 0, TAU);
    g.fill();
    // bottom glow
    const bg = g.createRadialGradient(ix, iy - iry * 0.6, 0, ix, iy - iry * 0.6, irx * 1.05);
    bg.addColorStop(0, rgba(shadeHex(irisCol, 1.7), 0.75));
    bg.addColorStop(1, rgba(shadeHex(irisCol, 1.7), 0));
    g.fillStyle = bg;
    g.beginPath();
    g.ellipse(ix, iy, irx, iry, 0, 0, TAU);
    g.fill();
    // pupil
    g.fillStyle = shadeHex(irisCol, 0.18);
    g.beginPath();
    if (st.pupil === 'slit') g.ellipse(ix, iy + h * 0.02, irx * 0.2, iry * 0.72, 0, 0, TAU);
    else g.ellipse(ix, iy + h * 0.02, irx * 0.46, iry * 0.46, 0, 0, TAU);
    g.fill();
    if (st.pupil === 'slit') {
      g.strokeStyle = rgba(shadeHex(irisCol, 1.35), 0.8);
      g.lineWidth = 0.012;
      g.stroke();
    }
    // iris rim
    g.strokeStyle = shadeHex(irisCol, 0.3);
    g.lineWidth = 0.018;
    g.beginPath();
    g.ellipse(ix, iy, irx, iry, 0, 0, TAU);
    g.stroke();
    // lid shadow
    const lg = g.createLinearGradient(0, cpy, 0, iy + iry * 0.1);
    lg.addColorStop(0, 'rgba(30,12,40,0.55)');
    lg.addColorStop(1, 'rgba(30,12,40,0)');
    g.fillStyle = lg;
    g.fillRect(ex - w, iy, 2 * w, h);
    // highlights
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(ix - irx * 0.36, iy + iry * 0.36, irx * 0.34, iry * 0.25, -0.35, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(ix + irx * 0.38, iy - iry * 0.42, irx * 0.15, iry * 0.11, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.ellipse(ix + irx * 0.1, iy - iry * 0.7, irx * 0.4, iry * 0.07, 0, 0, TAU);
    g.fill();
    if (p.sparkle) {
      drawStar(g, ix + irx * 0.3, iy + iry * 0.1, irx * 0.34, '#ffffff');
      drawStar(g, ix - irx * 0.35, iy - iry * 0.35, irx * 0.18, 'rgba(255,255,255,0.9)');
    }
    g.restore();
    // upper lash line: tapered crescent, thick at the outer corner
    const Q = (t) => {
      const mt = 1 - t;
      return [mt * mt * innerX + 2 * mt * t * cpx + t * t * outerX, mt * mt * inY + 2 * mt * t * cpy + t * t * outY];
    };
    g.fillStyle = st.lash;
    g.beginPath();
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const [x, y] = Q(t);
      const th = lerp(0.016, 0.062, Math.pow(t, 1.2)) * (1 - p.lid * 0.3);
      if (i === 0) g.moveTo(x, y + th);
      else g.lineTo(x, y + th);
    }
    for (let i = N; i >= 0; i--) {
      const [x, y] = Q(i / N);
      g.lineTo(x, y - 0.006);
    }
    g.closePath();
    g.fill();
    // outer wing flick + little lashes
    g.beginPath();
    g.moveTo(outerX - side * 0.02, outY + 0.045);
    g.lineTo(outerX + side * 0.065, outY + 0.05);
    g.lineTo(outerX + side * 0.01, outY - 0.022);
    g.closePath();
    g.fill();
    g.strokeStyle = st.lash;
    g.lineWidth = 0.014;
    g.beginPath();
    g.moveTo(outerX - side * 0.01, outY + 0.02);
    g.quadraticCurveTo(outerX + side * 0.05, outY + 0.02, outerX + side * 0.08, outY - 0.03);
    g.stroke();
    // lower lash
    g.strokeStyle = rgba(st.lash, 0.8);
    g.lineWidth = 0.013;
    g.beginPath();
    g.moveTo(outerX - side * w * 0.04, ey - h * 0.1);
    g.bezierCurveTo(outerX - side * w * 0.07, ey - h * 0.38, ex + side * w * 0.3, ey - h * 0.52, ex + side * w * 0.08, ey - h * 0.55);
    g.stroke();
    // crease
    g.strokeStyle = rgba(st.lash, 0.4);
    g.lineWidth = 0.009;
    g.beginPath();
    g.moveTo(ex - side * w * 0.05, cpy - 0.02 + 0.045);
    g.quadraticCurveTo(ex + side * w * 0.3, cpy + 0.035, outerX - side * w * 0.02, outY + 0.09);
    g.stroke();
    if (p.tears) {
      g.fillStyle = 'rgba(160,220,255,0.85)';
      g.strokeStyle = 'rgba(70,150,220,0.9)';
      g.lineWidth = 0.01;
      g.beginPath();
      g.moveTo(ex + side * w * 0.3, ey - h * 0.45);
      g.quadraticCurveTo(ex + side * w * 0.42, ey - h * 0.85, ex + side * w * 0.3, ey - h * 0.95);
      g.quadraticCurveTo(ex + side * w * 0.18, ey - h * 0.85, ex + side * w * 0.3, ey - h * 0.45);
      g.fill();
      g.stroke();
      g.strokeStyle = 'rgba(190,235,255,0.9)';
      g.lineWidth = 0.02;
      g.beginPath();
      g.moveTo(ex - w * 0.35, ey - h * 0.5);
      g.quadraticCurveTo(ex, ey - h * 0.58, ex + w * 0.35, ey - h * 0.5);
      g.stroke();
    }
  } else if (p.eye === 'closed') {
    g.strokeStyle = st.lash;
    g.lineWidth = 0.04;
    g.beginPath();
    g.moveTo(innerX, ey + h * 0.02);
    g.quadraticCurveTo(ex, ey - h * 0.26, outerX, ey + h * 0.1);
    g.stroke();
    g.lineWidth = 0.018;
    g.beginPath();
    g.moveTo(outerX - side * 0.01, ey + h * 0.09);
    g.lineTo(outerX + side * 0.05, ey + h * 0.2);
    g.moveTo(outerX - side * 0.05, ey + h * 0.0);
    g.lineTo(outerX + side * 0.0, ey - h * 0.08);
    g.stroke();
  } else if (p.eye === 'happy') {
    g.strokeStyle = st.lash;
    g.lineWidth = 0.05;
    g.beginPath();
    g.moveTo(ex - w * 0.42, ey - h * 0.12);
    g.quadraticCurveTo(ex, ey + h * 0.48, ex + w * 0.42, ey - h * 0.12);
    g.stroke();
    g.lineWidth = 0.018;
    g.beginPath();
    g.moveTo(ex + side * w * 0.4, ey - h * 0.02);
    g.lineTo(ex + side * w * 0.56, ey + h * 0.06);
    g.stroke();
  } else if (p.eye === 'shut') {
    g.strokeStyle = st.lash;
    g.lineWidth = 0.05;
    g.beginPath();
    g.moveTo(ex + side * w * 0.38, ey + h * 0.26);
    g.lineTo(ex - side * w * 0.32, ey + h * 0.0);
    g.lineTo(ex + side * w * 0.38, ey - h * 0.26);
    g.stroke();
  } else if (p.eye === 'swirl') {
    g.strokeStyle = st.lash;
    g.lineWidth = 0.022;
    g.beginPath();
    const turns = 2.6;
    for (let k = 0; k <= 64; k++) {
      const f = k / 64;
      const a = f * turns * TAU * side;
      const rr = 0.012 + f * w * 0.46;
      const x = ex + Math.cos(a) * rr;
      const y = ey + Math.sin(a) * rr * 1.12;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // eyebrow
  const by = ey + h * 0.8 + p.browY;
  g.strokeStyle = st.brow;
  g.lineWidth = 0.024;
  g.beginPath();
  const bix = ex - side * w * 0.36;
  const box = ex + side * w * 0.46;
  const biy = by + p.browTilt * 0.08;
  const boy = by - 0.01 - p.browTilt * 0.025;
  g.moveTo(bix, biy);
  g.quadraticCurveTo(ex + side * w * 0.05, by + 0.04 + p.browTilt * 0.02, box, boy);
  g.stroke();
}

function drawStar(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const rr = i % 2 === 0 ? r : r * 0.28;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

function drawMouth(g, st, p) {
  const mx = 0;
  const my = -0.6;
  const dark = '#8a2236';
  const line = '#6d2433';
  const tongue = '#ff8595';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = line;
  g.lineWidth = 0.017;
  const fang = (x, y, s = 1) => {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(x - 0.012 * s, y);
    g.lineTo(x + 0.014 * s, y);
    g.lineTo(x + 0.002 * s, y - 0.036 * s);
    g.closePath();
    g.fill();
  };
  const openShape = (w, top, bot, fill = dark) => {
    g.beginPath();
    g.moveTo(mx - w, my + top);
    g.quadraticCurveTo(mx, my + top + 0.012, mx + w, my + top);
    g.bezierCurveTo(mx + w * 0.95, my - bot * 0.75, mx + w * 0.45, my - bot, mx, my - bot);
    g.bezierCurveTo(mx - w * 0.45, my - bot, mx - w * 0.95, my - bot * 0.75, mx - w, my + top);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = tongue;
    g.beginPath();
    g.ellipse(mx, my - bot * 0.95, w * 0.65, bot * 0.45, 0, 0, TAU);
    g.fill();
    g.restore();
    g.lineWidth = 0.012;
    g.stroke();
  };
  switch (p.mouth) {
    case 'flat':
      g.beginPath();
      g.moveTo(mx - 0.045, my + 0.004);
      g.quadraticCurveTo(mx, my - 0.006, mx + 0.045, my + 0.004);
      g.stroke();
      break;
    case 'small':
      g.beginPath();
      g.moveTo(mx - 0.05, my + 0.01);
      g.quadraticCurveTo(mx, my - 0.03, mx + 0.05, my + 0.01);
      g.stroke();
      break;
    case 'pout':
      openShape(0.058, 0.012, 0.065);
      if (st.fang) fang(mx + 0.028, my + 0.016, 0.9);
      break;
    case 'smile':
      openShape(0.085, 0.01, 0.085);
      break;
    case 'open':
      openShape(0.075, 0.018, 0.11);
      break;
    case 'grin':
      openShape(0.12, 0.02, 0.13);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(mx - 0.1, my + 0.018);
      g.quadraticCurveTo(mx, my + 0.03, mx + 0.1, my + 0.018);
      g.lineTo(mx + 0.09, my - 0.004);
      g.quadraticCurveTo(mx, my + 0.004, mx - 0.09, my - 0.004);
      g.closePath();
      g.fill();
      if (st.fang) fang(mx + 0.05, my + 0.012, 1.1);
      break;
    case 'fanggrin':
      openShape(0.1, 0.015, 0.09);
      if (st.fang) {
        fang(mx + 0.045, my + 0.013, 1.1);
        fang(mx - 0.05, my + 0.013, 0.8);
      }
      break;
    case 'cat':
      g.beginPath();
      g.moveTo(mx - 0.075, my + 0.02);
      g.quadraticCurveTo(mx - 0.04, my - 0.035, mx, my + 0.0);
      g.quadraticCurveTo(mx + 0.04, my - 0.035, mx + 0.075, my + 0.02);
      g.stroke();
      break;
    case 'wavy':
      g.beginPath();
      for (let k = 0; k <= 16; k++) {
        const f = k / 16;
        const x = mx - 0.07 + f * 0.14;
        const y = my + Math.sin(f * TAU * 1.5) * 0.013;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      break;
    case 'smirk':
      g.beginPath();
      g.moveTo(mx - 0.06, my - 0.005);
      g.quadraticCurveTo(mx + 0.01, my - 0.03, mx + 0.07, my + 0.03);
      g.stroke();
      g.lineWidth = 0.01;
      g.beginPath();
      g.moveTo(mx + 0.07, my + 0.03);
      g.lineTo(mx + 0.082, my + 0.012);
      g.stroke();
      break;
    case 'frown':
      g.beginPath();
      g.moveTo(mx - 0.06, my - 0.02);
      g.quadraticCurveTo(mx, my + 0.03, mx + 0.06, my - 0.02);
      g.stroke();
      break;
    case 'grit': {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(mx - 0.085, my + 0.02);
      g.quadraticCurveTo(mx, my + 0.035, mx + 0.085, my + 0.02);
      g.quadraticCurveTo(mx + 0.08, my - 0.045, mx, my - 0.05);
      g.quadraticCurveTo(mx - 0.08, my - 0.045, mx - 0.085, my + 0.02);
      g.closePath();
      g.fill();
      g.lineWidth = 0.013;
      g.stroke();
      g.lineWidth = 0.008;
      g.beginPath();
      g.moveTo(mx - 0.075, my - 0.012);
      g.lineTo(mx + 0.075, my - 0.012);
      g.moveTo(mx - 0.03, my + 0.024);
      g.lineTo(mx - 0.03, my - 0.045);
      g.moveTo(mx + 0.03, my + 0.024);
      g.lineTo(mx + 0.03, my - 0.045);
      g.stroke();
      break;
    }
    case 'wail': {
      g.beginPath();
      g.moveTo(mx - 0.08, my + 0.01);
      for (let k = 0; k <= 8; k++) {
        const f = k / 8;
        g.lineTo(mx - 0.08 + f * 0.16, my + 0.01 + (k % 2 ? 0.014 : -0.004));
      }
      g.quadraticCurveTo(mx + 0.06, my - 0.1, mx, my - 0.1);
      g.quadraticCurveTo(mx - 0.06, my - 0.1, mx - 0.08, my + 0.01);
      g.closePath();
      g.fillStyle = dark;
      g.fill();
      g.lineWidth = 0.012;
      g.stroke();
      break;
    }
    default:
      g.beginPath();
      g.moveTo(mx - 0.04, my);
      g.lineTo(mx + 0.04, my);
      g.stroke();
  }
}

function paintFace(canvas, look, name) {
  const S = canvas.width;
  const g = canvas.getContext('2d');
  const st = faceStyle(look);
  const p = exprParams(st.base, name);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, S, S);
  g.fillStyle = st.skin;
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, Math.ceil(S * 0.075));
  // head units: x in [-1, 1] -> [0, S]; y in [-1, 1] -> [S, 0.1 S]
  g.setTransform(0.5 * S, 0, 0, -0.45 * S, 0.5 * S, 0.55 * S);
  // hair shadow on the forehead
  const hs = g.createLinearGradient(0, 0.62, 0, 0.12);
  hs.addColorStop(0, rgba(mixHex(shadeHex(st.skin, 0.72), st.hair, 0.25), 0.7));
  hs.addColorStop(1, rgba(mixHex(shadeHex(st.skin, 0.72), st.hair, 0.25), 0));
  g.fillStyle = hs;
  g.fillRect(-1, 0.1, 2, 0.8);
  // blush
  if (p.blush > 0) {
    for (const s of [-1, 1]) {
      const bx = s * 0.5;
      const by = -0.44;
      g.save();
      g.translate(bx, by);
      g.scale(1, 0.55);
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 0.17);
      rg.addColorStop(0, `rgba(255,105,130,${0.55 * p.blush})`);
      rg.addColorStop(1, 'rgba(255,105,130,0)');
      g.fillStyle = rg;
      g.fillRect(-0.2, -0.2, 0.4, 0.4);
      g.restore();
      g.strokeStyle = `rgba(232,80,105,${Math.min(0.75, 0.7 * p.blush)})`;
      g.lineWidth = 0.011;
      g.lineCap = 'round';
      g.beginPath();
      for (let k = -1; k <= 1; k++) {
        g.moveTo(bx + k * 0.05 - 0.018, by - 0.025);
        g.lineTo(bx + k * 0.05 + 0.018, by + 0.028);
      }
      g.stroke();
    }
  }
  // nose
  g.strokeStyle = rgba(shadeHex(st.skin, 0.6), 0.7);
  g.lineWidth = 0.013;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0.012, -0.405);
  g.lineTo(-0.004, -0.43);
  g.stroke();
  // eyes
  drawEye(g, st, p, -1);
  drawEye(g, st, p, 1);
  // glasses
  if (st.glasses) {
    g.strokeStyle = st.glasses;
    g.lineWidth = 0.03;
    for (const s of [-1, 1]) {
      const cx = s * EX;
      const cy = EY + 0.01;
      roundRect(g, cx - 0.25, cy - 0.21, 0.5, 0.43, 0.11);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fill();
      g.stroke();
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 0.018;
      g.beginPath();
      g.moveTo(cx - 0.14, cy + 0.12);
      g.lineTo(cx - 0.05, cy + 0.17);
      g.stroke();
      g.restore();
      g.beginPath();
      g.moveTo(cx + s * 0.25, cy + 0.1);
      g.lineTo(s * 0.99, cy + 0.14);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(-EX + 0.25, EY + 0.1);
    g.quadraticCurveTo(0, EY + 0.16, EX - 0.25, EY + 0.1);
    g.stroke();
  }
  drawMouth(g, st, p);
  // sweat drop
  if (p.sweat) {
    const x = 0.66;
    const y = 0.24;
    g.fillStyle = 'rgba(170,225,255,0.95)';
    g.strokeStyle = '#3f8fd6';
    g.lineWidth = 0.014;
    g.beginPath();
    g.moveTo(x, y + 0.12);
    g.quadraticCurveTo(x + 0.07, y - 0.02, x, y - 0.05);
    g.quadraticCurveTo(x - 0.07, y - 0.02, x, y + 0.12);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(x - 0.015, y - 0.005, 0.012, 0.022, 0, 0, TAU);
    g.fill();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

const _faceCache = new Map();
/** Cached face CanvasTexture for (character, expression, size). */
export function getFaceTexture(character, expr = 'neutral', size = 512) {
  const key = `${character.id}|${expr}|${size}`;
  let tex = _faceCache.get(key);
  if (tex) return tex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  paintFace(cv, character.look || {}, expr);
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.name = `face:${key}`;
  _faceCache.set(key, tex);
  return tex;
}

// =========================================================================================================
// Halo
// =========================================================================================================

function ringShape(r0, r1) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, 0, TAU, false);
  const h = new THREE.Path();
  h.absarc(0, 0, r0, 0, TAU, true);
  s.holes.push(h);
  return s;
}
function polyShape(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}
function rot2(x, y, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}
/** Radial bar from r0 to r1 at angle a with width w. */
function barShape(a, r0, r1, w) {
  return polyShape([rot2(r0, -w / 2, a), rot2(r1, -w / 2, a), rot2(r1, w / 2, a), rot2(r0, w / 2, a)]);
}
function circleShape(x, y, r) {
  const s = new THREE.Shape();
  s.absarc(x, y, r, 0, TAU, false);
  return s;
}
function arcSegmentShape(r0, r1, a0, a1) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, a0, a1, false);
  s.absarc(0, 0, r0, a1, a0, true);
  s.closePath();
  return s;
}

function haloShapes(shape, variant = {}) {
  const S = [];
  switch (shape) {
    case 'crosshair': {
      // Serika: target ring, crosshair ticks and four arrow heads pointing in from the outer ring
      S.push(ringShape(0.8, 0.93));
      S.push(ringShape(0.42, 0.5));
      for (let i = 0; i < 4; i++) S.push(barShape((i * Math.PI) / 2, 0.52, 0.78, 0.075));
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        S.push(polyShape([rot2(0.97, 0, a), rot2(1.24, -0.14, a), rot2(1.16, 0, a), rot2(1.24, 0.14, a)]));
      }
      break;
    }
    case 'ring-cross': {
      S.push(ringShape(0.78, 0.9));
      for (let i = 0; i < 4; i++) S.push(barShape((i * Math.PI) / 2 + Math.PI / 4, 0.5, 1.22, 0.065));
      break;
    }
    case 'ring-double': {
      S.push(ringShape(0.88, 0.98));
      S.push(ringShape(0.62, 0.72));
      for (let i = 0; i < 6; i++) S.push(circleShape(...rot2(0.8, 0, (i * TAU) / 6 + 0.26), 0.045));
      break;
    }
    case 'ring-dots': {
      S.push(ringShape(0.74, 0.86));
      for (let i = 0; i < 8; i++) S.push(circleShape(...rot2(1.04, 0, (i * TAU) / 8), 0.075));
      break;
    }
    case 'ring-plus': {
      S.push(ringShape(0.76, 0.88));
      for (let i = 0; i < 4; i++) {
        const [cx, cy] = rot2(1.1, 0, (i * TAU) / 4 + Math.PI / 4);
        S.push(polyShape([[cx - 0.13, cy - 0.04], [cx + 0.13, cy - 0.04], [cx + 0.13, cy + 0.04], [cx - 0.13, cy + 0.04]]));
        S.push(polyShape([[cx - 0.04, cy - 0.13], [cx + 0.04, cy - 0.13], [cx + 0.04, cy - 0.041], [cx - 0.04, cy - 0.041]]));
        S.push(polyShape([[cx - 0.04, cy + 0.041], [cx + 0.04, cy + 0.041], [cx + 0.04, cy + 0.13], [cx - 0.04, cy + 0.13]]));
      }
      break;
    }
    case 'ring-spikes': {
      const n = variant.spikes ?? 8;
      const len = variant.spikeLen ?? 1.22;
      S.push(ringShape(0.68, 0.82));
      for (let i = 0; i < n; i++) {
        const a = (i * TAU) / n;
        S.push(polyShape([rot2(0.8, -0.13, a), rot2(len, 0, a), rot2(0.8, 0.13, a)]));
      }
      if (variant.inner) S.push(ringShape(0.46, 0.53));
      break;
    }
    case 'ring-digital': {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a0 = (i * TAU) / n + 0.05;
        const a1 = ((i + 1) * TAU) / n - 0.05;
        S.push(arcSegmentShape(0.76, 0.92, a0, a1));
      }
      for (let i = 0; i < 4; i++) {
        const [cx, cy] = rot2(1.1, 0, (i * TAU) / 4 + 0.4);
        S.push(polyShape([[cx - 0.06, cy - 0.06], [cx + 0.06, cy - 0.06], [cx + 0.06, cy + 0.06], [cx - 0.06, cy + 0.06]]));
      }
      for (let i = 0; i < 4; i++) {
        const [cx, cy] = rot2(0.62, 0, (i * TAU) / 4 + 1.2);
        S.push(polyShape([[cx - 0.04, cy - 0.04], [cx + 0.04, cy - 0.04], [cx + 0.04, cy + 0.04], [cx - 0.04, cy + 0.04]]));
      }
      break;
    }
    default:
      S.push(ringShape(0.78, 0.92));
  }
  return S;
}

/** Halo lying in the XZ plane (outer radius ≈ rh * 1.2). */
export function haloGeometry(shape, rh, variant = {}, curveSegments = 20) {
  const g = new THREE.ExtrudeGeometry(haloShapes(shape, variant), { depth: 0.07, bevelEnabled: false, curveSegments });
  g.translate(0, 0, -0.035);
  g.rotateX(-Math.PI / 2);
  g.scale(rh, rh, rh);
  g.deleteAttribute('uv');
  return g;
}

let _haloGlowTex = null;
export function getHaloGlowTexture() {
  if (_haloGlowTex) return _haloGlowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,0.12)');
  rg.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  rg.addColorStop(0.64, 'rgba(255,255,255,1)');
  rg.addColorStop(0.78, 'rgba(255,255,255,0.4)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  _haloGlowTex = new THREE.CanvasTexture(cv);
  _haloGlowTex.colorSpace = THREE.SRGBColorSpace;
  return _haloGlowTex;
}

// =========================================================================================================
// Character asset (geometry + skeleton definition), cached per character & quality
// =========================================================================================================

const _assetCache = new Map();

export function getCharacterAsset(character, quality = 'high') {
  const key = `${character.id}|${quality}`;
  let a = _assetCache.get(key);
  if (!a) {
    a = buildCharacterAsset(character, quality);
    _assetCache.set(key, a);
  }
  return a;
}

function buildCharacterAsset(character, quality) {
  const q = QUALITY_DETAIL[quality] ?? 1;
  const look = character.look || {};
  const outfit = look.outfit || {};
  const rng = mulberry32(hashString(character.id || 'x'));
  const mb = new MeshBuilder({ whiteUV: [0.5, 0.965], outlines: quality !== 'low' });
  const hairCol = look.hair || '#333344';
  const hairHi = look.hairHighlight || shadeHex(hairCol, 1.3);
  const skin = look.skin || '#ffe6da';

  // ---- skeleton definition -------------------------------------------------------------------------
  const bones = [];
  const addBone = (name, parent, pos) => {
    bones.push({ name, parent, pos: pos.clone() });
    return bones.length - 1;
  };
  const B_ROOT = addBone('root', -1, new THREE.Vector3(0, 0, 0));
  const B_SPINE = addBone('spine', B_ROOT, new THREE.Vector3(0, 0.06, 0));
  const B_HEAD = addBone('head', B_SPINE, NECK);
  const B_ARM_L = addBone('armL', B_SPINE, new THREE.Vector3(SHOULDER_X, SHOULDER_Y, 0));
  const B_ARM_R = addBone('armR', B_SPINE, new THREE.Vector3(-SHOULDER_X, SHOULDER_Y, 0));
  const chains = [];
  const addChain = (name, parent, joints, cfg) => {
    const ids = [];
    let par = parent;
    for (let i = 0; i < joints.length - 1; i++) {
      par = addBone(`${name}${i}`, par, joints[i]);
      ids.push(par);
    }
    const ch = { name, bones: ids, joints: joints.map((j) => j.clone()), parent, ...cfg };
    chains.push(ch);
    return ch;
  };

  const ctx = { mb, q, look, outfit, rng, hairCol, hairHi, skin, B_ROOT, B_SPINE, B_HEAD, B_ARM_L, B_ARM_R, addChain, bones };

  buildHead(ctx);
  buildHair(ctx);
  buildHeadExtras(ctx);
  buildBody(ctx);
  buildArms(ctx);
  buildWeapon(ctx);

  const built = mb.build();

  // ---- halo ----------------------------------------------------------------------------------------
  const halo = look.halo || { shape: 'ring', color: '#ffe066', glow: '#fff3b0' };
  const variant = {};
  if (look.horns?.type === 'big-curved') Object.assign(variant, { spikes: 12, spikeLen: 1.3, inner: true });
  const haloR = 0.215;
  const haloGeo = haloGeometry(halo.shape, haloR, variant, Math.round(22 * q));
  let earTop = HC.y + R * 1.2;
  if (look.ears?.type === 'cat') earTop = HC.y + R * 1.42;
  if (look.ears?.type === 'wolf') earTop = HC.y + R * 1.55;
  const haloPos = new THREE.Vector3(0, Math.max(HC.y + R * 1.5, earTop + 0.07), -0.04);

  return {
    id: character.id,
    geometry: built.geometry,
    outlineGeometry: built.outlineGeometry,
    tris: built.tris,
    outlineTris: built.outlineTris,
    bones,
    chains,
    boneIds: { root: B_ROOT, spine: B_SPINE, head: B_HEAD, armL: B_ARM_L, armR: B_ARM_R },
    armBindDir: ctx.armBindDir,
    haloGeometry: haloGeo,
    haloPos,
    haloRadius: haloR,
    haloColor: halo.color || '#ffe066',
    haloGlow: halo.glow || halo.color || '#fff3b0',
  };
}

// ---- head ---------------------------------------------------------------------------------------------

function buildHead({ mb, q, skin, B_HEAD, B_SPINE }) {
  const g = new THREE.SphereGeometry(R, Math.round(30 * q), Math.round(22 * q), -Math.PI / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    uv.setXY(i, 0.5 + 0.5 * (x / R), 0.45 + 0.45 * (y / R));
    const yn = y / R;
    x *= HEAD_SX;
    if (yn < 0) {
      const k = 1 - 0.14 * yn * yn;
      x *= k;
      z *= 1 - 0.07 * yn * yn;
    }
    if (z > 0) z *= 0.94;
    y *= 0.98;
    pos.setXYZ(i, x + HC.x, y + HC.y, z + HC.z);
  }
  g.computeVertexNormals();
  mb.add(g, { keepUV: true, bone: B_HEAD, outlineColor: shadeHex(skin, 0.85) });
  // neck
  mb.add(new THREE.CylinderGeometry(0.043, 0.05, 0.15, Math.round(10 * q), 1, true), {
    matrix: new THREE.Matrix4().makeTranslation(0, 0.365, 0),
    color: shadeHex(skin, 0.92),
    bone: B_SPINE,
    outline: 0,
  });
}

// ---- hair ---------------------------------------------------------------------------------------------

const HAIR_PRESETS = {
  'twintails-long': { back: 'nape', bangs: { count: 7, span: 64, len: [8, 2] }, sideLocks: { len: 1.05, az: 80, width: 0.06 }, twintails: true },
  'medium-straight': { back: 'medium', bangs: { count: 8, span: 66, len: [6, 0], messy: 0.5 }, sideLocks: { len: 1.15, az: 82, width: 0.065 } },
  'long-ahoge': { back: 'long', backLen: 0.02, bangs: { count: 7, span: 64, len: [6, 0] }, sideLocks: { len: 1.5, az: 82, width: 0.07 }, ahoge: true },
  'long-wavy': { back: 'long', backLen: 0.0, wave: 0.035, bangs: { count: 7, span: 62, len: [10, 2] }, sideLocks: { len: 1.6, az: 80, width: 0.075, wave: 0.03 } },
  'short-bob': { back: 'bob', bangs: { count: 8, span: 66, len: [4, -2] }, sideLocks: { len: 0.95, az: 84, width: 0.07 } },
  'long-straight': { back: 'long', backLen: 0.05, bangs: { count: 7, span: 64, len: [6, 0] }, sideLocks: { len: 1.65, az: 80, width: 0.07 } },
  'very-long-straight': { back: 'long', backLen: -0.42, bangs: { count: 8, span: 64, len: [4, -2] }, sideLocks: { len: 1.8, az: 80, width: 0.07 } },
  'very-long-wavy': { back: 'long', backLen: -0.3, wave: 0.04, bangs: { count: 8, span: 66, len: [6, -2], messy: 0.6 }, sideLocks: { len: 1.8, az: 80, width: 0.075, wave: 0.03 } },
};

function hairColorFn(base, hi, tHi = 0.22) {
  const cb = vc(base);
  const ch = vc(hi);
  return (x, y, z, i, t, out) => {
    const k = Math.exp(-Math.pow((t - tHi) / 0.1, 2)) * 0.55;
    out.copy(cb).lerp(ch, k);
  };
}

function buildHair(ctx) {
  const { mb, q, look, hairCol, hairHi, B_HEAD } = ctx;
  const preset = HAIR_PRESETS[look.hairStyle] || HAIR_PRESETS['medium-straight'];
  const segScale = q;

  // skull cap
  {
    const g = new THREE.SphereGeometry(1, Math.round(30 * q), Math.round(22 * q), -Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      x *= R * 1.08 * HEAD_SX;
      y *= R * (y > 0 ? 1.07 : 1.03);
      z *= R * (z > 0 ? 1.03 : 1.12);
      pos.setXYZ(i, x + HC.x, y + HC.y + 0.004, z + HC.z);
    }
    g.computeVertexNormals();
    const hairline = (az) => 32 * DEG - 96 * DEG * smoothstep(0.2, 2.9, Math.abs(az));
    const cap = filterTriangles(g, (x, y, z) => {
      const dx = (x - HC.x) / HEAD_SX;
      const dy = y - HC.y;
      const dz = z - HC.z;
      const el = Math.atan2(dy, Math.hypot(dx, dz));
      const az = Math.atan2(dx, dz);
      return el > hairline(az);
    });
    g.dispose();
    const cb = vc(hairCol);
    const ch = vc(hairHi);
    mb.add(cap, {
      bone: B_HEAD,
      colorFn: (x, y, z, i, t, out) => {
        const dx = (x - HC.x) / HEAD_SX;
        const dy = y - HC.y;
        const dz = z - HC.z;
        const el = Math.atan2(dy, Math.hypot(dx, dz));
        const k = smoothstep(0.38, 0.52, el) * (1 - smoothstep(0.66, 0.82, el)) * 0.75;
        out.copy(cb).lerp(ch, k);
      },
    });
  }

  // bangs
  {
    const b = preset.bangs;
    const n = b.count;
    const span = b.span * DEG;
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 0.5 : k / (n - 1);
      const az = lerp(-span, span, f) + (rng01(ctx.rng) - 0.5) * 0.06;
      // longer at the sides / alternating lengths, tips at [elEnd]
      const edge = Math.abs(f - 0.5) * 2;
      let elEnd = lerp(b.len[0], b.len[1], 1 - edge) * DEG;
      if (k % 2 === 1) elEnd += 7 * DEG;
      elEnd += (b.messy ? (rng01(ctx.rng) - 0.5) * 10 * b.messy : 0) * DEG;
      if (edge > 0.8) elEnd -= 16 * DEG;
      const azTip = az * 0.88 + (b.messy ? (rng01(ctx.rng) - 0.5) * 0.12 : 0);
      const pts = [];
      const els = [62, 44, 28, 0, 0];
      for (let s = 0; s < 5; s++) {
        const u = s / 4;
        const el = s < 3 ? els[s] * DEG : lerp(28 * DEG, elEnd, (s - 2) / 2);
        const rr = lerp(0.99, 1.13, Math.pow(u, 1.3));
        pts.push(onHead(lerp(az, azTip, u * u), el, rr));
      }
      const width = (0.07 + 0.012 * (1 - edge)) * (0.9 + rng01(ctx.rng) * 0.25);
      mb.add(
        strandGeo(pts, { r0: width, r1: 0.002, flat: 0.34, seg: Math.round(7 * segScale), radial: 6, taperPow: 1.4, bulge: 0.25, hint: radialHint }),
        { bone: B_HEAD, colorFn: hairColorFn(hairCol, hairHi, 0.3), taper: true }
      );
    }
  }

  // side locks (frame the face)
  if (preset.sideLocks) {
    const s = preset.sideLocks;
    for (const side of [-1, 1]) {
      const az = side * s.az * DEG;
      const bottomY = HC.y - R * s.len;
      const pts = [
        onHead(az * 0.92, 44 * DEG, 1.0),
        onHead(az, 12 * DEG, 1.09),
        onHead(az * 1.02, -22 * DEG, 1.14),
        new THREE.Vector3(side * R * 1.02, lerp(HC.y - R * 0.75, bottomY, 0.35), HC.z + R * 0.12),
        new THREE.Vector3(side * (R * 0.98 + (s.wave ? s.wave : 0)), lerp(HC.y - R * 0.75, bottomY, 0.7), HC.z + R * 0.16),
        new THREE.Vector3(side * R * 0.9, bottomY, HC.z + R * 0.2),
      ];
      mb.add(
        strandGeo(pts, { r0: s.width, r1: 0.002, flat: 0.4, seg: Math.round(10 * segScale), radial: 6, taperPow: 1.6, bulge: 0.35, hint: radialHint }),
        { bone: B_HEAD, colorFn: hairColorFn(hairCol, hairHi, 0.18), taper: true }
      );
      // thinner companion strand
      const pts2 = pts.map((p, i) => p.clone().add(new THREE.Vector3(side * 0.006 * i, 0.03 * (i / 5), -0.035)));
      pts2[pts2.length - 1].y += R * 0.25;
      mb.add(
        strandGeo(pts2, { r0: s.width * 0.7, r1: 0.002, flat: 0.4, seg: Math.round(8 * segScale), radial: 5, taperPow: 1.4, hint: radialHint }),
        { bone: B_HEAD, color: hairCol, taper: true }
      );
    }
  }

  // back hair
  const back = preset.back;
  if (back === 'nape' || back === 'bob' || back === 'medium') {
    const n = back === 'nape' ? 7 : 9;
    const endEl = back === 'nape' ? -58 : back === 'bob' ? -72 : -85;
    const extraDrop = back === 'medium' ? R * 0.75 : 0;
    const flare = back === 'bob' ? 1.2 : 1.13;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      const az = lerp(96, 264, f) * DEG;
      const pts = [onHead(az, 40 * DEG, 1.0), onHead(az, 8 * DEG, 1.1), onHead(az, -28 * DEG, 1.15), onHead(az, endEl * DEG, flare)];
      if (extraDrop) {
        const last = pts[pts.length - 1];
        pts.push(last.clone().add(new THREE.Vector3(Math.sin(az) * 0.02, -extraDrop * 0.55, -0.03)));
        pts.push(last.clone().add(new THREE.Vector3(Math.sin(az) * 0.035 + (rng01(ctx.rng) - 0.5) * 0.03, -extraDrop, -0.05)));
      }
      if (back === 'bob') {
        const last = pts[pts.length - 1];
        pts.push(last.clone().add(new THREE.Vector3(-Math.sin(az) * 0.02, -0.03, Math.cos(az) * -0.02)));
      }
      mb.add(
        strandGeo(pts, {
          r0: back === 'bob' ? 0.1 : 0.095,
          r1: 0.003,
          flat: 0.42,
          seg: Math.round((extraDrop ? 10 : 7) * segScale),
          radial: 6,
          taperPow: 1.5,
          bulge: 0.3,
          hint: radialHint,
        }),
        { bone: B_HEAD, colorFn: hairColorFn(hairCol, hairHi, 0.25), taper: true }
      );
    }
  } else if (back === 'long') {
    const bottom = preset.backLen ?? 0;
    const zBack = -0.3;
    const joints = [
      new THREE.Vector3(0, HC.y - R * 0.82, HC.z - R * 1.0),
      new THREE.Vector3(0, HC.y - R * 1.55, zBack),
      new THREE.Vector3(0, lerp(HC.y - R * 1.55, bottom, 0.5), zBack - 0.03),
      new THREE.Vector3(0, bottom, zBack - 0.06),
    ];
    const ch = ctx.addChain('back', B_HEAD, joints, { kind: 'back' });
    const skin = chainSkin(ch.joints, ch.bones, B_HEAD);
    const n = Math.max(7, Math.round(9 * Math.min(1, q + 0.2)));
    const wave = preset.wave || 0;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      const az = lerp(112, 248, f) * DEG;
      const sx = Math.sin(az);
      const lenJit = (rng01(ctx.rng) - 0.5) * 0.08;
      const bot = bottom + lenJit + Math.abs(sx) * 0.08;
      const xw = sx * R * 1.08;
      const pts = [
        onHead(az, 38 * DEG, 1.0),
        onHead(az, 2 * DEG, 1.11),
        onHead(az, -38 * DEG, 1.15),
        new THREE.Vector3(xw * 0.95, HC.y - R * 1.45, zBack + 0.02 - Math.abs(sx) * 0.02),
        new THREE.Vector3(xw * 1.02 + wave * Math.sin(k * 1.7), lerp(HC.y - R * 1.45, bot, 0.5), zBack - 0.02),
        new THREE.Vector3(xw * 0.95 - wave * Math.sin(k * 1.7), bot, zBack - 0.05),
      ];
      if (wave) {
        pts.splice(4, 0, new THREE.Vector3(xw * 1.0 - wave, lerp(HC.y - R * 1.45, bot, 0.25), zBack - 0.01));
        pts.splice(6, 0, new THREE.Vector3(xw * 1.02 + wave, lerp(HC.y - R * 1.45, bot, 0.75), zBack - 0.035));
      }
      mb.add(
        strandGeo(pts, {
          r0: 0.1,
          r1: 0.003,
          flat: 0.4,
          seg: Math.round((wave ? 16 : 13) * segScale),
          radial: 6,
          radiusFn: (t) => 0.1 * (1 + 0.25 * Math.sin(Math.PI * Math.min(1, t * 2.2))) * Math.pow(1 - t, 0.75) + 0.003,
          hint: (p, t, out) => (t < 0.35 ? radialHint(p, t, out) : out.set(p.x * 0.8, 0, -1).normalize()),
        }),
        { bone: skin, colorFn: hairColorFn(hairCol, hairHi, 0.2), taper: true }
      );
    }
  }

  // twin tails (Serika)
  if (preset.twintails) {
    for (const side of [1, -1]) {
      const A = onHead(side * 112 * DEG, 30 * DEG, 1.02);
      const off = (x, y, z) => A.clone().add(new THREE.Vector3(side * x, y, z));
      const path = [off(0, 0, 0), off(0.1, 0.03, -0.07), off(0.19, -0.1, -0.2), off(0.22, -0.34, -0.33), off(0.2, -0.6, -0.44), off(0.16, -0.86, -0.53), off(0.12, -1.08, -0.6)];
      const joints = [path[1], path[2], path[3], path[4], path[5], path[6]];
      const ch = ctx.addChain(side > 0 ? 'tailL' : 'tailR', B_HEAD, joints, { kind: 'tail', side });
      const skin = chainSkin(ch.joints, ch.bones, B_HEAD);
      const tailHint = (p, t, out) => out.set(side, 0.15, 0.1).normalize();
      mb.add(
        strandGeo(path, {
          seg: Math.round(16 * segScale),
          radial: 7,
          flat: 0.72,
          radiusFn: (t) => 0.095 * (0.62 + 0.75 * Math.sin(Math.PI * Math.min(1, 0.25 + t * 1.25))) * Math.pow(1 - t, 0.6) + 0.002,
          hint: tailHint,
        }),
        { bone: skin, colorFn: hairColorFn(hairCol, hairHi, 0.2), taper: true }
      );
      for (const k of [-1, 1]) {
        const p2 = path.map((p, i) => p.clone().add(new THREE.Vector3(side * 0.012 * i * (k > 0 ? 1 : 0.2), 0.0, k * 0.012 * i)));
        p2[p2.length - 1].add(new THREE.Vector3(side * 0.03 * k, 0.1, k * 0.05));
        mb.add(
          strandGeo(p2.slice(1), {
            seg: Math.round(12 * segScale),
            radial: 5,
            flat: 0.6,
            radiusFn: (t) => 0.05 * Math.sin(Math.PI * Math.min(1, 0.2 + t * 1.1)) * Math.pow(1 - t, 0.5) + 0.002,
            hint: tailHint,
          }),
          { bone: skin, color: shadeHex(hairCol, 0.94), taper: true }
        );
      }
      // hair tie + ribbon bow
      const acc = look.hairAccessory || {};
      const rc = acc.type === 'ribbons' ? acc.color : shadeHex(hairCol, 0.6);
      const nOut = new THREE.Vector3().subVectors(A, HC).normalize();
      const tieAt = path[0].clone().lerp(path[1], 0.55);
      const tdir = new THREE.Vector3().subVectors(path[1], path[0]).normalize();
      const fr = frameFrom(tdir, nOut);
      mb.add(ellipsoidGeo(tieAt, 0.058, 0.03, 0.058, fr, 12, 6), { bone: B_HEAD, color: rc });
      const bowC = tieAt.clone().addScaledVector(nOut, 0.045).add(new THREE.Vector3(0, 0.025, 0));
      const up = new THREE.Vector3(0, 1, 0);
      const fwd = new THREE.Vector3().crossVectors(nOut, up).normalize().multiplyScalar(side);
      for (const s of [-1, 1]) {
        const lc = bowC.clone().addScaledVector(fwd, s * 0.058).addScaledVector(up, 0.02);
        const lf = frameFrom(new THREE.Vector3().copy(fwd).multiplyScalar(s).addScaledVector(up, 0.45), nOut);
        mb.add(ellipsoidGeo(lc, 0.036, 0.065, 0.02, lf, 10, 6), { bone: B_HEAD, color: rc, outline: 0.8 });
      }
      mb.add(ellipsoidGeo(bowC, 0.026, 0.026, 0.022, null, 8, 6), { bone: B_HEAD, color: shadeHex(rc, 0.85), outline: 0.8 });
      for (const s of [-1, 1]) {
        const tail = [bowC.clone(), bowC.clone().addScaledVector(fwd, s * 0.03).add(new THREE.Vector3(0, -0.07, 0)), bowC.clone().addScaledVector(fwd, s * 0.045).add(new THREE.Vector3(0, -0.15, -0.02))];
        mb.add(strandGeo(tail, { r0: 0.026, r1: 0.016, flat: 0.25, seg: 4, radial: 5, hint: () => nOut }), {
          bone: skin,
          color: rc,
          outline: 0.7,
        });
      }
    }
  }

  // ahoge (Hoshino)
  if (preset.ahoge) {
    const base = onHead(8 * DEG, 78 * DEG, 1.0);
    const pts = [base, base.clone().add(new THREE.Vector3(0.0, 0.12, 0.05)), base.clone().add(new THREE.Vector3(0.03, 0.24, 0.0)), base.clone().add(new THREE.Vector3(0.05, 0.25, -0.1)), base.clone().add(new THREE.Vector3(0.04, 0.18, -0.14))];
    const ch = ctx.addChain('ahoge', B_HEAD, [pts[1], pts[2], pts[4]], { kind: 'ahoge' });
    mb.add(strandGeo(pts, { r0: 0.032, r1: 0.002, flat: 0.35, seg: 10, radial: 5, bulge: 0.4, hint: () => new THREE.Vector3(1, 0, 0) }), {
      bone: chainSkin(ch.joints, ch.bones, B_HEAD),
      color: hairCol,
      taper: true,
    });
  }
}

function rng01(rng) {
  return rng();
}

// ---- head extras: ears, horns, accessories, headset ---------------------------------------------------

function earGeo(base, axis, face, radius, height, flat, seg) {
  const g = new THREE.ConeGeometry(1, 1, seg, 1);
  g.translate(0, 0.5, 0);
  const fr = frameFrom(axis, face);
  g.applyMatrix4(basisMatrix(base, fr.x, fr.y, fr.z, radius, height, radius * flat));
  return g;
}

function buildHeadExtras(ctx) {
  const { mb, q, look, hairCol, B_HEAD } = ctx;
  const ears = look.ears || {};
  if (ears.type === 'cat' || ears.type === 'wolf') {
    const cat = ears.type === 'cat';
    for (const side of [-1, 1]) {
      const az = side * (cat ? 40 : 36) * DEG;
      const el = (cat ? 50 : 54) * DEG;
      const base = onHead(az, el, cat ? 0.99 : 0.98);
      const axis = dirAE(az * (cat ? 1.35 : 1.15), el + (cat ? 12 : 16) * DEG);
      axis.x *= 1.1;
      axis.normalize();
      const face = new THREE.Vector3(side * 0.25, 0, 1).normalize();
      const h = cat ? 0.2 : 0.25;
      const r = cat ? 0.105 : 0.1;
      mb.add(earGeo(base, axis, face, r, h, 0.5, Math.round(14 * q)), { bone: B_HEAD, color: ears.color || hairCol });
      const fr = frameFrom(axis, face);
      const ib = base.clone().addScaledVector(fr.z, r * 0.19).addScaledVector(axis, 0.02);
      mb.add(earGeo(ib, axis, face, r * 0.62, h * 0.72, 0.36, Math.round(12 * q)), { bone: B_HEAD, color: ears.inner || '#ff9fb8', outline: 0 });
      // fluffy tuft for wolf ears
      if (!cat) {
        const tb = base.clone().addScaledVector(fr.z, r * 0.2).addScaledVector(axis, 0.03);
        mb.add(earGeo(tb, axis.clone().lerp(fr.x.clone().multiplyScalar(-side), 0.25).normalize(), face, r * 0.35, h * 0.4, 0.4, 8), {
          bone: B_HEAD,
          color: shadeHex(ears.color || hairCol, 1.25),
          outline: 0,
        });
      }
    }
  }

  const horns = look.horns;
  if (horns && horns.type !== 'none') {
    const big = horns.type === 'big-curved';
    for (const side of [-1, 1]) {
      let pts;
      if (big) {
        const b = onHead(side * 66 * DEG, 34 * DEG, 0.96);
        pts = [b, b.clone().add(new THREE.Vector3(side * 0.07, 0.07, -0.02)), b.clone().add(new THREE.Vector3(side * 0.13, 0.14, -0.11)), b.clone().add(new THREE.Vector3(side * 0.15, 0.17, -0.24)), b.clone().add(new THREE.Vector3(side * 0.13, 0.13, -0.36)), b.clone().add(new THREE.Vector3(side * 0.09, 0.19, -0.44))];
      } else {
        const b = onHead(side * 40 * DEG, 56 * DEG, 0.97);
        pts = [b, b.clone().add(new THREE.Vector3(side * 0.03, 0.055, -0.01)), b.clone().add(new THREE.Vector3(side * 0.055, 0.1, -0.05)), b.clone().add(new THREE.Vector3(side * 0.06, 0.12, -0.1))];
      }
      mb.add(
        strandGeo(pts, {
          r0: big ? 0.058 : 0.036,
          r1: 0.003,
          flat: 0.85,
          seg: Math.round((big ? 14 : 7) * q),
          radial: 7,
          taperPow: 0.9,
          hint: () => new THREE.Vector3(0, 0, 1),
        }),
        { bone: B_HEAD, colorFn: hornColorFn(horns.color || '#2b2230'), taper: true }
      );
    }
  }

  const acc = look.hairAccessory || {};
  if (acc.type === 'hairband' || acc.type === 'headband') {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const az = lerp(-92, 92, u) * DEG;
      const el = lerp(4, 72, Math.sin(u * Math.PI)) * DEG;
      pts.push(onHead(az + 0.25 * Math.sin(u * Math.PI) * 0, el, 1.1).add(new THREE.Vector3(0, 0, 0.02 * Math.sin(u * Math.PI))));
    }
    mb.add(strandGeo(pts, { r0: 0.024, r1: 0.024, flat: 0.55, seg: Math.round(16 * q), radial: 6, hint: radialHint }), {
      bone: B_HEAD,
      color: acc.color,
    });
    if (acc.type === 'headband') {
      // small bow on the side
      const c = onHead(-62 * DEG, 44 * DEG, 1.14);
      const nOut = new THREE.Vector3().subVectors(c, HC).normalize();
      const fwd = new THREE.Vector3(0, 1, 0);
      for (const s of [-1, 1]) {
        mb.add(ellipsoidGeo(c.clone().addScaledVector(fwd, s * 0.045), 0.03, 0.05, 0.016, frameFrom(fwd.clone().multiplyScalar(s), nOut), 8, 6), {
          bone: B_HEAD,
          color: acc.color,
          outline: 0.7,
        });
      }
    }
  } else if (acc.type === 'clip') {
    const c = onHead(-58 * DEG, 10 * DEG, 1.17);
    const nOut = new THREE.Vector3().subVectors(c, HC).normalize();
    const fr = frameFrom(new THREE.Vector3(0.25, 1, 0).normalize(), nOut);
    mb.add(ellipsoidGeo(c, 0.016, 0.062, 0.012, fr, 8, 6), { bone: B_HEAD, color: acc.color, outline: 0.6 });
    const c2 = c.clone().add(new THREE.Vector3(-0.022, 0.012, 0.004));
    mb.add(ellipsoidGeo(c2, 0.014, 0.056, 0.011, fr, 8, 6), { bone: B_HEAD, color: shadeHex(acc.color, 1.3), outline: 0.6 });
  } else if (acc.type === 'flower') {
    const c = onHead(-70 * DEG, 36 * DEG, 1.13);
    const nOut = new THREE.Vector3().subVectors(c, HC).normalize();
    const fr = frameFrom(nOut, new THREE.Vector3(0, 1, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const pc = c.clone().addScaledVector(fr.x, Math.cos(a) * 0.036).addScaledVector(fr.z, Math.sin(a) * 0.036);
      mb.add(ellipsoidGeo(pc, 0.03, 0.013, 0.03, fr, 8, 5), { bone: B_HEAD, color: acc.color, outline: 0.5 });
    }
    mb.add(ellipsoidGeo(c.clone().addScaledVector(nOut, 0.01), 0.018, 0.012, 0.018, fr, 8, 5), { bone: B_HEAD, color: '#ffe066', outline: 0 });
  }

  // Ayane's headset
  const headset = look.outfit?.headset;
  if (headset) {
    const side = 1;
    const cupC = onHead(side * 90 * DEG, -8 * DEG, 1.16);
    const axis = new THREE.Vector3(side, 0, 0);
    mb.add(alignedCylinder(cupC.clone().addScaledVector(axis, -0.02), cupC.clone().addScaledVector(axis, 0.04), 0.07, 0.062, Math.round(14 * q)), {
      bone: B_HEAD,
      color: headset,
    });
    mb.add(alignedCylinder(cupC.clone().addScaledVector(axis, 0.04), cupC.clone().addScaledVector(axis, 0.05), 0.045, 0.04, 12), {
      bone: B_HEAD,
      color: look.outfit.shoeAccent || '#ff6f91',
      outline: 0,
    });
    const band = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      band.push(onHead(lerp(90, -90, u) * DEG, lerp(-2, 88, Math.sin(u * Math.PI)) * DEG, 1.13).add(new THREE.Vector3(0, 0, -0.03)));
    }
    mb.add(strandGeo(band, { r0: 0.016, r1: 0.016, flat: 0.6, seg: Math.round(14 * q), radial: 5, hint: radialHint }), { bone: B_HEAD, color: headset });
    const mic = [cupC.clone().add(new THREE.Vector3(0.02, -0.03, 0.03)), onHead(58 * DEG, -40 * DEG, 1.2), onHead(28 * DEG, -58 * DEG, 1.12)];
    mb.add(strandGeo(mic, { r0: 0.009, r1: 0.009, seg: 6, radial: 5 }), { bone: B_HEAD, color: headset, outline: 0.6 });
    mb.add(ellipsoidGeo(mic[2], 0.02, 0.018, 0.022, null, 8, 6), { bone: B_HEAD, color: shadeHex(headset, 0.6), outline: 0.6 });
  }
}

function hornColorFn(base) {
  const a = vc(base);
  const b = vc(shadeHex(base, 1.55));
  return (x, y, z, i, t, out) => out.copy(a).lerp(b, t * 0.6);
}

// ---- body / outfit ------------------------------------------------------------------------------------

function buildBody(ctx) {
  const { mb, q, look, outfit, skin, B_ROOT, B_SPINE, B_HEAD } = ctx;
  const type = outfit.type || 'blazer';
  const jacket = outfit.jacket || '#1d2a4d';
  const shirt = outfit.shirt || '#ffffff';
  const piping = outfit.piping || '#ffffff';
  const tie = outfit.tie || '#1fb8e8';
  const skirt = outfit.skirt || '#3d4250';
  const legs = outfit.legs || skin;
  const shoes = outfit.shoes || '#333333';
  const shoeAccent = outfit.shoeAccent || '#ffffff';
  const draped = type === 'coat' || type === 'military-coat';
  const segs = Math.round(18 * q);

  const torsoProfile = [
    [0.1, 0.0],
    [0.128, 0.02],
    [0.138, 0.06],
    [0.14, 0.13],
    [0.148, 0.2],
    [0.142, 0.255],
    [0.122, 0.295],
    [0.075, 0.325],
    [0.03, 0.34],
  ];
  const SZ = 0.74;
  const profR = (y) => {
    for (let i = 0; i < torsoProfile.length - 1; i++) {
      const [r0, y0] = torsoProfile[i];
      const [r1, y1] = torsoProfile[i + 1];
      if (y <= y1) return lerp(r0, r1, clamp((y - y0) / (y1 - y0), 0, 1));
    }
    return torsoProfile[torsoProfile.length - 1][0];
  };
  const gap = (y) => (y < 0.12 ? 0.05 : lerp(0.05, 0.62, smoothstep(0.12, 0.33, y)));

  // shirt (inner layer)
  mb.add(
    latheGeo(
      torsoProfile.map(([r, y]) => [r * 0.965, y]),
      { segs, sz: SZ }
    ),
    { bone: B_SPINE, color: shirt }
  );
  if (!draped) {
    // blazer / hoodie shell with an open V front
    mb.add(latheGeo(torsoProfile.map(([r, y]) => [r * 1.0, y]), { segs, sz: SZ, range: (y) => [gap(y), TAU - gap(y)] }), {
      bone: B_SPINE,
      color: jacket,
    });
    // lapel piping
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const y = lerp(0.02, 0.322, i / 6);
        const a = s * gap(y);
        const r = profR(y) + 0.004;
        pts.push(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r * SZ));
      }
      mb.add(strandGeo(pts, { r0: 0.0075, r1: 0.0075, seg: 8, radial: 4 }), { bone: B_SPINE, color: piping, outline: 0 });
    }
    // hem piping
    mb.add(latheGeo([[0.132, 0.012], [0.135, 0.024]], { segs, sz: SZ * 1.02, range: () => [0.06, TAU - 0.06] }), {
      bone: B_SPINE,
      color: piping,
      outline: 0,
    });
  } else {
    // vest-less shirt; a draped coat over the shoulders
    const coat = latheGeo(
      [
        [0.19, -0.02],
        [0.2, 0.08],
        [0.19, 0.2],
        [0.18, 0.27],
        [0.15, 0.315],
        [0.1, 0.345],
        [0.06, 0.355],
      ],
      { segs, sz: 0.82, range: () => [0.95, TAU - 0.95] }
    );
    mb.add(coat, { bone: B_SPINE, color: jacket });
    const lining = latheGeo(
      [
        [0.185, -0.015],
        [0.195, 0.08],
        [0.185, 0.2],
        [0.175, 0.27],
        [0.145, 0.312],
      ],
      { segs, sz: 0.8, range: () => [0.95, TAU - 0.95], inner: true }
    );
    mb.add(lining, { bone: B_SPINE, color: type === 'military-coat' ? outfit.piping || '#6a3fb5' : shadeHex(jacket, 0.7), outline: 0 });
    // front edge trim
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 5; i++) {
        const y = lerp(-0.01, 0.34, i / 5);
        const r = lerp(0.2, 0.08, smoothstep(0.25, 0.36, y)) + 0.003;
        pts.push(new THREE.Vector3(Math.sin(s * 0.95) * r, y, Math.cos(0.95) * r * 0.82));
      }
      mb.add(strandGeo(pts, { r0: 0.009, r1: 0.009, seg: 8, radial: 4 }), { bone: B_SPINE, color: piping, outline: 0 });
    }
    // empty sleeves hanging from the shoulders
    for (const s of [-1, 1]) {
      mb.add(alignedCapsule(new THREE.Vector3(s * 0.19, 0.29, -0.03), new THREE.Vector3(s * 0.215, 0.07, -0.05), 0.048, 3, Math.round(10 * q)), {
        bone: B_SPINE,
        color: jacket,
      });
      mb.add(alignedCylinder(new THREE.Vector3(s * 0.215, 0.085, -0.05), new THREE.Vector3(s * 0.22, 0.04, -0.052), 0.053, 0.053, 10), {
        bone: B_SPINE,
        color: outfit.fur || piping,
        outline: 0.7,
      });
    }
    // fur collar
    const fur = outfit.fur || '#f3e6d6';
    const collar = new THREE.TorusGeometry(0.135, 0.045, Math.round(8 * q), Math.round(22 * q));
    const cp = collar.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i);
      const y = cp.getY(i);
      const z = cp.getZ(i);
      const a = Math.atan2(y, x);
      const bump = 1 + 0.12 * Math.sin(a * 11) * (Math.abs(z) > 0.02 ? 1 : 0.6);
      const cr = Math.hypot(x, y);
      const k = (0.135 + (cr - 0.135) * bump) / Math.max(cr, 1e-5);
      cp.setXYZ(i, x * k, y * k, z);
    }
    collar.computeVertexNormals();
    collar.rotateX(Math.PI / 2);
    collar.scale(1.15, 1, 0.9);
    collar.translate(0, 0.325, -0.01);
    mb.add(collar, { bone: B_SPINE, color: fur });
    if (type === 'military-coat') {
      for (const s of [-1, 1]) {
        mb.add(new THREE.BoxGeometry(0.1, 0.02, 0.09), {
          matrix: new THREE.Matrix4().makeRotationZ(s * 0.35).setPosition(s * 0.17, 0.335, -0.01),
          bone: B_SPINE,
          color: shadeHex(jacket, 1.3),
        });
      }
    }
  }
  // shirt collar + tie
  mb.add(new THREE.TorusGeometry(0.052, 0.013, 6, Math.round(14 * q)), {
    matrix: new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.326, 0.004),
    bone: B_SPINE,
    color: shirt,
  });
  for (const s of [-1, 1]) {
    const tri = new THREE.Shape();
    tri.moveTo(0, 0);
    tri.lineTo(s * 0.055, -0.004);
    tri.lineTo(s * 0.02, -0.05);
    tri.closePath();
    const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.008, bevelEnabled: false });
    mb.add(tg, {
      matrix: new THREE.Matrix4().makeRotationX(-0.55).setPosition(s * 0.008, 0.328, 0.05),
      bone: B_SPINE,
      color: shirt,
      outline: 0.6,
    });
  }
  {
    const tieShape = new THREE.Shape();
    tieShape.moveTo(-0.014, 0);
    tieShape.lineTo(0.014, 0);
    tieShape.lineTo(0.026, -0.15);
    tieShape.lineTo(0, -0.18);
    tieShape.lineTo(-0.026, -0.15);
    tieShape.closePath();
    const tg = new THREE.ExtrudeGeometry(tieShape, { depth: 0.01, bevelEnabled: false });
    mb.add(tg, { matrix: new THREE.Matrix4().makeRotationX(-0.12).setPosition(0, 0.305, profR(0.24) * SZ * 0.965 - 0.001), bone: B_SPINE, color: tie, outline: 0.5 });
    mb.add(ellipsoidGeo(new THREE.Vector3(0, 0.31, 0.087), 0.022, 0.02, 0.014, null, 8, 6), { bone: B_SPINE, color: shadeHex(tie, 0.85), outline: 0.5 });
  }
  if (type === 'hoodie') {
    // hood bunched behind the neck + drawstrings
    const hood = ellipsoidGeo(new THREE.Vector3(0, 0.335, -0.1), 0.14, 0.07, 0.085, null, Math.round(14 * q), 8);
    mb.add(hood, { bone: B_SPINE, color: jacket });
    mb.add(latheGeo([[0.1, 0.33], [0.13, 0.36], [0.1, 0.395]], { segs: 14, sz: 0.7, range: () => [2.2, TAU - 2.2] }), {
      bone: B_SPINE,
      color: piping,
      outline: 0,
    });
    for (const s of [-1, 1]) {
      mb.add(alignedCylinder(new THREE.Vector3(s * 0.045, 0.315, 0.09), new THREE.Vector3(s * 0.05, 0.2, 0.105), 0.006, 0.006, 5), {
        bone: B_SPINE,
        color: piping,
        outline: 0,
      });
      mb.add(ellipsoidGeo(new THREE.Vector3(s * 0.05, 0.195, 0.106), 0.012, 0.016, 0.012, null, 6, 5), { bone: B_SPINE, color: piping, outline: 0 });
    }
  }
  // Shiroko's scarf: wrap + two tails flowing behind
  if (outfit.scarf) {
    const wrap = new THREE.TorusGeometry(0.078, 0.036, Math.round(8 * q), Math.round(18 * q));
    wrap.rotateX(Math.PI / 2);
    wrap.scale(1.05, 1.0, 0.95);
    wrap.translate(0, 0.35, 0.0);
    mb.add(wrap, { bone: B_SPINE, color: outfit.scarf });
    mb.add(ellipsoidGeo(new THREE.Vector3(-0.055, 0.33, 0.07), 0.038, 0.034, 0.03, null, 8, 6), { bone: B_SPINE, color: shadeHex(outfit.scarf, 0.9) });
    const joints = [new THREE.Vector3(0.02, 0.34, -0.07), new THREE.Vector3(0.05, 0.25, -0.2), new THREE.Vector3(0.08, 0.15, -0.3), new THREE.Vector3(0.1, 0.06, -0.38)];
    const ch = ctx.addChain('scarf', B_SPINE, joints, { kind: 'scarf' });
    const skinF = chainSkin(ch.joints, ch.bones, B_SPINE);
    for (const k of [0, 1]) {
      const pts = joints.map((j, i) => j.clone().add(new THREE.Vector3(k * 0.07 - 0.03, -k * 0.03 * i, k * 0.01)));
      mb.add(
        strandGeo(pts, { r0: 0.04, r1: 0.034, flat: 0.25, seg: Math.round(8 * q), radial: 6, hint: () => new THREE.Vector3(0, 0.5, -1).normalize() }),
        { bone: skinF, color: k ? shadeHex(outfit.scarf, 0.88) : outfit.scarf }
      );
    }
  }

  // skirt (pleated)
  {
    const pleats = 18;
    const plaid = outfit.skirtPattern === 'plaid';
    const sk = latheGeo(
      [
        [0.13, 0.075],
        [0.17, 0.035],
        [0.215, -0.01],
        [0.235, -0.03],
      ],
      {
        segs: Math.round(pleats * 2 * Math.max(0.75, q)),
        sz: 0.92,
        rFn: (r, y, a) => r * (1 + 0.055 * Math.abs(((a / TAU) * pleats) % 1 - 0.5) * 2 * smoothstep(0.08, -0.02, y)),
      }
    );
    const sp = sk.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const z = sp.getZ(i);
      if (z > 0) sp.setZ(i, z * 1.3);
    }
    sk.computeVertexNormals();
    const c0 = vc(skirt);
    const c1 = vc(shadeHex(skirt, 0.82));
    const cLine = vc(mixHex(skirt, '#ffffff', 0.35));
    mb.add(sk, {
      bone: B_ROOT,
      colorFn: (x, y, z, i, t, out) => {
        const a = Math.atan2(x, z);
        const pleat = Math.floor(((a + Math.PI) / TAU) * pleats * 2) % 2;
        out.copy(pleat ? c1 : c0);
        if (plaid && y < 0.0 && y > -0.02) out.lerp(cLine, 0.8);
      },
    });
  }

  // legs (seated) + shoes
  const isSerika = !!look.fang && look.ears?.type === 'cat';
  for (const s of [-1, 1]) {
    const hip = new THREE.Vector3(s * 0.07, 0.04, 0.0);
    const knee = new THREE.Vector3(s * 0.078, 0.05, 0.24);
    const ankle = new THREE.Vector3(s * 0.085, -0.15, 0.3);
    mb.add(alignedCapsule(hip, knee, 0.058, 3, Math.round(10 * q)), { bone: B_ROOT, color: skin });
    const shinCol = isSerika ? skin : legs;
    mb.add(alignedCapsule(knee, ankle, 0.047, 3, Math.round(10 * q)), { bone: B_ROOT, color: shinCol });
    if (isSerika) {
      // ankle socks + right knee sleeve
      mb.add(alignedCylinder(ankle.clone().lerp(knee, 0.22), ankle.clone().lerp(knee, -0.05), 0.05, 0.05, 10), { bone: B_ROOT, color: legs, outline: 0 });
      if (s < 0) mb.add(alignedCylinder(knee.clone().lerp(ankle, -0.05), knee.clone().lerp(ankle, 0.3), 0.053, 0.051, 10), { bone: B_ROOT, color: legs, outline: 0 });
    }
    const shoe = ellipsoidGeo(new THREE.Vector3(s * 0.088, -0.19, 0.33), 0.056, 0.048, 0.09, null, 10, 7);
    mb.add(shoe, { bone: B_ROOT, color: shoes });
    mb.add(ellipsoidGeo(new THREE.Vector3(s * 0.088, -0.2, 0.345), 0.058, 0.03, 0.09, null, 10, 5), { bone: B_ROOT, color: shoeAccent, outline: 0 });
  }
}

// ---- arms ---------------------------------------------------------------------------------------------

function buildArms(ctx) {
  const { mb, q, look, outfit, skin, B_ARM_L, B_ARM_R, B_SPINE } = ctx;
  const type = outfit.type || 'blazer';
  const draped = type === 'coat' || type === 'military-coat';
  const sleeve = draped ? outfit.shirt || '#ffffff' : outfit.jacket || '#1d2a4d';
  const cuff = draped ? shadeHex(outfit.shirt || '#ffffff', 0.9) : outfit.piping || '#ffffff';
  const glove = outfit.gloves || null;
  const fingerless = !!look.fang && !!glove;
  ctx.armBindDir = {};
  for (const [side, bone] of [
    [1, B_ARM_L],
    [-1, B_ARM_R],
  ]) {
    const S = new THREE.Vector3(side * SHOULDER_X, SHOULDER_Y, 0);
    const D = new THREE.Vector3(-side * 0.16, -0.06, 1).normalize();
    ctx.armBindDir[side > 0 ? 'L' : 'R'] = D.clone();
    const at = (d) => S.clone().addScaledVector(D, d);
    mb.add(ellipsoidGeo(S.clone().add(new THREE.Vector3(side * 0.008, 0.004, 0)), 0.056, 0.056, 0.056, null, Math.round(10 * q), 8), {
      bone: B_SPINE,
      color: draped ? outfit.jacket || sleeve : sleeve,
    });
    mb.add(
      strandGeo([at(-0.01), at(0.08), at(0.2)], {
        seg: 4,
        radial: Math.round(9 * q),
        radiusFn: (t) => lerp(0.05, 0.044, t),
        hint: () => new THREE.Vector3(0, 1, 0),
        capBase: true,
      }),
      { bone, color: sleeve }
    );
    mb.add(alignedCylinder(at(0.19), at(0.225), 0.049, 0.047, Math.round(10 * q)), { bone, color: cuff });
    const handC = at(0.262);
    const handCol = glove || skin;
    mb.add(ellipsoidGeo(handC, 0.048, 0.043, 0.052, frameFrom(D, new THREE.Vector3(0, 1, 0)), Math.round(10 * q), 7), { bone, color: handCol });
    if (fingerless) {
      mb.add(ellipsoidGeo(at(0.298).add(new THREE.Vector3(0, -0.006, 0)), 0.036, 0.026, 0.024, frameFrom(D, new THREE.Vector3(0, 1, 0)), 8, 5), {
        bone,
        color: skin,
        outline: 0.6,
      });
    }
    // thumb
    mb.add(ellipsoidGeo(handC.clone().add(new THREE.Vector3(-side * 0.035, 0.02, 0.0)), 0.018, 0.018, 0.028, null, 6, 5), {
      bone,
      color: fingerless ? skin : handCol,
      outline: 0.5,
    });
  }
}

// ---- weapon on the back -------------------------------------------------------------------------------

function buildWeapon(ctx) {
  const { mb, look, B_SPINE } = ctx;
  const w = look.weapon;
  if (!w || w.type === 'none') return;
  const main = w.color || '#2b2f3a';
  const acc = w.accent || '#ff3355';
  const dark = shadeHex(main, 0.6);
  const light = shadeHex(main, 1.35);
  const parts = []; // [geometry, color, outline]
  const box = (w0, h0, d0, x, y, z, color, rz = 0) => {
    const g = new THREE.BoxGeometry(w0, h0, d0);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push([g, color, 0.8]);
  };
  const cyl = (r, len, x, y, z, color, seg = 8) => {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.translate(x, y, z);
    parts.push([g, color, 0.8]);
  };
  let angle = 0.72;
  let pos = new THREE.Vector3(0, 0.19, -0.165);
  switch (w.type) {
    case 'rifle':
      box(0.05, 0.3, 0.05, 0, 0, 0, main);
      box(0.045, 0.1, 0.06, 0, -0.2, 0, main);
      box(0.04, 0.07, 0.04, 0, 0.02, 0.045, dark);
      cyl(0.013, 0.2, 0, 0.25, 0, dark);
      box(0.052, 0.05, 0.052, 0, 0.12, 0, acc);
      cyl(0.017, 0.09, 0, 0.06, -0.038, dark);
      break;
    case 'sniper':
      angle = -0.7;
      box(0.045, 0.34, 0.05, 0, 0, 0, main);
      box(0.04, 0.12, 0.06, 0, -0.22, 0, acc);
      cyl(0.012, 0.28, 0, 0.3, 0, dark);
      cyl(0.022, 0.13, 0, 0.05, -0.045, dark);
      box(0.05, 0.03, 0.052, 0, 0.15, 0, acc);
      break;
    case 'minigun':
      angle = 0.55;
      pos = new THREE.Vector3(0, 0.17, -0.19);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        cyl(0.011, 0.3, Math.cos(a) * 0.028, 0.12, Math.sin(a) * 0.028, dark, 6);
      }
      box(0.09, 0.14, 0.09, 0, -0.08, 0, main);
      box(0.1, 0.03, 0.1, 0, 0.02, 0, acc);
      cyl(0.04, 0.02, 0, 0.26, 0, main, 10);
      break;
    case 'shield':
      angle = 0.08;
      pos = new THREE.Vector3(0, 0.17, -0.19);
      box(0.3, 0.36, 0.035, 0, 0, 0, main);
      box(0.3, 0.035, 0.037, 0, 0.1, 0, acc);
      box(0.08, 0.05, 0.037, 0.08, 0.13, 0, shadeHex(main, 0.5));
      box(0.26, 0.012, 0.037, 0, -0.1, 0, light);
      break;
    case 'tablet':
      angle = -0.2;
      pos = new THREE.Vector3(0.02, 0.17, -0.16);
      box(0.16, 0.2, 0.03, 0, 0, 0, main);
      box(0.13, 0.16, 0.032, 0, 0.005, 0, acc);
      break;
    case 'railgun':
      angle = 0.62;
      pos = new THREE.Vector3(0, 0.2, -0.2);
      box(0.1, 0.56, 0.1, 0, 0.02, 0, main);
      box(0.105, 0.08, 0.105, 0, -0.18, 0, acc);
      box(0.105, 0.04, 0.105, 0, 0.12, 0, acc);
      box(0.06, 0.2, 0.06, 0, 0.37, 0, shadeHex(main, 0.85));
      box(0.13, 0.05, 0.13, 0, 0.47, 0, main);
      box(0.03, 0.4, 0.108, 0.05, 0.02, 0, acc);
      break;
    case 'machinegun':
      angle = 0.66;
      pos = new THREE.Vector3(0, 0.19, -0.18);
      box(0.07, 0.34, 0.07, 0, 0, 0, main);
      box(0.06, 0.08, 0.1, 0, -0.03, 0.06, acc);
      cyl(0.016, 0.22, 0, 0.27, 0, dark);
      box(0.05, 0.12, 0.06, 0, -0.22, 0, main);
      box(0.075, 0.03, 0.075, 0, 0.13, 0, acc);
      break;
    default:
      box(0.05, 0.3, 0.05, 0, 0, 0, main);
  }
  const m = new THREE.Matrix4().makeRotationZ(angle).setPosition(pos);
  for (const [g, color, ol] of parts) mb.add(g, { matrix: m, bone: B_SPINE, color, outline: ol });
  // strap across the chest
  if (w.type !== 'tablet') {
    const strap = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const a = lerp(-0.9, 0.9, u) * Math.PI + Math.PI;
      const y = lerp(0.3, 0.1, u);
      const r = 0.155;
      strap.push(new THREE.Vector3(Math.sin(a) * r * Math.sign(angle || 1), y, Math.cos(a) * r * 0.78));
    }
    mb.add(strandGeo(strap, { r0: 0.008, r1: 0.008, flat: 0.4, seg: 10, radial: 4, hint: (p, t, out) => out.set(p.x, 0, p.z).normalize() }), {
      bone: B_SPINE,
      color: shadeHex(main, 0.55),
      outline: 0,
    });
  }
}

// =========================================================================================================
// CharacterModel instance
// =========================================================================================================

const _mA = new THREE.Matrix4();
const _mB = new THREE.Matrix4();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const DEFAULT_HAND_L = new THREE.Vector3(0.11, 0.3, 0.29);
const DEFAULT_HAND_R = new THREE.Vector3(-0.11, 0.3, 0.29);

// Spring settings per chain kind.
const CHAIN_CFG = {
  tail: { k: 28, c: 5.2, weights: [0.3, 0.28, 0.25, 0.22, 0.2], pitch0: -0.18, pitchSpeed: 0.95, pitchAir: 0.55, roll: 0.55, flutter: 0.05, flutterSpeed: 0.1, freq: 7.5 },
  back: { k: 34, c: 6.5, weights: [0.28, 0.25, 0.22], pitch0: -0.06, pitchSpeed: 0.55, pitchAir: 0.4, roll: 0.3, flutter: 0.025, flutterSpeed: 0.06, freq: 6 },
  scarf: { k: 30, c: 5, weights: [0.35, 0.35, 0.35], pitch0: -0.1, pitchSpeed: 1.0, pitchAir: 0.5, roll: 0.4, flutter: 0.06, flutterSpeed: 0.16, freq: 9 },
  ahoge: { k: 90, c: 5, weights: [0.5, 0.5], pitch0: 0, pitchSpeed: 0.3, pitchAir: -0.4, roll: 0.5, flutter: 0.03, flutterSpeed: 0.04, freq: 5 },
};

export class CharacterModel {
  constructor(character, { quality = 'high' } = {}) {
    this.character = character;
    this.quality = quality;
    const asset = getCharacterAsset(character, quality);
    this.asset = asset;
    this.group = new THREE.Group();
    this.group.name = `driver:${character.id}`;

    // bones
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
    this.bRoot = this.bones[id.root];
    this.bSpine = this.bones[id.spine];
    this.bHead = this.bones[id.head];
    this.bArmL = this.bones[id.armL];
    this.bArmR = this.bones[id.armR];
    this.skeleton = new THREE.Skeleton(this.bones);

    // faces
    this.faceSize = FACE_SIZE[quality] ?? 512;
    this.faces = {};
    this.faces.neutral = getFaceTexture(character, 'neutral', this.faceSize);
    this.material = createToonMaterial({ map: this.faces.neutral, faceLight: 1, rim: 0.28 });
    this.mesh = new THREE.SkinnedMesh(asset.geometry, this.material);
    this.mesh.name = `driverMesh:${character.id}`;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    if (asset.outlineGeometry) {
      this.outline = new THREE.SkinnedMesh(asset.outlineGeometry, getOutlineMaterial());
      this.outline.name = `driverOutline:${character.id}`;
      this.outline.castShadow = false;
      this.outline.receiveShadow = false;
      this.group.add(this.outline);
    }
    this.group.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.outline?.bind(this.skeleton);
    const bs = new THREE.Sphere(new THREE.Vector3(0, 0.45, -0.2), 1.25);
    this.mesh.boundingSphere = bs;
    if (this.outline) this.outline.boundingSphere = bs.clone();

    // head anchor (centre of the head)
    this.headAnchor = new THREE.Object3D();
    this.headAnchor.name = 'headAnchor';
    this.headAnchor.position.copy(HC).sub(NECK);
    this.bHead.add(this.headAnchor);

    // halo
    this.haloMaterial = new THREE.MeshBasicMaterial({ color: asset.haloColor, toneMapped: false });
    this.halo = new THREE.Mesh(asset.haloGeometry, this.haloMaterial);
    this.halo.name = 'halo';
    this.halo.castShadow = false;
    this.halo.position.copy(asset.haloPos).sub(NECK);
    this.halo.rotation.x = -0.32;
    this.haloRest = this.halo.position.clone();
    this.bHead.add(this.halo);
    this.haloGlowMaterial = new THREE.MeshBasicMaterial({
      map: getHaloGlowTexture(),
      color: asset.haloGlow,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const gs = asset.haloRadius * 2.9;
    this.haloGlow = new THREE.Mesh(new THREE.PlaneGeometry(gs, gs).rotateX(-Math.PI / 2), this.haloGlowMaterial);
    this.haloGlow.name = 'haloGlow';
    this.haloGlow.renderOrder = 2;
    this.halo.add(this.haloGlow);
    this.haloBaseColor = new THREE.Color(asset.haloColor);
    this.haloGlowColor = new THREE.Color(asset.haloGlow);

    // chains
    this.chains = asset.chains.map((ch) => ({
      ...ch,
      cfg: CHAIN_CFG[ch.kind] || CHAIN_CFG.back,
      bones: ch.bones.map((i) => this.bones[i]),
      p: 0,
      pv: 0,
      r: 0,
      rv: 0,
      phase: (ch.side || 0) * 0.8 + ch.bones[0] * 0.37,
    }));

    // animation state
    this.time = 0;
    this.expr = 'neutral';
    this.exprHold = 0;
    this.blinkT = 2 + Math.random() * 2;
    this.blinking = 0;
    this.lean = 0;
    this.steer = 0;
    this.w = { celebrate: 0, trick: 0, hurt: 0, sad: 0, look: 0, air: 0, boost: 0, drift: 0 };
    this.pose = 'drive';
    this.handL = DEFAULT_HAND_L.clone();
    this.handR = DEFAULT_HAND_R.clone();
    this.bindDirL = asset.armBindDir.L.clone();
    this.bindDirR = asset.armBindDir.R.clone();
    this.haloBoost = 0;
    this.baseExpr = 'neutral';
    this._rand = mulberry32(hashString(character.id) ^ 0x9e3779b9);
    this.update(0, {});
  }

  /** Pre-create all expression textures (cheap canvas draws; avoids hitches on first use). */
  warmFaces() {
    for (const e of EXPRESSIONS) this.faces[e] = this.faces[e] || getFaceTexture(this.character, e, this.faceSize);
    return this;
  }

  setExpression(name, hold = 0) {
    if (!this.faces[name]) this.faces[name] = getFaceTexture(this.character, name, this.faceSize);
    if (this.expr !== name) {
      this.expr = name;
      this.material.map = this.faces[name];
    }
    this.exprHold = Math.max(this.exprHold, hold);
  }

  /** 'drive' (default, hands on the wheel) | 'portrait' (arms relaxed, static). */
  setPose(pose) {
    this.pose = pose;
  }

  setHandTargets(l, r) {
    this.handL.copy(l);
    this.handR.copy(r);
  }

  setTint(color, amount) {
    const u = this.material.userData.u;
    if (color) u.uTint.value.copy(color);
    u.uTintAmt.value = amount;
  }

  /**
   * @param {number} dt
   * @param {object} st  RacerVisualState
   * @param {object} m   motion from RacerModel: { speedN, lat, accel, landing, driftLevel }
   */
  update(dt, st = {}, m = {}) {
    dt = clamp(dt || 0, 0, 0.1);
    this.time += dt;
    const t = this.time;
    const w = this.w;
    const speedN = m.speedN ?? clamp(Math.abs(st.speed || 0) / 36, 0, 1.5);
    const steerIn = clamp(st.steer || 0, -1, 1);
    this.steer = damp(this.steer, steerIn, 12, dt);
    const steer = this.steer;
    const drifting = !!st.drifting;
    const dDir = st.driftDir || 0;
    const spinning = !!st.spinning;
    const tumbling = !!st.tumbling;
    const hurt = spinning || tumbling || (!!st.hurt && !st.stalled);
    const portrait = this.pose === 'portrait';
    const k = dt > 0 ? 1 : 0;
    const ease = (cur, target, rate) => (dt > 0 ? damp(cur, target, rate, dt) : target);
    w.celebrate = ease(w.celebrate, st.celebrate ? 1 : 0, 5);
    w.trick = ease(w.trick, st.trick ? 1 : 0, 14);
    w.hurt = ease(w.hurt, hurt ? 1 : 0, 12);
    w.sad = ease(w.sad, st.sad ? 1 : 0, 3);
    w.look = ease(w.look, st.lookBack ? 1 : 0, 9);
    w.air = ease(w.air, st.airborne ? 1 : 0, 8);
    w.boost = ease(w.boost, st.boosting ? 1 : 0, 6);
    w.drift = ease(w.drift, drifting ? dDir || 0 : 0, 6);
    const speedK = clamp(speedN * 1.8, 0, 1);
    const leanTarget = (drifting ? dDir * 0.62 + steer * 0.25 : steer * 0.5) * speedK;
    this.lean = ease(this.lean, leanTarget, 7);
    const lean = this.lean * (1 - w.celebrate * 0.7) * (1 - w.hurt);

    // ---- body -----------------------------------------------------------------------------------
    const breathe = Math.sin(t * 2.1) * 0.015;
    const hop = w.celebrate * Math.abs(Math.sin(t * 5.5)) * 0.045;
    this.bRoot.position.y = this.bRoot.userData.rest.y + hop;
    const hurtWob = w.hurt * Math.sin(t * 13);
    this.bSpine.rotation.set(
      -0.1 * w.boost + 0.07 * Math.abs(w.drift) + w.sad * 0.22 - w.celebrate * 0.1 - w.trick * 0.18 + breathe + w.hurt * -0.08,
      w.look * 0.5 + lean * 0.12 + hurtWob * 0.12,
      lean * 0.3 + hurtWob * 0.1 + w.celebrate * Math.sin(t * 3.2) * 0.06
    );
    // head
    const idleLook = (1 - speedK) * (1 - w.celebrate) * Math.sin(t * 0.45) * 0.18;
    this.bHead.rotation.set(
      w.sad * 0.32 - w.celebrate * 0.12 - w.air * 0.08 - w.trick * 0.2 + Math.sin(t * 1.7) * 0.02 + w.hurt * Math.sin(t * 9) * 0.15,
      w.look * 1.6 + steer * 0.25 * (1 - w.look) * speedK + idleLook + w.hurt * Math.sin(t * 7.5) * 0.35,
      lean * 0.2 + w.celebrate * Math.sin(t * 2.6) * 0.14 + w.hurt * Math.cos(t * 9) * 0.2
    );
    if (portrait) {
      this.bRoot.position.y = this.bRoot.userData.rest.y;
      this.bSpine.rotation.set(0.02, 0, 0);
      this.bHead.rotation.set(0.04, -0.1, 0.05);
    }

    // ---- arms -----------------------------------------------------------------------------------
    this._armPose(this.bArmL, 1, this.handL, this.bindDirL, t, w, portrait);
    this._armPose(this.bArmR, -1, this.handR, this.bindDirR, t, w, portrait);

    // ---- hair chains ----------------------------------------------------------------------------
    const lat = clamp(steer * speedK + w.drift * 0.4 * speedK, -1.3, 1.3);
    const accel = clamp(m.accel || 0, -1, 1);
    for (const ch of this.chains) {
      const c = ch.cfg;
      let tp = c.pitch0 + c.pitchSpeed * Math.min(1.2, speedN) + c.pitchAir * w.air + accel * 0.35 + w.boost * 0.15;
      let tr = c.roll * lat;
      if (spinning) {
        tp += 0.5;
        tr += (ch.side || 0) * 0.5;
      }
      if (w.celebrate > 0.01) tp += Math.sin(t * 5.5) * 0.15 * w.celebrate;
      if (portrait) {
        tp = c.pitch0 * 0.5;
        tr = 0;
      }
      if (dt > 0) {
        const sub = dt > 1 / 45 ? 2 : 1;
        const h = dt / sub;
        for (let s = 0; s < sub; s++) {
          ch.pv += (c.k * (tp - ch.p) - c.c * ch.pv) * h;
          ch.p += ch.pv * h;
          ch.rv += (c.k * (tr - ch.r) - c.c * ch.rv) * h;
          ch.r += ch.rv * h;
        }
        if (m.landing) ch.pv -= m.landing * (ch.kind === 'ahoge' ? 9 : 4.5);
      } else {
        ch.p = tp;
        ch.r = tr;
      }
      const amp = portrait ? 0 : c.flutter + c.flutterSpeed * Math.min(1.2, speedN);
      const n = ch.bones.length;
      for (let i = 0; i < n; i++) {
        const wt = c.weights[i] ?? c.weights[c.weights.length - 1];
        const f = (i + 1) / n;
        const wave = Math.sin(t * c.freq - i * 0.9 + ch.phase) * amp * f;
        const wave2 = Math.cos(t * c.freq * 0.73 - i * 0.7 + ch.phase * 1.3) * amp * f * 0.8;
        ch.bones[i].rotation.set(ch.p * wt + wave, 0, ch.r * wt + wave2);
      }
    }
    void k;

    // ---- halo -----------------------------------------------------------------------------------
    this.halo.position.y = this.haloRest.y + Math.sin(t * 1.9) * 0.012 + w.celebrate * Math.abs(Math.sin(t * 5.5)) * 0.03;
    this.halo.rotation.z = -lean * 0.25 + Math.sin(t * 1.3) * 0.03;
    this.halo.rotation.x = -0.32 + w.air * 0.1;

    // ---- expression -----------------------------------------------------------------------------
    this.exprHold = Math.max(0, this.exprHold - dt);
    let expr = this.baseExpr;
    if (w.hurt > 0.4 && hurt) expr = spinning ? 'dizzy' : 'hurt';
    else if (st.celebrate || st.trick) expr = 'happy';
    else if (st.sad) expr = 'sad';
    else if (st.boosting || (drifting && (st.driftLevel || 0) >= 1) || st.invincible) expr = 'determined';
    if (expr === this.baseExpr && !portrait) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blinking = 0.13;
        this.blinkT = 1.8 + this._rand() * 3.2;
      }
      if (this.blinking > 0) {
        this.blinking -= dt;
        expr = 'blink';
      }
    }
    if (this.exprHold <= 0 || expr === 'dizzy' || expr === 'hurt') this.setExpression(expr, expr === this.baseExpr || expr === 'blink' ? 0 : 0.18);
  }

  _armPose(bone, side, target, bindDir, t, w, portrait) {
    // IK towards the steering-wheel grip (target is in driver space)
    this.bRoot.updateMatrix();
    this.bSpine.updateMatrix();
    _mA.multiplyMatrices(this.bRoot.matrix, this.bSpine.matrix).invert();
    _vA.copy(target).applyMatrix4(_mA).sub(bone.position).normalize();
    _qA.setFromUnitVectors(bindDir, _vA);
    let pw = 0;
    if (portrait) {
      _vB.set(side * 0.28, -1, 0.35).normalize();
      pw = 1;
    } else if (w.hurt > 0.01) {
      _vB.set(side * 0.75, 0.75 + Math.sin(t * 15 + side) * 0.35, 0.25 + Math.cos(t * 12 + side) * 0.35).normalize();
      pw = w.hurt;
    } else if (w.celebrate > 0.01) {
      const wave = Math.sin(t * 8 + (side > 0 ? 0 : 1.2)) * 0.35;
      _vB.set(side * (0.5 + wave * 0.5), 1.0, 0.2 + wave * 0.2).normalize();
      pw = w.celebrate;
    } else if (w.trick > 0.01) {
      _vB.set(side * 1.0, 0.5, 0.15).normalize();
      pw = w.trick;
    }
    if (pw > 0) {
      _qB.setFromUnitVectors(bindDir, _vB);
      _qA.slerp(_qB, clamp(pw, 0, 1));
    }
    bone.quaternion.copy(_qA);
  }

  dispose() {
    this.material.dispose();
    this.haloMaterial.dispose();
    this.haloGlowMaterial.dispose();
    this.haloGlow.geometry.dispose();
    this.skeleton.dispose();
    this.group.removeFromParent();
  }
}

export function createCharacterModel(character, opts = {}) {
  return new CharacterModel(character, opts);
}

/** Drop cached geometries/textures (e.g. when leaving the game). */
export function disposeCharacterCaches() {
  for (const a of _assetCache.values()) {
    a.geometry.dispose();
    a.outlineGeometry?.dispose();
    a.haloGeometry.dispose();
  }
  _assetCache.clear();
  for (const t of _faceCache.values()) t.dispose();
  _faceCache.clear();
}
