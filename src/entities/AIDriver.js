// AIDriver (owner: AI agent) — computer-controlled drivers (also the player's autopilot). ARCHITECTURE.md §9.
//
// API CONTRACT:
//   new AIDriver(kart, { track, skill=0.8 (0..1), engine, personality={ lineOffset, aggression, driftiness } })
//   ai.update(dt, world) -> DriveControls     // call once per fixed physics step, BEFORE kart.update
//   ai.reset()
//
// Additions (optional for other modules):
//   export getRacingLine(track) -> RacingLine   precomputed per track, cached on track.path (see buildRacingLine)
//       { n, step, off: Float32Array (lateral of the line per centerline sample), lo/hi (usable lateral bounds),
//         px/pz (line XZ), kappa (line curvature, + = right), segId (Int16 corner id or -1), segs: [{ i0, i1, dir,
//         len, kappa }] (drift-worthy corners) }
//   ai.stats   { stuck, reverses, wallHits, respawns, drifts, miniTurbos: [blue, orange, purple], tricks, itemsUsed,
//                dodges, tac: { pass, box, coin, dodge, hazard: seconds spent on each tactical move } }
//   ai.diff    resolved difficulty { pace, rbUp, rbDown, maxMT, driftRate, lineSlop, offense }, ai.isRival, ai.isAutopilot
//   ai.debug   { mode, targetSpeed, targetLat, lineLat, item }  (read by src/debug/ai.js)
//   ai.personality (resolved), ai.skill (effective)
//
// How it drives:
//   * Racing line: a minimum-curvature line inside the usable road (bounded well inside the edges, more margin at
//     wall-less edges, forced through dash panels / ramps, pushed around static hazards and slow patches),
//     solved once per track by multi-scale relaxation. Speed profile per driver from the line curvature and the
//     kart's real steering authority (KART_TUNING), with a backward braking pass.
//   * Steering: pure pursuit on the line with a curvature-adaptive look-ahead (speed-scaled, shortened in tight
//     corners so the chord never cuts over the inner edge), using the velocity heading (handles slides / ice).
//     The desired yaw rate is mapped onto the kart's normal steering or, while drifting, onto the drift's
//     wide..tight blend, so drifts follow the line precisely.
//   * Drifts: corners long enough for a mini-turbo are pre-detected; the kart hops at corner entry, holds the
//     drift and releases at the exit (skilled drivers wait for orange / purple). Tricks off ramps.
//   * Tactical layer: item boxes when empty, dash panels, dodging threats / hazards / slower karts, recovering
//     from walls (reverse out), spins and wrong way. Items with reaction delay + personality.
//   * Rubber band: kart.topSpeedScale vs the player's progress (never applied to the player's own kart).
//
// Difficulty (ENGINE_CLASSES ai* fields, see src/data/engine.js; the player's autopilot ignores all of them):
//   * pace: kart.topSpeedScale = aiPace (+ per-character spread, + aiRivalPace for rivals) x rubber band
//   * rubber band is asymmetric: up to +aiRubberBand only when far behind the player, down to -aiRestrain when
//     ahead of the player (50cc AIs ease off a lot when leading)
//   * aiSkill: corner-speed margin, braking, line noise, mistakes, reaction; aiLineSlop blends the racing line
//     towards the road centre; aiDriftRate / aiMaxMiniTurbo gate drifting and the spark level released at
//   * items: itemAggression (reaction, appetite) and aiItemOffense (chance an attack item is aimed at someone)
//   * rivals: the aiRivals karts with the highest personality.rivalScore in the race get aiRivalSkill /
//     aiRivalPace on top (ai.isRival), so one or two AIs are the main threat at 100cc+

import { KART_TUNING } from './Kart.js';
import { ITEMS } from '../data/items.js';
import { clamp, clamp01, damp, lerp, smoothstep, wrapAngle, angleDiff, mulberry32, hashString } from '../core/utils.js';

const T = KART_TUNING;
const KART_HALF = 0.85;

// ---------------------------------------------------------------------------------------------------------
// Racing line (per track, cached on the TrackPath instance)
// ---------------------------------------------------------------------------------------------------------

export function getRacingLine(track) {
  const path = track.path || track;
  if (!path._aiLine) path._aiLine = buildRacingLine(path, track.hazards || []);
  return path._aiLine;
}

