// Live item entities: dropped hazards, projectiles, throwables, the leader seeker and visual-only props
// (owner: items agent). Driven by ItemSystem (fixed-step `update`, per-frame `visual`).
//
// Every entity keeps `pos`/`prev` (for render interpolation), `vel`, a TrackPath projection `proj` that is
// re-used with its own `.index` as a hint (cheap + correct on bridges / overpasses), and a pooled Object3D.

import * as THREE from 'three';
import { clamp, damp, wrapAngle } from '../../core/utils.js';

export const TUNING = {
  bulletSpeed: 58,
  bulletLife: 8,
  bulletHover: 0.5,
  missileSpeed: 64,
  missileLife: 10,
  missileHover: 0.85,
  missileTurn: 8,
  missileHomeRange: 26,
  grenadeGravity: 28,
  grenadeFuse: 1.2,
  seekerSpeed: 92,
  seekerHeight: 9,
  seekerBlast: 9,
  tossGravity: 26,
  orbitRadius: 2.15,
  orbitSpeed: 4.4,
  trailGap: 2.35,
  trailSpacing: 1.55,
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

let _uid = 1;

export class ItemEntity {
  /**
   * @param {import('../ItemSystem.js').ItemSystem} sys
   * @param {string} kind  model / behaviour kind
   * @param {string} itemId ITEMS id that created it
   * @param {object|null} owner kart
   */
  constructor(sys, kind, itemId, owner) {
    this.uid = _uid++;
    this.sys = sys;
    this.kind = kind;
    this.itemId = itemId;
    this.owner = owner || null;
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = 0.8;
    this.hover = 0; // height of the entity's origin above the road when grounded
    this.alive = true;
    this.age = 0;
    this.mode = 'free'; // 'held' | 'orbit' | 'trail' | 'free' | 'air' | ... (per kind)
    this.attached = false;
    this.static = false; // resting hazard on the road (does not move)
    this.collides = true; // takes part in item-vs-item and item-vs-kart collisions
    this.ownerGrace = 0.45; // seconds before it can hit its owner
    this.yaw = owner ? owner.yaw : 0;
    this.prevYaw = this.yaw;
    this.proj = { index: owner?.proj ? owner.proj.index : null };
    this.hasProj = !!owner?.proj;
    this.obj = sys.models.acquire(kind);
    this.parts = this.obj.userData.parts;
    sys.scene.add(this.obj);
    this.spawnTime = sys.time;
    this.visTime = 0;
  }

  /** Re-project onto the track (uses the previous result's index as a hint). */
  ground() {
    const pr = this.sys.path.project(this.pos, this.hasProj ? this.proj.index : null, this.proj);
    this.hasProj = true;
    return pr;
  }

  savePrev() {
    this.prev.copy(this.pos);
    this.prevYaw = this.yaw;
  }

  /** Called once when an attached entity becomes free (dropped / fired) so interpolation does not smear. */
  snap() {
    this.prev.copy(this.pos);
    this.prevYaw = this.yaw;
  }

  update() {}

  /** Keep inside the walls; reflect the horizontal velocity. Returns true if a wall was hit. */
  wallBounce(pr, restitution = 1, margin = 0.35) {
    if (pr.surface !== 'wall') return false;
    const f = pr.frame;
    const side = pr.side;
    const over = Math.abs(pr.lateral) - (pr.limit - margin);
    // push back inside along the horizontal right vector
    this.pos.x -= f.rightH.x * side * over;
    this.pos.z -= f.rightH.z * side * over;
    // inward normal
    const nx = -f.rightH.x * side;
    const nz = -f.rightH.z * side;
    const dot = this.vel.x * nx + this.vel.z * nz;
    if (dot < 0) {
      this.vel.x -= (1 + restitution) * dot * nx;
      this.vel.z -= (1 + restitution) * dot * nz;
    }
    return true;
  }

  /** Bounce off static track hazards (barrels, etc). Returns the hazard hit or null. */
  hazardBounce() {
    const hz = this.sys.track.hazards;
    if (!hz) return null;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      if (!h || h.active === false || !h.position) continue;
      const dx = this.pos.x - h.position.x;
      const dz = this.pos.z - h.position.z;
      const r = (h.radius ?? 1) + this.radius * 0.6;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r || Math.abs(this.pos.y - h.position.y) > 3) continue;
      const d = Math.sqrt(d2) || 1e-3;
      const nx = dx / d;
      const nz = dz / d;
      this.pos.x = h.position.x + nx * r;
      this.pos.z = h.position.z + nz * r;
      const dot = this.vel.x * nx + this.vel.z * nz;
      if (dot < 0) {
        this.vel.x -= 2 * dot * nx;
        this.vel.z -= 2 * dot * nz;
      }
      return h;
    }
    return null;
  }

  /** A kart touched this entity (owner/respawn filtering already done). */
  onKart() {
    this.destroy('break');
  }

  /** Another entity collided with this one. */
  onItem() {
    this.destroy('break');
  }

  /** An invincible kart smashed through it. */
  onSmash() {
    this.destroy('smash');
  }

  destroy(reason = 'break') {
    if (!this.alive) return;
    this.alive = false;
    this.sys._onEntityDestroyed(this, reason);
  }

  release() {
    this.sys.models.release(this.kind, this.obj);
    this.obj = null;
  }

  /** Per-frame visual sync (alpha = physics interpolation factor). */
  visual(dt, alpha) {
    this.visTime += dt;
    const o = this.obj;
    o.position.lerpVectors(this.prev, this.pos, alpha);
    o.rotation.y = this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha;
  }

  /** Threat description for the AI (kind, radius). */
  get threatKind() {
    return this.kind;
  }
}

