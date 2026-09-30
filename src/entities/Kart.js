// Kart (owner: physics agent) — arcade kart physics for one racer (player or AI), Mario-Kart-8 style.
//
// API CONTRACT: ARCHITECTURE.md §7. Everything documented there exists here with the same names.
//   new Kart({ id, index, character, track, isPlayer, engine, quality? })
//   kart.reset(gridSlot) / setControls(controls) / update(dt, world) / updateVisual(dt, alpha)
//   effects: applyBoost, spinOut, launch, shrink, setInvincible, addCoins, loseCoins, respawn, onRaceStart
//   helpers: getRearPosition(dist, out), getFrontPosition(dist, out), isVulnerable(), isStunned(), dispose()
//   export function resolveKartCollisions(karts, world)
//   export function resolveHazardCollisions(karts, hazards, world)
//
// Model: the kart keeps a horizontal velocity vector (`_vh`) plus a vertical speed (`vy`). Every fixed step
// (120 Hz) the heading (`yaw`) turns from steering/drifting, the velocity is rotated along with it (grip),
// then split into a forward part (engine / brakes / boosts) and a lateral part (slides away with traction).
// `speed` = signed forward speed. External writes to `kart.speed` are honoured on the next step.
// Ground following uses TrackPath.project(): the kart sticks to the road unless the ground falls away faster
// than gravity (crests, ramp lips), lands when it comes back down, and falls into the void beyond wall-less
// edges. Visuals are interpolated between physics steps in updateVisual().
//
// Additions beyond the contract (all optional for other modules):
//   kart.maxSpeed (current effective top speed), kart.surface ('road'|'offroad'|'slow'|'air'|'void'),
//   kart.graceTime (post-respawn blink immunity), kart.stallTime, kart.squishTime, kart.trickTime,
//   kart.incoming (items write), kart.impactSeq / kart.impactStrength (camera shake feed),
//   kart.isFalling, kart.speedRatio, kart.addImpulse(x, y, z), KART_TUNING (exported numbers),
//   rampSurfaceHeight(zone) (exported: wedge top height the kart rides up to; see report).

import * as THREE from 'three';
import { createRacerModel } from './RacerModel.js';
import { dirFromYaw, rightFromYaw } from '../world/TrackPath.js';
import { clamp, clamp01, damp, lerp, smoothstep, approach, angleDiff, TAU } from '../core/utils.js';
import { MAX_CREDITS, CREDIT_SPEED_BONUS, ENGINE_CLASSES } from '../data/engine.js';

// ---------------------------------------------------------------------------------------------------------
// Tuning (all speeds in u/s, times in s). 150cc base top speed = 36.
// ---------------------------------------------------------------------------------------------------------
export const KART_TUNING = {
  gravity: 25,
  maxFallSpeed: 55,
  // engine
  statSpeed: 0.05, // top speed ±5 % per stat point around 3  (1..5 → -10 %..+10 %)
  t90Base: 2.55, // seconds from 0 to 90 % top speed at accel 3
  t90PerAccel: 0.4, // accel 5 → 1.75 s, accel 1 → 3.35 s
  t90PerWeight: 0.05,
  accelExp: 0.6, // a(r) = A·(1-r)^0.6  (finite time to top speed, MK-like tail)
  brakeDecel: 40,
  coastDecel: 5,
  coastDrag: 0.12,
  overMaxDecel: 11, // bleeding off speed above the current max (after boosts)
  offroadDecel: 30,
  reverseMax: 0.32,
  reverseAccel: 16,
  slopeAccel: 0.3,
  maxSpeedCap: 1.9, // hard safety cap × topSpeed
  // boosts
  boostPower: 0.35, // strength 1 → +35 % top speed
  boostAccel: 58,
  boostKick: 3.5,
  // steering
  steerRate: 2.2, // rad/s at mid speed (handling 3)
  pivotSpeed: 2.6, // steering authority at standstill with throttle held (as if moving at this speed)
  steerHighSpeedLoss: 0.3,
  handlingPerStat: 0.1, // ±20 % across the stat range
  steerSmoothUp: 7.5, // keyboard → analog smoothing (units/s)
  steerSmoothDown: 13,
  airSteer: 0.35,
  hopSteer: 0.3, // steering authority during the drift hop
  // drifting
  driftMinSpeedFrac: 0.4,
  driftKeepSpeedFrac: 0.3,
  driftBaseRate: 0.78, // rad/s with neutral steering (radius ≈ 40 at 36 u/s)
  driftWide: 0.3, // × base when counter-steering fully (long sweepers)
  driftTight: 2.25, // × base when steering fully into the drift (hairpins)
  driftChargeIn: 0.5, // charge rate bonus when steering into the drift
  driftChargeOut: 0.25, // charge rate penalty when counter-steering
  driftArmTime: 0.16, // grace after the hop lands to pick a drift direction
  driftLevels: [0.75, 1.5, 2.3],
  driftBoost: [0.5, 1.0, 1.6],
  driftBoostStrength: [0.75, 0.85, 1.0],
  hopVy: 3.6,
  // grip
  latGrip: 12,
  driftLatGrip: 6,
  driftFollow: 0.9,
  // surfaces / features
  offroadMul: 0.5,
  offroadTraction: 0.05, // +5 % per traction point above 3 (5 → 0.6)
  dashDuration: 1.2,
  rampVy: 9,
  rampHeight: 0.55, // fallback wedge lip height = rampHeight + rampHeightPerPower·power (world's formula)
  rampHeightPerPower: 0.35,
  rampProfileExp: 1.35,
  trickWindow: 0.4,
  trickAirMin: 0.25,
  trickBoost: 0.8,
  trickAnim: 0.5,
  // walls & falls
  wallRestitution: 0.3,
  wallSpeedMul: 0.75,
  wallMargin: 0.85,
  voidDepth: 8,
  corridorRespawn: 30,
  respawnDuration: 1.6,
  respawnGrace: 1.0,
  // status effects
  spinDuration: 1.1,
  launchDuration: 1.5,
  launchVy: 12,
  shrinkScale: 0.55,
  shrinkSpeed: 0.8,
  squishDuration: 2,
  haloSpeed: 1.2,
  haloAccel: 1.5,
  // start
  rocketWindow: [0.7, 1.4],
  rocketBoost: 1.0,
  stallEarly: 2.3,
  stallTime: 0.8,
  // misc
  wrongWayDot: -0.3,
  wrongWaySpeed: 4,
  bumpRestitution: 0.35,
  bumpMin: 3.2,
};
const T = KART_TUNING;

const NO_CONTROLS = Object.freeze({
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  driftPressed: false,
  item: false,
  itemPressed: false,
  lookBack: false,
});

const DRIFT_FX = [
  { color: '#dfe6ee', color2: '#ffffff' }, // charging (no level yet) — pale smoke
  { color: '#2fb4ff', color2: '#d4f3ff' }, // blue
  { color: '#ff8c12', color2: '#ffe066' }, // orange
  { color: '#b44dff', color2: '#ff9cf2' }, // purple / ultra
];
const FLAME_FX = {
  normal: { color: '#ffc23a', color2: '#ff4a1c' },
  blue: { color: '#7fd8ff', color2: '#2a6bff' },
  orange: { color: '#ffc23a', color2: '#ff4a1c' },
  purple: { color: '#e08bff', color2: '#7a2cff' },
  gold: { color: '#fff08a', color2: '#ffb300' },
};
const LEVEL_FLAME = [FLAME_FX.normal, FLAME_FX.blue, FLAME_FX.orange, FLAME_FX.purple];
const SPARK_SFX = [null, 'sparkBlue', 'sparkOrange', 'sparkPurple'];

/**
 * Height of a ramp wedge's lip (fallback when the track has no rampHeightAt()). Matches the world's wedge
 * (src/world/Features.js: H = 0.55 + 0.35·power, profile t^1.35).
 */
export function rampSurfaceHeight(zone) {
  const f = zone?.feature;
  if (f && typeof f.height === 'number') return f.height;
  return T.rampHeight + T.rampHeightPerPower * (zone?.power ?? 1);
}

/** Wedge surface height above the road at (d, lateral) for a kart inside ramp `zone` at along-fraction u. */
function rampHeightAt(track, zone, d, lateral, u) {
  if (track && typeof track.rampHeightAt === 'function') {
    const h = track.rampHeightAt(d, lateral);
    if (Number.isFinite(h)) return h;
  }
  return rampSurfaceHeight(zone) * Math.pow(clamp01(u), T.rampProfileExp);
}

// ---------------------------------------------------------------------------------------------------------
// scratch objects (module level → no per-step allocations)
// ---------------------------------------------------------------------------------------------------------
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _fxOpts = { count: 1, color: '#ffffff', color2: '#ffffff', velocity: new THREE.Vector3(), spread: 1, size: 0.3, life: 0.5 };
const _sfxOpts = { volume: 1, pitch: 1 };
const _frameTmp = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), rightH: new THREE.Vector3(), up: new THREE.Vector3() };

const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const dec = (v, dt) => (v > 0 ? Math.max(0, v - dt) : 0);
const easeInOut = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
};

// ---------------------------------------------------------------------------------------------------------
// Rescue drone (shared geometry + materials, built lazily once)
// ---------------------------------------------------------------------------------------------------------
let DRONE_ASSETS = null;
function droneAssets() {
  if (DRONE_ASSETS) return DRONE_ASSETS;
  const toon = (color, opts = {}) => new THREE.MeshToonMaterial({ color, ...opts });
  DRONE_ASSETS = {
    white: toon('#f4f8ff'),
    cyan: toon('#27c2f2', { emissive: '#0a4a66', emissiveIntensity: 0.35 }),
    dark: toon('#1b2440'),
    pink: toon('#ff7fb5', { emissive: '#ff3d8b', emissiveIntensity: 0.4 }),
    glow: new THREE.MeshBasicMaterial({ color: '#8ff4ff' }),
    haloMat: new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.95 }),
    disc: new THREE.MeshBasicMaterial({ color: '#dff6ff', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    cable: toon('#3a4256'),
    body: new THREE.SphereGeometry(0.5, 20, 14),
    band: new THREE.TorusGeometry(0.52, 0.065, 8, 28),
    screen: new THREE.SphereGeometry(0.36, 18, 12),
    eye: new THREE.CapsuleGeometry(0.055, 0.09, 4, 8),
    arm: new THREE.BoxGeometry(2.1, 0.08, 0.13),
    hub: new THREE.CylinderGeometry(0.09, 0.11, 0.14, 12),
    blade: new THREE.BoxGeometry(0.78, 0.018, 0.09),
    discGeo: new THREE.CircleGeometry(0.42, 24),
    halo: new THREE.TorusGeometry(0.3, 0.035, 8, 32),
    stick: new THREE.CylinderGeometry(0.018, 0.018, 0.32, 6),
    tip: new THREE.SphereGeometry(0.07, 10, 8),
    cableGeo: new THREE.CylinderGeometry(0.028, 0.028, 1, 6),
    hook: new THREE.TorusGeometry(0.12, 0.03, 6, 14, Math.PI * 1.4),
  };
  return DRONE_ASSETS;
}

