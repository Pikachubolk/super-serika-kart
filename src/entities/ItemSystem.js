// Item system (owner: items agent): item boxes, Credits pickups, roulette + odds, item usage, projectiles,
// hazards, item-vs-item / item-vs-kart collisions, hit handling and warnings. See ARCHITECTURE.md §8.
//
//   new ItemSystem({ scene, track, karts, particles, sfx, events, mode, rng, quality? })
//   items.update(dt, world)            fixed step (after kart physics)
//   items.updateVisual(dt, alpha)      once per rendered frame
//   items.useItem(kart)                Race calls this on controls.itemPressed (kart has an item or a roulette)
//   items.startRoulette(kart)          (also used internally on box pickup)
//   items.giveItem(kart, itemId)       debug / time trial
//   items.getThreatsFor(kart) -> [{ kind, position, velocity, distance, lateral, radius, targeting, itemId, owner }]
//   items.dispose()
//
// Extras (additions to the contract):
//   items.itemBoxes -> [{ position, active, d, lateral, ... }]   (for the AI: which boxes are available)
//   items.coinSpots -> [{ position, active, d, lateral }]
//   items.isHolding(kart) -> bool      kart is dragging an item behind (ramen / decoy / held round)
//   items.shieldCount(kart) -> n       items trailing / orbiting / held that can block hits
//   items.entities                     live item entities (read-only)
//   items.explode(position, radius, attacker, itemId, opts)
// Events emitted on `events`: 'itemGet' {kart,itemId}, 'itemUse' {kart,itemId}, 'itemBox' {kart,box},
//   'hit' {victim,attacker,itemId}, 'coin' {kart,amount}, 'explosion' {position,radius,itemId,attacker},
//   'tablet' {user,victims}, 'rouletteStart' {kart}

import * as THREE from 'three';
import { ITEMS, ITEM_ODDS } from '../data/items.js';
import { clamp, weightedPick } from '../core/utils.js';
import { ItemModels } from './items/models.js';
import { ItemBoxField } from './items/ItemBoxField.js';
import { CoinField } from './items/CoinField.js';
import {
  TUNING,
  RamenEntity,
  DecoyEntity,
  BulletEntity,
  MissileEntity,
  GrenadeEntity,
  SeekerEntity,
  PropFx,
  BoltFx,
} from './items/entities.js';

const ROULETTE_PLAYER = 2.4;
const ROULETTE_AI = 1.2;
const ROULETTE_MIN_STOP = 0.7;
const MAX_FREE_HAZARDS = 36;
const TAU = Math.PI * 2;
const HIT_CREDITS = 3;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const ZERO3 = new THREE.Vector3();

export class ItemSystem {
  constructor({ scene, track, karts, particles, sfx, events, mode, rng, quality } = {}) {
    this.scene = scene;
    this.track = track;
    this.path = track.path;
    this.karts = karts || [];
    this.particles = particles || null;
    this._sfxFn = sfx || null;
    this.events = events || null;
    this.mode = mode || 'vs';
    this.rng = typeof rng === 'function' ? rng : Math.random;
    this.enabled = this.mode !== 'tt';
    this.time = 0;
    this.visTime = 0;
    this.world = null;

    this.models = new ItemModels({ quality: quality || 'high' });
    this.entities = [];
    this.fx = [];
    this.states = new Map();
    this._threats = new Map();
    this._weights = {};
    this.tabletCooldown = 0;
    this.seekerCooldown = 0;

    this.boxes = new ItemBoxField(this, track.itemBoxSpots || []);
    if (!this.enabled) this.boxes.setVisible(false);
    this.coins = new CoinField(this, track.coinSpots || []);

    this._onBoxPickup = (kart, box) => {
      _v.copy(kart.velocity || ZERO3).multiplyScalar(0.6);
      this.particles?.emit('itemBoxBurst', box.position, { velocity: _v });
      this.sfx('itemBox', box.position);
      this._emit('itemBox', { kart, box });
      if (!kart.item && !kart.roulette?.active && !this._hasTriple(kart)) this.startRoulette(kart);
    };
    this._onCoinPickup = (kart, pos) => {
      kart.addCoins?.(1);
      _v.copy(kart.velocity || ZERO3).multiplyScalar(0.8);
      this.particles?.emit('coin', pos, { velocity: _v, count: 3 });
      this.sfx('coin', kart.position);
      this._emit('coin', { kart, amount: 1 });
    };
  }

  // ==============================================================================================
  // helpers
  // ==============================================================================================

  get itemBoxes() {
    return this.boxes.boxes;
  }

  get coinSpots() {
    return this.coins.coins;
  }

  sfx(name, pos, opts) {
    const fn = this._sfxFn || this.world?.sfx;
    if (!fn) return;
    try {
      fn(name, pos, opts);
    } catch {
      /* audio must never break the game */
    }
  }

  _emit(type, payload) {
    try {
      this.events?.emit?.(type, payload);
    } catch (err) {
      console.error('[ItemSystem] event handler failed', err);
    }
  }

  _state(kart) {
    let s = this.states.get(kart);
    if (!s) {
      s = {
        held: null,
        orbit: [],
        trail: [],
        orbitAngle: Math.random() * TAU,
        haloTime: 0,
        aura: null,
        auraAmt: 0,
        sparkleAcc: 0,
        ticks: 0,
        warn: [0, 1, 2, 3].map(() => ({ kind: 'missile', distance: 0 })),
      };
      this.states.set(kart, s);
    }
    return s;
  }