// ================================================================================================
// Ramen bowl (dropped hazard; can be trailed / held; tossed forward in an arc)
// ================================================================================================
export class RamenEntity extends ItemEntity {
  constructor(sys, owner, itemId = 'ramen') {
    super(sys, 'ramen', itemId, owner);
    this.radius = 0.85;
    this.hover = 0.02;
    this.wobble = 0;
    this.tilt = new THREE.Quaternion();
    this.spinYaw = Math.random() * Math.PI * 2;
  }

  /** Release from the kart: 'drop' behind or 'toss' forward in an arc. */
  launch(kind, kart) {
    this.attached = false;
    this.mode = 'air';
    if (kind === 'toss') {
      this.pos.copy(kart.position).addScaledVector(kart.forward, 1.6);
      this.pos.y += 1.4;
      const sp = Math.max(0, kart.speed) + 15;
      this.vel.copy(kart.forward).multiplyScalar(sp);
      this.vel.y = 8.5;
    } else {
      this.vel.copy(kart.velocity || _v.set(0, 0, 0)).multiplyScalar(0.25);
      this.vel.y = Math.min(this.vel.y, 0) + 1.5;
    }
    this.snap();
  }

  update(dt) {
    if (this.mode !== 'air') return;
    this.vel.y -= TUNING.tossGravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    const pr = this.ground();
    this.wallBounce(pr, 0.3);
    if (pr.surface === 'void' && this.pos.y < pr.groundY - 6) return this.destroy('fall');
    if (pr.surface !== 'void' && this.pos.y <= pr.groundY + this.hover && this.vel.y <= 0) {
      this.pos.y = pr.groundY + this.hover;
      if (this.vel.y < -6) {
        // small bounce
        this.vel.y *= -0.25;
        this.vel.x *= 0.5;
        this.vel.z *= 0.5;
        this.wobble = 1;
        this.sys.particles?.emit('dust', this.pos, { count: 3, color: '#e7d9bf', size: 0.7 });
      } else {
        this.vel.set(0, 0, 0);
        this.mode = 'free';
        this.static = true;
        this.wobble = 1;
        this.tilt.setFromUnitVectors(UP, pr.frame.up);
      }
    }
    if (this.mode === 'air') {
      this.yaw += dt * 6;
    }
  }

  onKart(kart) {
    if (this.sys.hitKart(kart, this.owner, this.itemId, 'spin', 1, this)) {
      this.sys.sfx('ramenSplat', this.pos);
    }
    this.destroy('splat');
  }

  visual(dt, alpha) {
    super.visual(dt, alpha);
    const o = this.obj;
    const b = this.parts.body;
    this.wobble = Math.max(0, this.wobble - dt * 2.2);
    const w = Math.sin(this.visTime * 18) * 0.18 * this.wobble;
    if (this.static) {
      o.quaternion.copy(this.tilt);
      _q.setFromAxisAngle(UP, this.spinYaw);
      o.quaternion.multiply(_q);
      b.rotation.set(w, 0, w * 0.6);
      b.scale.set(1 + 0.12 * this.wobble, 1 - 0.15 * this.wobble, 1 + 0.12 * this.wobble);
    } else if (this.attached) {
      // bouncy dangle behind the kart
      b.rotation.set(Math.sin(this.visTime * 9) * 0.08, 0, Math.sin(this.visTime * 7) * 0.08);
      b.position.y = Math.abs(Math.sin(this.visTime * 10)) * 0.08;
    } else {
      b.rotation.x += dt * 4;
    }
  }
}

// ================================================================================================
// Decoy item box (dropped / held / tossed). Hitting it -> launch(0.6)
// ================================================================================================
export class DecoyEntity extends ItemEntity {
  constructor(sys, owner) {
    super(sys, 'decoy', 'decoy', owner);
    this.radius = 0.95;
    this.hover = 1.15;
  }

  launch(kind, kart) {
    RamenEntity.prototype.launch.call(this, kind, kart);
  }

  update(dt) {
    if (this.mode !== 'air') return;
    this.vel.y -= TUNING.tossGravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    const pr = this.ground();
    this.wallBounce(pr, 0.3);
    if (pr.surface === 'void' && this.pos.y < pr.groundY - 6) return this.destroy('fall');
    if (pr.surface !== 'void' && this.pos.y <= pr.groundY + this.hover && this.vel.y <= 0) {
      this.pos.y = pr.groundY + this.hover;
      this.vel.set(0, 0, 0);
      this.mode = 'free';
      this.static = true;
    }
  }

