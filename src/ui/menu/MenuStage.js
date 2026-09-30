// 3D backdrop for the title screen and menus (owner: frontend agent).
// A bright Blue-Archive-style sky, a floating halo emblem, a turntable showing a racer (title / character
// select) and a podium for the trophy ceremony. Rendered by Game whenever no race is on screen.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getCharacter } from '../../data/characters.js';
import { damp, clamp, mulberry32 } from '../../core/utils.js';
import { easeOutBack } from './kit.js';

const FRAMINGS = {
  title: { pos: [6.7, 1.55, 8.3], target: [0.1, 1.0, 0], fov: 30, fx: 0.72, fy: 0.54, spin: 0.32 },
  hero: { pos: [4.9, 2.0, 7.9], target: [0, 1.0, 0], fov: 30, fx: 0.71, fy: 0.5, spin: 0.3 },
  character: { pos: [4.3, 1.95, 7.1], target: [0, 1.02, 0], fov: 30, fx: 0.74, fy: 0.5, spin: 0.55 },
  backdrop: { pos: [0.5, 2.4, 14.5], target: [0, 4.0, -8], fov: 44, fx: 0.5, fy: 0.5, spin: 0.15 },
  podium: { pos: [0, 3.3, 15.2], target: [0, 1.75, 0], fov: 31, fx: 0.5, fy: 0.6, spin: 0 },
};
// narrow / portrait screens: keep the racer in the upper part of the screen
const NARROW = {
  title: { fx: 0.5, fy: 0.66 },
  hero: { fx: 0.5, fy: 0.3 },
  character: { fx: 0.5, fy: 0.27 },
  backdrop: { fx: 0.5, fy: 0.5 },
  podium: { fx: 0.5, fy: 0.42 },
};

const PODIUM = [
  { place: 1, x: 0, h: 1.35, color: '#ffd23f', rim: '#fff3a6', yaw: 0 },
  { place: 2, x: -3.05, h: 0.95, color: '#cfd9e8', rim: '#ffffff', yaw: 0.28 },
  { place: 3, x: 3.05, h: 0.62, color: '#e39a5f', rim: '#ffd6b0', yaw: -0.28 },
];

function makeCanvasTexture(size, draw, { repeat = false } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function fallbackRacer(character) {
  const root = new THREE.Group();
  const kart = new THREE.Group();
  const driver = new THREE.Group();
  root.add(kart, driver);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.2), new THREE.MeshToonMaterial({ color: character.kart?.body || '#e33' }));
  body.position.y = 0.45;
  kart.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14), new THREE.MeshToonMaterial({ color: character.look?.hair || '#333' }));
  head.position.set(0, 1.35, -0.2);
  driver.add(head);
  return {
    root,
    kart,
    driver,
    anchors: {},
    update() {},
    dispose() {
      root.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    },
  };
}

export class MenuStage {
  constructor(game) {
    this.game = game;
    this.quality = game?.settings?.quality || 'high';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 420);
    this.time = 0;
    this.mode = 'title';
    this.visible = true;
    this.models = new Map(); // characterId -> racer model
    this.states = new Map(); // characterId -> RacerVisualState object (reused)
    this.focusId = null;
    this.podiumIds = [];
    this.celebrateTime = 0;
    this.popT = 1;
    this.spinBoost = 0;
    this._size = new THREE.Vector2();
    this._camPos = new THREE.Vector3(...FRAMINGS.title.pos);
    this._camTarget = new THREE.Vector3(...FRAMINGS.title.target);
    this._fx = FRAMINGS.title.fx;
    this._fy = FRAMINGS.title.fy;
    this._fov = FRAMINGS.title.fov;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._haloColor = new THREE.Color('#ff3355');
    this._haloTarget = new THREE.Color('#ff3355');
    this._errors = 0;

    this._factory = import('../../entities/RacerModel.js')
      .then((m) => m.createRacerModel)
      .catch((err) => {
        console.warn('[menus] RacerModel unavailable, using placeholders:', err?.message || err);
        return null;
      });

