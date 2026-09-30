// Race results / GP standings, Time Trial results and the trophy ceremony (owner: frontend agent).

import { Screen, footer } from './Screen.js';
import { el, esc, ICONS, MODE_LABEL, placeClass, flip, tween, trophySVG, trophyTone, getTTBest, hintsHTML } from './kit.js';
import { Confetti } from './overlays.js';
import { mountOutline } from './trackPreview.js';
import { getCharacter } from '../../data/characters.js';
import { CUPS, getTrackEntry } from '../../data/tracks/index.js';
import { formatRaceTime, ordinalSuffix } from '../../core/utils.js';

const PLACE_MSG = [
  [1, ['First place! The prize money is ours!', 'Victory! Perfect driving, Sensei!', 'Number one! Abydos is saved... a little!']],
  [3, ['On the podium! Nice driving, Sensei.', 'Podium finish! Not bad at all.']],
  [5, ["Not bad... but the debt won't pay itself.", 'Middle of the pack. Push harder next time!']],
  [8, ["Ugh... we'll get them next time!", 'Rough race. Shake it off, Sensei!']],
];
const placeMsg = (p) => {
  const list = (PLACE_MSG.find(([max]) => p <= max) || PLACE_MSG[3])[1];
  return list[Math.floor(Math.random() * list.length)];
};

const placeHTML = (p) => `${p}<sup>${ordinalSuffix(p)}</sup>`;
const idOf = (r) => r.characterId || r.id;

// ================================================================================================
// Race results (+ GP standings phase)
// ================================================================================================

export class ResultsScreen extends Screen {
  get music() {
    return 'results';
  }
  stageSetup(stage) {
    const player = this.params.results?.find((r) => r.isPlayer);
    stage.setMode('hero', { characterId: player ? idOf(player) : 'serika' });
  }

  build() {
    const p = this.params;
    this.gp = p.gp || null;
    this.phase = 'intro';
    this.t = 0;
    const results = [...(p.results || [])].sort((a, b) => a.place - b.place);
    this.results = results;
    const player = results.find((r) => r.isPlayer) || results[0];
    this.player = player;
    const entry = getTrackEntry(p.trackId);
    const P = this.game.portraits;
    const bits = [entry?.name || p.trackId];
    if (p.cc) bits.push(`${p.cc}cc`);
    if (this.gp) bits.push(`Race ${this.gp.raceIndex + 1}/4`);
    else bits.push(MODE_LABEL[p.mode] || 'VS Race');

    const rows = results
      .map((r) => {
        const cid = idOf(r);
        const pts = this.gp ? this.gp.after[cid] - this.gp.before[cid] : 0;
        return `<div class="mn-res-row ${placeClass(r.place)}${r.isPlayer ? ' is-player' : ''}" data-id="${esc(cid)}" style="--i:${r.place - 1}">
          <span class="mn-res-rank">${r.place}</span>
          <span class="mn-res-portrait">${P?.get?.(cid) ? `<img src="${P.get(cid)}" alt="">` : ''}</span>
          <span class="mn-res-name">${esc(r.name || getCharacter(cid).name)}</span>
          <span class="mn-res-move"></span>
          <span class="mn-res-time">${r.finished === false ? '<i>~</i>' : ''}${formatRaceTime(r.time)}</span>
          ${this.gp ? `<span class="mn-res-pts">+${pts}</span><span class="mn-res-total">${this.gp.before[cid] || 0}</span>` : ''}
        </div>`;
      })
      .join('');

    const face = P?.getLarge?.(idOf(player)) || P?.get?.(idOf(player)) || '';
    const e = el(`<div class="mn-results${this.gp ? ' is-gp' : ''}">
      <div class="mn-res-backdrop"></div>
      <div class="mn-res-hero ${placeClass(player.place)}">
        <div class="mn-res-bigplace">${placeHTML(player.place)}</div>
        ${face ? `<img class="mn-res-face" src="${face}" alt="">` : ''}
        <div class="mn-res-msg">${esc(placeMsg(player.place))}</div>
      </div>
      <div class="mn-res-board">
        <div class="mn-res-head">
          <span class="mn-res-title">RACE RESULTS</span>
          <span class="mn-res-sub">${esc(bits.join(' · '))}</span>
        </div>
        <div class="mn-res-cols"><span>Place</span><span></span><span>Racer</span><span class="mn-res-col-time">Time</span>${this.gp ? '<span class="mn-res-col-pts">Pts</span>' : ''}</div>
        <div class="mn-res-rows">${rows}</div>
      </div>
      <div class="mn-res-next mn-panel"></div>
      <div class="mn-res-actions"></div>
      ${footer([
        ['confirm', 'Continue'],
        ['lr', 'Choose'],
      ])}
    </div>`);
    this.rowsEl = e.querySelector('.mn-res-rows');
    this.confetti = new Confetti(e);
    return e;
  }