  onKart(kart) {
    this.sys.hitKart(kart, this.owner, 'decoy', 'launch', 0.6, this);
    this.sys.sfx('decoy', this.pos);
    this.sys.particles?.emit('explosion', this.pos, { size: 2.6, floor: this.pos.y - this.hover });
    this.destroy('boom');
  }

  onItem() {
    this.sys.particles?.emit('explosion', this.pos, { size: 2, floor: this.pos.y - this.hover });
    this.destroy('boom');
  }

  visual(dt, alpha) {
    super.visual(dt, alpha);
    const b = this.parts.body;
    const t = this.visTime;
    // like a real box, but a little "off": tumbling slightly faster the other way
    b.rotation.set(0.45 + Math.sin(t * 1.3) * 0.12, -t * 1.6, 0.35);
    b.position.y = Math.sin(t * 2.4 + this.uid) * 0.1;
    const sh = this.parts.shadow;
    sh.position.y = -this.hover + 0.04;
    sh.visible = !this.attached || true;
  }
}

// ================================================================================================
// Ricochet round (green): road-hugging, bounces off walls (<= 5 bounces / 8 s)
// ================================================================================================
export class BulletEntity extends ItemEntity {
  constructor(sys, owner, itemId = 'bullet') {
    super(sys, 'bullet', itemId, owner);
    this.radius = 0.62;
    this.hover = TUNING.bulletHover;
    this.bounces = 0;
    this.maxBounces = 5;
    this.life = 0;
    this.roll = 0;
    this.falling = false;
    this.trailAcc = 0;
  }

  fire(kart, backward) {
    this.attached = false;
    this.mode = 'free';
    const dir = backward ? -1 : 1;
    if (backward) kart.getRearPosition(2.3, this.pos);
    else kart.getFrontPosition(2.5, this.pos);
    const speed = TUNING.bulletSpeed + Math.max(0, kart.speed * dir) * 0.15;
    this.vel.copy(kart.forward).multiplyScalar(speed * dir);
    this.vel.y = 0;
    this.yaw = Math.atan2(this.vel.x, this.vel.z);
    const pr = this.ground();
    this.pos.y = pr.groundY + this.hover;
    this.life = 0;
    this.snap();
  }

  update(dt) {
    if (this.attached) return;
    this.life += dt;
    if (this.life > TUNING.bulletLife) return this.destroy('fizzle');
    if (this.falling) {
      this.vel.y -= 30 * dt;
      this.pos.addScaledVector(this.vel, dt);
      const pr = this.ground();
      if (this.pos.y < pr.groundY - 8) this.destroy('fall');
      return;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const pr = this.ground();
    if (pr.surface === 'void') {
      this.falling = true;
      this.vel.y = 0;
      return;
    }
    let hit = this.wallBounce(pr, 1, 0.45);
    if (!hit && this.hazardBounce()) hit = true;
    if (hit) {
      this.bounces++;
      if (this.bounces > this.maxBounces) return this.destroy('break');
      this.sys.particles?.emit('spark', this.pos, { count: 8, color: '#eaffea', color2: '#4cd964', spread: 6 });
      this.sys.sfx('wallBump', this.pos, { volume: 0.45, pitch: 1.6 });
      this.ground();
    }
    // hug the road (smoothly over crests, snap on big drops)
    const gy = this.proj.groundY + this.hover;
    this.pos.y = Math.abs(gy - this.pos.y) > 2 ? gy : damp(this.pos.y, gy, 30, dt);
    this.yaw = Math.atan2(this.vel.x, this.vel.z);
  }

  onKart(kart) {
    this.sys.hitKart(kart, this.owner, this.itemId, 'spin', 1, this);
    this.destroy('break');
  }

  visual(dt, alpha) {
    super.visual(dt, alpha);
    const b = this.parts.body;
    if (this.mode === 'orbit' || this.attached) {
      b.rotation.set(0, 0, 0);
      this.roll += dt * 6;
      b.rotation.z = this.roll;
      b.position.y = 0.05 + Math.sin(this.visTime * 6 + this.uid) * 0.06;
    } else {
      this.roll += dt * 22;
      b.rotation.z = this.roll;
      b.position.y = 0.05;
      // glowing trail
      this.trailAcc += dt;
      if (this.trailAcc > 1 / 60 && this.sys.particles) {
        this.trailAcc = 0;
        this.sys.particles.emit('trail', this.obj.position, { color: '#8cffaa', color2: '#1fb84a', size: 0.75, life: 0.3 });
      }
    }
    const g = this.parts.glow;
    if (g) g.scale.setScalar(1.7 + Math.sin(this.visTime * 20) * 0.15);
  }
}

// ================================================================================================
// Drone missile (red): follows the track line towards the racer ahead, then homes in
// ================================================================================================
export class MissileEntity extends ItemEntity {
  constructor(sys, owner, itemId = 'missile') {
    super(sys, 'missile', itemId, owner);
    this.radius = 0.75;
    this.hover = TUNING.missileHover;
    this.target = null;
    this.d = 0;
    this.lat = 0;
    this.life = 0;
    this.speed = TUNING.missileSpeed;
    this.locked = false;
    this.frame = null;
    this.trailAcc = 0;
  }

