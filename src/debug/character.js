// Debug scene (owner: characters agent): /?scene=character
//   (default)            lineup of all 8 racers on turntables with name labels
//   &char=<id>           close-up turntable of one racer
//   &view=34|front|back|side|chase|face|top|rear34   camera for the close-up (default 34)
//   &state=idle|drive|drift|boost|miniturbo|celebrate|hurt|tumble|lookback|trick|invincible|sad|air
//   &spin=1              rotate the turntables      &quality=high|medium|low
//   &portraits=1         grid of the generated portraits (small 128 + large 256) on a checker background
//   &yaw=<deg>           fixed model yaw for close-ups
//   &states=drift,boost,.. (or 'all')  one character (&char, default serika) in several states side by side
// window.__ssk = { racers, stats(), state, portraits, portraitMs, renderInfo }

import * as THREE from 'three';
import { createRenderer, bindResize } from '../core/renderer.js';
import { CHARACTERS, getCharacter } from '../data/characters.js';
import { createRacerModel } from '../entities/RacerModel.js';
import { Portraits } from '../ui/Portraits.js';

function makeState(name, t) {
  const s = {
    speed: 0,
    steer: 0,
    throttle: 0,
    drifting: false,
    driftDir: 0,
    driftLevel: 0,
    boosting: false,
    boostStrength: 1,
    airborne: false,
    trick: false,
    spinning: false,
    tumbling: false,
    hurt: false,
    shrink: 1,
    invincible: false,
    celebrate: false,
    sad: false,
    lookBack: false,
    time: t,
  };
  switch (name) {
    case 'drive':
      s.speed = 30;
      s.throttle = 1;
      s.steer = Math.sin(t * 0.9) * 0.9;
      break;
    case 'drift':
      s.speed = 30;
      s.throttle = 1;
      s.drifting = true;
      s.driftDir = 1;
      s.steer = 0.55 + 0.35 * Math.sin(t * 2.2);
      s.driftLevel = 1 + (Math.floor(t / 1.6) % 3);
      break;
    case 'boost':
      s.speed = 44;
      s.throttle = 1;
      s.boosting = true;
      break;
    case 'miniturbo': {
      const p = t % 4;
      s.speed = 32;
      s.throttle = 1;
      if (p < 3) {
        s.drifting = true;
        s.driftDir = -1;
        s.steer = -0.7;
        s.driftLevel = p < 0.9 ? 0 : p < 1.9 ? 1 : 2;
      } else s.boosting = true;
      break;
    }
    case 'celebrate':
      s.celebrate = true;
      break;
    case 'hurt':
      s.spinning = true;
      s.hurt = true;
      s.speed = 8;
      break;
    case 'tumble':
      s.tumbling = true;
      s.hurt = true;
      s.speed = 8;
      s.airborne = true;
      break;
    case 'lookback':
      s.lookBack = true;
      s.speed = 28;
      s.throttle = 1;
      break;
    case 'trick':
      s.speed = 34;
      s.throttle = 1;
      s.airborne = t % 2.2 < 1.2;
      s.trick = t % 2.2 < 0.55;
      break;
    case 'air':
      s.speed = 34;
      s.airborne = true;
      break;
    case 'invincible':
      s.invincible = true;
      s.speed = 40;
      s.throttle = 1;
      break;
    case 'sad':
      s.sad = true;
      break;
    default:
      break;
  }
  return s;
}

function skyTexture() {
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 256;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#3d8ff0');
  gr.addColorStop(0.55, '#a9dcff');
  gr.addColorStop(1, '#fff3dc');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function groundTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#9fd67c';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#93cc70';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) g.fillRect(x * 32, y * 32, 32, 32);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 20);
  return t;
}