  enter() {
    this._timers = [];
    this.menus.lock(0.8);
    const pl = this.player;
    if (pl) this.game.audio?.voice?.(idOf(pl), pl.place <= 3 ? 'win' : 'lose');
    if (pl?.place === 1) setTimeout(() => this.confetti?.burst(0.2, 0.5, 140, 1.1), 350);
    if (this.params.startPhase === 'standings' && this.gp) {
      this._countUp(0);
      this._standings(true);
    } else if (this.gp) {
      this._timers.push(setTimeout(() => this._countUp(), 1350));
    } else {
      this._timers.push(setTimeout(() => this._showActions(), 900));
    }
  }

  leave() {
    for (const t of this._timers || []) clearTimeout(t);
    this._cancelCount?.();
    this.confetti?.dispose();
  }

  update(dt) {
    this.t += dt;
    this.confetti?.update(dt);
  }

  _countUp(duration = 1100) {
    if (this.phase !== 'intro') return;
    this.phase = 'counting';
    const rows = [...this.rowsEl.children];
    rows.forEach((row, i) => {
      const cid = row.dataset.id;
      const from = this.gp.before[cid] || 0;
      const to = this.gp.after[cid] || 0;
      const pts = row.querySelector('.mn-res-pts');
      const tot = row.querySelector('.mn-res-total');
      pts?.classList.add('is-in');
      if (!duration) {
        tot.textContent = to;
        return;
      }
      setTimeout(() => {
        if (this.menus.base !== this) return;
        tot.classList.add('is-counting');
        tween(from, to, duration, (v) => (tot.textContent = Math.round(v)), { onDone: () => tot.classList.remove('is-counting') });
      }, i * 60);
    });
    if (duration) {
      this.sfx('coin', { volume: 0.6 });
      this._ticker = setInterval(() => this.sfx('coin', { volume: 0.35, pitch: 1.2 }), 180);
      this._cancelCount = () => clearInterval(this._ticker);
      this._timers.push(setTimeout(() => this._cancelCount(), duration + 400));
      this._timers.push(setTimeout(() => this._standings(), duration + 1500));
    }
  }

