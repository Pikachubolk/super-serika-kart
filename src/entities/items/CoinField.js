// Credits (coins): track pickups that respawn after 12 s, plus loose coins scattered by hit karts
// (owner: items agent). Everything is drawn with ONE InstancedMesh.
import * as THREE from 'three';

const RESPAWN = 12;
const GROW = 0.4;
const LOOSE_MAX = 48;
const LOOSE_LIFE = 8;
const HOVER = 0.9;
const LOOSE_HOVER = 0.55;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function backOut(t) {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export class CoinField {
  constructor(sys, spots = []) {
    this.sys = sys;
    const path = sys.path;
    this.coins = spots.map((s, i) => {
      const pos = s.position?.clone ? s.position.clone() : new THREE.Vector3(s.position?.x || 0, s.position?.y || 0, s.position?.z || 0);
      const pr = path.project(pos, null, {});
      pos.y = pr.groundY + HOVER;
      return { index: i, position: pos, ground: pr.groundY, active: true, timer: 0, grow: 1, phase: i * 0.61, d: s.d ?? pr.d, lateral: s.lateral ?? pr.lateral };
    });
    this.loose = [];
    for (let i = 0; i < LOOSE_MAX; i++) {
      this.loose.push({
        alive: false,
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        delay: 0,
        grounded: false,
        proj: { index: null },
        hasProj: false,
        phase: i * 1.3,
        from: null,
      });
    }
    this.capacity = this.coins.length + LOOSE_MAX;
    this.mesh = new THREE.InstancedMesh(sys.models.geos.coin, sys.models.coinMat, this.capacity);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = this.capacity;
    sys.scene.add(this.mesh);
  }

  /** Scatter `n` loose coins from a hit kart. */
  scatter(kart, n) {
    let spawned = 0;
    for (let i = 0; i < this.loose.length && spawned < n; i++) {
      const c = this.loose[i];
      if (c.alive) continue;
      c.alive = true;
      c.age = 0;
      c.delay = 0.55;
      c.grounded = false;
      c.from = kart;
      c.pos.copy(kart.position);
      c.pos.y += 1.2;
      c.prev.copy(c.pos);
      const a = Math.random() * Math.PI * 2;
      const sp = 3.5 + Math.random() * 3.5;
      c.vel.set(Math.sin(a) * sp, 8 + Math.random() * 3, Math.cos(a) * sp);
      if (kart.velocity) c.vel.addScaledVector(kart.velocity, 0.45);
      c.proj.index = kart.proj ? kart.proj.index : null;
      c.hasProj = !!kart.proj;
      spawned++;
    }
    return spawned;
  }

  update(dt, karts, onPickup) {
    const path = this.sys.path;
    // track coins
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      if (!c.active) {
        c.timer -= dt;
        if (c.timer <= 0) {
          c.active = true;
          c.grow = 0;
        }
        continue;
      }
      if (c.grow < 1) c.grow = Math.min(1, c.grow + dt / GROW);
      for (let k = 0; k < karts.length; k++) {
        const kart = karts[k];
        if (kart.respawnTime > 0) continue;
        const dx = kart.position.x - c.position.x;
        const dz = kart.position.z - c.position.z;
        const r = 0.7 + (kart.radius ?? 1.3);
        if (dx * dx + dz * dz > r * r) continue;
        const dy = kart.position.y - c.ground;
        if (dy < -1.5 || dy > 3) continue;
        c.active = false;
        c.timer = RESPAWN;
        onPickup(kart, c.position);
        break;
      }
    }
    // loose coins
    for (let i = 0; i < this.loose.length; i++) {
      const c = this.loose[i];
      if (!c.alive) continue;
      c.prev.copy(c.pos);
      c.age += dt;
      c.delay -= dt;
      if (c.age > LOOSE_LIFE) {
        c.alive = false;
        continue;
      }
      if (!c.grounded) {
        c.vel.y -= 26 * dt;
        c.pos.addScaledVector(c.vel, dt);
      } else {
        const f = Math.exp(-4 * dt);
        c.vel.x *= f;
        c.vel.z *= f;
        c.pos.x += c.vel.x * dt;
        c.pos.z += c.vel.z * dt;
      }
      const pr = path.project(c.pos, c.hasProj ? c.proj.index : null, c.proj);
      c.hasProj = true;
      if (pr.surface === 'wall') {
        const side = pr.side;
        const over = Math.abs(pr.lateral) - (pr.limit - 0.4);
        c.pos.x -= pr.frame.rightH.x * side * over;
        c.pos.z -= pr.frame.rightH.z * side * over;
        const nx = -pr.frame.rightH.x * side;
        const nz = -pr.frame.rightH.z * side;
        const dot = c.vel.x * nx + c.vel.z * nz;
        if (dot < 0) {
          c.vel.x -= 1.5 * dot * nx;
          c.vel.z -= 1.5 * dot * nz;
        }
      }
      if (pr.surface === 'void') {
        if (c.pos.y < pr.groundY - 6) c.alive = false;
        c.grounded = false;
      } else {
        const gy = pr.groundY + LOOSE_HOVER;
        if (c.pos.y <= gy) {
          c.pos.y = gy;
          if (c.vel.y < -3) {
            c.vel.y *= -0.42;
            c.vel.x *= 0.7;
            c.vel.z *= 0.7;
          } else {
            c.vel.y = 0;
            c.grounded = true;
          }
        } else if (c.grounded) c.pos.y = gy;
      }
      if (c.delay > 0) continue;
      for (let k = 0; k < karts.length; k++) {
        const kart = karts[k];
        if (kart.respawnTime > 0) continue;
        if (kart === c.from && c.age < 1.1) continue;
        const dx = kart.position.x - c.pos.x;
        const dz = kart.position.z - c.pos.z;
        const r = 0.6 + (kart.radius ?? 1.3);
        if (dx * dx + dz * dz > r * r) continue;
        if (Math.abs(kart.position.y + 0.6 - c.pos.y) > 2.5) continue;
        c.alive = false;
        onPickup(kart, c.pos);
        break;
      }
    }
  }

  updateVisual(dt, alpha, time) {
    const mesh = this.mesh;
    let idx = 0;
    for (let i = 0; i < this.coins.length; i++, idx++) {
      const c = this.coins[i];
      if (!c.active) {
        mesh.setMatrixAt(idx, ZERO);
        continue;
      }
      const t = time + c.phase;
      const s = c.grow < 1 ? Math.max(0.0001, backOut(c.grow)) : 1;
      _p.copy(c.position);
      _p.y += Math.sin(t * 2.6) * 0.1;
      _e.set(0, t * 2.8, 0);
      _q.setFromEuler(_e);
      _s.setScalar(s);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(idx, _m);
    }
    for (let i = 0; i < this.loose.length; i++, idx++) {
      const c = this.loose[i];
      if (!c.alive) {
        mesh.setMatrixAt(idx, ZERO);
        continue;
      }
      const blink = c.age > LOOSE_LIFE - 2 && Math.sin(c.age * 30) < 0;
      if (blink) {
        mesh.setMatrixAt(idx, ZERO);
        continue;
      }
      _p.lerpVectors(c.prev, c.pos, alpha);
      _e.set(0, time * 7 + c.phase, 0);
      _q.setFromEuler(_e);
      _s.setScalar(0.85 * Math.min(1, c.age * 6));
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(idx, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Remove every loose coin (restart / debug). */
  clearLoose() {
    for (const c of this.loose) c.alive = false;
  }

  looseCount() {
    let n = 0;
    for (const c of this.loose) if (c.alive) n++;
    return n;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose?.();
  }
}
