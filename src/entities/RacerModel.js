// The complete visual of one racer: kart + seated chibi driver + effects (owner: characters agent).
// API CONTRACT (see ARCHITECTURE.md §6 Racer model):
//   createRacerModel(character, { quality='high' }={}) -> RacerModel
//   RacerModel = {
//     root: THREE.Group        // faces +Z, origin = ground contact centre of the kart, ~2.2 long / 1.5 wide
//     kart: THREE.Group, driver: THREE.Group,
//     anchors: { exhaustL, exhaustR, wheelFL, wheelFR, wheelRL, wheelRR, head, rear, front } // Object3Ds (use getWorldPosition)
//     update(dt, state)        // RacerVisualState, see ARCHITECTURE.md
//     dispose()
//   }
// Extras: character, characterModel, kartModel, setExpression(name, holdSeconds), setPose('drive'|'portrait'),
//         stats() -> { drawCalls, triangles }
//
// Draw calls per racer: kart (1) + kart outline (1) + driver (1) + driver outline (1) + halo (1) + halo glow (1)
// + effect quads (1, only while sparks/boost/invincible) + boost flames (1, only while boosting).

import * as THREE from 'three';
import { createCharacterModel } from './CharacterModel.js';
import { createKartModel } from './KartModel.js';
import { clamp, damp } from '../core/utils.js';

const TAU = Math.PI * 2;

const DRIFT_COLORS = [null, new THREE.Color('#3ec5ff'), new THREE.Color('#ffa826'), new THREE.Color('#d45bff')];
const DRIFT_COLORS_B = [null, new THREE.Color('#1f6bff'), new THREE.Color('#ff5a1a'), new THREE.Color('#7b2bff')];
const FLAME_A = new THREE.Color('#ffb640');
const FLAME_B = new THREE.Color('#ff4a1c');
const WHITE = new THREE.Color('#ffffff');
const GOLD = new THREE.Color('#ffd23f');

// =========================================================================================================
// Effect quads: camera-facing glows / sparkles in one draw call (positions in kart space)
// =========================================================================================================

let _fxMaterial = null;
function getFxMaterial() {
  if (_fxMaterial) return _fxMaterial;
  _fxMaterial = new THREE.ShaderMaterial({
    name: 'ssk-racer-fx',
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute vec4 aColor;
      attribute vec3 aParam; // size, kind, rotation
      varying vec2 vUv;
      varying vec4 vColor;
      varying float vKind;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        float sc = length( modelMatrix[0].xyz );
        float c = cos( aParam.z ), s = sin( aParam.z );
        vec2 off = vec2( c * aCorner.x - s * aCorner.y, s * aCorner.x + c * aCorner.y );
        mv.xy += off * aParam.x * sc;
        gl_Position = projectionMatrix * mv;
        vUv = aCorner;
        vColor = aColor;
        vKind = aParam.y;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec4 vColor;
      varying float vKind;
      void main() {
        float r = length( vUv );
        float core = smoothstep( 0.42, 0.0, r );
        float a;
        if ( vKind < 0.5 ) {
          a = pow( max( 0.0, 1.0 - r ), 2.2 ) * 0.9 + core * 0.6;
        } else if ( vKind < 1.5 ) {
          vec2 p = abs( vUv );
          float star = max( 0.0, 1.0 - ( p.x * p.y ) * 34.0 - r * 0.85 );
          a = pow( star, 2.0 ) + core * 0.5;
        } else {
          a = smoothstep( 0.2, 0.0, abs( r - 0.72 ) ) * 0.9 + pow( max( 0.0, 1.0 - r ), 3.0 ) * 0.4;
        }
        a *= vColor.a;
        if ( a < 0.004 ) discard;
        vec3 col = mix( vColor.rgb, vec3( 1.0 ), core * 0.65 );
        gl_FragColor = vec4( col, a );
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  return _fxMaterial;
}

class FxQuads {
  constructor(max) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 12);
    this.col = new Float32Array(max * 16);
    this.par = new Float32Array(max * 12);
    const corner = new Float32Array(max * 8);
    const idx = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) {
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.parAttr = new THREE.BufferAttribute(this.par, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aColor', this.colAttr);
    g.setAttribute('aParam', this.parAttr);
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 3);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, getFxMaterial());
    this.mesh.name = 'racerFx';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    this.count = 0;
  }
  begin() {
    this.count = 0;
  }
  push(x, y, z, color, alpha, size, kind = 0, rot = 0) {
    if (this.count >= this.max || alpha <= 0.002 || size <= 0) return;
    const i = this.count++;
    for (let v = 0; v < 4; v++) {
      const k = (i * 4 + v) * 3;
      this.pos[k] = x;
      this.pos[k + 1] = y;
      this.pos[k + 2] = z;
      const c = (i * 4 + v) * 4;
      this.col[c] = color.r;
      this.col[c + 1] = color.g;
      this.col[c + 2] = color.b;
      this.col[c + 3] = alpha;
      this.par[k] = size;
      this.par[k + 1] = kind;
      this.par[k + 2] = rot;
    }
  }
  end() {
    this.geometry.setDrawRange(0, this.count * 6);
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.posAttr.addUpdateRange(0, this.count * 12);
      this.colAttr.addUpdateRange(0, this.count * 16);
      this.parAttr.addUpdateRange(0, this.count * 12);
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
      this.parAttr.needsUpdate = true;
    }
  }
  dispose() {
    this.geometry.dispose();
  }
}

