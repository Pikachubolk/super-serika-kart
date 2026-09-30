// Character select, cup select (GP) and track select (VS / TT) (owner: frontend agent).

import { Screen, topbar, footer, chip } from './Screen.js';
import { el, esc, ICONS, STAT_META, KART_STYLE_NAMES, MODE_LABEL, getTTBest, getTrophies, trophyBadge, sleep } from './kit.js';
import { mountOutline } from './trackPreview.js';
import { CHARACTERS, getCharacter } from '../../data/characters.js';
import { CUPS, getTrackEntry } from '../../data/tracks/index.js';
import { CC_LIST } from '../../data/engine.js';
import { coinIconSVG, crystalIconSVG } from '../itemIcons.js';
import { formatRaceTime } from '../../core/utils.js';

const cupIcon = (cup) => (cup.icon === 'coin' ? coinIconSVG() : crystalIconSVG());
const flowCrumb = (flow) => [MODE_LABEL[flow.mode], flow.mode !== 'tt' ? `${flow.cc}cc` : null].filter(Boolean).join(' · ');

// ================================================================================================
// Character select
// ================================================================================================

export class CharacterScreen extends Screen {
  get music() {
    return 'charselect';
  }
  stageSetup(stage) {
    stage.setMode('character', { characterId: this.focusId || this.menus.flow.characterId || 'serika' });
    stage.preload(CHARACTERS.map((c) => c.id));
  }
  build() {
    const flow = this.menus.flow;
    const P = this.game.portraits;
    const tiles = CHARACTERS.map((c, i) => {
      const img = P?.getLarge?.(c.id) || P?.get?.(c.id) || '';
      return `<button class="mn-char-tile" data-focus data-key="${c.id}" style="--i:${i};--mn-c1:${c.kart?.body || '#1fb6ff'};--mn-c2:${c.look?.halo?.color || '#fff'}">
        <span class="mn-char-bg"></span>
        ${img ? `<img class="mn-char-img" src="${img}" alt="" draggable="false">` : ''}
        <span class="mn-char-name">${esc(c.name)}</span>
        <span class="mn-char-cursor">1P</span>
      </button>`;
    }).join('');
    const stats = STAT_META.map(
      (s) => `<div class="mn-stat" data-stat="${s.key}" style="--c:${s.color}">
        <span class="mn-stat-label">${s.label}</span>
        <div class="mn-stat-bar"><div class="mn-stat-fill"></div><div class="mn-stat-ticks"><i></i><i></i><i></i><i></i></div></div>
      </div>`
    ).join('');
    return el(`<div class="mn-charsel">
      ${topbar({ title: 'Choose Your Student', crumb: flowCrumb(flow), right: chip(flowCrumb(flow), 'mn-chip-mode') })}
      <div class="mn-charsel-left">
        <div class="mn-char-grid">${tiles}</div>
        <div class="mn-char-info mn-panel">
          <div class="mn-char-school"></div>
          <div class="mn-char-full"></div>
          <blockquote class="mn-char-quote"></blockquote>
          <div class="mn-stats">${stats}</div>
          <div class="mn-char-kart"></div>
        </div>
      </div>
      <div class="mn-char-bigname"><span></span></div>
      <div class="mn-char-ready">READY!</div>
      ${footer([
        ['move', 'Move'],
        ['confirm', 'Select'],
        ['back', 'Back'],
      ])}
    </div>`);
  }
  defaultFocus() {
    return this.el.querySelector(`[data-key="${this.menus.flow.characterId || 'serika'}"]`) || super.defaultFocus();
  }
  onFocus(e) {
    const c = getCharacter(e.dataset.key);
    this.focusId = c.id;
    const info = this.el.querySelector('.mn-char-info');
    info.style.setProperty('--mn-c1', c.kart?.body || '#1fb6ff');
    info.querySelector('.mn-char-school').innerHTML = `<span class="mn-school-dot"></span>${esc(c.school)}`;
    info.querySelector('.mn-char-full').innerHTML = `<b>${esc(c.fullName || c.name)}</b><span>${esc(c.club || '')}</span>`;
    info.querySelector('.mn-char-quote').textContent = `“${c.tagline || ''}”`;
    for (const s of STAT_META) {
      const v = Math.max(0, Math.min(5, Number(c.stats?.[s.key]) || 0));
      info.querySelector(`[data-stat="${s.key}"] .mn-stat-fill`).style.transform = `scaleX(${v / 5})`;
    }
    const wc = c.weight ? c.weight[0].toUpperCase() + c.weight.slice(1) : '';
    info.querySelector('.mn-char-kart').innerHTML =
      `${wc ? chip(`${wc} class`, 'mn-chip-soft') : ''}${chip(KART_STYLE_NAMES[c.kart?.style] || 'Custom Frame', 'mn-chip-soft')}` +
      `<span class="mn-kart-swatch" style="--a:${c.kart?.body};--b:${c.kart?.accent};--c:${c.kart?.trim}"><i></i><i></i><i></i></span>`;
    const big = this.el.querySelector('.mn-char-bigname');
    big.style.setProperty('--mn-c1', c.kart?.body || '#1fb6ff');
    big.style.setProperty('--mn-c2', c.look?.halo?.color || '#ff3355');
    const span = big.querySelector('span');
    span.textContent = c.name.toUpperCase();
    big.classList.remove('is-pop');
    void big.offsetWidth;
    big.classList.add('is-pop');
    info.classList.remove('is-pop');
    void info.offsetWidth;
    info.classList.add('is-pop');
    if (!this.chosen) this.game.stage?.showCharacter(c.id);
  }
  async onConfirm(e) {
    if (!e || this.chosen) return;
    const id = e.dataset.key;
    this.chosen = true;
    this.menus.flow.characterId = id;
    e.classList.add('is-chosen');
    this.el.classList.add('is-chosen');
    this.sfx('menuSelect');
    this.game.audio?.voice?.(id, 'select');
    this.game.stage?.showCharacter(id, { pop: false });
    this.game.stage?.celebrate();
    this.menus.lock(1.0);
    await sleep(850);
    if (this.menus.base !== this) return;
    this.menus.go(this.menus.flow.mode === 'gp' ? 'cup' : 'track');
  }
}