  _hasTriple(kart) {
    const s = this.states.get(kart);
    return !!s && (s.orbit.length > 0 || s.trail.length > 0);
  }

  isHolding(kart) {
    const s = this.states.get(kart);
    return !!s && (!!s.held || s.trail.length > 0);
  }

  shieldCount(kart) {
    const s = this.states.get(kart);
    if (!s) return 0;
    return (s.held ? 1 : 0) + s.trail.length + s.orbit.length;
  }

  /** Current leader (lowest place among unfinished karts). */
  findLeader() {
    let best = null;
    for (const k of this.karts) {
      if (k.finished) continue;
      if (!best || (k.place ?? 99) < (best.place ?? 99)) best = k;
    }
    return best;
  }

  /** The racer directly ahead of `kart` (closest unfinished kart with a better place) or null. */
  findTargetAhead(kart) {
    let best = null;
    const p = kart.place ?? 99;
    for (const k of this.karts) {
      if (k === kart || k.finished) continue;
      const kp = k.place ?? 99;
      if (kp >= p) continue;
      if (!best || kp > (best.place ?? 0)) best = k;
    }
    return best;
  }

  _addEntity(e) {
    this.entities.push(e);
    // cap resting hazards on the track: remove the oldest
    let statics = 0;
    for (const x of this.entities) if (x.alive && x.static) statics++;
    if (statics > MAX_FREE_HAZARDS) {
      for (const x of this.entities) {
        if (x.alive && x.static) {
          x.destroy('fizzle');
          break;
        }
      }
    }
    return e;
  }

  // ==============================================================================================
  // roulette
  // ==============================================================================================

  startRoulette(kart) {
    if (!kart) return false;
    if (!kart.roulette) kart.roulette = { active: false, time: 0, duration: 0, result: null };
    const r = kart.roulette;
    if (kart.item || r.active) return false;
    r.active = true;
    r.time = 0;
    r.duration = kart.isPlayer ? ROULETTE_PLAYER : ROULETTE_AI;
    r.result = this._rollItem(kart);
    this._state(kart).ticks = 0;
    this._emit('rouletteStart', { kart });
    return true;
  }

  _seekerInPlay() {
    if (this.seekerCooldown > 0) return true;
    for (const e of this.entities) if (e.alive && e.kind === 'seeker') return true;
    for (const k of this.karts) if (k.item === 'seeker' || (k.roulette?.active && k.roulette.result === 'seeker')) return true;
    return false;
  }

  _tabletInPlay() {
    if (this.tabletCooldown > 0) return true;
    for (const k of this.karts) if (k.item === 'tablet' || (k.roulette?.active && k.roulette.result === 'tablet')) return true;
    return false;
  }

  _rollItem(kart) {
    const n = this.karts.length;
    const place = clamp(kart.place || 1, 1, Math.max(1, n));
    let idx = n > 1 ? Math.round(((place - 1) * 7) / (n - 1)) : 3;
    // distance catch-up: far behind the leader -> better items
    const leader = this.findLeader();
    if (leader && leader !== kart && typeof kart.progress === 'number' && typeof leader.progress === 'number') {
      const gap = leader.progress - kart.progress;
      if (gap > 450) idx += 2;
      else if (gap > 220) idx += 1;
    }
    idx = clamp(idx, 0, ITEM_ODDS.length - 1);
    const odds = ITEM_ODDS[idx];
    const w = this._weights;
    for (const k in w) w[k] = 0;
    for (const k in odds) w[k] = odds[k];
    if (w.seeker && this._seekerInPlay()) w.seeker = 0;
    if (w.tablet && this._tabletInPlay()) w.tablet = 0;
    if (n <= 1) {
      w.seeker = 0;
      w.tablet = 0;
    }
    return weightedPick(this.rng, w) || 'drink';
  }

  _finishRoulette(kart) {
    const r = kart.roulette;
    r.active = false;
    r.time = r.duration;
    const id = ITEMS[r.result] ? r.result : 'drink';
    kart.item = id;
    kart.itemUses = ITEMS[id].uses ?? 1;
    if (id === 'card') kart.cardTime = 0;
    this._emit('itemGet', { kart, itemId: id });
    if (kart.isPlayer) this.sfx('itemGet', kart.position);
  }

  giveItem(kart, id) {
    if (!kart || !ITEMS[id]) return;
    const st = this._state(kart);
    this._clearTriples(kart, st);
    if (kart.roulette) kart.roulette.active = false;
    kart.item = id;
    kart.itemUses = ITEMS[id].uses ?? 1;
    kart.cardTime = 0;
  }

  // ==============================================================================================
  // item use
  // ==============================================================================================