function buildRacingLine(path, hazards) {
  const N = path.count;
  const S = path.samples;
  const step = path.step;
  const lo = new Float32Array(N);
  const hi = new Float32Array(N);
  const off = new Float32Array(N);
  const cx = new Float32Array(N);
  const cz = new Float32Array(N);
  const rx = new Float32Array(N);
  const rz = new Float32Array(N);
  const wrap = (i) => ((i % N) + N) % N;

  // 1) usable bounds
  for (let i = 0; i < N; i++) {
    const s = S[i];
    cx[i] = s.pos.x;
    cz[i] = s.pos.z;
    rx[i] = s.rightH.x;
    rz[i] = s.rightH.z;
    const hw = s.halfWidth;
    const base = KART_HALF + 1.05;
    const mL = base + (s.wallL ? 0 : s.offL < 3 ? 1.6 : 0.8);
    const mR = base + (s.wallR ? 0 : s.offR < 3 ? 1.6 : 0.8);
    lo[i] = -hw + mL;
    hi[i] = hw - mR;
    if (lo[i] > hi[i]) lo[i] = hi[i] = (lo[i] + hi[i]) / 2;
  }
  // corner-inside extra margin: the pursuit chord cuts slightly inside; keep the apex a bit further out
  for (let i = 0; i < N; i++) {
    const k = S[i].curvature;
    const extra = 0.9 * smoothstep(0.012, 0.05, Math.abs(k));
    if (k > 0 && hi[i] - extra > lo[i]) hi[i] -= extra; // right turn: inside = right
    else if (k < 0 && lo[i] + extra < hi[i]) lo[i] += extra;
  }
  const narrow = (i, a, b) => {
    // intersect the bounds of sample i with [a, b] (only if the result is non-empty)
    const nl = Math.max(lo[i], a);
    const nh = Math.min(hi[i], b);
    if (nl <= nh) {
      lo[i] = nl;
      hi[i] = nh;
    }
  };
  const iOf = (d) => wrap(Math.round(path.wrapD(d) / step));

  // 2) slow patches & static hazards: exclude the side they occupy (pick the roomier side)
  const blockers = [];
  for (const z of path.zones || []) if (z.type === 'slow') blockers.push({ d0: z.d0, d1: z.d1, l0: z.lat0 - 1.2, l1: z.lat1 + 1.2 });
  for (const h of hazards) {
    if (!h || h.moving || !h.position) continue;
    const p = path.project(h.position, null, {});
    if (p.surface === 'wall' || p.surface === 'void' || Math.abs(p.height) > 4) continue;
    const r = (h.radius || 1.2) + KART_HALF + 1.0;
    blockers.push({ d0: p.d - r - 2, d1: p.d + r + 2, l0: p.lateral - r, l1: p.lateral + r });
  }
  for (const b of blockers) {
    const i0 = iOf(b.d0);
    const cnt = Math.max(1, Math.round((b.d1 - b.d0) / step));
    // decide side once for the whole blocker (middle sample)
    const im = wrap(i0 + (cnt >> 1));
    const roomL = b.l0 - lo[im];
    const roomR = hi[im] - b.l1;
    for (let k = 0; k <= cnt; k++) {
      const i = wrap(i0 + k);
      if (b.l1 < lo[i] || b.l0 > hi[i]) continue;
      if (roomR >= roomL) narrow(i, b.l1, Infinity);
      else narrow(i, -Infinity, b.l0);
    }
  }
  // 3) dash panels and ramps: force the line through them
  for (const z of path.zones || []) {
    if (z.type !== 'boost' && z.type !== 'ramp') continue;
    const inset = z.type === 'boost' ? 0.9 : 1.6;
    let a = z.lat0 + inset;
    let b = z.lat1 - inset;
    if (a > b) a = b = (z.lat0 + z.lat1) / 2;
    const i0 = iOf(z.d0 + 1);
    const cnt = Math.max(1, Math.round((z.d1 - z.d0 - 2) / step));
    for (let k = 0; k <= cnt; k++) narrow(wrap(i0 + k), a, b);
  }

  // 4) minimum-curvature relaxation, coarse to fine
  const px = new Float32Array(N);
  const pz = new Float32Array(N);
  const upd = () => {
    for (let i = 0; i < N; i++) {
      px[i] = cx[i] + rx[i] * off[i];
      pz[i] = cz[i] + rz[i] * off[i];
    }
  };
  for (let i = 0; i < N; i++) off[i] = clamp(0, lo[i], hi[i]);
  const passes = [
    [40, 60],
    [20, 80],
    [10, 100],
    [5, 120],
    [3, 120],
  ];
  for (const [k, iters] of passes) {
    if (k * 4 >= N) continue;
    for (let it = 0; it < iters; it++) {
      upd();
      for (let i = 0; i < N; i++) {
        const a = wrap(i - k);
        const b = wrap(i + k);
        const a2 = wrap(i - 2 * k);
        const b2 = wrap(i + 2 * k);
        // bi-Laplacian (min curvature) target blended with a little Laplacian (shortest path)
        const mcx = (4 * (px[a] + px[b]) - (px[a2] + px[b2])) / 6;
        const mcz = (4 * (pz[a] + pz[b]) - (pz[a2] + pz[b2])) / 6;
        const spx = (px[a] + px[b]) / 2;
        const spz = (pz[a] + pz[b]) / 2;
        const tx = mcx * 0.8 + spx * 0.2;
        const tz = mcz * 0.8 + spz * 0.2;
        const o = (tx - cx[i]) * rx[i] + (tz - cz[i]) * rz[i];
        off[i] = clamp(off[i] + (o - off[i]) * 0.55, lo[i], hi[i]);
      }
    }
  }
  // final light smoothing so the line has no kinks at constraint boundaries
  const tmp = new Float32Array(N);
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < N; i++) tmp[i] = (off[wrap(i - 2)] + 2 * off[wrap(i - 1)] + 2 * off[i] + 2 * off[wrap(i + 1)] + off[wrap(i + 2)]) / 8;
    for (let i = 0; i < N; i++) off[i] = clamp(tmp[i], lo[i], hi[i]);
  }
  upd();

  // 5) line curvature (+ = right) and arc length
  const kappa = new Float32Array(N);
  const ds = new Float32Array(N);
  const head = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = wrap(i - 1);
    const b = wrap(i + 1);
    head[i] = Math.atan2(px[b] - px[a], pz[b] - pz[a]);
    const j = wrap(i + 1);
    ds[i] = Math.max(0.05, Math.hypot(px[j] - px[i], pz[j] - pz[i]));
  }
  const W = 3;
  for (let i = 0; i < N; i++) {
    const a = wrap(i - W);
    const b = wrap(i + W);
    let len = 0;
    for (let k = -W; k < W; k++) len += ds[wrap(i + k)];
    kappa[i] = -wrapAngle(head[b] - head[a]) / Math.max(0.5, len);
  }
  // smooth curvature
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < N; i++) tmp[i] = (kappa[wrap(i - 2)] + kappa[wrap(i - 1)] + kappa[i] + kappa[wrap(i + 1)] + kappa[wrap(i + 2)]) / 5;
    kappa.set(tmp);
  }

  // 6) drift-worthy corner segments (same sign, radius < ~80, gaps < 10 samples merged)
  const kMin = 1 / 85;
  const segId = new Int16Array(N).fill(-1);
  const segs = [];
  // find a start index that is not inside a corner
  let start = 0;
  for (let i = 0; i < N; i++) {
    if (Math.abs(kappa[i]) < kMin * 0.5) {
      start = i;
      break;
    }
  }
  let cur = null;
  let gap = 0;
  for (let c = 0; c < N; c++) {
    const i = wrap(start + c);
    const k = kappa[i];
    const dir = Math.sign(k);
    const inCorner = Math.abs(k) >= kMin;
    if (cur) {
      if (inCorner && dir === cur.dir) {
        cur.i1 = i;
        cur.cnt += gap + 1;
        cur.kSum += Math.abs(k) * (gap + 1);
        gap = 0;
      } else if (!inCorner && gap < 10) {
        gap++;
      } else {
        segs.push(cur);
        cur = null;
        gap = 0;
      }
    }
    if (!cur && inCorner && !(segs.length && segs[segs.length - 1].i1 === i)) {
      cur = { i0: i, i1: i, dir, cnt: 1, kSum: Math.abs(k) };
      gap = 0;
    }
  }
  if (cur) segs.push(cur);
  const out = [];
  for (const s of segs) {
    let len = 0;
    for (let c = 0; c < s.cnt; c++) len += ds[wrap(s.i0 + c)];
    if (len < 18) continue;
    const seg = { i0: s.i0, i1: s.i1, dir: s.dir, len, kappa: s.kSum / s.cnt, id: out.length };
    out.push(seg);
    for (let c = 0; c < s.cnt; c++) segId[wrap(s.i0 + c)] = seg.id;
  }

  // 7) void danger per sample (wall-less edges nearby) — used for extra caution
  const voidSide = new Int8Array(N);
  for (let i = 0; i < N; i++) voidSide[i] = (S[i].wallL ? 0 : 1) | (S[i].wallR ? 0 : 2);

  return { n: N, step, off, lo, hi, px, pz, kappa, ds, segId, segs: out, voidSide, length: path.length };
}

// ---------------------------------------------------------------------------------------------------------
// Personalities
// ---------------------------------------------------------------------------------------------------------

const CHARACTER_FLAVOUR = {
  // skill: added to the engine skill; noise: line wander; drift: driftiness; aggr: item aggression;
  // react: item reaction multiplier (lower = faster); caution: corner-speed safety; late: late braking
  hina: { skill: 0.08, noise: 0.35, drift: 1.1, aggr: 0.85, react: 0.7, caution: 0.0, mistakes: 0.3 },
  aru: { skill: -0.02, noise: 1.5, drift: 1.15, aggr: 1.3, react: 0.9, caution: -0.04, mistakes: 1.8 },
  hoshino: { skill: 0.03, noise: 0.8, drift: 0.95, aggr: 0.7, react: 1.2, caution: 0.0, mistakes: 0.8, lazyStart: true },
  nonomi: { skill: 0.0, noise: 1.0, drift: 0.9, aggr: 1.1, react: 0.5, caution: 0.01, mistakes: 1, itemHappy: true },
  ayane: { skill: 0.0, noise: 0.6, drift: 0.95, aggr: 0.75, react: 1.0, caution: 0.04, mistakes: 0.6, careful: true },
  arisu: { skill: 0.01, noise: 1.0, drift: 1.0, aggr: 1.45, react: 0.6, caution: 0.0, mistakes: 1.1 },
  shiroko: { skill: 0.05, noise: 0.5, drift: 1.35, aggr: 1.0, react: 0.8, caution: 0.0, mistakes: 0.5 },
  serika: { skill: 0.02, noise: 0.9, drift: 1.05, aggr: 1.15, react: 0.8, caution: 0.0, mistakes: 0.9, feisty: true },
};
const DEFAULT_FLAVOUR = { skill: 0, noise: 1, drift: 1, aggr: 1, react: 1, caution: 0, mistakes: 1 };

// ---------------------------------------------------------------------------------------------------------
// AIDriver
// ---------------------------------------------------------------------------------------------------------

const MODE = { RACE: 'race', REVERSE: 'reverse', RECOVER: 'recover', WAIT: 'wait' };

