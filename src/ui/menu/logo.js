// "SUPER SERIKA KART" logo (owner: frontend agent).
// Original artwork: cat ears peeking over the lettering and Serika's red crosshair halo floating above.
// Performance: the lettering is ONE static SVG (no animation inside, so it is rasterised once); the halo and
// sparkles are small separate layers animated with compositor-friendly transforms.

const VB_W = 1000;
const VB_H = 560;

function haloMarkup(p) {
  const rx = 132;
  const ry = 40;
  let arrows = '';
  for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    const ox = Math.cos(a) * 26;
    const oy = Math.sin(a) * 9;
    const nx = -Math.sin(a) * 9;
    const ny = Math.cos(a) * 4;
    arrows += `<path d="M${(x + ox).toFixed(1)} ${(y + oy).toFixed(1)}L${(x + nx).toFixed(1)} ${(y + ny).toFixed(1)}L${(x - nx).toFixed(1)} ${(y - ny).toFixed(1)}Z" fill="#ff3355" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`;
  }
  return `
    <defs><radialGradient id="${p}-glow" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#ff7a8f" stop-opacity=".75"/>
      <stop offset=".6" stop-color="#ff3355" stop-opacity=".18"/>
      <stop offset="1" stop-color="#ff3355" stop-opacity="0"/>
    </radialGradient></defs>
    <g transform="translate(500 64)">
      <ellipse rx="190" ry="66" fill="url(#${p}-glow)"/>
      <ellipse rx="${rx}" ry="${ry}" fill="none" stroke="#fff" stroke-width="22"/>
      <ellipse rx="${rx}" ry="${ry}" fill="none" stroke="#ff3355" stroke-width="12"/>
      <ellipse class="mn-logo-halo-dash" rx="88" ry="26" fill="none" stroke="#ff3355" stroke-width="6" stroke-dasharray="26 14"/>
      <path d="M-178 0H-142M142 0H178M0 -58V-46M0 46V58" stroke="#fff" stroke-width="16" stroke-linecap="round"/>
      <path d="M-178 0H-142M142 0H178M0 -58V-46M0 46V58" stroke="#ff3355" stroke-width="8" stroke-linecap="round"/>
      ${arrows}
      <circle r="7" fill="#ff3355" stroke="#fff" stroke-width="3"/>
    </g>`;
}