  useItem(kart) {
    if (!kart) return;
    const r = kart.roulette;
    if (r?.active) {
      if (r.time >= ROULETTE_MIN_STOP) this._finishRoulette(kart);
      return;
    }
    const id = kart.item;
    const def = ITEMS[id];
    if (!def) return;
    const st = this._state(kart);
    const back = !!kart.controls?.lookBack;
    let used = true;

    switch (def.kind) {
      case 'boost': {
        kart.applyBoost?.(1.1, 1);
        this._consume(kart);
        this.sfx('boost', kart.position);
        this._boostFx(kart);
        this.fx.push(new PropFx(this, 'can', kart, { life: 1.4 }));
        break;
      }
      case 'boostTimed': {
        if (!(kart.cardTime > 0)) {
          kart.cardTime = def.duration ?? 7;
          this.fx.push(new PropFx(this, 'card', kart, { life: 0.9 }));
        }
        kart.applyBoost?.(1.1, 1);
        this.sfx('boost', kart.position);
        this._boostFx(kart, '#fff3a0');
        break;
      }
      case 'drop':
      case 'decoy': {
        if (def.uses > 1) {
          if (st.trail.length === 0) {
            this._deployTrail(kart, st, id, kart.itemUses || def.uses);
            this.sfx('itemUse', kart.position);
          } else {
            const e = st.trail.pop();
            e.attachedTo = null;
            e.attached = false;
            e.launch(back ? 'toss' : 'drop', kart);
            this.sfx(back ? 'throw' : 'itemUse', kart.position);
            kart.itemUses = st.trail.length;
            if (kart.itemUses <= 0) this._clearSlot(kart);
          }
        } else {
          if (st.held) this._releaseHeld(kart, st);
          const e = def.kind === 'decoy' ? new DecoyEntity(this, kart) : new RamenEntity(this, kart, id);
          this._attachHeld(kart, st, e);
          this._clearSlot(kart);
          this.sfx('itemUse', kart.position);
        }
        break;
      }
      case 'projectile':
      case 'homing': {
        const Cls = def.kind === 'projectile' ? BulletEntity : MissileEntity;
        if (def.uses > 1) {
          if (st.orbit.length === 0) {
            this._deployOrbit(kart, st, Cls, id, kart.itemUses || def.uses);
            this.sfx('itemUse', kart.position);
          } else {
            // fire the orbiter closest to the firing direction
            let bi = 0;
            let bd = -Infinity;
            const dir = back ? -1 : 1;
            for (let i = 0; i < st.orbit.length; i++) {
              const e = st.orbit[i];
              const dd = ((e.pos.x - kart.position.x) * kart.forward.x + (e.pos.z - kart.position.z) * kart.forward.z) * dir;
              if (dd > bd) {
                bd = dd;
                bi = i;
              }
            }
            const e = st.orbit.splice(bi, 1)[0];
            e.attachedTo = null;
            e.attached = false;
            e.mode = 'free';
            e.age = 0;
            e.fire(kart, back);
            this._fireFx(kart, e, back);
            kart.itemUses = st.orbit.length;
            if (kart.itemUses <= 0) this._clearSlot(kart);
          }
        } else {
          if (st.held) this._releaseHeld(kart, st);
          const e = new Cls(this, kart, id);
          this._attachHeld(kart, st, e);
          this._clearSlot(kart);
        }
        break;
      }
      case 'throwable': {
        const e = this._addEntity(new GrenadeEntity(this, kart));
        e.throw(kart, back);
        this._consume(kart);
        this.sfx('throw', kart.position);
        break;
      }
      case 'invincible': {
        const dur = def.duration ?? 7.5;
        kart.setInvincible?.(dur);
        st.haloTime = dur;
        this._consume(kart);
        this.sfx('halo', kart.position);
        _v.copy(kart.position);
        _v.y += 1;
        this.particles?.emit('flash', _v, { color: '#fff3b0', size: 6 });
        this.particles?.emit('ring', kart.position, { color: '#ffe66d', size: 9 });
        this.particles?.emit('halo', kart.position, { count: 14, size: 1.3 });
        break;
      }
      case 'global': {
        this._consume(kart);
        this._useTablet(kart);
        break;
      }
      case 'leader': {
        const e = this._addEntity(new SeekerEntity(this, kart));
        e.launch(kart);
        this._consume(kart);
        this.seekerCooldown = 10;
        this.sfx('fire', kart.position);
        _v.copy(kart.position);
        _v.y += 1.5;
        this.particles?.emit('flash', _v, { color: '#8fc4ff', size: 5 });
        this.particles?.emit('smoke', kart.position, { count: 5, color: '#cfe4ff', color2: '#8aa0c8' });
        break;
      }
      case 'coins': {
        const amount = def.amount ?? 3;
        kart.addCoins?.(amount);
        this._consume(kart);
        this.sfx('credits', kart.position);
        this.fx.push(
          new PropFx(this, 'bag', kart, {
            life: 0.9,
            onPeak: (p) => {
              this.particles?.emit('coin', p, { count: 9, spread: 4, velocity: kart.velocity });
              this.particles?.emit('flash', p, { color: '#ffe066', size: 3 });
            },
          })
        );
        this._emit('coin', { kart, amount });
        break;
      }
      default:
        used = false;
    }
    if (used) this._emit('itemUse', { kart, itemId: id });
  }

  _consume(kart) {
    kart.itemUses = Math.max(0, (kart.itemUses || 1) - 1);
    if (kart.itemUses <= 0) this._clearSlot(kart);
  }

  _clearSlot(kart) {
    kart.item = null;
    kart.itemUses = 0;
  }