export async function run({ params, container, overlayRoot }) {
  const quality = params.get('quality') || 'high';
  const renderer = createRenderer(container, { quality });
  const scene = new THREE.Scene();
  scene.background = skyTexture();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 500);
  bindResize(renderer, () => [camera]);
  window.__ssk = window.__ssk || {};

  // portraits grid
  if (params.get('portraits') === '1') {
    const portraits = new Portraits(renderer);
    const t0 = performance.now();
    await portraits.generate(CHARACTERS);
    const ms = performance.now() - t0;
    window.__ssk.portraits = portraits;
    window.__ssk.portraitMs = ms;
    console.log(`[character] portraits generated in ${ms.toFixed(0)} ms`);
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;inset:0;overflow:auto;padding:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;pointer-events:auto;' +
      'background:repeating-conic-gradient(#d9dee8 0% 25%, #f4f6fa 0% 50%) 50% / 24px 24px;font:14px sans-serif;color:#223';
    for (const c of CHARACTERS) {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';
      cell.innerHTML = `<img src="${portraits.getLarge(c.id)}" width="256" height="256" style="border:1px solid #9ab"><div style="display:flex;gap:6px;align-items:center"><img src="${portraits.get(c.id)}" width="64" height="64" style="border-radius:50%;background:#2a3a66;border:3px solid #fff"><img src="${portraits.get(c.id)}" width="128" height="128" style="border:1px solid #9ab"><b>${c.name}</b></div>`;
      wrap.appendChild(cell);
    }
    (overlayRoot || document.body).appendChild(wrap);
    renderer.setAnimationLoop(null);
    return;
  }

  const hemi = new THREE.HemisphereLight('#cfe6ff', '#c7a26b', 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.position.set(0.4, 1.0, 0.25).multiplyScalar(20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -12;
  sun.shadow.camera.right = sun.shadow.camera.top = 12;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshLambertMaterial({ map: groundTexture() }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const ALL_STATES = ['idle', 'drive', 'drift', 'boost', 'miniturbo', 'celebrate', 'hurt', 'tumble', 'lookback', 'trick', 'invincible', 'sad', 'air'];
  const statesParam = params.get('states');
  const stateList = statesParam ? (statesParam === 'all' || statesParam === '1' ? ALL_STATES : statesParam.split(',').filter(Boolean)) : null;
  const charId = stateList ? null : params.get('char');
  const stateName = params.get('state') || (charId ? 'idle' : 'idle');
  const view = params.get('view') || '34';
  const spin = params.get('spin') === '1';
  const fixedYaw = params.get('yaw') !== null ? (Number(params.get('yaw')) * Math.PI) / 180 : null;
  const list = charId ? [getCharacter(charId)] : stateList ? stateList.map(() => getCharacter(params.get('char') || 'serika')) : CHARACTERS;
  const racers = [];
  const labels = [];
  const turntableMat = new THREE.MeshLambertMaterial({ color: '#eef3fa' });
  const ringMat = new THREE.MeshLambertMaterial({ color: '#1fb6ff' });
  const spacing = 2.35;
  list.forEach((c, i) => {
    const holder = new THREE.Group();
    const x = charId ? 0 : (i - (list.length - 1) / 2) * spacing;
    holder.position.set(x, 0.12, 0);
    const tt = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.12, 40), turntableMat);
    tt.position.set(x, 0.06, 0);
    tt.receiveShadow = true;
    scene.add(tt);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.03, 6, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.12, 0);
    scene.add(ring);
    const t0 = performance.now();
    const racer = createRacerModel(c, { quality });
    const ms = performance.now() - t0;
    holder.add(racer.root);
    scene.add(holder);
    racers.push({ c, racer, holder, buildMs: ms });
    if (!charId) {
      const el = document.createElement('div');
      el.textContent = stateList ? stateList[i] : c.name;
      el.style.cssText =
        'position:fixed;transform:translate(-50%,0);font:900 18px "Lilita One","Arial Black",sans-serif;color:#fff;-webkit-text-stroke:1px #16213a;' +
        'text-shadow:0 2px 0 #16213a;padding:2px 10px;border-radius:10px;background:rgba(31,182,255,0.85);pointer-events:none;white-space:nowrap';
      (overlayRoot || document.body).appendChild(el);
      labels.push({ el, holder });
    }
  });

  // camera
  const setCam = () => {
    if (!charId) {
      const k = Math.max(3, list.length) / 8;
      camera.fov = 30;
      camera.position.set(0, 1.2 + 2.6 * k, 18 * k);
      camera.lookAt(0, 0.9, 0);
    } else {
      const views = {
        front: [[0, 1.25, 4.4], [0, 0.95, 0], 35],
        34: [[2.9, 1.55, 3.4], [0, 0.9, 0], 35],
        rear34: [[-2.9, 1.9, -3.4], [0, 0.9, 0], 35],
        back: [[0, 1.7, -4.4], [0, 0.95, 0], 35],
        side: [[4.4, 1.1, 0], [0, 0.85, 0], 35],
        chase: [[0, 2.6, -6.5], [0, 1.0, 3.0], 70],
        face: [[0.7, 1.35, 1.9], [0, 1.1, -0.2], 28],
        top: [[0, 5.5, 0.01], [0, 0, 0], 35],
      };
      const v = views[view] || views['34'];
      camera.fov = v[2];
      camera.position.set(...v[0]);
      camera.lookAt(...v[1]);
    }
    camera.updateProjectionMatrix();
  };
  setCam();
  window.addEventListener('resize', setCam);

  const timer = new THREE.Timer();
  const v = new THREE.Vector3();
  let frames = 0;
  window.__ssk.racers = racers.map((r) => r.racer);
  window.__ssk.buildMs = racers.map((r) => `${r.c.id}:${r.buildMs.toFixed(1)}`);
  window.__ssk.stats = () => racers.map((r) => ({ id: r.c.id, ...r.racer.stats(), buildMs: Math.round(r.buildMs) }));
  window.__ssk.state = stateName;
  window.__ssk.renderInfo = () => ({ ...renderer.info.render, memory: { ...renderer.info.memory }, programs: renderer.info.programs?.length });
  window.__ssk.assetTris = () =>
    racers.map((r) => ({
      id: r.c.id,
      driver: r.racer.characterModel.asset.tris,
      driverOutline: r.racer.characterModel.asset.outlineTris,
      kart: r.racer.kartModel.asset.tris,
      kartOutline: r.racer.kartModel.asset.outlineTris,
    }));
  let simTime = 0;
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    simTime += dt;
    const st = makeState(stateName, simTime);
    racers.forEach((r, i) => {
      const s = charId ? st : makeState(stateList ? stateList[i] : stateName, simTime + i * 0.37);
      r.racer.update(dt, s);
      if (fixedYaw !== null) r.holder.rotation.y = fixedYaw;
      else if (spin) r.holder.rotation.y += dt * 0.6;
      else if (!charId) r.holder.rotation.y = 0.35;
    });
    renderer.render(scene, camera);
    for (const l of labels) {
      v.copy(l.holder.position).setY(-0.15).project(camera);
      l.el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
      l.el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
    frames++;
    window.__ssk.frames = frames;
  });
}