  fire(kart, backward) {
    this.attached = false;
    this.life = 0;
    const sys = this.sys;
    if (backward) {
      this.mode = 'dumb';
      kart.getRearPosition(2.4, this.pos);
      this.vel.copy(kart.forward).multiplyScalar(-TUNING.bulletSpeed);
      this.vel.y = 0;
    } else {
      this.target = sys.findTargetAhead(kart);
      this.mode = 'track';
      kart.getFrontPosition(2.6, this.pos);
      const pr = this.ground();
      this.d = pr.d;
      this.lat = pr.lateral;
      this.speed = Math.max(TUNING.missileSpeed, kart.speed + 22);
      this.vel.copy(kart.forward).multiplyScalar(this.speed);
    }
    this.yaw = Math.atan2(this.vel.x, this.vel.z);
    const pr = this.ground();
    this.pos.y = pr.groundY + this.hover;
    this.snap();
  }

  _targetValid() {
    const t = this.target;
    return !!t && !t.finished && !(t.respawnTime > 0);
  }

  update(dt) {
    if (this.attached) return;
    this.life += dt;
    const sys = this.sys;
    const path = sys.path;
    if (this.life > TUNING.missileLife) return this.explodeSmall();
    if (this.mode === 'dumb') {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      const pr = this.ground();
      if (pr.surface === 'wall' || pr.surface === 'void' || this.hazardBounce()) return this.explodeSmall();
      this.pos.y = damp(this.pos.y, pr.groundY + this.hover, 25, dt);
      this.yaw = Math.atan2(this.vel.x, this.vel.z);
      if (this.life > 4) this.explodeSmall();
      return;
    }
    if (this.mode === 'track') {
      if (!this.target && this.life > 5) return this.explodeSmall();
      const valid = this._targetValid();
      this.d = path.wrapD(this.d + this.speed * dt);
      const f = (this.frame = path.frameAt(this.d, this.frame || undefined));
      const lim = f.halfWidth + Math.min(f.offL, f.offR) - 1.2;
      const tl = valid && this.target.proj ? this.target.proj.lateral : this.lat;
      this.lat = clamp(damp(this.lat, tl, 2.2, dt), -lim, lim);
      _v.copy(f.pos).addScaledVector(f.right, this.lat);
      this.pos.x = _v.x;
      this.pos.z = _v.z;
      const pr = this.ground();
      this.pos.y = damp(this.pos.y, pr.groundY + this.hover, 20, dt);
      this.vel.subVectors(this.pos, this.prev).divideScalar(Math.max(dt, 1e-4));
      this.yaw = Math.atan2(this.vel.x, this.vel.z);
      if (valid) {
        const along = path.deltaD(this.target.proj.d, this.d);
        const dist = this.pos.distanceTo(this.target.position);
        if (along < 22 && along > -4 && dist < TUNING.missileHomeRange) {
          this.mode = 'home';
          if (!this.locked) {
            this.locked = true;
            sys.sfx('missileLock', this.target.position);
          }
        } else if (along < -30) {
          // overshot somehow (target respawned behind) -> keep flying, lose target
          this.target = null;
        }
      }
      return;
    }
    if (this.mode === 'home') {
      if (!this._targetValid()) {
        this._backToTrack();
        return;
      }
      const t = this.target;
      _v.copy(t.position).addScaledVector(t.velocity || _v2.set(0, 0, 0), 0.1);
      _v.y += 0.6;
      const dx = _v.x - this.pos.x;
      const dz = _v.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 48) return this._backToTrack();
      const want = Math.atan2(dx, dz);
      const cur = Math.atan2(this.vel.x, this.vel.z);
      const diff = wrapAngle(want - cur);
      const turn = clamp(diff, -TUNING.missileTurn * dt, TUNING.missileTurn * dt);
      const sp = Math.max(this.speed, Math.abs(t.speed || 0) + 18);
      const a = cur + turn;
      this.vel.set(Math.sin(a) * sp, 0, Math.cos(a) * sp);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      const pr = this.ground();
      if (pr.surface === 'wall') this.wallBounce(pr, 0, 0.5);
      this.pos.y = damp(this.pos.y, pr.groundY + this.hover, 20, dt);
      this.yaw = Math.atan2(this.vel.x, this.vel.z);
    }
  }

  _backToTrack() {
    const pr = this.ground();
    this.d = pr.d;
    this.lat = pr.lateral;
    this.mode = 'track';
    if (!this._targetValid()) this.target = null;
  }

  /** Distance used for the HUD warning (or -1 if this missile is not a threat to `kart`). */
  warningFor(kart) {
    if (this.target !== kart || this.attached) return -1;
    if (this.mode === 'home') return this.pos.distanceTo(kart.position);
    if (this.mode === 'track' && kart.proj) {
      const along = this.sys.path.deltaD(kart.proj.d, this.d);
      if (along >= 0 && along < 140) return along;
    }
    return -1;
  }

