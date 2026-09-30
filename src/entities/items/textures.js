// Procedural canvas textures for items (owner: items agent). All textures are created lazily once and shared.
import * as THREE from 'three';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { srgb = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const DISPLAY_FONT = '"Lilita One", "Arial Black", Impact, sans-serif';

/** Big glossy "?" (or upside-down "¿" for the decoy) with a thick outline. */
function drawQuestion(c, inverted) {
  const g = c.getContext('2d');
  const S = c.width;
  g.clearRect(0, 0, S, S);
  g.save();
  g.translate(S / 2, S / 2);
  if (inverted) g.rotate(Math.PI);
  g.font = `${Math.round(S * 0.86)}px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const y = S * 0.04;
  g.lineJoin = 'round';
  // soft outer glow
  g.shadowColor = inverted ? 'rgba(255,60,90,0.9)' : 'rgba(120,200,255,0.9)';
  g.shadowBlur = S * 0.08;
  g.lineWidth = S * 0.13;
  g.strokeStyle = inverted ? '#5a0f1f' : '#1b2a55';
  g.strokeText('?', 0, y);
  g.shadowBlur = 0;
  // fill gradient
  const grd = g.createLinearGradient(0, -S * 0.4, 0, S * 0.4);
  if (inverted) {
    grd.addColorStop(0, '#ffe3ea');
    grd.addColorStop(1, '#ff8fa8');
  } else {
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.55, '#f2f7ff');
    grd.addColorStop(1, '#b9d6ff');
  }
  g.fillStyle = grd;
  g.fillText('?', 0, y);
  // highlight
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.ellipse(-S * 0.12, -S * 0.22, S * 0.12, S * 0.05, -0.5, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

const cache = {};

export function getQuestionTexture(inverted = false) {
  const key = inverted ? 'q_inv' : 'q';
  if (cache[key]) return cache[key];
  const c = canvas(256);
  drawQuestion(c, inverted);
  const tex = finish(c);
  cache[key] = tex;
  // redraw once the display font is available
  try {
    document.fonts?.load?.(`100px "Lilita One"`).then(() => {
      drawQuestion(c, inverted);
      tex.needsUpdate = true;
    }).catch(() => {});
  } catch {
    /* ignore */
  }
  return tex;
}

/**
 * Coin texture: the cylinder caps map to the inscribed circle; the corners carry the rim colour (the side UVs are
 * remapped there by the geometry builder).
 */
export function getCoinTexture() {
  if (cache.coin) return cache.coin;
  const c = canvas(256);
  const g = c.getContext('2d');
  const S = 256;
  const C = S / 2;
  g.fillStyle = '#e0a21c';
  g.fillRect(0, 0, S, S);
  // outer rim
  let grd = g.createRadialGradient(C - 30, C - 40, 10, C, C, C);
  grd.addColorStop(0, '#fff2a6');
  grd.addColorStop(0.6, '#ffd23f');
  grd.addColorStop(1, '#d99a12');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(C, C, C * 0.99, 0, Math.PI * 2);
  g.fill();
  // milled edge ticks
  g.strokeStyle = 'rgba(160,100,10,0.55)';
  g.lineWidth = 3;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.beginPath();
    g.moveTo(C + Math.cos(a) * C * 0.9, C + Math.sin(a) * C * 0.9);
    g.lineTo(C + Math.cos(a) * C * 0.98, C + Math.sin(a) * C * 0.98);
    g.stroke();
  }
  // inner field
  grd = g.createRadialGradient(C - 20, C - 30, 5, C, C, C * 0.8);
  grd.addColorStop(0, '#ffe98a');
  grd.addColorStop(1, '#f0b62a');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(C, C, C * 0.8, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#c98a10';
  g.stroke();
  // cent mark, embossed
  g.font = `900 ${Math.round(S * 0.62)}px Arial Black, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff6c4';
  g.fillText('¢', C - 3, C + 1);
  g.fillStyle = '#b87908';
  g.fillText('¢', C + 3, C + 7);
  g.fillStyle = '#e8a91c';
  g.fillText('¢', C, C + 4);
  // shine
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.beginPath();
  g.ellipse(C - 44, C - 52, 30, 12, -0.7, 0, Math.PI * 2);
  g.fill();
  cache.coin = finish(c);
  return cache.coin;
}

/** Soft round blob shadow (alpha only). */
export function getShadowTexture() {
  if (cache.shadow) return cache.shadow;
  const c = canvas(128);
  const g = c.getContext('2d');
  // used as an alphaMap (green channel = opacity)
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  grd.addColorStop(0, 'rgb(200,200,200)');
  grd.addColorStop(0.5, 'rgb(120,120,120)');
  grd.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  cache.shadow = finish(c, { srgb: false });
  return cache.shadow;
}

/** Soft glow sprite (white, alpha). */
export function getGlowTexture() {
  if (cache.glow) return cache.glow;
  const c = canvas(128);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  cache.glow = finish(c, { srgb: false });
  return cache.glow;
}

/** Blue Archive style crosshair target reticle (seeker warning decal on the ground). */
export function getReticleTexture() {
  if (cache.reticle) return cache.reticle;
  const S = 256;
  const C = S / 2;
  const c = canvas(S);
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineCap = 'round';
  // outer ring with gaps
  g.lineWidth = 10;
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2 + 0.22;
    g.beginPath();
    g.arc(C, C, C * 0.86, a0, a0 + Math.PI / 2 - 0.44);
    g.stroke();
  }
  // inner ring
  g.lineWidth = 6;
  g.beginPath();
  g.arc(C, C, C * 0.5, 0, Math.PI * 2);
  g.stroke();
  // cross ticks
  g.lineWidth = 9;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    g.beginPath();
    g.moveTo(C + Math.cos(a) * C * 0.62, C + Math.sin(a) * C * 0.62);
    g.lineTo(C + Math.cos(a) * C * 0.98, C + Math.sin(a) * C * 0.98);
    g.stroke();
  }
  // arrow heads pointing inward (diagonals)
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const r0 = C * 0.66;
    g.beginPath();
    g.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
    g.lineTo(C + Math.cos(a + 0.12) * (r0 + 22), C + Math.sin(a + 0.12) * (r0 + 22));
    g.lineTo(C + Math.cos(a - 0.12) * (r0 + 22), C + Math.sin(a - 0.12) * (r0 + 22));
    g.closePath();
    g.fill();
  }
  // centre dot
  g.beginPath();
  g.arc(C, C, 9, 0, Math.PI * 2);
  g.fill();
  cache.reticle = finish(c, { srgb: false });
  return cache.reticle;
}

/** Vertical rainbow stripes (invincibility aura). */
export function getAuraTexture() {
  if (cache.aura) return cache.aura;
  const c = canvas(64, 256);
  const g = c.getContext('2d');
  const cols = ['#ff4d6d', '#ffb347', '#ffe66d', '#6dff8f', '#4dd2ff', '#8f7bff', '#ff6df0', '#ff4d6d'];
  const grd = g.createLinearGradient(0, 0, 0, 256);
  cols.forEach((col, i) => grd.addColorStop(i / (cols.length - 1), col));
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  // vertical light streaks
  for (let i = 0; i < 10; i++) {
    const x = (i * 37) % 64;
    const lg = g.createLinearGradient(x - 4, 0, x + 4, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(x - 4, 0, 8, 256);
  }
  const t = finish(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  cache.aura = t;
  return t;
}

export function disposeItemTextures() {
  for (const k of Object.keys(cache)) {
    cache[k].dispose();
    delete cache[k];
  }
}