    this._buildEnvironment();
    this._buildTurntable();
    this._buildHalo();
    this._buildPodium();
    this.setMode('title', { characterId: 'serika', instant: true });
  }

  // ----------------------------------------------------------------------------------------------
  // construction
  // ----------------------------------------------------------------------------------------------

  _buildEnvironment() {
    const scene = this.scene;
    const horizon = new THREE.Color('#d6eeff');
    scene.fog = new THREE.Fog(horizon, 34, 120);
    scene.background = horizon.clone();

    // gradient sky dome with a soft sun and faint diagonal light bands
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        uTop: { value: new THREE.Color('#1f86ff') },
        uMid: { value: new THREE.Color('#9fd6ff') },
        uHorizon: { value: horizon.clone() },
        uBottom: { value: new THREE.Color('#eef8ff') },
        uSun: { value: new THREE.Vector3(0.55, 0.42, -0.72).normalize() },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSun; uniform float uTime;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
          col = mix(col, uTop, smoothstep(0.18, 0.85, h));
          col = mix(col, uBottom, smoothstep(0.0, -0.2, h));
          float s = max(dot(d, uSun), 0.0);
          col += vec3(1.0, 0.96, 0.86) * (pow(s, 90.0) * 0.9 + pow(s, 8.0) * 0.22);
          float band = sin((d.x * 0.9 + d.y * 1.7) * 11.0 + uTime * 0.12);
          col += vec3(1.0) * smoothstep(0.82, 1.0, band) * 0.05 * smoothstep(0.05, 0.4, h);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.skyMat = skyMat;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 40, 20), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);

    // lights
    const hemi = new THREE.HemisphereLight('#ffffff', '#9cc9ff', 1.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff3df', 2.5);
    sun.position.set(6, 11, 8);
    sun.target.position.set(0, 0.5, 0);
    sun.castShadow = true;
    const sm = this.quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(sm, sm);
    const sc = sun.shadow.camera;
    sc.left = -7.5;
    sc.right = 7.5;
    sc.top = 7.5;
    sc.bottom = -7.5;
    sc.near = 1;
    sc.far = 40;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.025;
    scene.add(sun, sun.target);
    this.sun = sun;
    const rim = new THREE.DirectionalLight('#a9dcff', 1.3);
    rim.position.set(-7, 5, -8);
    scene.add(rim);

    // floor: big soft disc with concentric rings (fades into the fog)
    const floorTex = makeCanvasTexture(1024, (g, S) => {
      const c = S / 2;
      const grd = g.createRadialGradient(c, c, 0, c, c, c);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.35, '#f1f8ff');
      grd.addColorStop(1, '#cfe8ff');
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(31,150,255,0.22)';
      for (let i = 1; i < 16; i++) {
        g.lineWidth = i % 4 === 0 ? 5 : 2;
        g.beginPath();
        g.arc(c, c, (i / 16) * c, 0, Math.PI * 2);
        g.stroke();
      }
      g.strokeStyle = 'rgba(31,150,255,0.12)';
      g.lineWidth = 3;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        g.beginPath();
        g.moveTo(c + Math.cos(a) * c * 0.2, c + Math.sin(a) * c * 0.2);
        g.lineTo(c + Math.cos(a) * c, c + Math.sin(a) * c);
        g.stroke();
      }
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(95, 96), new THREE.MeshLambertMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // clouds: one merged geometry, slowly rotating around the stage
    const rng = mulberry32(77);
    const puffs = [];
    for (let c = 0; c < 14; c++) {
      const ang = (c / 14) * Math.PI * 2 + rng() * 0.3;
      const r = 48 + rng() * 26;
      const cx = Math.cos(ang) * r;
      const cz = Math.sin(ang) * r;
      const cy = 5 + rng() * 16;
      const sc2 = 2.6 + rng() * 3.2;
      const n = 5 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const g = new THREE.IcosahedronGeometry(1, 2);
        const s = sc2 * (0.55 + rng() * 0.6);
        g.scale(s, s * 0.78, s);
        g.translate(cx + (i - n / 2) * sc2 * 0.62, cy + rng() * sc2 * 0.4, cz + (rng() - 0.5) * sc2);
        puffs.push(g);
      }
    }
    const cloudGeo = mergeGeometries(puffs);
    puffs.forEach((g) => g.dispose());
    const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#d5ebff', emissiveIntensity: 0.55 });
    this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
    scene.add(this.clouds);

    // floating crystals / triangles (instanced)
    const count = 42;
    const shapes = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.34, 0), new THREE.MeshToonMaterial({ color: '#ffffff' }), count);
    shapes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const palette = ['#ffffff', '#8fd3ff', '#ffb3cf', '#ffe38a', '#b9f0ff', '#c8b8ff'];
    this.shapeData = [];
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = 7 + rng() * 16;
      this.shapeData.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r - 4,
        y: 0.8 + rng() * 9,
        s: 0.5 + rng() * 1.1,
        ph: rng() * 10,
        sp: 0.4 + rng() * 0.8,
      });
      shapes.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    }
    this.shapes = shapes;
    this._dummy = new THREE.Object3D();
    scene.add(shapes);
  }

  _buildTurntable() {
    const tt = new THREE.Group();
    const topTex = makeCanvasTexture(512, (g, S) => {
      const c = S / 2;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, S, S);
      const grd = g.createRadialGradient(c, c, c * 0.2, c, c, c);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(1, '#e3f3ff');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(c, c, c, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1fa8ff';
      g.lineWidth = 14;
      g.beginPath();
      g.arc(c, c, c - 18, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 4;
      g.setLineDash([22, 14]);
      g.beginPath();
      g.arc(c, c, c - 46, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = 'rgba(255,51,85,0.85)';
      g.lineWidth = 8;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.beginPath();
        g.moveTo(c + Math.cos(a) * (c - 70), c + Math.sin(a) * (c - 70));
        g.lineTo(c + Math.cos(a) * (c - 30), c + Math.sin(a) * (c - 30));
        g.stroke();
      }
    });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.08, 72), [
      new THREE.MeshToonMaterial({ color: '#dff1ff' }),
      new THREE.MeshLambertMaterial({ map: topTex }),
      new THREE.MeshToonMaterial({ color: '#dff1ff' }),
    ]);
    top.position.y = 0.3;
    top.receiveShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.35, 0.28, 72), new THREE.MeshToonMaterial({ color: '#1f8fff' }));
    base.position.y = 0.14;
    base.receiveShadow = true;
    const glowRing = new THREE.Mesh(
      new THREE.TorusGeometry(3.22, 0.05, 8, 96),
      new THREE.MeshBasicMaterial({ color: '#bff2ff', toneMapped: false })
    );
    glowRing.rotation.x = Math.PI / 2;
    glowRing.position.y = 0.3;
    tt.add(base, top, glowRing);
    this.turntableTop = top;
    this.slot = new THREE.Group();
    this.slot.position.y = 0.34;
    tt.add(this.slot);
    this.turntable = tt;
    this.scene.add(tt);
  }

  _buildHalo() {
    // big stylised halo emblem that floats behind the racer (billboarded towards the camera)
    const g = new THREE.Group();
    const parts = [];
    parts.push(new THREE.TorusGeometry(4.3, 0.2, 10, 120));
    const inner = 22;
    for (let i = 0; i < inner; i++) {
      const a = (i / inner) * Math.PI * 2;
      const b = new THREE.BoxGeometry(0.62, 0.11, 0.05);
      b.rotateZ(a + Math.PI / 2);
      b.translate(Math.cos(a) * 3.25, Math.sin(a) * 3.25, 0);
      parts.push(b);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const t = new THREE.BoxGeometry(1.5, 0.22, 0.06);
      t.rotateZ(a);
      t.translate(Math.cos(a) * 4.8, Math.sin(a) * 4.8, 0);
      parts.push(t);
      const arrow = new THREE.ConeGeometry(0.42, 0.9, 3);
      arrow.rotateZ(a + Math.PI / 4 - Math.PI / 2);
      const aa = a + Math.PI / 4;
      arrow.translate(Math.cos(aa) * 4.95, Math.sin(aa) * 4.95, 0);
      parts.push(arrow);
    }
    const geo = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    parts.forEach((p) => p.dispose());
    this.haloMat = new THREE.MeshBasicMaterial({ color: '#ff3355', transparent: true, opacity: 0.85, toneMapped: false, fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(geo, this.haloMat);
    const spin = new THREE.Group();
    spin.add(mesh);
    const glowTex = makeCanvasTexture(256, (ctx, S) => {
      const c = S / 2;
      const grd = ctx.createRadialGradient(c, c, 0, c, c, c);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, S, S);
    });
    this.haloGlowMat = new THREE.SpriteMaterial({ map: glowTex, color: '#ff7a8f', transparent: true, opacity: 0.55, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Sprite(this.haloGlowMat);
    glow.scale.set(15, 15, 1);
    g.add(glow, spin);
    g.renderOrder = -5;
    this.halo = g;
    this.haloSpin = spin;
    this.scene.add(g);
  }

  _buildPodium() {
    const grp = new THREE.Group();
    this.podiumSlots = [];
    for (const p of PODIUM) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.45, p.h, 48), new THREE.MeshToonMaterial({ color: p.color }));
      col.position.set(p.x, p.h / 2, 0);
      col.castShadow = true;
      col.receiveShadow = true;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.07, 8, 64), new THREE.MeshBasicMaterial({ color: p.rim, toneMapped: false }));
      rim.rotation.x = Math.PI / 2;
      rim.position.set(p.x, p.h, 0);
      const numTex = makeCanvasTexture(128, (g, S) => {
        g.clearRect(0, 0, S, S);
        g.font = `bold ${S * 0.78}px "Lilita One", "Arial Black", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = S * 0.12;
        g.strokeStyle = '#16213a';
        g.lineJoin = 'round';
        g.strokeText(String(p.place), S / 2, S * 0.54);
        g.fillStyle = '#ffffff';
        g.fillText(String(p.place), S / 2, S * 0.54);
      });
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: numTex, transparent: true, toneMapped: false }));
      num.position.set(p.x, Math.max(0.36, p.h * 0.5), 1.47);
      const slot = new THREE.Group();
      slot.position.set(p.x, p.h, 0);
      slot.rotation.y = p.yaw;
      grp.add(col, rim, num, slot);
      this.podiumSlots.push(slot);
    }
    grp.visible = false;
    this.podium = grp;
    this.scene.add(grp);
  }

  // ----------------------------------------------------------------------------------------------
  // models
  // ----------------------------------------------------------------------------------------------

  async _getModel(id) {
    if (this.models.has(id)) return this.models.get(id);
    const factory = await this._factory;
    if (this.models.has(id)) return this.models.get(id);
    const ch = getCharacter(id);
    let model = null;
    try {
      model = factory ? factory(ch, { quality: this.quality }) : null;
    } catch (err) {
      console.warn(`[menus] createRacerModel(${id}) failed:`, err?.message || err);
    }
    if (!model?.root) model = fallbackRacer(ch);
    model.root.traverse((o) => {
      if (o.isMesh && !o.material?.transparent) o.castShadow = true;
    });
    this.models.set(id, model);
    this.states.set(id, {
      speed: 0,
      steer: 0,
      throttle: 0,
      drifting: false,
      driftDir: 0,
      driftLevel: 0,
      boosting: false,
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
      time: 0,
    });
    return model;
  }

  /** Create models ahead of time (spread over frames). */
  async preload(ids) {
    for (const id of ids) {
      await this._getModel(id);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  _detachAll() {
    for (const m of this.models.values()) m.root.parent?.remove(m.root);
  }

  async showCharacter(id, { pop = true } = {}) {
    if (!id) return;
    this.focusId = id;
    const ch = getCharacter(id);
    this._haloTarget.set(ch.look?.halo?.color || '#ff3355');
    const model = await this._getModel(id);
    if (this.focusId !== id || this.mode === 'podium') return;
    if (model.root.parent !== this.slot) {
      for (const c of [...this.slot.children]) this.slot.remove(c);
      model.root.position.set(0, 0, 0);
      model.root.rotation.set(0, 0, 0);
      this.slot.add(model.root);
      if (pop) {
        this.popT = 0;
        this.spinBoost = Math.max(this.spinBoost, 5);
      }
    }
  }

  celebrate(duration = 1.8) {
    this.celebrateTime = duration;
    this.spinBoost = 7;
    this.popT = 0.25;
  }

  /**
   * @param {'title'|'hero'|'character'|'backdrop'|'podium'} mode
   * @param {{ characterId?: string, podium?: string[], instant?: boolean }} [opts]
   */
  setMode(mode, opts = {}) {
    this.mode = FRAMINGS[mode] ? mode : 'hero';
    const podium = this.mode === 'podium';
    this.turntable.visible = !podium && this.mode !== 'backdrop';
    this.podium.visible = podium;
    this.slot.visible = this.mode !== 'backdrop';
    if (podium) {
      this._detachAll();
      this.podiumIds = (opts.podium || []).slice(0, 3);
      this._haloTarget.set('#ffd23f');
      this.podiumIds.forEach(async (id, i) => {
        const m = await this._getModel(id);
        if (this.mode !== 'podium' || this.podiumIds[i] !== id) return;
        m.root.position.set(0, 0, 0);
        m.root.rotation.set(0, 0, 0);
        this.podiumSlots[i].add(m.root);
      });
    } else if (opts.characterId) {
      if (this.podiumIds.length) {
        this._detachAll();
        this.podiumIds = [];
      }
      this.showCharacter(opts.characterId, { pop: !opts.instant });
    } else if (this.mode === 'backdrop') {
      this._haloTarget.set('#3fb8ff');
    }
    if (opts.instant) this.snap();
  }

  snap() {
    const f = this._framing();
    this._camPos.set(...f.pos);
    this._camTarget.set(...f.target);
    this._fx = f.fx;
    this._fy = f.fy;
    this._fov = f.fov;
    this._haloColor.copy(this._haloTarget);
  }

  _framing() {
    const base = FRAMINGS[this.mode] || FRAMINGS.hero;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w / Math.max(1, h) < 1.15) return { ...base, ...NARROW[this.mode] };
    return base;
  }

  setQuality(q) {
    this.quality = q;
    const sm = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== sm) {
      this.sun.shadow.mapSize.set(sm, sm);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  // ----------------------------------------------------------------------------------------------
  // per frame
  // ----------------------------------------------------------------------------------------------

  update(dt) {
    this.time += dt;
    const t = this.time;
    const f = this._framing();
    const rate = 3.2;
    this._tmp.set(...f.pos);
    this._camPos.x = damp(this._camPos.x, this._tmp.x, rate, dt);
    this._camPos.y = damp(this._camPos.y, this._tmp.y, rate, dt);
    this._camPos.z = damp(this._camPos.z, this._tmp.z, rate, dt);
    this._tmp.set(...f.target);
    this._camTarget.x = damp(this._camTarget.x, this._tmp.x, rate, dt);
    this._camTarget.y = damp(this._camTarget.y, this._tmp.y, rate, dt);
    this._camTarget.z = damp(this._camTarget.z, this._tmp.z, rate, dt);
    this._fx = damp(this._fx, f.fx, rate, dt);
    this._fy = damp(this._fy, f.fy, rate, dt);
    this._fov = damp(this._fov, f.fov, rate, dt);

    // gentle handheld drift
    const cam = this.camera;
    cam.position.copy(this._camPos);
    cam.position.x += Math.sin(t * 0.21) * 0.18;
    cam.position.y += Math.sin(t * 0.33) * 0.08;
    cam.lookAt(this._camTarget);
    if (Math.abs(cam.fov - this._fov) > 1e-3) cam.fov = this._fov;

    // turntable
    this.spinBoost = damp(this.spinBoost, 0, 2.2, dt);
    this.turntable.rotation.y += dt * (f.spin + this.spinBoost);
    this.popT = Math.min(1, this.popT + dt / 0.5);
    const pop = 0.35 + 0.65 * easeOutBack(this.popT);
    this.slot.scale.setScalar(pop);
    this.slot.position.y = 0.34 + Math.sin(Math.min(1, this.popT) * Math.PI) * 0.35;
    this.celebrateTime = Math.max(0, this.celebrateTime - dt);

    // halo: behind the focus point, facing the camera
    this._haloColor.lerp(this._haloTarget, 1 - Math.exp(-4 * dt));
    this.haloMat.color.copy(this._haloColor);
    this.haloGlowMat.color.copy(this._haloColor);
    const dir = this._tmp2.copy(this._camTarget).sub(cam.position).normalize();
    const podium = this.mode === 'podium';
    const back = podium ? 12 : this.mode === 'backdrop' ? 6 : 9;
    this.halo.position.copy(this._camTarget).addScaledVector(dir, back);
    this.halo.position.y += podium ? 3.0 : this.mode === 'backdrop' ? 1.5 : 1.25;
    this.halo.lookAt(cam.position);
    this.haloSpin.rotation.z = t * 0.12;
    const hs = 1 + Math.sin(t * 1.3) * 0.025;
    this._haloScale = damp(this._haloScale ?? 0.6, podium ? 1.1 : this.mode === 'backdrop' ? 1.15 : 0.6, 3, dt);
    this.halo.scale.setScalar(hs * this._haloScale);

    // environment motion
    this.skyMat.uniforms.uTime.value = t;
    this.clouds.rotation.y = t * 0.006;
    const d = this._dummy;
    for (let i = 0; i < this.shapeData.length; i++) {
      const s = this.shapeData[i];
      d.position.set(s.x, s.y + Math.sin(t * s.sp + s.ph) * 0.45, s.z);
      d.rotation.set(t * s.sp * 0.6 + s.ph, t * s.sp + s.ph, 0);
      d.scale.setScalar(s.s);
      d.updateMatrix();
      this.shapes.setMatrixAt(i, d.matrix);
    }
    this.shapes.instanceMatrix.needsUpdate = true;

    // racers
    const celebrating = this.celebrateTime > 0;
    for (const [id, m] of this.models) {
      if (!m.root.parent) continue;
      const st = this.states.get(id);
      st.time = t;
      const podiumIdx = this.podiumIds.indexOf(id);
      if (podiumIdx >= 0) {
        st.celebrate = podiumIdx === 0 || Math.sin(t * 0.9 + podiumIdx) > -0.2;
        st.steer = Math.sin(t * 1.4 + podiumIdx) * 0.25;
      } else {
        st.celebrate = celebrating;
        st.steer = Math.sin(t * 0.9) * 0.35;
      }
      st.throttle = 0;
      try {
        m.update(dt, st);
      } catch (err) {
        if (this._errors++ < 3) console.warn('[menus] racer update failed:', err?.message || err);
      }
    }
  }

  render(renderer) {
    renderer.getSize(this._size);
    const w = Math.max(1, this._size.x);
    const h = Math.max(1, this._size.y);
    const cam = this.camera;
    cam.aspect = w / h;
    // shift the projection so the camera target lands at (fx, fy) of the screen (fractions from top-left)
    cam.setViewOffset(w, h, w * (0.5 - this._fx), h * (0.5 - this._fy), w, h);
    renderer.render(this.scene, cam);
  }

  dispose() {
    for (const m of this.models.values()) {
      try {
        m.dispose?.();
      } catch {
        /* ignore */
      }
    }
    this.models.clear();
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mat of mats) {
        mat.map?.dispose?.();
        mat.dispose?.();
      }
    });
  }
}