  explodeSmall() {
    if (!this.alive) return;
    this.sys.particles?.emit('explosion', this.pos, { size: 2.2, floor: this.pos.y - this.hover });
    this.sys.sfx('explosion', this.pos, { volume: 0.6 });
    this.destroy('boom');
  }

  onKart(kart) {
    this.sys.hitKart(kart, this.owner, this.itemId, 'launch', 0.8, this);
    this.sys.particles?.emit('explosion', this.pos, { size: 3, floor: this.pos.y - this.hover });
    this.sys.sfx('explosion', this.pos, { volume: 0.8 });
    this.destroy('boom');
  }

  onItem() {
    this.explodeSmall();
  }

  visual(dt, alpha) {
    super.visual(dt, alpha);
    const p = this.parts;
    for (let i = 0; i < p.rotors.length; i++) p.rotors[i].rotation.y += dt * (38 + i * 3) * (i % 2 ? 1 : -1);
    const free = !this.attached && this.mode !== 'orbit';
    p.body.rotation.z = free ? Math.sin(this.visTime * 7) * 0.12 : 0;
    p.body.position.y = free ? Math.sin(this.visTime * 5) * 0.06 : Math.sin(this.visTime * 4 + this.uid) * 0.08;
    p.glow.visible = free;
    if (free && this.sys.particles) {
      this.trailAcc += dt;
      if (this.trailAcc > 1 / 50) {
        this.trailAcc = 0;
        _v.set(0, 0, -0.85).applyAxisAngle(UP, this.obj.rotation.y).add(this.obj.position);
        this.sys.particles.emit('smokeTrail', _v, { size: 0.8, life: 0.55 });
        this.sys.particles.emit('trail', _v, { color: '#ffe38a', color2: '#ff4a1a', size: 0.55, life: 0.12 });
      }
    }
  }
}

// ================================================================================================
// Grenade: lobbed in an arc, bounces, explodes on contact or 1.2 s after landing (radius 7)
// ================================================================================================
export class GrenadeEntity extends ItemEntity {
  constructor(sys, owner) {
    super(sys, 'grenade', 'grenade', owner);
    this.radius = 0.6;
    this.hover = 0.42;
    this.fuse = -1;
    this.landed = false;
    this.spin = new THREE.Vector3(Math.random() * 8 + 6, Math.random() * 4, Math.random() * 4);
    this.blast = 7;
    this.ownerGrace = 0.6;
  }

  throw(kart, backward) {
    this.mode = 'air';
    this.pos.copy(kart.position).addScaledVector(kart.forward, backward ? -1.2 : 1.2);
    this.pos.y += 1.7;
    if (backward) {
      this.vel.copy(kart.forward).multiplyScalar(Math.max(0, kart.speed) - 12);
      this.vel.y = 7;
    } else {
      this.vel.copy(kart.forward).multiplyScalar(Math.max(0, kart.speed) + 22);
      this.vel.y = 10.5;
    }
    this.snap();
  }

  update(dt) {
    if (this.fuse >= 0) {
      this.fuse -= dt;
      if (this.fuse <= 0) return this.explode();
    }
    if (this.mode === 'air') this.vel.y -= TUNING.grenadeGravity * dt;
    else {
      const k = Math.exp(-3 * dt);
      this.vel.x *= k;
      this.vel.z *= k;
    }
    this.pos.addScaledVector(this.vel, dt);
    const pr = this.ground();
    if (this.wallBounce(pr, 0.5)) this.sys.sfx('wallBump', this.pos, { volume: 0.3, pitch: 1.4 });
    this.hazardBounce();
    if (pr.surface === 'void') {
      if (this.pos.y < pr.groundY - 5) this.explode();
      return;
    }
    const gy = pr.groundY + this.hover;
    if (this.mode === 'air') {
      if (this.pos.y <= gy && this.vel.y <= 0) {
        this.pos.y = gy;
        if (!this.landed) {
          this.landed = true;
          this.fuse = TUNING.grenadeFuse;
        }
        this.sys.particles?.emit('dust', this.pos, { count: 3, color: '#cfc4ae', size: 0.7 });
        if (this.vel.y < -3) {
          this.vel.y *= -0.38;
          this.vel.x *= 0.6;
          this.vel.z *= 0.6;
        } else {
          this.vel.y = 0;
          this.mode = 'ground';
        }
      }
    } else {
      this.pos.y = gy;
    }
  }

  explode() {
    if (!this.alive) return;
    this.alive = false; // prevent recursion from explode() -> destroy others -> onItem
    const pr = this.ground();
    _v.copy(this.pos);
    if (pr.surface !== 'void') _v.y = pr.groundY;
    this.sys.explode(_v, this.blast, this.owner, 'grenade', { strength: 1, source: this });
    this.alive = true;
    this.destroy('boom');
  }

  onKart() {
    this.explode();
  }

  onItem() {
    this.explode();
  }

  onSmash() {
    this.explode();
  }

