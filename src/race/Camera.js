// ChaseCamera (owner: physics agent) — MK8-style chase camera, intro flyover and finish orbit.
//
// API CONTRACT (ARCHITECTURE.md §7 Camera):
//   new ChaseCamera(camera: THREE.PerspectiveCamera)
//   cam.setTarget(kart)
//   cam.snap()                                   jump to the ideal pose immediately
//   cam.playIntro(track, duration=4) -> Promise  pre-race cinematic flyover; resolves when done or skipIntro()
//   cam.skipIntro()
//   cam.setMode('chase'|'finish'|'orbit')        'finish' = slow orbit to the front of the target after the line
//   cam.shake(strength=1)                        hit / explosion feedback (trauma based, decays)
//   cam.update(dt, { lookBack=false }={})        call once per rendered frame AFTER kart.updateVisual()
//
// Additions: cam.introActive (bool), cam.enabled, cam.baseFov / cam.boostFov / cam.distance / cam.height.
// The camera reads the target's interpolated visual transform (kart.object3d / kart.visualYaw), follows the
// heading with extra lag while drifting or airborne, pulls back + widens the FOV while boosting, freezes and
// watches the kart fall into the void, and snaps when the target teleports. It never goes below the road
// surface and never ends up outside a walled corridor (so walls never block the view).
// Kart impacts (walls, landings, bumps, hits) are picked up automatically via kart.impactSeq/impactStrength.

