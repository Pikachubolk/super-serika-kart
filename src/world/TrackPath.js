// TrackPath: the pure-math description of a race track (no rendering).
//
// Built from a track definition (see src/data/tracks/*.js and ARCHITECTURE.md §Track definition).
// Used by kart physics (ground height, walls, off-road), AI (racing line), race logic (progress / laps),
// item system (placement), the minimap and the Node validation tool. Importable from Node.
//
// Conventions (IMPORTANT, shared by the whole codebase):
//   * Y is up. Tracks lie roughly on the XZ plane.
//   * yaw: forward direction = (sin(yaw), 0, cos(yaw)). object3d.rotation.y = yaw makes a +Z-facing model face forward.
//   * right vector for a yaw = (-cos(yaw), 0, sin(yaw)).  A RIGHT turn DECREASES yaw.
//   * lateral: signed offset from the centerline along the (banked) right vector. + = right side of the road
//     (relative to the racing direction).
//   * d: distance along the centerline from the start/finish line, wrapped to [0, length).
//   * curvature: + = the road bends to the right (1/radius).

import * as THREE from 'three';
import { clamp, lerp, mod, wrapAngle } from '../core/utils.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEFAULTS = {
  width: 20, // full road width
  offroad: 7, // off-road strip width on each side (beyond the road edge)
  wall: true, // solid wall beyond the off-road strip (false = void / fall off)
  bank: 0, // degrees, + = road tilts down to the right (use for right-hand turns)
};

export const yawFromDir = (x, z) => Math.atan2(x, z);
export const dirFromYaw = (yaw, out = new THREE.Vector3()) => out.set(Math.sin(yaw), 0, Math.cos(yaw));
export const rightFromYaw = (yaw, out = new THREE.Vector3()) => out.set(-Math.cos(yaw), 0, Math.sin(yaw));

/** Interpolate per-point scalar attributes with a smooth (cosine) ease between control points. */
function easeAttr(a, b, u) {
  const s = (1 - Math.cos(Math.PI * u)) * 0.5;
  return a + (b - a) * s;
}

export class TrackPath {
  /**
   * @param {object} def track definition ({ points, width, offroad, wall, closed=true, features, ... })
   * @param {object} [opts] { spacing: sample spacing in world units (default 1) }
   */
  constructor(def, opts = {}) {
    if (!def || !Array.isArray(def.points) || def.points.length < 4) {
      throw new Error(`TrackPath: track "${def?.id}" needs at least 4 control points`);
    }
    this.def = def;
    this.id = def.id;
    this.closed = def.closed !== false;
    this.spacing = opts.spacing ?? 1;
    this.defaults = {
      width: def.width ?? DEFAULTS.width,
      offroad: def.offroad ?? DEFAULTS.offroad,
      wall: def.wall ?? DEFAULTS.wall,
      bank: def.bank ?? DEFAULTS.bank,
    };
    this._build();
    this._buildZones();
  }

  // ---------------------------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------------------------

  _pointAttrs(p) {
    const D = this.defaults;
    const w = p.w ?? p.width ?? D.width;
    const off = p.off ?? p.offroad ?? D.offroad;
    const wall = p.wall ?? D.wall;
    return {
      halfWidth: w / 2,
      offL: p.offL ?? off,
      offR: p.offR ?? off,
      wallL: (p.wallL ?? wall) ? 1 : 0,
      wallR: (p.wallR ?? wall) ? 1 : 0,
      bank: p.bank ?? D.bank,
    };
  }