// ================================================================================================
// Cup select (Grand Prix)
// ================================================================================================

export class CupScreen extends Screen {
  stageSetup(stage) {
    stage.setMode('backdrop');
  }
  build() {
    const flow = this.menus.flow;
    const trophies = getTrophies();
    const cards = CUPS.map((cup, i) => {
      const slots = CC_LIST.map((cc) => {
        const r = trophies[`${cup.id}:${cc}`];
        return `<span class="mn-cup-trophy${r ? ' is-won' : ''}${cc === flow.cc ? ' is-current' : ''}">${r ? trophyBadge(r) : '<i></i>'}<small>${cc}</small></span>`;
      }).join('');
      return `<button class="mn-cup-card" data-focus data-key="${cup.id}" style="--i:${i};--mn-accent:${cup.color}">
        <span class="mn-cup-glow"></span>
        <span class="mn-cup-icon">${cupIcon(cup)}</span>
        <span class="mn-cup-name">${esc(cup.name)}</span>
        <span class="mn-cup-trophies">${slots}</span>
      </button>`;
    }).join('');
    return el(`<div class="mn-cupsel">
      ${topbar({ title: 'Select a Cup', crumb: flowCrumb(flow), right: chip(`${flow.cc}cc`, 'mn-chip-mode') })}
      <div class="mn-cup-row">${cards}</div>
      <div class="mn-cup-tracks mn-panel">
        <div class="mn-cup-tracks-head"><span class="mn-cup-tracks-icon"></span><b></b><small>4 races &middot; 8 racers &middot; ${flow.cc}cc</small></div>
        <div class="mn-cup-list"></div>
      </div>
      ${footer([
        ['lr', 'Move'],
        ['confirm', 'Start Grand Prix'],
        ['back', 'Back'],
      ])}
    </div>`);
  }
  defaultFocus() {
    return this.el.querySelector(`[data-key="${this.menus.flow.cupId || 'credit'}"]`) || super.defaultFocus();
  }
  onFocus(e) {
    const cup = CUPS.find((c) => c.id === e.dataset.key);
    if (!cup) return;
    const panel = this.el.querySelector('.mn-cup-tracks');
    panel.style.setProperty('--mn-accent', cup.color);
    panel.querySelector('.mn-cup-tracks-icon').innerHTML = cupIcon(cup);
    panel.querySelector('.mn-cup-tracks-head b').textContent = cup.name;
    const list = panel.querySelector('.mn-cup-list');
    list.innerHTML = cup.tracks
      .map((id, i) => {
        const t = getTrackEntry(id);
        return `<div class="mn-cup-track" style="--i:${i};--mn-accent:${t?.color || '#1fb6ff'}"><span class="mn-cup-num">${i + 1}</span><div class="mn-cup-outline"></div><span class="mn-cup-tname">${esc(t?.name || id)}</span></div>`;
      })
      .join('');
    [...list.querySelectorAll('.mn-cup-outline')].forEach((o, i) => mountOutline(o, cup.tracks[i]));
  }
  onConfirm(e) {
    if (!e) return;
    const cupId = e.dataset.key;
    this.menus.flow.cupId = cupId;
    this.sfx('menuSelect');
    const f = this.menus.flow;
    this.game.startGrandPrix({ cupId, cc: f.cc, characterId: f.characterId });
  }
}

