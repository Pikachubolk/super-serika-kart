// Builds the renderable track + environment from a track definition (owner: world agent).
//
// API CONTRACT (ARCHITECTURE.md §5.2):
//   buildTrack(def, { quality='high' }={}) -> Track
//   Track = {
//     def, id, name, laps, path: TrackPath,
//     group: THREE.Group,                  road, off-road, walls, terrain, gantry, decorations, scenery
//     sun: THREE.DirectionalLight,
//     applyEnvironment(scene)              sky dome, clouds, fog, hemisphere + sun, weather particles
//     updateShadowFocus(position)          tight 2048 shadow frustum around the player (texel snapped)
//     itemBoxSpots: [{ position, d, lateral }]   (position ~1.3 above the road)
//     coinSpots:    [{ position, d, lateral }]   (position ~0.9 above the road)
//     hazards:      [{ position, radius, kind, effect, object3d, active: true, moving }]
//     minimap: { outline: [{x, z}], bounds: { minX, maxX, minZ, maxZ } }
//     setStartLights(n)                    0 off, 1..3 red lamps, 4 = GO (all lamps cyan-green)
//     update(dt, time, camera)             sky/weather/void animation, dash panels, moving hazards, scenery
//     dispose()
//   }
//   Additions (world agent):
//     theme                  the fully resolved theme (see src/world/themes.js resolveTheme)
//     environment            the Environment instance (sky, lights, weather)
//     groundAt(x, z)         height of terrain / embankment under (x, z), or null over the void
//     rampHeightAt(d, lat)   visual ramp wedge height at (d, lateral) (0 outside ramps) — physics may add it
//                            to groundY so karts ride up the wedge before the launch
//     ramps: [{ d0, d1, lat0, lat1, height, power }]
//     isClear(x, z, r)       circle does not touch the corridor
//     voidY                  height of the void / liquid surface (lava, water, cloud sea, abyss)
//     center, radius, stats  build statistics ({ buildMs, decorations })
//
// =========================================================================================================
// scenery(ctx) — per-track landmarks. `def.scenery(ctx)` is called once while the track is built (after the
// road, terrain and features, BEFORE the scattered decorations, so decorations avoid your landmarks).
// Errors are caught and logged; a broken scenery never breaks the race.
//
//   ctx.THREE                 the three.js namespace
//   ctx.group                 THREE.Group — add your objects here (place() does it for you)
//   ctx.path, ctx.def         TrackPath and the track definition
//   ctx.theme                 resolved theme (all fields present)
//   ctx.rng()                 seeded mulberry32 for this track (deterministic)
//   ctx.quality               'high' | 'medium' | 'low' (skip fine detail on low)
//   ctx.night                 theme.night
//   ctx.props.create(kind, opts) -> Object3D   prop library (src/world/Props.js). opts: { scale, color,
//                             color2, seed, variant, text, width, night } — night defaults to the theme's.
//   ctx.props.kinds / ctx.props.meta           PROP_KINDS / PROP_META (footprint radius r, height h ...)
//   ctx.mat(color, opts?)     shared cached material. opts: { emissive, emissiveIntensity, toon, opacity,
//                             side, map, emissiveMap, standard, basic, additive, flatShading }
//   ctx.place(object, { t | d, lateral=0, y=0, yaw=0, align=true, ground=false, reserve=true }) -> object
//                             positions relative to the track: point on the road plane at (d, lateral), plus y
//                             (world up). align=true rotates the object to face along the track (+Z forward).
//                             ground=true snaps to the terrain/embankment height first. reserve registers the
//                             object's footprint so scattered decorations keep clear of it.
//   ctx.isClear(x, z, radius) -> bool          true if the circle does not touch road / off-road / walls
//   ctx.groundAt(x, z) -> number|null         terrain or embankment height (null = void, nothing below)
//   ctx.pointAt(d, lateral) -> Vector3        road-surface point;   ctx.frameAt(d) -> TrackPath frame
//   ctx.addHazard({ position, radius=1.2, kind, effect='bump'|'spin'|'launch', object3d?, moving? }) -> hazard
//                             collidable obstacle. Without object3d a prop of `kind` is created at position.
//                             Moving hazards: update hazard.position (and your object) in an addAnimated fn.
//   ctx.addAnimated(fn(dt, time))            per-frame callback (windmills, spinning halos, bobbing boats...)
//   ctx.instanced(kindOrObject3D, [{ x, y, z, rotY?, rotX?, rotZ?, scale?, tint? }], opts?) -> Group
//                             batch MANY copies (prop kind or your own Object3D) into InstancedMeshes: a few
//                             draw calls for hundreds of objects. opts: prop options + { castShadow }.
//   ctx.reserve(x, z, radius)                keep scattered decorations away from an area
//   ctx.textTexture(text, { width=512, height=128, bg, color, font, size, stroke }) -> CanvasTexture
//   ctx.center (Vector3), ctx.radius, ctx.voidY, ctx.bounds
// Performance: prefer ctx.instanced for anything repeated more than ~5 times; props from props.create are
// already merged per material (1-5 draw calls each).
// =========================================================================================================

