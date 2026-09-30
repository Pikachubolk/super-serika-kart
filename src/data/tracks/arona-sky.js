// Arona's Sky Classroom — Pyroxene Cup race 4, the grand finale (owner: tracks-D).
//
// A shimmering rainbow road through the sky of the Shittim Chest. No walls anywhere (void = cloud sea).
// Layout (figure-eight with a helix, start heading east):
//   start straight -> T1 right sweeper -> crest -> swoop down -> 450° right-hand descending HELIX around the giant
//   Shittim tablet -> under-pass -> T3 -> long tunnel run UNDER the start straight -> S-bends -> T4 ->
//   Classroom Islands jump (ramp across the gap between two floating islands) -> T5 -> rise -> final left sweeper.

import { course, makeMerger } from './gehenna-inferno.js';

const C = course({ x: 0, z: 0, y: 40, yaw: Math.PI / 2, attrs: { w: 26, off: 2 } }, [
  { len: 140, w: 26, off: 2, mark: 'straight' },
  { arc: 90, r: 70, w: 24, off: 2, bank: 10, y: 44, mark: 't1' },
  { len: 30, w: 22, off: 2, y: 44, mark: 'crest' },
  { len: 60, n: 2, w: 22, off: 2, y: 34, ease: true, mark: 'swoop' },
  { arc: 450, r: 44, step: 24, w: 22, off: 2, bank: 12, y: 15, mark: 'helix' },
  { len: 45, w: 22, off: 2, y: 15, mark: 'under' },
  { arc: 90, r: 55, w: 23, off: 2, bank: 8, y: 17, mark: 't3' },
  { len: 185, n: 4, w: 24, off: 2, y: 23, mark: 'tunnel' },
  { arc: -45, r: 60, w: 20, off: 2, bank: -9, y: 25, mark: 's1' },
  { arc: 45, r: 60, w: 20, off: 2, bank: 9, y: 27, mark: 's2' },
  { arc: -90, r: 50, w: 22, off: 2, bank: -11, y: 30, mark: 't4' },
  { len: 45, w: 22, off: 2, y: 32, mark: 'islandA' },
  { len: 16, w: 18, off: 1, y: 30.2, mark: 'gap' },
  { len: 16, w: 18, off: 1, y: 32, mark: 'gap2' },
  { len: 40, w: 22, off: 2, y: 32, mark: 'islandB' },
  { arc: -90, r: 50, w: 22, off: 2, bank: -10, y: 37, mark: 't5' },
  { len: 30, w: 22, off: 2, y: 42, mark: 'rise' },
  {
    close: true,
    r: 65,
    turn: 'left',
    mark: 'final',
    markA: 'drop',
    markB: 'home',
    yA: 44,
    attrsA: { w: 22, off: 2 },
    attrsArc: { w: 24, off: 2, bank: -10 },
    attrsB: { w: 26, off: 2 },
  },
]);

export const MARKS = C.marks;
export const CLOSE = C.closeInfo;
const LEN = C.length;
const T = (mark, off = 0) => {
  const t = (C.marks[mark] + off) / LEN;
  return ((t % 1) + 1) % 1;
};
const D = (mark, off = 0) => {
  const d = C.marks[mark] + off;
  return ((d % LEN) + LEN) % LEN;
};

// ---------------------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------------------
const ARONA = '#5fd0ff';
const ARONA_D = '#2f8fe0';
const PINK = '#ff9ee6';
const WALL = '#f3ecf7';

// ---------------------------------------------------------------------------------------------------------
// Canvas textures (browser only)
// ---------------------------------------------------------------------------------------------------------
function canvasTex(THREE, w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Fake mirror of the pastel sky for the shallow classroom water. */
function reflectionTexture(THREE) {
  return canvasTex(THREE, 256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.35, '#d9f1ff');
    grd.addColorStop(0.7, '#9fd6ff');
    grd.addColorStop(1, '#ffc8ec');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // reflected clouds
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [x, y, r] of [[60, 70, 26], [85, 60, 30], [110, 72, 22], [180, 170, 28], [205, 160, 22], [160, 176, 20], [70, 200, 18]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 2;
    for (let k = 0; k < 14; k++) {
      g.beginPath();
      const y = 10 + k * 18;
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.08 + k) * 2);
      g.stroke();
    }
  });
}

