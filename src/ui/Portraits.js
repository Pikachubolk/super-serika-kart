// Character head portraits, rendered once at startup from the real 3D models (owner: characters agent).
// Used by the HUD (ranking column, minimap icons) and the menus (character select, results, loading).
//
// API CONTRACT (ARCHITECTURE.md §6):
//   new Portraits(renderer)
//   await portraits.generate(characters)    // renders all portraits (idempotent, never throws)
//   portraits.get(id)      -> dataURL (128 px square, transparent background, head & shoulders, 3/4 view)
//   portraits.getLarge(id) -> dataURL (256 px square bust incl. halo, for character select / results)
// Extras: portraits.ready (bool), portraits.ms (generation time), portraits.isFallback(id),
//         portraits.getCanvas(id, large=false) -> HTMLCanvasElement | null
//
// How: each character is posed (static 'portrait' pose, friendly eyes-open face) in a private scene with a
// key / hemisphere fill / two rim lights, rendered into a 4x-MSAA linear (half-float) render target at 2x the
// output size. A full-screen pass then un-premultiplies alpha and applies the renderer's own tone mapping
// (ACES by default) + sRGB encoding so the colours match the in-game 3D view; the pixels are read back,
// flipped, down-sampled on a 2D canvas and encoded as PNG data URLs. All renderer state that is touched
// (render target, clear colour/alpha, autoClear, shadow-map update flags, outline thickness) is restored.
// Any failure falls back to drawn initials badges.

import * as THREE from 'three';
import { createCharacterModel, getFaceTexture, getOutlineMaterial } from '../entities/CharacterModel.js';

const SMALL = 128;
const LARGE = 256;
const SS = 2; // supersampling factor

// Framing in driver space (head centre ≈ (0, 0.655, 0), halo ≈ 0.5 above it). centre y, half-height.
// fade: fraction of the image height (from the bottom) faded out so busts end softly instead of a hard cut.
const FRAMES = {
  small: { cy: 0.665, half: 0.47, fov: 20, fade: 0.16 },
  large: { cy: 0.68, half: 0.64, fov: 22, fade: 0.22 },
};
const HALO_TUCK = 0.15; // small portraits: halo lowered by this much (driver units) so it fits the tight crop
const CAM_AZIMUTH = 0.5; // rad, camera on the character's left (+X) side -> 3/4 view
const CAM_ELEVATION = 0.09; // rad, slightly above eye level (cute chibi high angle)

const yieldToBrowser = () =>
  new Promise((resolve) => {
    // MessageChannel is not throttled in background tabs (unlike setTimeout)
    try {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
    } catch {
      setTimeout(resolve, 0);
    }
  });

const TONE_FN = {
  [THREE.LinearToneMapping]: 'LinearToneMapping',
  [THREE.ReinhardToneMapping]: 'ReinhardToneMapping',
  [THREE.CineonToneMapping]: 'CineonToneMapping',
  [THREE.ACESFilmicToneMapping]: 'ACESFilmicToneMapping',
  [THREE.AgXToneMapping]: 'AgXToneMapping',
  [THREE.NeutralToneMapping]: 'NeutralToneMapping',
};

