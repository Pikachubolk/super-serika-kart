// Continuous kart engine voice (owner: audio agent).
//   const eng = audio.createEngine('serika');
//   eng.update(speedNorm 0..1+, throttle 0..1, boosting, drifting)   // call every frame
//   eng.setVolume(v); eng.stop();
// A detuned saw/square core through a throttle-driven grit stage and lowpass, amplitude-modulated at the firing
// rate, with a gear model (rpm climbs within a gear then drops on the upshift), a boost whine + jet layer and
// a tyre-squeal layer for drifts. Per-character timbre: kart style + weight stat pick the base pitch/colour.

import { getCharacter } from '../../data/characters.js';
import { noiseBuffer, driveCurve } from './dsp.js';

const PROFILES = {
  standard: { base: 78, saw: 0.7, sq: 0.35, cutoff: 950, q: 2.2, grit: 7, am: 0.38, noise: 0.14, gears: 4 },
  sport: { base: 90, saw: 0.8, sq: 0.25, cutoff: 1300, q: 2.6, grit: 5, am: 0.24, noise: 0.11, gears: 5 },
  heavy: { base: 58, saw: 0.6, sq: 0.55, cutoff: 720, q: 1.7, grit: 12, am: 0.52, noise: 0.18, gears: 4 },
  light: { base: 102, saw: 0.5, sq: 0.6, cutoff: 1450, q: 2, grit: 4, am: 0.18, noise: 0.09, gears: 5 },
  luxury: { base: 66, saw: 0.75, sq: 0.45, cutoff: 880, q: 1.9, grit: 9, am: 0.62, noise: 0.12, gears: 4 },
};

const CHAR_TWEAKS = {
  serika: { base: 1.0 },
  shiroko: { base: 1.03 },
  hoshino: { base: 1.04, am: 0.6 },
  nonomi: { base: 0.98 },
  ayane: { base: 1.05, grit: 3 },
  aru: { base: 1.0, am: 0.72 },
  arisu: { base: 1.02, chip: true },
  hina: { base: 0.92, grit: 16 },
};