export class AIDriver {
  constructor(kart, opts = {}) {
    this.kart = kart;
    this.track = opts.track || kart.track;
    this.path = this.track.path;
    this.engine = opts.engine || kart.engine || {};
    const flav = CHARACTER_FLAVOUR[kart.characterId] || DEFAULT_FLAVOUR;
    this.flavour = flav;
    const p = opts.personality || {};
    // Race's roster already folds its per-character skill offset into opts.skill (personality.skill present)
    const skillOff = typeof p.skill === 'number' ? 0 : flav.skill || 0;
    this.baseSkill = clamp((opts.skill ?? this.engine.aiSkill ?? 0.8) + skillOff, 0, 1);
    this.skill = this.baseSkill;
    const reck = clamp(p.recklessness ?? 0, 0, 1);
    this.personality = {
      lineOffset: p.lineOffset ?? 0,
      aggression: clamp((p.aggression ?? 1) * (flav.aggr ?? 1), 0.2, 2),
      driftiness: clamp((p.driftiness ?? 1) * (flav.drift ?? 1), 0.3, 1.6),
      noise: (flav.noise ?? 1) * (1 + reck * 0.4),
      mistakes: typeof p.mistakes === 'number' ? clamp(p.mistakes / 0.25, 0, 3) : flav.mistakes ?? 1,
      itemPatience: clamp(p.itemPatience ?? 0.5, 0, 1),
      startReaction: Math.max(0, p.startReaction ?? 0),
      lazyStart: p.lazyStart ?? !!flav.lazyStart,
      caution: (flav.caution || 0) - reck * 0.03,
    };
    // difficulty class (the player's autopilot always drives at full competence)
    this.isAutopilot = !!(kart.isPlayer || p.autopilot);
    this.isRival = false;
    this._rivalChecked = this.isAutopilot;
    const E = this.engine;
    this.diff = this.isAutopilot
      ? { pace: 1, rbUp: 0, rbDown: 0, maxMT: 3, driftRate: 1, lineSlop: 0, offense: 1 }
      : {
          pace: clamp((E.aiPace ?? 1) + (flav.skill || 0) * 0.12, 0.5, 1.1),
          rbUp: E.aiRubberBand ?? 0.08,
          rbDown: E.aiRestrain ?? (E.aiRubberBand ?? 0.08) / 2,
          maxMT: E.aiMaxMiniTurbo ?? 3,
          driftRate: E.aiDriftRate ?? 1,
          lineSlop: clamp(E.aiLineSlop ?? 0, 0, 0.8),
          offense: clamp(E.aiItemOffense ?? 1, 0, 1),
        };
    if (!this.isAutopilot) {
      // halve the AI's top-speed stat advantage / handicap so the field stays closer together (the rivals are
      // chosen to be the threats, not whoever has the fastest kart stats)
      const statRatio = (E.topSpeed || kart.topSpeed || 36) / Math.max(1, kart.topSpeed || E.topSpeed || 36);
      this.diff.pace *= Math.sqrt(clamp(statRatio, 0.8, 1.25));
    }
    if (!this.isAutopilot && typeof p.rivalScore === 'number') kart._aiRivalScore = p.rivalScore;
    this.rng = mulberry32(hashString(`${kart.id}:${kart.index}:${this.track.id || ''}`));
    this.line = getRacingLine(this.track);
    this.controls = { throttle: 0, brake: 0, steer: 0, drift: false, driftPressed: false, item: false, itemPressed: false, lookBack: false };
    this.stats = { stuck: 0, reverses: 0, wallHits: 0, respawns: 0, drifts: 0, miniTurbos: [0, 0, 0], tricks: 0, itemsUsed: 0, dodges: 0, tac: {} };
    this.debug = { mode: MODE.RACE, targetSpeed: 0, targetLat: 0, lineLat: 0, item: '' };
    this._buildSpeedProfile();
    this.reset();
  }

  reset() {
    this.mode = MODE.RACE;
    this.time = 0;
    this.modeTime = 0;
    this.stuckTime = 0;
    this.reverseDir = 1;
    this.wander = 0;
    this.wanderT = this.rng() * 100;
    this.shift = 0; // smoothed tactical lateral shift target blend
    this.tacLat = 0;
    this.tacW = 0;
    this.tacKind = '';
    this.driftSeg = -1;
    this.driftWant = 0;
    this.driftHeld = false;
    this.driftHopDir = 0;
    this.driftLowM = 0;
    this.nextDriftOk = 0;
    this.releaseAtLevel = 3;
    this.trickArmed = false;
    this.lastAirborne = false;
    this.prevSteer = 0;
    this.errPrev = 0;
    this.mistakeT = 0;
    this.mistakeBias = 0;
    this.nextMistake = 8 + this.rng() * 20;
    this.startPressAt = null;
    this.goTime = null;
    this.itemReadyAt = 0;
    this.itemPrevId = null;
    this.itemHeldSince = -1;
    this.itemHoldFor = 0;
    this.itemOffensive = true;
    this.itemNextPress = 0;
    this.wantItemHeld = false;
    this.itemPressQueued = false;
    this.lookBackQueued = false;
    this.lastHitTime = -10;
    this.prevSpin = false;
    this.prevRespawn = 0;
    this.prevWallCd = 0;
    this.rb = 1;
    this.lapSeen = 1;
    this.recoverTime = 0;
  }