/** Arona-blue tablet screen: halo emblem + title + chat bubble. */
function tabletScreenTexture(THREE, title, sub) {
  return canvasTex(THREE, 512, 768, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#7fe0ff');
    grd.addColorStop(0.55, '#3aa8f0');
    grd.addColorStop(1, '#2a70d8');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 2;
    for (let x = 0; x < w; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y < h; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    // halo emblem
    g.strokeStyle = '#ffffff';
    g.lineWidth = 16;
    g.beginPath();
    g.ellipse(w / 2, 250, 130, 46, 0, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.save();
      g.translate(w / 2 + Math.cos(a) * 130, 250 + Math.sin(a) * 46);
      g.rotate(a);
      g.fillRect(-6, -18, 12, 36);
      g.restore();
    }
    g.beginPath();
    g.arc(w / 2, 250, 22, 0, Math.PI * 2);
    g.fill();
    // title + subtitle
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 64px "Lilita One", "Arial Black", sans-serif';
    g.lineWidth = 10;
    g.strokeStyle = '#1a4a9a';
    g.strokeText(title, w / 2, 430);
    g.fillText(title, w / 2, 430);
    // chat bubble
    g.fillStyle = 'rgba(255,255,255,0.92)';
    const bx = 60;
    const by = 520;
    const bw = w - 120;
    const bh = 140;
    g.beginPath();
    g.moveTo(bx + 24, by);
    g.arcTo(bx + bw, by, bx + bw, by + bh, 24);
    g.arcTo(bx + bw, by + bh, bx, by + bh, 24);
    g.arcTo(bx, by + bh, bx, by, 24);
    g.arcTo(bx, by, bx + bw, by, 24);
    g.closePath();
    g.fill();
    g.fillStyle = '#2a70d8';
    g.font = '700 40px "Nunito", "Arial", sans-serif';
    g.fillText(sub, w / 2, by + bh / 2);
  });
}

