// Debug scene (owner: frontend agent): /?scene=menus&screen=<id>
//   screen = title | main | cc | character | cup | track | options | howto | results | standings | vsresults |
//            quickresults | ttresults | trophy | pause | loading |
//            selftest (scripted race/pause/3 restarts/results/quit leak test; &gp=1 = scripted 4-race GP -> trophy;
//                      read window.__ssk.selftest with --eval)
// Extra params: char=<id>, mode=gp|vs|tt, cc=150, place=<player place 1..8>, race=<GP race index 0..3>,
//               tab=controls|techniques|items (howto), newrecord=0|1 (ttresults), track=<id>
// Boots the real Game (menus + 3D stage) and jumps straight to the screen with fake data.

import { CHARACTERS, getCharacter } from '../data/characters.js';
import { GP_POINTS } from '../data/engine.js';
import { CUPS } from '../data/tracks/index.js';

function fakeResults(playerId, playerPlace = 2) {
  const others = CHARACTERS.map((c) => c.id).filter((id) => id !== playerId);
  const order = [...others];
  order.splice(Math.max(0, Math.min(7, playerPlace - 1)), 0, playerId);
  let t = 94.217;
  return order.map((id, i) => {
    t += 0.35 + i * 0.6 + ((i * 37) % 7) * 0.21;
    const laps = [t * 0.345, t * 0.33, t * 0.325];
    return {
      id,
      characterId: id,
      name: getCharacter(id).name,
      place: i + 1,
      isPlayer: id === playerId,
      time: t,
      finished: i < 7,
      lapTimes: laps,
      bestLap: Math.min(...laps),
    };
  });
}

function fakeGp(results, raceIndex, cc, cupId = 'credit') {
  const before = {};
  const lastPlacesBefore = {};
  CHARACTERS.forEach((c, i) => {
    before[c.id] = raceIndex === 0 ? 0 : Math.round(((i * 53) % 29) * (raceIndex / 1.2) + raceIndex * 4);
    lastPlacesBefore[c.id] = ((i * 3) % 8) + 1;
  });
  const after = { ...before };
  for (const r of results) after[r.characterId] += GP_POINTS[r.place - 1] || 0;
  return { cupId, cc, raceIndex, before, after, lastPlacesBefore, isLast: raceIndex >= 3 };
}

