// Debug scene (owner: world agent)
//   /?scene=track&track=<id>&view=fly|orbit|top|chase|free
//   options:
//     &d=<start distance>   &lat=<lateral>   &speed=<fly speed u/s, 0 = frozen>   &quality=high|medium|low
//     &theme=<preset>       desert|city-sunset|garden|neon-night|sakura|snow|lava|sky (overrides the theme)
//     &road= &edge= &wall= &offroad= &ground= &void= &particles= &night=0|1   single theme overrides
//     &walls=partial        remove the walls on a few sections (tests void visuals)
//     &lights=0..4          start lamp state      &time=<seconds> fixed animation time offset
//     &cam=x,y,z&look=x,y,z  explicit camera (view=free)
//     &hud=0                hide the stats overlay
//     &hide=a,b             hide objects whose name starts with a or b (perf bisection)
//   track=world-test is a built-in figure-8 with a bridge, a wall-less section and every feature type.
// window.__ssk: { track, info (renderer.info.render), memory, stats, camera, renderer }

import * as THREE from 'three';
import { createRenderer, bindResize } from '../core/renderer.js';
import { loadTrackDef, getTrackEntry } from '../data/tracks/index.js';
import { buildTrack } from '../world/TrackBuilder.js';
import { THEME_PRESETS } from '../world/themes.js';

