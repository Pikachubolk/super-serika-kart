// Sky, fog, lights and ambient weather for a track theme (owner: world agent).
//
//   const env = new Environment(theme, { quality, center: Vector3, radius })   // theme from resolveTheme()
//   env.apply(scene)                 adds sky dome, cloud ring, weather points, hemisphere + sun, sets fog
//   env.sun                          THREE.DirectionalLight (castShadow, 2048 map, tight frustum)
//   env.setShadowFocus(position)     keep the sun's shadow frustum around the player (texel snapped)
//   env.update(dt, time, camera)     sky follows the camera, clouds drift, weather animates
//   env.dispose()
//
// Also usable on its own (menus / title scenes): `new Environment(resolveTheme({ preset: 'desert' }))`.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/utils.js';
import { createSkyMaterial, createWeatherMaterial } from './shaders.js';
import { cloudTexture, particleTexture, mixHex, shade, luma } from './textures.js';

const WEATHER = {
  dust: { tex: 'dot', size: 0.32, vel: [2.2, 0.15, 1.1], sway: 0.6, opacity: 0.4, count: 700, cols: ['#f3e0b5', '#d9bd86'] },
  petals: { tex: 'petal', size: 0.42, vel: [0.9, -1.3, 0.5], sway: 1.4, opacity: 0.95, count: 900, cols: ['#ffc2dc', '#ffe6f0'], spin: 1.6 },
  snow: { tex: 'flake', size: 0.3, vel: [0.35, -2.4, 0.2], sway: 0.8, opacity: 0.9, count: 1500, cols: ['#ffffff', '#e4f1ff'] },
  embers: { tex: 'dot', size: 0.26, vel: [0.3, 1.8, 0.2], sway: 0.9, opacity: 0.95, count: 700, cols: ['#ff7a1f', '#ffd23f'], additive: true },
  sparkles: { tex: 'star', size: 0.45, vel: [0.1, 0.25, 0.1], sway: 0.5, opacity: 0.9, count: 600, cols: ['#ffffff', '#8fe3ff'], additive: true, twinkle: true },
  leaves: { tex: 'leaf', size: 0.5, vel: [1.4, -1.1, 0.6], sway: 1.8, opacity: 0.95, count: 500, cols: ['#8fce4a', '#f2a93b'], spin: 1.3 },
};

export class Environment {
  constructor(theme, { quality = 'high', center = new THREE.Vector3(), radius = 300 } = {}) {
    this.theme = theme;
    this.quality = quality;
    this.center = center.clone();
    this.radius = radius;
    this.objects = [];
    this.disposables = [];
    const t = theme;

    // --- fog
    this.fog = new THREE.Fog(t.fog.color, t.fog.near, t.fog.far);
    this.background = new THREE.Color(t.fog.color);

    // --- lights
    this.hemi = new THREE.HemisphereLight(t.ambient.sky, t.ambient.ground, t.ambient.intensity);
    this.hemi.name = 'ssk-hemi';
    this.sunDir = new THREE.Vector3(...t.sun.dir).normalize();
    const sun = new THREE.DirectionalLight(t.sun.color, t.sun.intensity);
    sun.name = 'ssk-sun';
    sun.castShadow = quality !== 'low';
    const half = quality === 'high' ? 58 : 48;
    this.shadowHalf = half;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 520 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2;
    sun.position.copy(this.center).addScaledVector(this.sunDir, 220);
    sun.target.position.copy(this.center);
    this.sun = sun;
    this._camFwd = new THREE.Vector3(0, 0, 1);
    this._focus = new THREE.Vector3().copy(this.center);
    this._basisX = new THREE.Vector3();
    this._basisY = new THREE.Vector3();
    {
      const z = this.sunDir;
      const up = Math.abs(z.y) > 0.98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      this._basisX.crossVectors(up, z).normalize();
      this._basisY.crossVectors(z, this._basisX).normalize();
    }

    // --- sky dome
    const night = t.night;
    const skyMat = createSkyMaterial({
      top: t.sky.top,
      bottom: t.sky.bottom,
      horizon: t.sky.horizon,
      fog: t.fog.color,
      sunDir: this.sunDir,
      sunColor: night ? '#dfe8ff' : t.sun.color,
      sunDisc: t.sky.sunDisc && !night,
      moon: night && t.sky.sunDisc !== false ? true : night && !!t.sky.stars,
      stars: !!t.sky.stars,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1700, 48, 24), skyMat);
    this.sky.name = 'ssk-sky';
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.disposables.push(this.sky.geometry, skyMat);
    this.objects.push(this.sky);

    // --- cloud ring (billboards facing the track centre, merged into one mesh; the ring slowly turns)
    if (t.sky.clouds) {
      const rng = mulberry32(4711);
      const count = quality === 'low' ? 10 : quality === 'medium' ? 16 : 24;
      const geos = [];
      const R0 = Math.min(1250, radius + 650);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng() * 0.2;
        const r = R0 * (0.85 + rng() * 0.3);
        const w = 180 + rng() * 220;
        const h = w * 0.5;
        const g = new THREE.PlaneGeometry(w, h);
        // pick one of 3 cloud textures via uv offset: we use a single texture; vary by flipping u
        if (rng() < 0.5) {
          const uv = g.attributes.uv;
          for (let k = 0; k < uv.count; k++) uv.setX(k, 1 - uv.getX(k));
        }
        g.rotateY(-a - Math.PI / 2);
        g.translate(Math.cos(a) * r, 110 + rng() * 170 + h * 0.2, Math.sin(a) * r);
        geos.push(g);
      }
      const cg = mergeGeometries(geos);
      const cloudTint = night ? shade(mixHex(t.sky.top, '#ffffff', 0.25), 0) : mixHex('#ffffff', t.sky.horizon, 0.25);
      const cm = new THREE.MeshBasicMaterial({
        map: cloudTexture(0),
        color: cloudTint,
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
        opacity: night ? 0.35 : 0.95,
      });
      this.clouds = new THREE.Mesh(cg, cm);
      this.clouds.name = 'ssk-clouds';
      this.clouds.position.copy(this.center);
      this.clouds.position.y = this.center.y;
      this.clouds.renderOrder = -900;
      this.clouds.frustumCulled = false;
      this.disposables.push(cg, cm);
      this.objects.push(this.clouds);
    }