/** Chalkboard with a lesson for Sensei. */
function chalkboardTexture(THREE) {
  return canvasTex(THREE, 1024, 512, (g, w, h) => {
    g.fillStyle = '#2f5a48';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let k = 0; k < 40; k++) g.fillRect(Math.sin(k * 13.1) * w * 0.5 + w / 2, Math.cos(k * 7.7) * h * 0.5 + h / 2, 120, 30);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = '700 86px "Nunito", "Comic Sans MS", sans-serif';
    g.fillText('Welcome back, Sensei!', w / 2, 120);
    g.font = '600 52px "Nunito", "Comic Sans MS", sans-serif';
    g.fillStyle = '#ffe98a';
    g.fillText("Today's lesson: DRIFTING ♪", w / 2, 250);
    g.fillStyle = '#9fe4ff';
    g.fillText('blue → orange → purple = BOOST!', w / 2, 340);
    g.fillStyle = '#ffb3e6';
    g.font = '600 44px "Nunito", "Comic Sans MS", sans-serif';
    g.fillText('— Arona (class president)', w / 2 + 160, 440);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Scenery pieces
// ---------------------------------------------------------------------------------------------------------

/** Floating rock island (grass-cloud top, crystal underside), origin at the top surface centre. */
function islandMesh(ctx, M, x, y, z, r, depth, seed = 1) {
  const { THREE } = ctx;
  const top = ctx.mat('#dff3ff', { toon: true });
  const rim = ctx.mat('#b8d8f5', { toon: true });
  const rock = ctx.mat('#8fa3d6', { toon: true, flatShading: true });
  const rock2 = ctx.mat('#b69ae8', { toon: true, flatShading: true });
  M.add(new THREE.CylinderGeometry(r, r * 0.98, 1.4, 20), top, { p: [x, y - 0.7, z] });
  M.add(new THREE.CylinderGeometry(r * 1.02, r * 0.9, 2, 20), rim, { p: [x, y - 2.1, z] });
  const g = new THREE.ConeGeometry(r * 0.92, depth, 9, 3);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const h = Math.sin(px * 1.7 + py * 3.1 + pz * 2.3 + seed) * 43758.5;
    const k = 1 + ((h - Math.floor(h)) - 0.5) * 0.3;
    if (py > depth / 2 - 0.01) continue;
    pos.setXYZ(i, px * k, py, pz * k);
  }
  g.computeVertexNormals();
  M.add(g, rock, { p: [x, y - 3 - depth / 2, z], r: [Math.PI, 0, 0] });
  // hanging crystals
  for (let k = 0; k < 5; k++) {
    const a = k * 1.3 + seed;
    const rr = r * (0.3 + 0.12 * k);
    M.add(new THREE.ConeGeometry(1.2 + (k % 2), 5 + k, 5), rock2, { p: [x + Math.cos(a) * rr, y - 5 - k, z + Math.sin(a) * rr], r: [Math.PI, 0, 0] });
  }
}

/** Arona's floating classroom: a broken classroom standing in shallow water with a sky reflection. */
function buildClassroom(ctx) {
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const wall = ctx.mat(WALL, { toon: true });
  const trim = ctx.mat('#a8c8ef', { toon: true });
  const floor = ctx.mat('#e8d2b0', { toon: true });
  const frame = ctx.mat('#ffffff', { toon: true });
  const glass = ctx.mat('#bfe8ff', { opacity: 0.45, depthWrite: false, basic: true });
  const R = 34;
  // island base
  islandMesh(ctx, M, 0, 0, 0, R, 30, 3);
  // classroom floor tiles (half submerged)
  M.add(new THREE.BoxGeometry(34, 0.4, 26), floor, { p: [0, 0.1, -2] });
  // back wall with the chalkboard (broken at one end)
  M.add(new THREE.BoxGeometry(34, 11, 1.2), wall, { p: [0, 5.5, -15] });
  M.add(new THREE.BoxGeometry(34.4, 0.8, 1.6), trim, { p: [0, 11.2, -15] });
  M.add(new THREE.BoxGeometry(34.4, 1.2, 1.6), trim, { p: [0, 0.6, -15] });
  // left wall with window frames (broken top)
  for (let k = 0; k < 4; k++) {
    const z = -12 + k * 6.5;
    const h = k === 3 ? 5 : 11 - k * 0.6;
    M.add(new THREE.BoxGeometry(1.2, h, 1.4), wall, { p: [-17, h / 2, z] });
    if (k < 3) {
      M.add(new THREE.BoxGeometry(0.3, 5.4, 0.25), frame, { p: [-17, 6, z + 3.25] });
      M.add(new THREE.BoxGeometry(0.4, 0.3, 5.2), frame, { p: [-17, 3.3, z + 3.25] });
      M.add(new THREE.BoxGeometry(0.4, 0.3, 5.2), frame, { p: [-17, 8.7, z + 3.25] });
      M.add(new THREE.BoxGeometry(0.15, 5.2, 5.0), glass, { p: [-17, 6, z + 3.25], shadow: false });
    }
  }
  M.add(new THREE.BoxGeometry(1.2, 2.4, 26), wall, { p: [-17, 1.2, -2] });
  // right: a lone standing window frame + broken wall stubs
  M.add(new THREE.BoxGeometry(1.2, 6, 5), wall, { p: [17, 3, -11] });
  M.add(new THREE.BoxGeometry(1.2, 3, 4), wall, { p: [17, 1.5, 0], r: [0, 0, 0.08] });
  M.add(new THREE.BoxGeometry(0.4, 6, 0.4), frame, { p: [18, 5, 7] });
  M.add(new THREE.BoxGeometry(0.4, 6, 0.4), frame, { p: [18, 5, 12] });
  M.add(new THREE.BoxGeometry(0.4, 0.4, 5.4), frame, { p: [18, 8, 9.5] });
  M.add(new THREE.BoxGeometry(0.4, 0.4, 5.4), frame, { p: [18, 2, 9.5] });
  M.add(new THREE.BoxGeometry(0.12, 5.6, 5), glass, { p: [18, 5, 9.5], shadow: false });
  // teacher's desk + podium
  M.add(new THREE.BoxGeometry(6, 2.2, 2.4), ctx.mat('#c89a64', { toon: true }), { p: [0, 1.1, -9] });
  M.add(new THREE.BoxGeometry(6.4, 0.25, 2.8), ctx.mat('#a8784a', { toon: true }), { p: [0, 2.3, -9] });
  // clock on the wall
  M.add(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 20), frame, { p: [12, 9, -14.3], r: [Math.PI / 2, 0, 0] });
  const room = M.build('aronaClassroom');
  // chalkboard
  if (typeof document !== 'undefined') {
    const cb = new THREE.Mesh(new THREE.PlaneGeometry(20, 7), ctx.mat('#ffffff', { map: chalkboardTexture(THREE) }));
    cb.position.set(0, 6, -14.35);
    room.add(cb);
    // shallow water with the sky reflection
    const water = new THREE.Mesh(new THREE.CircleGeometry(R * 0.97, 40), new THREE.MeshBasicMaterial({ map: reflectionTexture(THREE), transparent: true, opacity: 0.85, depthWrite: false }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.45;
    water.renderOrder = 1;
    room.add(water);
  }
  // student desks (instanced into the room group via a sub-scene: few enough to use props + merge)
  const desks = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      if ((r === 2 && c === 3) || (r === 1 && c === 0)) continue;
      desks.push({ x: -9 + c * 6, y: 0.2, z: -3 + r * 5.5, rotY: (Math.sin(r * 3 + c) * 0.25), scale: 2.2 });
    }
  const P = ctx.pointAt(D('islandA', 20), -72);
  room.position.set(P.x, P.y - 6, P.z);
  const f = ctx.frameAt(D('islandA', 20));
  room.rotation.y = f.yaw - Math.PI / 2; // chalkboard wall at the back, open side faces the road (on its right)
  ctx.group.add(room);
  ctx.reserve(P.x, P.z, R + 4);
  const cos = Math.cos(room.rotation.y);
  const sin = Math.sin(room.rotation.y);
  const world = desks.map((d) => ({ x: room.position.x + d.x * cos + d.z * sin, y: room.position.y + d.y, z: room.position.z - d.x * sin + d.z * cos, rotY: room.rotation.y + d.rotY, scale: d.scale }));
  ctx.instanced('desk', world, { color: '#e3b273', color2: '#8aa0b8' });
  // ripples
  const ring = ctx.mat('#ffffff', { opacity: 0.5, depthWrite: false, basic: true });
  const ripples = [];
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 32), ring);
    m.rotation.x = -Math.PI / 2;
    m.position.set(-6 + k * 7, 0.5, 4 - k * 3);
    m.userData.ph = k / 3;
    room.add(m);
    ripples.push(m);
  }
  ctx.addAnimated((dt, time) => {
    for (const m of ripples) {
      const u = (time * 0.35 + m.userData.ph) % 1;
      m.scale.setScalar(1 + u * 7);
      m.material.opacity = 0.5 * (1 - u);
    }
  });
}

