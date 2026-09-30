// Player-facing race feedback (owner: race agent): turns simulation events into HUD toasts / flashes / banners,
// sounds, voices, camera shake and gamepad rumble. Owned and driven by Race.
//
//   const fb = new RaceFeedback(race)      subscribes to race.events ('hit', 'hazardHit', 'itemGet', 'itemUse',
//                                          'coin', 'tablet')
//   fb.update(dt)                          once per rendered frame (debounced place, incoming warnings,
//                                          impact / boost rumble, wrong-way sound, aggregated hit toasts)
//   fb.hudPlace                            debounced place shown by the HUD
//   fb.lap(lap, laps, lapTime, lapTimes)   lap banner + sfx (+ final-lap tempo, TT split vs record)
//   fb.finish(place, info)                 finish banner, jingle -> victory/defeat music, voice, confetti
//   fb.dispose()

import { ITEMS } from '../data/items.js';
import { clamp, formatRaceTime } from '../core/utils.js';

const HIT_PHRASE = {
  bullet: 'a Ricochet Round',
  bullet3: 'a Ricochet Round',
  missile: 'a Drone Missile',
  missile3: 'a Drone Missile',
  grenade: 'a Grenade',
  seeker: 'a Blue Seeker',
  decoy: 'a Decoy Box',
  ramen: 'Spilled Ramen',
  ramen3: 'Spilled Ramen',
};
const LAUNCH_ITEMS = new Set(['missile', 'missile3', 'grenade', 'seeker', 'decoy']);
const BAD = '#ff4d6d';
const GOOD = '#1fb6ff';
const GOLD = '#ffd23f';
const PLACE_DEBOUNCE = 0.18; // s a new place must hold before the HUD / sfx react (no flicker side by side)

function listNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names.length} rivals`;
}

export class RaceFeedback {
  constructor(race) {
    this.race = race;
    this.hudPlace = race.player?.place ?? 1;
    this._placeCand = this.hudPlace;
    this._placeHold = 0;
    this._pending = []; // player's hits on rivals, aggregated into one toast
    this._pendingT = 0;
    this._incoming = { missile: false, seeker: false };
    this._impactSeq = race.player?.impactSeq ?? 0;
    this._boosting = false;
    this._respawning = false;
    this._wrong = false;
    this._wrongT = 0;
    this._confetti = 0;
    this._confettiT = 0;
    const ev = race.events;
    this._offs = [
      ev.on('hit', (p) => this._guard(() => this._onHit(p))),
      ev.on('hazardHit', (p) => this._guard(() => this._onHazard(p))),
      ev.on('itemGet', (p) => this._guard(() => this._onItemGet(p))),
      ev.on('itemUse', (p) => this._guard(() => this._onItemUse(p))),
      ev.on('coin', (p) => this._guard(() => this._onCoin(p))),
      ev.on('tablet', (p) => this._guard(() => this._onTablet(p))),
    ];
  }

  get hud() {
    return this.race.hud;
  }
  get audio() {
    return this.race.game?.audio;
  }
  get player() {
    return this.race.player;
  }

  _guard(fn) {
    try {
      fn();
    } catch (err) {
      console.error('[Race] feedback failed', err);
    }
  }

  rumble(strong, weak, ms) {
    if (this.race.paused) return;
    try {
      this.race.game?.input?.rumble?.(clamp(strong, 0, 1), clamp(weak, 0, 1), ms);
    } catch {
      /* optional */
    }
  }

  voice(characterId, kind, volume = 1) {
    try {
      this.audio?.voice?.(characterId, kind, { volume });
    } catch {
      /* optional */
    }
  }

  notify(text, opts) {
    try {
      this.hud?.notify(text, opts);
    } catch {
      /* ignore */
    }
  }

  flash(kind, opts) {
    try {
      this.hud?.flash(kind, opts);
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------------------------------------ events

  _onHit({ victim, attacker, itemId } = {}) {
    const P = this.player;
    if (!victim || !P) return;
    const race = this.race;
    if (victim === P) {
      if (race.phase === 'finished' && P.finished) return;
      const self = !attacker || attacker === P;
      const an = attacker?.name || 'Someone';
      const itemName = ITEMS[itemId]?.name || 'an item';
      let text;
      if (itemId === 'tablet') text = `${an}'s Shittim Tablet shrank you!`;
      else if (itemId === 'squish') text = `${an} squished you flat!`;
      else if (itemId === 'halo') text = `${an} rammed you with Halo Overdrive!`;
      else if (self) text = `Oops! Your own ${itemName} got you!`;
      else if (itemId === 'ramen' || itemId === 'ramen3') text = `You slipped on ${an}'s Spilled Ramen!`;
      else if (itemId === 'decoy') text = `${an}'s Decoy Box fooled you!`;
      else text = `${an} hit you with ${HIT_PHRASE[itemId] || itemName}!`;
      this.notify(text, { color: BAD, icon: ITEMS[itemId] ? itemId : undefined, duration: 2.6 });
      const launch = LAUNCH_ITEMS.has(itemId);
      if (itemId === 'tablet') this.flash('shrink');
      else this.flash('hit', { intensity: launch ? 1 : 0.8 });
      race.chase?.shake(itemId === 'tablet' ? 0.35 : launch ? 1 : 0.6);
      this.voice(P.characterId, 'hit');
      this.rumble(launch ? 1 : 0.75, launch ? 0.8 : 0.6, launch ? 420 : 280);
      return;
    }
    if (attacker === P && itemId !== 'tablet') {
      const verb = itemId === 'squish' ? 'squished' : itemId === 'halo' ? 'rammed' : 'hit';
      if (!this._pending.length) this._pendingT = 0.22;
      this._pending.push({ name: victim.name, verb, itemId, victim });
    }
  }

  _flushHits() {
    const list = this._pending;
    if (!list.length) return;
    const groups = new Map();
    for (const h of list) {
      if (!groups.has(h.verb)) groups.set(h.verb, []);
      const g = groups.get(h.verb);
      if (!g.includes(h.name)) g.push(h.name);
    }
    for (const [verb, names] of groups) {
      const first = list.find((h) => h.verb === verb);
      this.notify(`You ${verb} ${listNames(names)}!`, { color: GOOD, icon: ITEMS[first.itemId] ? first.itemId : undefined, duration: 2.2 });
    }
    // the first victim yelps (distance attenuated)
    const v = list[0].victim;
    const d = v?.position && this.player ? v.position.distanceTo(this.player.position) : 0;
    if (d < 45) this.voice(v.characterId, 'hit', 0.65 * (1 - d / 45) + 0.2);
    this.rumble(0.25, 0.35, 120);
    list.length = 0;
  }

  _onHazard({ kart, effect } = {}) {
    if (kart !== this.player) return;
    if (effect === 'spin' || effect === 'launch') {
      this.flash('hit', { intensity: 0.6 });
      this.race.chase?.shake(effect === 'launch' ? 0.9 : 0.5);
      this.rumble(0.7, 0.5, 260);
    } else this.rumble(0.35, 0.3, 120);
  }

  _onItemGet({ kart } = {}) {
    if (kart !== this.player) return;
    this.flash('item');
    this.rumble(0.1, 0.3, 70);
  }

  _onItemUse({ kart, itemId } = {}) {
    if (kart !== this.player) return;
    const def = ITEMS[itemId];
    switch (def?.kind) {
      case 'boost':
      case 'boostTimed':
        this.flash('boost', { intensity: 0.55 });
        break;
      case 'invincible':
        this.flash('halo');
        this.voice(kart.characterId, 'item');
        break;
      case 'global':
      case 'leader':
        this.voice(kart.characterId, 'item');
        break;
      default:
        break;
    }
    this.rumble(0.15, 0.35, 90);
  }

  _onCoin({ kart } = {}) {
    if (kart !== this.player) return;
    this.flash('coin');
  }

  _onTablet({ user, victims } = {}) {
    if (user !== this.player) return;
    const n = victims?.length || 0;
    this.notify(n ? `Shittim Tablet! ${n === 1 ? victims[0].name : `${n} rivals`} shrunk!` : 'Shittim Tablet!', { color: GOOD, icon: 'tablet', duration: 2.4 });
  }

  // ------------------------------------------------------------------------------------------------ per frame

  update(dt) {
    const race = this.race;
    const P = this.player;
    if (!P) return;
    const racing = race.phase === 'racing';

    // debounced place (side-by-side karts must not make the HUD / sfx flicker)
    const place = P.place || 1;
    if (place !== this._placeCand) {
      this._placeCand = place;
      this._placeHold = 0;
    } else if (place !== this.hudPlace) {
      this._placeHold += dt;
      if (this._placeHold >= PLACE_DEBOUNCE || race.phase !== 'racing') {
        const prev = this.hudPlace;
        this.hudPlace = place;
        if (racing && !P.finished && race.karts.length > 1) {
          race.sfx(place < prev ? 'placeUp' : 'placeDown', null, { volume: 0.8 });
          race.events.emit('place', { kart: P, place, prev });
        }
      }
    }

    // aggregated hit toasts
    if (this._pending.length) {
      this._pendingT -= dt;
      if (this._pendingT <= 0) this._flushHits();
    }

    // incoming missile / seeker
    let missile = false;
    let seeker = false;
    const inc = P.incoming;
    if (Array.isArray(inc)) for (const w of inc) (w.kind === 'seeker' ? (seeker = true) : (missile = true));
    if (seeker && !this._incoming.seeker && !P.finished) {
      this.notify('Blue Seeker incoming!', { color: '#35c8ff', icon: 'seeker', duration: 2 });
      this.rumble(0.2, 0.6, 220);
    }
    if (missile && !this._incoming.missile && !P.finished) this.rumble(0.1, 0.4, 120);
    this._incoming.missile = missile;
    this._incoming.seeker = seeker;

    // impacts & boosts -> rumble
    if (typeof P.impactSeq === 'number' && P.impactSeq !== this._impactSeq) {
      this._impactSeq = P.impactSeq;
      const s = clamp(P.impactStrength ?? 0.3, 0, 1);
      if (s > 0.05) this.rumble(0.15 + 0.7 * s, 0.25 + 0.5 * s, 70 + 170 * s);
    }
    const boosting = P.boostTime > 0;
    if (boosting && !this._boosting) this.rumble(0.12, 0.45, 150);
    this._boosting = boosting;

    // respawn (drone pick-up)
    const resp = P.respawnTime > 0;
    if (resp && !this._respawning) {
      this.rumble(0.45, 0.3, 200);
      race.events.emit('respawn', { kart: P });
    }
    this._respawning = resp;

    // wrong way
    const wrong = race.isWrongWay(P);
    if (wrong && !this._wrong) {
      race.sfx('wrongWay', null);
      race.events.emit('wrongWay', { kart: P, on: true });
      this._wrongT = 0;
    } else if (wrong) {
      this._wrongT += dt;
      if (this._wrongT > 3.5) {
        this._wrongT = 0;
        race.sfx('wrongWay', null, { volume: 0.7 });
      }
    } else if (this._wrong) race.events.emit('wrongWay', { kart: P, on: false });
    this._wrong = wrong;

    // finish confetti bursts
    if (this._confetti > 0) {
      this._confettiT -= dt;
      if (this._confettiT <= 0) {
        this._confetti--;
        this._confettiT = 0.45;
        this._burst();
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ race moments

  lap(lap, laps, lapTime, lapTimes) {
    const race = this.race;
    const final = lap >= laps && laps > 1;
    try {
      this.hud?.lapBanner(lap, laps);
    } catch {
      /* ignore */
    }
    race.sfx(final ? 'finalLap' : 'lap', null);
    if (final) {
      try {
        this.audio?.setMusicTempo?.(1.12);
      } catch {
        /* ignore */
      }
    }
    this.rumble(0.2, 0.4, 160);
    this._ttSplit(lapTimes);
  }

  /** Time Trial: compare the cumulative split against the stored record's splits. */
  _ttSplit(lapTimes) {
    const race = this.race;
    if (race.mode !== 'tt' || !Array.isArray(lapTimes) || !lapTimes.length) return;
    const rec = race.ttRecord;
    if (!rec || !Array.isArray(rec.lapTimes) || rec.lapTimes.length < lapTimes.length) return;
    let mine = 0;
    let theirs = 0;
    for (let i = 0; i < lapTimes.length; i++) {
      mine += lapTimes[i];
      theirs += rec.lapTimes[i];
    }
    const delta = mine - theirs;
    const sign = delta < 0 ? '−' : '+';
    this.notify(`Split ${lapTimes.length}: ${sign}${Math.abs(delta).toFixed(3)} s vs record`, { color: delta < 0 ? '#2fe08a' : BAD, duration: 2.6 });
  }

  finish(place, { newRecord = false, time = 0, mode = 'vs' } = {}) {
    const race = this.race;
    const P = this.player;
    this.hudPlace = place;
    this._placeCand = place;
    try {
      this.hud?.finishBanner(place);
    } catch {
      /* ignore */
    }
    const audio = this.audio;
    const good = mode === 'tt' ? true : place <= 3;
    try {
      audio?.setMusicTempo?.(1);
      audio?.sfx?.('finish');
      // Audio holds newly requested music back until the finish jingle is done
      audio?.playMusic?.(mode === 'tt' ? (newRecord ? 'victory' : 'results') : good ? 'victory' : 'defeat', { fadeIn: 0.4 });
    } catch {
      /* ignore */
    }
    race.later(0.7, () => this.voice(P.characterId, good ? 'win' : 'lose'));
    this.rumble(0.4, 0.7, 350);
    if (mode === 'tt' && newRecord) {
      race.later(1.1, () => this.notify(`NEW RECORD!  ${formatRaceTime(time)}`, { color: GOLD, duration: 3.2 }));
    }
    if (good) {
      this._confetti = mode === 'tt' && !newRecord ? 1 : place === 1 ? 5 : 3;
      this._confettiT = 0.15;
      race.later(0.2, () => race.sfx('confetti', null, { volume: 0.8 }));
    }
  }

  _burst() {
    const race = this.race;
    const P = this.player;
    const pos = P?.object3d?.position || P?.position;
    if (!pos || !race.particles) return;
    const p = race._tmpV.copy(pos);
    p.y += 3.2;
    p.addScaledVector(P.forward, 3);
    try {
      const v = race._tmpV2.copy(P.velocity).multiplyScalar(0.85);
      race.particles.emit('confetti', p, { count: 70, velocity: v, spread: 9, size: 0.38 });
    } catch {
      /* ignore */
    }
  }

  dispose() {
    for (const off of this._offs) off?.();
    this._offs.length = 0;
    this._pending.length = 0;
  }
}
