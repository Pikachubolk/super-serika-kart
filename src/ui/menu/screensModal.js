// Modal layers: in-race pause menu and a generic confirm dialog (owner: frontend agent).

import { Screen } from './Screen.js';
import { el, esc, ICONS, MODE_LABEL, CONTROLS, kbd, pad, hintsHTML } from './kit.js';
import { getTrackEntry } from '../../data/tracks/index.js';

export class PauseMenu extends Screen {
  constructor(menus, params) {
    super(menus, params);
    this.modal = true;
  }
  get music() {
    return null;
  }
  build() {
    const o = this.params.raceOpts || {};
    const entry = getTrackEntry(o.trackId);
    const bits = [MODE_LABEL[o.mode] || 'Race'];
    if (o.mode !== 'tt' && o.cc) bits.push(`${o.cc}cc`);
    if (o.mode === 'gp' && this.params.raceIndex != null) bits.push(`Race ${this.params.raceIndex + 1}/4`);
    const ctrl = CONTROLS.slice(0, 6)
      .map((c) => `<li><span>${esc(c.action)}</span><em class="mn-hint-kb">${c.keys.slice(0, 2).map(kbd).join('')}</em><em class="mn-hint-pad">${c.pad.slice(0, 1).map(pad).join('')}</em></li>`)
      .join('');
    return el(`<div class="mn-pause">
      <div class="mn-pause-dim"></div>
      <div class="mn-pause-panel">
        <div class="mn-pause-head">
          <span class="mn-pause-halo"></span>
          <h2>PAUSED</h2>
          <small>${esc(entry?.name || o.trackId || '')}</small>
          <div class="mn-pause-chips">${bits.map((b) => `<span class="mn-chip mn-chip-soft">${esc(b)}</span>`).join('')}</div>
        </div>
        <div class="mn-pause-list">
          <button class="mn-btn mn-btn-wide mn-btn-primary" data-focus data-key="resume">${ICONS.play}<span>Resume</span></button>
          <button class="mn-btn mn-btn-wide" data-focus data-key="restart">${ICONS.retry}<span>Restart</span></button>
          <button class="mn-btn mn-btn-wide mn-btn-danger" data-focus data-key="quit">${ICONS.home}<span>Quit</span></button>
        </div>
        <ul class="mn-pause-ctrl">${ctrl}</ul>
      </div>
      <footer class="mn-footer">${hintsHTML([
        ['ud', 'Move'],
        ['confirm', 'Select'],
        ['pause', 'Resume'],
      ])}</footer>
    </div>`);
  }
  onConfirm(e) {
    if (!e) return;
    const g = this.game;
    switch (e.dataset.key) {
      case 'resume':
        g.resumeRace();
        break;
      case 'restart':
        this.sfx('menuSelect');
        g.restartRace();
        break;
      case 'quit':
        this.sfx('menuSelect');
        this.menus.confirm({
          title: 'Quit the race?',
          text: g.gp ? 'Your Grand Prix progress will be lost.' : 'You will return to the main menu.',
          yes: 'Quit',
          danger: true,
          onYes: () => g.quitToMenu('main'),
        });
        break;
    }
  }
  onBack() {
    this.game.resumeRace();
  }
  onPause() {
    this.game.resumeRace();
  }
}

export class ConfirmDialog extends Screen {
  constructor(menus, params) {
    super(menus, params);
    this.modal = true;
  }
  get music() {
    return null;
  }
  build() {
    const p = this.params;
    return el(`<div class="mn-confirm">
      <div class="mn-pause-dim"></div>
      <div class="mn-confirm-panel">
        <h3>${esc(p.title || 'Are you sure?')}</h3>
        ${p.text ? `<p>${esc(p.text)}</p>` : ''}
        <div class="mn-confirm-btns">
          <button class="mn-btn${p.danger ? ' mn-btn-danger' : ' mn-btn-primary'}" data-focus data-key="yes"><span>${esc(p.yes || 'Yes')}</span></button>
          <button class="mn-btn" data-focus data-key="no"><span>${esc(p.no || 'Cancel')}</span></button>
        </div>
      </div>
    </div>`);
  }
  defaultFocus() {
    return this.el.querySelector('[data-key="no"]');
  }
  onConfirm(e) {
    if (!e) return;
    if (e.dataset.key === 'yes') {
      this.sfx('menuSelect');
      this.menus.popModal(this);
      this.params.onYes?.();
    } else this.onBack();
  }
  onBack() {
    this.sfx('menuBack');
    this.menus.popModal(this);
    this.params.onNo?.();
  }
  onPause() {
    this.onBack();
  }
}