import * as THREE from 'three';
import { TrackPath } from './TrackPath.js';
import { resolveTheme } from './themes.js';
import { mulberry32, hashString } from '../core/utils.js';
import { TextureKit, makeCanvas, canvasTexture, chunkyText, paintWithFonts } from './textures.js';
import { Corridor, analyzeTrack } from './Corridor.js';
import { Environment } from './Environment.js';
import { buildTerrain } from './Terrain.js';
import { buildRoad } from './RoadBuilder.js';
import { buildFeatures, rampProfile, addFeatureHazard } from './Features.js';
import { buildDecorations, Footprints } from './Decorations.js';
import { createProp, getMaterial, PROP_KINDS, PROP_META } from './Props.js';
import { createInstancedProps } from './Instancer.js';

export function buildTrack(def, opts = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const quality = opts.quality || 'high';
  const theme = resolveTheme(def.theme);
  const path = new TrackPath(def);
  const seed = hashString(def.id || 'track');
  const group = new THREE.Group();
  group.name = `track:${def.id}`;
  const b = path.bounds;
  const center = new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
  const radius = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;

  const kit = new TextureKit({ quality, seed });
  const corridor = new Corridor(path);
  const analysis = analyzeTrack(path, theme, corridor);
  const env = new Environment(theme, { quality, center, radius });

  const W = {
    THREE,
    def,
    theme,
    path,
    quality,
    group,
    kit,
    corridor,
    analysis,
    center,
    radius,
    seed,
    sunDir: env.sunDir,
    animated: [],
    disposables: [],
    matCache: new Map(),
    hazards: [],
    instancedGroups: [],
    footprints: new Footprints(),
    stats: {},
    setStartLights: null,
  };

  W.terrain = buildTerrain(W);
  buildRoad(W);
  const { itemBoxSpots, coinSpots } = buildFeatures(W);

  // ---- scenery hook (before scattered decorations so they avoid landmarks)
  const sceneryGroup = new THREE.Group();
  sceneryGroup.name = 'scenery';
  group.add(sceneryGroup);
  if (typeof def.scenery === 'function') {
    const ctx = makeSceneryCtx(W, sceneryGroup);
    try {
      def.scenery(ctx);
    } catch (err) {
      console.error(`[TrackBuilder] scenery() of "${def.id}" threw — continuing without the rest of it:`, err);
    }
  }

  buildDecorations(W);

  const outline = path.outline2D(4).map((p) => ({ x: p.x, z: p.z }));
  W.stats.buildMs = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0);
  W.stats.bridgeSamples = analysis.bridgeCount;

  const failed = new Set();
  const track = {
    def,
    id: def.id,
    name: def.name,
    laps: def.laps ?? 3,
    path,
    group,
    sun: env.sun,
    theme,
    environment: env,
    itemBoxSpots,
    coinSpots,
    hazards: W.hazards,
    ramps: W.ramps || [],
    minimap: { outline, bounds: { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z } },
    center,
    radius,
    voidY: analysis.voidY,
    stats: W.stats,

    applyEnvironment(scene) {
      env.apply(scene);
    },
    updateShadowFocus(position) {
      if (position) env.setShadowFocus(position);
    },
    setStartLights(n) {
      W.setStartLights?.(n);
    },
    update(dt, time, camera) {
      env.update(dt, time, camera);
      W.terrain.update(dt, time);
      const A = W.animated;
      for (let i = 0; i < A.length; i++) {
        const fn = A[i];
        if (failed.has(fn)) continue;
        try {
          fn(dt, time);
        } catch (err) {
          failed.add(fn);
          console.error('[TrackBuilder] animated callback failed (disabled):', err);
        }
      }
    },
    groundAt(x, z) {
      return W.terrain.groundAt(x, z);
    },
    rampHeightAt(d, lateral) {
      const R = W.ramps;
      if (!R || !R.length) return 0;
      for (let i = 0; i < R.length; i++) {
        const r = R[i];
        if (lateral < r.lat0 || lateral > r.lat1) continue;
        const len = r.d1 - r.d0;
        const dd = path.deltaD(d, r.d0);
        if (dd < 0 || dd > len) continue;
        return r.height * rampProfile(dd / len);
      }
      return 0;
    },
    isClear(x, z, r = 0) {
      return corridor.isClear(x, z, r);
    },
    dispose() {
      env.dispose();
      group.removeFromParent();
      const seenG = new Set();
      const seenM = new Set();
      group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        if (!o.isMesh && !o.isPoints) return;
        const g = o.geometry;
        if (g && !g.userData?.shared && !seenG.has(g)) {
          seenG.add(g);
          g.dispose();
        }
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (!m || m.userData?.shared || seenM.has(m)) continue;
          seenM.add(m);
          m.dispose();
        }
      });
      for (const d of W.disposables) if (!d?.userData?.shared) d?.dispose?.();
      kit.dispose();
      W.animated.length = 0;
    },
  };
  return track;
}

