// Item boxes: floating, spinning translucent rainbow cubes with a "?" and a little halo (owner: items agent).
// All boxes of a track are drawn with 5 InstancedMeshes (back shell, "?" billboard, front shell, halo, shadow).
import * as THREE from 'three';

const RESPAWN = 2.5;
const GROW = 0.55;
const PICK_R = 1.05; // + kart radius
const CENTER_H = 1.35; // box centre above the road

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function elasticOut(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -9 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
}

export class ItemBoxField {
  constructor(sys, spots = []) {
    this.sys = sys;
    const path = sys.path;
    this.boxes = spots.map((s, i) => {
      const pos = s.position?.clone ? s.position.clone() : new THREE.Vector3(s.position?.x || 0, s.position?.y || 0, s.position?.z || 0);
      const pr = path.project(pos, null, {});
      const ground = pr.groundY;
      const center = pos.clone();
      center.y = ground + CENTER_H;
      return {
        index: i,
        position: center, // public: box centre
        ground,
        up: pr.frame.up.clone(),
        d: s.d ?? pr.d,
        lateral: s.lateral ?? pr.lateral,
        projIndex: pr.index,
        active: true,
        timer: 0,
        grow: 1,
        phase: i * 0.77 + (s.d || 0) * 0.013,
      };
    });
    const n = Math.max(1, this.boxes.length);
    const M = sys.models;
    const mk = (geo, mat, order) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = this.boxes.length;
      m.renderOrder = order;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      sys.scene.add(m);
      return m;
    };
    this.shadow = mk(M.geos.shadow, M.shadowMat, 0);
    this.back = mk(M.geos.boxShell, M.shellBack, 1);
    this.q = mk(M.geos.qmark, M.qmat, 2);
    this.front = mk(M.geos.boxShell, M.shellFront, 3);
    this.halo = mk(M.geos.halo, M.haloMat, 0);
    this.halo.castShadow = false;
    this.meshes = [this.shadow, this.back, this.q, this.front, this.halo];
    this.visible = true;
  }

  setVisible(v) {
    this.visible = v;
    for (const m of this.meshes) m.visible = v;
  }

  /** Fixed step: respawn timers + pickups. Calls onPickup(kart, box) for each pickup. */
  update(dt, karts, onPickup) {
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!b.active) {
        b.timer -= dt;
        if (b.timer <= 0) {
          b.active = true;
          b.grow = 0;
        }
        continue;
      }
      if (b.grow < 1) b.grow = Math.min(1, b.grow + dt / GROW);
      if (b.grow < 0.35) continue; // not collectable while popping in
      for (let k = 0; k < karts.length; k++) {
        const kart = karts[k];
        if (kart.respawnTime > 0) continue;
        const dx = kart.position.x - b.position.x;
        const dz = kart.position.z - b.position.z;
        const r = PICK_R + (kart.radius ?? 1.3);
        if (dx * dx + dz * dz > r * r) continue;
        const dy = kart.position.y - b.ground;
        if (dy < -1.5 || dy > 3.2) continue;
        b.active = false;
        b.timer = RESPAWN;
        onPickup(kart, b);
        break;
      }
    }
  }

  updateVisual(dt, time) {
    if (!this.visible) return;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!b.active) {
        this.back.setMatrixAt(i, ZERO);
        this.front.setMatrixAt(i, ZERO);
        this.q.setMatrixAt(i, ZERO);
        this.halo.setMatrixAt(i, ZERO);
        this.shadow.setMatrixAt(i, ZERO);
        continue;
      }
      const t = time + b.phase;
      const s = elasticOut(b.grow);
      const bob = Math.sin(t * 2.1) * 0.13;
      // shell: tumbling spin around a tilted axis
      _e.set(0.52 + Math.sin(t * 0.9) * 0.1, t * 1.25, 0.42, 'YXZ');
      _q.setFromEuler(_e);
      _p.copy(b.position);
      _p.y += bob;
      _s.setScalar(Math.max(0.0001, s));
      _m.compose(_p, _q, _s);
      this.back.setMatrixAt(i, _m);
      this.front.setMatrixAt(i, _m);
      // "?" billboard (shader faces the camera; only position + scale matter)
      _q2.identity();
      _s.setScalar(Math.max(0.0001, s * (1 + Math.sin(t * 4) * 0.04)));
      _m.compose(_p, _q2, _s);
      this.q.setMatrixAt(i, _m);
      // halo ring above
      _p.y += 1.2 + Math.sin(t * 2.1 + 0.6) * 0.06;
      _e.set(0.22 * Math.sin(t * 1.3), t * 1.8, 0.18, 'YXZ');
      _q.setFromEuler(_e);
      _s.setScalar(Math.max(0.0001, s));
      _m.compose(_p, _q, _s);
      this.halo.setMatrixAt(i, _m);
      // blob shadow on the road (aligned to the road normal)
      _p.copy(b.position);
      _p.y = b.ground + 0.03;
      _q.setFromUnitVectors(_up, b.up);
      const ss = s * (1.9 - bob * 0.8);
      _s.set(ss, 1, ss);
      _m.compose(_p, _q, _s);
      this.shadow.setMatrixAt(i, _m);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.dispose?.();
    }
  }
}