/** The giant Shittim Chest tablet standing in the middle of the helix. */
function buildGiantTablet(ctx) {
  const { THREE } = ctx;
  const d0 = D('helix');
  const f = ctx.frameAt(d0);
  // helix centre: right of the entry point (right-hand spiral), radius 44
  const cx = f.pos.x + f.rightH.x * 44;
  const cz = f.pos.z + f.rightH.z * 44;
  const baseY = ctx.pointAt(D('helix', 330), 0).y - 22;
  const g = new THREE.Group();
  g.position.set(cx, baseY, cz);
  const M = makeMerger(ctx);
  const body = ctx.mat('#f4f7fb', { toon: true });
  const bezel = ctx.mat('#2b3140', { toon: true });
  M.add(new THREE.BoxGeometry(26, 38, 2.4), body, { p: [0, 19, 0] });
  M.add(new THREE.BoxGeometry(24, 36, 2.6), bezel, { p: [0, 19, 0] });
  M.add(new THREE.CylinderGeometry(0.6, 0.6, 0.4, 12), ctx.mat('#9aa6b8', { toon: true }), { p: [0, 36.6, 1.35], r: [Math.PI / 2, 0, 0] });
  // plinth island
  islandMesh(ctx, M, 0, 0, 0, 16, 26, 7);
  const tab = M.build('shittimTablet');
  // screens on both faces
  if (typeof document !== 'undefined') {
    const tex1 = tabletScreenTexture(THREE, 'SHITTIM CHEST', 'Hang in there, Sensei!');
    const tex2 = tabletScreenTexture(THREE, 'A.R.O.N.A', 'Final lap? Go go go!');
    for (const [tex, s] of [[tex1, 1], [tex2, -1]]) {
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(22.4, 33.6), ctx.mat('#ffffff', { map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.85 }));
      scr.position.set(0, 19, s * 1.33);
      if (s < 0) scr.rotation.y = Math.PI;
      tab.add(scr);
    }
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(40, 52), ctx.mat(ARONA, { additive: true, opacity: 0.18, depthWrite: false, basic: true, side: 2 }));
  glow.position.y = 19;
  tab.add(glow);
  g.add(tab);
  ctx.group.add(g);
  ctx.reserve(cx, cz, 20);
  ctx.addAnimated((dt, time) => {
    tab.rotation.y = time * 0.12;
    tab.position.y = Math.sin(time * 0.6) * 0.8;
  });
}

