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
  applyQuality(renderer, opts.quality ?? 'high');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);
  return renderer;
}

export function applyQuality(renderer, quality) {
  const dpr = window.devicePixelRatio || 1;
  const ratio = quality === 'low' ? Math.min(dpr, 0.75) : quality === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 2);
  renderer.setPixelRatio(ratio);
  renderer.shadowMap.enabled = quality !== 'low';
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