  visual(dt, alpha) {
    super.visual(dt, alpha);
    const b = this.parts.body;
    if (this.mode === 'air') {
      b.rotation.x += this.spin.x * dt;
      b.rotation.z += this.spin.z * dt;
    } else {
      b.rotation.x = damp(b.rotation.x, 0, 6, dt);
      b.rotation.z = damp(b.rotation.z, 0, 6, dt);
    }
    // blinking fuse, faster near detonation
    const g = this.parts.glow;
    const rate = this.fuse >= 0 ? 6 + (1 - this.fuse / TUNING.grenadeFuse) * 30 : 4;
    const on = Math.sin(this.visTime * rate) > 0;
    g.visible = on;
    g.position.set(0, 0.62, 0).applyEuler(b.rotation);
    g.scale.setScalar(on ? 0.9 : 0.5);
    if (this.fuse >= 0) {
      const s = 1 + Math.max(0, 1 - this.fuse / TUNING.grenadeFuse) * 0.25 * (on ? 1 : 0.6);
      b.scale.setScalar(s);
    }
    if (this.sys.particles && Math.random() < dt * 30) {
      _v.copy(g.position).add(this.obj.position);
      this.sys.particles.emit('spark', _v, { count: 1, spread: 2.5, color: '#fff2a0', color2: '#ff7a1a', life: 0.25 });
    }
  }
}

// ================================================================================================
// Blue Seeker: flies high along the track to the leader, dives and explodes (radius 9)
// ================================================================================================
export class SeekerEntity extends ItemEntity {
  constructor(sys, owner) {
    super(sys, 'seeker', 'seeker', owner);
    this.radius = 1;
    this.collides = false;
    this.mode = 'rise';
    this.t = 0;
    this.d = owner?.proj ? owner.proj.d : 0;
    this.lat = owner?.proj ? owner.proj.lateral : 0;
    this.height = 1.5;
    this.progress = owner?.progress ?? 0;
    this.target = null;
    this.frame = null;
    this.diveFrom = new THREE.Vector3();
    this.diveTime = 0;
    this.hoverAngle = 0;
    this.warned = false;
    this.trailAcc = 0;
    this.reticle = sys.models.acquire('reticle');
    sys.scene.add(this.reticle);
    this.reticle.visible = false;
    this.reticleAmt = 0;
    this.reticlePos = new THREE.Vector3();
    this.bank = 0;
  }

  launch(kart) {
    this.pos.copy(kart.position);
    this.pos.y += 1.5;
    this.yaw = kart.yaw;
    this._syncProj(this.d, this.lat, kart.proj ? kart.proj.groundY : kart.position.y);
    this.snap();
  }

  /** The seeker flies above the road: keep `proj` meaningful (d / lateral of the road below) for the AI. */
  _syncProj(d, lat, groundY) {
    const p = this.proj;
    p.d = d;
    p.lateral = lat;
    p.groundY = groundY;
    if (this.frame) p.index = this.frame.index;
    this.hasProj = true;
  }

  _leader() {
    return this.sys.findLeader();
  }

  _gap() {
    // along-track distance from the seeker to its target (positive = target ahead)
    const t = this.target;
    if (!t) return 0;
    if (typeof t.progress === 'number' && typeof this.progress === 'number') return t.progress - this.progress;
    return t.proj ? this.sys.path.deltaD(t.proj.d, this.d) : 0;
  }