export async function run({ params, container, hudRoot, menuRoot, overlayRoot }) {
  const { Game } = await import('../core/Game.js');
  const game = new Game({ container, hudRoot, menuRoot, overlayRoot });
  window.__ssk.game = game;
  const screen = params.get('screen') || 'title';
  const char = getCharacter(params.get('char') || 'serika').id;
  const mode = params.get('mode') || (screen === 'track' ? 'vs' : 'gp');
  const cc = Number(params.get('cc') || 150);
  const place = Number(params.get('place') || 2);
  const raceIndex = Math.max(0, Math.min(3, Number(params.get('race') ?? 1)));
  const trackId = params.get('track') || (screen === 'pause' ? 'test-oval' : CUPS[0].tracks[raceIndex]);

  await game.init({ skipTitle: true });
  const menus = game.menus;
  Object.assign(menus.flow, { mode, cc, characterId: char, cupId: 'credit', trackId });
  const base = ['title', 'main'];

  switch (screen) {
    case 'title':
      menus.setStack(['title']);
      break;
    case 'main':
      menus.setStack(base);
      break;
    case 'cc':
      menus.setStack([...base, 'cc']);
      break;
    case 'character':
      menus.setStack([...base, 'cc', 'character']);
      break;
    case 'cup':
      menus.flow.mode = 'gp';
      menus.setStack([...base, 'cc', 'character', 'cup']);
      break;
    case 'track':
      menus.setStack(mode === 'tt' ? [...base, 'character', 'track'] : [...base, 'cc', 'character', 'track']);
      break;
    case 'options':
      menus.setStack([...base, 'options']);
      break;
    case 'howto':
      menus.setStack([...base, { id: 'howto', params: { tab: params.get('tab') || 'controls' } }]);
      break;
    case 'results':
    case 'standings': {
      const results = fakeResults(char, place);
      const gp = fakeGp(results, raceIndex, cc);
      menus.setStack([{ id: 'results', params: { mode: 'gp', trackId, cc, results, gp, startPhase: screen === 'standings' ? 'standings' : undefined } }]);
      break;
    }
    case 'vsresults':
    case 'quickresults': {
      const results = fakeResults(char, place);
      menus.flow.mode = 'vs';
      menus.setStack([{ id: 'results', params: { mode: 'vs', trackId, cc, results, gp: null, quick: screen === 'quickresults' } }]);
      break;
    }
    case 'ttresults': {
      const nr = params.get('newrecord') !== '0';
      const lapTimes = [31.482, 29.917, 30.206];
      const time = lapTimes.reduce((a, b) => a + b, 0);
      menus.flow.mode = 'tt';
      menus.setStack([
        { id: 'ttresults', params: { trackId, time, lapTimes, prevBest: nr ? time + 2.345 : time - 1.234, newRecord: nr, characterId: char, quick: false } },
      ]);
      break;
    }
    case 'trophy': {
      const results = fakeResults(char, place);
      const gp = fakeGp(results, 3, cc);
      const ids = Object.keys(gp.after).sort((a, b) => gp.after[b] - gp.after[a]);
      // put the player at the requested final rank
      const without = ids.filter((id) => id !== char);
      without.splice(Math.max(0, Math.min(7, place - 1)), 0, char);
      const pts = Object.values(gp.after).sort((a, b) => b - a);
      const standings = without.map((id, i) => ({ id, points: pts[i] }));
      menus.setStack([...base, { id: 'trophy', params: { cupId: 'credit', cc, standings, playerId: char } }]);
      break;
    }
    case 'loading': {
      const l = menus.showLoading({ trackId, mode, cc, raceIndex, cupId: 'credit', characterId: char });
      let p = 0;
      const iv = setInterval(() => {
        p = Math.min(0.72, p + 0.04);
        l.setProgress(p);
        if (p >= 0.72) clearInterval(iv);
      }, 120);
      break;
    }
    case 'pause': {
      game.startRace({ mode, cc, trackId, playerCharacterId: char });
      const iv = setInterval(() => {
        if (!game.canPause()) return;
        clearInterval(iv);
        setTimeout(() => game.pauseRace(), Number(params.get('after') || 600));
      }, 100);
      break;
    }
    case 'selftest':
      // scripted flow/leak test: race -> pause/resume -> 3 restarts -> forced results -> quit.
      // Read window.__ssk.selftest with tools/shot.mjs --eval.
      if (params.get('gp') === '1') gpTest(game, { cupId: params.get('cup') || 'credit' });
      else selfTest(game, { trackId: params.get('track') || 'test-oval', restarts: Number(params.get('restarts') || 3) });
      break;
    default:
      console.warn(`[debug/menus] unknown screen "${screen}"`);
      menus.setStack(['title']);
  }
  window.__ssk.debugMenus = { screen };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 60000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    try {
      if (fn()) return true;
    } catch {
      /* keep polling */
    }
    await wait(100);
  }
  return false;
}

