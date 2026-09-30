// Top-level game object (owner: frontend agent): renderer, main loop, audio unlock, settings, screen flow
// (title -> menus -> loading -> race -> results) and Grand Prix state.
//
// API CONTRACT (see ARCHITECTURE.md §13):
//   new Game({ container, hudRoot, menuRoot, overlayRoot })
//   await game.init({ quickRace })   // quickRace: { trackId, characterId, cc, mode, laps, autopilot } | null
//   game.renderer, game.audio, game.input, game.portraits, game.settings, game.hudRoot, game.menuRoot, game.overlayRoot
//   await game.startRace(opts)       // opts = Race constructor opts (characterId accepted for playerCharacterId)
//   game.saveSettings()
// Additions: game.stage (MenuStage), game.menus (Menus), game.gp (GP state), game.applySettings(partial),
//   game.startGrandPrix({cupId,cc,characterId}), game.startSingleRace({mode,cc,trackId,characterId}),
//   game.pauseRace(), game.resumeRace(), game.restartRace(), game.quitToMenu(target), game.playMusic(key).
// Online (src/net/*, src/ui/menu/screensOnline.js): `/?join=CODE` opens the Online screen prefilled;
//   startRace passes opts.online (NetRaceSync) to Race; online races never pause (Esc asks to leave) and their
//   results go to the 'onlineresults' screen; quitToMenu('online') returns to the lobby.

import * as THREE from 'three';
import { createRenderer, bindResize, applyQuality } from './renderer.js';
import { Menus } from '../ui/Menus.js';
import { NullAudio, FallbackInput, FallbackPortraits } from '../ui/menu/fallbacks.js';
import { MenuStage } from '../ui/menu/MenuStage.js';
import { BootSplash, FpsMeter } from '../ui/menu/overlays.js';
import { preloadOutlines } from '../ui/menu/trackPreview.js';
import { getTTBest, setTTBest, awardTrophy, sleep } from '../ui/menu/kit.js';
import { CHARACTERS, getCharacter } from '../data/characters.js';
import { CUPS, TRACKS, getTrackEntry } from '../data/tracks/index.js';
import { GP_POINTS, ENGINE_CLASSES } from '../data/engine.js';

export const DEFAULT_SETTINGS = Object.freeze({ master: 0.8, music: 0.6, sfx: 0.9, quality: 'high', hudMap: 'both', showFps: false });
const QUALITIES = ['high', 'medium', 'low'];
const HUD_MAPS = ['both', 'map', 'ranks', 'none'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sanitizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of ['master', 'music', 'sfx']) {
    const v = Number(s?.[k]);
    if (Number.isFinite(v)) out[k] = Math.max(0, Math.min(1, v));
  }
  if (QUALITIES.includes(s?.quality)) out.quality = s.quality;
  if (HUD_MAPS.includes(s?.hudMap)) out.hudMap = s.hudMap;
  if (typeof s?.showFps === 'boolean') out.showFps = s.showFps;
  return out;
}