  /** Phase B: re-sort the board by GP total and show the next-race card. */
  _standings(instant = false) {
    if (this.phase === 'standings') return;
    if (this.phase === 'intro') this._countUp(0);
    this.phase = 'standings';
    this._cancelCount?.();
    const gp = this.gp;
    const rows = [...this.rowsEl.children];
    const racePlace = Object.fromEntries(this.results.map((r) => [idOf(r), r.place]));
    const rankBefore = (id) => {
      if (gp.raceIndex === 0) return null;
      const ids = Object.keys(gp.before).sort((a, b) => gp.before[b] - gp.before[a] || (gp.lastPlacesBefore?.[a] ?? 9) - (gp.lastPlacesBefore?.[b] ?? 9));
      return ids.indexOf(id) + 1;
    };
    const sorted = [...rows].sort((a, b) => {
      const ta = gp.after[a.dataset.id] || 0;
      const tb = gp.after[b.dataset.id] || 0;
      return tb - ta || racePlace[a.dataset.id] - racePlace[b.dataset.id];
    });
    for (const r of rows) r.querySelector('.mn-res-total').textContent = gp.after[r.dataset.id] || 0;
    const apply = () => {
      sorted.forEach((row, i) => {
        this.rowsEl.appendChild(row);
        const rank = i + 1;
        row.className = row.className.replace(/mn-p[0-9n]+/g, '').trim() + ' ' + placeClass(rank);
        row.style.setProperty('--i', i);
        row.querySelector('.mn-res-rank').textContent = rank;
        const before = rankBefore(row.dataset.id);
        const mv = row.querySelector('.mn-res-move');
        if (before && before !== rank) {
          mv.innerHTML = before > rank ? `▲${before - rank}` : `▼${rank - before}`;
          mv.className = `mn-res-move ${before > rank ? 'is-up' : 'is-down'}`;
        } else mv.textContent = '';
      });
    };
    this.el.classList.add('is-standings');
    this.el.querySelector('.mn-res-title').textContent = gp.isLast ? 'FINAL STANDINGS' : 'GP STANDINGS';
    const cup = CUPS.find((c) => c.id === gp.cupId);
    this.el.querySelector('.mn-res-sub').textContent = `${cup?.name || 'Grand Prix'} · ${gp.cc}cc · After race ${gp.raceIndex + 1}/4`;
    if (instant) apply();
    else {
      flip(this.rowsEl, apply, { duration: 750 });
      this.sfx('menuMove');
    }
    // player standing + next race card
    const pRow = sorted.findIndex((r) => r.classList.contains('is-player'));
    const hero = this.el.querySelector('.mn-res-hero');
    hero.className = `mn-res-hero ${placeClass(pRow + 1)}`;
    hero.querySelector('.mn-res-bigplace').innerHTML = placeHTML(pRow + 1);
    hero.querySelector('.mn-res-msg').textContent = gp.isLast ? 'Grand Prix complete!' : 'Overall standing';
    const next = this.el.querySelector('.mn-res-next');
    if (!gp.isLast && cup) {
      const nid = cup.tracks[gp.raceIndex + 1];
      const nt = getTrackEntry(nid);
      next.style.setProperty('--mn-accent', nt?.color || '#1fb6ff');
      next.innerHTML = `<div class="mn-res-next-outline"></div><div><small>NEXT &middot; RACE ${gp.raceIndex + 2}/4</small><b>${esc(nt?.name || nid)}</b><p>${esc(nt?.blurb || '')}</p></div>`;
      mountOutline(next.querySelector('.mn-res-next-outline'), nid);
      next.classList.add('is-in');
    }
    this._timers.push(setTimeout(() => this._showActions(), instant ? 0 : 700));
  }

  _showActions() {
    if (this.actionsShown) return;
    this.actionsShown = true;
    const p = this.params;
    let btns;
    if (this.gp) {
      btns = this.gp.isLast
        ? [['trophy', 'Trophy Ceremony', ICONS.gp]]
        : [
            ['next', 'Next Race', ICONS.play],
            ['quitgp', 'Quit Grand Prix', ICONS.home],
          ];
    } else if (p.quick) {
      btns = [
        ['retry', 'Retry', ICONS.retry],
        ['menu', 'Main Menu', ICONS.home],
      ];
    } else {
      btns = [
        ['nexttrack', 'Next Course', ICONS.play],
        ['retry', 'Retry', ICONS.retry],
        ['character', 'Change Character', ICONS.people],
        ['menu', 'Main Menu', ICONS.home],
      ];
    }
    const box = this.el.querySelector('.mn-res-actions');
    box.innerHTML = btns
      .map(([k, label, ico], i) => `<button class="mn-btn${i === 0 ? ' mn-btn-primary' : ''}" data-focus data-key="${k}" style="--i:${i}">${ico}<span>${esc(label)}</span></button>`)
      .join('');
    box.classList.add('is-in');
    const ft = this.el.querySelector('.mn-footer');
    if (ft) ft.innerHTML = hintsHTML([['confirm', 'Select'], ['lr', 'Choose']]);
    this.menus.refocus(this, box.querySelector('[data-focus]'));
  }

  defaultFocus() {
    return this.el.querySelector('.mn-res-actions [data-focus]');
  }

