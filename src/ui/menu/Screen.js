// Base class for menu screens / modal layers (owner: frontend agent).
//
// Focusable elements carry `data-focus` (and a stable `data-key` so focus can be restored when navigating
// back). Clicking an element with `data-action="back"` triggers onBack(). Menus.js owns input routing:
// directions -> onDir() (return true if handled) else spatial navigation; confirm -> onConfirm(focusEl);
// back -> onBack(); pause -> onPause().

import { esc, ICONS, hintsHTML, haloGlyph } from './kit.js';

export class Screen {
  /**
   * @param {import('../Menus.js').Menus} menus
   * @param {object} [params]
   */
  constructor(menus, params = {}) {
    this.menus = menus;
    this.game = menus.game;
    this.params = params;
    this.el = null;
    this.focusEl = null;
    this.wrap = true; // wrap spatial navigation around the edges
    this.modal = false;
  }

  /** Music key for this screen (null = keep whatever is playing). */
  get music() {
    return 'menu';
  }

  /** Configure the 3D stage (only used when no race is on screen). */
  stageSetup(stage) {
    stage.setMode('backdrop');
  }

  /** @returns {HTMLElement} */
  build() {
    throw new Error('Screen.build() not implemented');
  }

  enter() {}
  leave() {}
  update(/* dt */) {}

  focusables() {
    if (!this.el) return [];
    return [...this.el.querySelectorAll('[data-focus]')].filter(
      (e) => !e.hasAttribute('disabled') && !e.classList.contains('is-hidden') && e.getClientRects().length > 0
    );
  }

  defaultFocus() {
    return this.focusables()[0] || null;
  }

  onFocus(/* el */) {}
  onConfirm(/* el */) {}
  onBack() {
    this.menus.back();
  }
  onPause() {}
  /** @returns {boolean} true if the direction was consumed */
  onDir(/* dir, el */) {
    return false;
  }
  onWheel(/* e */) {}

  sfx(name, opts) {
    this.game.audio?.sfx?.(name, opts);
  }
}

/** BA-style top bar: round back button, slanted title plate, optional right-side chips. */
export function topbar({ title, crumb = '', right = '', back = true, color = '#ff3355' }) {
  return `<header class="mn-topbar">
    ${back ? `<button class="mn-back" data-action="back" aria-label="Back">${ICONS.back}</button>` : ''}
    <div class="mn-plate">
      <span class="mn-plate-halo">${haloGlyph(color)}</span>
      <div class="mn-plate-text">${crumb ? `<span class="mn-plate-crumb">${esc(crumb)}</span>` : ''}<h1 class="mn-plate-title">${esc(title)}</h1></div>
    </div>
    <div class="mn-topbar-right">${right}</div>
  </header>`;
}

export const chip = (text, cls = '') => `<span class="mn-chip ${cls}">${esc(text)}</span>`;

export function footer(hints) {
  return `<footer class="mn-footer">${hintsHTML(hints)}</footer>`;
}