export class Game {
  constructor(roots) {
    Object.assign(this, roots);
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem('ssk.settings') || '{}') || {};
    } catch {
      /* ignore */
    }
    this.settings = sanitizeSettings(stored);
    this.race = null;
    this.raceRunning = false; // race loaded + started (update/render every frame)
    this.paused = false;
    this.resultsShown = false;
    this.gp = null; // { cupId, cc, characterId, raceIndex, rivals, standings, lastPlaces, history }
    this.quick = false; // current race came from ?quickrace=
    this.lastRaceOpts = null;
    this.stageVisible = true;
    this.timer = new THREE.Timer();
    this._fpsBuf = new Float32Array(60);
    this._fpsI = 0;
    this._fpsSum = 0;
    this._fpsN = 0;
    this._musicKey = null;
    this._musicPlaying = null;
    this._audioUnlocked = false;
    this._errCount = 0;
    this._finishedFor = 0;
    window.__ssk = window.__ssk || {};
    window.__ssk.game = this;
    window.__ssk.fps = 0;
  }

  // ----------------------------------------------------------------------------------------------
  // boot
  // ----------------------------------------------------------------------------------------------

  async init({ quickRace = null, skipTitle = false } = {}) {
    const boot = new BootSplash(this.overlayRoot);
    this._boot = boot;
    boot.set(0.08, 'Connecting to the Shittim Chest...');
    this.renderer = createRenderer(this.container, { quality: this.settings.quality });
    try {
      this.timer.connect?.(document);
    } catch {
      /* optional */
    }
    // core modules are loaded defensively: a broken sibling module must not take down the whole game
    const soft = (p, what) =>
      p.catch((err) => {
        console.error(`[game] ${what} failed to load, using a fallback`, err);
        return null;
      });
    const [inputMod, audioMod, portraitMod] = await Promise.all([
      soft(import('./Input.js'), 'Input'),
      soft(import('./Audio.js'), 'Audio'),
      soft(import('../ui/Portraits.js'), 'Portraits'),
    ]);
    this.input = inputMod?.Input ? new inputMod.Input() : new FallbackInput();
    try {
      this.audio = audioMod?.AudioManager ? new audioMod.AudioManager() : new NullAudio();
    } catch (err) {
      console.error('[game] AudioManager failed', err);
      this.audio = new NullAudio();
    }
    this.audio.setVolumes(this._volumes());
    this._bindUnlock();
    bindResize(this.renderer, () => [this.race?.camera]);

    this.stage = new MenuStage(this);
    this.menus = new Menus(this.menuRoot, this);
    this.fpsMeter = new FpsMeter(this.overlayRoot);
    this.fpsMeter.visible = !!this.settings.showFps;

    boot.set(0.25, 'Drawing student portraits...');
    this.portraits = portraitMod?.Portraits ? new portraitMod.Portraits(this.renderer) : new FallbackPortraits();
    try {
      await this.portraits.generate(CHARACTERS);
    } catch (err) {
      console.warn('[game] portrait generation failed, using fallbacks', err);
      this.portraits = new FallbackPortraits();
      await this.portraits.generate(CHARACTERS);
    }
    boot.set(0.6, 'Tuning the karts...');
    const fontsReady = document.fonts?.load ? Promise.all([document.fonts.load('64px "Lilita One"'), document.fonts.load('800 20px "M PLUS Rounded 1c"')]).catch(() => {}) : Promise.resolve();
    await Promise.race([fontsReady, sleep(2500)]);
    this.renderer.setAnimationLoop(() => this._frame());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.canPause() && !this.race?.net) this.pauseRace();
    });

    if (quickRace) {
      boot.set(0.85, 'Heading to the starting grid...');
      const q = quickRace;
      this.quick = true;
      const f = this.menus.flow;
      f.mode = ['gp', 'vs', 'tt'].includes(q.mode) ? q.mode : 'vs';
      f.cc = ENGINE_CLASSES[q.cc] ? Number(q.cc) : 150;
      f.characterId = getCharacter(q.characterId).id;
      f.trackId = q.trackId;
      await this.startRace({
        mode: f.mode,
        cc: f.cc,
        trackId: q.trackId,
        playerCharacterId: f.characterId,
        rivalIds: f.mode === 'tt' ? undefined : CHARACTERS.filter((c) => c.id !== f.characterId).map((c) => c.id),
        laps: q.laps,
        autopilot: !!q.autopilot,
      });
      return;
    }
    boot.set(0.8, 'Warming up the engines...');
    await Promise.race([this.stage.preload(['serika']), sleep(4000)]);
    const joinCode = new URLSearchParams(location.search).get('join');
    if (joinCode) this.menus.setStack(['title', 'main', { id: 'online', params: { join: joinCode } }]);
    else if (!skipTitle) this.menus.go('title');
    await boot.close();
    this._boot = null;
    preloadOutlines();
    setTimeout(() => this.stage.preload(CHARACTERS.map((c) => c.id)), 1500);
  }

  // ----------------------------------------------------------------------------------------------
  // settings & audio
  // ----------------------------------------------------------------------------------------------

  _volumes() {
    const { master, music, sfx } = this.settings;
    return { master, music, sfx };
  }

  saveSettings() {
    try {
      localStorage.setItem('ssk.settings', JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  applySettings(partial = {}) {
    const next = sanitizeSettings({ ...this.settings, ...partial });
    const changed = Object.keys(next).filter((k) => next[k] !== this.settings[k]);
    Object.assign(this.settings, next);
    if (changed.some((k) => k === 'master' || k === 'music' || k === 'sfx')) this.audio?.setVolumes(this._volumes());
    if (changed.includes('quality') && this.renderer) {
      applyQuality(this.renderer, this.settings.quality);
      this.stage?.setQuality(this.settings.quality);
    }
    if (changed.includes('showFps') && this.fpsMeter) this.fpsMeter.visible = !!this.settings.showFps;
    this.saveSettings();
  }

  resetSettings() {
    this.applySettings({ ...DEFAULT_SETTINGS });
  }

  _bindUnlock() {
    const unlock = () => this.unlockAudio();
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true, passive: true });
  }

  unlockAudio() {
    try {
      this.audio?.unlock();
    } catch {
      /* ignore */
    }
    if (!this._audioUnlocked) {
      this._audioUnlocked = true;
      // music requested before the first gesture was a no-op: request it again
      if (this._musicKey && !this.raceRunning) {
        this._musicPlaying = null;
        this.playMusic(this._musicKey);
      }
    }
  }

  /** Play a music key unless it is already playing (menus call this on every screen change). */
  playMusic(key) {
    if (!key) return;
    this._musicKey = key;
    if (this._musicPlaying === key) return;
    this._musicPlaying = key;
    try {
      this.audio?.playMusic(key, { fadeIn: 0.6 });
    } catch (err) {
      console.warn('[game] playMusic failed', err);
    }
  }

  // ----------------------------------------------------------------------------------------------
  // race flow
  // ----------------------------------------------------------------------------------------------

  /** Begin a Grand Prix (4 races of a cup). */
  startGrandPrix({ cupId, cc = 150, characterId = 'serika' }) {
    const cup = CUPS.find((c) => c.id === cupId) || CUPS[0];
    characterId = getCharacter(characterId).id;
    const rivals = shuffle(CHARACTERS.filter((c) => c.id !== characterId).map((c) => c.id));
    this.gp = {
      cupId: cup.id,
      cc: Number(cc) || 150,
      characterId,
      raceIndex: 0,
      rivals,
      standings: Object.fromEntries([characterId, ...rivals].map((id) => [id, 0])),
      lastPlaces: {},
      history: [],
    };
    this.quick = false;
    Object.assign(this.menus.flow, { mode: 'gp', cc: this.gp.cc, characterId, cupId: cup.id });
    return this.startRace(this._gpRaceOpts());
  }

  /** GP ranking (leader first): points, then the better place in the latest race. */
  _gpRanking(standings = this.gp.standings, lastPlaces = this.gp.lastPlaces) {
    return Object.keys(standings).sort((a, b) => standings[b] - standings[a] || (lastPlaces[a] ?? 99) - (lastPlaces[b] ?? 99));
  }

  _gpRaceOpts() {
    const gp = this.gp;
    const cup = CUPS.find((c) => c.id === gp.cupId) || CUPS[0];
    // race 1: player at the back; later races: reverse standings (leader starts at the back)
    const gridOrder = gp.raceIndex === 0 ? [...gp.rivals, gp.characterId] : this._gpRanking().reverse();
    return {
      mode: 'gp',
      cc: gp.cc,
      trackId: cup.tracks[gp.raceIndex],
      playerCharacterId: gp.characterId,
      rivalIds: [...gp.rivals],
      gridOrder,
    };
  }

  /** Single VS race or Time Trial. */
  startSingleRace({ mode = 'vs', cc = 150, trackId, characterId = 'serika' }) {
    characterId = getCharacter(characterId).id;
    this.gp = null;
    this.quick = false;
    const rivals = CHARACTERS.filter((c) => c.id !== characterId).map((c) => c.id);
    return this.startRace({
      mode,
      cc: mode === 'tt' ? 150 : cc,
      trackId,
      playerCharacterId: characterId,
      rivalIds: mode === 'tt' ? undefined : rivals,
      gridOrder: mode === 'tt' ? undefined : [...shuffle(rivals), characterId],
    });
  }

  /**
   * Load and start a race behind the loading screen.
   * @param {object} opts Race constructor options ({ mode, cc, trackId, playerCharacterId|characterId, rivalIds, gridOrder, laps, autopilot })
   */
  async startRace(opts) {
    if (this._starting) return;
    this._starting = true;
    let loading = null;
    try {
      const o = {
        mode: opts.mode || 'vs',
        cc: ENGINE_CLASSES[opts.cc] ? Number(opts.cc) : 150,
        trackId: opts.trackId,
        playerCharacterId: getCharacter(opts.playerCharacterId || opts.characterId || 'serika').id,
        quality: this.settings.quality,
      };
      for (const k of ['rivalIds', 'gridOrder', 'laps', 'autopilot', 'online']) if (opts[k] !== undefined && opts[k] !== null && !Number.isNaN(opts[k])) o[k] = opts[k];
      if (!getTrackEntry(o.trackId)) {
        console.warn(`[game] unknown track "${o.trackId}", using the first cup track`);
        o.trackId = TRACKS[0].id;
      }
      this.lastRaceOpts = o;
      this._ttPrevBest = o.mode === 'tt' ? getTTBest(o.trackId) : null;

      loading = this.menus.showLoading({
        trackId: o.trackId,
        mode: o.mode,
        cc: o.cc,
        raceIndex: o.mode === 'gp' ? this.gp?.raceIndex : null,
        cupId: o.mode === 'gp' ? this.gp?.cupId : null,
        characterId: o.playerCharacterId,
      });
      if (this._boot) {
        const b = this._boot;
        this._boot = null;
        b.close();
      }
      await sleep(420); // loading screen fades in over the previous view
      this.menus.clear();
      this.disposeRace();
      this.stageVisible = false;
      this.hudRoot?.classList.remove('mn-hud-hidden');
      try {
        this.audio?.stopMusic(0.4);
      } catch {
        /* ignore */
      }
      this._musicPlaying = null;

      let race;
      try {
        const { Race } = await import('../race/Race.js');
        race = new Race(this, o);
        this.race = race;
        window.__ssk.race = race;
        await race.load((p) => loading.setProgress(p));
      } catch (err) {
        console.error('[game] race failed to load', err);
        this.disposeRace();
        this.stageVisible = true;
        this.menus.setStack(['title', 'main']);
        loading.close();
        this.menus.toast('Could not load that course. Back to the menu!', { kind: 'error' });
        return;
      }
      race.onFinish = (results) => this._onRaceFinish(race, results);
      await loading.finish();
      if (this.race !== race) {
        loading.destroy();
        return;
      }
      this.raceRunning = true;
      this.paused = false;
      this.resultsShown = false;
      this._finishedFor = 0;
      try {
        const p = race.start();
        p?.catch?.((err) => console.error('[game] race.start failed', err));
      } catch (err) {
        console.error('[game] race.start failed', err);
      }
      loading.close();
    } finally {
      this._starting = false;
    }
  }

  disposeRace() {
    const r = this.race;
    if (this.paused) this.audio?.setPaused?.(false);
    if (!r) return;
    this.race = null;
    this.raceRunning = false;
    this.paused = false;
    this.resultsShown = false;
    if (window.__ssk.race === r) window.__ssk.race = null;
    try {
      r.onFinish = null;
      r.dispose();
    } catch (err) {
      console.error('[game] race.dispose failed', err);
    }
    this.hudRoot?.replaceChildren();
    this.hudRoot?.classList.remove('mn-hud-hidden');
  }

  canPause() {
    return !!(this.race && this.raceRunning && !this.paused && !this.resultsShown && !this._starting && this.race.phase !== 'finished' && !this.menus?.top);
  }

  pauseRace() {
    if (!this.canPause()) return;
    if (this.race?.net) {
      // online races keep running for everyone: offer to leave instead of pausing
      this.menus.confirm({ title: 'Leave the online race?', text: 'The race keeps going for the others.', yes: 'Leave', danger: true, onYes: () => this.leaveOnline() });
      return;
    }
    this.paused = true;
    try {
      this.race.pause();
    } catch (err) {
      console.error(err);
    }
    this.audio?.setPaused?.(true);
    this.audio?.sfx('pause');
    this.menus.openPause({ raceOpts: this.lastRaceOpts, raceIndex: this.gp?.raceIndex });
  }

  resumeRace() {
    if (!this.paused) return;
    this.menus.closeModals();
    this.paused = false;
    try {
      this.race?.resume();
    } catch (err) {
      console.error(err);
    }
    this.audio?.setPaused?.(false);
    this.audio?.sfx('unpause');
  }

  restartRace() {
    if (!this.lastRaceOpts) return;
    this.menus.closeModals();
    this.startRace({ ...this.lastRaceOpts });
  }

  /** Leave the online room and go back to the Online screen. */
  leaveOnline() {
    try {
      window.__ssk?.net?.leave?.();
    } catch {
      /* ignore */
    }
    return this.quitToMenu('online');
  }

  retryRace() {
    return this.restartRace();
  }

  nextGrandPrixRace() {
    if (!this.gp) return this.quitToMenu('main');
    if (this.gp.raceIndex >= 3) return this.showTrophyCeremony();
    this.gp.raceIndex++;
    return this.startRace(this._gpRaceOpts());
  }

  nextTrackRace() {
    const o = this.lastRaceOpts;
    if (!o) return this.quitToMenu('main');
    const i = TRACKS.findIndex((t) => t.id === o.trackId);
    const next = TRACKS[(i + 1) % TRACKS.length];
    this.menus.flow.trackId = next.id;
    const gridOrder = o.gridOrder ? [...shuffle(o.gridOrder.filter((id) => id !== o.playerCharacterId)), o.playerCharacterId] : undefined;
    return this.startRace({ ...o, trackId: next.id, gridOrder });
  }

  async showTrophyCeremony() {
    const gp = this.gp;
    if (!gp) return this.quitToMenu('main');
    const ranking = this._gpRanking();
    const standings = ranking.map((id) => ({ id, points: gp.standings[id] }));
    const rank = ranking.indexOf(gp.characterId) + 1;
    awardTrophy(gp.cupId, gp.cc, rank);
    await this.menus.wipe(async () => {
      this.disposeRace();
      this.stageVisible = true;
      this.menus.clear();
      this.menus.setStack([
        'title',
        'main',
        { id: 'trophy', params: { cupId: gp.cupId, cc: gp.cc, standings, playerId: gp.characterId } },
      ]);
    });
  }

  /** Leave the race / results and go back to a menu screen ('main' | 'character' | 'track'). */
  async quitToMenu(target = 'main') {
    if (this._quitting) return;
    this._quitting = true;
    try {
      await this.menus.wipe(async () => {
        this.disposeRace();
        this.gp = null;
        this.quick = false;
        this.stageVisible = true;
        this.menus.clear();
        const tt = this.menus.flow.mode === 'tt';
        const stacks = {
          main: ['title', 'main'],
          online: ['title', 'main', 'online'],
          character: tt ? ['title', 'main', 'character'] : ['title', 'main', 'cc', 'character'],
          track: tt ? ['title', 'main', 'character', 'track'] : ['title', 'main', 'cc', 'character', 'track'],
        };
        this.menus.setStack(stacks[target] || stacks.main);
      });
    } finally {
      this._quitting = false;
    }
  }

  _onRaceFinish(race, results) {
    if (race !== this.race || this.resultsShown) return;
    this.resultsShown = true;
    if (this.paused) {
      this.paused = false;
      try {
        race.resume();
      } catch {
        /* ignore */
      }
    }
    this.menus.closeModals();
    this.hudRoot?.classList.add('mn-hud-hidden');
    if (!Array.isArray(results)) {
      try {
        results = race.getResults();
      } catch {
        results = [];
      }
    }
    const o = this.lastRaceOpts;
    this._musicPlaying = null;
    if (race.net) {
      this.menus.go('onlineresults', { mode: 'vs', trackId: o.trackId, cc: o.cc, results, online: true, hostLeft: !!race.net.hostLeft }, { reset: true });
      return;
    }
    if (o.mode === 'tt') {
      const r = results.find((x) => x.isPlayer) || results[0] || {};
      const time = Number(r.time) || 0;
      const lapTimes = Array.isArray(r.lapTimes) ? r.lapTimes : [];
      const prev = this._ttPrevBest;
      const newRecord = time > 0 && (prev == null || time < prev - 1e-4);
      if (newRecord) setTTBest(o.trackId, time, { characterId: o.playerCharacterId, lapTimes });
      this.menus.go('ttresults', { trackId: o.trackId, time, lapTimes, prevBest: prev, newRecord, characterId: o.playerCharacterId, quick: this.quick }, { reset: true });
      return;
    }
    let gpInfo = null;
    if (o.mode === 'gp' && this.gp && !this.quick) {
      const gp = this.gp;
      const before = { ...gp.standings };
      const lastPlacesBefore = { ...gp.lastPlaces };
      for (const r of results) {
        const id = r.characterId || r.id;
        gp.standings[id] = (gp.standings[id] || 0) + (GP_POINTS[r.place - 1] || 0);
        if (!(id in before)) before[id] = 0;
        gp.lastPlaces[id] = r.place;
      }
      gp.history.push(results.map((r) => ({ id: r.characterId || r.id, place: r.place, time: r.time })));
      gpInfo = { cupId: gp.cupId, cc: gp.cc, raceIndex: gp.raceIndex, before, after: { ...gp.standings }, lastPlacesBefore, isLast: gp.raceIndex >= 3 };
    }
    this.menus.go('results', { mode: o.mode, trackId: o.trackId, cc: o.cc, results, gp: gpInfo, quick: this.quick }, { reset: true });
  }

  // ----------------------------------------------------------------------------------------------
  // main loop
  // ----------------------------------------------------------------------------------------------

  _trackFps(raw) {
    if (!(raw > 0)) return;
    const buf = this._fpsBuf;
    this._fpsSum += raw - buf[this._fpsI];
    buf[this._fpsI] = raw;
    this._fpsI = (this._fpsI + 1) % buf.length;
    this._fpsN = Math.min(buf.length, this._fpsN + 1);
    const fps = Math.round(this._fpsN / Math.max(1e-6, this._fpsSum));
    window.__ssk.fps = fps;
    this.fpsMeter?.update(raw, fps);
  }

  _safe(what, fn) {
    try {
      fn();
    } catch (err) {
      if (this._errCount++ < 5) console.error(`[game] race ${what} failed`, err);
    }
  }

  _frame() {
    this.timer.update();
    const raw = this.timer.getDelta();
    const dt = Math.min(raw, 0.1);
    this._trackFps(raw);
    this.input.update();

    if (this.canPause() && this.input.menuPressed('pause')) this.pauseRace();
    else this.menus.update(dt);

    const race = this.race;
    if (race && this.raceRunning) {
      if (!this.paused) this._safe('update', () => race.update(dt));
      this._safe('render', () => race.render(this.renderer));
      // safety net: if the race never reports its results, show them anyway
      if (!this.resultsShown && race.phase === 'finished' && !race.net) {
        this._finishedFor += dt;
        if (this._finishedFor > 9) this._onRaceFinish(race, null);
      }
    } else if (this.stageVisible && this.stage) {
      this.stage.update(dt);
      this.stage.render(this.renderer);
    }
    this.input.endFrame();
  }
}
