// Shared WebGL renderer setup + resize handling.
import * as THREE from 'three';

/**
 * Create the one WebGLRenderer used by the whole game.
 * @param {HTMLElement} container
 * @param {{quality?: 'high'|'medium'|'low'}} [opts]
 */
export function createRenderer(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({
    antialias: opts.quality !== 'low',
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  applyQuality(renderer, opts.quality ?? 'high');
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);
  return renderer;
}

export function applyQuality(renderer, quality) {
  const dpr = window.devicePixelRatio || 1;
  const ratio = quality === 'low' ? Math.min(dpr, 0.75) : quality === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 2);
  const ud = (renderer.userData ??= {});
  ud.baseRatio = ratio;
  renderer.setPixelRatio(ratio * (ud.resScale ?? 1));
  renderer.shadowMap.enabled = quality !== 'low';
}

/**
 * Dynamic resolution: scale the quality's pixel ratio by `scale` (0.5..1). Used by Game to keep slow
 * devices (phones) near 60 fps during races. Returns the applied scale.
 */
export function setResolutionScale(renderer, scale) {
  const s = Math.round(Math.max(0.5, Math.min(1, scale)) * 100) / 100;
  const ud = (renderer.userData ??= {});
  if (ud.resScale === s) return s;
  ud.resScale = s;
  renderer.setPixelRatio((ud.baseRatio ?? Math.min(window.devicePixelRatio || 1, 2)) * s);
  return s;
}

/** Phones / small tablets (coarse pointer + touch + small screen). */
export function isMobileDevice() {
  try {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const touch = (navigator.maxTouchPoints || 0) > 0;
    const small = Math.min(screen.width, screen.height) <= 900;
    return !!(coarse && touch && small);
  } catch {
    return false;
  }
}

/** Keep a perspective camera's aspect in sync with the window. Returns an unsubscribe fn. */
export function bindResize(renderer, getCameras) {
  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    for (const cam of getCameras()) {
      if (!cam) continue;
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
  };
  window.addEventListener('resize', onResize);
  onResize();
  return () => window.removeEventListener('resize', onResize);
}
