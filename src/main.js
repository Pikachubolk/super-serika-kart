// Entry point.
//   /                                   -> the full game (title screen)
//   /?quickrace=<trackId>&char=<id>&cc=150&mode=vs&laps=3&autopilot=1
//                                       -> skip menus, start a race immediately (autopilot = AI drives the player)
//   /?scene=<name>&...                  -> debug scene from src/debug/<name>.js (export async function run(ctx))
//
// A global `window.__ssk` object is exposed for tools/shot.mjs --eval and debugging.

const params = new URLSearchParams(location.search);
const roots = {
  container: document.getElementById('app'),
  hudRoot: document.getElementById('hud'),
  menuRoot: document.getElementById('menu'),
  overlayRoot: document.getElementById('overlay'),
};
window.__ssk = window.__ssk || {};

function showFatal(err) {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText =
    'position:fixed;inset:auto 12px 12px 12px;max-height:40vh;overflow:auto;z-index:9999;background:#200c;color:#fbb;padding:12px;border-radius:8px;font:12px/1.4 monospace;white-space:pre-wrap;pointer-events:auto';
  el.textContent = `Super Serika Kart crashed:\n${err?.stack || err}`;
  document.body.appendChild(el);
}
window.addEventListener('error', (e) => showFatal(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));

async function boot() {
  const scene = params.get('scene');
  if (scene) {
    if (!/^[a-z0-9-]+$/i.test(scene)) throw new Error(`bad scene name ${scene}`);
    const mod = await import(`./debug/${scene}.js`);
    await mod.run({ params, ...roots });
    return;
  }
  const { Game } = await import('./core/Game.js');
  const game = new Game(roots);
  window.__ssk.game = game;
  const qr = params.get('quickrace');
  await game.init({
    quickRace: qr
      ? {
          trackId: qr,
          characterId: params.get('char') || 'serika',
          cc: Number(params.get('cc') || 150),
          mode: params.get('mode') || 'vs',
          laps: params.get('laps') ? Number(params.get('laps')) : undefined,
          autopilot: params.get('autopilot') === '1',
        }
      : null,
  });
}

// ---- PWA: offline service worker (production builds only; dev keeps Vite's live modules) + install prompt
if (import.meta.env.PROD && 'serviceWorker' in navigator && !params.has('scene')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('[pwa] service worker failed', err)));
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // shown from the title screen's Install button instead of the mini-infobar
  window.__ssk.installPrompt = e;
  window.dispatchEvent(new Event('ssk-installable'));
});
window.addEventListener('appinstalled', () => {
  window.__ssk.installPrompt = null;
  window.dispatchEvent(new Event('ssk-installable'));
});

boot().catch(showFatal);