  _build() {
    const pts = this.def.points.map((p) => new THREE.Vector3(p.x, p.y ?? 0, p.z));
    const attrs = this.def.points.map((p) => this._pointAttrs(p));
    const n = pts.length;
    const curve = new THREE.CatmullRomCurve3(pts, this.closed, 'centripetal', 0.5);
    this.curve = curve;

    // 1) dense sampling by curve parameter so we can carry per-point attributes along
    const segs = this.closed ? n : n - 1;
    const perSeg = 48;
    const denseCount = segs * perSeg;
    const dense = [];
    let acc = 0;
    let prev = null;
    for (let k = 0; k <= denseCount; k++) {
      const t = k / denseCount;
      const p = curve.getPoint(Math.min(t, 1));
      if (prev) acc += p.distanceTo(prev);
      const segF = t * segs;
      const si = Math.min(Math.floor(segF), segs - 1);
      const u = segF - si;
      const a0 = attrs[si % n];
      const a1 = attrs[(si + 1) % n];
      dense.push({
        p,
        dist: acc,
        halfWidth: easeAttr(a0.halfWidth, a1.halfWidth, u),
        offL: easeAttr(a0.offL, a1.offL, u),
        offR: easeAttr(a0.offR, a1.offR, u),
        wallL: u < 0.5 ? a0.wallL : a1.wallL,
        wallR: u < 0.5 ? a0.wallR : a1.wallR,
        bank: easeAttr(a0.bank, a1.bank, u),
      });
      prev = p;
    }
    const total = acc;
    this.length = total;

    // 2) resample uniformly by arc length
    const count = Math.max(16, Math.round(total / this.spacing));
    const step = total / count;
    this.count = count;
    this.step = step;
    const samples = new Array(count);
    let j = 0;
    for (let i = 0; i < count; i++) {
      const target = i * step;
      while (j < dense.length - 2 && dense[j + 1].dist < target) j++;
      const a = dense[j];
      const b = dense[j + 1];
      const span = b.dist - a.dist || 1e-6;
      const u = clamp((target - a.dist) / span, 0, 1);
      samples[i] = {
        index: i,
        d: target,
        pos: new THREE.Vector3().lerpVectors(a.p, b.p, u),
        halfWidth: lerp(a.halfWidth, b.halfWidth, u),
        offL: lerp(a.offL, b.offL, u),
        offR: lerp(a.offR, b.offR, u),
        wallL: u < 0.5 ? a.wallL : b.wallL,
        wallR: u < 0.5 ? a.wallR : b.wallR,
        bankDeg: lerp(a.bank, b.bank, u),
        tan: new THREE.Vector3(),
        right: new THREE.Vector3(), // banked right vector (unit)
        rightH: new THREE.Vector3(), // horizontal right vector (unit)
        up: new THREE.Vector3(), // road surface normal
        yaw: 0,
        curvature: 0,
        slope: 0, // ground rise per unit of +lateral (from banking)
      };
    }
    this.samples = samples;

    // 3) frames
    for (let i = 0; i < count; i++) {
      const s = samples[i];
      const a = samples[this._wrapIndex(i - 1)].pos;
      const b = samples[this._wrapIndex(i + 1)].pos;
      if (!this.closed && i === 0) s.tan.subVectors(samples[1].pos, s.pos);
      else if (!this.closed && i === count - 1) s.tan.subVectors(s.pos, samples[i - 1].pos);
      else s.tan.subVectors(b, a);
      s.tan.normalize();
      s.rightH.crossVectors(s.tan, WORLD_UP);
      s.rightH.y = 0;
      if (s.rightH.lengthSq() < 1e-8) s.rightH.set(1, 0, 0);
      s.rightH.normalize();
      const bank = (s.bankDeg * Math.PI) / 180;
      s.right.copy(s.rightH).multiplyScalar(Math.cos(bank));
      s.right.y -= Math.sin(bank);
      s.right.normalize();
      s.up.crossVectors(s.right, s.tan).normalize();
      if (s.up.y < 0) s.up.negate();
      s.slope = -Math.tan(bank);
      s.yaw = Math.atan2(s.tan.x, s.tan.z);
    }
    // 4) curvature (+ = right turn). Right turn decreases yaw.
    for (let i = 0; i < count; i++) {
      const a = samples[this._wrapIndex(i - 2)];
      const b = samples[this._wrapIndex(i + 2)];
      const dyaw = wrapAngle(b.yaw - a.yaw);
      samples[i].curvature = -dyaw / (4 * step);
    }

    // bounds (for minimap etc.)
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const s of samples) {
      const ext = s.halfWidth + Math.max(s.offL, s.offR);
      min.x = Math.min(min.x, s.pos.x - ext);
      min.z = Math.min(min.z, s.pos.z - ext);
      min.y = Math.min(min.y, s.pos.y);
      max.x = Math.max(max.x, s.pos.x + ext);
      max.z = Math.max(max.z, s.pos.z + ext);
      max.y = Math.max(max.y, s.pos.y);
    }
    this.bounds = { min, max };
  }

  /** Resolve a feature's position along the track to a distance d. Accepts {d} or {t in [0,1)}. */
  resolveD(f) {
    if (typeof f.d === 'number') return mod(f.d, this.length);
    if (typeof f.t === 'number') return mod(f.t * this.length, this.length);
    return 0;
  }

  _buildZones() {
    this.zones = [];
    for (const f of this.def.features || []) {
      if (f.type !== 'boost' && f.type !== 'ramp' && f.type !== 'slow' && f.type !== 'hazardZone') continue;
      const d = this.resolveD(f);
      const len = f.length ?? (f.type === 'ramp' ? 10 : 8);
      const frame = this.frameAt(d);
      const width = f.width ?? (f.type === 'ramp' ? frame.halfWidth * 2 : 5);
      const lat = f.lateral ?? 0;
      this.zones.push({
        type: f.type,
        feature: f,
        d0: d - len / 2,
        d1: d + len / 2,
        lat0: lat - width / 2,
        lat1: lat + width / 2,
        power: f.power ?? 1,
      });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------------

  _wrapIndex(i) {
    if (this.closed) return mod(i, this.count);
    return clamp(i, 0, this.count - 1);
  }

  /** Wrap a distance into [0, length). */
  wrapD(d) {
    return this.closed ? mod(d, this.length) : clamp(d, 0, this.length);
  }

  /** Signed shortest delta (dNew - dOld) along a closed loop, in (-length/2, length/2]. */
  deltaD(dNew, dOld) {
    let dd = dNew - dOld;
    if (!this.closed) return dd;
    const L = this.length;
    if (dd > L / 2) dd -= L;
    else if (dd < -L / 2) dd += L;
    return dd;
  }

  /** Nearest sample to distance d (no interpolation). */
  sampleAt(d) {
    return this.samples[this._wrapIndex(Math.round(this.wrapD(d) / this.step))];
  }

  /**
   * Interpolated frame at distance d.
   * Returns a NEW object { d, pos, tan, right, rightH, up, yaw, halfWidth, offL, offR, wallL, wallR, curvature, slope, index }.
   * Pass `out` to reuse an object and avoid allocations in hot loops.
   */
  frameAt(d, out) {
    d = this.wrapD(d);
    const f = d / this.step;
    const i0 = Math.floor(f);
    const u = f - i0;
    const a = this.samples[this._wrapIndex(i0)];
    const b = this.samples[this._wrapIndex(i0 + 1)];
    out = out || {
      pos: new THREE.Vector3(),
      tan: new THREE.Vector3(),
      right: new THREE.Vector3(),
      rightH: new THREE.Vector3(),
      up: new THREE.Vector3(),
    };
    out.d = d;
    out.index = a.index;
    out.u = u;
    out.pos.lerpVectors(a.pos, b.pos, u);
    out.tan.lerpVectors(a.tan, b.tan, u).normalize();
    out.right.lerpVectors(a.right, b.right, u).normalize();
    out.rightH.lerpVectors(a.rightH, b.rightH, u).normalize();
    out.up.lerpVectors(a.up, b.up, u).normalize();
    out.yaw = Math.atan2(out.tan.x, out.tan.z);
    out.halfWidth = lerp(a.halfWidth, b.halfWidth, u);
    out.offL = lerp(a.offL, b.offL, u);
    out.offR = lerp(a.offR, b.offR, u);
    out.wallL = u < 0.5 ? a.wallL : b.wallL;
    out.wallR = u < 0.5 ? a.wallR : b.wallR;
    out.curvature = lerp(a.curvature, b.curvature, u);
    out.slope = lerp(a.slope, b.slope, u);
    return out;
  }

  /** World position on the road surface at distance d and lateral offset (+ = right). */
  pointAt(d, lateral = 0, out = new THREE.Vector3()) {
    const f = this.frameAt(d);
    return out.copy(f.pos).addScaledVector(f.right, lateral);
  }

  /** Signed curvature (1/radius, + = right turn) averaged over [d, d+ahead]. */
  curvatureAhead(d, ahead = 20, stepSize = 4) {
    let sum = 0;
    let n = 0;
    for (let x = 0; x <= ahead; x += stepSize) {
      sum += this.sampleAt(d + x).curvature;
      n++;
    }
    return sum / Math.max(1, n);
  }

  /**
   * Project a world position onto the track.
   * @param {THREE.Vector3} pos
   * @param {number|null} hint previous sample index (pass the last result's .index). null/undefined = global search.
   * @returns {{index:number,d:number,lateral:number,groundY:number,height:number,frame:object,
   *            surface:'road'|'offroad'|'wall'|'void', side:-1|1, edgeDist:number, limit:number,
   *            zone:object|null}}
   *   - lateral: signed offset (+ right) measured horizontally
   *   - groundY: road-surface height at this lateral (banking applied). Beyond the road edge the off-road
   *              continues the road plane.
   *   - height: pos.y - groundY
   *   - surface: 'road' within the road, 'offroad' in the off-road strip, beyond that 'wall' (if a wall exists
   *              on that side) or 'void' (no wall: the kart should fall and respawn)
   *   - limit: the |lateral| at which the wall / void begins on the relevant side
   *   - zone: boost / ramp / slow zone the position is inside (or null)
   */
  project(pos, hint = null, out = {}) {
    const N = this.count;
    let best = -1;
    let bestScore = Infinity;
    const scan = (i) => {
      const s = this.samples[i];
      const dx = pos.x - s.pos.x;
      const dz = pos.z - s.pos.z;
      const dy = pos.y - s.pos.y;
      // Vertical distance is weighted so overpasses / bridges resolve to the correct layer.
      const score = dx * dx + dz * dz + dy * dy * 4;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    };
    if (hint === null || hint === undefined || hint < 0 || hint >= N) {
      for (let i = 0; i < N; i++) scan(i);
    } else {
      const W = 40;
      for (let k = -W; k <= W; k++) scan(this._wrapIndex(hint + k));
      // Fallback to a global search if we are clearly lost (teleport, respawn...)
      const s = this.samples[best];
      const hw = s.halfWidth + Math.max(s.offL, s.offR) + 30;
      if (bestScore > hw * hw) {
        bestScore = Infinity;
        for (let i = 0; i < N; i++) scan(i);
      }
    }

    // refine between best-1..best+1 by projecting onto the tangent
    const s = this.samples[best];
    const along = (pos.x - s.pos.x) * s.tan.x + (pos.z - s.pos.z) * s.tan.z;
    const tanH2 = s.tan.x * s.tan.x + s.tan.z * s.tan.z || 1;
    let d = s.d + along / tanH2;
    if (!this.closed) d = clamp(d, 0, this.length);
    const frame = this.frameAt(d, out.frame);
    const dx = pos.x - frame.pos.x;
    const dz = pos.z - frame.pos.z;
    const lateral = dx * frame.rightH.x + dz * frame.rightH.z;
    const groundY = frame.pos.y + lateral * frame.slope;
    const side = lateral >= 0 ? 1 : -1;
    const off = side > 0 ? frame.offR : frame.offL;
    const wall = side > 0 ? frame.wallR : frame.wallL;
    const absLat = Math.abs(lateral);
    const limit = frame.halfWidth + off;
    let surface;
    if (absLat <= frame.halfWidth) surface = 'road';
    else if (absLat <= limit) surface = 'offroad';
    else surface = wall ? 'wall' : 'void';

    out.index = frame.index;
    out.d = frame.d;
    out.lateral = lateral;
    out.groundY = groundY;
    out.height = pos.y - groundY;
    out.frame = frame;
    out.surface = surface;
    out.side = side;
    out.limit = limit;
    out.edgeDist = limit - absLat; // distance to wall/void boundary (negative = beyond)
    out.zone = this.zoneAt(frame.d, lateral);
    return out;
  }

  /** Returns the boost/ramp/slow zone containing (d, lateral), or null. */
  zoneAt(d, lateral) {
    for (const z of this.zones) {
      const dd = this.deltaD(d, (z.d0 + z.d1) / 2);
      const half = (z.d1 - z.d0) / 2;
      if (dd >= -half && dd <= half && lateral >= z.lat0 && lateral <= z.lat1) return z;
    }
    return null;
  }

  /**
   * Starting grid (MK style staggered 2-wide grid behind the start line).
   * slot 0 = pole position (front). Returns { position: Vector3, yaw, d, lateral }.
   */
  gridSlot(slot, total = 8) {
    const f0 = this.frameAt(0);
    const colOffset = Math.min(f0.halfWidth * 0.45, 5);
    const row = slot;
    const lateral = (slot % 2 === 0 ? -1 : 1) * colOffset;
    const back = 6 + row * 4.2;
    const d = this.wrapD(-back);
    const f = this.frameAt(d);
    const position = f.pos.clone().addScaledVector(f.right, lateral);
    return { position, yaw: f.yaw, d, lateral };
  }

  /** 2D outline for minimaps: [{x, z}] of the centerline every `every` samples. */
  outline2D(every = 4) {
    const out = [];
    for (let i = 0; i < this.count; i += every) {
      const s = this.samples[i];
      out.push({ x: s.pos.x, z: s.pos.z, y: s.pos.y, halfWidth: s.halfWidth });
    }
    return out;
  }
}

export default TrackPath;