// =========================================================================================================
// Boost flames: two flickering additive cones per exhaust (outer + hot inner core)
// =========================================================================================================

function createFlames(exhausts, tilt) {
  const cone = new THREE.ConeGeometry(1, 1, 10, 4, true);
  cone.rotateX(-Math.PI / 2); // apex -> -Z
  cone.translate(0, 0, -0.5); // base at z = 0, apex at z = -1
  const cp = cone.attributes.position;
  const n = cp.count;
  const layers = exhausts.length * 2;
  const pos = new Float32Array(n * layers * 3);
  const origin = new Float32Array(n * layers * 3);
  const info = new Float32Array(n * layers * 2);
  const idx = [];
  const ci = cone.index.array;
  let L = 0;
  exhausts.forEach((e, side) => {
    for (let layer = 0; layer < 2; layer++, L++) {
      for (let i = 0; i < n; i++) {
        const k = (L * n + i) * 3;
        pos[k] = cp.getX(i);
        pos[k + 1] = cp.getY(i);
        pos[k + 2] = cp.getZ(i);
        origin[k] = e.x;
        origin[k + 1] = e.y;
        origin[k + 2] = e.z;
        info[(L * n + i) * 2] = side;
        info[(L * n + i) * 2 + 1] = layer;
      }
      for (let i = 0; i < ci.length; i++) idx.push(ci[i] + L * n);
    }
  });
  cone.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aOrigin', new THREE.BufferAttribute(origin, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, -1.2), 2.5);
  const mat = new THREE.ShaderMaterial({
    name: 'ssk-boost-flame',
    uniforms: {
      uTime: { value: 0 },
      uLen: { value: 0.9 },
      uWidth: { value: 0.1 },
      uTilt: { value: tilt },
      uAlpha: { value: 1 },
      uColA: { value: FLAME_A.clone() },
      uColB: { value: FLAME_B.clone() },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOrigin;
      attribute vec2 aInfo;
      uniform float uTime, uLen, uWidth, uTilt;
      varying float vT;
      varying float vLayer;
      varying float vSide;
      void main() {
        float side = aInfo.x;
        float layer = aInfo.y;
        float t = clamp( -position.z, 0.0, 1.0 );
        float fl = 1.0 + 0.22 * sin( uTime * 38.0 + side * 2.1 ) + 0.13 * sin( uTime * 71.0 + side * 5.3 + layer );
        float len = uLen * fl * ( layer > 0.5 ? 0.58 : 1.0 );
        float wid = uWidth * ( layer > 0.5 ? 0.6 : 1.0 ) * ( 1.0 + 0.12 * sin( uTime * 55.0 + side * 3.0 ) );
        vec3 p = vec3( position.xy * wid * ( 1.0 + t * 0.35 ), position.z * len );
        p.x += sin( uTime * 23.0 + t * 6.0 + side ) * 0.02 * t;
        float c = cos( uTilt ), s = sin( uTilt );
        p = vec3( p.x, p.y * c - p.z * s, p.y * s + p.z * c );
        vT = t;
        vLayer = layer;
        vSide = side;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( aOrigin + p, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAlpha;
      uniform vec3 uColA, uColB;
      varying float vT;
      varying float vLayer;
      varying float vSide;
      void main() {
        float t = vT;
        vec3 core = vec3( 1.0, 0.97, 0.88 );
        vec3 c = mix( core, uColA, smoothstep( 0.02, 0.42, t + ( vLayer > 0.5 ? -0.18 : 0.0 ) ) );
        c = mix( c, uColB, smoothstep( 0.45, 0.95, t ) );
        float a = ( 1.0 - smoothstep( 0.5, 1.0, t ) ) * ( vLayer > 0.5 ? 1.0 : 0.62 );
        a *= 0.78 + 0.22 * sin( uTime * 60.0 + t * 22.0 + vSide * 4.0 );
        gl_FragColor = vec4( c, a * uAlpha );
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'boostFlames';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  return { mesh, material: mat, geometry: g };
}

// =========================================================================================================
// Racer model
// =========================================================================================================

const _hl = new THREE.Vector3();
const _hr = new THREE.Vector3();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

export function createRacerModel(character, { quality = 'high' } = {}) {
  const look = character.look || {};
  const root = new THREE.Group();
  root.name = `racer:${character.id}`;

  const kartModel = createKartModel(character, { quality });
  const kart = kartModel.group;
  root.add(kart);
  const L = kartModel.layout;

  const cm = createCharacterModel(character, { quality });
  cm.warmFaces();
  const driver = cm.group;
  const seatMount = new THREE.Object3D();
  seatMount.name = 'seatMount';
  seatMount.position.copy(L.seat).sub(L.bodyPivot);
  kartModel.bodyBone.add(seatMount);
  const driverScale = clamp(look.height || 1, 0.85, 1.12);
  driver.scale.setScalar(driverScale);
  seatMount.add(driver);

  // anchors
  const anchor = (name, parent, pos) => {
    const o = new THREE.Object3D();
    o.name = `anchor:${name}`;
    if (pos) o.position.copy(pos);
    parent.add(o);
    return o;
  };
  const bodyLocal = (v) => v.clone().sub(L.bodyPivot);
  const anchors = {
    exhaustL: anchor('exhaustL', kartModel.bodyBone, bodyLocal(L.exhausts[0])),
    exhaustR: anchor('exhaustR', kartModel.bodyBone, bodyLocal(L.exhausts[1] || L.exhausts[0])),
    wheelFL: kartModel.wheelAnchors.FL,
    wheelFR: kartModel.wheelAnchors.FR,
    wheelRL: kartModel.wheelAnchors.RL,
    wheelRR: kartModel.wheelAnchors.RR,
    head: cm.headAnchor,
    rear: anchor('rear', kartModel.bodyBone, bodyLocal(L.rear)),
    front: anchor('front', kartModel.bodyBone, bodyLocal(L.front)),
  };

  // effects
  const fx = new FxQuads(24);
  kart.add(fx.mesh);
  const flames = createFlames(L.exhausts.map(bodyLocal), L.exhaustTilt);
  kartModel.bodyBone.add(flames.mesh);

  // state
  let time = 0;
  let lastSpeed = 0;
  let accelS = 0;
  let wasAir = false;
  let airTime = 0;
  let wasHurt = false;
  let flash = 0;
  let boostVis = 0;
  let boostLevel = 0;
  let lastDriftLevel = 0;
  let driftFade = 0;
  let driftVisLevel = 0;
  let invVis = 0;
  const motion = { speedN: 0, accel: 0, landing: 0 };
  const rearL = L.wheels.RL;
  const rearR = L.wheels.RR;
  const flameColA = new THREE.Color();
  const flameColB = new THREE.Color();

  function updateFx(dt, st) {
    fx.begin();
    const t = time;
    // --- drift sparks at the rear wheels
    const level = st.drifting ? st.driftLevel || 0 : 0;
    if (level > 0) {
      driftVisLevel = level;
      driftFade = Math.min(1, driftFade + dt * 10);
    } else driftFade = Math.max(0, driftFade - dt * 7);
    if (driftFade > 0 && driftVisLevel > 0) {
      const ca = DRIFT_COLORS[driftVisLevel];
      const cb = DRIFT_COLORS_B[driftVisLevel];
      const big = 0.3 + driftVisLevel * 0.09;
      for (const [w, s] of [
        [rearL, 1],
        [rearR, -1],
      ]) {
        const x = w.pos.x + s * 0.03;
        const y = 0.1;
        const z = w.pos.z - w.r * 0.75;
        const flick = 0.78 + 0.22 * Math.sin(t * 47 + s * 3) + 0.12 * Math.sin(t * 91 + s);
        fx.push(x, y + 0.04, z, cb, 0.55 * driftFade, big * 1.8 * flick, 0);
        fx.push(x, y, z, ca, 0.95 * driftFade, big * flick, 0);
        fx.push(x, y + 0.02, z - 0.05, WHITE, 0.7 * driftFade, big * 0.9 * flick, 1, t * 7 + s);
        for (let i = 0; i < 4; i++) {
          const u = (t * (2.6 + i * 0.35) + i * 0.27 + (s > 0 ? 0 : 0.5)) % 1;
          const ang = i * 1.9 + s;
          const dx = Math.cos(ang) * 0.35 * u * s;
          const dy = 0.05 + Math.abs(Math.sin(ang * 1.7)) * 0.45 * u;
          const dz = -0.25 - 0.55 * u;
          fx.push(x + dx, y + dy, z + dz, i % 2 ? ca : WHITE, (1 - u) * driftFade, (0.16 + driftVisLevel * 0.03) * (1 - u * 0.5), 1, ang + t * 3);
        }
      }
      if (driftVisLevel === 3) {
        for (const w of [rearL, rearR]) fx.push(w.pos.x, 0.12, w.pos.z - w.r * 0.8, ca, 0.35 * driftFade, 0.9 + Math.sin(t * 20) * 0.1, 2, t);
      }
    }
    // --- exhaust glows while boosting
    if (boostVis > 0.01) {
      for (const e of L.exhausts) {
        const fl = 0.85 + 0.15 * Math.sin(t * 53 + e.x * 9);
        fx.push(e.x, e.y + 0.02, e.z - 0.12, flameColA, 0.85 * boostVis, 0.42 * fl * (0.7 + boostVis * 0.3), 0);
        fx.push(e.x, e.y + 0.02, e.z - 0.05, WHITE, 0.6 * boostVis, 0.16 * fl, 0);
      }
    }
    // --- invincibility sparkles orbiting the racer
    if (invVis > 0.01) {
      for (let i = 0; i < 6; i++) {
        const a = t * 2.4 + (i * TAU) / 6;
        const r = 1.05 + 0.1 * Math.sin(t * 3 + i);
        const y = 0.5 + ((i * 0.37 + t * 0.6) % 1) * 1.1;
        _c1.setHSL((t * 0.5 + i / 6) % 1, 1, 0.62);
        const tw = 0.6 + 0.4 * Math.sin(t * 13 + i * 2.1);
        fx.push(Math.cos(a) * r, y, Math.sin(a) * r * 1.2, _c1, invVis * tw, 0.2 + 0.08 * tw, 1, a);
      }
    }
    fx.end();
  }

  function update(dt, st = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    time += dt;
    const speed = st.speed || 0;
    const speedN = clamp(Math.abs(speed) / 36, 0, 1.5);
    // derived motion
    if (dt > 0) {
      const a = (speed - lastSpeed) / dt / 30;
      accelS = damp(accelS, clamp(a, -1.5, 1.5), 6, dt);
    }
    lastSpeed = speed;
    const air = !!st.airborne;
    if (air) airTime += dt;
    let landing = 0;
    if (wasAir && !air && airTime > 0.15) landing = clamp(airTime * 0.9, 0.3, 1.2);
    if (!air) airTime = 0;
    wasAir = air;
    motion.speedN = speedN;
    motion.accel = accelS;
    motion.landing = landing;

    // kart
    kartModel.update(dt, st, motion);
    // hands follow the steering wheel (kart space -> driver space)
    kartModel.getHandTargets(_hl, _hr);
    _hl.sub(L.seat).divideScalar(driverScale);
    _hr.sub(L.seat).divideScalar(driverScale);
    cm.setHandTargets(_hl, _hr);
    cm.update(dt, st, motion);

    // boost flames (mini-turbo colour when the boost follows a drift release)
    const drifting = !!st.drifting;
    if (drifting) lastDriftLevel = st.driftLevel || 0;
    const boosting = !!st.boosting;
    if (boosting && boostVis < 0.05) {
      boostLevel = lastDriftLevel;
      lastDriftLevel = 0;
    }
    if (!drifting && !boosting) lastDriftLevel = Math.max(0, lastDriftLevel - dt * 20);
    boostVis = dt > 0 ? damp(boostVis, boosting ? 1 : 0, boosting ? 16 : 9, dt) : boosting ? 1 : 0;
    if (boostVis > 0.01) {
      const lvl = Math.round(boostLevel);
      flameColA.copy(lvl > 0 ? DRIFT_COLORS[lvl] : FLAME_A);
      flameColB.copy(lvl > 0 ? DRIFT_COLORS_B[lvl] : FLAME_B);
      const strength = clamp(st.boostStrength ?? 1, 0.6, 1.6);
      flames.material.uniforms.uTime.value = time;
      flames.material.uniforms.uLen.value = (0.55 + 0.45 * strength) * (0.4 + 0.6 * boostVis) * 1.05;
      flames.material.uniforms.uWidth.value = 0.085 + 0.02 * strength;
      flames.material.uniforms.uAlpha.value = boostVis;
      flames.material.uniforms.uColA.value.copy(flameColA);
      flames.material.uniforms.uColB.value.copy(flameColB);
      flames.mesh.visible = true;
    } else flames.mesh.visible = false;

    // invincibility: rainbow tint + golden halo pulse; hit: quick flash
    const inv = !!st.invincible;
    invVis = dt > 0 ? damp(invVis, inv ? 1 : 0, 8, dt) : inv ? 1 : 0;
    const hurtNow = !!(st.spinning || st.tumbling);
    if (hurtNow && !wasHurt) flash = 1;
    wasHurt = hurtNow;
    flash = Math.max(0, flash - dt * 4);
    if (invVis > 0.01) {
      _c1.setHSL((time * 0.9) % 1, 0.95, 0.6);
      const amt = invVis * (0.22 + 0.1 * Math.sin(time * 14));
      kartModel.setTint(_c1, amt);
      cm.setTint(_c1, amt * 0.7);
      _c2.copy(GOLD).lerp(_c1, 0.5 + 0.5 * Math.sin(time * 9));
      cm.haloMaterial.color.copy(_c2);
      cm.haloGlowMaterial.color.copy(_c2);
      cm.haloGlowMaterial.opacity = 0.9;
      const pulse = 1 + invVis * (0.18 + 0.12 * Math.sin(time * 12));
      cm.halo.scale.setScalar(pulse);
      cm.haloGlow.scale.setScalar(1.25 + 0.35 * Math.sin(time * 12) * invVis);
    } else {
      const f = flash;
      kartModel.setTint(WHITE, f * 0.55);
      cm.setTint(WHITE, f * 0.5);
      cm.haloMaterial.color.copy(cm.haloBaseColor);
      cm.haloGlowMaterial.color.copy(cm.haloGlowColor);
      cm.haloGlowMaterial.opacity = 0.62 + 0.12 * Math.sin(time * 2.3) + boostVis * 0.2;
      cm.halo.scale.setScalar(1);
      cm.haloGlow.scale.setScalar(1 + boostVis * 0.15);
    }

    updateFx(dt, st);
  }

  function dispose() {
    kartModel.dispose();
    cm.dispose();
    fx.dispose();
    flames.geometry.dispose();
    flames.material.dispose();
    root.removeFromParent();
  }

  function stats() {
    let drawCalls = 0;
    let triangles = 0;
    root.traverseVisible((o) => {
      if (!o.isMesh) return;
      drawCalls++;
      const g = o.geometry;
      const count = g.drawRange.count !== Infinity ? g.drawRange.count : g.index ? g.index.count : g.attributes.position.count;
      triangles += Math.floor(Math.min(count, g.index ? g.index.count : g.attributes.position.count) / 3);
    });
    return { drawCalls, triangles };
  }

  update(0, {});

  return {
    root,
    kart,
    driver,
    anchors,
    update,
    dispose,
    stats,
    character,
    characterModel: cm,
    kartModel,
    setExpression: (name, hold = 1) => cm.setExpression(name, hold),
    setPose: (pose) => cm.setPose(pose),
  };
}