  // --- per-kart speed profile from the line curvature ------------------------------------------------
  _buildSpeedProfile() {
    const L = this.line;
    const k = this.kart;
    const N = L.n;
    const handling = 1 + ((k.stats?.handling ?? 3) - 3) * T.handlingPerStat;
    const grip = clamp((k._themeGrip ?? 1) * (1 + ((k.stats?.traction ?? 3) - 3) * 0.05), 0.25, 1.3);
    const top = Math.max(10, k.topSpeed || 36);
    this.handling = handling;
    this.grip = grip;
    const gripF = lerp(0.9, 1, clamp01(grip)) * lerp(0.72, 1, clamp01(grip));
    const omegaAt = (v) => {
      const lowF = 1 - Math.exp(-v / 3.6);
      const hiF = 1 - T.steerHighSpeedLoss * smoothstep(0.45, 1.15, v / top);
      return T.steerRate * handling * lowF * hiF * gripF;
    };
    this.omegaAt = omegaAt;
    const caution = this.personality.caution;
    const safety = clamp(lerp(0.74, 0.9, this.skill) - caution - (grip < 0.8 ? 0.08 : 0), 0.55, 0.95);
    const vcap = top * 1.8;
    const prof = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const kap = Math.abs(L.kappa[i]);
      let v = vcap;
      if (kap > 1e-4) {
        for (let it = 0; it < 6; it++) v = Math.min(vcap, (safety * omegaAt(v)) / kap);
        // wall-less edges: a little more caution in corners
        if (L.voidSide[i]) v *= 0.95;
      }
      // difficulty pace: weaker classes also take corners with a bigger margin (not only a lower top speed)
      prof[i] = Math.max(8, v * this.diff.pace);
    }
    // braking pass (twice around for the loop)
    const aBrake = lerp(20, 30, this.skill) * (grip < 0.8 ? 0.7 : 1);
    for (let r = 0; r < 2; r++) {
      for (let c = N - 1; c >= 0; c--) {
        const i = c;
        const j = (i + 1) % N;
        const lim = Math.sqrt(prof[j] * prof[j] + 2 * aBrake * L.ds[i]);
        if (lim < prof[i]) prof[i] = lim;
      }
    }
    this.profile = prof;
  }

  // --- helpers -------------------------------------------------------------------------------------
  _idx(d) {
    const n = this.line.n;
    return ((Math.round(d / this.line.step) % n) + n) % n;
  }
  _lineLat(d) {
    const L = this.line;
    const f = this.path.wrapD(d) / L.step;
    const i0 = Math.floor(f) % L.n;
    const i1 = (i0 + 1) % L.n;
    const u = f - Math.floor(f);
    return L.off[i0] + (L.off[i1] - L.off[i0]) * u;
  }

  // ---------------------------------------------------------------------------------------------------
  update(dt, world = {}) {
    const k = this.kart;
    const c = this.controls;
    const L = this.line;
    const path = this.path;
    this.time += dt;
    this.modeTime += dt;
    c.driftPressed = false;
    c.itemPressed = false;
    c.lookBack = false;
    const p = k.proj;
    if (!p) return c;

    const phase = world.phase || 'racing';
    const racing = phase === 'racing';
    const speed = k.speed || 0;
    const top = Math.max(10, k.topSpeed);
    const dNow = p.d;
    const iNow = this._idx(dNow);

    // skill tweaks over the race (Hoshino wakes up after lap 1)
    if (this.personality.lazyStart && (k.lap || 1) >= 2 && this.skill < this.baseSkill + 0.06) {
      this.skill = Math.min(1, this.baseSkill + 0.06);
      this._buildSpeedProfile();
    }

    if (!this._rivalChecked && world.karts) this._pickRival(world);
    this._bookkeeping(world);
    this._rubberBand(dt, world);

    // ---- countdown: rocket start
    if (!racing) {
      c.steer = 0;
      c.brake = 0;
      c.drift = false;
      c.item = false;
      const cl = world.countdownLeft;
      if (this.startPressAt === null) {
        const sk = this.skill;
        const r = this.rng();
        if (this.personality.lazyStart) this.startPressAt = -0.25 - r * 0.3 - this.personality.startReaction; // presses after GO
        else if (r < sk * 0.85) this.startPressAt = lerp(0.8, 1.3, this.rng()); // rocket start window
        else if (r > 0.985 - (1 - sk) * 0.05) this.startPressAt = 2.6; // way too early: stall (rare)
        else this.startPressAt = lerp(-0.1, 0.6, this.rng());
      }
      c.throttle = typeof cl === 'number' && cl <= this.startPressAt ? 1 : 0;
      return c;
    }
    if (this.goTime === null) this.goTime = this.time;
    if (this.startPressAt < 0 && this.time - this.goTime < -this.startPressAt) {
      c.throttle = 0;
      c.steer = 0;
      return c;
    }

    // ---- stunned / respawning: nothing to do but keep inputs sane
    const stunned = k.respawnTime > 0 || k.spinTime > 0 || k.launchTime > 0;
    if (stunned) {
      c.throttle = 1;
      c.brake = 0;
      c.steer = 0;
      this._releaseDrift();
      this.stuckTime = 0;
      if (this.mode === MODE.REVERSE) this._setMode(MODE.RACE);
      this._items(dt, world, true);
      return c;
    }

    // ---- stuck detection -> reverse out
    const fwdDot = k.forward.x * p.frame.tan.x + k.forward.z * p.frame.tan.z;
    if (this.mode === MODE.RACE) {
      const slow = Math.abs(speed) < 2.2 && k.stallTime <= 0 && k.grounded;
      this.stuckTime = slow ? this.stuckTime + dt : Math.max(0, this.stuckTime - dt * 2);
      if (this.stuckTime > 0.9) {
        this.stuckTime = 0;
        this.stats.stuck++;
        // reverse only if the nose points into a wall / the wrong way; otherwise just pivot with throttle
        const nearEdge = p.edgeDist < 2.2 || p.surface !== 'road';
        if (nearEdge || fwdDot < 0.3) {
          this.stats.reverses++;
          this._setMode(MODE.REVERSE);
          // steer so the nose swings towards the track direction while backing up
          const wantYaw = Math.atan2(p.frame.tan.x, p.frame.tan.z);
          const err = angleDiff(k.yaw, wantYaw);
          this.reverseDir = err >= 0 ? 1 : -1; // + = we want to rotate left
          this.reverseFor = 0.8 + this.rng() * 0.5;
        }
      }
    }
    if (this.mode === MODE.REVERSE) {
      this._releaseDrift();
      c.throttle = 0;
      c.brake = 1;
      // reversing flips the yaw direction of the steering: to rotate left while backing, steer right
      c.steer = this.reverseDir;
      c.item = this.wantItemHeld;
      const aligned = Math.abs(angleDiff(k.yaw, Math.atan2(p.frame.tan.x, p.frame.tan.z))) < 0.5;
      if (this.modeTime > this.reverseFor || (this.modeTime > 0.45 && aligned && p.edgeDist > 2)) this._setMode(MODE.RACE);
      this.debug.mode = MODE.REVERSE;
      return c;
    }

    // ---- lateral plan --------------------------------------------------------------------------
    const skill = this.skill;
    // wander (pack spreads naturally; noisier for weaker drivers)
    this.wanderT += dt * (0.25 + 0.2 * (1 - skill));
    const wanderAmp = (0.35 + 1.6 * (1 - skill)) * this.personality.noise;
    this.wander = (Math.sin(this.wanderT * 1.7) * 0.6 + Math.sin(this.wanderT * 0.63 + 1.3) * 0.4) * wanderAmp;
    // occasional small mistakes (weaker / reckless drivers)
    this.mistakeT -= dt;
    this.nextMistake -= dt * (1 - skill) * this.personality.mistakes * 1.6;
    if (this.nextMistake <= 0) {
      this.nextMistake = 10 + this.rng() * 25;
      this.mistakeT = 0.35 + this.rng() * 0.4;
      this.mistakeBias = (this.rng() < 0.5 ? -1 : 1) * (0.2 + 0.35 * (1 - skill));
    }

    this._tactical(dt, world, dNow, speed);

    // ---- pure pursuit ----------------------------------------------------------------------------
    const vAbs = Math.max(4, Math.abs(speed));
    const kHere = Math.abs(L.kappa[iNow]);
    let look = 5.5 + vAbs * lerp(0.36, 0.3, skill);
    // shorten in tight corners so the chord stays inside the road (sagitta <= ~0.7)
    let kMax = kHere;
    for (let s = 4; s <= 24; s += 4) kMax = Math.max(kMax, Math.abs(L.kappa[this._idx(dNow + s)]));
    if (kMax > 1e-3) look = Math.min(look, Math.sqrt(5.6 / kMax));
    look = clamp(look, 5, 26);
    const dT = dNow + look;
    let lineLat = this._lineLat(dT);
    // weaker classes: wider, less optimal lines (blend towards the road centre, inside the usable bounds)
    if (this.diff.lineSlop > 0) {
      const iS = this._idx(dT);
      lineLat = lerp(lineLat, clamp(0, L.lo[iS], L.hi[iS]), this.diff.lineSlop);
    }
    const persOff = this.personality.lineOffset * 0.45 * (1 - smoothstep(0.008, 0.03, Math.abs(L.kappa[this._idx(dT)])));
    let lat = lineLat + persOff + this.wander * 0.6;
    if (this.tacW > 0.001) lat = lerp(lat, this.tacLat, this.tacW);
    // while drifting, aim a little wide of the apex: the drift's minimum yaw rate and the pursuit chord both
    // pull the kart inside, so this keeps it off the inner curb
    if (this.driftHeld) {
      const dDir = k.drift?.active ? k.drift.dir : this.driftHopDir;
      if (dDir) lat -= dDir * 1.3;
    }
    const iT = this._idx(dT);
    // hard bounds (road + margins); tactical moves may use a little more of the road
    const slack = this.tacW > 0.3 ? 0.9 : 0;
    lat = clamp(lat, L.lo[iT] - slack, L.hi[iT] + slack);
    this.debug.lineLat = lineLat;
    this.debug.targetLat = lat;
    const fT = (this._fT = path.frameAt(dT, this._fT));
    const tx = fT.pos.x + fT.rightH.x * lat;
    const tz = fT.pos.z + fT.rightH.z * lat;
    const dx = tx - k.position.x;
    const dz = tz - k.position.z;
    const wantYaw = Math.atan2(dx, dz);
    // heading reference: velocity direction when moving (drifts / ice), else the nose
    const vx = k.velocity.x;
    const vz = k.velocity.z;
    const vh = Math.hypot(vx, vz);
    let refYaw = k.yaw;
    if (vh > 6 && speed > 0) {
      const velYaw = Math.atan2(vx, vz);
      refYaw = k.yaw + angleDiff(k.yaw, velYaw) * (k.drift?.active ? 0.75 : 0.6);
    }
    const err = angleDiff(refYaw, wantYaw); // + = target is to the left
    const dist = Math.max(3, Math.hypot(dx, dz));
    let desRate = (2 * vAbs * Math.sin(clamp(err, -1.4, 1.4))) / dist; // + = turn left (yaw up)
    // damping on the heading error rate (steering lag compensation)
    const dErr = (err - this.errPrev) / Math.max(1e-3, dt);
    this.errPrev = err;
    desRate += clamp(dErr, -3, 3) * 0.06;

    // ---- drift decisions ---------------------------------------------------------------------------
    this._driftLogic(dt, world, dNow, iNow, speed, top, desRate, p);

    // ---- steering output ---------------------------------------------------------------------------
    let steer;
    const D = k.drift;
    const sqrtH = Math.sqrt(this.handling);
    if (D && D.active) {
      const base = T.driftBaseRate * sqrtH * lerp(0.85, 1, clamp01(this.grip));
      // yawRate = -dir * base * m ; want yawRate = desRate
      const m = (-desRate / (D.dir || 1)) / base;
      let rel;
      if (m >= 1) rel = (m - 1) / (T.driftTight - 1);
      else rel = -(1 - m) / (1 - T.driftWide);
      rel = clamp(rel, -1, 1);
      // skilled drivers bias towards steering into the drift (faster charge) when the line allows
      steer = rel * D.dir;
      // over-rotating only matters once the kart is actually pushed inside the line (an early drift before
      // the corner is fine: it counter-steers until the corner arrives)
      const roomIn = D.dir > 0 ? L.hi[iNow] + 0.6 - p.lateral : p.lateral - (L.lo[iNow] - 0.6);
      const over = m < T.driftWide * 0.8 && (roomIn < 0.4 || m < 0);
      this.driftLowM = over ? this.driftLowM + dt : Math.max(0, this.driftLowM - dt * 2);
    } else if (this.driftHeld && this.driftHopDir) {
      // during the hop keep the drift direction pressed
      steer = this.driftHopDir * 0.6;
    } else {
      const om = Math.max(0.4, this.omegaAt(vAbs));
      steer = -desRate / om;
      if (Math.abs(err) > 1.4) steer = err > 0 ? -1 : 1; // facing away (wrong way / after a spin)
    }
    if (this.mistakeT > 0) steer += this.mistakeBias;
    // tiny low-skill jitter
    steer = clamp(steer, -1, 1);
    c.steer = steer;
    c.drift = this.driftHeld;

    // ---- speed control ---------------------------------------------------------------------------
    const iAhead = this._idx(dNow + vAbs * 0.12 + 1);
    let vT = this.profile[iAhead];
    // lower-skill drivers are a touch slower overall (not only in corners)
    vT = Math.min(vT, k.maxSpeed * 3);
    const offLine = Math.abs(p.lateral - this._lineLat(dNow));
    // we are off the line in a corner: the profile assumed the line; slow down a bit
    if (offLine > 3 && Math.abs(L.kappa[iNow]) > 0.02) vT *= this.tacKind === 'pass' && this.tacW > 0.3 ? 0.97 : 0.92;
    // big heading error (recovering): ease off
    if (Math.abs(err) > 0.6) vT = Math.min(vT, lerp(top, top * 0.45, smoothstep(0.6, 1.4, Math.abs(err))));
    // void danger: sliding towards a wall-less edge
    const vs = L.voidSide[iNow];
    if (vs) {
      const side = p.lateral >= 0 ? 2 : 1;
      if (vs & side && p.edgeDist < 3.5) vT = Math.min(vT, top * 0.6);
    }
    this.debug.targetSpeed = vT;
    const drifting = D && D.active;
    const vmax = Math.max(1, k.maxSpeed || top);
    if (k.boostTime > 0 && speed <= vT + 2) {
      c.throttle = 1;
      c.brake = 0;
    } else if (speed > vT + (drifting ? 5 : 2.5)) {
      c.throttle = 0;
      c.brake = drifting ? 0 : clamp((speed - vT - 2.5) / 6, 0.2, 1);
    } else if (vT < vmax - 0.5) {
      c.throttle = clamp((vT / vmax - 0.35) / 0.65, 0.1, 1);
      c.brake = 0;
    } else {
      c.throttle = 1;
      c.brake = 0;
    }
    if (drifting && c.throttle < 0.6) c.throttle = 0.6; // keep the drift alive

    // ---- tricks off ramps ---------------------------------------------------------------------------
    if (!k.grounded && !k._hopping && k.respawnTime <= 0) {
      if (!this.lastAirborne) {
        this.trickArmed = this.rng() < lerp(0.55, 1, skill);
        this.trickDelay = lerp(0.3, 0.06, skill) + this.rng() * 0.08;
        this.airT = 0;
      }
      this.airT += dt;
      if (this.trickArmed && this.airT >= this.trickDelay && !this.driftHeld) {
        c.driftPressed = true;
        this.trickArmed = false;
        this.stats.tricks++;
      }
      this.lastAirborne = true;
    } else this.lastAirborne = false;

    // ---- items ---------------------------------------------------------------------------------
    this._items(dt, world, false);

    this.debug.mode = this.mode;
    return c;
  }

  _setMode(m) {
    this.mode = m;
    this.modeTime = 0;
  }

  _bookkeeping(world) {
    const k = this.kart;
    if (k.respawnTime > 0 && this.prevRespawn <= 0) this.stats.respawns++;
    this.prevRespawn = k.respawnTime;
    const cd = k._wallCooldown ?? 0;
    if (cd > this.prevWallCd + 0.1) this.stats.wallHits++;
    this.prevWallCd = cd;
    const spin = k.spinTime > 0 || k.launchTime > 0;
    if (spin && !this.prevSpin) this.lastHitTime = this.time;
    this.prevSpin = spin;
  }

  /** Once per race: am I one of the engine class's `aiRivals` strongest AIs (highest rivalScore)? */
  _pickRival(world) {
    this._rivalChecked = true;
    const k = this.kart;
    const n = this.engine.aiRivals ?? 0;
    const mine = k._aiRivalScore;
    if (!n || typeof mine !== 'number') return;
    let rank = 0;
    for (const o of world.karts) {
      if (o === k || typeof o._aiRivalScore !== 'number') continue;
      if (o._aiRivalScore > mine || (o._aiRivalScore === mine && (o.index ?? 0) < (k.index ?? 0))) rank++;
    }
    if (rank >= n) return;
    this.isRival = true;
    this.diff.pace += this.engine.aiRivalPace ?? 0;
    const sk = this.engine.aiRivalSkill ?? 0;
    this.baseSkill = clamp(this.baseSkill + sk, 0, 1);
    this.skill = clamp(this.skill + sk, 0, 1);
    this._buildSpeedProfile();
  }

  _rubberBand(dt, world) {
    const k = this.kart;
    const pl = world.player;
    let target = 1;
    const { rbUp, rbDown } = this.diff;
    if (!this.isAutopilot && pl && pl !== k && !pl.finished && world.mode !== 'tt' && world.phase === 'racing') {
      const gap = (k.progress ?? 0) - (pl.progress ?? 0); // + = we are ahead
      // behind: only a gentle push once clearly behind; ahead: ease off (strongly in the low classes)
      if (gap < 0) target = 1 + rbUp * smoothstep(30, 300, -gap);
      else target = 1 - rbDown * smoothstep(10, 160, gap);
      // Hoshino: lazy start, strong finish
      if (this.personality.lazyStart && (k.lap || 1) >= 2) target += 0.015;
    }
    this.rb = damp(this.rb, target, 0.8, dt);
    if (!k.isPlayer) k.topSpeedScale = this.isAutopilot ? this.rb : this.diff.pace * this.rb;
  }

  // --- tactical lateral targets: dodge threats / karts, go for item boxes & dash panels ------------
  _tactical(dt, world, dNow, speed) {
    const k = this.kart;
    const path = this.path;
    const L = this.line;
    const skill = this.skill;
    const v = Math.max(8, Math.abs(speed));
    let bestLat = 0;
    let bestW = 0;
    let kind = '';
    const myLatAt = (dd) => this._lineLat(dNow + dd) + this.personality.lineOffset * 0.3;
    const pickSide = (objLat, need, dd) => {
      const i = this._idx(dNow + dd);
      const lo = L.lo[i] - 0.6;
      const hi = L.hi[i] + 0.6;
      const cur = myLatAt(dd);
      const left = objLat - need;
      const right = objLat + need;
      const okL = left >= lo;
      const okR = right <= hi;
      if (okL && okR) return Math.abs(left - cur) < Math.abs(right - cur) ? left : right;
      if (okL) return left;
      if (okR) return right;
      return objLat - lo > hi - objLat ? lo : hi;
    };

    // 1) threats from items (ramen, decoys, grenades, rounds...) and track hazards
    const items = world.items;
    const react = lerp(22, 48, skill); // how far ahead we notice things
    if (items && items.getThreatsFor) {
      const threats = items.getThreatsFor(k);
      for (let t = 0; t < threats.length; t++) {
        const th = threats[t];
        if (th.kind === 'seeker' || th.kind === 'missile') continue; // cannot dodge those laterally
        const dd = th.distance;
        if (!(dd > 1 && dd < react)) continue;
        const r = (th.radius || 1) + KART_HALF + 0.8;
        const cur = myLatAt(dd);
        if (Math.abs((th.lateral ?? 0) - cur) > r + 0.5) continue;
        // low skill: sometimes does not see it
        if (((this.kart.index * 13 + Math.floor(th.position.x * 3)) % 100) / 100 > 0.55 + 0.45 * skill) continue;
        const w = 1 - smoothstep(react * 0.5, react, dd);
        if (w > bestW) {
          bestW = w;
          bestLat = pickSide(th.lateral ?? 0, r + 0.4, dd);
          kind = 'dodge';
        }
      }
    }
    const hz = this.track.hazards;
    if (hz && hz.length) {
      if (!this._hzHints) this._hzHints = new Map();
      for (let h = 0; h < hz.length; h++) {
        const H = hz[h];
        if (!H || H.active === false || !H.moving || !H.position) continue; // static ones are baked in the line
        const dx = H.position.x - k.position.x;
        const dz = H.position.z - k.position.z;
        if (dx * dx + dz * dz > react * react) continue;
        const hp = this._hzHints.get(H) || {};
        path.project(H.position, hp.index ?? null, hp);
        this._hzHints.set(H, hp);
        const dd = path.deltaD(hp.d, dNow);
        if (!(dd > 1 && dd < react) || Math.abs(hp.height) > 5) continue;
        const r = (H.radius || 1.2) + KART_HALF + 1.0;
        if (Math.abs(hp.lateral - myLatAt(dd)) > r + 0.5) continue;
        const w = 1 - smoothstep(react * 0.5, react, dd);
        if (w > bestW) {
          bestW = w;
          bestLat = pickSide(hp.lateral, r + 0.4, dd);
          kind = 'hazard';
        }
      }
    }

    // 2) slower karts ahead: pass on the roomier side instead of ramming
    if (bestW < 0.5 && world.karts && !world.noTraffic) {
      for (const o of world.karts) {
        if (o === k || !o.proj || o.respawnTime > 0) continue;
        if (Math.abs(o.position.y - k.position.y) > 3) continue;
        const dd = path.deltaD(o.proj.d, dNow);
        if (!(dd > 1.5 && dd < 14)) continue;
        const closing = speed - (o.speed || 0);
        if (closing < 1.5 && dd > 4) continue;
        const cur = myLatAt(dd);
        const need = 2.6;
        if (Math.abs(o.proj.lateral - cur) > need) continue;
        // aggressive drivers like to bump; the rest avoid
        const w = 0.75 * (1 - smoothstep(6, 14, dd)) * lerp(1, 0.6, clamp01(this.personality.aggression - 1));
        if (w > bestW) {
          bestW = w;
          bestLat = pickSide(o.proj.lateral, need + 0.3, dd);
          kind = 'pass';
        }
      }
    }

    // 3) item box when empty
    if (bestW < 0.3 && items && items.enabled !== false && !k.item && !k.roulette?.active && items.itemBoxes) {
      const boxes = items.itemBoxes;
      let bLat = 0;
      let bScore = Infinity;
      let bDd = 0;
      for (let b = 0; b < boxes.length; b++) {
        const B = boxes[b];
        if (!B.active || typeof B.d !== 'number') continue;
        const dd = path.deltaD(B.d, dNow);
        if (!(dd > 3 && dd < 55)) continue;
        const cur = myLatAt(dd);
        const diff = Math.abs(B.lateral - cur);
        const maxDetour = 3 + dd * 0.12;
        if (diff > maxDetour) continue;
        if (diff < bScore) {
          bScore = diff;
          bLat = B.lateral;
          bDd = dd;
        }
      }
      if (bScore < Infinity) {
        const w = 0.85 * (1 - smoothstep(40, 55, bDd));
        if (w > bestW) {
          bestW = w;
          bestLat = bLat;
          kind = 'box';
        }
      }
    }

    // 4) coins (low priority) when not maxed
    // (weak AIs, e.g. 50cc, do not go out of their way for credits)
    if (bestW < 0.2 && items && items.coinSpots && (k.coins ?? 0) < 10 && (this.isAutopilot || skill > 0.4)) {
      const coins = items.coinSpots;
      for (let b = 0; b < coins.length; b++) {
        const C = coins[b];
        if (!C.active || typeof C.d !== 'number') continue;
        const dd = path.deltaD(C.d, dNow);
        if (!(dd > 3 && dd < 30)) continue;
        if (Math.abs(C.lateral - myLatAt(dd)) > 3.5) continue;
        bestW = 0.5;
        bestLat = C.lateral;
        kind = 'coin';
        break;
      }
    }

    if (kind) this.stats.tac[kind] = (this.stats.tac[kind] || 0) + dt;
    // smooth the blend (reaction speed by skill)
    const rate = bestW > this.tacW ? lerp(3.5, 9, skill) : 2.2;
    if (bestW > 0.01) {
      if (this.tacW < 0.05 || kind !== this.tacKind) this.tacLat = bestLat;
      else this.tacLat = damp(this.tacLat, bestLat, 6, dt);
      if (kind === 'dodge' && this.tacKind !== 'dodge') this.stats.dodges++;
      this.tacKind = kind;
    } else if (this.tacW < 0.02) this.tacKind = '';
    this.tacW = damp(this.tacW, bestW, rate, dt);
  }

  // --- drifting ---------------------------------------------------------------------------------------
  _releaseDrift() {
    this.driftHeld = false;
    this.driftSeg = -1;
    this.driftHopDir = 0;
  }

  _driftLogic(dt, world, dNow, iNow, speed, top, desRate, p) {
    const k = this.kart;
    const L = this.line;
    const D = k.drift;
    const skill = this.skill;
    const driftiness = this.personality.driftiness;
    const v = Math.max(1, speed);

    // track mini-turbo levels for stats: when the drift ends while we asked for release
    if (this.driftHeld) {
      const seg = L.segs[this.driftSeg];
      if (!D.active) {
        // hop phase or drift was cancelled
        if (k.grounded && !k._hopping && this.time - this.driftStartT > 0.5) {
          if (globalThis.__AILOG && k.index === 0) console.log('nodrift', this.time.toFixed(2), k.speed.toFixed(1));
          this._releaseDrift();
          this.nextDriftOk = this.time + 0.4;
        }
        return;
      }
      this.driftHopDir = 0;
      let release = false;
      // observed charge rate (steering into / out of the drift changes it)
      const dc = D.charge - this.driftPrevCharge;
      if (dc > 0 && dc < 0.1) this.driftRate = damp(this.driftRate, dc / Math.max(1e-4, dt), 6, dt);
      this.driftPrevCharge = D.charge;
      // where is the corner exit?
      let remain = 0;
      if (seg) {
        const endD = seg.i1 * L.step;
        remain = this.path.deltaD(endD, dNow);
        if (remain < -30) remain = -1; // passed
      }
      const exitLead = v * lerp(0.28, 0.12, skill) + 2;
      if (remain < exitLead) {
        // at the exit: skilled drivers hold the drift a little longer (counter-steering) when the next spark
        // level is about to arrive, like a human would; never when the road turns the other way right after
        this.driftExitT += dt;
        const L2 = T.driftLevels;
        const tNext = D.level < 3 ? (L2[D.level] - D.charge) / Math.max(0.5, this.driftRate) : 99;
        const ext = lerp(0.12, 0.55, skill) * clamp(driftiness, 0.6, 1.3);
        const kAhead = L.kappa[this._idx(dNow + v * 0.5)];
        const opposite = seg ? kAhead * seg.dir < -1 / 70 : true;
        const safe = p.edgeDist > 3 && p.surface === 'road' && !opposite;
        if (!(safe && D.level < this.diff.maxMT && tNext < ext - this.driftExitT)) release = true;
      }
      // difficulty cap: weaker classes cash in the first spark they are allowed and sit out the rest of the corner
      if (D.level >= this.diff.maxMT && D.level < 3) {
        release = true;
        this._capRelease = Math.max(0, remain) / v;
      }
      // chosen level reached and the corner cannot give the next level anyway
      if (D.level >= this.releaseAtLevel && remain < v * 0.9) release = true;
      if (D.level >= 3) {
        // purple: release now and maybe re-drift if much corner remains
        release = true;
      }
      // over-rotating: the drift turns more than the line wants for a while
      if (this.driftLowM > lerp(0.25, 0.5, skill)) release = true;
      // danger: close to a wall / void on the outside
      if (p.edgeDist < 1.6 && p.surface !== 'road') release = true;
      if (k.offroad && D.level === 0) release = true;
      if (release) {
        if (globalThis.__AILOG && k.index === 0) console.log('rel', this.time.toFixed(2), 'lvl', D.level, 'remain', remain.toFixed(1), 'lowM', this.driftLowM.toFixed(2), 'edge', p.edgeDist.toFixed(1), p.surface, 'charge', D.charge.toFixed(2), 'lat', p.lateral.toFixed(1), 'line', this._lineLat(dNow).toFixed(1), 'lo', L.lo[iNow].toFixed(1), L.hi[iNow].toFixed(1), 'd', dNow.toFixed(0), 'dir', D.dir);
        if (D.level > 0) {
          this.stats.miniTurbos[D.level - 1]++;
        }
        this._releaseDrift();
        this.nextDriftOk = this.time + 0.35 + (this._capRelease || 0);
        this._capRelease = 0;
      }
      return;
    }

    // not drifting: should we start one?
    if (this.time < this.nextDriftOk) return;
    if (!k.grounded || k.offroad || k.isStunned?.()) return;
    if (speed < T.driftMinSpeedFrac * top + 3) return;
    if (this.tacW > 0.5 && this.tacKind !== 'box' && this.tacKind !== 'pass') return;
    const minTime = lerp(1.35, 0.95, skill) / clamp(driftiness, 0.5, 1.5);
    // look for the next corner segment within the entry window
    // hop a little before the corner (the hop lasts ~0.3 s before the drift engages)
    const entryLead = v * lerp(0.3, 0.45, skill) + 2;
    let seg = null;
    const here = L.segId[iNow];
    if (here >= 0) seg = L.segs[here];
    else {
      for (let s = 2; s <= entryLead; s += 2) {
        const id = L.segId[this._idx(dNow + s)];
        if (id >= 0) {
          seg = L.segs[id];
          break;
        }
      }
    }
    if (!seg) return;
    const endD = seg.i1 * L.step;
    const remain = this.path.deltaD(endD, dNow);
    if (remain < 0) return;
    const tRemain = remain / v;
    if (tRemain < minTime) return;
    // feasibility: required yaw rate within the drift's range
    const base = T.driftBaseRate * Math.sqrt(this.handling);
    const need = (v * seg.kappa) / base;
    if (need < T.driftWide * 1.1 || need > T.driftTight * 0.92) return;
    // skill gate (weaker drivers drift less often)
    const chance = clamp(lerp(0.35, 1, skill) * driftiness * this.diff.driftRate, 0, 1);
    const roll = ((seg.id * 7919 + k.index * 104729 + Math.floor(k.lap || 1) * 31) % 1000) / 1000;
    if (roll > chance) {
      this.nextDriftOk = this.time + tRemain; // skip this corner
      return;
    }
    // go: hop in the corner direction
    this.driftHeld = true;
    this.driftSeg = seg.id;
    this.driftHopDir = seg.dir;
    this.driftStartT = this.time;
    this.driftLowM = 0;
    this.driftExitT = 0;
    this.driftPrevCharge = 0;
    this.driftRate = 1;
    // target level: how long the corner lasts
    const L2 = T.driftLevels;
    const rateEst = 1 + T.driftChargeIn * 0.4;
    const reach = tRemain * rateEst;
    this.releaseAtLevel = reach > L2[2] + 0.2 && skill > 0.6 ? 3 : reach > L2[1] + 0.1 && skill > 0.35 ? 2 : 1;
    this.releaseAtLevel = Math.min(this.releaseAtLevel, this.diff.maxMT);
    this.stats.drifts++;
  }

  // --- items --------------------------------------------------------------------------------------------
  _items(dt, world, stunned) {
    const k = this.kart;
    const c = this.controls;
    const items = world.items;
    c.item = false;
    if (!items && !k.item) return;
    const id = k.item;
    const rouletteActive = !!k.roulette?.active;
    const held = items?.isHolding ? items.isHolding(k) : false;

    if (id !== this.itemPrevId) {
      this.itemPrevId = id;
      if (id) {
        const react = (lerp(1.6, 0.35, this.skill) * (this.flavour.react ?? 1) * lerp(0.7, 1.3, this.personality.itemPatience)) / clamp(this.engine.itemAggression ?? 0.8, 0.3, 1.2);
        this.itemReadyAt = this.time + react * (0.6 + this.rng() * 0.8);
        this.itemHoldFor = 3 + this.rng() * 10 * lerp(0.4, 1.3, this.personality.itemPatience) * (this.flavour.itemHappy ? 0.4 : 1);
        this.itemHeldSince = -1;
        // difficulty: is this item going to be aimed at somebody? (else shield / late untargeted use)
        this.itemOffensive = this.rng() < this.diff.offense;
        if (!this.itemOffensive) this.itemHoldFor *= 3;
      }
    }
    this.debug.item = id || (rouletteActive ? '...' : '');

    // keep holding a dragged item (shield) unless we decided to let go
    if (held && this.wantItemHeld) c.item = true;
    if (!held && !id) this.wantItemHeld = false;
    if (stunned || rouletteActive || this.time < this.itemReadyAt) {
      if (held && this.wantItemHeld) c.item = true;
      return;
    }
    const def = id ? ITEMS[id] : null;

    // is somebody behind us / ahead of us?
    const aggr = this.personality.aggression * (this.engine.itemAggression ?? 0.85);
    const incoming = k.incoming && k.incoming.some((w) => w.kind === 'missile' && (w.distance ?? 99) < 45);
    const tgtAhead = this._targetAhead(world, 35, lerp(1.6, 2.6, clamp01(aggr - 0.3)));
    const tgtBehind = this._targetBehind(world, 14);
    const straight = this._straightAhead(45);
    const press = () => {
      if (this.time < this.itemNextPress) return false;
      c.itemPressed = true;
      c.item = true;
      this.itemNextPress = this.time + 0.3;
      this.stats.itemsUsed++;
      return true;
    };
    const releaseHeld = (back = false) => {
      this.wantItemHeld = false;
      c.item = false;
      if (back) c.lookBack = true;
    };

    // a held single item (ramen / decoy / round / missile trailing behind)
    if (held && !id) {
      if (this.itemHeldSince < 0) this.itemHeldSince = this.time;
      const heldFor = this.time - this.itemHeldSince;
      const kind = this._heldKind;
      let let_go = false;
      let back = false;
      if (kind === 'projectile') {
        if (tgtAhead && this.itemOffensive && this.rng() < 0.2 * aggr + 0.05) let_go = true;
        else if (tgtBehind && tgtBehind.aligned && aggr > 0.9 && this.rng() < 0.02) {
          let_go = true;
          back = true;
        }
      } else if (kind === 'homing') {
        if ((k.place ?? 1) > 1 && !incoming && (this.itemOffensive || heldFor > this.itemHoldFor)) let_go = true;
      } else {
        // drops: when a rival is close behind (on our line)
        if (tgtBehind && tgtBehind.dist < 9 && !incoming) let_go = true;
        // aggressive: toss forward at a close target ahead
        if (!let_go && tgtAhead && tgtAhead.dist < 16 && aggr > 1.05 && this.rng() < 0.01) {
          let_go = true;
          back = true; // look-back held while releasing = toss forward
        }
      }
      if (!incoming && heldFor > this.itemHoldFor) let_go = true;
      if (let_go) releaseHeld(back);
      else c.item = true;
      return;
    }
    if (!def) return;
    this._heldKind = def.kind;

    // incoming missile: put something behind us
    if (incoming && (def.kind === 'drop' || def.kind === 'decoy' || def.kind === 'projectile' || def.kind === 'homing')) {
      if (!held && press()) this.wantItemHeld = true;
      return;
    }

    const place = k.place ?? 1;
    const itemHappy = !!this.flavour.itemHappy;
    const hitRecently = this.time - this.lastHitTime < 3;
    switch (def.kind) {
      case 'boost': {
        if (k.boostTime > 0.15) break;
        const slowNow = k.speed < k.topSpeed * 0.55 && k.grounded;
        if ((straight && k.grounded && !k.offroad) || slowNow || hitRecently || itemHappy || (k.offroad && k.speed > 5)) press();
        break;
      }
      case 'boostTimed': {
        if (k.cardTime > 0) {
          if (k.boostTime < 0.25) press();
        } else if (straight || itemHappy || k.speed < k.topSpeed * 0.6) press();
        break;
      }
      case 'drop':
      case 'decoy': {
        if (def.uses > 1) {
          // triple: deploy the trail first (shield), then drop one per rival behind
          const trail = items?.shieldCount ? items.shieldCount(k) : 0;
          if (trail === 0) press();
          else if (tgtBehind && tgtBehind.dist < 10) press();
          else if (this.time - this.itemReadyAt > this.itemHoldFor + 4) press();
        } else if (!held) {
          // pick it up behind us as a shield; decide later when to drop
          if (press()) {
            this.wantItemHeld = true;
            this.itemHeldSince = this.time;
          }
        }
        break;
      }
      case 'projectile': {
        if (def.uses > 1) {
          const orbit = items?.shieldCount ? items.shieldCount(k) : 0;
          if (orbit === 0) press();
          else if (tgtAhead && this.itemOffensive && this.rng() < 0.1 * aggr + 0.02) press();
          else if (!this.itemOffensive && this.time - this.itemReadyAt > this.itemHoldFor) press();
          else if (tgtBehind && tgtBehind.aligned && tgtBehind.dist < 12 && aggr > 1 && this.rng() < 0.02) {
            c.lookBack = true;
            press();
          }
        } else if (!held) {
          if (tgtAhead && this.itemOffensive && this.rng() < 0.08 * aggr) press(); // fires on release next step
          else if (press()) {
            this.wantItemHeld = true;
            this.itemHeldSince = this.time;
          }
        }
        break;
      }
      case 'homing': {
        if ((place <= 1 && !this._anyAhead(world)) || !this.itemOffensive) {
          // leading: keep it as a shield
          if (def.uses === 1 && !held && press()) {
            this.wantItemHeld = true;
            this.itemHeldSince = this.time;
          } else if (def.uses > 1 && (items?.shieldCount?.(k) ?? 0) === 0) press();
          break;
        }
        if (def.uses > 1) {
          const orbit = items?.shieldCount ? items.shieldCount(k) : 0;
          if (orbit === 0) press();
          else if (this.time >= this.itemNextPress + lerp(1.6, 0.2, clamp01(aggr - 0.2))) press();
        } else press();
        break;
      }
      case 'throwable': {
        if (tgtAhead && this.itemOffensive && tgtAhead.dist > 8 && tgtAhead.dist < 30) press();
        else if (tgtBehind && tgtBehind.dist < 10 && aggr > 0.8) {
          c.lookBack = true;
          press();
        } else if (this.time - this.itemReadyAt > 8 + this.itemHoldFor) press();
        break;
      }
      case 'leader': {
        if ((place > 1 && this.itemOffensive) || this.time - this.itemReadyAt > 40) press();
        break;
      }
      case 'invincible':
      case 'global':
      case 'coins':
      default:
        press();
        break;
    }
    if (this.flavour.feisty && this.itemOffensive && hitRecently && tgtAhead && (def.kind === 'projectile' || def.kind === 'throwable')) press();
  }

  _anyAhead(world) {
    return (this.kart.place ?? 1) > 1 && !!world.karts;
  }

  _targetAhead(world, range, cone) {
    const k = this.kart;
    if (!world.karts) return null;
    let best = null;
    for (const o of world.karts) {
      if (o === k || o.respawnTime > 0 || o.finished) continue;
      const dx = o.position.x - k.position.x;
      const dz = o.position.z - k.position.z;
      if (Math.abs(o.position.y - k.position.y) > 3.5) continue;
      const along = dx * k.forward.x + dz * k.forward.z;
      if (along < 3 || along > range) continue;
      const side = dx * k.right.x + dz * k.right.z;
      if (Math.abs(side) > cone + along * 0.05) continue;
      if (!best || along < best.dist) best = { kart: o, dist: along, side };
    }
    return best;
  }

  _targetBehind(world, range) {
    const k = this.kart;
    if (!world.karts) return null;
    let best = null;
    for (const o of world.karts) {
      if (o === k || o.respawnTime > 0) continue;
      const dx = o.position.x - k.position.x;
      const dz = o.position.z - k.position.z;
      if (Math.abs(o.position.y - k.position.y) > 3.5) continue;
      const along = -(dx * k.forward.x + dz * k.forward.z);
      if (along < 1.5 || along > range) continue;
      const side = dx * k.right.x + dz * k.right.z;
      if (Math.abs(side) > 3.5) continue;
      if (!best || along < best.dist) best = { kart: o, dist: along, side, aligned: Math.abs(side) < 1.8 };
    }
    return best;
  }

  _straightAhead(dist) {
    const L = this.line;
    const d0 = this.kart.proj.d;
    for (let s = 0; s <= dist; s += 5) if (Math.abs(L.kappa[this._idx(d0 + s)]) > 1 / 90) return false;
    return true;
  }
}

export default AIDriver;