  onConfirm(e) {
    if (!this.actionsShown) {
      // skip ahead
      if (this.gp) {
        if (this.phase === 'intro') {
          for (const t of this._timers || []) clearTimeout(t);
          this._timers = [];
          this._countUp(500);
        } else if (this.phase === 'counting') {
          for (const t of this._timers || []) clearTimeout(t);
          this._timers = [];
          this._standings();
        }
      } else this._showActions();
      return;
    }
    if (!e) return;
    const g = this.game;
    this.sfx('menuSelect');
    switch (e.dataset.key) {
      case 'next':
        g.nextGrandPrixRace();
        break;
      case 'trophy':
        g.showTrophyCeremony();
        break;
      case 'quitgp':
        this.menus.confirm({
          title: 'Quit the Grand Prix?',
          text: 'Your points in this cup will be lost.',
          yes: 'Quit',
          onYes: () => g.quitToMenu('main'),
        });
        break;
      case 'retry':
        g.retryRace();
        break;
      case 'nexttrack':
        g.nextTrackRace();
        break;
      case 'character':
        g.quitToMenu('character');
        break;
      case 'menu':
        g.quitToMenu('main');
        break;
    }
  }

  onBack() {
    if (!this.actionsShown) this.onConfirm(null);
  }
}

// ================================================================================================
// Time Trial results
// ================================================================================================

export class TTResultsScreen extends Screen {
  get music() {
    return this.params.newRecord ? 'victory' : 'results';
  }
  stageSetup(stage) {
    stage.setMode('hero', { characterId: this.params.characterId || 'serika' });
  }
  build() {
    const p = this.params;
    const entry = getTrackEntry(p.trackId);
    const laps = p.lapTimes || [];
    const bestLap = laps.length ? Math.min(...laps) : null;
    const P = this.game.portraits;
    const face = P?.getLarge?.(p.characterId) || P?.get?.(p.characterId) || '';
    const lapRows = laps
      .map((t, i) => `<li style="--i:${i}" class="${t === bestLap && laps.length > 1 ? 'is-best' : ''}"><span>Lap ${i + 1}</span><b>${formatRaceTime(t)}</b><i>${t === bestLap && laps.length > 1 ? ICONS.star : ''}</i></li>`)
      .join('');
    const prev = p.prevBest;
    let record;
    if (p.newRecord) record = `<div class="mn-tt-record is-new"><span>NEW RECORD!</span>${prev ? `<small>Previous ${formatRaceTime(prev)} (−${(prev - p.time).toFixed(3)} s)</small>` : '<small>First record on this course!</small>'}</div>`;
    else record = `<div class="mn-tt-record"><span>Record ${formatRaceTime(prev ?? getTTBest(p.trackId) ?? p.time)}</span><small>+${Math.max(0, p.time - (prev ?? p.time)).toFixed(3)} s behind your best</small></div>`;
    const btns = p.quick
      ? [
          ['retry', 'Retry', ICONS.retry],
          ['menu', 'Main Menu', ICONS.home],
        ]
      : [
          ['retry', 'Retry', ICONS.retry],
          ['course', 'Change Course', ICONS.map],
          ['menu', 'Main Menu', ICONS.home],
        ];
    const e = el(`<div class="mn-ttres">
      <div class="mn-res-backdrop"></div>
      <div class="mn-ttres-hero">${face ? `<img class="mn-res-face" src="${face}" alt="">` : ''}</div>
      <div class="mn-ttres-panel mn-panel">
        <div class="mn-ttres-head"><span>TIME TRIAL</span><b>${esc(entry?.name || p.trackId)}</b></div>
        <div class="mn-ttres-total"><small>TOTAL TIME</small><b>${formatRaceTime(p.time)}</b></div>
        ${record}
        <ol class="mn-ttres-laps">${lapRows}</ol>
        <div class="mn-res-actions is-in">${btns
          .map(([k, label, ico], i) => `<button class="mn-btn${i === 0 ? ' mn-btn-primary' : ''}" data-focus data-key="${k}" style="--i:${i}">${ico}<span>${esc(label)}</span></button>`)
          .join('')}</div>
      </div>
      ${footer([
        ['lr', 'Choose'],
        ['confirm', 'Select'],
      ])}
    </div>`);
    this.confetti = new Confetti(e);
    return e;
  }
  enter() {
    this.menus.lock(0.7);
    if (this.params.newRecord) {
      setTimeout(() => {
        this.confetti?.burst(0.62, 0.35, 160, 1.1);
        this.sfx('confetti');
      }, 450);
      this.game.audio?.voice?.(this.params.characterId, 'win');
    }
  }
  leave() {
    this.confetti?.dispose();
  }
  update(dt) {
    this.confetti?.update(dt);
  }
  onConfirm(e) {
    if (!e) return;
    this.sfx('menuSelect');
    const g = this.game;
    if (e.dataset.key === 'retry') g.retryRace();
    else if (e.dataset.key === 'course') g.quitToMenu('track');
    else g.quitToMenu('main');
  }
  onBack() {}
}