async function selfTest(game, { trackId, restarts }) {
  const st = { done: false, ok: true, log: [] };
  window.__ssk.selftest = st;
  const snap = (label) => {
    const m = game.renderer.info.memory;
    const e = {
      label,
      geo: m.geometries,
      tex: m.textures,
      programs: game.renderer.info.programs?.length ?? null,
      hud: game.hudRoot.childElementCount,
      menu: game.menuRoot.childElementCount,
      overlay: game.overlayRoot.childElementCount,
      engines: game.audio?._engines?.size ?? null,
      phase: game.race?.phase ?? null,
      stack: game.menus.stack.map((s) => s.id).join('>'),
      modals: game.menus.modals.length,
    };
    st.log.push(e);
    return e;
  };
  const check = (cond, msg) => {
    if (!cond) {
      st.ok = false;
      st.log.push({ FAIL: msg });
    }
  };
  const racing = async (prev = null) => {
    const ok = await until(() => {
      const r = game.race;
      if (!r || r === prev) return false;
      if (r?.phase === 'intro') r.skipIntro?.();
      return game.raceRunning && (r.phase === 'racing' || r.phase === 'countdown');
    });
    check(ok, 'race did not reach countdown/racing');
    await wait(600);
  };
  try {
    game.menus.setStack(['title', 'main']);
    await wait(500);
    snap('menu');
    game.startRace({ mode: 'vs', cc: 150, trackId, playerCharacterId: 'serika', rivalIds: CHARACTERS.filter((c) => c.id !== 'serika').map((c) => c.id), laps: 1, autopilot: true });
    await racing();
    snap('race1');
    await until(() => game.canPause());
    game.pauseRace();
    await wait(400);
    check(game.paused && game.menus.modals.length === 1, 'pause did not open');
    snap('paused');
    game.resumeRace();
    await wait(400);
    check(!game.paused && game.menus.modals.length === 0, 'resume failed');
    for (let i = 0; i < restarts; i++) {
      await until(() => game.canPause());
      game.pauseRace();
      await wait(200);
      const prev = game.race;
      game.restartRace();
      await racing(prev);
      snap(`restart${i + 1}`);
    }
    const race = game.race;
    await wait(2500);
    game._onRaceFinish(race, race.getResults());
    await wait(1500);
    check(game.menus.stack.at(-1)?.id === 'results', 'results screen not shown');
    snap('results');
    await game.quitToMenu('main');
    await wait(800);
    const e = snap('quit');
    check(!game.race && e.hud === 0 && (e.engines ?? 0) === 0 && e.stack === 'title>main', 'quit did not clean up');
  } catch (err) {
    st.ok = false;
    st.log.push({ ERROR: String(err?.stack || err) });
  }
  st.done = true;
}

// GP flow test (/?scene=menus&screen=selftest&gp=1): 4 races with forced finishes -> trophy ceremony.
async function gpTest(game, { cupId }) {
  const st = { done: false, ok: true, log: [] };
  window.__ssk.selftest = st;
  try {
    game.menus.setStack(['title', 'main']);
    await wait(300);
    game.startGrandPrix({ cupId, cc: 100, characterId: 'hina' });
    let prev = null;
    for (let i = 0; i < 4; i++) {
      const ok = await until(() => {
        const r = game.race;
        if (!r || r === prev) return false;
        if (r?.phase === 'intro') r.skipIntro?.();
        return game.raceRunning && r.phase !== 'loading' && r.phase !== 'intro';
      }, 90000);
      if (!ok) throw new Error(`race ${i + 1} did not start`);
      const r = game.race;
      prev = r;
      st.log.push({ race: i + 1, track: r.opts?.trackId ?? game.lastRaceOpts.trackId, grid: game.lastRaceOpts.gridOrder.join(','), geo: game.renderer.info.memory.geometries, tex: game.renderer.info.memory.textures });
      await wait(1500);
      game._onRaceFinish(r, r.getResults());
      await wait(1200);
      if (game.menus.stack.at(-1)?.id !== 'results') throw new Error('no results screen');
      st.log.push({ standings: { ...game.gp.standings } });
      if (i < 3) game.nextGrandPrixRace();
      else await game.showTrophyCeremony();
    }
    await wait(1500);
    st.log.push({ end: game.menus.stack.map((x) => x.id).join('>'), race: !!game.race, hud: game.hudRoot.childElementCount });
    if (game.menus.stack.at(-1)?.id !== 'trophy') st.ok = false;
  } catch (err) {
    st.ok = false;
    st.log.push({ ERROR: String(err?.stack || err) });
  }
  st.done = true;
}