function lettering(p, withHalo) {
  const word = (txt, x, y, size, fill, outer, inner, extra = '') => `
    <text x="${x}" y="${y + 12}" font-size="${size}" text-anchor="middle" fill="#06214f" fill-opacity=".32" stroke="#06214f" stroke-opacity=".32" stroke-width="${Math.round(size * 0.24)}" stroke-linejoin="round" ${extra}>${txt}</text>
    <text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="${outer}" stroke="${outer}" stroke-width="${Math.round(size * 0.24)}" stroke-linejoin="round" ${extra}>${txt}</text>
    <text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="${inner}" stroke="${inner}" stroke-width="${Math.round(size * 0.12)}" stroke-linejoin="round" ${extra}>${txt}</text>
    <text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="${fill}" ${extra}>${txt}</text>`;
  return `
  <defs>
    <linearGradient id="${p}-blue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b8f4ff"/>
      <stop offset=".38" stop-color="#4cc9ff"/>
      <stop offset=".62" stop-color="#1a8dff"/>
      <stop offset="1" stop-color="#0b4fd0"/>
    </linearGradient>
    <linearGradient id="${p}-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffbd0"/>
      <stop offset=".42" stop-color="#ffd23f"/>
      <stop offset=".75" stop-color="#ffa21f"/>
      <stop offset="1" stop-color="#ff6a1f"/>
    </linearGradient>
    <linearGradient id="${p}-red" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff6b87"/>
      <stop offset="1" stop-color="#e8304f"/>
    </linearGradient>
    <pattern id="${p}-check" width="28" height="28" patternUnits="userSpaceOnUse">
      <rect width="28" height="28" fill="#16213a"/><rect width="14" height="14" fill="#fff"/><rect x="14" y="14" width="14" height="14" fill="#fff"/>
    </pattern>
  </defs>
  ${withHalo ? haloMarkup(p) : ''}
  <!-- cat ears (behind the lettering) -->
  <g transform="translate(0 10)" opacity=".3" fill="#06214f"><path d="M205 262L250 96L372 214Z"/><path d="M795 262L750 96L628 214Z"/></g>
  <path d="M205 262L250 96L372 214Z" fill="#1c2235" stroke="#fff" stroke-width="14" stroke-linejoin="round"/>
  <path d="M238 222L259 140L324 206Z" fill="#ff9fb8"/>
  <path d="M795 262L750 96L628 214Z" fill="#1c2235" stroke="#fff" stroke-width="14" stroke-linejoin="round"/>
  <path d="M762 222L741 140L676 206Z" fill="#ff9fb8"/>

  <!-- SUPER ribbon between the ears -->
  <g transform="translate(500 168) rotate(-4)">
    <path d="M-128 -24H138L118 44H-148Z" fill="#06214f" opacity=".3"/>
    <path d="M-128 -34H138L118 34H-148Z" fill="url(#${p}-red)" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>
    <path d="M-160 -20H-140L-152 20H-172Z M150 -20H170L158 20H138Z" fill="#fff"/>
    <text x="-4" y="21" font-size="62" text-anchor="middle" fill="#fff" letter-spacing="6">SUPER</text>
  </g>

  <!-- SERIKA -->
  <g transform="rotate(-3 500 330)">
    ${word('SERIKA', 500, 372, 206, `url(#${p}-blue)`, '#0b2451', '#ffffff', 'letter-spacing="6"')}
    <path d="M232 262Q500 236 770 262" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".55" fill="none"/>
  </g>

  <!-- KART with checkered tag + speed lines -->
  <g transform="rotate(-3 560 470)">
    <path d="M176 434H338L318 500H156Z" fill="#06214f" opacity=".3"/>
    <path d="M176 424H338L318 490H156Z" fill="url(#${p}-check)" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>
    <path d="M96 440H150M76 462H140M110 484H146" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
    ${word('KART', 590, 512, 160, `url(#${p}-gold)`, '#7a1026', '#ffffff', 'letter-spacing="10"')}
  </g>`;
}

const SPARK = `<svg viewBox="-20 -20 40 40"><path d="M0-18l4.5 13.5L18 0 4.5 4.5 0 18-4.5 4.5-18 0-4.5-4.5z" fill="currentColor"/></svg>`;

/**
 * Logo markup. `animated` = separate composited halo + sparkle layers (title screen); otherwise one static SVG.
 * @param {{ id?: string, cls?: string, animated?: boolean }} [opts]
 */
export function logoSVG({ id = 'mnlogo', cls = 'mn-logo', animated = true } = {}) {
  if (!animated) {
    return `<svg class="${cls}" viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Super Serika Kart">${lettering(id, true)}</svg>`;
  }
  // halo layer: viewBox window around the halo (x 290..710, y -12..140)
  return `<div class="mn-logo-wrap ${cls}-wrap" role="img" aria-label="Super Serika Kart">
    <svg class="mn-logo-halo" viewBox="290 -12 420 152" style="left:29%;top:${((-12 / VB_H) * 100).toFixed(2)}%;width:42%;height:${((152 / VB_H) * 100).toFixed(2)}%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${haloMarkup(id + 'h')}</svg>
    <svg class="${cls}" viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${lettering(id, false)}</svg>
    <i class="mn-logo-spark" style="left:86.8%;top:21%;--s:1.2;--d:0s">${SPARK}</i>
    <i class="mn-logo-spark" style="left:11.8%;top:59%;--s:0.9;--d:.8s">${SPARK}</i>
    <i class="mn-logo-spark mn-logo-spark-gold" style="left:88%;top:73%;--s:0.8;--d:1.5s">${SPARK}</i>
  </div>`;
}
