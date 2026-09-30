// Online glue (owner: online agent): wires the NetSession singleton to the Game once (race start, errors,
// automatic reconnection).
//   ensureOnline(game) -> NetSession      idempotent; call from any online screen
//   URL flags: ?join=CODE (Game opens the Online screen prefilled), &autopilot=1 (AI drives your kart online,
//   for tests), &nick=Name (preset nickname, for tests)
// A client that loses its link to the host (wifi drop, phone locked, tab in the background too long) quietly
// rejoins the same room once the page is visible again; the host recognises its tab token, so it keeps its
// seat and tournament points and simply joins the next race.

import { getSession } from './NetSession.js';
import { NetRaceSync } from './NetRaceSync.js';

const REJOIN_TRIES = 5;

export function ensureOnline(game) {
  const s = getSession();
  if (s._game === game) return s;
  s._game = game;
  s.on('start', (info) => launchOnlineRace(game, s, info));
  s.on('closed', (e) => {
    if (e?.canRejoin) {
      autoRejoin(game, s);
      return;
    }
    // in a race NetRaceSync handles it; in menus the Online screen re-renders, so only toast here
    if (e?.reason && !game.race?.net) game.menus?.toast?.(e.reason, { kind: 'error', duration: 4500 });
  });
  return s;
}

export function urlFlag(name) {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function whenVisible() {
  if (typeof document === 'undefined' || !document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', on);
      resolve();
    };
    document.addEventListener('visibilitychange', on);
  });
}

async function autoRejoin(game, s) {
  if (s._rejoining) return;
  s._rejoining = true;
  s._emit('rejoin', { state: 'trying' });
  let ok = false;
  let cancelled = false;
  try {
    for (let attempt = 0; attempt < REJOIN_TRIES && !ok; attempt++) {
      await whenVisible();
      await sleep(attempt ? 1500 * attempt : 600);
      if (s.active || !s._last) {
        cancelled = true; // joined / hosted another room, or left on purpose
        return;
      }
      try {
        await s.rejoin();
        ok = true;
      } catch (err) {
        if (/not found|full|mismatch/i.test(err?.message || '')) break; // the room is gone
      }
    }
  } finally {
    s._rejoining = false;
    s._emit('rejoin', { state: ok ? 'ok' : 'failed' });
    if (cancelled) {
      /* nothing to report */
    } else if (ok) game.menus?.toast?.('Reconnected to the room!', { duration: 2500 });
    else if (!s.active) game.menus?.toast?.('Could not reconnect to the room.', { kind: 'error', duration: 4500 });
  }
}

async function launchOnlineRace(game, s, info) {
  const me = info.roster.find((r) => r.owner === s.selfId);
  if (!me) return;
  const sync = new NetRaceSync(s, info, { autopilot: urlFlag('autopilot') === '1' });
  if (game._starting) {
    // a previous load is still running: wait for it, then start this one
    for (let i = 0; i < 100 && game._starting; i++) await new Promise((r) => setTimeout(r, 100));
  }
  game.menus?.closeModals?.();
  await game.startRace({
    mode: 'vs',
    cc: info.cc,
    trackId: info.trackId,
    playerCharacterId: me.charId,
    laps: info.laps,
    autopilot: sync.autopilot,
    online: sync,
  });
  if (game.race?.net !== sync) sync.detach();
}