function createDrone() {
  const A = droneAssets();
  const g = new THREE.Group();
  g.name = 'rescueDrone';
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  add(A.body, A.white, 0, 0, 0, 1.15, 0.72, 1.0);
  const band = add(A.band, A.cyan, 0, -0.02, 0, 1.12, 1, 0.98);
  band.rotation.x = Math.PI / 2;
  add(A.screen, A.dark, 0, 0.04, 0.3, 1.05, 0.66, 0.5);
  const eyeL = add(A.eye, A.glow, -0.13, 0.06, 0.47);
  const eyeR = add(A.eye, A.glow, 0.13, 0.06, 0.47);
  eyeL.castShadow = eyeR.castShadow = false;
  const a1 = add(A.arm, A.white, 0, 0.16, 0);
  a1.rotation.y = Math.PI / 4;
  const a2 = add(A.arm, A.white, 0, 0.16, 0);
  a2.rotation.y = -Math.PI / 4;
  const rotors = [];
  const R = 0.74;
  for (let i = 0; i < 4; i++) {
    const x = (i & 1 ? 1 : -1) * R;
    const z = (i & 2 ? 1 : -1) * R;
    add(A.hub, A.cyan, x, 0.23, z);
    const rotor = new THREE.Group();
    rotor.position.set(x, 0.31, z);
    const b1 = new THREE.Mesh(A.blade, A.white);
    const b2 = new THREE.Mesh(A.blade, A.white);
    b2.rotation.y = Math.PI / 2;
    const disc = new THREE.Mesh(A.discGeo, A.disc);
    disc.rotation.x = -Math.PI / 2;
    rotor.add(b1, b2, disc);
    g.add(rotor);
    rotors.push(rotor);
  }
  const halo = add(A.halo, A.haloMat, 0, 0.66, -0.04);
  halo.rotation.x = Math.PI / 2 - 0.25;
  halo.castShadow = false;
  const stick = add(A.stick, A.dark, 0.18, 0.46, -0.12);
  stick.rotation.z = -0.35;
  add(A.tip, A.pink, 0.24, 0.62, -0.12);
  const cables = [];
  for (let i = 0; i < 2; i++) {
    const c = new THREE.Mesh(A.cableGeo, A.cable);
    c.position.set(i ? 0.22 : -0.22, -0.3, 0);
    g.add(c);
    cables.push(c);
  }
  const hook = add(A.hook, A.dark, 0, -0.42, 0);
  hook.rotation.z = Math.PI * 0.8;
  g.visible = false;
  return { group: g, rotors, cables, hook, halo };
}