// ---------------------------------------------------------------------------------------------------------
function makeSceneryCtx(W, sceneryGroup) {
  const { path, theme, quality, corridor, def } = W;
  const rng = mulberry32(W.seed ^ 0x5ce9e);
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const reserveObject = (obj) => {
    box.setFromObject(obj);
    if (box.isEmpty()) return;
    box.getSize(size);
    const r = Math.max(size.x, size.z) / 2;
    const c = box.getCenter(new THREE.Vector3());
    W.footprints.add(c.x, c.z, r);
  };
  const ctx = {
    THREE,
    group: sceneryGroup,
    path,
    def,
    theme,
    rng,
    quality,
    night: theme.night,
    center: W.center.clone(),
    radius: W.radius,
    voidY: W.analysis.voidY,
    bounds: path.bounds,
    props: {
      create: (kind, o = {}) => createProp(kind, { night: theme.night, ...o }),
      kinds: PROP_KINDS,
      meta: PROP_META,
    },
    mat: (color, o = {}) => getMaterial(color, o),
    pointAt: (d, lateral = 0) => path.pointAt(d, lateral),
    frameAt: (d) => path.frameAt(d),
    place(object, o = {}) {
      const d = o.t !== undefined ? o.t * path.length : o.d ?? 0;
      const f = path.frameAt(d);
      const lat = o.lateral ?? 0;
      const p = new THREE.Vector3(f.pos.x + f.rightH.x * lat, f.pos.y + lat * f.slope, f.pos.z + f.rightH.z * lat);
      if (o.ground) {
        const g = W.terrain.groundAt(p.x, p.z);
        if (g !== null && g !== undefined) p.y = g;
      }
      p.y += o.y ?? 0;
      object.position.copy(p);
      object.rotation.y = (o.align === false ? 0 : f.yaw) + (o.yaw ?? 0);
      if (!object.parent) sceneryGroup.add(object);
      if (o.reserve !== false) {
        object.updateMatrixWorld(true);
        reserveObject(object);
      }
      return object;
    },
    isClear: (x, z, r = 0) => corridor.isClear(x, z, r),
    groundAt: (x, z) => W.terrain.groundAt(x, z),
    addHazard(h = {}) {
      let obj = h.object3d;
      const radius = h.radius ?? 1.2;
      const position = h.position ? h.position.clone() : new THREE.Vector3();
      if (!obj && h.kind && h.visual !== false) {
        const meta = PROP_META[h.kind] || { r: 1 };
        obj = createProp(h.kind, { night: theme.night, scale: Math.max(0.3, radius / meta.r), seed: Math.floor(rng() * 999) });
        obj.position.copy(position);
        obj.rotation.y = rng() * Math.PI * 2;
        sceneryGroup.add(obj);
      }
      const hz = { position, radius, kind: h.kind || 'rock', effect: h.effect || 'bump', object3d: obj || null, active: true, moving: !!h.moving };
      W.hazards.push(hz);
      return hz;
    },
    addFeatureHazard: (f) => addFeatureHazard(W, f, path.resolveD(f), f.lateral ?? 0, rng),
    addAnimated(fn) {
      if (typeof fn === 'function') W.animated.push(fn);
    },
    instanced(kind, transforms, o = {}) {
      const g = createInstancedProps(kind, transforms, { night: theme.night, castShadow: quality !== 'low', ...o });
      sceneryGroup.add(g);
      W.instancedGroups.push(g);
      if (o.reserve !== false) {
        const meta = typeof kind === 'string' ? PROP_META[kind] : null;
        for (const t of transforms) {
          const s = typeof t.scale === 'number' ? t.scale : 1;
          W.footprints.add(t.x, t.z, (meta ? meta.r : 1.5) * s);
        }
      }
      return g;
    },
    reserve(x, z, r) {
      W.footprints.add(x, z, r);
    },
    textTexture(text, o = {}) {
      const w = o.width ?? 512;
      const h = o.height ?? 128;
      const { c, g } = makeCanvas(w, h);
      const tex = canvasTexture(c, { repeat: false });
      paintWithFonts(tex, () => {
        g.clearRect(0, 0, w, h);
        if (o.bg) {
          g.fillStyle = o.bg;
          g.fillRect(0, 0, w, h);
        }
        chunkyText(g, text, w / 2, h / 2, o.size ?? h * 0.62, { fill: o.color || '#ffffff', stroke: o.stroke || '#16213a', strokeW: o.strokeW ?? 0.1, font: o.font, maxWidth: w * 0.94 });
      });
      W.disposables.push(tex);
      return tex;
    },
  };
  return ctx;
}