  _boostFx(kart, color) {
    const P = this.particles;
    if (!P) return;
    kart.getRearPosition?.(1.3, _v);
    _v.y += 0.6;
    _v2.copy(kart.forward).multiplyScalar(-8).add(kart.velocity || ZERO3);
    P.emit('boostFlame', _v, { count: 10, velocity: _v2, spread: 3, size: 0.95 });
    if (color) P.emit('star', _v, { count: 5, color, spread: 3 });
    P.emit('ring', _v, { billboard: true, size: 3.5, color: color || '#ffd28a', life: 0.25 });
  }

  _fireFx(kart, e, back) {
    const P = this.particles;
    this.sfx('fire', kart.position);
    if (!P) return;
    _v.copy(e.pos);
    const col = e.kind === 'bullet' ? '#b8ffc8' : '#ffd0a0';
    P.emit('flash', _v, { color: col, size: 2.5, life: 0.12 });
    _v2.copy(kart.forward).multiplyScalar(back ? -6 : 6);
    P.emit('spark', _v, { count: 6, velocity: _v2, color: col, spread: 4 });
  }

  _attachHeld(kart, st, e) {
    e.attached = true;
    e.attachedTo = kart;
    e.mode = 'held';
    st.held = e;
    this._addEntity(e);
    this._positionAttachments(kart, st, 0);
    e.snap();
  }

  _releaseHeld(kart, st) {
    const e = st.held;
    st.held = null;
    if (!e || !e.alive) return;
    e.attachedTo = null;
    e.attached = false;
    e.age = 0;
    const back = !!kart.controls?.lookBack;
    if (e.kind === 'ramen' || e.kind === 'decoy') {
      e.launch(back ? 'toss' : 'drop', kart);
      this.sfx(back ? 'throw' : 'itemUse', kart.position);
    } else {
      e.mode = 'free';
      e.fire(kart, back);
      this._fireFx(kart, e, back);
    }
  }

  _deployTrail(kart, st, id, n) {
    for (let i = 0; i < n; i++) {
      const e = new RamenEntity(this, kart, id);
      e.attached = true;
      e.attachedTo = kart;
      e.mode = 'trail';
      st.trail.push(e);
      this._addEntity(e);
    }
    // lay them out in a line behind the kart immediately
    for (let i = 0; i < st.trail.length; i++) {
      const e = st.trail[i];
      kart.getRearPosition(TUNING.trailGap + i * TUNING.trailSpacing, e.pos);
    }
    this._positionAttachments(kart, st, 0);
    for (const e of st.trail) e.snap();
  }

  _deployOrbit(kart, st, Cls, id, n) {
    for (let i = 0; i < n; i++) {
      const e = new Cls(this, kart, id);
      e.attached = true;
      e.attachedTo = kart;
      e.mode = 'orbit';
      st.orbit.push(e);
      this._addEntity(e);
    }
    this._positionAttachments(kart, st, 0);
    for (const e of st.orbit) e.snap();
    this.particles?.emit('puff', kart.position, { count: 5, size: 1.1 });
  }

  /** Remove orbiting / trailing triples (debug giveItem). */
  _clearTriples(kart, st) {
    for (let i = st.orbit.length - 1; i >= 0; i--) {
      const e = st.orbit[i];
      e.attachedTo = null;
      e.destroy('fizzle');
    }
    for (let i = st.trail.length - 1; i >= 0; i--) {
      const e = st.trail[i];
      e.attachedTo = null;
      e.destroy('fizzle');
    }
    st.orbit.length = 0;
    st.trail.length = 0;
  }

  /** Kart got hit / respawned: held items drop, orbiters break, trailing bowls stay on the road. */
  _dropAttachments(kart, st, how) {
    if (st.held) {
      const e = st.held;
      st.held = null;
      e.attachedTo = null;
      e.attached = false;
      e.age = 0;
      if ((e.kind === 'ramen' || e.kind === 'decoy') && how !== 'destroy') e.launch('drop', kart);
      else e.destroy('break');
    }
    const hadTriple = st.orbit.length > 0 || st.trail.length > 0;
    for (let i = st.orbit.length - 1; i >= 0; i--) {
      const e = st.orbit[i];
      e.attachedTo = null;
      e.attached = false;
      e.destroy('break');
    }
    for (let i = st.trail.length - 1; i >= 0; i--) {
      const e = st.trail[i];
      e.attachedTo = null;
      e.attached = false;
      e.age = 0;
      if (how === 'destroy') e.destroy('break');
      else e.launch('drop', kart);
    }
    st.orbit.length = 0;
    st.trail.length = 0;
    if (hadTriple && kart.item && ITEMS[kart.item]?.uses > 1 && (ITEMS[kart.item].kind !== 'boost')) this._clearSlot(kart);
  }