/** Very small stand-in model used only if the real RacerModel fails to build (keeps the race alive). */
function fallbackRacer(character) {
  const root = new THREE.Group();
  const kart = new THREE.Group();
  const driver = new THREE.Group();
  root.add(kart, driver);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.2), new THREE.MeshLambertMaterial({ color: character?.kart?.body || '#e33' }));
  body.position.y = 0.45;
  kart.add(body);
  const anchors = {};
  for (const [k, p] of Object.entries({
    exhaustL: [0.4, 0.5, -1.2],
    exhaustR: [-0.4, 0.5, -1.2],
    wheelFL: [0.7, 0.3, 0.75],
    wheelFR: [-0.7, 0.3, 0.75],
    wheelRL: [0.7, 0.3, -0.75],
    wheelRR: [-0.7, 0.3, -0.75],
    head: [0, 1.4, -0.2],
    rear: [0, 0.5, -1.4],
    front: [0, 0.5, 1.4],
  })) {
    const o = new THREE.Object3D();
    o.position.set(p[0], p[1], p[2]);
    root.add(o);
    anchors[k] = o;
  }
  return {
    root,
    kart,
    driver,
    anchors,
    update() {},
    dispose() {
      body.geometry.dispose();
      body.material.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Kart
// ---------------------------------------------------------------------------------------------------------
export class Kart {
  constructor({ id, index = 0, character, track, isPlayer = false, engine, quality = 'high', model = null }) {
    this.id = id ?? character.id;
    this.index = index;
    this.character = character;
    this.characterId = character.id;
    this.name = character.name;
    this.isPlayer = isPlayer;
    this.track = track;
    this.path = track.path;
    this.engine = engine || ENGINE_CLASSES[150];
    this.stats = { speed: 3, accel: 3, weight: 3, handling: 3, traction: 3, ...(character.stats || {}) };

    // --- visual
    let racer = model;
    if (!racer) {
      try {
        racer = createRacerModel(character, { quality });
      } catch (err) {
        console.error('[Kart] createRacerModel failed, using fallback model', err);
        racer = fallbackRacer(character);
      }
    }
    this.racer = racer;
    this.racer.root.rotation.order = 'YXZ';
    this.object3d = new THREE.Group();
    this.object3d.name = `kart:${this.id}`;
    this.object3d.add(this.racer.root);
    this._drone = null; // created on first respawn

    // --- kinematics
    this.position = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(-1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.yaw = 0;
    this.prevYaw = 0;
    this.visualYaw = 0; // interpolated heading (set by updateVisual; the camera follows this)
    this.speed = 0;
    this.vy = 0;
    this.grounded = true;
    this.airTime = 0;
    this.radius = 1.3;
    this.weight = this.stats.weight;
    this.topSpeed = this.engine.topSpeed * (1 + (this.stats.speed - 3) * T.statSpeed);
    this.topSpeedScale = 1; // AI rubber-band hook (AIDriver / Race)
    this.maxSpeed = this.topSpeed;
    this._vh = new THREE.Vector3(); // horizontal velocity
    this._speedOut = 0;
    this._groundVy = 0;
    this._prevGroundY = 0;

    // derived handling numbers
    const s = this.stats;
    this._t90 = Math.max(1.2, T.t90Base - (s.accel - 3) * T.t90PerAccel + (s.weight - 3) * T.t90PerWeight) / (this.engine.accelScale || 1);
    this._handling = 1 + (s.handling - 3) * T.handlingPerStat;
    this._traction = 1 + (s.traction - 3) * 0.05;
    this._offroadMul = T.offroadMul + Math.max(0, s.traction - 3) * T.offroadTraction;
    this._chargeMul = 1 + (s.accel - 3) * 0.05;
    this._mass = Math.pow(Math.max(1, s.weight), 1.3);
    // resolved theme (TrackBuilder: track.theme, every field filled) with the raw def theme as fallback
    const theme = track.theme || track.def?.theme || {};
    const rawGrip = track.theme?.grip ?? track.def?.theme?.grip;
    this._themeGrip = typeof rawGrip === 'number' && Number.isFinite(rawGrip) ? clamp(rawGrip, 0.3, 1.2) : 1;
    const offType = theme.offroad?.type;
    this._dustColor = (offType && offType !== 'none' && theme.offroad?.color) || theme.ground?.color || '#c9b089';
    this._voidType = theme.void?.type || track.def?.theme?.void?.type || 'abyss';

    this.controls = { ...NO_CONTROLS };
    this.proj = null;
    this.lastSafeD = 0;

    // --- race bookkeeping (written by Race)
    this.progress = 0;
    this.lap = 1;
    this.lapTimes = [];
    this.finished = false;
    this.finishTime = null;
    this.place = index + 1;

    // --- state
    this.drift = { active: false, dir: 0, charge: 0, level: 0, tight: 0.5, time: 0 };
    this.boostTime = 0;
    this.boostStrength = 0;
    this.boostDuration = 0;
    this.coins = 0;
    this.item = null;
    this.itemUses = 0;
    this.roulette = { active: false, time: 0, duration: 0, result: null };
    this.incoming = [];
    this.spinTime = 0;
    this.launchTime = 0;
    this.shrinkTime = 0;
    this.invincibleTime = 0;
    this.respawnTime = 0;
    this.respawnTarget = new THREE.Vector3(); // where the drone will put the kart (valid while respawnTime > 0)
    this.respawnYaw = 0;
    this.graceTime = 0;
    this.stallTime = 0;
    this.squishTime = 0;
    this.trickTime = 0;
    this.offroad = false;
    this.surface = 'road';
    this.wrongWayTime = 0;
    this.cardTime = 0;
    this.trickPending = false;
    this.impactSeq = 0;
    this.impactStrength = 0;
    this.time = 0;

    this._resetInternals();
    this._vstate = {
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
      // extras
      driftCharge: 0,
      offroad: false,
      grounded: true,
      respawning: false,
      speedRatio: 0,
      boostStrength: 0,
      braking: false,
      reversing: false,
      stalled: false,
    };
  }

  _resetInternals() {
    this._steer = 0;
    this._prevDriftHeld = false;
    this._lastDriftEdge = -10;
    this._driftArm = 0;
    this._hopping = false;
    this._hopDir = 0;
    this._rampZone = null;
    this._rampU = -1;
    this._rampH = 0;
    this._rampAir = false;
    this._trickDone = false;
    this._trickStyle = 0;
    this._boostPad = null;
    this._boostFx = FLAME_FX.normal;
    this._spinDuration = T.spinDuration;
    this._spinDir = 1;
    this._launchDuration = T.launchDuration;
    this._launchBounced = false;
    this._tumbleSide = 1;
    this._shrinkDuration = 0;
    this._wallCooldown = 0;
    this._bumpCooldown = 0;
    this._fallSfx = false;
    this._rocketHeld = false;
    this._rocketPressAt = null;
    this._cardSeen = 0;
    this._cardExternal = false;
    this._resp = null;
    this._droneOut = 0;
    this._droneRelease = new THREE.Vector3();
    this._droneReleaseYaw = 0;
    this._hazardCooldown = 0;
    // visuals
    this._visPos = this._visPos || new THREE.Vector3();
    this._visUp = (this._visUp || new THREE.Vector3()).set(0, 1, 0);
    this._driftVis = 0;
    this._squash = 0;
    this._squashV = 0;
    this._wheelie = 0;
    this._shrinkVis = 1;
    this._shrinkVel = 0;
    this._squishVis = 0;
    this._vtime = 0;
    this._fx = { drift: 0, driftR: 0, dust: 0, flame: 0, smoke: 0, halo: 0, skid: 0, rev: 0, respawn: 0 };
    this._wheelToggle = false;
  }

  // -------------------------------------------------------------------------------------------------
  // setup
  // -------------------------------------------------------------------------------------------------

  /** Place the kart on a grid slot ({ position, yaw, d }) and clear all dynamic state. */
  reset(slot) {
    this.position.copy(slot.position);
    this.prevPosition.copy(slot.position);
    this.yaw = slot.yaw ?? 0;
    this.prevYaw = this.yaw;
    this.speed = 0;
    this._speedOut = 0;
    this.vy = 0;
    this._vh.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.airTime = 0;
    this.drift.active = false;
    this.drift.dir = 0;
    this.drift.charge = 0;
    this.drift.level = 0;
    this.boostTime = this.boostStrength = this.boostDuration = 0;
    this.spinTime = this.launchTime = this.shrinkTime = this.invincibleTime = this.respawnTime = 0;
    this.graceTime = this.stallTime = this.squishTime = this.trickTime = 0;
    this.wrongWayTime = 0;
    this.trickPending = false;
    this.offroad = false;
    this.surface = 'road';
    this._resetInternals();
    this.proj = this.path.project(this.position, null, this.proj || {});
    this.position.y = this.proj.groundY;
    this.prevPosition.y = this.position.y;
    this._prevGroundY = this.position.y;
    this.lastSafeD = this.proj.d;
    dirFromYaw(this.yaw, this.forward);
    rightFromYaw(this.yaw, this.right);
    this.up.copy(this.proj.frame.up);
    this._visUp.copy(this.up);
    if (this._drone) this._drone.group.visible = false;
    this.racer.root.visible = true;
    this.updateVisual(0, 1);
  }

  /** Store the DriveControls for the next step (copied: callers may reuse their object). */
  setControls(c) {
    const src = c || NO_CONTROLS;
    const d = this.controls;
    d.throttle = +src.throttle || 0;
    d.brake = +src.brake || 0;
    d.steer = clamp(+src.steer || 0, -1, 1);
    d.drift = !!src.drift;
    d.driftPressed = !!src.driftPressed;
    d.item = !!src.item;
    d.itemPressed = !!src.itemPressed;
    d.lookBack = !!src.lookBack;
  }

  // -------------------------------------------------------------------------------------------------
  // queries
  // -------------------------------------------------------------------------------------------------

  isStunned() {
    return this.spinTime > 0 || this.launchTime > 0 || this.respawnTime > 0;
  }

  isVulnerable() {
    return this.invincibleTime <= 0 && this.respawnTime <= 0 && this.graceTime <= 0;
  }

  get isFalling() {
    return this.respawnTime <= 0 && !this.grounded && !!this.proj && this.proj.surface === 'void' && this.proj.height < -0.6;
  }

  get speedRatio() {
    return Math.abs(this.speed) / Math.max(1, this.topSpeed);
  }

  get airborne() {
    return !this.grounded;
  }

  getRearPosition(dist = 2.2, out = new THREE.Vector3()) {
    return out.copy(this.position).addScaledVector(this.forward, -dist);
  }

  getFrontPosition(dist = 2.2, out = new THREE.Vector3()) {
    return out.copy(this.position).addScaledVector(this.forward, dist);
  }

  // -------------------------------------------------------------------------------------------------
  // fixed-step physics
  // -------------------------------------------------------------------------------------------------

  update(dt, world) {
    this._world = world;
    this.time += dt;
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;
    const ph = world?.phase;
    const racing = !(ph === 'countdown' || ph === 'intro' || ph === 'loading');

    // honour external writes to `speed` (items / race code may scale it)
    this._syncSpeedWrite();

    const wasRespawning = this.respawnTime > 0;
    this._tickTimers(dt);

    if (wasRespawning) {
      this._updateRespawn(dt);
      this._finishStep();
      return;
    }

    if (!racing) this._trackRocketStart(world);

    const c = this.controls;
    const stunned = this.isStunned();
    const canDrive = racing && !stunned && this.stallTime <= 0;
    const throttle = canDrive ? clamp(c.throttle, 0, 1) : 0;
    const brake = canDrive ? clamp(c.brake, 0, 1) : 0;

    // steering smoothing (digital keyboard → pseudo analog; analog pads barely affected)
    const steerTarget = canDrive || (!racing && !stunned) ? c.steer : 0;
    const shrinking = Math.abs(steerTarget) < Math.abs(this._steer) || steerTarget * this._steer < 0;
    this._steer = approach(this._steer, steerTarget, (shrinking ? T.steerSmoothDown : T.steerSmoothUp) * dt);
    const steer = this._steer;
    if (this._hopping && canDrive && Math.abs(c.steer) >= 0.3) this._hopDir = Math.sign(c.steer);

    // --- surface from the previous projection
    const p = this.proj;
    const zone = p.zone;
    const onSlow = this.grounded && (p.surface === 'offroad' || (zone && zone.type === 'slow'));
    this.offroad = onSlow;
    const halo = this.invincibleTime > 0;
    const boosting = this.boostTime > 0;
    const slowed = onSlow && !boosting && !halo;
    const grip = clamp(this._themeGrip * this._traction, 0.25, 1.3);

    // --- drift input (edges: explicit driftPressed or our own rising edge on the held flag)
    const edge = canDrive && (c.driftPressed || (c.drift && !this._prevDriftHeld)) && this.time - this._lastDriftEdge > 0.1;
    this._prevDriftHeld = canDrive && c.drift;
    if (edge) {
      this._lastDriftEdge = this.time;
      if (this.grounded && !this.drift.active) this._hop();
      else if (!this.grounded) this._tryTrick();
    }

    // basis & velocity decomposition
    dirFromYaw(this.yaw, this.forward);
    rightFromYaw(this.yaw, this.right);
    let vF = this._vh.x * this.forward.x + this._vh.z * this.forward.z;
    const topRef = this.topSpeed;

    // drift state machine
    const D = this.drift;
    if (D.active) {
      if (!canDrive) this._endDrift(false);
      else if (!c.drift) this._endDrift(true);
      else if (vF < T.driftKeepSpeedFrac * topRef) this._endDrift(false);
      else {
        const rel = clamp(steer * D.dir, -1, 1);
        D.tight = (rel + 1) * 0.5;
        D.time += dt;
        if (this.grounded) {
          let rate = 1 + T.driftChargeIn * Math.max(0, rel) - T.driftChargeOut * Math.max(0, -rel);
          rate *= this._chargeMul;
          if (slowed) rate *= 0.5;
          D.charge += dt * rate;
          const L = T.driftLevels;
          const lvl = D.charge >= L[2] ? 3 : D.charge >= L[1] ? 2 : D.charge >= L[0] ? 1 : 0;
          if (lvl > D.level) {
            D.level = lvl;
            this._sfx(SPARK_SFX[lvl]);
            this._burstDriftLevel(lvl);
          }
        }
      }
    } else if (this._driftArm > 0) {
      this._driftArm -= dt;
      if (!canDrive || !c.drift) this._driftArm = 0;
      else if (this.grounded) this._tryStartDrift(steer, vF);
      if (this._driftArm <= 0) this._hopDir = 0;
    }

    // --- yaw rate
    const absV = Math.abs(vF);
    // holding the throttle lets a (nearly) stopped kart pivot, so you can always turn away from a wall
    const lowF = 1 - Math.exp(-Math.max(absV, throttle * T.pivotSpeed) / 3.6);
    const hiF = 1 - T.steerHighSpeedLoss * smoothstep(0.45, 1.15, absV / Math.max(1, topRef));
    let yawRate = 0;
    if (D.active) {
      // neutral = base rate, counter-steer → wide, steering into the drift → tight
      const rel = D.tight * 2 - 1;
      const m = rel >= 0 ? lerp(1, T.driftTight, rel) : lerp(1, T.driftWide, -rel);
      yawRate = -D.dir * T.driftBaseRate * m * Math.sqrt(this._handling) * lowF * lerp(0.85, 1, grip);
      if (!this.grounded) yawRate *= 0.6;
    } else if (!stunned) {
      yawRate = -steer * T.steerRate * this._handling * lowF * hiF * (vF < -0.5 ? -1 : 1) * lerp(0.9, 1, grip);
      if (!this.grounded) yawRate *= this._hopping ? T.hopSteer : T.airSteer;
    }
    const dYaw = yawRate * dt;
    this.yaw += dYaw;
    if (this.yaw > Math.PI) this.yaw -= TAU;
    else if (this.yaw < -Math.PI) this.yaw += TAU;

    // rotate velocity with the heading (grip); ice & drifts let it lag → slide
    let follow = this.grounded || this._hopping ? (D.active ? T.driftFollow : 1) : 0.6;
    follow *= lerp(0.72, 1, clamp01(grip));
    const ang = dYaw * follow;
    if (ang !== 0) {
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      const x = this._vh.x;
      const z = this._vh.z;
      this._vh.x = x * cs + z * sn;
      this._vh.z = z * cs - x * sn;
    }
    dirFromYaw(this.yaw, this.forward);
    rightFromYaw(this.yaw, this.right);
    vF = this._vh.x * this.forward.x + this._vh.z * this.forward.z;
    let vL = this._vh.x * this.right.x + this._vh.z * this.right.z;

    // --- longitudinal
    const vmax = this._computeMax(slowed);
    this.maxSpeed = vmax;
    if (this.grounded || this._hopping) {
      let a = 0;
      const vBase = this._vmaxBase;
      if (stunned) {
        const k = this.spinTime > 0 ? 3.4 : 2.2;
        vF *= Math.exp(-k * dt);
        vL *= Math.exp(-k * dt);
      } else if (this.stallTime > 0) {
        a = -Math.sign(vF) * Math.min(Math.abs(vF) / dt, 20);
      } else if (boosting && brake <= 0) {
        if (vF < vmax) a = T.boostAccel * Math.max(0.6, this.boostStrength);
        else a = -T.overMaxDecel * 0.5;
      } else if (brake > 0 && (throttle <= 0 || vF > 0.5)) {
        if (vF > 0.5) a = -T.brakeDecel * brake;
        else if (vF > -T.reverseMax * vBase) a = -T.reverseAccel * brake;
        else a = T.coastDecel;
      } else if (throttle > 0) {
        const target = vmax * (0.35 + 0.65 * throttle);
        if (vF < -0.3) a = T.brakeDecel;
        else if (vF < target) {
          const A = (1.505 * vmax) / this._t90;
          const r = clamp01(vF / vmax);
          a = A * Math.pow(1 - r, T.accelExp) * Math.max(0.35, throttle) * (halo ? T.haloAccel : 1);
          a = Math.max(a, 1.2); // never stall just under the target
        } else if (vF > target + 0.3) a = -(slowed ? T.offroadDecel : T.overMaxDecel);
        else a = 0; // cruising at the target (dead band avoids jitter)
      } else {
        // coasting
        const drag = T.coastDecel + T.coastDrag * Math.abs(vF) + (slowed ? 12 : 0);
        a = -Math.sign(vF) * Math.min(drag, Math.abs(vF) / dt);
      }
      // above the max without throttle (post boost / entering off-road)
      if (!boosting && throttle <= 0 && vF > vmax) a = Math.min(a, -(slowed ? T.offroadDecel : T.overMaxDecel));
      // slopes: rising ground ahead slows a little, downhill helps a little
      if (this.grounded) {
        const rise = -(this.up.x * this.forward.x + this.up.z * this.forward.z);
        a -= T.gravity * T.slopeAccel * rise;
      }
      const vPrev = vF;
      vF += a * dt;
      // do not overshoot the throttle target from below
      if (throttle > 0 && !boosting && a > 0 && vPrev <= vmax && vF > vmax) vF = vmax;
      if (boosting && a > 0 && vF > vmax) vF = vmax;
      // lateral grip
      const lat = D.active ? T.driftLatGrip : T.latGrip;
      vL *= Math.exp(-lat * grip * grip * dt);
    } else {
      // airborne: very light drag, keep momentum
      vF *= Math.exp(-0.05 * dt);
    }
    const cap = this.topSpeed * T.maxSpeedCap;
    if (vF > cap) vF = cap;
    this._vh.x = this.forward.x * vF + this.right.x * vL;
    this._vh.z = this.forward.z * vF + this.right.z * vL;

    // --- integrate
    const prevY = this.position.y;
    this._prevGroundY = p.groundY + (this._rampU >= 0 && this._rampZone ? this._rampH : 0);
    this.position.x += this._vh.x * dt;
    this.position.z += this._vh.z * dt;
    if (!this.grounded) {
      this.vy -= T.gravity * dt;
      if (this.vy < -T.maxFallSpeed) this.vy = -T.maxFallSpeed;
      this.position.y += this.vy * dt;
      this.airTime += dt;
    }

    this.path.project(this.position, p.index, p);
    this._collideWalls();
    this._groundContact(dt, prevY, c);
    this._zones(dt);
    this._checkFall();

    // --- bookkeeping
    this.surface = !this.grounded ? (p.surface === 'void' ? 'void' : 'air') : this.offroad ? (p.zone && p.zone.type === 'slow' ? 'slow' : 'offroad') : 'road';
    if (this.grounded && p.surface === 'road' && Math.abs(p.lateral) < p.frame.halfWidth - 1.5 && !(p.zone && p.zone.type === 'ramp')) {
      this.lastSafeD = p.d;
    }
    const tanDot = this.forward.x * p.frame.tan.x + this.forward.z * p.frame.tan.z;
    const vNow = this._vh.x * this.forward.x + this._vh.z * this.forward.z;
    const moveDot = vNow >= 0 ? tanDot : -tanDot;
    if (racing && Math.abs(vNow) > T.wrongWaySpeed && moveDot < T.wrongWayDot) this.wrongWayTime += dt;
    else this.wrongWayTime = Math.max(0, this.wrongWayTime - dt * 3);

    this._finishStep();
  }

  _finishStep() {
    dirFromYaw(this.yaw, this.forward);
    rightFromYaw(this.yaw, this.right);
    this.speed = this._vh.x * this.forward.x + this._vh.z * this.forward.z;
    this._speedOut = this.speed;
    this.velocity.set(this._vh.x, this.grounded ? this._groundVy : this.vy, this._vh.z);
    if (!Number.isFinite(this.position.x) || !Number.isFinite(this.position.y) || !Number.isFinite(this.position.z)) {
      // numerical safety net: never let a NaN escape
      const f = this.path.frameAt(this.lastSafeD, _frameTmp);
      this.position.copy(f.pos);
      this.prevPosition.copy(f.pos);
      this._vh.set(0, 0, 0);
      this.vy = 0;
      this.speed = this._speedOut = 0;
      this.path.project(this.position, null, this.proj);
    }
  }

  _tickTimers(dt) {
    this.spinTime = dec(this.spinTime, dt);
    this.launchTime = dec(this.launchTime, dt);
    this.boostTime = dec(this.boostTime, dt);
    if (this.boostTime <= 0) this.boostStrength = 0;
    this.invincibleTime = dec(this.invincibleTime, dt);
    this.graceTime = dec(this.graceTime, dt);
    this.stallTime = dec(this.stallTime, dt);
    this.squishTime = dec(this.squishTime, dt);
    this.trickTime = dec(this.trickTime, dt);
    this._wallCooldown = dec(this._wallCooldown, dt);
    this._bumpCooldown = dec(this._bumpCooldown, dt);
    this._hazardCooldown = dec(this._hazardCooldown, dt);
    if (this.shrinkTime > 0) {
      this.shrinkTime = Math.max(0, this.shrinkTime - dt);
      if (this.shrinkTime <= 0) this._sfx('grow');
    }
    // Sensei's Card: we count it down unless another module already does (detected automatically)
    if (this.cardTime > 0) {
      if (this.cardTime < this._cardSeen - 1e-6) this._cardExternal = true;
      else if (this.cardTime > this._cardSeen + 1e-6) this._cardExternal = false; // freshly set
      if (!this._cardExternal) this.cardTime = Math.max(0, this.cardTime - dt);
    }
    this._cardSeen = this.cardTime;
    if (this.respawnTime > 0) this.respawnTime = Math.max(0, this.respawnTime - dt);
  }

  _computeMax(slowed) {
    let vmax = this.topSpeed * this.topSpeedScale * (1 + this.coins * CREDIT_SPEED_BONUS);
    if (this.shrinkTime > 0) vmax *= T.shrinkSpeed;
    if (this.invincibleTime > 0) vmax *= T.haloSpeed;
    this._vmaxBase = vmax;
    if (this.boostTime > 0) return vmax * (1 + T.boostPower * this.boostStrength);
    if (slowed) return vmax * this._offroadMul;
    return vmax;
  }

  // --- drifting -------------------------------------------------------------------------------------

  _hop() {
    this.grounded = false;
    this._hopping = true;
    this._hopDir = 0;
    this.vy = T.hopVy + Math.max(0, this._groundVy);
    this.airTime = 0;
    this._trickDone = true; // hops cannot trick
    this._squashV += 2.2;
    this._sfx('driftHop');
  }

  _tryStartDrift(steer, vF) {
    if (this.drift.active) return;
    if (vF < T.driftMinSpeedFrac * this.topSpeed) return;
    // direction: current stick if clearly pushed, else the direction latched during the hop
    const raw = this.controls.steer;
    let dir = 0;
    if (Math.abs(raw) >= 0.5) dir = Math.sign(raw);
    else if (Math.abs(steer) >= 0.28) dir = Math.sign(steer);
    else dir = this._hopDir;
    if (!dir) return;
    const D = this.drift;
    D.active = true;
    D.dir = dir;
    D.charge = 0;
    D.level = 0;
    D.time = 0;
    D.tight = 0.5;
    this._driftArm = 0;
    this._hopDir = 0;
    this._sfx('driftStart');
  }

  _endDrift(release) {
    const D = this.drift;
    if (!D.active) return;
    const lvl = D.level;
    D.active = false;
    D.dir = 0;
    D.charge = 0;
    D.level = 0;
    D.time = 0;
    if (release && lvl > 0) {
      this.applyBoost(T.driftBoost[lvl - 1], T.driftBoostStrength[lvl - 1]);
      this._boostFx = LEVEL_FLAME[lvl];
      this._sfx('miniTurbo', lvl === 3 ? 1.15 : lvl === 2 ? 1.05 : 0.95);
      this._burstMiniTurbo(lvl);
      if (this.isPlayer) this._impact(0.12 + lvl * 0.05);
    }
  }

  _tryTrick() {
    if (this._hopping || this._trickDone || this.isStunned()) return;
    const ok = this._rampAir ? this.airTime <= T.trickWindow || this.airTime > T.trickAirMin : this.airTime > T.trickAirMin;
    if (!ok) return;
    this._trickDone = true;
    this.trickPending = true;
    this.trickTime = T.trickAnim;
    const st = this.controls.steer;
    this._trickStyle = st < -0.3 ? 1 : st > 0.3 ? 2 : (this.index + Math.floor(this.time * 3)) % 3;
    this.vy += 1.2; // a little float
    this._sfx('trick');
    this._emit('star', this.position, 10, '#fff27a', '#ffffff', 3.2, 0.45, 0.6, 0, 2, 0);
  }

  // --- world interaction ------------------------------------------------------------------------------

  _collideWalls() {
    const p = this.proj;
    const f = p.frame;
    const side = p.side;
    const hasWall = side > 0 ? f.wallR : f.wallL;
    if (!hasWall) return;
    const lim = p.limit - T.wallMargin * this._sizeScale();
    const absLat = Math.abs(p.lateral);
    if (absLat <= lim) return;
    const pen = absLat - lim;
    const nx = -side * f.rightH.x;
    const nz = -side * f.rightH.z;
    this.position.x += nx * pen;
    this.position.z += nz * pen;
    const vn = this._vh.x * nx + this._vh.z * nz;
    if (vn < 0) {
      const vBefore = Math.hypot(this._vh.x, this._vh.z);
      const impact = -vn;
      this._vh.x -= nx * vn * (1 + T.wallRestitution);
      this._vh.z -= nz * vn * (1 + T.wallRestitution);
      const ratio = impact / Math.max(4, vBefore); // 0 = graze, 1 = head-on
      const loss = lerp(1, T.wallSpeedMul, smoothstep(0.06, 0.55, ratio));
      this._vh.x *= loss;
      this._vh.z *= loss;
      // glancing hits steer the nose along the wall (keeps flow instead of grinding)
      if (ratio < 0.8 && vBefore > 5 && this.spinTime <= 0) {
        let tx = f.tan.x;
        let tz = f.tan.z;
        if (tx * this.forward.x + tz * this.forward.z < 0) {
          tx = -tx;
          tz = -tz;
        }
        const want = Math.atan2(tx, tz);
        this.yaw += angleDiff(this.yaw, want) * 0.3 * (1 - ratio);
      }
      if (impact > 2 && this._wallCooldown <= 0) {
        this._wallCooldown = 0.22;
        _v1.set(this.position.x - nx * 0.9, this.position.y + 0.45, this.position.z - nz * 0.9);
        const n = Math.round(clamp(impact * 1.4, 6, 22));
        this._emit('spark', _v1, n, '#ffe08a', '#ffffff', 4 + impact * 0.2, 0.22, 0.45, nx * 5 + this._vh.x * 0.3, 3.5, nz * 5 + this._vh.z * 0.3);
        this._sfx('wallBump', 0.9 + Math.min(0.3, impact * 0.01), clamp(0.35 + impact / 18, 0.35, 1));
        this._impact(clamp(impact / 30, 0.12, 0.55));
      }
    }
    this.path.project(this.position, p.index, p);
  }

  _groundContact(dt, prevY, c) {
    const p = this.proj;
    let gy = p.groundY;
    // ramp wedge: the surface rises linearly across the zone
    const zone = p.zone;
    let rampU = -1;
    let rampH = 0;
    if (zone && zone.type === 'ramp') {
      const len = Math.max(0.5, zone.d1 - zone.d0);
      rampU = clamp(this.path.deltaD(p.d, zone.d0) / len, 0, 1);
      rampH = rampHeightAt(this.track, zone, p.d, p.lateral, rampU);
      gy += rampH;
    }
    const supported = p.surface !== 'void';

    // ramp lip: leaving the far end of a ramp we were riding → launch
    if (this.grounded && this._rampZone && this._rampU > 0.45 && rampU < 0) {
      const rz = this._rampZone;
      const past = this.path.deltaD(p.d, rz.d1);
      const fwd = this.speed > 2;
      if (past > -1 && past < 12 && fwd) {
        this.grounded = false;
        this._rampAir = true;
        this._trickDone = false;
        this._hopping = false;
        this.airTime = 0;
        this.vy = Math.max(this._groundVy, T.rampVy * (rz.power ?? 1));
        this.position.y = prevY + this.vy * dt;
        this._rampZone = null;
        this._rampU = -1;
        this._sfx('jump');
        this._squashV -= 1.2;
        this._wheelie = 0.6;
        return;
      }
    }

    if (this.grounded) {
      if (!supported) {
        this.grounded = false;
        this.vy = Math.min(this._groundVy, 0);
        this.airTime = 0;
        this._trickDone = true;
        this._setRamp(null, -1);
        return;
      }
      const yFree = prevY + this.vy * dt - 0.5 * T.gravity * dt * dt;
      if (gy < yFree - 0.035 && rampU < 0) {
        // the ground falls away faster than gravity → natural airtime over a crest
        this.grounded = false;
        this.position.y = yFree;
        this.vy -= T.gravity * dt;
        this.airTime = dt;
        this._trickDone = false;
        this._hopping = false;
        this._setRamp(null, -1);
        return;
      }
      this.position.y = gy;
      if (rampU >= 0) {
        this._groundVy = clamp((gy - prevY) / dt, -30, 30); // wedge climb rate (feeds the launch)
      } else {
        // vertical speed of the ground plane under our horizontal velocity. Using the position delta instead
        // turned sideways shoves (kart bumps, wall push-outs) on banked roads into fake climb rates → hops.
        const n = p.frame.up;
        this._groundVy = n.y > 0.2 ? clamp(-(n.x * this._vh.x + n.z * this._vh.z) / n.y, -30, 30) : 0;
      }
      this.vy = this._groundVy;
      this.up.copy(p.frame.up);
      if (rampU >= 0) {
        // wedge slope along the track (numerical derivative of the visual profile)
        const len = Math.max(0.5, zone.d1 - zone.d0);
        const e = 0.5; // backward difference (stays valid right up to the lip)
        const h0 = rampHeightAt(this.track, zone, p.d - e, p.lateral, rampU - e / len);
        const s = clamp((rampH - h0) / e, 0, 0.6);
        this.up.addScaledVector(p.frame.tan, -s).normalize();
      }
      this._setRamp(rampU >= 0 ? zone : null, rampU, rampH);
      return;
    }

    // airborne → landing?
    if (supported && this.position.y <= gy) {
      const cameFromAbove = prevY >= this._prevGroundY - 0.8 || this.position.y > gy - 1.0;
      if (cameFromAbove) {
        this.position.y = gy;
        this._land(c, rampU >= 0 ? zone : null, rampU, rampH);
      }
    }
  }

  _setRamp(zone, u, h = 0) {
    this._rampZone = zone;
    this._rampU = u;
    this._rampH = zone ? h : 0;
  }

  _land(c, rampZone, rampU, rampH = 0) {
    const airT = this.airTime;
    const impactVy = Math.max(0, -this.vy);
    const wasHop = this._hopping;
    if (!wasHop) this._hopDir = 0;
    this.grounded = true;
    // follow the ground's slope from the first grounded step (a zero vy here made karts landing on a
    // downslope "float" off it again → double landings after jumps)
    const gn = this.proj.frame.up;
    this._groundVy = gn.y > 0.2 ? clamp(-(gn.x * this._vh.x + gn.z * this._vh.z) / gn.y, -30, 30) : 0;
    this.vy = this._groundVy;
    this.up.copy(this.proj.frame.up);
    this._setRamp(rampZone, rampU, rampH);

    if (this.launchTime > 0 && !this._launchBounced && impactVy > 4) {
      // tumbling karts bounce once
      this._launchBounced = true;
      this.grounded = false;
      this.vy = Math.min(6, impactVy * 0.35);
      this._emit('dust', this.position, 10, this._dustColor, '#ffffff', 3, 0.9, 0.7, 0, 1.5, 0);
      this._sfx('land', 0.85);
      return;
    }

    if (this.trickPending) {
      this.trickPending = false;
      this.applyBoost(T.trickBoost, 0.9);
      this._boostFx = FLAME_FX.gold;
      this._sfx('miniTurbo', 1.1);
      this._emit('star', this.position, 8, '#ffe66d', '#ffffff', 3, 0.4, 0.5, 0, 2, 0);
    }
    if (!wasHop && (airT > 0.28 || impactVy > 7)) {
      const k = clamp(impactVy / 18, 0.25, 1);
      this._sfx('land', 1, 0.5 + 0.5 * k);
      this._emit('dust', this.position, Math.round(6 + 10 * k), this._dustColor, '#ffffff', 3.5, 1.0, 0.6, this._vh.x * 0.15, 1.2, this._vh.z * 0.15);
      this._squashV -= 1.5 + 2.5 * k;
      this._impact(0.12 + 0.3 * k);
    } else if (wasHop) {
      this._squashV -= 1.2;
    }
    this._hopping = false;
    this._rampAir = false;
    this._trickDone = false;
    this.airTime = 0;
    // holding drift on touchdown (hop or any jump) → try to start the drift, with a short grace window
    if (!this.drift.active && c.drift && !this.isStunned() && this.stallTime <= 0) {
      this._driftArm = T.driftArmTime;
      this._tryStartDrift(this._steer, this.speed);
    }
  }

  _zones() {
    const p = this.proj;
    const z = p.zone;
    if (z && z.type === 'boost' && (this.grounded || p.height < 0.8)) {
      if (this._boostPad !== z) {
        this._boostPad = z;
        this._sfx('boostPad');
        this._boostFx = FLAME_FX.normal;
        if (this.isPlayer) this._impact(0.15);
      }
      this.applyBoost(T.dashDuration, 1, true);
    } else if (!z || z.type !== 'boost') {
      this._boostPad = null;
    }
  }

  _checkFall() {
    const p = this.proj;
    if (this.grounded) {
      this._fallSfx = false;
      return;
    }
    const overVoid = p.surface === 'void';
    if (overVoid && p.height < -1.2 && !this._fallSfx) {
      this._fallSfx = true;
      this._sfx('fall');
    }
    const tooDeep = overVoid && p.height < -T.voidDepth;
    const lost = p.edgeDist < -T.corridorRespawn;
    const underWorld = this.position.y < this.path.bounds.min.y - 60;
    if (tooDeep || lost || underWorld) {
      if (overVoid) {
        const type = this._voidType;
        if (type === 'lava') this._emit('ember', this.position, 26, '#ffb02e', '#ff3d00', 5, 0.5, 1.0, 0, 6, 0);
        else if (type === 'water') this._emit('splash', this.position, 26, '#bfe9ff', '#ffffff', 5, 0.5, 0.9, 0, 7, 0);
      }
      this.respawn();
    }
  }

  // --- countdown / rocket start ------------------------------------------------------------------------

  _trackRocketStart(world) {
    const cl = world?.countdownLeft;
    if (typeof cl !== 'number') return;
    const held = this.controls.throttle > 0.5;
    if (held && !this._rocketHeld) this._rocketPressAt = cl;
    if (!held) this._rocketPressAt = null;
    this._rocketHeld = held;
  }

  /** Called by Race at GO. Rocket start when throttle was first pressed in the window, stall if far too early. */
  onRaceStart() {
    const at = this._rocketPressAt;
    const held = this._rocketHeld && this.controls.throttle > 0.5;
    this._rocketHeld = false;
    this._rocketPressAt = null;
    if (!held || at == null) return;
    if (at >= T.rocketWindow[0] && at <= T.rocketWindow[1]) {
      this.applyBoost(T.rocketBoost, 1);
      this._boostFx = FLAME_FX.normal;
      this._sfx('rocketStart');
      this._wheelie = 1;
      getExhaust(this, 0, _v1);
      this._emit('boostFlame', _v1, 14, '#ffc23a', '#ff4a1c', 1.5, 0.7, 0.4, -this.forward.x * 6, 0.5, -this.forward.z * 6);
      this._impact(0.25);
    } else if (at > T.stallEarly) {
      this.stallTime = T.stallTime;
      this._sfx('stall');
      getExhaust(this, 0, _v1);
      this._emit('smoke', _v1, 12, '#3b3b44', '#8a8a96', 1.2, 1.0, 1.1, 0, 2, 0);
    }
  }

  // --- respawn (drone rescue) ------------------------------------------------------------------------

  respawn() {
    if (this.respawnTime > 0) return;
    const d = this.lastSafeD;
    const f = this.path.frameAt(d, _frameTmp);
    this._resp = this._resp || { from: new THREE.Vector3(), to: new THREE.Vector3(), yawFrom: 0, yawTo: 0, d: 0 };
    const R = this._resp;
    R.from.copy(this.position);
    R.to.copy(f.pos);
    R.yawFrom = this.yaw;
    R.yawTo = f.yaw;
    R.d = d;
    this.respawnTarget.copy(R.to);
    this.respawnYaw = R.yawTo;
    this.respawnTime = T.respawnDuration;
    this._endDrift(false);
    this._driftArm = 0;
    this.boostTime = 0;
    this.boostStrength = 0;
    this.spinTime = 0;
    this.launchTime = 0;
    this.stallTime = 0;
    this.trickPending = false;
    this.trickTime = 0;
    this._hopping = false;
    this._rampAir = false;
    this._vh.set(0, 0, 0);
    this.vy = 0;
    this.grounded = false;
    this.wrongWayTime = 0;
    // pin the track projection to the respawn point (keeps race progress sane during the carry)
    this.path.project(R.to, null, this.proj);
    this._sfx('respawn');
    if (!this._drone) {
      this._drone = createDrone();
      (this.object3d.parent || this.object3d).add(this._drone.group);
    } else if (!this._drone.group.parent && this.object3d.parent) {
      this.object3d.parent.add(this._drone.group);
    }
    this._droneOut = 0;
  }

  _updateRespawn() {
    const R = this._resp;
    const u = 1 - this.respawnTime / T.respawnDuration;
    const above = _v1.copy(R.to);
    above.y += 3.2;
    if (u < 0.22) {
      // the drone flies in; the kart hangs where it fell (slowly sinking)
      this.position.copy(R.from);
      this.position.y -= u * 2;
    } else if (u < 0.72) {
      const t = easeInOut((u - 0.22) / 0.5);
      const dist = R.from.distanceTo(above);
      const midY = Math.max(R.from.y, above.y) + 3 + Math.min(10, dist * 0.12);
      const x0 = R.from.x;
      const y0 = R.from.y - 0.44;
      const z0 = R.from.z;
      // quadratic bezier from → mid → above
      const mx = (x0 + above.x) * 0.5;
      const mz = (z0 + above.z) * 0.5;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const cc = t * t;
      this.position.set(a * x0 + b * mx + cc * above.x, a * y0 + b * midY + cc * above.y, a * z0 + b * mz + cc * above.z);
      this.yaw = R.yawFrom + angleDiff(R.yawFrom, R.yawTo) * t;
    } else {
      const t = easeOutCubic((u - 0.72) / 0.28);
      this.position.lerpVectors(above, R.to, t);
      this.yaw = R.yawTo;
    }
    this._vh.set(0, 0, 0);
    this.vy = 0;
    if (this.respawnTime <= 0) {
      this.position.copy(R.to);
      this.yaw = R.yawTo;
      this.grounded = true;
      this.airTime = 0;
      this._groundVy = 0;
      this.graceTime = T.respawnGrace;
      this.path.project(this.position, null, this.proj);
      this.position.y = this.proj.groundY;
      this.up.copy(this.proj.frame.up);
      this.lastSafeD = this.proj.d;
      this._droneOut = 0.9;
      this._droneRelease.copy(this.position);
      this._droneReleaseYaw = this.yaw;
      this._fallSfx = false;
      this._emit('ring', this.position, 1, '#8ff4ff', '#ffffff', 0, 3, 0.5, 0, 0, 0);
      this._emit('star', this.position, 8, '#8ff4ff', '#ffffff', 3, 0.35, 0.6, 0, 2.5, 0);
    }
  }

  // -------------------------------------------------------------------------------------------------
  // effects (called by items / race / collisions)
  // -------------------------------------------------------------------------------------------------

  /** Speed boost. Durations do not add up (the longer one wins, with a small chaining bonus); the strongest active strength wins. */
  applyBoost(duration = 1, strength = 1, refreshOnly = false) {
    this._syncSpeedWrite();
    const had = this.boostTime > 0;
    if (had) {
      const bonus = refreshOnly ? 0 : Math.min(this.boostTime, duration) * 0.15;
      this.boostTime = Math.min(3.5, Math.max(this.boostTime, duration) + bonus);
      this.boostStrength = Math.max(this.boostStrength, strength);
    } else {
      this.boostTime = duration;
      this.boostStrength = strength;
      // instant punch so every boost is felt immediately
      if (this.grounded && this.respawnTime <= 0 && this.spinTime <= 0) {
        const vF = this._vh.x * this.forward.x + this._vh.z * this.forward.z;
        if (vF > -1) {
          const kick = T.boostKick * strength;
          this._vh.x += this.forward.x * kick;
          this._vh.z += this.forward.z * kick;
          this.speed = this._speedOut = vF + kick;
        }
      }
      this._wheelie = Math.max(this._wheelie, 0.7);
      if (!refreshOnly) this._boostFx = FLAME_FX.normal;
    }
    this.boostDuration = Math.max(this.boostTime, had ? this.boostDuration : duration);
  }

  spinOut(duration = T.spinDuration) {
    this._syncSpeedWrite();
    if (!this.isVulnerable() || this.spinTime > 0 || this.launchTime > 0) return false;
    this.spinTime = duration;
    this._spinDuration = duration;
    const vL = this._vh.x * this.right.x + this._vh.z * this.right.z;
    this._spinDir = this._steer !== 0 ? -Math.sign(this._steer) : vL >= 0 ? -1 : 1;
    this._endDrift(false);
    this._driftArm = 0;
    this.boostTime = 0;
    this.boostStrength = 0;
    this.trickPending = false;
    this._sfx('spin');
    _v1.copy(this.position);
    _v1.y += 1.6;
    this._emit('hitStars', _v1, 7, '#ffe066', '#ffffff', 1.6, 0.5, 0.9, 0, 1.5, 0);
    if (this.isPlayer) this._impact(0.35);
    return true;
  }

  launch(strength = 1) {
    this._syncSpeedWrite();
    if (!this.isVulnerable() || this.launchTime > 0) return false;
    const s = clamp(strength, 0.3, 1.6);
    this.launchTime = T.launchDuration * clamp(0.75 + 0.25 * s, 0.8, 1.2);
    this._launchDuration = this.launchTime;
    this._launchBounced = false;
    this.spinTime = 0;
    this._endDrift(false);
    this._driftArm = 0;
    this.boostTime = 0;
    this.boostStrength = 0;
    this.trickPending = false;
    this._hopping = false;
    this._rampAir = false;
    this._trickDone = true;
    this._vh.multiplyScalar(0.28);
    this.vy = T.launchVy * s;
    this.grounded = false;
    this.airTime = 0;
    this._tumbleSide = this.index % 2 ? 1 : -1;
    this._sfx('launch');
    _v1.copy(this.position);
    _v1.y += 1.6;
    this._emit('hitStars', _v1, 9, '#ffe066', '#ffffff', 2, 0.55, 1.0, 0, 2, 0);
    if (this.isPlayer) this._impact(0.6);
    return true;
  }

  shrink(duration = 6) {
    if (!this.isVulnerable()) return false;
    this.shrinkTime = Math.max(this.shrinkTime, duration);
    this._shrinkDuration = this.shrinkTime;
    this._endDrift(false);
    return true;
  }

  /** Squished flat by a normal-size kart (only while shrunk). */
  squish(by = null) {
    this._syncSpeedWrite();
    if (this.squishTime > 0 || !this.isVulnerable()) return false;
    this.squishTime = T.squishDuration;
    this.spinTime = T.squishDuration;
    this._spinDuration = T.squishDuration;
    this._endDrift(false);
    this.boostTime = 0;
    this._vh.multiplyScalar(0.2);
    this._sfx('spin', 0.8);
    this._world?.events?.emit?.('hit', { victim: this, attacker: by, itemId: 'squish' });
    if (this.isPlayer) this._impact(0.3);
    return true;
  }

  setInvincible(duration = 7.5) {
    this.invincibleTime = Math.max(this.invincibleTime, duration);
    // the halo cures status effects
    this.spinTime = 0;
    this.squishTime = 0;
    if (this.shrinkTime > 0) {
      this.shrinkTime = 0;
      this._sfx('grow');
    }
  }

  addCoins(n = 1) {
    this._syncSpeedWrite();
    const before = this.coins;
    this.coins = clamp(this.coins + n, 0, MAX_CREDITS);
    const gained = this.coins - before;
    if (gained > 0 && this.grounded && this.respawnTime <= 0 && this.spinTime <= 0) {
      // a Credit gives a tiny kick, like picking up a coin in MK
      const kick = Math.min(1.2 * gained, 3);
      this._vh.x += this.forward.x * kick;
      this._vh.z += this.forward.z * kick;
      this.speed = this._speedOut = this._vh.x * this.forward.x + this._vh.z * this.forward.z;
    }
    return gained;
  }

  loseCoins(n = 3) {
    const lost = Math.min(this.coins, Math.max(0, n));
    this.coins -= lost;
    return lost;
  }

  /** Add a world-space impulse (u/s). Positive y launches the kart into the air. */
  addImpulse(x = 0, y = 0, z = 0) {
    this._syncSpeedWrite();
    this._vh.x += x;
    this._vh.z += z;
    if (y > 0) {
      this.vy = (this.grounded ? 0 : this.vy) + y;
      this.grounded = false;
      this._trickDone = true;
    }
    this.speed = this._speedOut = this._vh.x * this.forward.x + this._vh.z * this.forward.z;
  }

  // -------------------------------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------------------------------

  /** Fold a pending external write to `kart.speed` into the velocity (items / race may set it between steps). */
  _syncSpeedWrite() {
    dirFromYaw(this.yaw, this.forward);
    if (this.speed === this._speedOut || !Number.isFinite(this.speed)) return;
    const vF = this._vh.x * this.forward.x + this._vh.z * this.forward.z;
    const dv = this.speed - vF;
    this._vh.x += this.forward.x * dv;
    this._vh.z += this.forward.z * dv;
    this._speedOut = this.speed;
  }

  _sizeScale() {
    return this.shrinkTime > 0 ? 0.62 : 1;
  }

  _impact(strength) {
    this.impactSeq++;
    this.impactStrength = strength;
  }

  _sfx(name, pitch = 1, volume = 1) {
    const w = this._world;
    if (!name || !w || typeof w.sfx !== 'function') return;
    _sfxOpts.pitch = pitch;
    _sfxOpts.volume = volume;
    try {
      w.sfx(name, this.position, _sfxOpts);
    } catch (err) {
      /* audio must never break physics */
    }
  }

  /** Emit particles through world.particles (positional args → no allocations). */
  _emit(type, pos, count, color, color2, spread, size, life, vx = 0, vy = 0, vz = 0) {
    const P = this._world?.particles;
    if (!P || typeof P.emit !== 'function') return;
    count = Math.round(count);
    if (count <= 0) return;
    _fxOpts.count = count;
    _fxOpts.color = color;
    _fxOpts.color2 = color2 ?? color;
    _fxOpts.spread = spread;
    _fxOpts.size = size;
    _fxOpts.life = life;
    _fxOpts.velocity.set(vx, vy, vz);
    try {
      P.emit(type, pos, _fxOpts);
    } catch (err) {
      /* particles are cosmetic */
    }
  }

  _burstDriftLevel(lvl) {
    const fx = DRIFT_FX[lvl];
    for (let i = 0; i < 2; i++) {
      getWheel(this, i, _v1);
      this._emit('spark', _v1, 10, fx.color, fx.color2, 3.5, 0.3, 0.4, -this.forward.x * 3, 2.5, -this.forward.z * 3);
    }
  }

  _burstMiniTurbo(lvl) {
    const fx = LEVEL_FLAME[lvl];
    for (let i = 0; i < 2; i++) {
      getExhaust(this, i, _v1);
      this._emit('boostFlame', _v1, 6 + lvl * 3, fx.color, fx.color2, 1.2, 0.6, 0.3, -this.forward.x * 7, 0.4, -this.forward.z * 7);
    }
    getExhaust(this, 0, _v1);
    this._emit('ring', _v1, 1, DRIFT_FX[lvl].color, '#ffffff', 0, 2.2, 0.35, 0, 0, 0);
  }

  // -------------------------------------------------------------------------------------------------
  // per-frame visuals
  // -------------------------------------------------------------------------------------------------

  updateVisual(dt = 0, alpha = 1) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this._vtime += dt;
    const a = clamp01(alpha);
    const vp = this._visPos.lerpVectors(this.prevPosition, this.position, a);
    const vyaw = this.prevYaw + angleDiff(this.prevYaw, this.yaw) * a;
    this.visualYaw = vyaw;
    const fx = Math.sin(vyaw);
    const fz = Math.cos(vyaw);

    // --- smoothed visual up (slope / banking alignment, airborne pitch)
    const upT = _v2;
    let rate = 14;
    if (this.respawnTime > 0) {
      upT.copy(WORLD_UP);
      rate = 6;
    } else if (this.grounded) {
      upT.copy(this.up);
    } else {
      const k = clamp(this.vy * 0.026, -0.3, 0.32);
      upT.set(-fx * k, 1, -fz * k).normalize();
      rate = this._hopping ? 10 : 4;
    }
    this._visUp.lerp(upT, 1 - Math.exp(-rate * dt)).normalize();
    if (dt === 0) this._visUp.copy(upT);
    const u = this._visUp;

    // --- base orientation (columns: X = up × forward (left), Y = up, Z = forward on the ground plane)
    const d = fx * u.x + fz * u.z;
    let Fx = fx - u.x * d;
    let Fy = -u.y * d;
    let Fz = fz - u.z * d;
    const fl = Math.hypot(Fx, Fy, Fz) || 1;
    Fx /= fl;
    Fy /= fl;
    Fz /= fl;
    const Xx = u.y * Fz - u.z * Fy;
    const Xy = u.z * Fx - u.x * Fz;
    const Xz = u.x * Fy - u.y * Fx;
    _m1.set(Xx, u.x, Fx, 0, Xy, u.y, Fy, 0, Xz, u.z, Fz, 0, 0, 0, 0, 1);
    this.object3d.position.copy(vp);
    this.object3d.quaternion.setFromRotationMatrix(_m1);

    // --- local pose on racer.root: drift angle, spins, tricks, tumble, squash & shrink
    const D = this.drift;
    const driftTarget = D.active ? -D.dir * (0.36 + 0.16 * D.tight) : 0;
    this._driftVis = damp(this._driftVis, driftTarget, D.active ? 9 : 7, dt);
    let yawOff = this._driftVis;
    let pitch = 0;
    let roll = 0;
    let lift = 0;
    const t = this._vtime;
    if (this.spinTime > 0 && this.squishTime <= 0) {
      const pr = 1 - this.spinTime / this._spinDuration;
      yawOff += this._spinDir * TAU * 2 * easeOutCubic(pr);
    }
    if (this.trickTime > 0) {
      const pr = easeInOut(1 - this.trickTime / T.trickAnim);
      if (this._trickStyle === 1) roll += TAU * pr;
      else if (this._trickStyle === 2) roll -= TAU * pr;
      else {
        yawOff += TAU * pr;
        lift += Math.sin(pr * Math.PI) * 0.25;
      }
    }
    if (this.launchTime > 0) {
      const pr = 1 - this.launchTime / this._launchDuration;
      pitch -= TAU * easeOutCubic(Math.min(1, pr * 1.35));
      roll += Math.sin(Math.min(1, pr * 1.35) * Math.PI) * 0.7 * this._tumbleSide;
      lift += Math.sin(Math.min(1, pr * 1.35) * Math.PI) * 0.3;
    }
    // boost wheelie
    this._wheelie = Math.max(0, this._wheelie - dt * 2.2);
    pitch -= 0.13 * Math.sin(this._wheelie * Math.PI * 0.5) * (this.grounded ? 1 : 0.3);
    // respawn sway under the drone
    if (this.respawnTime > 0) {
      roll += Math.sin(t * 5.2) * 0.08;
      pitch += Math.sin(t * 3.7) * 0.06;
    }
    // off-road rumble
    if (this.offroad && this.grounded && Math.abs(this.speed) > 3) {
      const k = clamp(Math.abs(this.speed) / 20, 0, 1);
      lift += (Math.sin(t * 43) * 0.5 + Math.sin(t * 71) * 0.5) * 0.035 * k;
      roll += Math.sin(t * 37) * 0.015 * k;
    }
    // squash spring (hops / landings)
    this._squashV += (-160 * this._squash - 13 * this._squashV) * dt;
    this._squash += this._squashV * dt;
    this._squash = clamp(this._squash, -0.35, 0.35);
    // shrink with a bouncy spring
    const shrinkTarget = this.shrinkTime > 0 ? T.shrinkScale : 1;
    this._shrinkVel += ((shrinkTarget - this._shrinkVis) * 140 - this._shrinkVel * 11) * dt;
    this._shrinkVis += this._shrinkVel * dt;
    if (dt === 0) {
      this._shrinkVis = shrinkTarget;
      this._shrinkVel = 0;
    }
    this._squishVis = damp(this._squishVis, this.squishTime > 0.25 ? 1 : 0, this.squishTime > 0.25 ? 20 : 6, dt);
    const sq = this._squash;
    const sh = this._shrinkVis;
    const flat = this._squishVis;
    const sy = sh * (1 + sq) * (1 - 0.72 * flat);
    const sxz = sh * (1 - sq * 0.5) * (1 + 0.3 * flat);

    const root = this.racer.root;
    root.rotation.set(pitch, yawOff, roll);
    root.scale.set(sxz, sy, sxz);
    // rotate around the kart's (scaled) centre, scale from the ground contact point
    const cy = 0.55 * sy;
    _q1.setFromEuler(root.rotation);
    _v3.set(0, cy, 0).applyQuaternion(_q1);
    root.position.set(-_v3.x, cy - _v3.y + lift, -_v3.z);

    // post-respawn blink
    root.visible = !(this.graceTime > 0 && Math.floor(t * 18) % 2 === 0);

    // --- model animation
    const S = this._vstate;
    const c = this.controls;
    S.speed = this.speed;
    S.steer = this._steer;
    S.throttle = this.respawnTime > 0 ? 0 : c.throttle;
    S.drifting = D.active;
    S.driftDir = D.active ? D.dir : 0;
    S.driftLevel = D.active ? D.level : 0;
    S.driftCharge = D.charge;
    S.boosting = this.boostTime > 0;
    S.boostStrength = this.boostStrength;
    S.airborne = !this.grounded && (this.airTime > 0.06 || this._rampAir);
    S.trick = this.trickTime > 0;
    S.spinning = this.spinTime > 0 && this.squishTime <= 0;
    S.tumbling = this.launchTime > 0;
    S.hurt = this.spinTime > 0 || this.launchTime > 0 || this.squishTime > 0 || this.stallTime > 0;
    S.shrink = sh;
    S.invincible = this.invincibleTime > 0;
    S.celebrate = !!this.finished && this.place <= 3;
    S.sad = !!this.finished && this.place >= 5;
    S.lookBack = !!c.lookBack && this.respawnTime <= 0;
    S.time = t;
    S.offroad = this.offroad;
    S.grounded = this.grounded;
    S.respawning = this.respawnTime > 0;
    S.speedRatio = this.speedRatio;
    S.braking = c.brake > 0 && this.speed > 1;
    S.reversing = this.speed < -0.5;
    S.stalled = this.stallTime > 0;
    try {
      this.racer.update(dt, S);
    } catch (err) {
      if (!this._modelErr) console.error('[Kart] racer.update failed', err);
      this._modelErr = true;
    }

    this._updateDrone(dt, vp, vyaw);
    if (dt > 0) this._emitContinuous(dt, vp);
  }

  _updateDrone(dt, vp, vyaw) {
    const dr = this._drone;
    if (!dr) return;
    const g = dr.group;
    const t = this._vtime;
    if (this.respawnTime > 0) {
      const u = 1 - this.respawnTime / T.respawnDuration;
      g.visible = true;
      const hang = 2.75 * this._shrinkVis;
      let y = vp.y + hang + Math.sin(t * 6) * 0.06;
      let x = vp.x;
      let z = vp.z;
      if (u < 0.22) {
        const k = easeOutCubic(u / 0.22);
        y += (1 - k) * 14;
        x -= Math.sin(vyaw) * (1 - k) * 6;
        z -= Math.cos(vyaw) * (1 - k) * 6;
      }
      g.position.set(x, y, z);
      g.rotation.set(0.12 * Math.sin(t * 2.2), vyaw, 0.08 * Math.sin(t * 3.1));
      const cablesOn = u >= 0.18;
      for (const c of dr.cables) {
        c.visible = cablesOn;
        c.scale.y = Math.max(0.05, hang - 1.25);
        c.position.y = -0.3 - (hang - 1.25) * 0.5;
      }
      dr.hook.visible = cablesOn;
      dr.hook.position.y = -0.3 - (hang - 1.25);
    } else if (this._droneOut > 0) {
      this._droneOut = Math.max(0, this._droneOut - dt);
      const k = easeInOut(1 - this._droneOut / 0.9);
      const r = this._droneRelease;
      g.visible = this._droneOut > 0;
      g.position.set(
        r.x - Math.sin(this._droneReleaseYaw) * k * 5,
        r.y + 2.75 + k * 16,
        r.z - Math.cos(this._droneReleaseYaw) * k * 5
      );
      g.rotation.set(-0.3 * k, this._droneReleaseYaw, 0);
      for (const c of dr.cables) c.visible = false;
      dr.hook.visible = false;
    } else {
      g.visible = false;
      return;
    }
    for (let i = 0; i < dr.rotors.length; i++) dr.rotors[i].rotation.y += dt * (i % 2 ? -38 : 38);
    dr.halo.rotation.z += dt * 1.5;
  }

  _emitContinuous(dt, vp) {
    const P = this._world?.particles;
    if (!P || typeof P.emit !== 'function') return;
    const s = this.isPlayer ? 1 : 0.5;
    const F = this._fx;
    const spd = Math.abs(this.speed);
    const fwx = this.forward.x;
    const fwz = this.forward.z;

    // drift sparks / smoke at the rear wheels
    const D = this.drift;
    if (D.active && this.grounded && this.respawnTime <= 0) {
      const lvl = D.level;
      F.drift += dt * (lvl > 0 ? 34 + lvl * 8 : 14) * s;
      const n = Math.floor(F.drift);
      if (n > 0) {
        F.drift -= n;
        const fx = DRIFT_FX[lvl];
        for (let i = 0; i < 2; i++) {
          getWheel(this, i, _v1);
          // sparks fly backwards & outwards from the drift
          const out = -D.dir * (i === 0 ? 1 : 0.6);
          _fxOpts.velocity.set(-fwx * 4 + this.right.x * out * 2.5, 2.2, -fwz * 4 + this.right.z * out * 2.5);
          if (lvl > 0) this._emit('spark', _v1, n, fx.color, fx.color2, 2.6, 0.24 + lvl * 0.04, 0.32, _fxOpts.velocity.x, 2.2, _fxOpts.velocity.z);
          else this._emit('smoke', _v1, n, fx.color, fx.color2, 0.8, 0.55, 0.45, -fwx * 2, 0.8, -fwz * 2);
        }
      }
    } else F.drift = 0;

    // off-road dust
    if (this.offroad && this.grounded && spd > 4 && this.respawnTime <= 0) {
      F.dust += dt * (6 + spd * 0.7) * s;
      const n = Math.floor(F.dust);
      if (n > 0) {
        F.dust -= n;
        this._wheelToggle = !this._wheelToggle;
        getWheel(this, this._wheelToggle ? 0 : 1, _v1);
        this._emit('dust', _v1, n, this._dustColor, '#ffffff', 1.4, 0.9, 0.7, -fwx * spd * 0.12, 1.4, -fwz * spd * 0.12);
      }
    } else F.dust = 0;

    // boost flames from the exhausts
    if (this.boostTime > 0 && this.respawnTime <= 0) {
      F.flame += dt * 32 * (this.isPlayer ? 1 : 0.6);
      const n = Math.floor(F.flame);
      if (n > 0) {
        F.flame -= n;
        const fx = this._boostFx || FLAME_FX.normal;
        for (let i = 0; i < 2; i++) {
          getExhaust(this, i, _v1);
          this._emit('boostFlame', _v1, n, fx.color, fx.color2, 0.6, 0.5 + 0.2 * this.boostStrength, 0.22, this._vh.x * 0.6 - fwx * 5, 0.3, this._vh.z * 0.6 - fwz * 5);
        }
      }
    } else F.flame = 0;

    // stall smoke / countdown revving puffs
    const revving = this._world?.phase === 'countdown' && this.controls.throttle > 0.5;
    if (this.stallTime > 0 || revving) {
      F.smoke += dt * (this.stallTime > 0 ? 26 : 7) * s;
      const n = Math.floor(F.smoke);
      if (n > 0) {
        F.smoke -= n;
        getExhaust(this, this._wheelToggle ? 0 : 1, _v1);
        this._wheelToggle = !this._wheelToggle;
        if (this.stallTime > 0) this._emit('smoke', _v1, n, '#34343c', '#7a7a86', 0.7, 0.9, 1.0, -fwx, 2.2, -fwz);
        else this._emit('smoke', _v1, n, '#d9dde6', '#ffffff', 0.4, 0.4, 0.5, -fwx * 2, 0.8, -fwz * 2);
      }
    } else F.smoke = 0;

    // halo overdrive sparkles
    if (this.invincibleTime > 0) {
      F.halo += dt * 22 * s;
      const n = Math.floor(F.halo);
      if (n > 0) {
        F.halo -= n;
        _v1.copy(vp);
        _v1.y += 0.9;
        this._emit('star', _v1, n, '#fff27a', '#ffffff', 1.6, 0.32, 0.55, -fwx * 3, 1.2, -fwz * 3);
      }
    } else F.halo = 0;

    // hard braking skid smoke
    if (this.grounded && !this.offroad && this.controls.brake > 0 && this.speed > 14 && !this.isStunned()) {
      F.skid += dt * 16 * s;
      const n = Math.floor(F.skid);
      if (n > 0) {
        F.skid -= n;
        getWheel(this, this._wheelToggle ? 0 : 1, _v1);
        this._wheelToggle = !this._wheelToggle;
        this._emit('smoke', _v1, n, '#e6e8ee', '#ffffff', 0.6, 0.6, 0.5, 0, 0.6, 0);
      }
    } else F.skid = 0;
  }

  dispose() {
    try {
      this.racer.dispose();
    } catch {
      /* ignore */
    }
    if (this._drone) this._drone.group.removeFromParent();
    this.object3d.removeFromParent();
  }
}

// ---------------------------------------------------------------------------------------------------------
// anchor helpers (fall back to local offsets when the model has no anchors)
// ---------------------------------------------------------------------------------------------------------
function anchorWorld(kart, name, lx, ly, lz, out) {
  const a = kart.racer?.anchors?.[name];
  if (a && a.getWorldPosition && kart.object3d.parent) return a.getWorldPosition(out);
  const p = kart.object3d.parent ? kart.object3d.position : kart.position;
  return out.set(
    p.x + kart.forward.x * lz - kart.right.x * lx,
    p.y + ly,
    p.z + kart.forward.z * lz - kart.right.z * lx
  );
}
function getWheel(kart, i, out) {
  return i === 0 ? anchorWorld(kart, 'wheelRL', 0.72, 0.12, -0.75, out) : anchorWorld(kart, 'wheelRR', -0.72, 0.12, -0.75, out);
}
function getExhaust(kart, i, out) {
  return i === 0 ? anchorWorld(kart, 'exhaustL', 0.38, 0.5, -1.15, out) : anchorWorld(kart, 'exhaustR', -0.38, 0.5, -1.15, out);
}

// ---------------------------------------------------------------------------------------------------------
// collisions
// ---------------------------------------------------------------------------------------------------------

function kartMass(k) {
  let m = k._mass ?? Math.pow(Math.max(1, k.weight || 3), 1.3);
  if (k.shrinkTime > 0) m *= 0.35;
  if (k.invincibleTime > 0) m *= 25;
  return m;
}

function syncSpeed(k) {
  if (!k._vh) return;
  k.speed = k._vh.x * k.forward.x + k._vh.z * k.forward.z;
  k._speedOut = k.speed;
  k.velocity.x = k._vh.x;
  k.velocity.z = k._vh.z;
}

/** Weight-based kart-kart bumping. Halo karts spin out the karts they touch; normal karts squish shrunk ones. */
export function resolveKartCollisions(karts, world) {
  if (!karts) return;
  const n = karts.length;
  for (let i = 0; i < n; i++) {
    const a = karts[i];
    if (a.respawnTime > 0) continue;
    for (let j = i + 1; j < n; j++) {
      const b = karts[j];
      if (b.respawnTime > 0) continue;
      const dy = b.position.y - a.position.y;
      if (dy > 1.6 || dy < -1.6) continue;
      let dx = b.position.x - a.position.x;
      let dz = b.position.z - a.position.z;
      const ra = a.radius * 0.84 * (a.shrinkTime > 0 ? 0.62 : 1);
      const rb = b.radius * 0.84 * (b.shrinkTime > 0 ? 0.62 : 1);
      const r = ra + rb;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) {
        dx = Math.sin(a.index * 1.7 + 0.3);
        dz = Math.cos(a.index * 1.7 + 0.3);
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const overlap = r - Math.min(d, r);

      // squish: a normal-size kart running over a shrunk one
      const aSmall = a.shrinkTime > 0;
      const bSmall = b.shrinkTime > 0;
      if (aSmall !== bSmall) {
        const small = aSmall ? a : b;
        const big = aSmall ? b : a;
        const rel = Math.hypot(big._vh.x - small._vh.x, big._vh.z - small._vh.z);
        if (rel > 3 && small.squish?.(big)) continue;
      }

      // halo overdrive: touching karts spin out
      const aInv = a.invincibleTime > 0;
      const bInv = b.invincibleTime > 0;
      if (aInv !== bInv) {
        const victim = aInv ? b : a;
        const hero = aInv ? a : b;
        if (victim.isVulnerable() && victim.spinTime <= 0 && victim.launchTime <= 0) {
          if (victim.spinOut(1.1)) {
            const s = aInv ? 1 : -1; // push the victim away from the hero
            victim._vh.x += nx * 9 * s;
            victim._vh.z += nz * 9 * s;
            syncSpeed(victim);
            world?.events?.emit?.('hit', { victim, attacker: hero, itemId: 'halo' });
          }
        }
      }

      const wa = 1 / kartMass(a);
      const wb = 1 / kartMass(b);
      const wsum = wa + wb;
      // positional correction
      a.position.x -= nx * overlap * (wa / wsum);
      a.position.z -= nz * overlap * (wa / wsum);
      b.position.x += nx * overlap * (wb / wsum);
      b.position.z += nz * overlap * (wb / wsum);
      // velocity response (with a minimum "bump" so rubbing karts still shove each other)
      const rel = (b._vh.x - a._vh.x) * nx + (b._vh.z - a._vh.z) * nz;
      if (rel < 0.5) {
        const jn = Math.max(-(1 + T.bumpRestitution) * Math.min(rel, 0), T.bumpMin) / wsum;
        a._vh.x -= nx * jn * wa;
        a._vh.z -= nz * jn * wa;
        b._vh.x += nx * jn * wb;
        b._vh.z += nz * jn * wb;
        syncSpeed(a);
        syncSpeed(b);
        const strength = -Math.min(rel, 0);
        if (strength > 1.5 && a._bumpCooldown <= 0 && b._bumpCooldown <= 0) {
          a._bumpCooldown = b._bumpCooldown = 0.3;
          _v1.set((a.position.x + b.position.x) * 0.5, (a.position.y + b.position.y) * 0.5 + 0.5, (a.position.z + b.position.z) * 0.5);
          const src = a.isPlayer ? a : b;
          src._emit('spark', _v1, Math.round(clamp(strength * 1.5, 5, 16)), '#fff2a8', '#ffffff', 4, 0.22, 0.35, 0, 2.5, 0);
          src._sfx('kartBump', 0.9 + ((a.index * 7 + b.index * 3) % 5) * 0.05, clamp(0.4 + strength / 14, 0.4, 1));
          if (a.isPlayer) a._impact(clamp(strength / 25, 0.1, 0.35) * (wa / wsum) * 2);
          if (b.isPlayer) b._impact(clamp(strength / 25, 0.1, 0.35) * (wb / wsum) * 2);
        }
      }
    }
  }
  // keep bumped karts out of walls (cheap: only karts that moved this call are affected anyway)
}

/**
 * Static / moving track hazards: { position, radius, effect: 'bump'|'spin'|'launch', active, height?, onHit? }.
 *  - 'bump'  : solid obstacle (push out, bounce, speed loss, sparks) — solid for everyone.
 *  - 'spin'  : spins vulnerable karts out (1.1 s); immune karts (halo / respawn blink) drive through.
 *  - 'launch': launches vulnerable karts (0.8); immune karts drive through.
 * A kart hit by a spin/launch hazard ignores those hazards for a moment so it can drive away.
 */
const _hazardState = new WeakMap();
let _hazardClock = 0;

/** Track a (possibly moving) hazard's velocity from its position changes (positions update per rendered frame). */
function hazardVelocity(h, time) {
  let st = _hazardState.get(h);
  const p = h.position;
  if (!st) {
    st = { x: p.x, y: p.y, z: p.z, t: time, vx: 0, vz: 0 };
    _hazardState.set(h, st);
    return st;
  }
  const dx = p.x - st.x;
  const dz = p.z - st.z;
  const dtt = time - st.t;
  if (dx !== 0 || dz !== 0 || p.y !== st.y) {
    if (dtt > 1e-4 && dtt < 0.3) {
      const k = 0.6; // smooth frame-rate jitter
      st.vx += (dx / dtt - st.vx) * k;
      st.vz += (dz / dtt - st.vz) * k;
    } else {
      st.vx = 0;
      st.vz = 0;
    }
    st.x = p.x;
    st.y = p.y;
    st.z = p.z;
    st.t = time;
  } else if (dtt > 0.12) {
    st.vx = 0;
    st.vz = 0;
  }
  return st;
}

export function resolveHazardCollisions(karts, hazards, world) {
  if (!karts || !hazards || !hazards.length) return;
  _hazardClock += 1 / 120;
  const time = typeof world?.time === 'number' ? world.time : _hazardClock;
  for (let j = 0; j < hazards.length; j++) {
    const h = hazards[j];
    if (h && h.moving && h.position) hazardVelocity(h, time);
  }
  for (let i = 0; i < karts.length; i++) {
    const k = karts[i];
    if (k.respawnTime > 0) continue;
    for (let j = 0; j < hazards.length; j++) {
      const h = hazards[j];
      if (!h || h.active === false || !h.position) continue;
      const hr = h.radius ?? 1.2;
      const top = h.height ?? Math.max(1.6, hr * 1.4);
      const dy = k.position.y - h.position.y;
      if (dy > top || dy < -2.5) continue; // jumped over it / on another level
      let dx = k.position.x - h.position.x;
      let dz = k.position.z - h.position.z;
      const r = hr + k.radius * 0.72 * (k.shrinkTime > 0 ? 0.62 : 1);
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) {
        dx = -k.forward.x;
        dz = -k.forward.z;
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const pen = r - d;
      const effect = h.effect || 'bump';
      const solid = effect === 'bump';
      if (!solid) {
        if (!k.isVulnerable() || k._hazardCooldown > 0 || k.isStunned()) continue; // drive through
        let hit = false;
        if (effect === 'spin') hit = k.spinOut(1.1);
        else if (effect === 'launch') hit = k.launch(0.8);
        if (hit) {
          k._hazardCooldown = (effect === 'launch' ? k.launchTime : k.spinTime) + 1.0;
          // nudge off the hazard so we don't sit on it
          k.position.x += nx * pen * 0.5;
          k.position.z += nz * pen * 0.5;
          h.onHit?.(k, effect);
          world?.events?.emit?.('hazardHit', { kart: k, hazard: h, effect });
        }
        continue;
      }
      // solid: push out + bounce (relative to the hazard's own motion for moving obstacles)
      k.position.x += nx * pen;
      k.position.z += nz * pen;
      let hvx = 0;
      let hvz = 0;
      if (h.moving) {
        const st = _hazardState.get(h);
        if (st) {
          hvx = st.vx;
          hvz = st.vz;
        }
      }
      const hvn = hvx * nx + hvz * nz; // hazard speed towards the kart (> 0 = pushing it)
      const vn = (k._vh.x - hvx) * nx + (k._vh.z - hvz) * nz;
      if (vn < 0) {
        const vBefore = Math.hypot(k._vh.x - hvx, k._vh.z - hvz);
        k._vh.x -= nx * vn * 1.4;
        k._vh.z -= nz * vn * 1.4;
        const ratio = -vn / Math.max(4, vBefore);
        const loss = lerp(1, 0.65, smoothstep(0.1, 0.6, ratio));
        k._vh.x *= loss;
        k._vh.z *= loss;
        if (hvn > 1) {
          // rammed by a moving obstacle: always leave with at least a firm shove away from it
          const out = k._vh.x * nx + k._vh.z * nz;
          const want = hvn + 3;
          if (out < want) {
            k._vh.x += nx * (want - out);
            k._vh.z += nz * (want - out);
          }
        }
        syncSpeed(k);
        if (-vn > 2.5 && k._wallCooldown <= 0) {
          k._wallCooldown = 0.25;
          _v1.set(k.position.x - nx * 1.0, k.position.y + 0.5, k.position.z - nz * 1.0);
          k._emit('spark', _v1, 10, '#ffe08a', '#ffffff', 4, 0.22, 0.4, nx * 4, 3, nz * 4);
          k._sfx('wallBump', 1, clamp(0.4 + -vn / 20, 0.4, 1));
          if (k.isPlayer) k._impact(clamp(-vn / 30, 0.12, 0.5));
          h.onHit?.(k, 'bump');
        }
      }
    }
  }
}

export default Kart;