/** Two floating islands under the jump + the glass bridge across the gap. */
function buildJumpIslands(ctx) {
  const { THREE } = ctx;
  const M = makeMerger(ctx);
  const mk = (mark, off, r, seed) => {
    const d = D(mark, off);
    const P = ctx.pointAt(d, 0);
    islandMesh(ctx, M, P.x, P.y - 0.6, P.z, r, 22, seed);
    ctx.reserve(P.x, P.z, r);
  };
  mk('islandA', 16, 22, 11);
  mk('islandB', 22, 22, 12);
  const g = M.build('jumpIslands');
  ctx.group.add(g);
  const sign = ctx.props.create('billboard', { text: 'JUMP, SENSEI!', variant: 0 });
  ctx.place(sign, { d: D('islandA', 5), lateral: -20, yaw: 0.5, reserve: false });
  // arch of halos over the gap
  const halo = ctx.mat(ARONA, { emissive: ARONA, emissiveIntensity: 1.2, toon: true });
  const hm = makeMerger(ctx);
  for (let k = 0; k < 3; k++) {
    hm.add(new THREE.TorusGeometry(14 - k * 0.1, 0.5, 8, 48), halo, { p: [0, 0, k * 11], shadow: false });
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2;
      hm.add(new THREE.BoxGeometry(0.5, 1.6, 0.5), halo, { p: [Math.cos(a) * 14, Math.sin(a) * 14, k * 11], r: [0, 0, a + Math.PI / 2], shadow: false });
    }
  }
  const arch = hm.build('haloArch');
  ctx.place(arch, { d: D('gap', 2), lateral: 0, y: 2 });
}

/** Floating books, giant open books, tablets and pastel crystals drifting around the course. */
function buildFloaters(ctx) {
  const { THREE } = ctx;
  const rng = ctx.rng;
  const B = ctx.path.bounds;
  const cx = (B.min.x + B.max.x) / 2;
  const cz = (B.min.z + B.max.z) / 2;
  // drifting group 1: book stacks + open books (instanced)
  const books = [];
  const open = [];
  const tabs = [];
  for (let k = 0; k < 70; k++) {
    const a = rng() * Math.PI * 2;
    const r = 60 + rng() * 320;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (!ctx.isClear(x, z, 10)) continue;
    const y = 8 + rng() * 60;
    const item = { x, y, z, rotY: rng() * 6.28, rotX: (rng() - 0.5) * 0.6, rotZ: (rng() - 0.5) * 0.6, scale: 2.5 + rng() * 3.5 };
    if (k % 3 === 0) open.push(item);
    else if (k % 3 === 1) books.push(item);
    else tabs.push({ ...item, scale: 1 + rng() * 1.2 });
  }
  const bob = new THREE.Group();
  ctx.group.add(bob);
  const g1 = books.length ? ctx.instanced('book', books, { castShadow: false }) : null;
  const g2 = open.length ? ctx.instanced('book', open, { variant: 'open', color: '#ff7ab8', castShadow: false }) : null;
  // small tablets with blue screens
  const tabObj = new THREE.Group();
  {
    const body = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 0.4), ctx.mat('#f4f7fb', { toon: true }));
    const scr = new THREE.Mesh(new THREE.BoxGeometry(3.4, 5.2, 0.45), ctx.mat(ARONA, { emissive: ARONA, emissiveIntensity: 0.9, toon: true }));
    tabObj.add(body, scr);
  }
  const g3 = tabs.length ? ctx.instanced(tabObj, tabs, { castShadow: false }) : null;
  for (const g of [g1, g2, g3]) if (g) bob.add(g);
  ctx.addAnimated((dt, time) => {
    bob.position.y = Math.sin(time * 0.5) * 1.5;
  });
}