function worldTestDef() {
  const pts = [];
  const n = 18;
  const t0 = Math.PI * 0.62;
  for (let k = 0; k < n; k++) {
    const t = t0 + (k / n) * Math.PI * 2;
    const p = { x: Math.round(210 * Math.sin(t)), y: +(4.5 + 4.5 * Math.cos(t)).toFixed(2), z: Math.round(118 * Math.sin(2 * t)) };
    pts.push(p);
  }
  // a wall-less stretch on the far lobe
  for (const k of [11, 12]) Object.assign(pts[k], { wall: false });
  pts[4].bank = -6;
  pts[13].bank = 6;
  return {
    id: 'world-test',
    name: 'World Test Figure-8',
    laps: 3,
    width: 22,
    offroad: 7,
    wall: true,
    points: pts,
    features: [
      { type: 'itemRow', t: 0.06, count: 4 },
      { type: 'coins', t: 0.13, count: 6, spacing: 4, lateral: -4 },
      { type: 'boost', t: 0.18, lateral: 4, length: 8, width: 5 },
      { type: 'ramp', t: 0.3, lateral: 0, length: 10, power: 1 },
      { type: 'slow', t: 0.4, lateral: -5, length: 12, width: 7 },
      { type: 'itemRow', t: 0.5, count: 4 },
      { type: 'hazard', t: 0.58, lateral: -5, kind: 'barrel', radius: 1.2 },
      { type: 'hazard', t: 0.62, lateral: 0, kind: 'crate', radius: 1.1, move: { lateral: 6, speed: 1.1 } },
      { type: 'boost', t: 0.72, lateral: -4, length: 8, width: 5 },
      { type: 'hazardZone', t: 0.8, lateral: 5, length: 8, width: 6 },
      { type: 'hazard', t: 0.86, lateral: 6, kind: 'cone', radius: 0.5 },
    ],
    decorations: [
      { kind: 'tree', count: 90, side: 'both', minOffset: 4, maxOffset: 70, scale: [0.8, 1.3], seed: 1 },
      { kind: 'rock', count: 40, side: 'both', minOffset: 2, maxOffset: 60, scale: [0.6, 1.6], seed: 2 },
      { kind: 'bush', count: 60, side: 'both', minOffset: 1, maxOffset: 25, seed: 3 },
      { kind: 'lamp', every: 45, side: 'both', offset: 1.4 },
      { kind: 'billboard', every: 260, side: 'outside', offset: 8, variant: [0, 1, 2, 3] },
      { kind: 'grandstand', count: 2, side: 'both', minOffset: 3, maxOffset: 6, tRange: [0.96, 0.04], seed: 4 },
      { kind: 'cone', count: 16, side: 'both', minOffset: -3, maxOffset: -1, seed: 5 },
      { kind: 'balloon', count: 5, side: 'both', minOffset: 30, maxOffset: 160, seed: 6 },
      { kind: 'flowerBed', count: 16, side: 'both', minOffset: 2, maxOffset: 12, seed: 7 },
    ],
    theme: { preset: 'garden' },
    scenery(ctx) {
      const { THREE } = ctx;
      // a torii spanning the road
      const f = ctx.frameAt(0.26 * ctx.path.length);
      const torii = ctx.props.create('torii', { width: f.halfWidth * 2 + 4 });
      ctx.place(torii, { t: 0.26 });
      // a pagoda landmark inside the loop
      for (let tries = 0; tries < 40; tries++) {
        const x = ctx.center.x + (ctx.rng() - 0.5) * 300;
        const z = ctx.center.z + (ctx.rng() - 0.5) * 160;
        if (!ctx.isClear(x, z, 9)) continue;
        const p = ctx.props.create('pagoda');
        p.position.set(x, ctx.groundAt(x, z) ?? 0, z);
        ctx.group.add(p);
        ctx.reserve(x, z, 8);
        break;
      }
      // lanterns every 6 units along a stretch, batched
      const tr = [];
      for (let d = 0.44 * ctx.path.length; d < 0.52 * ctx.path.length; d += 6) {
        for (const side of [-1, 1]) {
          const fr = ctx.frameAt(d);
          const lat = side * (fr.halfWidth + fr.offR + 2.2);
          const p = ctx.pointAt(d, lat);
          if (!ctx.isClear(p.x, p.z, 0.6)) continue;
          tr.push({ x: p.x, y: ctx.groundAt(p.x, p.z) ?? p.y, z: p.z, rotY: fr.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
        }
      }
      ctx.instanced('lantern', tr, { color: '#e8342c' });
      // a spinning gear hazard beside the road
      const gear = ctx.props.create('gear', { scale: 1.2 });
      ctx.place(gear, { t: 0.68, lateral: ctx.frameAt(0.68 * ctx.path.length).halfWidth + 12, ground: true, align: true, yaw: Math.PI / 2 });
      const inner = gear.children[0];
      ctx.addAnimated((dt) => {
        if (inner) inner.rotation.z += dt * 0.8;
      });
      void THREE;
    },
  };
}

function applyOverrides(def, params) {
  def = { ...def };
  const preset = params.get('theme');
  let theme = { ...(def.theme || {}) };
  if (preset && THEME_PRESETS[preset]) theme = { preset };
  const set = (k, field, v) => {
    theme[k] = { ...(theme[k] || (preset ? {} : {})), [field]: v };
  };
  if (params.get('road')) set('road', 'style', params.get('road'));
  if (params.get('edge')) set('edge', 'style', params.get('edge'));
  if (params.get('wall')) set('wall', 'style', params.get('wall'));
  if (params.get('offroad')) set('offroad', 'type', params.get('offroad'));
  if (params.get('ground')) set('ground', 'type', params.get('ground'));
  if (params.get('void')) set('void', 'type', params.get('void'));
  if (params.has('particles')) theme.particles = params.get('particles') || null;
  if (params.has('night')) theme.night = params.get('night') === '1';
  def.theme = theme;
  if (params.get('walls') === 'partial') {
    def.points = def.points.map((p, i) => (i % 5 === 2 ? { ...p, wall: false } : p));
  } else if (params.get('walls') === 'none') {
    def.wall = false;
    def.points = def.points.map((p) => ({ ...p, wall: false, wallL: false, wallR: false }));
  }
  return def;
}

export async function run({ params, container, overlayRoot }) {
  const quality = params.get('quality') || 'high';
  const renderer = createRenderer(container, { quality });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(params.get('fov') || 70), 1, 0.1, 2500);
  bindResize(renderer, () => [camera]);
  const id = params.get('track') || 'test-oval';
  let def;
  if (id === 'world-test') def = worldTestDef();
  else if (getTrackEntry(id)) def = await loadTrackDef(id);
  else def = worldTestDef();
  def = applyOverrides(def, params);

  const track = buildTrack(def, { quality });
  scene.add(track.group);
  track.applyEnvironment(scene);
  // &hide=name1,name2  hide objects whose name starts with one of the prefixes (perf bisection)
  if (params.get('hide')) {
    const pre = params.get('hide').split(',').filter(Boolean);
    scene.traverse((o) => {
      if (o.name && pre.some((p) => o.name.startsWith(p))) o.visible = false;
    });
  }
  if (params.has('lights')) track.setStartLights(Number(params.get('lights')));

  const view = params.get('view') || 'fly';
  const path = track.path;
  const b = path.bounds;
  const center = new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
  const size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  let d = Number(params.get('d') || 0);
  const lat = Number(params.get('lat') || 0);
  const speed = params.has('speed') ? Number(params.get('speed')) : view === 'chase' ? 0 : 30;
  const timeOffset = Number(params.get('time') || 0);
  const timer = new THREE.Timer();
  timer.connect?.(document);

  window.__ssk = window.__ssk || {};
  Object.assign(window.__ssk, { track, renderer, camera, scene, info: renderer.info.render, memory: renderer.info.memory, stats: track.stats });

  // stats overlay
  let hud = null;
  if (params.get('hud') !== '0' && overlayRoot) {
    hud = document.createElement('div');
    hud.className = 'wrld-debug';
    hud.style.cssText =
      'position:fixed;left:10px;top:10px;padding:6px 10px;background:rgba(10,16,34,.72);color:#dff3ff;font:12px/1.35 monospace;border-radius:8px;white-space:pre;pointer-events:none';
    overlayRoot.appendChild(hud);
  }

  const look = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let frames = 0;
  let fpsT = 0;
  let fps = 0;
  const cam = params.get('cam')?.split(',').map(Number);
  const lookAt = params.get('look')?.split(',').map(Number);
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed() + timeOffset;
    if (view === 'top') {
      camera.position.set(center.x, center.y + size * 1.05, center.z + 0.01);
      camera.lookAt(center);
    } else if (view === 'orbit') {
      const a = t * 0.08 + Number(params.get('angle') || 0);
      camera.position.set(center.x + Math.cos(a) * size * 0.72, center.y + size * 0.42, center.z + Math.sin(a) * size * 0.72);
      camera.lookAt(center);
    } else if (view === 'free' && cam) {
      camera.position.set(cam[0], cam[1], cam[2]);
      if (lookAt) camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    } else {
      // fly / chase: kart-like camera at distance d (fly moves along)
      d += dt * speed;
      const f = path.frameAt(d);
      const kart = path.pointAt(d, lat);
      const back = view === 'chase' ? 6.5 : 7;
      const up = view === 'chase' ? 2.6 : 3.2;
      camera.position.copy(kart).addScaledVector(f.tan, -back);
      camera.position.y += up;
      path.pointAt(d + 10, lat, look);
      look.y += 1.2;
      camera.lookAt(look);
    }
    track.updateShadowFocus(view === 'fly' || view === 'chase' ? path.pointAt(d, lat, tmp) : tmp.copy(camera.position).setY(center.y));
    track.update(dt, t, camera);
    renderer.render(scene, camera);
    frames++;
    fpsT += dt;
    if (fpsT > 0.5) {
      fps = frames / fpsT;
      frames = 0;
      fpsT = 0;
      if (hud) {
        const i = renderer.info.render;
        hud.textContent = `${def.id}  [${track.theme.road.style}/${track.theme.edge.style}/${track.theme.wall.style}/${track.theme.ground.type}]  q=${quality}\nfps ${fps.toFixed(0)}  calls ${i.calls}  tris ${(i.triangles / 1000).toFixed(0)}k  build ${track.stats.buildMs}ms  deco ${track.stats.decorations ?? 0}  bridge ${track.stats.bridgeSamples}`;
      }
      window.__ssk.fps = fps;
    }
  });
}
