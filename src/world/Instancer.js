// Instanced batching of props (owner: world agent).
//
//   createInstancedProps(kindOrObject, transforms, opts) -> THREE.Group of InstancedMeshes
//     kindOrObject: a prop kind (string) or any Object3D (flattened once per material)
//     transforms:   [{ x, y, z, rotY?, rotX?, rotZ?, scale?: number | [x,y,z] | {x,y,z}, tint?: '#hex' }]
//     opts:         prop options (color, color2, seed, variant, night, text, width) +
//                   { castShadow=true, receiveShadow=true, brightness=0.08 (random per-instance tint),
//                     chunk=200 (spatial chunk size for culling), seed }
//   flattenObject(object3d) -> [{ geometry, material, castShadow }]  (per-material merged, transforms baked)
//
// One prop kind with 3 materials placed 300 times costs 3 draw calls per spatial chunk.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getPropParts } from './Props.js';
import { mulberry32 } from '../core/utils.js';

function normalizeGeometry(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

const flatCache = new WeakMap();

/** Flatten any Object3D into per-material merged geometries (relative to the object's own origin). */
export function flattenObject(root) {
  const cached = flatCache.get(root);
  if (cached) return cached;
  const prevParent = root.parent;
  const saved = { p: root.position.clone(), q: root.quaternion.clone(), s: root.scale.clone() };
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  if (prevParent) prevParent.remove(root);
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh) return;
    const geo = m.geometry;
    const mats = Array.isArray(m.material) ? m.material : null;
    const pushPart = (g, mat) => {
      g.applyMatrix4(m.matrixWorld);
      const e = byMat.get(mat) || { geos: [], shadow: false };
      e.geos.push(g);
      e.shadow ||= m.castShadow;
      byMat.set(mat, e);
    };
    if (mats) {
      const src = geo.index ? geo.toNonIndexed() : geo;
      for (const grp of geo.groups) {
        const sub = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
          const a = src.attributes[name];
          if (!a) continue;
          sub.setAttribute(name, new THREE.Float32BufferAttribute(a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
        }
        pushPart(normalizeGeometry(sub), mats[grp.materialIndex]);
      }
    } else {
      pushPart(normalizeGeometry(geo), m.material);
    }
  });
  root.position.copy(saved.p);
  root.quaternion.copy(saved.q);
  root.scale.copy(saved.s);
  if (prevParent) prevParent.add(root);
  const parts = [];
  for (const [material, e] of byMat) {
    const geometry = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false);
    geometry.computeBoundingSphere();
    parts.push({ geometry, material, castShadow: e.shadow && !material.transparent });
  }
  flatCache.set(root, parts);
  return parts;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function scaleOf(t, out) {
  const s = t.scale ?? 1;
  if (typeof s === 'number') return out.set(s, s, s);
  if (Array.isArray(s)) return out.set(s[0], s[1], s[2]);
  return out.set(s.x ?? 1, s.y ?? 1, s.z ?? 1);
}

/**
 * Batch many copies of a prop kind (or of an Object3D) into InstancedMeshes, split into spatial chunks so
 * off-screen chunks are frustum-culled (also for the shadow pass).
 */
export function createInstancedProps(kindOrObject, transforms, opts = {}) {
  const group = new THREE.Group();
  group.name = `instanced:${typeof kindOrObject === 'string' ? kindOrObject : kindOrObject.name || 'object'}`;
  if (!transforms || !transforms.length) return group;
  const parts = typeof kindOrObject === 'string' ? getPropParts(kindOrObject, opts) : flattenObject(kindOrObject);
  const castShadow = opts.castShadow !== false;
  const receiveShadow = opts.receiveShadow !== false;
  const bright = opts.brightness ?? 0.08;
  const rng = mulberry32((opts.seed ?? 7) * 7919 + transforms.length);

  // spatial chunks
  const chunk = opts.chunk ?? 200;
  const buckets = new Map();
  if (transforms.length > 40 && chunk > 0) {
    for (const t of transforms) {
      const k = `${Math.floor(t.x / chunk)},${Math.floor(t.z / chunk)}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(t);
    }
  } else buckets.set('all', transforms);

  for (const list of buckets.values()) {
    const n = list.length;
    const tints = new Array(n);
    for (let i = 0; i < n; i++) {
      const t = list[i];
      if (t.tint) tints[i] = _c.set(t.tint).clone();
      else {
        const v = 1 + (rng() * 2 - 1) * bright;
        tints[i] = new THREE.Color(v, v, v);
      }
    }
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, n);
      im.name = group.name;
      for (let i = 0; i < n; i++) {
        const t = list[i];
        _e.set(t.rotX || 0, t.rotY || 0, t.rotZ || 0, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(t.x, t.y, t.z);
        scaleOf(t, _s);
        _m.compose(_p, _q, _s);
        im.setMatrixAt(i, _m);
        if (bright > 0 || t.tint) im.setColorAt(i, tints[i]);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = castShadow && part.castShadow;
      im.receiveShadow = receiveShadow && !part.material.transparent;
      im.computeBoundingSphere();
      im.computeBoundingBox?.();
      im.userData.shared = true; // geometry/material shared with the prop cache
      group.add(im);
    }
  }
  return group;
}