import * as THREE from 'three';
import { clamp, clamp01, damp, dampAngle, lerp, smoothstep } from '../core/utils.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const easeInOut = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export class ChaseCamera {
  constructor(camera, opts = {}) {
    this.camera = camera;
    this.target = null;
    this.mode = 'chase';
    this.enabled = true;
    this.baseFov = opts.fov ?? 70;
    this.boostFov = opts.boostFov ?? 82;
    this.distance = opts.distance ?? 6.5;
    this.height = opts.height ?? 2.6;
    this.lookAhead = 3.4;
    this.lookHeight = 1.15;

    this._yaw = 0;
    this._focus = new THREE.Vector3();
    this._dist = this.distance;
    this._height = this.height;
    this._fov = this.baseFov;
    this._roll = 0;
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._lastTarget = new THREE.Vector3();
    this._has = false;
    this._trauma = 0;
    this._t = 0;
    this._impactSeq = -1;
    this._proj = {};
    this._falling = false;
    this._fallPos = new THREE.Vector3();
    this._lookBack = false;
    this._airLook = 0;

    // mode transitions
    this._blend = 1;
    this._blendDur = 0.9;
    this._fromPos = new THREE.Vector3();
    this._fromLook = new THREE.Vector3();
    this._fromFov = this.baseFov;

    // finish / orbit
    this._orbitT = 0;
    this._orbitStart = Math.PI;
    this._orbitAngle = 0;

    // intro
    this._intro = null;
  }

  get introActive() {
    return !!this._intro;
  }

  setTarget(kart) {
    const changed = kart !== this.target;
    this.target = kart;
    if (changed && kart) {
      this._impactSeq = kart.impactSeq ?? 0;
      if (!this._has) this.snap();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------------------------

  _targetPos(out) {
    const k = this.target;
    return out.copy(k.object3d && k.object3d.parent ? k.object3d.position : k.position);
  }

  _targetYaw() {
    const k = this.target;
    return typeof k.visualYaw === 'number' ? k.visualYaw : k.yaw;
  }

  /** Ideal chase pose from the current smoothed state → (pos, look). */
  _chasePose(pos, look) {
    const f = this._focus;
    const sx = Math.sin(this._yaw);
    const sz = Math.cos(this._yaw);
    pos.set(f.x - sx * this._dist, f.y + this._height, f.z - sz * this._dist);
    look.set(f.x + sx * this.lookAhead, f.y + this.lookHeight - this._airLook, f.z + sz * this.lookAhead);
  }

  /** Keep a camera position above the road plane and inside walled corridors. */
  _clamp(pos, hint) {
    const path = this.target?.path || this._intro?.path;
    if (!path) return;
    const p = path.project(pos, hint ?? this._proj.index ?? null, this._proj);
    if (p.edgeDist > -25) {
      const minY = p.groundY + 0.65;
      if (pos.y < minY) pos.y = minY;
    }
    // inside the corridor where there is a wall on that side
    const f = p.frame;
    const wall = p.side > 0 ? f.wallR : f.wallL;
    const lim = p.limit - 0.45;
    const absLat = Math.abs(p.lateral);
    if (wall && absLat > lim && absLat < lim + 12) {
      const push = absLat - lim;
      pos.x -= p.side * f.rightH.x * push;
      pos.z -= p.side * f.rightH.z * push;
    }
  }

  _startBlend(dur = 0.9) {
    this._fromPos.copy(this.camera.position);
    this._fromLook.copy(this._look);
    this._fromFov = this.camera.fov;
    this._blend = 0;
    this._blendDur = dur;
  }

  _apply(pos, look, fov, roll = 0, shake = true) {
    const cam = this.camera;
    let px = pos.x;
    let py = pos.y;
    let pz = pos.z;
    let lx = look.x;
    let ly = look.y;
    let lz = look.z;
    if (this._blend < 1) {
      const w = easeInOut(this._blend);
      px = lerp(this._fromPos.x, px, w);
      py = lerp(this._fromPos.y, py, w);
      pz = lerp(this._fromPos.z, pz, w);
      lx = lerp(this._fromLook.x, lx, w);
      ly = lerp(this._fromLook.y, ly, w);
      lz = lerp(this._fromLook.z, lz, w);
      fov = lerp(this._fromFov, fov, w);
    }
    // trauma shake
    let rollS = 0;
    if (shake && this._trauma > 0) {
      const s = this._trauma * this._trauma;
      const t = this._t;
      px += s * 0.5 * (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7) * 0.4);
      py += s * 0.4 * (Math.sin(t * 43.3 + 1.3) * 0.6 + Math.sin(t * 71.9) * 0.4);
      pz += s * 0.5 * (Math.sin(t * 39.7 + 2.1) * 0.6 + Math.sin(t * 57.3) * 0.4);
      rollS = s * 0.06 * Math.sin(t * 33.3 + 0.7);
    }
    cam.position.set(px, py, pz);
    // roll by tilting the camera's up vector around the view direction
    const r = roll + rollS;
    if (Math.abs(r) > 1e-4) {
      _v3.set(lx - px, 0, lz - pz);
      const len = Math.hypot(_v3.x, _v3.z) || 1;
      // camera right (horizontal) = forward × up
      cam.up.set((-_v3.z / len) * Math.sin(r), Math.cos(r), (_v3.x / len) * Math.sin(r));
    } else cam.up.copy(UP);
    cam.lookAt(lx, ly, lz);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this._look.set(lx, ly, lz);
  }

  // ---------------------------------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------------------------------

  snap() {
    const k = this.target;
    if (!k) return;
    this._targetPos(this._focus);
    this._yaw = this._targetYaw();
    this._dist = this.distance;
    this._height = this.height;
    this._fov = this.baseFov;
    this._airLook = 0;
    this._roll = 0;
    this._falling = false;
    this._blend = 1;
    this._lastTarget.copy(this._focus);
    this._has = true;
    if (this.mode === 'chase' || !this.mode) {
      this._chasePose(this._pos, _v2);
      this._clamp(this._pos, k.proj?.index);
      this._apply(this._pos, _v2, this._fov, 0, false);
    } else {
      this._updateMode(0, false);
    }
  }

  setMode(mode) {
    if (mode !== 'chase' && mode !== 'finish' && mode !== 'orbit') mode = 'chase';
    if (mode === this.mode) return;
    this._startBlend(mode === 'chase' ? 0.6 : 1.1);
    this.mode = mode;
    this._orbitT = 0;
    if (this.target) {
      const kp = this._targetPos(_v1);
      const rel = Math.atan2(this.camera.position.x - kp.x, this.camera.position.z - kp.z);
      this._orbitStart = rel - this._targetYaw();
      this._orbitAngle = rel;
      if (mode === 'chase') {
        this._yaw = this._targetYaw();
        this._targetPos(this._focus);
      }
    }
  }

  shake(strength = 1) {
    this._trauma = clamp(this._trauma + Math.max(0, strength) * 0.55, 0, 1);
  }

  // ---------------------------------------------------------------------------------------------
  // intro flyover
  // ---------------------------------------------------------------------------------------------

  playIntro(track, duration = 4) {
    if (this._intro) this._finishIntro();
    return new Promise((resolve) => {
      const path = track?.path || this.target?.path;
      if (!path) {
        resolve();
        return;
      }
      const dur = Math.max(1, duration);
      const intro = { path, duration: dur, t: 0, resolve, timer: 0, shots: [] };
      this._intro = intro;
      this._buildIntroShots(intro);
      intro.timer = setTimeout(() => this.skipIntro(), dur * 1000 + 3000);
      this._blend = 1;
      this._updateIntro(0);
    });
  }

  skipIntro() {
    if (!this._intro) return;
    this._finishIntro();
  }

  _finishIntro() {
    const intro = this._intro;
    if (!intro) return;
    this._intro = null;
    clearTimeout(intro.timer);
    this.mode = 'chase';
    this.snap();
    intro.resolve();
  }

  _buildIntroShots(intro) {
    const path = intro.path;
    const L = path.length;
    const shots = intro.shots;
    const tmp = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), rightH: new THREE.Vector3(), up: new THREE.Vector3() };

    // Shot 1: scenic sweep over the most interesting bend in the first half of the lap
    if (intro.duration >= 2.4) {
      let bestD = L * 0.25;
      let bestScore = -1;
      for (let d = L * 0.12; d < L * 0.55; d += 12) {
        let sc = 0;
        for (let x = 0; x < 60; x += 6) sc += Math.abs(path.sampleAt(d + x).curvature);
        const y = path.sampleAt(d).pos.y;
        sc += Math.max(0, y - path.bounds.min.y) * 0.002;
        if (sc > bestScore) {
          bestScore = sc;
          bestD = d;
        }
      }
      const curv = path.curvatureAhead(bestD + 20, 40, 5);
      const outside = curv > 0 ? -1 : 1; // camera on the outside of the bend
      const f0 = path.frameAt(bestD - 10, tmp);
      const half = f0.halfWidth + Math.max(f0.offL, f0.offR);
      const span = 70;
      shots.push({
        kind: 'dolly',
        weight: 0.45,
        d0: bestD - 10,
        d1: bestD - 10 + span,
        lat: outside * (half + 16),
        h0: 17,
        h1: 9,
        fov: 58,
      });
    }
    // Shot 2: start grid crane → behind the player
    shots.push({ kind: 'grid', weight: 0.55, fov0: 54 });
    let sum = 0;
    for (const s of shots) sum += s.weight;
    let acc = 0;
    for (const s of shots) {
      s.t0 = acc / sum;
      acc += s.weight;
      s.t1 = acc / sum;
    }
    intro.tmpFrame = tmp;
  }

  _updateIntro(dt) {
    const intro = this._intro;
    intro.t += dt;
    const u = clamp01(intro.t / intro.duration);
    const shot = intro.shots.find((s) => u >= s.t0 && u <= s.t1) || intro.shots[intro.shots.length - 1];
    const lu = clamp01((u - shot.t0) / Math.max(1e-4, shot.t1 - shot.t0));
    const path = intro.path;
    const f = intro.tmpFrame;
    const pos = this._pos;
    const look = _v2;
    let fov = this.baseFov;
    if (shot.kind === 'dolly') {
      const e = easeInOut(lu) * 0.85 + lu * 0.15;
      const d = lerp(shot.d0, shot.d1, e);
      path.frameAt(d, f);
      pos.copy(f.pos).addScaledVector(f.rightH, shot.lat);
      pos.y += lerp(shot.h0, shot.h1, e);
      path.frameAt(d + 34, f);
      look.copy(f.pos);
      look.y += 1.5;
      fov = shot.fov;
    } else {
      // grid crane
      const k = this.target;
      const fStart = path.frameAt(16, f);
      const side = 1;
      const pa = _v1.copy(fStart.pos).addScaledVector(fStart.rightH, -7 * side);
      pa.y += 9;
      const fGrid = path.frameAt(-16, f);
      const gridC = _v3.copy(fGrid.pos);
      gridC.y += 1;
      const pb = this._introPb || (this._introPb = new THREE.Vector3());
      pb.copy(fGrid.pos).addScaledVector(fGrid.rightH, (fGrid.halfWidth + 6) * side);
      pb.y += 4.5;
      // final pose = chase pose behind the target (or behind the grid)
      const pc = this._introPc || (this._introPc = new THREE.Vector3());
      const lc = this._introLc || (this._introLc = new THREE.Vector3());
      if (k) {
        this._targetPos(this._focus);
        this._yaw = this._targetYaw();
        this._dist = this.distance;
        this._height = this.height;
        this._airLook = 0;
        this._chasePose(pc, lc);
        this._clamp(pc, k.proj?.index);
      } else {
        pc.copy(fGrid.pos).addScaledVector(fGrid.tan, -12);
        pc.y += 3;
        lc.copy(gridC);
      }
      const t = easeInOut(lu);
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      pos.set(a * pa.x + b * pb.x + c * pc.x, a * pa.y + b * pb.y + c * pc.y, a * pa.z + b * pb.z + c * pc.z);
      const lw = smoothstep(0.35, 1, lu);
      look.lerpVectors(gridC, lc, lw);
      fov = lerp(shot.fov0, this.baseFov, smoothstep(0.3, 1, lu));
    }
    this._clamp(pos, null);
    this._fov = fov;
    this._apply(pos, look, fov, 0, false);
    if (u >= 1) this._finishIntro();
  }

  // ---------------------------------------------------------------------------------------------
  // per-frame update
  // ---------------------------------------------------------------------------------------------

  update(dt = 0, opts = {}) {
    if (!this.enabled) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this._t += dt;
    this._trauma = Math.max(0, this._trauma - dt * 1.5);
    if (this._blend < 1) this._blend = Math.min(1, this._blend + dt / this._blendDur);
    if (this._intro) {
      this._updateIntro(dt);
      return;
    }
    const k = this.target;
    if (!k) return;
    const kp = this._targetPos(_v1);
    if (!this._has || kp.distanceToSquared(this._lastTarget) > 28 * 28) {
      this._has = true;
      this.snap();
    }
    this._lastTarget.copy(kp);
    // impact feed from the kart (walls, landings, bumps, hits)
    if (typeof k.impactSeq === 'number' && k.impactSeq !== this._impactSeq) {
      this._impactSeq = k.impactSeq;
      this.shake(k.impactStrength ?? 0.3);
    }
    this._lookBack = !!(opts && opts.lookBack);
    this._updateMode(dt, true);
  }

  _updateMode(dt, shake) {
    if (this.mode === 'finish') this._updateFinish(dt, shake);
    else if (this.mode === 'orbit') this._updateOrbit(dt, shake);
    else this._updateChase(dt, shake);
  }

  _updateChase(dt, shake) {
    const k = this.target;
    const kp = this._targetPos(_v1);
    const top = Math.max(1, k.topSpeed || 36);
    const sr = clamp(Math.abs(k.speed || 0) / top, 0, 1.6);
    const drifting = !!k.drift?.active;
    const airborne = k.grounded === false && (k.airTime ?? 0) > 0.08;
    const falling = !!k.isFalling;
    const respawning = (k.respawnTime ?? 0) > 0;
    const stunned = (k.spinTime ?? 0) > 0 || (k.launchTime ?? 0) > 0;

    // --- drone rescue: settle behind the respawn point and watch the kart being carried in
    if (respawning && k.respawnTarget) {
      if (!this._wasRespawning) {
        this._wasRespawning = true;
        this._falling = false;
        this._startBlend(0.7);
      }
      const rt = k.respawnTarget;
      this._yaw = dampAngle(this._yaw, k.respawnYaw ?? this._yaw, 5, dt);
      this._focus.x = damp(this._focus.x, rt.x, 7, dt);
      this._focus.y = damp(this._focus.y, rt.y, 7, dt);
      this._focus.z = damp(this._focus.z, rt.z, 7, dt);
      this._dist = damp(this._dist, this.distance + 2.2, 3, dt);
      this._height = damp(this._height, this.height + 1.2, 3, dt);
      this._fov = damp(this._fov, this.baseFov, 3, dt);
      this._airLook = 0;
      const pos = this._pos;
      const look = _v2;
      this._chasePose(pos, look);
      // look at the carried kart (and a bit towards the road ahead)
      look.lerp(_v3.set(kp.x, kp.y + 1.2, kp.z), 0.7 * smoothstep(0, 0.4, k.respawnTime));
      this._clamp(pos, k.proj?.index);
      this._apply(pos, look, this._fov, 0, shake);
      return;
    }
    this._wasRespawning = false;

    // --- heading follow (extra lag while drifting / airborne / spinning)
    let rate = 8.5;
    if (drifting) rate = 4.6;
    if (airborne) rate = 3.2;
    if (stunned) rate = 1.6;
    if (respawning) rate = 2.4;
    this._yaw = dampAngle(this._yaw, this._targetYaw(), rate, dt);

    // --- focus point: tight horizontally, smoothed vertically (bumps, jumps)
    if (falling) {
      if (!this._falling) {
        this._falling = true;
        this._fallPos.copy(this.camera.position);
      }
    } else this._falling = false;
    this._focus.x = kp.x;
    this._focus.z = kp.z;
    const vRate = falling ? 0 : airborne ? 3.4 : respawning ? 5 : 11;
    this._focus.y = damp(this._focus.y, kp.y, vRate, dt);

    // --- distance / height: pull back at speed & when boosting (sense of speed)
    const boosting = (k.boostTime ?? 0) > 0;
    const distT = this.distance + 0.55 * smoothstep(0.3, 1, sr) + (boosting ? 1.25 * clamp(k.boostStrength || 1, 0.6, 1.2) : 0) + (drifting ? 0.35 : 0);
    this._dist = damp(this._dist, distT, boosting ? 3.2 : 2.2, dt);
    const heightT = this.height + (airborne ? 0.5 : 0) - (boosting ? 0.15 : 0);
    this._height = damp(this._height, heightT, 3, dt);
    this._airLook = damp(this._airLook, airborne ? 0.7 : 0, 3, dt);

    // --- FOV kick
    let fovT = this.baseFov + 3.5 * smoothstep(0.4, 1.05, sr);
    if (boosting) fovT += (this.boostFov - this.baseFov) * clamp(k.boostStrength || 1, 0.6, 1.2);
    if ((k.invincibleTime ?? 0) > 0) fovT += 3;
    this._fov = damp(this._fov, Math.min(fovT, this.boostFov + 6), fovT > this._fov ? 7 : 2.2, dt);

    // --- roll: lean a little with banked roads
    let rollT = 0;
    if (k.up && !airborne) {
      const rx = -Math.cos(this._yaw);
      const rz = Math.sin(this._yaw);
      rollT = (k.up.x * rx + k.up.z * rz) * 0.35;
    }
    this._roll = damp(this._roll, rollT, 4, dt);

    const pos = this._pos;
    const look = _v2;
    if (this._lookBack && !respawning) {
      const yawK = this._targetYaw();
      const fx = Math.sin(yawK);
      const fz = Math.cos(yawK);
      pos.set(kp.x + fx * 5.6, kp.y + 2.3, kp.z + fz * 5.6);
      look.set(kp.x - fx * 8, kp.y + 0.8, kp.z - fz * 8);
      this._clamp(pos, k.proj?.index);
      this._apply(pos, look, this.baseFov + 2, 0, shake);
      return;
    }
    if (falling) {
      // hold position at the edge and watch the kart drop
      pos.copy(this._fallPos);
      look.set(kp.x, kp.y + 0.6, kp.z);
      this._apply(pos, look, this._fov, 0, shake);
      return;
    }
    this._chasePose(pos, look);
    this._clamp(pos, k.proj?.index);
    this._apply(pos, look, this._fov, this._roll, shake);
  }

  _updateFinish(dt, shake) {
    const k = this.target;
    const kp = this._targetPos(_v1);
    this._orbitT += dt;
    const T1 = 3.0;
    const e = easeInOut(Math.min(1, this._orbitT / T1));
    // swing from wherever we were (usually behind) round to the front-left, then keep drifting slowly
    let start = this._orbitStart;
    const end = 0.55;
    // choose the shorter way round
    let delta = end - start;
    delta = ((delta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const rel = start + delta * e + Math.max(0, this._orbitT - T1) * 0.16;
    this._yaw = dampAngle(this._yaw, this._targetYaw(), 3, dt);
    const a = this._yaw + rel;
    const radius = lerp(7.2, 5.4, e);
    const h = lerp(2.8, 1.5, e);
    this._focus.x = kp.x;
    this._focus.z = kp.z;
    this._focus.y = damp(this._focus.y, kp.y, 6, dt);
    const pos = this._pos;
    pos.set(kp.x + Math.sin(a) * radius, this._focus.y + h, kp.z + Math.cos(a) * radius);
    const look = _v2.set(kp.x, this._focus.y + 1.0, kp.z);
    this._clamp(pos, k.proj?.index);
    this._fov = damp(this._fov, 62, 2, dt);
    this._apply(pos, look, this._fov, 0, shake);
  }

  _updateOrbit(dt, shake) {
    const k = this.target;
    const kp = this._targetPos(_v1);
    this._orbitAngle += dt * 0.3;
    this._focus.lerp(kp, 1 - Math.exp(-5 * dt));
    const pos = this._pos;
    pos.set(this._focus.x + Math.sin(this._orbitAngle) * 10, this._focus.y + 3.6, this._focus.z + Math.cos(this._orbitAngle) * 10);
    const look = _v2.set(this._focus.x, this._focus.y + 1.0, this._focus.z);
    this._clamp(pos, k.proj?.index);
    this._fov = damp(this._fov, 60, 2, dt);
    this._apply(pos, look, this._fov, 0, shake);
  }
}

export default ChaseCamera;
