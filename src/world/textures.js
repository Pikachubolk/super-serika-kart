// Procedural canvas textures for the world (owner: world agent).
//
// Everything is painted at load time on 2D canvases (no binary assets). A TextureKit owns the textures it
// creates so a track can dispose them; `sharedTexture()` is a module-level cache for textures that are
// shared across tracks (prop decals, sprites).
//
// Orientation reminder: CanvasTexture has flipY = true, so canvas TOP (y = 0) maps to v = 1. Ribbon meshes
// use v = distance along the track, so "forward" on a road texture is canvas UP.

import * as THREE from 'three';
import { mulberry32, hashString, clamp } from '../core/utils.js';

// ---------------------------------------------------------------------------------------------------------
// colour helpers
// ---------------------------------------------------------------------------------------------------------
const _c = new THREE.Color();
const _c2 = new THREE.Color();

/** sRGB hex -> [r,g,b] 0..255 */
export function rgbOf(hex) {
  _c.set(hex);
  const s = _c.getStyle(THREE.SRGBColorSpace); // 'rgb(r,g,b)'
  const m = s.match(/[\d.]+/g) || [0, 0, 0];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}
export function hexOf(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
/** Lighten (amt > 0) / darken (amt < 0) an sRGB hex colour. amt in -1..1 */
export function shade(hex, amt) {
  const [r, g, b] = rgbOf(hex);
  if (amt >= 0) return hexOf(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  return hexOf(r * (1 + amt), g * (1 + amt), b * (1 + amt));
}
/** Mix two sRGB hex colours. */
export function mixHex(a, b, t) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return hexOf(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export function rgba(hex, a) {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}
/** Relative luminance 0..1 of an sRGB hex. */
export function luma(hex) {
  const [r, g, b] = rgbOf(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
export function hsl(h, s, l, a = 1) {
  return `hsla(${h},${s}%,${l}%,${a})`;
}
/** THREE.Color from sRGB hex, adjusted. */
export function colorOf(hex) {
  return new THREE.Color(hex);
}

// ---------------------------------------------------------------------------------------------------------
// canvas helpers
// ---------------------------------------------------------------------------------------------------------
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: false });
  return { c, g, w, h };
}

/** Per-pixel noise: adds uniform noise in [-amt, amt] (0..255 units) to every pixel; optional mono. */
export function addNoise(g, w, h, amt, rng, { mono = true, alphaNoise = 0 } = {}) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (mono) {
      const n = (rng() * 2 - 1) * amt;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    } else {
      d[i] += (rng() * 2 - 1) * amt;
      d[i + 1] += (rng() * 2 - 1) * amt;
      d[i + 2] += (rng() * 2 - 1) * amt;
    }
    if (alphaNoise) d[i + 3] = clamp(d[i + 3] + (rng() * 2 - 1) * alphaNoise, 0, 255);
  }
  g.putImageData(img, 0, 0);
}

/** Soft blotches (radial gradients), wrapped so the texture tiles seamlessly. */
export function blotches(g, w, h, rng, count, color, alpha, rMin, rMax) {
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = rMin + rng() * (rMax - rMin);
    const a = alpha * (0.4 + rng() * 0.6);
    wrapDraw(w, h, x, y, r, (xx, yy) => {
      const gr = g.createRadialGradient(xx, yy, 0, xx, yy, r);
      gr.addColorStop(0, rgba(color, a));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.fillRect(xx - r, yy - r, r * 2, r * 2);
    });
  }
}

/** Call fn at (x,y) and at every wrapped copy needed for a seamless tile of size w x h with reach r. */
export function wrapDraw(w, h, x, y, r, fn) {
  const xs = [x];
  const ys = [y];
  if (x - r < 0) xs.push(x + w);
  if (x + r > w) xs.push(x - w);
  if (y - r < 0) ys.push(y + h);
  if (y + r > h) ys.push(y - h);
  for (const xx of xs) for (const yy of ys) fn(xx, yy);
}

