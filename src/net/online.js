// Online glue (owner: online agent): wires the NetSession singleton to the Game once (race start, errors).
//   ensureOnline(game) -> NetSession      idempotent; call from any online screen
//   URL flags: ?join=CODE (Game opens the Online screen prefilled), &autopilot=1 (AI drives your kart online,
//   for tests), &nick=Name (preset nickname, for tests)

import { getSession } from './NetSession.js';
import { NetRaceSync } from './NetRaceSync.js';

export function ensureOnline(game) {
  const s = getSession();
  if (s._game === game) return s;
  s._game = game;
  s.on('start', (info) => launchOnlineRace(game, s, info));
  s.on('closed', (e) => {
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