export const ENGINE_PROFILES = PROFILES;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class EngineSound {
  constructor(manager, characterId = 'serika') {
    this.manager = manager;
    this.characterId = characterId;
    const ch = getCharacter(characterId);
    const style = ch?.kart?.style || 'standard';
    const tw = CHAR_TWEAKS[characterId] || {};
    const prof = { ...(PROFILES[style] || PROFILES.standard) };
    const weight = ch?.stats?.weight ?? 3;
    prof.base *= (tw.base ?? 1) * (1 + (3 - weight) * 0.05);
    if (tw.am !== undefined) prof.am = tw.am;
    if (tw.grit !== undefined) prof.grit = tw.grit;
    prof.chip = !!tw.chip;
    this.prof = prof;
    this.volume = 1;
    this.built = false;
    this.stopped = false;
    this.rpm = 0.15;
    this.gear = 0;
    this.shift = 0;
    this.boostAmt = 0;
    this.driftAmt = 0;
    this.throttleS = 0;
    this.lastT = 0;
    this._last = {};
  }

  _build() {
    const ctx = this.manager.ctx;
    const dest = this.manager._engineBus;
    if (!ctx || !dest) return false;
    const P = this.prof;
    this.ctx = ctx;
    const nodes = (this.nodes = []);
    const srcs = (this.srcs = []);
    const G = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      nodes.push(g);
      return g;
    };
    const F = (type, f, Q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = Q;
      nodes.push(b);
      return b;
    };
    const O = (type, f) => {
      const o = ctx.createOscillator();
      if (type === 'chip') o.setPeriodicWave(this.manager._pulse(0.25));
      else o.type = type;
      o.frequency.value = f;
      srcs.push(o);
      return o;
    };
    const N = (kind) => {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuffer(ctx, kind);
      s.loop = true;
      srcs.push(s);
      return s;
    };

    this.out = G(0);
    this.out.connect(dest);

    // --- core ---
    const f = P.base * 0.6;
    this.oSaw = O(P.chip ? 'chip' : 'sawtooth', f);
    this.oSq = O('square', f * 0.5);
    this.oSq.detune.value = 8;
    this.oSub = O('sine', f * 0.5);
    const mix = G(1);
    const gSaw = G(P.saw);
    const gSq = G(P.sq);
    this.oSaw.connect(gSaw).connect(mix);
    this.oSq.connect(gSq).connect(mix);
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(P.grit);
    nodes.push(shaper);
    this.gritG = G(0);
    this.cleanG = G(0.7);
    mix.connect(this.cleanG);
    mix.connect(shaper).connect(this.gritG);
    this.lp = F('lowpass', P.cutoff, P.q);
    this.cleanG.connect(this.lp);
    this.gritG.connect(this.lp);
    this.amp = G(1);
    this.lp.connect(this.amp);
    this.body = G(0);
    this.amp.connect(this.body).connect(this.out);
    const subG = G(0.5);
    this.oSub.connect(subG).connect(this.body);
    // firing-rate amplitude modulation
    this.amOsc = O('sine', f * 0.5);
    this.amDepth = G(P.am * 0.5);
    this.amOsc.connect(this.amDepth).connect(this.amp.gain);

    // --- mechanical noise ---
    this.nz = N('pink');
    this.nzBp = F('bandpass', 400, 1.2);
    this.nzG = G(0);
    this.nz.connect(this.nzBp).connect(this.nzG).connect(this.out);

    // --- boost whine + jet ---
    this.oWhine = O('triangle', P.base * 12);
    const wv = O('sine', 7);
    const wvG = G(18);
    wv.connect(wvG).connect(this.oWhine.detune);
    this.whineG = G(0);
    this.oWhine.connect(this.whineG).connect(this.out);
    this.jet = N('white');
    this.jetF = F('bandpass', 3000, 0.8);
    this.jetG = G(0);
    this.jet.connect(this.jetF).connect(this.jetG).connect(this.out);

    // --- tyre squeal ---
    this.sq = N('white');
    this.sqF = F('bandpass', 2500, 7);
    this.sqG = G(0);
    this.sq.connect(this.sqF).connect(this.sqG).connect(this.out);
    this.oSqueal = O('triangle', 1150);
    const sqLfo = O('sine', 17);
    const sqLfoG = G(35);
    sqLfo.connect(sqLfoG).connect(this.oSqueal.detune);
    this.sqToneG = G(0);
    this.oSqueal.connect(this.sqToneG).connect(this.out);

    const t = ctx.currentTime;
    for (const s of srcs) {
      if (s.buffer) s.start(t, Math.random() * 1.5);
      else s.start(t);
    }
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(this.volume, t + 0.25);
    this.lastT = t;
    this.built = true;
    return true;
  }

  _set(param, key, v, now, tc = 0.03, eps = 0.004) {
    const last = this._last[key];
    if (last !== undefined && Math.abs(v - last) <= Math.abs(last) * eps + 1e-5) return;
    this._last[key] = v;
    param.setTargetAtTime(v, now, tc);
  }

  update(speedNorm = 0, throttle = 0, boosting = false, drifting = false) {
    if (this.stopped) return;
    if (!this.built) {
      if (!this.manager.ctx || this.manager.ctx.state !== 'running') return;
      if (!this._build()) return;
    }
    const now = this.ctx.currentTime;
    const dt = clamp(now - this.lastT, 0, 0.1);
    this.lastT = now;
    if (dt <= 0) return;
    const P = this.prof;
    const s = clamp(Math.abs(speedNorm) || 0, 0, 1.6);
    const thr = clamp(throttle || 0, 0, 1);
    this.throttleS += (thr - this.throttleS) * (1 - Math.exp(-dt * 10));
    const th = this.throttleS;

    // ---- gear model ----
    const n = P.gears;
    const sg = Math.min(s, 0.999);
    const want = Math.floor(sg * n);
    if (want > this.gear && sg > (this.gear + 1) / n + 0.01) {
      this.gear = Math.min(n - 1, this.gear + 1);
      this.shift = 1; // upshift: rpm drop + dip
      this.rpm *= 0.72;
    } else if (want < this.gear && sg < this.gear / n - 0.03) {
      this.gear = Math.max(0, this.gear - 1);
    }
    const lo = this.gear / n;
    const hi = (this.gear + 1) / n;
    let target;
    if (s < 0.04) target = 0.14 + th * 0.8; // standing: revs follow the throttle (rocket start rev!)
    else if (this.gear === 0) target = 0.2 + 0.8 * clamp(s / hi, 0, 1);
    else target = 0.32 + 0.68 * clamp((s - lo) / (hi - lo), 0, 1);
    if (s > 1) target = 1 + (s - 1) * 0.6;
    target += th * 0.06 + (boosting ? 0.08 : 0);
    const rate = target > this.rpm ? 6 + th * 6 : 4;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-dt * rate));
    this.shift = Math.max(0, this.shift - dt * 7);
    this.boostAmt += ((boosting ? 1 : 0) - this.boostAmt) * (1 - Math.exp(-dt * (boosting ? 8 : 3)));
    this.driftAmt += ((drifting && s > 0.25 ? 1 : 0) - this.driftAmt) * (1 - Math.exp(-dt * (drifting ? 10 : 6)));

    const rpm = this.rpm;
    const f = P.base * (0.55 + rpm * 1.2);
    const v = this.volume;
    const dip = 1 - this.shift * 0.4;

    this._set(this.oSaw.frequency, 'f1', f, now, 0.02);
    this._set(this.oSq.frequency, 'f2', f * 0.5, now, 0.02);
    this._set(this.oSub.frequency, 'f3', f * 0.5, now, 0.02);
    this._set(this.amOsc.frequency, 'fam', f * 0.5, now, 0.02);
    this._set(this.lp.frequency, 'lp', P.cutoff * (0.55 + rpm * 1.1 + th * 0.7) * (1 - this.shift * 0.3), now, 0.03);
    this._set(this.gritG.gain, 'grit', 0.12 + th * 0.4 + this.boostAmt * 0.2, now, 0.05);
    this._set(this.cleanG.gain, 'clean', 0.75 - th * 0.3, now, 0.05);
    this._set(this.body.gain, 'body', 0.2 * (0.45 + th * 0.4 + rpm * 0.25) * dip, now, 0.03);
    this._set(this.amDepth.gain, 'am', P.am * 0.5 * (0.55 + (1 - Math.min(1, rpm)) * 0.45), now, 0.05);
    this._set(this.nzBp.frequency, 'nzf', 250 + rpm * 900, now, 0.05);
    this._set(this.nzG.gain, 'nz', P.noise * 0.25 * (0.35 + th * 0.65) * (0.4 + s * 0.6), now, 0.05);
    const b = this.boostAmt;
    this._set(this.oWhine.frequency, 'wf', P.base * 11 * (0.8 + rpm * 0.45), now, 0.05);
    this._set(this.whineG.gain, 'wg', b * 0.028, now, 0.05);
    this._set(this.jetF.frequency, 'jf', 1800 + rpm * 2600, now, 0.05);
    this._set(this.jetG.gain, 'jg', b * 0.09, now, 0.05);
    const d = this.driftAmt;
    const wob = Math.sin(now * 9.3) * 180 + Math.sin(now * 3.1) * 120;
    this._set(this.sqF.frequency, 'sqf', 2350 + wob + s * 300, now, 0.04, 0.01);
    this._set(this.sqG.gain, 'sqg', d * 0.1 * (0.5 + Math.min(1, s) * 0.5), now, 0.04);
    this._set(this.oSqueal.frequency, 'sqt', 1080 + s * 160 + wob * 0.2, now, 0.04, 0.01);
    this._set(this.sqToneG.gain, 'sqtg', d * 0.012, now, 0.04);
    this._set(this.out.gain, 'out', v, now, 0.08);
  }

  setVolume(v) {
    this.volume = clamp(Number(v) || 0, 0, 2);
    if (this.built && !this.stopped) this._set(this.out.gain, 'out', this.volume, this.ctx.currentTime, 0.08);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.manager._engines?.delete(this);
    if (!this.built) return;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 0.2);
    for (const s of this.srcs) {
      try {
        s.stop(now + 0.25);
      } catch {
        /* noop */
      }
    }
    const nodes = this.nodes;
    this.srcs[0].onended = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* noop */
        }
      }
    };
  }

  /** Debug info for the sound test. */
  get state() {
    return { rpm: this.rpm, gear: this.gear + 1, boost: this.boostAmt, drift: this.driftAmt, built: this.built };
  }
}