/** Big floating halos in the sky (one group, slowly turning). */
function buildSkyHalos(ctx) {
  const { THREE } = ctx;
  const B = ctx.path.bounds;
  const cx = (B.min.x + B.max.x) / 2;
  const cz = (B.min.z + B.max.z) / 2;
  const cols = [ARONA, PINK, '#ffe07a', '#b89cff', '#8affd8'];
  const grp = new THREE.Group();
  grp.position.set(cx, 0, cz);
  const M = makeMerger(ctx);
  const rng = ctx.rng;
  for (let k = 0; k < 12; k++) {
    const col = cols[k % cols.length];
    const m = ctx.mat(col, { emissive: col, emissiveIntensity: 1.1, basic: true });
    const a = (k / 12) * Math.PI * 2 + rng() * 0.3;
    const r = 260 + rng() * 140;
    const R = 10 + rng() * 16;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = 70 + rng() * 90;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.1 + rng() * 0.5, a, 0));
    const tor = new THREE.TorusGeometry(R, R * 0.06, 6, 48);
    M.add(tor, m, { p: [x, y, z], q, shadow: false });
    // halo spikes (BA style)
    for (let s = 0; s < 6; s++) {
      const b = (s / 6) * Math.PI * 2;
      const off = new THREE.Vector3(Math.cos(b) * R * 1.12, Math.sin(b) * R * 1.12, 0).applyQuaternion(q);
      const qs = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), b + Math.PI / 2));
      M.add(new THREE.BoxGeometry(R * 0.06, R * 0.24, R * 0.06), m, { p: [x + off.x, y + off.y, z + off.z], q: qs, shadow: false });
    }
  }
  grp.add(M.build('skyHalos'));
  ctx.group.add(grp);
  ctx.addAnimated((dt) => {
    grp.rotation.y += dt * 0.01;
  });
}

/** Start area: floating "welcome" hologram banner, Arona-blue pylons, cloud puffs. */
function buildStartDecor(ctx) {
  const { THREE } = ctx;
  const tex = ctx.textTexture("ARONA'S SKY CLASSROOM", { width: 1024, height: 128, color: '#ffffff', stroke: ARONA_D, size: 76 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 5), ctx.mat('#ffffff', { map: tex, alphaTest: 0.3, basic: true, side: 2 }));
  const holder = new THREE.Group();
  m.position.y = 16;
  holder.add(m);
  ctx.place(holder, { d: D('straight', 118), lateral: 0, yaw: Math.PI, reserve: false });
  ctx.addAnimated((dt, time) => {
    m.position.y = 16 + Math.sin(time * 1.2) * 0.4;
  });
  // cheering sign hologram beside the grid
  const h1 = ctx.props.create('hologram', { variant: 0 });
  ctx.place(h1, { d: D('home', 30), lateral: -17, yaw: Math.PI / 2 - 0.3, reserve: false });
  const h2 = ctx.props.create('hologram', { variant: 1 });
  ctx.place(h2, { d: D('home', 30), lateral: 17, yaw: -Math.PI / 2 + 0.3, reserve: false });
}

function scenery(ctx) {
  const parts = [buildClassroom, buildGiantTablet, buildJumpIslands, buildFloaters, buildSkyHalos, buildStartDecor];
  for (const p of parts) {
    try {
      p(ctx);
    } catch (e) {
      console.warn('[arona-sky] scenery part failed', p.name, e);
    }
  }
}

