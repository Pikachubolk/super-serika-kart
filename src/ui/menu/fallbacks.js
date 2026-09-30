// Minimal stand-ins used by Game.js only if a core module fails to load (owner: frontend agent).
// They keep the title screen and menus usable instead of crashing the whole game.

export class NullAudio {
  constructor() {
    this.volumes = { master: 0.8, music: 0.6, sfx: 0.9 };
  }
  unlock() {}
  setVolumes(v) {
    Object.assign(this.volumes, v);
  }
  playMusic() {}
  setMusicTempo() {}
  stopMusic() {}
  sfx() {
    return null;
  }
  voice() {}
  createEngine() {
    return { update() {}, setVolume() {}, stop() {} };
  }
  dispose() {}
}

const MENU_KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'Space', 'NumpadEnter'],
  back: ['Escape', 'Backspace'],
  pause: ['Escape', 'KeyP'],
};

export class FallbackInput {
  constructor() {
    this.lastDevice = 'keyboard';
    this.down = new Set();
    this.pressed = new Set();
    this._onDown = (e) => {
      if (!this.down.has(e.code) || (e.repeat && /Arrow|Key[WASD]/.test(e.code))) this.pressed.add(e.code);
      this.down.add(e.code);
    };
    this._onUp = (e) => this.down.delete(e.code);
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
  }
  update() {}
  _any(codes, set) {
    return codes.some((c) => set.has(c));
  }
  getDriveControls() {
    const d = this.down;
    const has = (...c) => c.some((x) => d.has(x));
    return {
      throttle: has('ArrowUp', 'KeyW') ? 1 : 0,
      brake: has('ArrowDown', 'KeyS') ? 1 : 0,
      steer: (has('ArrowRight', 'KeyD') ? 1 : 0) - (has('ArrowLeft', 'KeyA') ? 1 : 0),
      drift: has('Space', 'ShiftLeft', 'ShiftRight'),
      driftPressed: ['Space', 'ShiftLeft', 'ShiftRight'].some((c) => this.pressed.has(c)),
      item: has('KeyE', 'KeyX', 'ControlLeft'),
      itemPressed: ['KeyE', 'KeyX', 'ControlLeft'].some((c) => this.pressed.has(c)),
      lookBack: has('KeyQ', 'KeyC'),
    };
  }
  menuPressed(action) {
    return this._any(MENU_KEYS[action] || [], this.pressed);
  }
  anyPressed() {
    return this.pressed.size > 0;
  }
  endFrame() {
    this.pressed.clear();
  }
  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
  }
}

export class FallbackPortraits {
  constructor() {
    this.small = new Map();
    this.large = new Map();
  }
  async generate(characters) {
    for (const c of characters) {
      this.small.set(c.id, this._draw(c, 128));
      this.large.set(c.id, this._draw(c, 256));
    }
  }
  _draw(c, size) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    g.fillStyle = c.look?.hair || '#333';
    g.beginPath();
    g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `bold ${size * 0.42}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(c.name[0], size / 2, size / 2 + size * 0.02);
    return cv.toDataURL();
  }
  get(id) {
    return this.small.get(id) || '';
  }
  getLarge(id) {
    return this.large.get(id) || this.get(id);
  }
}