function createResolveMaterial(toneMapping) {
  const fn = TONE_FN[toneMapping];
  const defines = fn ? { SSK_TONE: fn } : {};
  return new THREE.ShaderMaterial({
    name: 'ssk-portrait-resolve',
    defines,
    uniforms: { tSrc: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4( position.xy, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #ifdef SSK_TONE
        #include <tonemapping_pars_fragment>
      #endif
      uniform sampler2D tSrc;
      varying vec2 vUv;
      vec3 sskSRGB( vec3 c ) {
        c = clamp( c, 0.0, 1.0 );
        return mix( 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
      }
      void main() {
        vec4 s = texture2D( tSrc, vUv );
        float a = clamp( s.a, 0.0, 1.0 );
        vec3 c = a > 0.0005 ? s.rgb / a : vec3( 0.0 );
        #ifdef SSK_TONE
          c = SSK_TONE( c );
        #endif
        gl_FragColor = vec4( sskSRGB( c ), a );
      }`,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Fallback badge (initials) — used when WebGL rendering is unavailable or fails
// ---------------------------------------------------------------------------------------------------------

function drawFallback(c, size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  if (!g) return '';
  const r = size * 0.44;
  const cx = size / 2;
  const cy = size / 2 + size * 0.02;
  const hair = c?.look?.hair || '#39406a';
  const accent = c?.look?.halo?.color || c?.kart?.body || '#1fb6ff';
  // halo ring
  g.strokeStyle = accent;
  g.lineWidth = size * 0.035;
  g.beginPath();
  g.ellipse(cx, size * 0.12, size * 0.22, size * 0.06, 0, 0, Math.PI * 2);
  g.stroke();
  // disc
  const gr = g.createLinearGradient(0, cy - r, 0, cy + r);
  gr.addColorStop(0, hair);
  gr.addColorStop(1, '#1c1024');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = size * 0.04;
  g.strokeStyle = '#ffffff';
  g.stroke();
  // initial
  const letter = String(c?.name || c?.id || '?')[0].toUpperCase();
  g.font = `900 ${Math.round(size * 0.46)}px "Lilita One", "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.06;
  g.strokeStyle = '#1c1024';
  g.strokeText(letter, cx, cy + size * 0.02);
  g.fillStyle = '#ffffff';
  g.fillText(letter, cx, cy + size * 0.02);
  try {
    return cv.toDataURL('image/png');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------------------------------------

export class Portraits {
  constructor(renderer) {
    this.renderer = renderer || null;
    this.small = new Map();
    this.large = new Map();
    this.canvases = new Map(); // id -> { small, large }
    this.fallbackIds = new Set();
    this.characters = [];
    this.ready = false;
    this.ms = 0;
    this._pending = null;
    this._done = new Set();
    this.timings = []; // debug: per character { id, build, small, large } ms
  }

  /** Render every character's portraits. Idempotent; never throws. */
  generate(characters) {
    const list = (Array.isArray(characters) ? characters : []).filter((c) => c && c.id);
    const todo = list.filter((c) => !this._done.has(c.id));
    for (const c of list) if (!this.characters.includes(c)) this.characters.push(c);
    if (!todo.length) return this._pending || Promise.resolve(this);
    const prev = this._pending || Promise.resolve();
    this._pending = prev
      .then(() => this._generate(todo.filter((c) => !this._done.has(c.id))))
      .catch((err) => console.warn('[portraits] generation failed', err))
      .then(() => {
        this.ready = true;
        return this;
      });
    return this._pending;
  }

  async _generate(list) {
    if (!list.length) return;
    const t0 = performance.now();
    // (get() draws an initials badge on demand while a portrait is not rendered yet or failed)
    let studio = null;
    try {
      studio = this._createStudio();
    } catch (err) {
      console.warn('[portraits] WebGL portrait studio unavailable, using drawn badges', err);
    }
    if (studio) {
      studio.others = list.slice(1);
      try {
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          try {
            await this._renderCharacter(studio, c);
          } catch (err) {
            console.warn(`[portraits] ${c.id} failed, using a drawn badge`, err);
          }
          this._done.add(c.id);
          if (i < list.length - 1) await yieldToBrowser();
        }
      } finally {
        this._disposeStudio(studio);
      }
    } else {
      for (const c of list) this._done.add(c.id);
    }
    this.ms = performance.now() - t0;
  }

  // ---- studio: scene, lights, camera, render targets ------------------------------------------------

  _createStudio() {
    const r = this.renderer;
    if (!r || typeof r.render !== 'function' || typeof r.readRenderTargetPixels !== 'function') throw new Error('no renderer');
    const gl = r.getContext?.();
    if (!gl || gl.isContextLost?.()) throw new Error('WebGL context lost');
    const floatOK = !!r.extensions?.has?.('EXT_color_buffer_float');

    const scene = new THREE.Scene();
    scene.background = null;
    scene.fog = null;
    const hemi = new THREE.HemisphereLight('#dce9ff', '#9c8494', 0.95);
    scene.add(hemi);
    const key = new THREE.DirectionalLight('#fff1e0', 1.85);
    key.position.set(2.2, 2.8, 3.2);
    scene.add(key);
    const rimL = new THREE.DirectionalLight('#bfe2ff', 2.6);
    rimL.position.set(-2.6, 1.6, -1.6);
    scene.add(rimL);
    const rimR = new THREE.DirectionalLight('#ffe0f2', 1.6);
    rimR.position.set(2.8, 1.2, -2.2);
    scene.add(rimR);
    for (const l of [key, rimL, rimR]) {
      l.castShadow = false;
      l.target.position.set(0, 0.65, 0);
      scene.add(l.target);
    }

    const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 30);
    const targets = {};
    for (const [name, out] of [
      ['small', SMALL],
      ['large', LARGE],
    ]) {
      const S = out * SS;
      const src = new THREE.WebGLRenderTarget(S, S, {
        type: floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
        colorSpace: floatOK ? THREE.NoColorSpace : THREE.SRGBColorSpace,
        samples: 4,
        depthBuffer: true,
        stencilBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
      });
      const dst = new THREE.WebGLRenderTarget(S, S, {
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
      });
      const big = document.createElement('canvas');
      big.width = big.height = S;
      targets[name] = { S, out, src, dst, pixels: new Uint8Array(S * S * 4), big, bigCtx: big.getContext('2d'), image: new ImageData(S, S) };
    }

    const resolveMat = createResolveMaterial(r.toneMapping);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), resolveMat);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return { scene, camera, targets, resolveMat, quad, quadScene, quadCam, lights: [hemi, key, rimL, rimR] };
  }

  _disposeStudio(st) {
    for (const t of Object.values(st.targets)) {
      t.src.dispose();
      t.dst.dispose();
    }
    st.quad.geometry.dispose();
    st.resolveMat.dispose();
    for (const l of st.lights) l.dispose?.();
  }

  // ---- one character ---------------------------------------------------------------------------------

  async _renderCharacter(st, c) {
    const tb = performance.now();
    const cm = createCharacterModel(c, { quality: 'high' });
    const tm = { id: c.id, build: Math.round(performance.now() - tb) };
    this.timings.push(tm);
    const faceTex = getFaceTexture(c, 'portrait', cm.faceSize || 512);
    try {
      cm.setPose('portrait');
      cm.update(0, {});
      cm.setExpression('portrait', 1e6);
      cm.material.map = faceTex;
      // 3/4 pose: head and shoulders turned a little towards the camera, head tilted like a profile photo
      cm.bSpine.rotation.set(0.02, 0.06, -0.015);
      cm.bHead.rotation.set(0.07, 0.04, -0.08);
      if (cm.haloGlow) cm.haloGlow.visible = false; // additive glow has no meaning on a transparent background
      cm.halo.position.copy(cm.haloRest);
      cm.halo.rotation.set(-0.42, 0, 0.1);
      cm.mesh.frustumCulled = false;
      if (cm.outline) cm.outline.frustumCulled = false;
      st.scene.add(cm.group);
      cm.group.updateMatrixWorld(true);

      if (!st.compiled) {
        // compile the toon / outline / halo / resolve programs off the main thread (KHR_parallel_shader_compile)
        st.compiled = true;
        const r = this.renderer;
        if (typeof r.compileAsync === 'function') {
          try {
            this._frame(st, 'small');
            // programs depend on the active target (tone mapping / output colour space): compile against ours
            const prevRT = r.getRenderTarget();
            let pScene, pQuad;
            try {
              r.setRenderTarget(st.targets.small.src);
              pScene = r.compileAsync(st.scene, st.camera);
              r.setRenderTarget(st.targets.small.dst);
              pQuad = r.compileAsync(st.quadScene, st.quadCam);
            } finally {
              r.setRenderTarget(prevRT);
            }
            // meanwhile paint the remaining portrait faces (canvases are cached by getFaceTexture)
            for (const o of st.others || []) {
              try {
                getFaceTexture(o, 'portrait', cm.faceSize || 512).dispose();
              } catch {
                /* painted again on demand */
              }
            }
            await Promise.all([pScene, pQuad]);
          } catch {
            /* fall through: the first render compiles synchronously */
          }
        }
      }
      const ts = performance.now();
      // icon framing is tight around the face: tuck the halo down onto the crown so it stays fully in frame
      cm.halo.position.y = cm.haloRest.y - HALO_TUCK;
      cm.halo.scale.setScalar(0.92);
      cm.group.updateMatrixWorld(true);
      const small = this._shoot(st, 'small');
      cm.halo.position.copy(cm.haloRest);
      cm.halo.scale.setScalar(1);
      cm.group.updateMatrixWorld(true);
      const tl = performance.now();
      const large = this._shoot(st, 'large');
      tm.small = Math.round(tl - ts);
      tm.large = Math.round(performance.now() - tl);
      if (small && large) {
        this.small.set(c.id, small.url);
        this.large.set(c.id, large.url);
        this.canvases.set(c.id, { small: small.canvas, large: large.canvas });
        this.fallbackIds.delete(c.id);
      }
    } finally {
      st.scene.remove(cm.group);
      cm.dispose();
      faceTex.dispose(); // frees the GPU copy; the canvas stays cached
    }
  }

  /** Render one framing; returns { url, canvas } or null when the render came back empty. */
  _frame(st, which) {
    const f = FRAMES[which];
    const cam = st.camera;
    // camera: 3/4 view around the head
    cam.fov = f.fov;
    cam.aspect = 1;
    const dist = f.half / Math.tan((f.fov * Math.PI) / 360);
    const tx = 0;
    const ty = f.cy;
    const tz = 0.02;
    cam.position.set(
      tx + Math.sin(CAM_AZIMUTH) * Math.cos(CAM_ELEVATION) * dist,
      ty + Math.sin(CAM_ELEVATION) * dist,
      tz + Math.cos(CAM_AZIMUTH) * Math.cos(CAM_ELEVATION) * dist
    );
    cam.near = Math.max(0.05, dist - 2);
    cam.far = dist + 3;
    cam.lookAt(tx, ty, tz);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  _shoot(st, which) {
    const r = this.renderer;
    const t = st.targets[which];
    const f = FRAMES[which];
    const cam = st.camera;
    this._frame(st, which);

    // --- save renderer state
    const prevRT = r.getRenderTarget();
    const prevFace = r.getActiveCubeFace?.() ?? 0;
    const prevMip = r.getActiveMipmapLevel?.() ?? 0;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevAutoClear = r.autoClear;
    const sm = r.shadowMap;
    const prevShadowAuto = sm.autoUpdate;
    const prevShadowNeeds = sm.needsUpdate;
    const outline = getOutlineMaterial();
    const prevThickness = outline.uniforms.uThickness.value;
    try {
      sm.autoUpdate = false;
      sm.needsUpdate = false;
      // bolder ink lines so the silhouette reads at icon size
      outline.uniforms.uThickness.value = prevThickness * (which === 'small' ? 1.55 : 1.35);
      r.autoClear = true;
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(t.src);
      r.clear(true, true, false);
      r.render(st.scene, cam);
      st.resolveMat.uniforms.tSrc.value = t.src.texture;
      r.setRenderTarget(t.dst);
      r.clear(true, false, false);
      r.render(st.quadScene, st.quadCam);
      r.readRenderTargetPixels(t.dst, 0, 0, t.S, t.S, t.pixels);
    } finally {
      outline.uniforms.uThickness.value = prevThickness;
      st.resolveMat.uniforms.tSrc.value = null;
      r.setRenderTarget(prevRT, prevFace, prevMip);
      r.setClearColor(prevClear, prevAlpha);
      r.autoClear = prevAutoClear;
      sm.autoUpdate = prevShadowAuto;
      sm.needsUpdate = prevShadowNeeds;
    }

    // --- flip Y into ImageData, count coverage
    const S = t.S;
    const src = t.pixels;
    const dst = t.image.data;
    const row = S * 4;
    let covered = 0;
    const fadeStart = Math.floor(S * (1 - (f.fade || 0)));
    for (let y = 0; y < S; y++) {
      const so = (S - 1 - y) * row;
      const d0 = y * row;
      dst.set(src.subarray(so, so + row), d0);
      if (y > fadeStart) {
        // smooth bottom fade (straight alpha)
        const u = (y - fadeStart) / (S - fadeStart);
        const k = 1 - u * u * (3 - 2 * u);
        for (let i = d0 + 3; i < d0 + row; i += 4) dst[i] = dst[i] * k;
      }
    }
    for (let i = 3; i < dst.length; i += 64) if (dst[i] > 8) covered++;
    if (covered < (S * S) / 16 / 50) return null; // < ~2 % coverage: the render failed
    t.bigCtx.putImageData(t.image, 0, 0);

    // --- downsample (2x) with high-quality smoothing
    const out = document.createElement('canvas');
    out.width = out.height = t.out;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(t.big, 0, 0, S, S, 0, 0, t.out, t.out);
    return { url: out.toDataURL('image/png'), canvas: out };
  }

  // ---- accessors ------------------------------------------------------------------------------------

  get(id) {
    try {
      return this.small.get(id) || this._lazyFallback(id, SMALL, this.small);
    } catch {
      return '';
    }
  }

  getLarge(id) {
    try {
      return this.large.get(id) || this._lazyFallback(id, LARGE, this.large) || this.get(id);
    } catch {
      return '';
    }
  }

  getCanvas(id, large = false) {
    return this.canvases.get(id)?.[large ? 'large' : 'small'] || null;
  }

  isFallback(id) {
    return this.fallbackIds.has(id) || !this.small.has(id);
  }

  _lazyFallback(id, size, map) {
    const c = this.characters.find((x) => x.id === id);
    if (!c) return '';
    const url = drawFallback(c, size);
    map.set(id, url);
    this.fallbackIds.add(id);
    return url;
  }
}