/** Specks: many tiny dots. */
export function specks(g, w, h, rng, count, colors, rMin, rMax, alpha = 1) {
  for (let i = 0; i < count; i++) {
    const col = colors[(rng() * colors.length) | 0];
    const r = rMin + rng() * (rMax - rMin);
    g.fillStyle = rgba(col, alpha * (0.5 + rng() * 0.5));
    const x = rng() * w;
    const y = rng() * h;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
export { roundRect };

/** Wobbly crack polyline (random walk). */
function crack(g, rng, x, y, len, dirX, dirY, width, color, alpha, branches = 2) {
  g.strokeStyle = rgba(color, alpha);
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y);
  let px = x;
  let py = y;
  let ang = Math.atan2(dirY, dirX);
  const steps = 8 + ((rng() * 8) | 0);
  const seg = len / steps;
  const pts = [];
  for (let i = 0; i < steps; i++) {
    ang += (rng() - 0.5) * 1.1;
    px += Math.cos(ang) * seg;
    py += Math.sin(ang) * seg;
    g.lineTo(px, py);
    pts.push([px, py, ang]);
  }
  g.stroke();
  if (branches > 0) {
    for (let b = 0; b < branches; b++) {
      const p = pts[(rng() * pts.length) | 0];
      crack(g, rng, p[0], p[1], len * 0.45, Math.cos(p[2] + (rng() < 0.5 ? 1 : -1)), Math.sin(p[2] + 1), width * 0.7, color, alpha * 0.8, branches - 1);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// texture creation
// ---------------------------------------------------------------------------------------------------------
export function canvasTexture(c, { repeat = true, srgb = true, anisotropy = 8, mipmaps = true, nearest = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = mipmaps;
  if (!mipmaps) t.minFilter = THREE.LinearFilter;
  if (nearest) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
  }
  t.needsUpdate = true;
  return t;
}

const FONT_DISPLAY = '"Lilita One", "Arial Black", "Segoe UI Black", sans-serif';
const FONT_UI = '"M PLUS Rounded 1c", "Segoe UI", sans-serif';
export { FONT_DISPLAY, FONT_UI };

/**
 * Paint a canvas with text now, and repaint it when the web fonts finish loading (so the banner uses
 * Lilita One even if the track was built before the font arrived).
 */
export function paintWithFonts(texture, paint) {
  paint();
  texture.needsUpdate = true;
  try {
    if (typeof document !== 'undefined' && document.fonts && !document.fonts.check('40px "Lilita One"')) {
      Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('800 40px "M PLUS Rounded 1c"')])
        .then(() => {
          paint();
          texture.needsUpdate = true;
        })
        .catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/** Outlined, chunky display text. */
export function chunkyText(g, text, x, y, size, { fill = '#fff', stroke = '#16213a', strokeW = 0.16, font = FONT_DISPLAY, align = 'center', italic = false, shadow = true, maxWidth } = {}) {
  g.save();
  g.font = `${italic ? 'italic ' : ''}${size}px ${font}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  let scaleX = 1;
  if (maxWidth) {
    const mw = g.measureText(text).width + size * strokeW * 2;
    if (mw > maxWidth) scaleX = maxWidth / mw;
  }
  g.translate(x, y);
  g.scale(scaleX, 1);
  if (shadow) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillText(text, size * 0.04, size * 0.07);
  }
  if (strokeW > 0) {
    g.strokeStyle = stroke;
    g.lineWidth = size * strokeW * 2;
    g.strokeText(text, 0, 0);
  }
  g.fillStyle = fill;
  g.fillText(text, 0, 0);
  g.restore();
}

// global cache for textures shared across tracks (props, sprites)
const shared = new Map();
/** Shared (never disposed) texture by key. */
export function sharedTexture(key, make) {
  let t = shared.get(key);
  if (!t) {
    t = make();
    shared.set(key, t);
  }
  return t;
}

// ---------------------------------------------------------------------------------------------------------
// Sprites (shared)
// ---------------------------------------------------------------------------------------------------------
export function glowTexture() {
  return sharedTexture('glow', () => {
    const { c, g } = makeCanvas(128, 128);
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return canvasTexture(c, { repeat: false, srgb: true });
  });
}

export function cloudTexture(variant = 0) {
  return sharedTexture(`cloud${variant}`, () => {
    const W = 512;
    const H = 256;
    const { c, g } = makeCanvas(W, H);
    const rng = mulberry32(991 + variant * 17);
    // puffs along a baseline, flat-ish bottom
    const puffs = [];
    const n = 9 + ((rng() * 5) | 0);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = W * (0.14 + t * 0.72) + (rng() - 0.5) * 30;
      const r = (0.5 - Math.abs(t - 0.5)) * 150 + 40 + rng() * 30;
      const y = H * 0.7 - r * (0.45 + rng() * 0.25);
      puffs.push([x, y, r]);
    }
    // shadow layer
    for (const [x, y, r] of puffs) {
      const gr = g.createRadialGradient(x, y + r * 0.25, r * 0.2, x, y + r * 0.2, r);
      gr.addColorStop(0, 'rgba(200,210,230,0.95)');
      gr.addColorStop(0.75, 'rgba(200,210,230,0.7)');
      gr.addColorStop(1, 'rgba(200,210,230,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y + r * 0.2, r, 0, Math.PI * 2);
      g.fill();
    }
    // lit layer (offset up)
    for (const [x, y, r] of puffs) {
      const gr = g.createRadialGradient(x - r * 0.2, y - r * 0.3, r * 0.1, x, y, r * 0.95);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.7, 'rgba(255,255,255,0.85)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y - r * 0.05, r * 0.92, 0, Math.PI * 2);
      g.fill();
    }
    // flatten bottom softly
    const fade = g.createLinearGradient(0, H * 0.72, 0, H);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = fade;
    g.fillRect(0, H * 0.72, W, H * 0.28);
    g.globalCompositeOperation = 'source-over';
    return canvasTexture(c, { repeat: false });
  });
}

/** Particle sprite atlas-free textures for weather. kind: dot|petal|leaf|star|flake */
export function particleTexture(kind) {
  return sharedTexture(`particle:${kind}`, () => {
    const S = 64;
    const { c, g } = makeCanvas(S, S);
    g.translate(S / 2, S / 2);
    if (kind === 'petal') {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(0, -26);
      g.bezierCurveTo(20, -18, 18, 14, 0, 26);
      g.bezierCurveTo(-18, 14, -20, -18, 0, -26);
      g.fill();
      // notch
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.moveTo(-5, -28);
      g.lineTo(0, -19);
      g.lineTo(5, -28);
      g.fill();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(255,120,170,0.35)';
      g.beginPath();
      g.ellipse(0, 12, 6, 10, 0, 0, Math.PI * 2);
      g.fill();
    } else if (kind === 'leaf') {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(0, -28);
      g.bezierCurveTo(22, -12, 16, 16, 0, 28);
      g.bezierCurveTo(-16, 16, -22, -12, 0, -28);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -24);
      g.lineTo(0, 26);
      g.stroke();
    } else if (kind === 'star') {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.2, 'rgba(255,255,255,0.6)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(-32, -32, 64, 64);
      g.fillStyle = '#fff';
      for (let k = 0; k < 2; k++) {
        g.save();
        g.rotate((k * Math.PI) / 2);
        g.beginPath();
        g.moveTo(0, -30);
        g.lineTo(3, 0);
        g.lineTo(0, 30);
        g.lineTo(-3, 0);
        g.fill();
        g.restore();
      }
    } else {
      // soft dot / flake / ember
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(kind === 'flake' ? 0.45 : 0.3, 'rgba(255,255,255,0.8)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(-32, -32, 64, 64);
    }
    return canvasTexture(c, { repeat: false });
  });
}

// ---------------------------------------------------------------------------------------------------------
// TextureKit: per-track textures (disposed with the track)
// ---------------------------------------------------------------------------------------------------------
export class TextureKit {
  constructor({ quality = 'high', seed = 1 } = {}) {
    this.quality = quality;
    this.seed = seed;
    this.cache = new Map();
    this.aniso = quality === 'low' ? 2 : quality === 'medium' ? 4 : 8;
    this.big = quality === 'high' ? 1024 : 512;
    this.mid = quality === 'low' ? 256 : 512;
  }

  _get(key, make) {
    let t = this.cache.get(key);
    if (!t) {
      t = make();
      this.cache.set(key, t);
    }
    return t;
  }

  _rng(key) {
    return mulberry32(hashString(key) ^ this.seed);
  }

  tex(c, opts = {}) {
    return canvasTexture(c, { anisotropy: this.aniso, ...opts });
  }

  dispose() {
    for (const t of this.cache.values()) {
      if (t && t.isTexture) t.dispose();
      else if (t && typeof t === 'object') for (const v of Object.values(t)) v?.isTexture && v.dispose();
    }
    this.cache.clear();
  }

  // ------------------------------------------------------------------------------------------------------
  // Road surface. Returns { map, emissiveMap?, lengthPerTile } — the texture spans the whole road width (u)
  // and `lengthPerTile` world units along the track (v).
  // ------------------------------------------------------------------------------------------------------
  road(road, widthHint = 22) {
    const key = `road:${road.style}:${road.color}:${road.color2}:${road.lines}:${Math.round(widthHint)}`;
    return this._get(key, () => {
      const S = this.big;
      const rng = this._rng(key);
      const { c, g } = makeCanvas(S, S);
      const pxPerUnit = S / widthHint; // texture spans widthHint across and widthHint along
      const A = road.color;
      const B = road.color2 || road.color;
      let em = null;
      const style = road.style;
      const lines = road.lines;
      const lineCol = road.lineColor || '#f4f1e8';

      const dashes = (col = lineCol, alpha = 0.92, lanes = false) => {
        const xsU = lanes ? [1 / 3, 2 / 3] : [0.5];
        const lw = 0.3 * pxPerUnit;
        for (const u of xsU) {
          for (let k = 0; k < 2; k++) {
            const y0 = (k * S) / 2 + S * 0.06;
            const len = S * 0.24;
            g.fillStyle = rgba(col, alpha);
            roundRect(g, u * S - lw / 2, y0, lw, len, lw * 0.3);
            g.fill();
          }
        }
      };

      if (style === 'asphalt') {
        g.fillStyle = A;
        g.fillRect(0, 0, S, S);
        blotches(g, S, S, rng, 26, B, 0.55, S * 0.04, S * 0.14);
        blotches(g, S, S, rng, 16, shade(A, 0.12), 0.35, S * 0.03, S * 0.1);
        // racing-line wear (two faint darker lanes)
        for (const u of [0.32, 0.68]) {
          const gr = g.createLinearGradient(u * S - S * 0.08, 0, u * S + S * 0.08, 0);
          gr.addColorStop(0, rgba('#000000', 0));
          gr.addColorStop(0.5, rgba('#000000', 0.07));
          gr.addColorStop(1, rgba('#000000', 0));
          g.fillStyle = gr;
          g.fillRect(u * S - S * 0.08, 0, S * 0.16, S);
        }
        specks(g, S, S, rng, S * 6, [shade(A, 0.35), shade(A, -0.3), shade(A, 0.2)], 0.4, 1.3, 0.55);
        for (let i = 0; i < 5; i++) crack(g, rng, rng() * S, rng() * S, S * 0.12, rng() - 0.5, rng() - 0.5, 1.2, shade(A, -0.45), 0.35, 1);
        if (lines) dashes(lineCol, 0.9, lines === 'lanes');
        addNoise(g, S, S, 9, rng);
      } else if (style === 'stone') {
        g.fillStyle = shade(B, -0.45);
        g.fillRect(0, 0, S, S);
        const rowH = 0.62 * pxPerUnit;
        const rows = Math.max(4, Math.round(S / rowH));
        const rh = S / rows;
        for (let r = 0; r < rows; r++) {
          let x = -rng() * rh;
          while (x < S) {
            const w = rh * (0.9 + rng() * 0.9);
            const col = mixHex(A, B, rng());
            const tint = shade(col, (rng() - 0.5) * 0.18);
            const gap = rh * 0.09;
            const drawStone = (ox) => {
              roundRect(g, x + ox + gap, r * rh + gap, w - gap * 2, rh - gap * 2, rh * 0.32);
              g.fillStyle = tint;
              g.fill();
              // bevel light/shadow
              const gr = g.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
              gr.addColorStop(0, 'rgba(255,255,255,0.22)');
              gr.addColorStop(0.45, 'rgba(255,255,255,0)');
              gr.addColorStop(1, 'rgba(0,0,0,0.22)');
              g.fillStyle = gr;
              g.fill();
            };
            drawStone(0);
            if (x + w > S) drawStone(-S);
            x += w;
          }
        }
        specks(g, S, S, rng, S * 3, [shade(A, 0.3), shade(A, -0.35)], 0.4, 1.2, 0.35);
        if (lines) dashes('#f2efe6', 0.75);
        addNoise(g, S, S, 7, rng);
      } else if (style === 'brick') {
        g.fillStyle = shade('#d8cfc0', -0.15);
        g.fillRect(0, 0, S, S);
        const bh = 0.42 * pxPerUnit;
        const rows = Math.max(6, Math.round(S / bh));
        const rh = S / rows;
        const bw = rh * 2.2;
        for (let r = 0; r < rows; r++) {
          const off = r % 2 ? bw / 2 : 0;
          for (let x = -bw + off; x < S + bw; x += bw) {
            const col = shade(mixHex(A, B, rng()), (rng() - 0.5) * 0.2);
            const m = rh * 0.08;
            g.fillStyle = col;
            g.fillRect(x + m, r * rh + m, bw - m * 2, rh - m * 2);
            g.fillStyle = 'rgba(255,255,255,0.12)';
            g.fillRect(x + m, r * rh + m, bw - m * 2, rh * 0.18);
            g.fillStyle = 'rgba(0,0,0,0.14)';
            g.fillRect(x + m, (r + 1) * rh - m - rh * 0.16, bw - m * 2, rh * 0.16);
          }
        }
        specks(g, S, S, rng, S * 3, [shade(A, 0.25), shade(A, -0.4)], 0.4, 1.2, 0.35);
        if (lines) dashes('#f5f0e6', 0.8);
        addNoise(g, S, S, 8, rng);
      } else if (style === 'neon') {
        g.fillStyle = A;
        g.fillRect(0, 0, S, S);
        blotches(g, S, S, rng, 14, shade(A, 0.1), 0.4, S * 0.05, S * 0.15);
        addNoise(g, S, S, 5, rng);
        const eC = makeCanvas(S, S);
        const e = eC.g;
        e.fillStyle = '#000';
        e.fillRect(0, 0, S, S);
        const glowCol = B;
        const cell = S / 8;
        const drawGrid = (ctx, alphaMul, blur) => {
          ctx.save();
          ctx.strokeStyle = rgba(glowCol, 0.85 * alphaMul);
          ctx.shadowColor = glowCol;
          ctx.shadowBlur = blur;
          ctx.lineWidth = Math.max(2, S / 256);
          for (let i = 0; i <= 8; i++) {
            ctx.beginPath();
            ctx.moveTo(i * cell, 0);
            ctx.lineTo(i * cell, S);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i * cell);
            ctx.lineTo(S, i * cell);
            ctx.stroke();
          }
          ctx.restore();
        };
        drawGrid(g, 0.5, 0);
        drawGrid(e, 0.8, S / 64);
        // bright lane dashes / centre arrows
        const dashCol = mixHex(glowCol, '#ffffff', 0.5);
        for (const ctx of [g, e]) {
          ctx.save();
          ctx.shadowColor = glowCol;
          ctx.shadowBlur = S / 50;
          ctx.fillStyle = dashCol;
          const lw = S * 0.012;
          if (lines) {
            for (let k = 0; k < 2; k++) {
              ctx.fillRect(S / 2 - lw / 2, (k * S) / 2 + S * 0.08, lw, S * 0.3);
            }
          }
          ctx.restore();
        }
        em = this.tex(eC.c);
      } else if (style === 'rainbow') {
        // lengthwise hue bands across u (the builder scrolls offset.x so the colours flow sideways)
        const bands = 7;
        for (let x = 0; x < S; x++) {
          const u = x / S;
          const hue = (u * 360) % 360;
          g.fillStyle = hsl(hue, 95, 64);
          g.fillRect(x, 0, 1, S);
        }
        // band separators
        for (let b = 0; b < bands; b++) {
          const x = (b / bands) * S;
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.fillRect(x - 1, 0, 2, S);
        }
        // translucent diamond/chevron sheen
        g.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 4; k++) {
          const y = (k / 4) * S;
          g.fillStyle = 'rgba(255,255,255,0.10)';
          g.beginPath();
          g.moveTo(0, y + S * 0.12);
          g.lineTo(S / 2, y);
          g.lineTo(S, y + S * 0.12);
          g.lineTo(S, y + S * 0.18);
          g.lineTo(S / 2, y + S * 0.06);
          g.lineTo(0, y + S * 0.18);
          g.fill();
        }
        g.globalCompositeOperation = 'source-over';
        specks(g, S, S, rng, S * 0.8, ['#ffffff'], 0.8, 2.4, 0.9);
        em = this.tex(c);
      } else if (style === 'ice') {
        const gr = g.createLinearGradient(0, 0, S, S);
        gr.addColorStop(0, A);
        gr.addColorStop(0.5, B);
        gr.addColorStop(1, A);
        g.fillStyle = gr;
        g.fillRect(0, 0, S, S);
        blotches(g, S, S, rng, 30, '#ffffff', 0.5, S * 0.04, S * 0.14);
        blotches(g, S, S, rng, 14, shade(B, -0.18), 0.35, S * 0.05, S * 0.14);
        // long streaks (skate marks)
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        for (let i = 0; i < 40; i++) {
          g.lineWidth = 0.6 + rng() * 1.4;
          const x = rng() * S;
          const y = rng() * S;
          g.beginPath();
          g.moveTo(x, y);
          g.quadraticCurveTo(x + (rng() - 0.5) * 30, y + 60, x + (rng() - 0.5) * 40, y + 90 + rng() * 120);
          g.stroke();
        }
        for (let i = 0; i < 14; i++) {
          const x = rng() * S;
          const y = rng() * S;
          crack(g, rng, x + 1, y + 1, S * (0.08 + rng() * 0.14), rng() - 0.5, rng() - 0.5, 2.2, shade(B, -0.35), 0.35, 2);
          crack(g, rng, x, y, S * (0.08 + rng() * 0.14), rng() - 0.5, rng() - 0.5, 1.4, '#ffffff', 0.85, 2);
        }
        specks(g, S, S, rng, S * 2, ['#ffffff'], 0.5, 1.4, 0.8);
        if (lines) dashes('#ffffff', 0.6);
        addNoise(g, S, S, 4, rng);
      } else if (style === 'dirt') {
        g.fillStyle = A;
        g.fillRect(0, 0, S, S);
        blotches(g, S, S, rng, 40, B, 0.6, S * 0.03, S * 0.12);
        blotches(g, S, S, rng, 20, shade(A, 0.18), 0.4, S * 0.02, S * 0.08);
        // ruts
        for (const u of [0.3, 0.7]) {
          for (let i = 0; i < 26; i++) {
            g.strokeStyle = rgba(shade(A, -0.35), 0.12 + rng() * 0.1);
            g.lineWidth = 1 + rng() * 3;
            const x = u * S + (rng() - 0.5) * S * 0.12;
            g.beginPath();
            g.moveTo(x, 0);
            g.lineTo(x + (rng() - 0.5) * 8, S);
            g.stroke();
          }
        }
        // pebbles
        for (let i = 0; i < S * 0.9; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const r = 1 + rng() * 3.5 * (S / 1024);
          g.fillStyle = shade(mixHex(A, '#9a8f86', rng()), (rng() - 0.5) * 0.3);
          g.beginPath();
          g.ellipse(x, y, r * 1.3, r, rng() * 3, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.18)';
          g.beginPath();
          g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.5, r * 0.35, 0, 0, Math.PI * 2);
          g.fill();
        }
        if (lines) dashes('#efe6d2', 0.6);
        addNoise(g, S, S, 10, rng);
      } else if (style === 'wood') {
        const plankW = 0.85 * pxPerUnit; // plank width along v
        const rows = Math.max(6, Math.round(S / plankW));
        const ph = S / rows;
        for (let r = 0; r < rows; r++) {
          // boards across the road, 2-3 per row with staggered seams
          let x = -rng() * S * 0.3;
          while (x < S) {
            const w = S * (0.3 + rng() * 0.35);
            const col = shade(mixHex(A, B, rng()), (rng() - 0.5) * 0.14);
            const paint = (ox) => {
              g.fillStyle = col;
              g.fillRect(x + ox, r * ph, w, ph);
              // grain
              g.save();
              g.beginPath();
              g.rect(x + ox, r * ph, w, ph);
              g.clip();
              for (let k = 0; k < 7; k++) {
                g.strokeStyle = rgba(shade(col, -0.35), 0.18 + rng() * 0.12);
                g.lineWidth = 0.8 + rng();
                const yy = r * ph + rng() * ph;
                g.beginPath();
                g.moveTo(x + ox, yy);
                for (let s = 1; s <= 8; s++) g.lineTo(x + ox + (w * s) / 8, yy + Math.sin(s * 1.3 + rng()) * ph * 0.08);
                g.stroke();
              }
              // knot
              if (rng() < 0.35) {
                g.strokeStyle = rgba(shade(col, -0.4), 0.4);
                g.lineWidth = 1.2;
                const kx = x + ox + rng() * w;
                const ky = r * ph + ph * (0.3 + rng() * 0.4);
                for (let q = 1; q < 4; q++) {
                  g.beginPath();
                  g.ellipse(kx, ky, q * ph * 0.08, q * ph * 0.05, 0, 0, Math.PI * 2);
                  g.stroke();
                }
              }
              g.restore();
              // seams + nails
              g.fillStyle = 'rgba(0,0,0,0.45)';
              g.fillRect(x + ox, r * ph, 2, ph);
              g.fillStyle = 'rgba(40,30,20,0.7)';
              for (const nx of [x + ox + 6, x + ox + w - 6]) {
                g.beginPath();
                g.arc(nx, r * ph + ph * 0.3, 1.8, 0, Math.PI * 2);
                g.arc(nx, r * ph + ph * 0.7, 1.8, 0, Math.PI * 2);
                g.fill();
              }
            };
            paint(0);
            if (x + w > S) paint(-S);
            x += w;
          }
          g.fillStyle = 'rgba(0,0,0,0.5)';
          g.fillRect(0, r * ph, S, Math.max(2, ph * 0.06));
          g.fillStyle = 'rgba(255,255,255,0.10)';
          g.fillRect(0, r * ph + ph * 0.06, S, ph * 0.1);
        }
        if (lines) dashes('#fff6e0', 0.7);
        addNoise(g, S, S, 6, rng);
      } else if (style === 'tile') {
        const tileU = 1.8 * pxPerUnit;
        const n = Math.max(4, Math.round(S / tileU));
        const ts = S / n;
        g.fillStyle = shade(B, -0.4);
        g.fillRect(0, 0, S, S);
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const base = (i + j) % 2 ? A : B;
            const col = shade(base, (rng() - 0.5) * 0.08);
            const m = ts * 0.04;
            g.fillStyle = col;
            g.fillRect(i * ts + m, j * ts + m, ts - m * 2, ts - m * 2);
            const gr = g.createLinearGradient(i * ts, j * ts, i * ts + ts, j * ts + ts);
            gr.addColorStop(0, 'rgba(255,255,255,0.16)');
            gr.addColorStop(0.5, 'rgba(255,255,255,0)');
            gr.addColorStop(1, 'rgba(0,0,0,0.08)');
            g.fillStyle = gr;
            g.fillRect(i * ts + m, j * ts + m, ts - m * 2, ts - m * 2);
          }
        if (lines) dashes('#ffffff', 0.8);
        addNoise(g, S, S, 5, rng);
      }
      const map = this.tex(c);
      return { map, emissiveMap: em, lengthPerTile: widthHint };
    });
  }

  // ------------------------------------------------------------------------------------------------------
  // Off-road strip (isotropic, tile = `tile` world units square)
  // ------------------------------------------------------------------------------------------------------
  offroad(off, road, tile = 8) {
    const key = `off:${off.type}:${off.color}:${road.color}`;
    return this._get(key, () => {
      const S = this.mid;
      const rng = this._rng(key);
      const { c, g } = makeCanvas(S, S);
      const A = off.color;
      const type = off.type;
      if (type === 'grass' || type === 'flowers') {
        g.fillStyle = A;
        g.fillRect(0, 0, S, S);
        blotches(g, S, S, rng, 18, shade(A, -0.12), 0.5, S * 0.05, S * 0.15);
        blotches(g, S, S, rng, 12, shade(A, 0.1), 0.4, S * 0.05, S * 0.12);
        for (let i = 0; i < S * 5; i++) {
          const x = rng() * S;
          const y = rng() * S;
          g.strokeStyle = rgba(shade(A, (rng() - 0.45) * 0.5), 0.55);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + (rng() - 0.5) * 3, y - 2 - rng() * 5);
          g.stroke();
        }
        if (type === 'flowers') {
          const cols = ['#ff7eb6', '#ffd23f', '#ffffff', '#b58cff', '#ff5a6e', '#7ec8ff'];
          for (let i = 0; i < S * 0.5; i++) {
            const x = rng() * S;
            const y = rng() * S;
            const col = cols[(rng() * cols.length) | 0];
            const r = 2 + rng() * 2.5;
            g.fillStyle = col;
            for (let p = 0; p < 5; p++) {
              const a = (p / 5) * Math.PI * 2;
              g.beginPath();
              g.arc(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.55, 0, Math.PI * 2);
              g.fill();
            }
            g.fillStyle = '#ffe066';
            g.beginPath();
            g.arc(x, y, r * 0.35, 0, Math.PI * 2);
            g.fill();
          }
        } else {
          specks(g, S, S, rng, S * 0.12, ['#ffffff', '#ffe98a'], 0.8, 1.6, 0.8);
        }
        addNoise(g, S, S, 6, rng);
      } else if (type === 'sand') {
        g.fillStyle = A;
        g.fillRect(0, 0, S, S);
        blotches(g, S, S, rng, 16, shade(A, -0.08), 0.5, S * 0.06, S * 0.18);
        // ripples
        for (let k = 0; k < 22; k++) {
          const y0 = (k / 22) * S;
          g.strokeStyle = rgba(shade(A, -0.16), 0.35);
          g.lineWidth = 1.5;
          g.beginPath();
          for (let x = 0; x <= S; x += 8) {
            const y = y0 + Math.sin((x / S) * Math.PI * 4 + k) * 4 + Math.sin((x / S) * Math.PI * 10 + k * 3) * 1.5;
            if (x === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
          g.strokeStyle = rgba(shade(A, 0.2), 0.3);
          g.beginPath();
          for (let x = 0; x <= S; x += 8) {
            const y = y0 + 2 + Math.sin((x / S) * Math.PI * 4 + k) * 4 + Math.sin((x / S) * Math.PI * 10 + k * 3) * 1.5;
            if (x === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
        specks(g, S, S, rng, S * 3, [shade(A, 0.25), shade(A, -0.25)], 0.4, 1, 0.6);
        addNoise(g, S, S, 7, rng);
      } else if (type === 'snow') {
        g.fillStyle = A;
        g.fillRect(0, 0, S, S);
        blotches(g, S, S, rng, 20, '#b9d2ee', 0.35, S * 0.05, S * 0.16);
        blotches(g, S, S, rng, 16, '#ffffff', 0.6, S * 0.04, S * 0.12);
        specks(g, S, S, rng, S * 1.5, ['#ffffff', '#dbeeff'], 0.5, 1.4, 1);
        addNoise(g, S, S, 4, rng);
      } else if (type === 'dirt' || type === 'gravel') {
        g.fillStyle = A;
        g.fillRect(0, 0, S, S);
        blotches(g, S, S, rng, 24, shade(A, -0.2), 0.5, S * 0.04, S * 0.12);
        const n = type === 'gravel' ? S * 6 : S * 1.5;
        for (let i = 0; i < n; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const r = (type === 'gravel' ? 1.2 : 1) + rng() * (type === 'gravel' ? 2.6 : 3);
          const col = shade(type === 'gravel' ? mixHex(A, '#b8b2aa', rng() * 0.6) : A, (rng() - 0.5) * 0.4);
          g.fillStyle = col;
          g.beginPath();
          g.ellipse(x, y, r * 1.2, r, rng() * 3, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.16)';
          g.beginPath();
          g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.45, r * 0.3, 0, 0, Math.PI * 2);
          g.fill();
        }
        addNoise(g, S, S, 8, rng);
      } else {
        // 'none' -> a road-coloured shoulder
        const base = off.color || shade(road.color, -0.12);
        g.fillStyle = base;
        g.fillRect(0, 0, S, S);
        blotches(g, S, S, rng, 16, shade(base, -0.12), 0.5, S * 0.05, S * 0.15);
        specks(g, S, S, rng, S * 2, [shade(base, 0.25), shade(base, -0.25)], 0.4, 1, 0.5);
        addNoise(g, S, S, 6, rng);
      }
      const map = this.tex(c);
      return { map, tile };
    });
  }

  // ------------------------------------------------------------------------------------------------------
  // Ground detail: near-white luminance texture multiplied by vertex colours (tile world units).
  // ------------------------------------------------------------------------------------------------------
  groundDetail(type, tile = 14) {
    const key = `ground:${type}`;
    return this._get(key, () => {
      const S = this.mid;
      const rng = this._rng(key);
      const { c, g } = makeCanvas(S, S);
      g.fillStyle = '#f2f2f2';
      g.fillRect(0, 0, S, S);
      if (type === 'grass') {
        blotches(g, S, S, rng, 30, '#c8c8c8', 0.5, S * 0.03, S * 0.12);
        blotches(g, S, S, rng, 20, '#ffffff', 0.6, S * 0.03, S * 0.1);
        for (let i = 0; i < S * 6; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const v = 200 + rng() * 55;
          g.strokeStyle = `rgba(${v},${v},${v},0.6)`;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + (rng() - 0.5) * 3, y - 2 - rng() * 4);
          g.stroke();
        }
      } else if (type === 'sand') {
        blotches(g, S, S, rng, 20, '#d8d8d8', 0.4, S * 0.05, S * 0.16);
        for (let k = 0; k < 16; k++) {
          const y0 = (k / 16) * S;
          g.strokeStyle = 'rgba(190,190,190,0.45)';
          g.lineWidth = 2;
          g.beginPath();
          for (let x = 0; x <= S; x += 8) {
            const y = y0 + Math.sin((x / S) * Math.PI * 4 + k * 1.7) * 6 + Math.sin((x / S) * Math.PI * 8 + k) * 2;
            if (x === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.6)';
          g.beginPath();
          for (let x = 0; x <= S; x += 8) {
            const y = y0 + 3 + Math.sin((x / S) * Math.PI * 4 + k * 1.7) * 6 + Math.sin((x / S) * Math.PI * 8 + k) * 2;
            if (x === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
      } else if (type === 'asphalt') {
        // city: concrete slabs / sidewalk grid
        const n = 4;
        const ts = S / n;
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const v = 225 + rng() * 25;
            g.fillStyle = `rgb(${v},${v},${v})`;
            g.fillRect(i * ts + 2, j * ts + 2, ts - 4, ts - 4);
          }
        g.fillStyle = 'rgba(120,120,120,0.6)';
        for (let i = 0; i <= n; i++) {
          g.fillRect(i * ts - 1.5, 0, 3, S);
          g.fillRect(0, i * ts - 1.5, S, 3);
        }
        blotches(g, S, S, rng, 16, '#bbbbbb', 0.35, S * 0.04, S * 0.12);
      } else if (type === 'snow') {
        blotches(g, S, S, rng, 22, '#d6dde6', 0.45, S * 0.05, S * 0.16);
        blotches(g, S, S, rng, 16, '#ffffff', 0.8, S * 0.03, S * 0.1);
        specks(g, S, S, rng, S, ['#ffffff'], 0.5, 1.3, 1);
      } else {
        // rock / generic
        blotches(g, S, S, rng, 30, '#b8b8b8', 0.55, S * 0.03, S * 0.14);
        blotches(g, S, S, rng, 20, '#ffffff', 0.6, S * 0.03, S * 0.1);
        for (let i = 0; i < 10; i++) crack(g, rng, rng() * S, rng() * S, S * 0.2, rng() - 0.5, rng() - 0.5, 1.5, '#707070', 0.4, 2);
      }
      addNoise(g, S, S, 10, rng);
      const map = this.tex(c);
      return { map, tile };
    });
  }

  /** Rock face texture (cliffs, embankments on liquid themes). tile world units square. */
  rockFace(color, tile = 10) {
    const key = `rock:${color}`;
    return this._get(key, () => {
      const S = this.mid;
      const rng = this._rng(key);
      const { c, g } = makeCanvas(S, S);
      g.fillStyle = color;
      g.fillRect(0, 0, S, S);
      // horizontal strata (v = height since cliffs use v = depth)
      for (let k = 0; k < 9; k++) {
        const y = (k / 9) * S + rng() * 10;
        g.fillStyle = rgba(shade(color, (rng() - 0.5) * 0.35), 0.6);
        g.fillRect(0, y, S, S / 9 * (0.4 + rng() * 0.5));
        g.strokeStyle = rgba(shade(color, -0.45), 0.45);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + k) * 3);
        g.stroke();
      }
      blotches(g, S, S, rng, 26, shade(color, -0.25), 0.5, S * 0.03, S * 0.12);
      blotches(g, S, S, rng, 16, shade(color, 0.2), 0.4, S * 0.03, S * 0.1);
      for (let i = 0; i < 12; i++) crack(g, rng, rng() * S, rng() * S, S * 0.2, rng() - 0.5, 1, 1.4, shade(color, -0.55), 0.5, 1);
      addNoise(g, S, S, 9, rng);
      return { map: this.tex(c), tile };
    });
  }

  /** Bridge deck / floating-road concrete: light panels with seams, soft stains. Neutral (tint with vertex colours). */
  deckPanel(tile = 8) {
    const key = `deck:${tile}`;
    return this._get(key, () => {
      const S = this.quality === 'low' ? 128 : 256;
      const rng = this._rng(key);
      const { c, g } = makeCanvas(S, S);
      g.fillStyle = '#e6e6e6';
      g.fillRect(0, 0, S, S);
      blotches(g, S, S, rng, 14, '#cfcfcf', 0.45, S * 0.05, S * 0.16);
      blotches(g, S, S, rng, 10, '#f6f6f6', 0.5, S * 0.04, S * 0.12);
      // panel seams (two panels per tile each way) + bolts
      g.fillStyle = 'rgba(90,90,96,0.55)';
      for (let k = 0; k < 2; k++) {
        g.fillRect(0, (k * S) / 2, S, 2);
        g.fillRect((k * S) / 2, 0, 2, S);
      }
      g.fillStyle = 'rgba(255,255,255,0.5)';
      for (let k = 0; k < 2; k++) {
        g.fillRect(0, (k * S) / 2 + 2, S, 1);
        g.fillRect((k * S) / 2 + 2, 0, 1, S);
      }
      g.fillStyle = 'rgba(80,80,88,0.6)';
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (const [dx, dy] of [[10, 10], [S / 2 - 10, 10], [10, S / 2 - 10], [S / 2 - 10, S / 2 - 10]]) g.fillRect(a * (S / 2) + dx - 1.5, b * (S / 2) + dy - 1.5, 3, 3);
      addNoise(g, S, S, 7, rng);
      return { map: this.tex(c), tile };
    });
  }

  // ------------------------------------------------------------------------------------------------------
  // Curb: alternating blocks along v (one tile = 2 blocks), u across the curb width.
  // ------------------------------------------------------------------------------------------------------
  curb(colorA, colorB) {
    const key = `curb:${colorA}:${colorB}`;
    return this._get(key, () => {
      const W = 64;
      const H = 256;
      const rng = this._rng(key);
      const { c, g } = makeCanvas(W, H);
      g.fillStyle = colorA;
      g.fillRect(0, 0, W, H / 2);
      g.fillStyle = colorB;
      g.fillRect(0, H / 2, W, H / 2);
      // bevel shading across u (u=0 inner edge low, u=1 outer)
      const gr = g.createLinearGradient(0, 0, W, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.18)');
      gr.addColorStop(0.3, 'rgba(255,255,255,0.12)');
      gr.addColorStop(0.7, 'rgba(255,255,255,0.05)');
      gr.addColorStop(1, 'rgba(0,0,0,0.2)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, 0, W, 2);
      g.fillRect(0, H / 2 - 1, W, 2);
      addNoise(g, W, H, 7, rng);
      return this.tex(c);
    });
  }

  /** Scrolling emissive light strip for 'glow' edges (u across, v along; tile = 1 pulse). */
  glowStrip(colorA, colorB) {
    const key = `glowstrip:${colorA}:${colorB}`;
    return this._get(key, () => {
      const W = 32;
      const H = 256;
      const { c, g } = makeCanvas(W, H);
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, colorA);
      gr.addColorStop(0.42, colorA);
      gr.addColorStop(0.5, mixHex(colorB, '#ffffff', 0.4));
      gr.addColorStop(0.58, colorB);
      gr.addColorStop(0.92, colorB);
      gr.addColorStop(1, colorA);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      const across = g.createLinearGradient(0, 0, W, 0);
      across.addColorStop(0, 'rgba(0,0,0,0.35)');
      across.addColorStop(0.5, 'rgba(255,255,255,0.25)');
      across.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = across;
      g.fillRect(0, 0, W, H);
      return this.tex(c);
    });
  }

  /** Checkered start line. `cells` columns across u, 2 rows along v. */
  checker(cA = '#ffffff', cB = '#16181f') {
    const key = `checker:${cA}:${cB}`;
    return this._get(key, () => {
      const S = 64;
      const { c, g } = makeCanvas(S, S);
      g.fillStyle = cA;
      g.fillRect(0, 0, S, S);
      g.fillStyle = cB;
      g.fillRect(0, 0, S / 2, S / 2);
      g.fillRect(S / 2, S / 2, S / 2, S / 2);
      return this.tex(c, { nearest: false, anisotropy: this.aniso });
    });
  }

  // ------------------------------------------------------------------------------------------------------
  // Walls: u across the extruded profile (0 = road-side bottom -> top -> 1 = outer bottom), v along.
  // `bands` gives the u-range of named profile parts so the paint lines up with the geometry.
  // ------------------------------------------------------------------------------------------------------
  wall(style, wall, bands = {}) {
    const key = `wall:${style}:${wall.color}:${wall.color2}:${JSON.stringify(bands)}`;
    return this._get(key, () => {
      const rng = this._rng(key);
      const W = 256;
      const H = 512;
      const { c, g } = makeCanvas(W, H);
      const A = wall.color;
      const B = wall.color2 || wall.color;
      let transparent = false;
      if (style === 'barrier') {
        g.fillStyle = A;
        g.fillRect(0, 0, W, H);
        // two blocks per tile, the second slightly different tint
        g.fillStyle = rgba(shade(A, -0.06), 1);
        g.fillRect(0, H / 2, W, H / 2);
        const [s0, s1] = bands.stripe || [0.28, 0.4];
        const [t0, t1] = bands.stripe2 || [0.6, 0.72];
        g.fillStyle = B;
        g.fillRect(s0 * W, 0, (s1 - s0) * W, H);
        g.fillRect(t0 * W, 0, (t1 - t0) * W, H);
        // chevron accent on alternate blocks
        g.fillStyle = mixHex(B, '#ffffff', 0.25);
        g.fillRect(s0 * W, H / 2, (s1 - s0) * W, H / 2);
        // block seams
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(0, 0, W, 4);
        g.fillRect(0, H / 2 - 2, W, 4);
        // grime towards the bottom (u near 0 and 1)
        const gr = g.createLinearGradient(0, 0, W, 0);
        gr.addColorStop(0, 'rgba(60,50,40,0.35)');
        gr.addColorStop(0.12, 'rgba(60,50,40,0)');
        gr.addColorStop(0.88, 'rgba(60,50,40,0)');
        gr.addColorStop(1, 'rgba(60,50,40,0.35)');
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
        specks(g, W, H, rng, 500, [shade(A, -0.3)], 0.5, 1.5, 0.3);
        addNoise(g, W, H, 6, rng);
      } else if (style === 'stone') {
        g.fillStyle = shade(A, -0.5);
        g.fillRect(0, 0, W, H);
        const rows = 7;
        const rh = H / rows;
        for (let r = 0; r < rows; r++) {
          let x = -rng() * 40;
          // stones laid along v: rows along v, stones across u -> transpose: draw columns
          while (x < W) {
            const w = 28 + rng() * 40;
            const col = shade(mixHex(A, shade(A, 0.15), rng()), (rng() - 0.5) * 0.25);
            roundRect(g, x + 2, r * rh + 2, w - 4, rh - 4, 8);
            g.fillStyle = col;
            g.fill();
            const gg = g.createLinearGradient(x, 0, x + w, 0);
            gg.addColorStop(0, 'rgba(255,255,255,0.15)');
            gg.addColorStop(1, 'rgba(0,0,0,0.2)');
            g.fillStyle = gg;
            g.fill();
            x += w;
          }
        }
        // cap band
        const [c0, c1] = bands.cap || [0.42, 0.58];
        g.fillStyle = shade(A, 0.12);
        g.fillRect(c0 * W, 0, (c1 - c0) * W, H);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 0; k < 8; k++) g.fillRect(c0 * W, (k / 8) * H, (c1 - c0) * W, 3);
        // accent glow line (lava themes: color2 as a glowing seam is done by the emissive band)
        addNoise(g, W, H, 9, rng);
      } else if (style === 'hedge') {
        g.fillStyle = shade(A, -0.2);
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 2600; i++) {
          const x = rng() * W;
          const y = rng() * H;
          const col = shade(mixHex(A, B, rng()), (rng() - 0.4) * 0.45);
          g.fillStyle = col;
          g.beginPath();
          g.ellipse(x, y, 3 + rng() * 5, 2 + rng() * 3, rng() * 3, 0, Math.PI * 2);
          g.fill();
        }
        specks(g, W, H, rng, 300, [shade(A, 0.35)], 0.8, 2, 0.7);
        const gr = g.createLinearGradient(0, 0, W, 0);
        gr.addColorStop(0, 'rgba(20,40,10,0.45)');
        gr.addColorStop(0.15, 'rgba(0,0,0,0)');
        gr.addColorStop(0.85, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(20,40,10,0.45)');
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
      } else if (style === 'snowbank') {
        g.fillStyle = A;
        g.fillRect(0, 0, W, H);
        blotches(g, W, H, rng, 30, B, 0.55, 20, 70);
        blotches(g, W, H, rng, 20, '#ffffff', 0.8, 15, 50);
        specks(g, W, H, rng, 900, ['#ffffff', '#e6f3ff'], 0.5, 1.4, 1);
        const gr = g.createLinearGradient(0, 0, W, 0);
        gr.addColorStop(0, 'rgba(120,150,190,0.35)');
        gr.addColorStop(0.2, 'rgba(0,0,0,0)');
        gr.addColorStop(0.8, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(120,150,190,0.35)');
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
        addNoise(g, W, H, 3, rng);
      } else if (style === 'tires') {
        // Each tire bulge of the profile is a band in u. Stacks alternate painted colours along v.
        const tires = bands.tires || [];
        g.fillStyle = '#26262b';
        g.fillRect(0, 0, W, H);
        const stacks = 4;
        const sh = H / stacks;
        for (let s = 0; s < stacks; s++) {
          const paint = s % 2 ? B : A;
          for (const [u0, u1] of tires) {
            const x0 = u0 * W;
            const x1 = u1 * W;
            const gr = g.createLinearGradient(x0, 0, x1, 0);
            gr.addColorStop(0, '#15151a');
            gr.addColorStop(0.5, '#3a3a42');
            gr.addColorStop(1, '#15151a');
            g.fillStyle = gr;
            g.fillRect(x0, s * sh, x1 - x0, sh);
            // painted stripe in the middle of the tire
            g.fillStyle = paint;
            g.fillRect(x0 + (x1 - x0) * 0.38, s * sh, (x1 - x0) * 0.24, sh);
            // tread lines
            g.fillStyle = 'rgba(0,0,0,0.35)';
            for (let k = 0; k < 14; k++) g.fillRect(x0, s * sh + (k / 14) * sh, (x1 - x0) * 0.3, 2);
          }
          g.fillStyle = 'rgba(0,0,0,0.6)';
          g.fillRect(0, s * sh, W, 5);
        }
        addNoise(g, W, H, 6, rng);
      } else if (style === 'fence') {
        transparent = true;
        g.clearRect(0, 0, W, H);
        const [p0, p1] = bands.panel || [0.15, 0.95];
        // chain-link diamonds on the panel u-range
        g.strokeStyle = rgba(shade(A, -0.1), 0.95);
        g.lineWidth = 2;
        const x0 = p0 * W;
        const x1 = p1 * W;
        const step = 18;
        g.save();
        g.beginPath();
        g.rect(x0, 0, x1 - x0, H);
        g.clip();
        for (let k = -H; k < H + W; k += step) {
          g.beginPath();
          g.moveTo(x0 - 20, k);
          g.lineTo(x1 + 20, k + (x1 - x0) + 40);
          g.stroke();
          g.beginPath();
          g.moveTo(x0 - 20, k + (x1 - x0) + 40);
          g.lineTo(x1 + 20, k);
          g.stroke();
        }
        g.restore();
        // rails (top, middle) + posts (each tile = 1 post span)
        g.fillStyle = B;
        g.fillRect(x1 - 10, 0, 12, H);
        g.fillRect((x0 + x1) / 2 - 4, 0, 8, H);
        g.fillRect(x0, 0, 8, H);
        g.fillRect(0, 0, W, 16); // post
        // base (u < p0)
        g.fillStyle = shade(B, 0.25);
        g.fillRect(0, 0, x0, H);
      } else if (style === 'glow') {
        g.fillStyle = A;
        g.fillRect(0, 0, W, H);
        blotches(g, W, H, rng, 10, shade(A, 0.15), 0.5, 20, 60);
        g.fillStyle = rgba(B, 0.85);
        g.fillRect(0, 0, W, 6);
        addNoise(g, W, H, 5, rng);
      }
      const map = this.tex(c);
      return { map, transparent };
    });
  }

  // ------------------------------------------------------------------------------------------------------
  // Features
  // ------------------------------------------------------------------------------------------------------
  /** Dash panel: glowing chevrons pointing forward (canvas UP). One tile = 1 chevron. */
  dashPanel() {
    return this._get('dash', () => {
      const W = 128;
      const H = 128;
      const { c, g } = makeCanvas(W, H);
      const bg = g.createLinearGradient(0, 0, W, 0);
      bg.addColorStop(0, '#7a2a00');
      bg.addColorStop(0.5, '#b34400');
      bg.addColorStop(1, '#7a2a00');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      // chevron: apex at the top
      const chev = (fill, inset) => {
        g.beginPath();
        g.moveTo(W * 0.5, H * 0.06 + inset);
        g.lineTo(W * 0.94 - inset, H * 0.5);
        g.lineTo(W * 0.94 - inset, H * 0.78);
        g.lineTo(W * 0.5, H * 0.34 + inset);
        g.lineTo(W * 0.06 + inset, H * 0.78);
        g.lineTo(W * 0.06 + inset, H * 0.5);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
      };
      g.save();
      g.shadowColor = '#ffd23f';
      g.shadowBlur = 18;
      const cg = g.createLinearGradient(0, 0, 0, H);
      cg.addColorStop(0, '#fff7b0');
      cg.addColorStop(0.5, '#ffd23f');
      cg.addColorStop(1, '#ff8a00');
      chev(cg, 0);
      g.restore();
      chev('rgba(255,255,255,0.35)', 8);
      // side rails
      g.fillStyle = '#ffe36b';
      g.fillRect(0, 0, 6, H);
      g.fillRect(W - 6, 0, 6, H);
      return this.tex(c);
    });
  }

  /** Ramp top: blue panel with white arrows + yellow side stripes. */
  rampTop(accent = '#1fb6ff') {
    return this._get(`ramp:${accent}`, () => {
      const W = 256;
      const H = 256;
      const { c, g } = makeCanvas(W, H);
      const bg = g.createLinearGradient(0, H, 0, 0);
      bg.addColorStop(0, shade(accent, -0.25));
      bg.addColorStop(1, shade(accent, 0.15));
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      // hazard stripes at the sides
      for (const x0 of [0, W - 28]) {
        g.save();
        g.beginPath();
        g.rect(x0, 0, 28, H);
        g.clip();
        g.fillStyle = '#ffd23f';
        g.fillRect(x0, 0, 28, H);
        g.fillStyle = '#1a1a22';
        for (let k = -2; k < 12; k++) {
          g.beginPath();
          g.moveTo(x0, k * 32);
          g.lineTo(x0 + 28, k * 32 - 20);
          g.lineTo(x0 + 28, k * 32 - 4);
          g.lineTo(x0, k * 32 + 16);
          g.fill();
        }
        g.restore();
      }
      // arrows
      g.save();
      g.shadowColor = '#ffffff';
      g.shadowBlur = 10;
      g.fillStyle = '#ffffff';
      for (let k = 0; k < 2; k++) {
        const y = k * (H / 2) + H * 0.1;
        g.beginPath();
        g.moveTo(W * 0.5, y);
        g.lineTo(W * 0.78, y + H * 0.2);
        g.lineTo(W * 0.64, y + H * 0.2);
        g.lineTo(W * 0.64, y + H * 0.36);
        g.lineTo(W * 0.36, y + H * 0.36);
        g.lineTo(W * 0.36, y + H * 0.2);
        g.lineTo(W * 0.22, y + H * 0.2);
        g.closePath();
        g.fill();
      }
      g.restore();
      return this.tex(c);
    });
  }

  /** Mud / sand / slush decal with alpha. kind: mud|sand|snow|lava? */
  slowPatch(kind = 'mud') {
    return this._get(`slow:${kind}`, () => {
      const S = 256;
      const rng = this._rng(`slow:${kind}`);
      const { c, g } = makeCanvas(S, S);
      const cols = {
        mud: ['#5a3d22', '#6e4b2a', '#3e2914'],
        sand: ['#e2bd7a', '#d4a862', '#f0d49c'],
        snow: ['#eef4fb', '#d3e2f2', '#ffffff'],
        oil: ['#1d1a26', '#2d2840', '#0d0b14'],
      }[kind] || ['#5a3d22', '#6e4b2a', '#3e2914'];
      // blobby outline from many circles, alpha soft at edges
      for (let i = 0; i < 40; i++) {
        const a = rng() * Math.PI * 2;
        const rr = rng() * S * 0.26;
        const x = S / 2 + Math.cos(a) * rr;
        const y = S / 2 + Math.sin(a) * rr * 1.1;
        const r = S * (0.1 + rng() * 0.14);
        const gr = g.createRadialGradient(x, y, r * 0.5, x, y, r);
        gr.addColorStop(0, rgba(cols[0], 0.95));
        gr.addColorStop(1, rgba(cols[0], 0));
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-atop';
      blotches(g, S, S, rng, 30, cols[1], 0.6, 8, 30);
      blotches(g, S, S, rng, 20, cols[2], 0.6, 6, 22);
      if (kind === 'mud' || kind === 'oil') {
        // glossy puddles
        for (let i = 0; i < 12; i++) {
          const x = S * 0.25 + rng() * S * 0.5;
          const y = S * 0.25 + rng() * S * 0.5;
          g.fillStyle = kind === 'oil' ? 'rgba(160,120,255,0.25)' : 'rgba(255,255,255,0.18)';
          g.beginPath();
          g.ellipse(x, y, 6 + rng() * 12, 3 + rng() * 6, rng() * 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (kind === 'sand') {
        for (let k = 0; k < 14; k++) {
          g.strokeStyle = 'rgba(160,110,50,0.35)';
          g.lineWidth = 2;
          const y0 = (k / 14) * S;
          g.beginPath();
          for (let x = 0; x <= S; x += 8) {
            const y = y0 + Math.sin(x * 0.05 + k) * 4;
            if (x === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
      }
      g.globalCompositeOperation = 'source-over';
      return canvasTexture(c, { repeat: false, anisotropy: this.aniso });
    });
  }

  /** "SUPER SERIKA KART" banner for the start gantry. */
  banner(accent = '#1fb6ff') {
    return this._get(`banner:${accent}`, () => {
      const W = 2048;
      const H = 256;
      const { c, g } = makeCanvas(W, H);
      const tex = canvasTexture(c, { repeat: false, anisotropy: this.aniso });
      paintWithFonts(tex, () => {
        g.clearRect(0, 0, W, H);
        const bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#2fc4ff');
        bg.addColorStop(0.55, '#1a8cf0');
        bg.addColorStop(1, '#0b5cd6');
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
        // slanted BA-style stripes
        g.fillStyle = 'rgba(255,255,255,0.10)';
        for (let x = -H; x < W; x += 90) {
          g.beginPath();
          g.moveTo(x, H);
          g.lineTo(x + H * 0.5, 0);
          g.lineTo(x + H * 0.5 + 34, 0);
          g.lineTo(x + 34, H);
          g.fill();
        }
        // white borders
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, W, 14);
        g.fillRect(0, H - 14, W, 14);
        g.fillStyle = '#ff3355';
        g.fillRect(0, 14, W, 6);
        g.fillRect(0, H - 20, W, 6);
        // crosshair halos either side (Serika!)
        const halo = (cx, cy, r) => {
          g.save();
          g.strokeStyle = '#ff3355';
          g.shadowColor = '#ff7a8f';
          g.shadowBlur = 16;
          g.lineWidth = 10;
          g.beginPath();
          g.arc(cx, cy, r, 0, Math.PI * 2);
          g.stroke();
          g.lineWidth = 7;
          g.beginPath();
          g.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
          g.stroke();
          for (let k = 0; k < 4; k++) {
            const a = (k * Math.PI) / 2;
            g.beginPath();
            g.moveTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62);
            g.lineTo(cx + Math.cos(a) * r * 1.28, cy + Math.sin(a) * r * 1.28);
            g.stroke();
          }
          g.restore();
          // cat ears on the halo
          g.fillStyle = '#1c2235';
          for (const s of [-1, 1]) {
            g.beginPath();
            g.moveTo(cx + s * r * 0.35, cy - r * 0.85);
            g.lineTo(cx + s * r * 0.95, cy - r * 1.35);
            g.lineTo(cx + s * r * 0.9, cy - r * 0.55);
            g.fill();
          }
        };
        halo(150, H / 2 + 8, 62);
        halo(W - 150, H / 2 + 8, 62);
        chunkyText(g, 'SUPER SERIKA KART', W / 2, H / 2 + 6, 150, {
          fill: '#ffffff',
          stroke: '#0b2a66',
          strokeW: 0.1,
          italic: true,
          maxWidth: W - 420,
        });
      });
      return tex;
    });
  }
}