  _positionAttachments(kart, st, dt) {
    const air = kart.proj ? Math.max(0, kart.position.y - kart.proj.groundY) : 0;
    // held item + trailing chain (rope-like)
    let prev = null;
    const n = (st.held ? 1 : 0) + st.trail.length;
    for (let i = 0; i < n; i++) {
      const e = i === 0 && st.held ? st.held : st.trail[st.held ? i - 1 : i];
      if (!prev) {
        kart.getRearPosition(TUNING.trailGap + (e.kind === 'decoy' ? 0.4 : 0), _v);
      } else {
        const dx = e.pos.x - prev.x;
        const dz = e.pos.z - prev.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-3 && dt > 0) _v.set(prev.x + (dx / d) * TUNING.trailSpacing, 0, prev.z + (dz / d) * TUNING.trailSpacing);
        else _v.copy(prev).addScaledVector(kart.forward, -TUNING.trailSpacing);
      }
      e.pos.x = _v.x;
      e.pos.z = _v.z;
      e.pos.y = kart.position.y + e.hover;
      const pr = e.ground();
      if (pr.surface !== 'void') e.pos.y = pr.groundY + e.hover + air;
      e.yaw = kart.yaw;
      prev = e.pos;
    }
    // orbiters
    if (st.orbit.length) {
      st.orbitAngle += TUNING.orbitSpeed * dt;
      const R = TUNING.orbitRadius * (kart.shrinkTime > 0 ? 0.7 : 1);
      const m = st.orbit.length;
      for (let i = 0; i < m; i++) {
        const e = st.orbit[i];
        const a = st.orbitAngle + (i * TAU) / m;
        e.pos.set(kart.position.x + Math.sin(a) * R, kart.position.y + e.hover + 0.15, kart.position.z + Math.cos(a) * R);
        e.ground();
        e.yaw = a + Math.PI / 2;
      }
    }
  }

  _useTablet(kart) {
    const n = this.karts.length;
    const victims = [];
    for (const k of this.karts) {
      if (k === kart || k.finished) continue;
      if (k.respawnTime > 0) continue;
      if (k.isVulnerable && !k.isVulnerable()) continue;
      const st = this._state(k);
      if (st.held) {
        const e = st.held;
        st.held = null;
        e.attachedTo = null;
        e.attached = false;
        e.destroy('break');
      }
      this._dropAttachments(k, st, 'destroy');
      if (k.roulette) k.roulette.active = false;
      k.item = null;
      k.itemUses = 0;
      k.cardTime = 0;
      const place = k.place || n;
      const frac = n > 1 ? clamp((n - place) / (n - 1), 0, 1) : 1;
      k.spinOut?.(0.6);
      k.shrink?.(4 + 4 * frac);
      victims.push(k);
      _v.copy(k.position);
      _v.y += 1;
      this.particles?.emit('zap', _v, { size: 1.2 });
      this.fx.push(new BoltFx(this, k));
      this.sfx('shrink', k.position);
      this._emit('hit', { victim: k, attacker: kart, itemId: 'tablet' });
    }
    this.tabletCooldown = 12;
    this.sfx('tablet');
    this.fx.push(new PropFx(this, 'tablet', kart, { life: 1.3 }));
    _v.copy(kart.position);
    _v.y += 3;
    this.particles?.emit('flash', _v, { color: '#7fe0ff', size: 7, life: 0.3 });
    this.particles?.emit('ring', _v, { color: '#35c8ff', size: 12, billboard: true, life: 0.5 });
    this._emit('tablet', { user: kart, victims });
  }

  // ==============================================================================================
  // hits & explosions
  // ==============================================================================================

  /**
   * Apply an item hit to a kart. effect: 'spin' | 'launch'. Returns true if the hit landed.
   * Hits make the victim lose 3 Credits (scattered as loose coins) and drop what they hold.
   */
  hitKart(victim, attacker, itemId, effect = 'spin', strength = 1) {
    if (!victim) return false;
    if (victim.respawnTime > 0) return false;
    if (victim.isVulnerable && !victim.isVulnerable()) return false;
    // a spinning kart can still be blown up by an explosion (Kart.launch allows it); Kart.spinOut refuses
    // karts that are already spinning / tumbling, so a victim never loses Credits twice for one stun
    if (effect !== 'launch' && victim.isStunned?.()) return false;
    let ok;
    if (effect === 'launch') ok = victim.launch?.(strength);
    else ok = victim.spinOut?.(1.1);
    if (ok === false) return false;
    const lost = victim.loseCoins?.(HIT_CREDITS) || 0;
    if (lost > 0) this.coins.scatter(victim, lost);
    this._dropAttachments(victim, this._state(victim), 'hit');
    // (the Kart emits its own hit stars + spin/launch sfx; add an impact flash + sparks on top)
    _v.copy(victim.position);
    _v.y += 1.1;
    _v2.copy(victim.velocity || ZERO3).multiplyScalar(0.5);
    this.particles?.emit('flash', _v, { color: '#fff6d8', size: 3.2, life: 0.12 });
    this.particles?.emit('spark', _v, { count: 10, velocity: _v2, color: '#ffffff', color2: '#ffd23f', spread: 8 });
    this.sfx('hit', victim.position);
    this._emit('hit', { victim, attacker: attacker || null, itemId });
    return true;
  }

  /** Blast: launches every vulnerable kart in `radius`, destroys items in range. */
  explode(pos, radius, attacker, itemId, opts = {}) {
    pos = pos.clone(); // callers often pass scratch vectors; nested explosions must not alias them
    const P = this.particles;
    P?.emit('explosion', pos, { size: radius * 0.62, floor: pos.y, color: opts.color, color2: opts.color2 });
    if (opts.color) P?.emit('ring', pos, { size: radius * 2.4, color: opts.color2 || opts.color });
    this.sfx('explosion', pos);
    this._emit('explosion', { position: pos, radius, attacker: attacker || null, itemId });
    // camera shake if the world camera supports it
    const cam = this.world?.camera;
    const player = this.world?.player;
    if (cam && typeof cam.shake === 'function' && player) {
      const d = player.position.distanceTo(pos);
      if (d < radius * 4) cam.shake(clamp(1.3 - d / (radius * 4), 0.25, 1));
    }
    for (const k of this.karts) {
      const dx = k.position.x - pos.x;
      const dz = k.position.z - pos.z;
      const dy = k.position.y - pos.y;
      if (dx * dx + dz * dz > radius * radius || Math.abs(dy) > radius * 0.7) continue;
      if (k.invincibleTime > 0) continue;
      this.hitKart(k, attacker, itemId, 'launch', opts.strength ?? 1);
    }
    for (const e of this.entities) {
      if (!e.alive || e === opts.source || e.kind === 'seeker') continue;
      const dx = e.pos.x - pos.x;
      const dz = e.pos.z - pos.z;
      if (dx * dx + dz * dz > radius * radius * 0.8 || Math.abs(e.pos.y - pos.y) > radius * 0.6) continue;
      if (e.attachedTo) {
        // an orbiting / held item in the blast just breaks
        e.destroy('break');
      } else if (e.kind === 'grenade') e.onItem(null);
      else e.destroy('break');
    }
  }

  _onEntityDestroyed(e, reason) {
    const P = this.particles;
    if (P && reason !== 'fall' && reason !== 'boom') {
      const p = e.pos;
      if (reason === 'splat') {
        P.emit('splash', p, { color: '#f2b35c', color2: '#c9782a', count: 16, floor: p.y - 0.1 });
        P.emit('noodle', p, { count: 10, floor: p.y - 0.1 });
      } else if (reason === 'fizzle') {
        P.emit('puff', p, { count: 4, size: 1 });
      } else if (reason === 'smash') {
        P.emit('puff', p, { count: 5 });
        P.emit('star', p, { count: 4, spread: 4 });
        P.emit('debris', p, { count: 5, size: 0.3, color: e.kind === 'ramen' ? '#e0392e' : e.kind === 'bullet' ? '#34d65f' : '#ff3b3b', floor: p.y - e.hover });
        this.sfx('hit', p, { volume: 0.5 });
      } else {
        P.emit('puff', p, { count: 6 });
        const col = e.kind === 'bullet' ? '#9cffb5' : e.kind === 'ramen' ? '#ffd28a' : '#ffc0a0';
        P.emit('spark', p, { count: 10, color: '#ffffff', color2: col, spread: 7 });
        P.emit('debris', p, { count: 5, color: e.kind === 'bullet' ? '#34d65f' : e.kind === 'ramen' ? '#e0392e' : '#5b606b', size: 0.3, floor: p.y - e.hover });
        if (e.kind === 'ramen') P.emit('splash', p, { color: '#f2b35c', color2: '#c9782a', count: 8, floor: p.y - 0.1 });
      }
    }
    const owner = e.attachedTo;
    if (owner) {
      const st = this._state(owner);
      if (st.held === e) st.held = null;
      let i = st.orbit.indexOf(e);
      if (i >= 0) {
        st.orbit.splice(i, 1);
        owner.itemUses = st.orbit.length;
        if (!st.orbit.length) this._clearSlot(owner);
      }
      i = st.trail.indexOf(e);
      if (i >= 0) {
        st.trail.splice(i, 1);
        owner.itemUses = st.trail.length;
        if (!st.trail.length) this._clearSlot(owner);
      }
      e.attachedTo = null;
    }
  }

  // ==============================================================================================
  // simulation
  // ==============================================================================================

  update(dt, world) {
    if (world) this.world = world;
    if (!this.particles && world?.particles) this.particles = world.particles;
    this.time += dt;
    this.tabletCooldown = Math.max(0, this.tabletCooldown - dt);
    this.seekerCooldown = Math.max(0, this.seekerCooldown - dt);
    const karts = this.karts;

    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (!Array.isArray(k.incoming)) k.incoming = [];
      k.incoming.length = 0;
    }
    const E = this.entities;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (!e.alive) continue;
      e.age += dt;
      e.savePrev();
    }
    for (let i = 0; i < karts.length; i++) this._updateKart(karts[i], dt);
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (e.alive && !e.attached) e.update(dt);
    }
    if (this.enabled) this.boxes.update(dt, karts, this._onBoxPickup);
    this.coins.update(dt, karts, this._onCoinPickup);
    this._collide();
    this._warnings();
    for (let i = 0; i < this.fx.length; i++) if (this.fx[i].alive) this.fx[i].update(dt);
    this._cleanup();
  }

  _updateKart(kart, dt) {
    const st = this._state(kart);
    const r = kart.roulette;
    if (r?.active) {
      r.time += dt;
      if (kart.isPlayer) {
        const p = clamp(r.time / r.duration, 0, 1);
        const ticks = Math.floor(20 * (1 - (1 - p) * (1 - p)));
        if (ticks > st.ticks) {
          st.ticks = ticks;
          this.sfx('rouletteTick', kart.position, { volume: 0.5 });
        }
      }
      if (r.time >= r.duration) this._finishRoulette(kart);
    }
    if (kart.cardTime > 0) {
      kart.cardTime = Math.max(0, kart.cardTime - dt);
      if (kart.cardTime === 0 && kart.item === 'card') this._clearSlot(kart);
    }
    if (st.haloTime > 0) st.haloTime = Math.max(0, st.haloTime - dt);

    const respawning = kart.respawnTime > 0;
    const stunned = kart.isStunned ? kart.isStunned() : kart.spinTime > 0 || kart.launchTime > 0;
    if ((stunned || respawning) && (st.held || st.orbit.length || st.trail.length)) {
      this._dropAttachments(kart, st, respawning ? 'destroy' : 'hit');
    }
    if (st.held && !kart.controls?.item) this._releaseHeld(kart, st);
    if (st.held || st.orbit.length || st.trail.length) this._positionAttachments(kart, st, dt);
  }

  _collide() {
    const E = this.entities;
    const n = E.length;
    for (let i = 0; i < n; i++) {
      const a = E[i];
      if (!a.alive || !a.collides) continue;
      for (let j = i + 1; j < n; j++) {
        const b = E[j];
        if (!b.alive || !b.collides) continue;
        if (a.static && b.static) continue;
        if (a.owner && a.owner === b.owner && (a.attached || b.attached || a.age < 0.6 || b.age < 0.6)) continue;
        if (a.attached && b.attached && a.attachedTo === b.attachedTo) continue;
        const r = a.radius + b.radius;
        const dx = a.pos.x - b.pos.x;
        const dz = a.pos.z - b.pos.z;
        if (dx * dx + dz * dz > r * r) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.6) continue;
        _v.addVectors(a.pos, b.pos).multiplyScalar(0.5);
        this.particles?.emit('flash', _v, { color: '#fff4d0', size: 2.2, life: 0.1 });
        this.sfx('hit', _v, { volume: 0.5, pitch: 1.3 });
        a.onItem(b);
        if (b.alive) b.onItem(a);
        if (!a.alive) break;
      }
    }
    const K = this.karts;
    for (let i = 0; i < n; i++) {
      const e = E[i];
      if (!e.alive || !e.collides) continue;
      for (let k = 0; k < K.length; k++) {
        const kart = K[k];
        if (kart.respawnTime > 0) continue;
        if (kart === e.owner && (e.attached || e.age < e.ownerGrace)) continue;
        if (e.attachedTo === kart) continue;
        const r = e.radius + (kart.radius ?? 1.3) * 0.8;
        const dx = e.pos.x - kart.position.x;
        const dz = e.pos.z - kart.position.z;
        if (dx * dx + dz * dz > r * r) continue;
        const dy = e.pos.y - kart.position.y;
        if (dy < -1.4 || dy > 2.6) continue;
        if (kart.invincibleTime > 0) e.onSmash(kart);
        else if (!this._shieldBlock(kart, e)) e.onKart(kart);
        if (!e.alive) break;
      }
    }
  }

  /**
   * An item reached a kart that carries shields: orbiting triples block from any side, a held / trailing item
   * blocks from behind. The closest shield and the incoming item destroy each other. Returns true if blocked.
   * (Shields usually intercept by plain item-vs-item contact first; this closes the gaps between orbiters.)
   */
  _shieldBlock(kart, e) {
    const st = this.states.get(kart);
    if (!st) return false;
    const n = st.orbit.length;
    let behind = false;
    if (!n) {
      if (!st.held && !st.trail.length) return false;
      const rel = (e.pos.x - kart.position.x) * kart.forward.x + (e.pos.z - kart.position.z) * kart.forward.z;
      if (rel > -0.4) return false;
      behind = true;
    }
    if (e.kind === 'grenade') return false; // it blows up anyway (onKart -> explode)
    let best = null;
    let bd = Infinity;
    const pick = (s) => {
      if (!s || !s.alive) return;
      const d = s.pos.distanceToSquared(e.pos);
      if (d < bd) {
        bd = d;
        best = s;
      }
    };
    if (behind) {
      pick(st.held);
      for (let i = 0; i < st.trail.length; i++) pick(st.trail[i]);
    } else for (let i = 0; i < n; i++) pick(st.orbit[i]);
    if (!best) return false;
    _v.addVectors(best.pos, e.pos).multiplyScalar(0.5);
    this.particles?.emit('flash', _v, { color: '#fff4d0', size: 2.2, life: 0.1 });
    this.sfx('hit', _v, { volume: 0.5, pitch: 1.3 });
    best.onItem(e);
    if (e.alive) e.onItem(best);
    if (e.alive) e.destroy('break');
    return true;
  }

  _warnings() {
    const E = this.entities;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (!e.alive || !e.target || (e.kind !== 'missile' && e.kind !== 'seeker')) continue;
      const t = e.target;
      const d = e.warningFor(t);
      if (d < 0) continue;
      const st = this._state(t);
      if (t.incoming.length >= st.warn.length) continue;
      const w = st.warn[t.incoming.length];
      w.kind = e.kind;
      w.distance = d;
      t.incoming.push(w);
    }
  }

  _cleanup() {
    const E = this.entities;
    let w = 0;
    for (let r = 0; r < E.length; r++) {
      const e = E[r];
      if (e.alive) E[w++] = e;
      else e.release();
    }
    E.length = w;
    const F = this.fx;
    w = 0;
    for (let r = 0; r < F.length; r++) {
      const f = F[r];
      if (f.alive) F[w++] = f;
      else f.release();
    }
    F.length = w;
  }

  // ==============================================================================================
  // AI helpers
  // ==============================================================================================

  getThreatsFor(kart) {
    let arr = this._threats.get(kart);
    if (!arr) {
      arr = [];
      arr.pool = [];
      this._threats.set(kart, arr);
    }
    arr.length = 0;
    if (!kart || !kart.proj) return arr;
    const path = this.path;
    const kd = kart.proj.d;
    const E = this.entities;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (!e.alive || e.attachedTo === kart) continue;
      if (e.kind !== 'seeker' && !e.hasProj) continue;
      if (e.owner === kart && e.age < 0.6) continue;
      const along = e.hasProj ? path.deltaD(e.proj.d, kd) : 0;
      let relevant = false;
      if (e.kind === 'seeker') relevant = e.target === kart && e.warningFor(kart) >= 0;
      else if (e.kind === 'missile') relevant = e.target === kart || (along > -3 && along < 60);
      else if (along > -3 && along < 70) relevant = true;
      else if (along < 0 && along > -45 && e.vel.lengthSq() > 4) {
        // fast thing coming from behind
        const closing = e.vel.x * kart.forward.x + e.vel.z * kart.forward.z;
        relevant = closing > Math.abs(kart.speed || 0);
      }
      if (!relevant) continue;
      let o = arr.pool[arr.length];
      if (!o) o = arr.pool[arr.length] = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
      o.kind = e.kind;
      o.itemId = e.itemId;
      o.position.copy(e.pos);
      o.velocity.copy(e.vel);
      o.distance = e.kind === 'seeker' ? e.warningFor(kart) : along;
      o.lateral = e.hasProj ? e.proj.lateral : 0;
      o.radius = e.kind === 'grenade' ? (e.blast || 7) * (e.fuse >= 0 && e.fuse < 0.5 ? 1 : 0.35) : e.radius;
      o.targeting = e.target === kart;
      o.owner = e.owner;
      o.static = e.static;
      arr.push(o);
    }
    return arr;
  }

  // ==============================================================================================
  // visuals
  // ==============================================================================================

  updateVisual(dt, alpha = 1) {
    this.visTime += dt;
    this.models.time.value = this.visTime;
    if (this.enabled) this.boxes.updateVisual(dt, this.visTime);
    this.coins.updateVisual(dt, alpha, this.visTime);
    const E = this.entities;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (e.alive && e.obj) e.visual(dt, alpha);
    }
    for (let i = 0; i < this.fx.length; i++) if (this.fx[i].alive) this.fx[i].visual(dt);
    for (let i = 0; i < this.karts.length; i++) this._kartVisual(this.karts[i], dt);
  }

  _kartVisual(kart, dt) {
    const st = this.states.get(kart);
    if (!st) return;
    const P = this.particles;
    const kp = kart.object3d ? kart.object3d.position : kart.position;
    const halo = st.haloTime > 0 && kart.invincibleTime > 0;
    const want = halo ? 1 : 0;
    st.auraAmt += (want - st.auraAmt) * (1 - Math.exp(-(want ? 10 : 4) * dt));
    if (st.auraAmt > 0.02) {
      if (!st.aura) {
        st.aura = this.models.acquire('aura');
        this.scene.add(st.aura);
      }
      const a = st.aura;
      a.position.copy(kp);
      const sh = kart.shrinkTime > 0 ? 0.6 : 1;
      const flick = 1 + Math.sin(this.visTime * 30) * 0.03;
      a.scale.set(sh * flick, sh * (0.9 + 0.1 * st.auraAmt), sh * flick);
      a.rotation.y = this.visTime * 2;
      const u = a.userData.parts.body.material.uniforms;
      u.uAlpha.value = st.auraAmt * 0.45; // keep the kart visible through the glow
      u.uTime.value = this.visTime;
      if (P && halo) {
        st.sparkleAcc += dt;
        if (st.sparkleAcc > 0.03) {
          st.sparkleAcc = 0;
          P.emit('halo', kp, { count: 1, size: 1.3 * sh, velocity: kart.velocity });
        }
      }
    } else if (st.aura) {
      this.models.release('aura', st.aura);
      st.aura = null;
    }
    // Sensei's card: golden sparkles trailing while active
    if (P && kart.cardTime > 0) {
      st.sparkleAcc += dt;
      if (st.sparkleAcc > 0.06) {
        st.sparkleAcc = 0;
        kart.getRearPosition?.(1.2, _v);
        _v.y += 0.8;
        P.emit('star', _v, { count: 1, color: '#ffe066', spread: 1.5, size: 0.8 });
      }
    }
  }

  // ==============================================================================================

  /** Remove every live item (e.g. on restart). */
  clearAll() {
    for (const e of this.entities) {
      e.alive = false;
      e.release();
    }
    this.entities.length = 0;
    for (const f of this.fx) f.release();
    this.fx.length = 0;
    this.coins.clearLoose();
    for (const [kart, st] of this.states) {
      st.held = null;
      st.orbit.length = 0;
      st.trail.length = 0;
      if (st.aura) this.models.release('aura', st.aura);
      st.aura = null;
      st.haloTime = 0;
      void kart;
    }
  }

  dispose() {
    this.clearAll();
    this.boxes.dispose();
    this.coins.dispose();
    this.models.dispose();
    this.states.clear();
    this._threats.clear();
  }
}

export default ItemSystem;