    // --- weather
    const wt = t.particles && WEATHER[t.particles];
    if (wt) {
      const mult = quality === 'low' ? 0.35 : quality === 'medium' ? 0.65 : 1;
      const n = Math.round(wt.count * mult);
      const rng = mulberry32(99);
      const pos = new Float32Array(n * 3);
      const rnd = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = rng();
        pos[i * 3 + 1] = rng();
        pos[i * 3 + 2] = rng();
        rnd[i] = rng();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
      let cols = wt.cols;
      if (t.particles === 'sparkles') cols = ['#ffffff', t.edge?.colorA || '#8fe3ff'];
      if (t.particles === 'dust') cols = [mixHex(t.ground.color, '#ffffff', 0.35), t.ground.color];
      const mat = createWeatherMaterial({
        box: new THREE.Vector3(80, 34, 80),
        vel: new THREE.Vector3(...wt.vel),
        sway: wt.sway,
        size: wt.size,
        map: particleTexture(wt.tex),
        colA: cols[0],
        colB: cols[1],
        opacity: wt.opacity * (night && !wt.additive ? 0.7 : 1),
        additive: !!wt.additive,
        twinkle: !!wt.twinkle,
        spin: wt.spin ?? 1,
      });
      this.weather = new THREE.Points(g, mat);
      this.weather.name = 'ssk-weather';
      this.weather.frustumCulled = false;
      this.weather.renderOrder = 10;
      this.disposables.push(g, mat);
      this.objects.push(this.weather);
    }
    void luma;
  }

  apply(scene) {
    scene.fog = this.fog;
    scene.background = this.background;
    scene.add(this.hemi);
    scene.add(this.sun);
    scene.add(this.sun.target);
    for (const o of this.objects) scene.add(o);
    this.scene = scene;
  }

  /** Keep the shadow frustum centred slightly ahead of `position` (the player), snapped to shadow texels. */
  setShadowFocus(position) {
    const f = this._focus.copy(position).addScaledVector(this._camFwd, this.shadowHalf * 0.4);
    const texel = (this.shadowHalf * 2) / this.sun.shadow.mapSize.x;
    const fx = f.dot(this._basisX);
    const fy = f.dot(this._basisY);
    f.addScaledVector(this._basisX, Math.round(fx / texel) * texel - fx);
    f.addScaledVector(this._basisY, Math.round(fy / texel) * texel - fy);
    this.sun.position.copy(f).addScaledVector(this.sunDir, 240);
    this.sun.target.position.copy(f);
    this.sun.target.updateMatrixWorld();
  }

  update(dt, time, camera) {
    if (camera) {
      this.sky.position.copy(camera.position);
      camera.getWorldDirection(this._camFwd);
      this._camFwd.y = 0;
      if (this._camFwd.lengthSq() < 1e-6) this._camFwd.set(0, 0, 1);
      this._camFwd.normalize();
    }
    this.sky.material.uniforms.uTime.value = time;
    if (this.clouds) this.clouds.rotation.y = time * 0.004;
    if (this.weather && camera) {
      const u = this.weather.material.uniforms;
      u.uTime.value = time;
      u.uCam.value.copy(camera.position);
      const h = (typeof window !== 'undefined' ? window.innerHeight : 720) * Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      u.uScale.value = h / (2 * Math.tan(((camera.fov || 60) * Math.PI) / 360));
    }
  }

  dispose() {
    if (this.scene) {
      for (const o of [this.hemi, this.sun, this.sun.target, ...this.objects]) this.scene.remove(o);
      if (this.scene.fog === this.fog) this.scene.fog = null;
    }
    this.sun.dispose?.();
    this.sun.shadow?.map?.dispose?.();
    for (const d of this.disposables) d.dispose?.();
  }
}