  update(dt) {
    const sys = this.sys;
    const path = sys.path;
    this.t += dt;
    if (this.mode === 'rise' || this.mode === 'cruise') {
      const leader = this._leader();
      if (leader) this.target = leader;
      const sp = TUNING.seekerSpeed * (this.mode === 'rise' ? 0.6 : 1);
      this.d = path.wrapD(this.d + sp * dt);
      this.progress += sp * dt;
      this.height = damp(this.height, TUNING.seekerHeight, 3, dt);
      if (this.mode === 'rise' && this.t > 0.6) this.mode = 'cruise';
      const f = (this.frame = path.frameAt(this.d, this.frame || undefined));
      const tl = this.target?.proj ? this.target.proj.lateral : 0;
      this.lat = damp(this.lat, tl * 0.8, 1.5, dt);
      this.pos.copy(f.pos).addScaledVector(f.right, this.lat);
      this._syncProj(this.d, this.lat, this.pos.y);
      this.pos.y += this.height + Math.sin(this.t * 3) * 0.4;
      this.vel.subVectors(this.pos, this.prev).divideScalar(Math.max(dt, 1e-4));
      const newYaw = Math.atan2(this.vel.x, this.vel.z);
      this.bank = damp(this.bank, clamp(wrapAngle(newYaw - this.yaw) / Math.max(dt, 1e-4) * 0.15, -0.8, 0.8), 6, dt);
      this.yaw = newYaw;
      if (!this.target) {
        if (this.t > 8) this._explodeAt(this.pos);
        return;
      }
      const gap = this._gap();
      if (!this.warned && gap < 140) {
        this.warned = true;
        sys.sfx('seekerWarning', this.target.position);
      }
      if (this.mode === 'cruise') {
        if (gap < 16 && gap > -2) this._startDive();
        else if (gap <= -2 || (this.target === this.owner && this.t > 0.6 && gap < 20)) {
          this.mode = 'hover';
          this.t = 0;
          this.hoverAngle = Math.atan2(this.pos.x - this.target.position.x, this.pos.z - this.target.position.z);
        }
      }
      if (this.t > 30) this._explodeAt(this.pos);
      return;
    }
    if (this.target?.proj && (this.mode === 'hover' || this.mode === 'dive')) {
      const tp = this.target.proj;
      this._syncProj(tp.d, tp.lateral, tp.groundY);
    }
    if (this.mode === 'hover') {
      const t = this.target;
      if (!t) return this._explodeAt(this.pos);
      // circle once above the target, then dive
      this.hoverAngle += dt * 4.5;
      _v.set(Math.sin(this.hoverAngle) * 5, TUNING.seekerHeight * 0.85, Math.cos(this.hoverAngle) * 5).add(t.position);
      this.pos.x = damp(this.pos.x, _v.x, 6, dt);
      this.pos.y = damp(this.pos.y, _v.y, 6, dt);
      this.pos.z = damp(this.pos.z, _v.z, 6, dt);
      this.vel.subVectors(this.pos, this.prev).divideScalar(Math.max(dt, 1e-4));
      this.yaw = Math.atan2(this.vel.x, this.vel.z);
      this.bank = damp(this.bank, -0.6, 4, dt);
      if (this.t > 1.2) this._startDive();
      return;
    }
    if (this.mode === 'dive') {
      const t = this.target;
      this.diveTime += dt;
      const k = clamp(this.diveTime / 0.75, 0, 1);
      const e = k * k * (3 - 2 * k);
      _v.copy(t ? t.position : this.diveFrom);
      _v.y += 0.4;
      // arc: overshoot up first, then plunge
      this.pos.lerpVectors(this.diveFrom, _v, e);
      this.pos.y += Math.sin(k * Math.PI) * 3 * (1 - k);
      this.vel.subVectors(this.pos, this.prev).divideScalar(Math.max(dt, 1e-4));
      if (this.vel.lengthSq() > 1e-4) this.yaw = Math.atan2(this.vel.x, this.vel.z);
      if (k >= 1 || (t && this.pos.distanceTo(t.position) < 1.2)) {
        _v.copy(t ? t.position : this.pos);
        this._explodeAt(_v);
      }
    }
  }

  _startDive() {
    this.mode = 'dive';
    this.diveTime = 0;
    this.diveFrom.copy(this.pos);
    if (this.target) this.sys.sfx('seekerWarning', this.target.position, { pitch: 1.3 });
  }

  _explodeAt(p) {
    if (!this.alive) return;
    this.sys.explode(p, TUNING.seekerBlast, this.owner, 'seeker', { strength: 1.1, color: '#bfe3ff', color2: '#2a74ff', source: this });
    this.destroy('boom');
  }

  warningFor(kart) {
    if (this.target !== kart) return -1;
    if (this.mode === 'dive' || this.mode === 'hover') return this.pos.distanceTo(kart.position);
    const g = this._gap();
    return g >= 0 && g < 250 ? g : -1;
  }

  release() {
    this.sys.models.release('reticle', this.reticle);
    this.reticle = null;
    super.release();
  }

  visual(dt, alpha) {
    super.visual(dt, alpha);
    const p = this.parts;
    // pitch: dive nose-down
    const pitch = this.mode === 'dive' ? clamp(-this.vel.y / 30, -1.2, 1.2) : 0;
    p.body.rotation.set(pitch, 0, this.bank);
    p.glow.scale.setScalar(3.4 + Math.sin(this.visTime * 14) * 0.4);
    const P = this.sys.particles;
    if (P) {
      this.trailAcc += dt;
      if (this.trailAcc > 1 / 60) {
        this.trailAcc = 0;
        P.emit('trail', this.obj.position, { color: '#d6f0ff', color2: '#1f6bff', size: 1.4, life: 0.45 });
        if (Math.random() < 0.5) P.emit('star', this.obj.position, { color: '#cfeaff', spread: 2, size: 0.8, count: 1 });
      }
    }
    // ground reticle under the target
    const r = this.reticle;
    const t = this.target;
    let want = 0;
    if (t && (this.mode === 'dive' || this.mode === 'hover' || (this.mode === 'cruise' && this._gap() < 110))) want = 1;
    this.reticleAmt = damp(this.reticleAmt, want, 6, dt);
    r.visible = this.reticleAmt > 0.02 && !!t;
    if (r.visible) {
      const gy = t.proj ? t.proj.groundY : t.position.y;
      this.reticlePos.set(t.position.x, gy + 0.08, t.position.z);
      r.position.copy(this.reticlePos);
      const pulse = 1 + Math.sin(this.visTime * 12) * 0.08;
      const close = this.mode === 'dive' ? 1 : this.mode === 'hover' ? 0.8 : 0.4;
      r.scale.setScalar((14 - close * 4) * pulse * this.reticleAmt);
      r.rotation.y += dt * (1.5 + close * 3);
      r.userData.parts.body.material.opacity = 0.85 * this.reticleAmt;
    }
  }
}