export default {
  id: 'arona-sky',
  name: "Arona's Sky Classroom",
  laps: 3,
  width: 22,
  offroad: 2,
  wall: false,
  points: C.points,
  features: [
    // start straight
    { type: 'itemRow', t: T('straight', 80), count: 5, spacing: 4.5 },
    { type: 'coins', t: T('t1', 55), count: 5, spacing: 4.5, lateral: 8 },
    // crest -> swoop: dash panel down the drop
    { type: 'boost', t: T('swoop', 15), lateral: 0, length: 8, width: 5 },
    { type: 'coins', t: T('swoop', 45), count: 4, spacing: 4, lateral: -7 },
    // helix: Credits on the risky inside edge
    { type: 'coins', t: T('helix', 120), count: 6, spacing: 4.5, lateral: 8.5 },
    { type: 'itemRow', t: T('helix', 250), count: 4, spacing: 4.5 },
    { type: 'coins', t: T('helix', 300), count: 6, spacing: 4.5, lateral: -8 },
    // under-pass + long tunnel run beneath the start straight
    { type: 'boost', t: T('tunnel', 60), lateral: -5, length: 8, width: 5 },
    { type: 'boost', t: T('tunnel', 125), lateral: 5, length: 8, width: 5 },
    { type: 'itemRow', t: T('tunnel', 160), count: 4, spacing: 4.5 },
    // S-bends: edge Credits
    { type: 'coins', t: T('s2', 20), count: 5, spacing: 4, lateral: 6.5 },
    // classroom islands jump
    { type: 'boost', t: T('islandA', 22), lateral: 0, length: 8, width: 6 },
    { type: 'ramp', t: T('islandA', 38), lateral: 0, length: 10, width: 16, power: 1.35 },
    { type: 'coins', t: T('gap', 16), count: 3, spacing: 4, lateral: 0 },
    // final section
    { type: 'itemRow', t: T('t5', 50), count: 4, spacing: 4.5 },
    { type: 'coins', t: T('final', 40), count: 5, spacing: 4.5, lateral: -8 },
  ],
  decorations: [
    { kind: 'cloud', count: 60, side: 'both', minOffset: 8, maxOffset: 140, scale: [1.2, 3.2], seed: 41, y: [-30, 10], color: '#ffffff', color2: '#ffe6f6' },
    { kind: 'cloud', count: 20, side: 'both', minOffset: 20, maxOffset: 200, scale: [2.5, 4.5], seed: 42, y: [20, 60], color: '#ffffff', color2: '#e6f2ff' },
    { kind: 'crystal', count: 26, side: 'both', minOffset: 6, maxOffset: 60, scale: [1.2, 2.6], seed: 43, y: [-18, 6], color: '#9fe4ff', color2: '#ff9ee6' },
    { kind: 'desk', count: 18, side: 'both', minOffset: 6, maxOffset: 50, scale: [1.8, 3], seed: 44, y: [-12, 8], face: 'random', color: '#e3b273', color2: '#8aa0b8' },
    { kind: 'book', count: 24, side: 'both', minOffset: 4, maxOffset: 40, scale: [1.5, 3], seed: 45, y: [-8, 12], face: 'random' },
    { kind: 'pillar', count: 10, side: 'both', minOffset: 8, maxOffset: 40, scale: [1.4, 2.2], seed: 46, y: [-14, -4], color: '#f6f0ff', color2: ARONA, tRange: [T('tunnel'), T('t4')] },
  ],
  theme: {
    preset: 'sky',
    sky: { top: '#3440b8', bottom: '#ffb6e6', horizon: '#ffd6f0', stars: true, sunDisc: true, clouds: false },
    fog: { color: '#f4d6f2', near: 320, far: 1500 },
    sun: { color: '#fff6f0', intensity: 2.3, dir: [0.35, 0.9, 0.3] },
    ambient: { sky: '#e8f2ff', ground: '#e8c8ff', intensity: 1.25 },
    ground: { type: 'cloud', color: '#f4f0ff', color2: '#d8c8f8' },
    road: { style: 'rainbow', color: '#ffffff', color2: '#ffffff', lines: false },
    edge: { style: 'glow', colorA: ARONA, colorB: PINK },
    offroad: { type: 'none', color: '#dfe8ff' },
    wall: { style: 'glow', color: '#ffffff', color2: ARONA },
    void: { type: 'sky', color: '#dcd6ff' },
    grip: 1.0,
    particles: 'sparkles',
    music: 'arona',
    night: false,
  },
  scenery,
};