// ================================================================================================
// Track select (VS / Time Trial)
// ================================================================================================

export class TrackScreen extends Screen {
  stageSetup(stage) {
    stage.setMode('backdrop');
  }
  build() {
    const flow = this.menus.flow;
    const tt = flow.mode === 'tt';
    let grid = '';
    CUPS.forEach((cup) => {
      grid += `<div class="mn-track-cup" style="--mn-accent:${cup.color}"><span class="mn-track-cupicon">${cupIcon(cup)}</span>${esc(cup.name)}</div>`;
      cup.tracks.forEach((id, i) => {
        const t = getTrackEntry(id);
        const best = getTTBest(id);
        grid += `<button class="mn-track-card" data-focus data-key="${id}" style="--i:${i};--mn-accent:${t?.color || '#1fb6ff'}">
          <span class="mn-track-outline"></span>
          <span class="mn-track-name">${esc(t?.name || id)}</span>
          ${tt ? `<span class="mn-track-best${best ? '' : ' is-none'}">${best ? `${ICONS.tt}${formatRaceTime(best)}` : 'No record'}</span>` : ''}
        </button>`;
      });
    });
    const e = el(`<div class="mn-tracksel">
      ${topbar({ title: 'Select a Course', crumb: flowCrumb(flow), right: chip(flowCrumb(flow), 'mn-chip-mode') })}
      <div class="mn-track-grid">${grid}</div>
      <div class="mn-track-info mn-panel">
        <div class="mn-track-info-outline"></div>
        <div class="mn-track-info-text"><small class="mn-track-info-cup"></small><h3></h3><p></p></div>
        <div class="mn-track-info-meta"></div>
      </div>
      ${footer([
        ['move', 'Move'],
        ['confirm', tt ? 'Start Time Trial' : 'Start Race'],
        ['back', 'Back'],
      ])}
    </div>`);
    for (const card of e.querySelectorAll('.mn-track-card')) mountOutline(card.querySelector('.mn-track-outline'), card.dataset.key);
    return e;
  }
  defaultFocus() {
    return this.el.querySelector(`[data-key="${this.menus.flow.trackId}"]`) || super.defaultFocus();
  }
  onFocus(e) {
    const t = getTrackEntry(e.dataset.key);
    if (!t) return;
    const flow = this.menus.flow;
    const cup = CUPS.find((c) => c.id === t.cup);
    const info = this.el.querySelector('.mn-track-info');
    info.style.setProperty('--mn-accent', t.color);
    info.querySelector('.mn-track-info-cup').innerHTML = cup ? `${cupIcon(cup)}${esc(cup.name)} &middot; Race ${t.order + 1}` : '';
    info.querySelector('h3').textContent = t.name;
    info.querySelector('p').textContent = t.blurb;
    const best = getTTBest(t.id);
    info.querySelector('.mn-track-info-meta').innerHTML =
      flow.mode === 'tt'
        ? `<span class="mn-meta-label">Best Time</span><b class="mn-meta-time${best ? '' : ' is-none'}">${best ? formatRaceTime(best) : '--\'--"---'}</b>`
        : `<span class="mn-meta-label">Engine</span><b class="mn-meta-time">${flow.cc}cc</b>`;
    mountOutline(info.querySelector('.mn-track-info-outline'), t.id, { animated: true });
    info.classList.remove('is-pop');
    void info.offsetWidth;
    info.classList.add('is-pop');
  }
  onConfirm(e) {
    if (!e) return;
    const f = this.menus.flow;
    f.trackId = e.dataset.key;
    this.sfx('menuSelect');
    this.game.startSingleRace({ mode: f.mode, cc: f.mode === 'tt' ? 150 : f.cc, trackId: f.trackId, characterId: f.characterId });
  }
}