// ================================================================================================
// Trophy ceremony
// ================================================================================================

export class TrophyScreen extends Screen {
  get music() {
    return 'trophy';
  }
  stageSetup(stage) {
    stage.setMode('podium', { podium: (this.params.standings || []).slice(0, 3).map((s) => s.id) });
  }
  build() {
    const p = this.params;
    const cup = CUPS.find((c) => c.id === p.cupId);
    const standings = p.standings || [];
    const rank = standings.findIndex((s) => s.id === p.playerId) + 1;
    this.rank = rank;
    const tone = trophyTone(rank);
    const P = this.game.portraits;
    const list = standings
      .map((s, i) => `<li class="${placeClass(i + 1)}${s.id === p.playerId ? ' is-player' : ''}" style="--i:${i}"><span class="mn-tr-rank">${i + 1}</span>${P?.get?.(s.id) ? `<img src="${P.get(s.id)}" alt="">` : '<i></i>'}<span class="mn-tr-name">${esc(getCharacter(s.id).name)}</span><b>${s.points}</b></li>`)
      .join('');
    const award = tone
      ? `<div class="mn-trophy-award is-${rank}">${trophySVG(rank, { id: 'mntrophy' })}<div class="mn-trophy-text"><small>You won the</small><b>${tone.label.toUpperCase()} TROPHY</b><span>${placeHTML(rank)} overall</span></div></div>`
      : `<div class="mn-trophy-award is-none"><div class="mn-trophy-text"><small>Final standing</small><b>${placeHTML(rank || 8)}</b><span>No trophy this time... Abydos believes in you, Sensei!</span></div></div>`;
    const e = el(`<div class="mn-trophy">
      <div class="mn-trophy-rays"></div>
      <div class="mn-trophy-head">
        <span class="mn-trophy-cup">${esc(cup?.name || 'Grand Prix')} &middot; ${p.cc}cc</span>
        <h1>${tone ? 'CONGRATULATIONS!' : 'GRAND PRIX COMPLETE'}</h1>
      </div>
      ${award}
      <ol class="mn-trophy-list mn-panel">${list}</ol>
      <div class="mn-res-actions mn-trophy-actions is-in">
        <button class="mn-btn mn-btn-primary" data-focus data-key="menu">${ICONS.home}<span>Main Menu</span></button>
        <button class="mn-btn" data-focus data-key="again">${ICONS.retry}<span>Race This Cup Again</span></button>
      </div>
      ${footer([
        ['lr', 'Choose'],
        ['confirm', 'Select'],
      ])}
    </div>`);
    this.confetti = new Confetti(e, { max: 520 });
    return e;
  }
  enter() {
    this.menus.lock(1.2);
    const win = this.rank >= 1 && this.rank <= 3;
    this.confetti.rain(win ? 70 : 25);
    if (win) {
      setTimeout(() => {
        this.confetti?.burst(0.5, 0.55, 200, 1.2);
        this.sfx('confetti');
      }, 700);
      setTimeout(() => this.confetti?.burst(0.25, 0.7, 90), 1500);
      setTimeout(() => this.confetti?.burst(0.75, 0.7, 90), 1900);
    }
    this.game.audio?.voice?.(this.params.playerId, win ? 'win' : 'lose');
  }
  leave() {
    this.confetti?.dispose();
  }
  update(dt) {
    this.confetti?.update(dt);
  }
  onConfirm(e) {
    if (!e) return;
    this.sfx('menuSelect');
    if (e.dataset.key === 'again') this.game.startGrandPrix({ cupId: this.params.cupId, cc: this.params.cc, characterId: this.params.playerId });
    else this.game.quitToMenu('main');
  }
  onBack() {}
}

