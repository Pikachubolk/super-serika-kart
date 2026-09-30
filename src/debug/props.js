// Debug scene: prop gallery (owner: world agent)
//   /?scene=props                     every PROP_KIND on a labelled grid (normalised size, slow camera drift)
//   options:
//     &kind=<kind>[,<kind>...]        only these kinds (one kind -> big turntable)
//     &variants=0,1,2                 show each kind once per variant value (e.g. billboard / building styles)
//     &seeds=3                        show each kind with N different seeds (shape variation of natural props)
//     &real=1                         true scale instead of normalised size
//     &theme=<preset>                 lighting/sky preset (default garden)   &night=1   night lighting + glows
//     &page=<n>&per=<n>               paginate the grid (default: everything)
//     &cols=<n>  &orbit=0|1  &angle=<rad>  &dist=<mult>  &labels=0  &instanced=1 (batch through the Instancer)
// window.__ssk: { props: [{ kind, object }], renderer, camera, info }

import * as THREE from 'three';
import { createRenderer, bindResize } from '../core/renderer.js';
import { createProp, PROP_KINDS, PROP_META } from '../world/Props.js';
import { createInstancedProps } from '../world/Instancer.js';
import { Environment } from '../world/Environment.js';
import { resolveTheme } from '../world/themes.js';