// ================================================================================================
// Visual-only props: spent drink can, Sensei's card flash, credit bag, Shittim tablet above the head
// ================================================================================================
export class PropFx {
  constructor(sys, kind, kart, opts = {}) {
    this.sys = sys;
    this.kind = kind;
    this.kart = kart;
    this.obj = sys.models.acquire(kind);
    sys.scene.add(this.obj);
    this.parts = this.obj.userData.parts;
    this.alive = true;
    this.t = 0;
    this.life = opts.life ?? 1;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.follow = !!opts.follow;
    this.offset = new THREE.Vector3(0, 2.6, 0);
    this.onPeak = opts.onPeak || null;
    this.peaked = false;
    if (kind === 'can') {
      kart.getRearPosition(0.6, this.pos);
      this.pos.y += 1.5;
      this.vel.copy(kart.velocity || _v.set(0, 0, 0)).multiplyScalar(0.6);
      this.vel.addScaledVector(kart.right || _v.set(1, 0, 0), (Math.random() < 0.5 ? -1 : 1) * 4);
      this.vel.addScaledVector(kart.forward, -3);
      this.vel.y = 7;
      this.spin.set(9, 4, 7);
    } else {
      this.pos.copy(kart.position).add(this.offset);
    }
    this.obj.position.copy(this.pos);
  }

  update(dt) {
    this.t += dt;
    if (this.t >= this.life) {
      this.alive = false;
      return;
    }
    if (this.kind === 'can') {
      this.vel.y -= 24 * dt;
      this.pos.addScaledVector(this.vel, dt);
      const pr = this.sys.path.project(this.pos, this.kart.proj ? this.kart.proj.index : null, (this._pr ||= {}));
      if (this.pos.y < pr.groundY + 0.25 && pr.surface !== 'void') {
        this.pos.y = pr.groundY + 0.25;
        if (this.vel.y < -2) {
          this.vel.y *= -0.45;
          this.vel.x *= 0.7;
          this.vel.z *= 0.7;
        } else this.vel.set(0, 0, 0);
      }
    }
  }

  visual(dt) {
    const o = this.obj;
    const k = this.t / this.life;
    if (this.kind === 'can') {
      o.position.copy(this.pos);
      o.rotation.x += this.spin.x * dt;
      o.rotation.y += this.spin.y * dt;
      o.rotation.z += this.spin.z * dt;
      o.scale.setScalar(k > 0.8 ? 1 - (k - 0.8) * 5 : 1);
      return;
    }
    // pop above the driver's head, spin, then vanish
    const kart = this.kart;
    const rise = Math.min(1, this.t / 0.25);
    const e = 1 - Math.pow(1 - rise, 3);
    o.position.copy(kart.object3d ? kart.object3d.position : kart.position);
    o.position.y += 1.6 + e * 1.4 + Math.sin(this.t * 6) * 0.08;
    let s = e * (1 + Math.sin(Math.min(1, this.t / 0.35) * Math.PI) * 0.35);
    if (k > 0.8) s *= 1 - (k - 0.8) * 5;
    o.scale.setScalar(Math.max(0.001, s));
    if (this.kind === 'card') {
      o.rotation.set(0.25, this.t * 10, 0.4 * Math.sin(this.t * 8));
    } else if (this.kind === 'tablet') {
      o.rotation.set(-0.15, (kart.yaw || 0) + Math.PI + Math.sin(this.t * 3) * 0.2, 0);
    } else {
      o.rotation.set(0, this.t * 4, Math.sin(this.t * 10) * 0.15);
    }
    if (!this.peaked && this.t > 0.35) {
      this.peaked = true;
      this.onPeak?.(o.position);
    }
  }

  release() {
    this.sys.models.release(this.kind, this.obj);
  }
}

// ================================================================================================
// Lightning bolt (Shittim Tablet), visual only
// ================================================================================================
export class BoltFx {
  constructor(sys, target) {
    this.sys = sys;
    this.obj = sys.models.acquire('bolt');
    sys.scene.add(this.obj);
    this.target = target;
    this.t = 0;
    this.life = 0.45;
    this.alive = true;
    this.top = new THREE.Vector3();
    this.bottom = new THREE.Vector3();
    this.reshape = 0;
  }

  update(dt) {
    this.t += dt;
    if (this.t >= this.life) this.alive = false;
  }

  visual(dt) {
    this.reshape -= dt;
    const k = this.t / this.life;
    const p = this.target.object3d ? this.target.object3d.position : this.target.position;
    if (this.reshape <= 0) {
      this.reshape = 0.05;
      this.bottom.copy(p);
      this.bottom.y += 0.8;
      this.top.copy(p);
      this.top.y += 32;
      this.top.x += 3;
      this.sys.models.shapeBolt(this.obj, this.top, this.bottom, 0.45, 1.6);
    }
    const m = this.obj.userData.parts.body.material;
    m.opacity = (1 - k) * (0.6 + 0.4 * Math.random());
  }

  release() {
    this.sys.models.release('bolt', this.obj);
  }
}