export async function run({ params, container, overlayRoot }) {
  const quality = params.get('quality') || 'high';
  const renderer = createRenderer(container, { quality });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000);
  bindResize(renderer, () => [camera]);

  const preset = params.get('theme') || 'garden';
  const night = params.get('night') === '1' || (params.get('night') !== '0' && preset === 'neon-night');
  const theme = resolveTheme({ preset, night, particles: null, fog: { near: 400, far: 2400 } });
  const real = params.get('real') === '1';
  const useInst = params.get('instanced') === '1';

  let kinds = params.get('kind') ? params.get('kind').split(',').filter(Boolean) : PROP_KINDS.slice();
  const variants = params.get('variants') ? params.get('variants').split(',').map((v) => (/^-?\d+$/.test(v) ? Number(v) : v)) : [undefined];
  const seedCount = Math.max(1, Number(params.get('seeds') || 1));
  const entries = [];
  for (const kind of kinds) for (const variant of variants) for (let s = 0; s < seedCount; s++) entries.push({ kind, variant, seed: s * 17 });
  const per = Number(params.get('per') || 0);
  const page = Number(params.get('page') || 0);
  const shown = per > 0 ? entries.slice(page * per, page * per + per) : entries;
  kinds = [...new Set(shown.map((e) => e.kind))];

  const cols = Number(params.get('cols') || Math.max(1, Math.ceil(Math.sqrt(shown.length * 1.9))));
  const rows = Math.ceil(shown.length / cols);
  const cell = real ? 26 : 9;
  const target = 5.2; // normalised prop size

  const env = new Environment(theme, { quality, center: new THREE.Vector3(0, 0, 0), radius: Math.max(60, cols * cell) });
  env.apply(scene);

  // ground: soft grass disc + pedestals
  const groundMat = new THREE.MeshLambertMaterial({ color: night ? '#1d2236' : theme.ground.color });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 64), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);
  const pedGeo = new THREE.CylinderGeometry(1, 1.08, 0.18, 40);
  const pedMat = new THREE.MeshLambertMaterial({ color: night ? '#2c3350' : '#f4f1ea' });
  const ringMat = new THREE.MeshBasicMaterial({ color: '#1fb6ff' });
  const ringGeo = new THREE.RingGeometry(0.98, 1.06, 48);

  const single = shown.length === 1;
  const items = [];
  const W = (cols - 1) * cell;
  const cellZ = cell * 1.3; // extra row spacing so the label under each prop never covers the next row
  const D = (rows - 1) * cellZ;
  shown.forEach((e, i) => {
    const cx = (i % cols) * cell - W / 2;
    const cz = Math.floor(i / cols) * cellZ - D / 2;
    const meta = PROP_META[e.kind] || { r: 1, h: 2 };
    const opts = { seed: e.seed, variant: e.variant, night, width: e.kind === 'torii' || e.kind === 'arch' ? 12 : undefined };
    let obj;
    if (useInst) {
      obj = createInstancedProps(e.kind, [{ x: 0, y: 0, z: 0, rotY: 0, scale: 1 }], opts);
    } else {
      obj = createProp(e.kind, opts);
    }
    // normalise size from the real bounding box (props are allowed to differ from PROP_META)
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.z, size.y * 0.8, 0.1);
    const s = real ? 1 : Math.min(3, target / extent);
    obj.scale.multiplyScalar(s);
    const floatY = meta.float ? (real ? 4 : 1.2) : 0;
    obj.position.set(cx, 0.09 + floatY - (meta.float ? box.min.y * s : 0), cz);
    scene.add(obj);
    const ped = new THREE.Mesh(pedGeo, pedMat);
    const pr = real ? Math.max(1.2, meta.r * 1.1) : Math.min(cell * 0.46, Math.max(size.x, size.z) * s * 0.62 + 0.6);
    ped.scale.set(pr, 1, pr);
    ped.position.set(cx, 0, cz);
    ped.receiveShadow = true;
    scene.add(ped);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(pr);
    ring.position.set(cx, 0.1, cz);
    scene.add(ring);
    items.push({ kind: e.kind, variant: e.variant, seed: e.seed, object: obj, top: new THREE.Vector3(cx, (box.max.y * s || 1) + floatY + 0.4, cz), foot: new THREE.Vector3(cx, 0.1, cz + pr * 1.02), size: size.clone(), scale: s, label: null });
  });

  // labels (DOM, projected every frame)
  const showLabels = params.get('labels') !== '0' && overlayRoot;
  let labelRoot = null;
  if (showLabels) {
    labelRoot = document.createElement('div');
    labelRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;font:600 11px/1.1 system-ui,sans-serif';
    overlayRoot.appendChild(labelRoot);
    for (const it of items) {
      const el = document.createElement('div');
      const sub = [it.variant !== undefined ? `v${it.variant}` : '', seedCount > 1 ? `s${it.seed}` : '', params.get('sizes') === '1' || single ? `${Math.max(it.size.x, it.size.z).toFixed(1)}×${it.size.y.toFixed(1)}` : ''].filter(Boolean).join(' ');
      el.innerHTML = `<b>${it.kind}</b>${sub ? `<br><span style="font-weight:400;opacity:.75;font-size:10px">${sub}</span>` : ''}`;
      el.style.cssText =
        'position:absolute;transform:translate(-50%,' + (single ? '-100%' : '0') + ');padding:1px 6px;border-radius:6px;background:rgba(16,24,48,.72);color:#fff;text-align:center;white-space:nowrap;border:1px solid rgba(90,200,255,.55)';
      labelRoot.appendChild(el);
      it.label = el;
    }
    const title = document.createElement('div');
    title.textContent = `Prop gallery — ${shown.length} of ${entries.length} (${PROP_KINDS.length} kinds)  theme=${preset}${night ? ' night' : ''}${real ? ' real-scale' : ''}`;
    title.style.cssText = 'position:fixed;left:12px;bottom:10px;padding:5px 10px;border-radius:8px;background:rgba(16,24,48,.78);color:#dff3ff;font:12px monospace';
    labelRoot.appendChild(title);
  }

  // camera
  const span = Math.max(W, D * 1.6, cell) + cell;
  const distMul = Number(params.get('dist') || 1);
  const orbit = params.has('orbit') ? params.get('orbit') === '1' : single;
  const angle0 = Number(params.get('angle') || 0);
  const focus = new THREE.Vector3(0, single ? items[0].top.y * 0.45 : 0, single ? 0 : D * 0.04);
  const timer = new THREE.Timer();
  timer.connect?.(document);
  const v = new THREE.Vector3();
  window.__ssk = window.__ssk || {};
  Object.assign(window.__ssk, { props: items.map((i) => ({ kind: i.kind, object: i.object })), renderer, camera, scene, info: renderer.info.render, kinds: PROP_KINDS });
  let frames = 0;
  let fpsT = 0;

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    if (single) {
      const r = Math.max(8, Math.max(items[0].size.x, items[0].size.z, items[0].size.y) * items[0].scale * 1.9) * distMul;
      const a = angle0 + (orbit ? t * 0.35 : 0.5);
      camera.position.set(Math.sin(a) * r, focus.y + r * 0.38, Math.cos(a) * r);
    } else {
      const a = angle0 + (orbit ? Math.sin(t * 0.15) * 0.35 : 0);
      const dist = span * 0.7 * distMul;
      camera.position.set(Math.sin(a) * dist * 0.62, dist * 1.0, Math.cos(a) * dist * 0.62 + D * 0.12);
    }
    camera.lookAt(focus);
    env.setShadowFocus(v.set(focus.x, 0, focus.z));
    // the shadow frustum of the Environment is tuned for a kart; widen it for the gallery
    const sc = env.sun.shadow.camera;
    const half = Math.max(30, span * 0.62);
    if (sc.right !== half) {
      Object.assign(sc, { left: -half, right: half, top: half, bottom: -half });
      sc.updateProjectionMatrix();
    }
    env.update(dt, t, camera);
    renderer.render(scene, camera);
    if (labelRoot) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (const it of items) {
        v.copy(single ? it.top : it.foot).project(camera);
        const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        it.label.style.display = vis ? 'block' : 'none';
        if (vis) it.label.style.left = `${((v.x + 1) / 2) * w}px`;
        if (vis) it.label.style.top = `${((1 - v.y) / 2) * h}px`;
      }
    }
    frames++;
    fpsT += dt;
    if (fpsT > 0.5) {
      window.__ssk.fps = frames / fpsT;
      frames = 0;
      fpsT = 0;
    }
  });
}
