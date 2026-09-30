// Hand-authored SVG icons for every item in src/data/items.js, plus the Credit coin and Pyroxene crystal.
// Used by the in-race HUD (roulette, item slot, alerts) and by the menus (how-to-play, cup icons...).
//
// API CONTRACT:
//   itemIconSVG(itemId) -> string    // standalone <svg ...>...</svg> markup, viewBox 0 0 100 100, no external refs
//   itemIconURL(itemId) -> string    // data: URL of the same SVG (for <img src>), cached
//   coinIconSVG() / crystalIconSVG() // Credits coin + Pyroxene crystal (cup icons, HUD coin counter)
// Additions:
//   coinIconURL() / crystalIconURL() // cached data: URLs
//   ITEM_ICON_IDS                    // every id that has a hand-drawn icon
//
// Style: bold navy outlines (#1b2340), glossy gradients, white highlights and sparkles. Every call to an
// *SVG() function returns markup with unique gradient ids, so several copies can be inlined in one document.

import { ITEMS } from '../data/items.js';

const OL = '#1b2340'; // outline ink
let uid = 0;

// ---------------------------------------------------------------------------------------------------------
// tiny SVG helpers
// ---------------------------------------------------------------------------------------------------------

const stops = (list) =>
  list.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('');

/** Linear gradient in objectBoundingBox units (0..1). */
const lin = (id, x1, y1, x2, y2, list) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`;

/** Radial gradient in objectBoundingBox units. */
const rad = (id, cx, cy, r, list, fx = cx, fy = cy) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" fx="${fx}" fy="${fy}">${stops(list)}</radialGradient>`;

/** Four-pointed sparkle star. */
function sparkle(cx, cy, r, fill = '#ffffff', stroke = OL, sw = 1.6) {
  const k = r * 0.2;
  const d =
    `M${cx} ${cy - r}Q${cx + k} ${cy - k} ${cx + r} ${cy}Q${cx + k} ${cy + k} ${cx} ${cy + r}` +
    `Q${cx - k} ${cy + k} ${cx - r} ${cy}Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`;
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
}

const wrap = (defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${defs}</defs>${body}</svg>`;

/** Place a drawing authored around (50,50) at (cx,cy) with scale s and rotation rot (deg). */
const place = (cx, cy, s, rot, inner) =>
  `<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${s}) translate(-50 -50)">${inner}</g>`;

// ---------------------------------------------------------------------------------------------------------
// Energy drink can (drink / drink3)
// ---------------------------------------------------------------------------------------------------------

function canDefs(p) {
  return (
    lin(`${p}cb`, 0, 0, 1, 0, [
      [0, '#c95800'],
      [0.16, '#ffa51a'],
      [0.4, '#ffe57a'],
      [0.58, '#ffcf33'],
      [0.84, '#f08a00'],
      [1, '#b84f00'],
    ]) +
    lin(`${p}cs`, 0, 0, 1, 0, [
      [0, '#7d889b'],
      [0.38, '#ffffff'],
      [0.62, '#dfe6ef'],
      [1, '#6f7a8e'],
    ]) +
    lin(`${p}cl`, 0, 0, 0, 1, [
      [0, '#ffffff'],
      [1, '#b9c4d4'],
    ]) +
    lin(`${p}cz`, 0, 0, 0, 1, [
      [0, '#8ff3ff'],
      [0.5, '#1fb6ff'],
      [1, '#1250d6'],
    ])
  );
}

/** A can authored around (50,50), 36 wide and ~66 tall. */
function canBody(p) {
  return `
  <path d="M32 24 V76 A18 5.5 0 0 0 68 76 V24 Z" fill="url(#${p}cb)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M32 24 V31 A18 5.5 0 0 0 68 31 V24 Z" fill="url(#${p}cs)" stroke="${OL}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M32 71 A18 5.5 0 0 0 68 71 V76 A18 5.5 0 0 1 32 76 Z" fill="url(#${p}cs)" stroke="${OL}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M34.5 38 A15.5 4.5 0 0 0 65.5 38 V63 A15.5 4.5 0 0 1 34.5 63 Z" fill="#1d2a4d" opacity=".9"/>
  <path d="M34.5 38 A15.5 4.5 0 0 0 65.5 38" fill="none" stroke="#27d3f0" stroke-width="1.6"/>
  <path d="M34.5 63 A15.5 4.5 0 0 0 65.5 63" fill="none" stroke="#27d3f0" stroke-width="1.6"/>
  <path d="M54 38.5 L41 55 L49 55 L45 70 L60 49 L52 49 L57 38.5 Z" fill="#fff" stroke="#fff" stroke-width="4.5" stroke-linejoin="round"/>
  <path d="M54 38.5 L41 55 L49 55 L45 70 L60 49 L52 49 L57 38.5 Z" fill="url(#${p}cz)" stroke="${OL}" stroke-width="1.4" stroke-linejoin="round"/>
  <ellipse cx="50" cy="24" rx="18" ry="5.5" fill="url(#${p}cl)" stroke="${OL}" stroke-width="3"/>
  <ellipse cx="50" cy="24.2" rx="13" ry="3.4" fill="none" stroke="#8d99ad" stroke-width="1.5"/>
  <rect x="46" y="21.2" width="10" height="4.2" rx="2.1" fill="#dfe6ef" stroke="#6b778b" stroke-width="1.2"/>
  <rect x="36.5" y="33" width="4.6" height="37" rx="2.3" fill="#fff" opacity=".55"/>
  <rect x="61" y="34" width="2" height="34" rx="1" fill="#fff" opacity=".3"/>`;
}

function drink(p) {
  return wrap(canDefs(p), place(50, 52, 1.14, -14, canBody(p)) + sparkle(82, 18, 8) + sparkle(18, 80, 5.5) + sparkle(88, 40, 3.5));
}

function drink3(p) {
  const ring = `<path d="M22 60 Q50 72 78 60" fill="none" stroke="#e8f4ff" stroke-width="3" opacity=".85"/>`;
  return wrap(
    canDefs(p),
    place(28, 57, 0.78, -17, canBody(p)) +
      place(72, 57, 0.78, 17, canBody(p)) +
      ring +
      place(50, 50, 0.9, 0, canBody(p)) +
      sparkle(86, 16, 6.5) +
      sparkle(14, 18, 4.5),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Sensei's gold card
// ---------------------------------------------------------------------------------------------------------

function card(p) {
  const defs =
    lin(`${p}g`, 0, 0, 1, 1, [
      [0, '#fff7c2'],
      [0.3, '#ffd23f'],
      [0.62, '#f0a200'],
      [1, '#ffe27a'],
    ]) +
    lin(`${p}c`, 0, 0, 1, 1, [
      [0, '#fffbe6'],
      [1, '#d4a647'],
    ]) +
    `<clipPath id="${p}k"><rect x="12" y="24" width="76" height="52" rx="7"/></clipPath>`;
  let dots = '';
  for (let g = 0; g < 4; g++) for (let i = 0; i < 4; i++) dots += `<circle cx="${22 + g * 15 + i * 3}" cy="61" r="1.35" fill="#7a5608" opacity=".75"/>`;
  const body = `
  <g transform="rotate(-14 50 50)">
    <rect x="15" y="28" width="76" height="52" rx="7" fill="${OL}" opacity=".25"/>
    <rect x="12" y="24" width="76" height="52" rx="7" fill="url(#${p}g)" stroke="${OL}" stroke-width="3.5"/>
    <g clip-path="url(#${p}k)">
      <path d="M44 20 L60 20 L38 80 L22 80 Z" fill="#fff" opacity=".32"/>
      <path d="M64 20 L69 20 L47 80 L42 80 Z" fill="#fff" opacity=".22"/>
    </g>
    <rect x="16.5" y="28.5" width="67" height="43" rx="4.5" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.5"/>
    <rect x="21" y="37" width="15" height="12" rx="2.5" fill="url(#${p}c)" stroke="#8a6412" stroke-width="1.5"/>
    <path d="M21 43 H36 M28.5 37 V49 M24.5 37 V40.5 M32.5 45.5 V49" stroke="#8a6412" stroke-width="1.1" fill="none"/>
    <g transform="translate(71 41)" stroke="#fff" stroke-linecap="round" fill="none">
      <circle r="8.5" stroke-width="2.6"/>
      <path d="M0 -13 V-10 M0 10 V13 M-13 0 H-10 M10 0 H13" stroke-width="2.4"/>
      <circle r="3.4" fill="#fff" stroke="none"/>
    </g>
    ${dots}
    <rect x="21" y="66" width="24" height="3.4" rx="1.7" fill="#7a5608" opacity=".5"/>
  </g>`;
  return wrap(defs, body + sparkle(84, 18, 8) + sparkle(15, 78, 6) + sparkle(91, 44, 3.6));
}

// ---------------------------------------------------------------------------------------------------------
// Ramen bowl (ramen / ramen3)
// ---------------------------------------------------------------------------------------------------------

function ramenDefs(p) {
  return (
    lin(`${p}b`, 0, 0, 0, 1, [
      [0, '#ff7f62'],
      [0.45, '#ec3a44'],
      [1, '#a3152b'],
    ]) +
    rad(`${p}s`, 0.5, 0.45, 0.6, [
      [0, '#ffe3ae'],
      [0.7, '#f3b35a'],
      [1, '#d98a30'],
    ]) +
    `<clipPath id="${p}bc"><ellipse cx="50" cy="50" rx="36" ry="10.5"/></clipPath>`
  );
}

/** Bowl authored around (50,55): rim at y=50, bottom at y=88. */
function ramenBowl(p, withSticks = true) {
  const noodles = [44, 48, 52, 56]
    .map((y, i) => `<path d="M${14 + (i % 2) * 4} ${y} q4 -3.5 8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0" fill="none" stroke="#fff0b8" stroke-width="2.4" stroke-linecap="round"/>`)
    .join('');
  const sticks = withSticks
    ? `<path d="M58 40 L93 13" stroke="${OL}" stroke-width="7.5" stroke-linecap="round"/>
       <path d="M58 40 L93 13" stroke="#e0a466" stroke-width="4" stroke-linecap="round"/>
       <path d="M62 43 L96 22" stroke="${OL}" stroke-width="7.5" stroke-linecap="round"/>
       <path d="M62 43 L96 22" stroke="#d4924f" stroke-width="4" stroke-linecap="round"/>`
    : '';
  return `
  <ellipse cx="50" cy="89" rx="15" ry="4.2" fill="#8f1224" stroke="${OL}" stroke-width="3"/>
  ${sticks}
  <ellipse cx="50" cy="50" rx="38" ry="12" fill="url(#${p}s)" stroke="${OL}" stroke-width="3.5"/>
  <g clip-path="url(#${p}bc)">${noodles}</g>
  <rect x="22" y="31" width="12" height="18" rx="1.5" transform="rotate(-14 28 40)" fill="#1f3d2a" stroke="${OL}" stroke-width="2.2"/>
  <path d="M25 34 L31 33" stroke="#3f6b4a" stroke-width="1.4" transform="rotate(-14 28 40)"/>
  <ellipse cx="46" cy="44.5" rx="9.5" ry="5.2" fill="#c8784a" stroke="#6d3519" stroke-width="1.6"/>
  <ellipse cx="46" cy="44.5" rx="6.2" ry="3.2" fill="#eab08a"/>
  <ellipse cx="63" cy="47" rx="9" ry="6" fill="#fffaf0" stroke="#b89656" stroke-width="1.6"/>
  <ellipse cx="63.5" cy="47.6" rx="5" ry="3.4" fill="#ffab1a" stroke="#e07b00" stroke-width="1"/>
  <ellipse cx="33" cy="51" rx="7.4" ry="4.8" fill="#fff" stroke="#d9a3b3" stroke-width="1.4"/>
  <path d="M30 51 a3 2 0 1 1 3 2 a1.7 1.2 0 1 1 -0.8 -1.6" fill="none" stroke="#ff4f93" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="51" cy="53" r="1.9" fill="#6fcf3f" stroke="#2f7a1f" stroke-width=".8"/>
  <circle cx="55.5" cy="54.5" r="1.7" fill="#6fcf3f" stroke="#2f7a1f" stroke-width=".8"/>
  <circle cx="42" cy="53.5" r="1.7" fill="#6fcf3f" stroke="#2f7a1f" stroke-width=".8"/>
  <circle cx="72" cy="52" r="1.6" fill="#6fcf3f" stroke="#2f7a1f" stroke-width=".8"/>
  <path d="M12 50 A38 12 0 0 0 88 50 C88 72 72 88 50 88 C28 88 12 72 12 50 Z" fill="url(#${p}b)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M14.5 58 A36 11 0 0 0 85.5 58" fill="none" stroke="#fff" stroke-width="2.4"/>
  <path d="M19 68 A31 9.5 0 0 0 81 68" fill="none" stroke="#fff" stroke-width="2.4"/>
  <path d="M18 62.2 l4 2.2 l-1 3 M30 64.9 l4 1.3 l-0.6 3 M44 65.9 l4 0.4 l0 3 M56 66 l4 -0.3 l0.6 3 M69 64.9 l4 -1.1 l1 2.8 M80 62 l3.6 -2" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M19 62 C21 73 28 81 37 84.5" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" opacity=".45"/>`;
}

function steam(x, y, s = 1) {
  const d = `M${x} ${y} c-6 -6 ${6 * s} -10 0 -${18 * s}`;
  return `<path d="${d}" fill="none" stroke="#7d94b8" stroke-width="6.5" stroke-linecap="round" opacity=".35"/><path d="${d}" fill="none" stroke="#fff" stroke-width="3.8" stroke-linecap="round"/>`;
}

function ramen(p) {
  return wrap(ramenDefs(p), steam(36, 30) + steam(50, 27, 1.1) + steam(64, 30) + ramenBowl(p, true));
}

function ramen3(p) {
  const small = (cx, cy, s) => `<g transform="translate(${cx - 50 * s} ${cy - 55 * s}) scale(${s})">${ramenBowl(p, false)}</g>`;
  return wrap(ramenDefs(p), steam(26, 26, 0.7) + steam(74, 26, 0.7) + small(28, 40, 0.52) + small(72, 40, 0.52) + small(50, 64, 0.62));
}

// ---------------------------------------------------------------------------------------------------------
// Ricochet round (bullet / bullet3)
// ---------------------------------------------------------------------------------------------------------

function bulletDefs(p) {
  return (
    lin(`${p}g`, 0, 0, 0, 1, [
      [0, '#d6ffbf'],
      [0.35, '#6fe36a'],
      [0.7, '#2fb553'],
      [1, '#146b33'],
    ]) +
    lin(`${p}br`, 0, 0, 0, 1, [
      [0, '#fff3c0'],
      [0.5, '#e2a83a'],
      [1, '#8f5f0e'],
    ])
  );
}

/** Round pointing right, authored around (50,50). */
function bulletBody(p, trail = true) {
  const tr = trail
    ? `<path d="M-6 41 H9 M-12 50 H7 M-6 59 H9" stroke="${OL}" stroke-width="6.5" stroke-linecap="round"/>
       <path d="M-6 41 H9 M-12 50 H7 M-6 59 H9" stroke="#8ff08a" stroke-width="3" stroke-linecap="round"/>`
    : '';
  return `${tr}
  <rect x="12" y="33.5" width="13" height="33" rx="3" fill="url(#${p}br)" stroke="${OL}" stroke-width="3.5"/>
  <path d="M24 36 H58 C74 36 88 43 92 50 C88 57 74 64 58 64 H24 Z" fill="url(#${p}g)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <rect x="50" y="36" width="6.5" height="28" fill="#ffd23f" stroke="${OL}" stroke-width="2"/>
  <path d="M28 41.5 H48 M60 41.5 C70 41.5 79 44 85 47.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" opacity=".75"/>
  <path d="M17.5 36 V64" stroke="#8a5d0c" stroke-width="1.6"/>`;
}

function bullet(p) {
  const burst = `<path d="M18 22 l3 7 l7 -3 l-3 7 l7 3 l-7 3 l3 7 l-7 -3 l-3 7 l-3 -7 l-7 3 l3 -7 l-7 -3 l7 -3 l-3 -7 l7 3 Z" fill="#fff6b0" stroke="${OL}" stroke-width="2" stroke-linejoin="round" transform="translate(-4 2) scale(.9)"/>`;
  const bounce = `<path d="M14 88 L24 70 L10 58" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 6" opacity=".95"/>`;
  return wrap(bulletDefs(p), burst + bounce + place(56, 46, 0.95, -38, bulletBody(p, true)) + sparkle(86, 80, 5));
}

function orbitRing(color) {
  return {
    back: `<path d="M12 56 A38 17 0 0 1 88 56" fill="none" stroke="${OL}" stroke-width="5" opacity=".35"/><path d="M12 56 A38 17 0 0 1 88 56" fill="none" stroke="${color}" stroke-width="2.6" stroke-dasharray="5 4" opacity=".9"/>`,
    front: `<path d="M12 56 A38 17 0 0 0 88 56" fill="none" stroke="${OL}" stroke-width="5" opacity=".35"/><path d="M12 56 A38 17 0 0 0 88 56" fill="none" stroke="${color}" stroke-width="2.6" stroke-dasharray="5 4" opacity=".9"/>`,
  };
}

function bullet3(p) {
  const r = orbitRing('#8ff08a');
  return wrap(
    bulletDefs(p),
    r.back + place(50, 34, 0.46, -30, bulletBody(p, false)) + r.front + place(22, 66, 0.52, -30, bulletBody(p, false)) + place(78, 68, 0.52, -30, bulletBody(p, false)),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Drone missile (missile / missile3)
// ---------------------------------------------------------------------------------------------------------

function missileDefs(p) {
  return (
    lin(`${p}r`, 0, 0, 0, 1, [
      [0, '#ffb0a8'],
      [0.35, '#ff4a44'],
      [0.75, '#d11f33'],
      [1, '#8a0f22'],
    ]) +
    lin(`${p}n`, 0, 0, 0, 1, [
      [0, '#ffffff'],
      [1, '#aeb8c9'],
    ]) +
    lin(`${p}f`, 0, 0, 1, 0, [
      [0, '#ff4a1f'],
      [0.55, '#ffc21a'],
      [1, '#fff8d0'],
    ]) +
    rad(`${p}l`, 0.4, 0.35, 0.7, [
      [0, '#e8ffff'],
      [0.5, '#35d6ff'],
      [1, '#0b6bd6'],
    ])
  );
}

/** Missile pointing right, authored around (50,50). */
function missileBody(p, flame = true) {
  const fl = flame ? `<path d="M19 43 C9 43 2 48 -3 50 C2 52 9 57 19 57 Z" fill="url(#${p}f)" stroke="${OL}" stroke-width="2.6" stroke-linejoin="round"/>` : '';
  return `${fl}
  <path d="M24 41 L15 25 Q14 22 18 22 L28 22 L40 41 Z" fill="#b3142b" stroke="${OL}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M24 59 L15 75 Q14 78 18 78 L28 78 L40 59 Z" fill="#b3142b" stroke="${OL}" stroke-width="3" stroke-linejoin="round"/>
  <rect x="41" y="28" width="4.4" height="13" fill="#6b7385" stroke="${OL}" stroke-width="2"/>
  <path d="M18 40 H70 V60 H18 Q15 60 15 57 V43 Q15 40 18 40 Z" fill="url(#${p}r)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M70 40 C81 40 90 45 93 50 C90 55 81 60 70 60 Z" fill="url(#${p}n)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <rect x="55" y="40" width="5" height="20" fill="#fff" stroke="${OL}" stroke-width="1.6"/>
  <circle cx="79" cy="50" r="5.6" fill="url(#${p}l)" stroke="${OL}" stroke-width="2.4"/>
  <circle cx="77.4" cy="48.2" r="1.7" fill="#fff"/>
  <path d="M20 44.8 H52" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>
  <ellipse cx="43.2" cy="27" rx="16" ry="3.4" fill="#e3ebf5" fill-opacity=".85" stroke="${OL}" stroke-width="2.2"/>
  <circle cx="43.2" cy="27" r="2.8" fill="#ff4a44" stroke="${OL}" stroke-width="1.4"/>`;
}

function missile(p) {
  return wrap(missileDefs(p), place(52, 52, 0.98, -32, missileBody(p, true)) + sparkle(18, 20, 5) + sparkle(86, 84, 4));
}

function missile3(p) {
  const r = orbitRing('#ff8a8a');
  return wrap(
    missileDefs(p),
    r.back + place(50, 33, 0.46, -28, missileBody(p, false)) + r.front + place(22, 67, 0.52, -28, missileBody(p, false)) + place(78, 68, 0.52, -28, missileBody(p, false)),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Grenade
// ---------------------------------------------------------------------------------------------------------

function grenade(p) {
  const defs =
    rad(`${p}o`, 0.38, 0.32, 0.75, [
      [0, '#c3d38a'],
      [0.5, '#76894a'],
      [1, '#35421d'],
    ]) +
    lin(`${p}m`, 0, 0, 0, 1, [
      [0, '#f4f7fb'],
      [1, '#7f8a9b'],
    ]) +
    `<clipPath id="${p}c"><ellipse cx="48" cy="61" rx="27" ry="30"/></clipPath>`;
  const body = `
  <ellipse cx="48" cy="61" rx="27" ry="30" fill="url(#${p}o)" stroke="${OL}" stroke-width="3.5"/>
  <g clip-path="url(#${p}c)" fill="none" stroke="#27321a" stroke-width="2.6" opacity=".7">
    <path d="M16 47 Q48 54 80 47 M16 62 Q48 69 80 62 M16 77 Q48 84 80 77"/>
    <path d="M36 28 Q28 61 36 94 M60 28 Q68 61 60 94"/>
  </g>
  <ellipse cx="37" cy="46" rx="6.5" ry="10" transform="rotate(20 37 46)" fill="#fff" opacity=".4"/>
  <rect x="37" y="21" width="21" height="12" rx="2.5" fill="url(#${p}m)" stroke="${OL}" stroke-width="3"/>
  <path d="M56 21 C71 18 80 29 77 46 C76 52 70 54 70 48 C71 36 66 30 57 28 Z" fill="url(#${p}m)" stroke="${OL}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M39 24 H56" stroke="#fff" stroke-width="2" opacity=".7" stroke-linecap="round"/>
  <circle cx="29" cy="20" r="8.5" fill="none" stroke="${OL}" stroke-width="7.5"/>
  <circle cx="29" cy="20" r="8.5" fill="none" stroke="#ffd23f" stroke-width="3.6"/>
  <path d="M36 25 L40 26" stroke="${OL}" stroke-width="4" stroke-linecap="round"/>`;
  return wrap(defs, body + sparkle(84, 78, 5) + sparkle(16, 44, 4));
}

// ---------------------------------------------------------------------------------------------------------
// Halo Overdrive
// ---------------------------------------------------------------------------------------------------------

function halo(p) {
  const defs =
    rad(`${p}gl`, 0.5, 0.5, 0.5, [
      [0, '#fff7c0', 0.95],
      [0.45, '#ffd23f', 0.5],
      [1, '#ffb800', 0],
    ]) +
    lin(`${p}g`, 0, 0, 0, 1, [
      [0, '#fffbd6'],
      [0.45, '#ffe066'],
      [0.75, '#ffc21a'],
      [1, '#f08c00'],
    ]);
  const diamond = (x, y, s) =>
    `<path d="M${x} ${y - s} L${x + s * 0.62} ${y} L${x} ${y + s} L${x - s * 0.62} ${y} Z" fill="#fff" stroke="${OL}" stroke-width="2" stroke-linejoin="round"/>`;
  const body = `
  <circle cx="50" cy="52" r="47" fill="url(#${p}gl)"/>
  <g transform="rotate(-12 50 52)">
    <ellipse cx="50" cy="52" rx="43" ry="17.5" fill="none" stroke="${OL}" stroke-width="6.5"/>
    <ellipse cx="50" cy="52" rx="43" ry="17.5" fill="none" stroke="#fff6c4" stroke-width="2.6"/>
    ${diamond(7, 52, 6.5)}${diamond(93, 52, 6.5)}${diamond(50, 34.5, 5)}${diamond(50, 69.5, 5)}
    <ellipse cx="50" cy="52" rx="30" ry="11.5" fill="none" stroke="${OL}" stroke-width="14"/>
    <ellipse cx="50" cy="52" rx="30" ry="11.5" fill="none" stroke="url(#${p}g)" stroke-width="8.5"/>
    <path d="M24 47 A30 11.5 0 0 1 70 42.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".9"/>
  </g>`;
  return wrap(defs, body + sparkle(80, 18, 8) + sparkle(20, 82, 5.5) + sparkle(88, 80, 4) + sparkle(14, 26, 3.5));
}

// ---------------------------------------------------------------------------------------------------------
// Shittim tablet (Arona-blue screen)
// ---------------------------------------------------------------------------------------------------------

function tablet(p) {
  const defs =
    lin(`${p}b`, 0, 0, 0, 1, [
      [0, '#56658a'],
      [1, '#1b2340'],
    ]) +
    lin(`${p}s`, 0, 0, 0.35, 1, [
      [0, '#d8f7ff'],
      [0.4, '#4fd2ff'],
      [1, '#1f7be6'],
    ]) +
    `<clipPath id="${p}c"><rect x="23" y="21" width="54" height="58" rx="4"/></clipPath>`;
  const zap = (x, y, s, r) =>
    `<path d="M0 -10 L-5 1 L0 1 L-3 10 L6 -3 L1 -3 L4 -10 Z" transform="translate(${x} ${y}) rotate(${r}) scale(${s})" fill="#ffe14d" stroke="${OL}" stroke-width="1.8" stroke-linejoin="round"/>`;
  const body = `
  <g transform="rotate(-9 50 50)">
    <rect x="20" y="17" width="66" height="74" rx="9" fill="${OL}" opacity=".25"/>
    <rect x="17" y="14" width="66" height="74" rx="9" fill="url(#${p}b)" stroke="${OL}" stroke-width="3.5"/>
    <rect x="19.5" y="16.5" width="61" height="69" rx="7" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1.4"/>
    <rect x="23" y="21" width="54" height="58" rx="4" fill="url(#${p}s)" stroke="#0b1a3a" stroke-width="1.5"/>
    <g clip-path="url(#${p}c)">
      <path d="M56 21 L70 21 L48 79 L34 79 Z" fill="#fff" opacity=".2"/>
      <path d="M23 70 Q50 60 77 70 V79 H23 Z" fill="#fff" opacity=".18"/>
    </g>
    <ellipse cx="50" cy="33" rx="11" ry="3.4" fill="none" stroke="#fff" stroke-width="2.6"/>
    <path d="M39.5 50 Q43 44.5 46.5 50 M53.5 50 Q57 44.5 60.5 50" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M46 57.5 Q50 62 54 57.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
    <ellipse cx="38" cy="56" rx="3.4" ry="2" fill="#ff9fc6" opacity=".85"/>
    <ellipse cx="62" cy="56" rx="3.4" ry="2" fill="#ff9fc6" opacity=".85"/>
    <circle cx="50" cy="17.6" r="1.3" fill="#8b9abb"/>
    <rect x="44" y="82" width="12" height="2.4" rx="1.2" fill="#8b9abb"/>
  </g>`;
  return wrap(defs, body + zap(88, 22, 1.1, 18) + zap(12, 72, 1, -20) + zap(90, 70, 0.8, 30) + sparkle(12, 20, 5));
}

// ---------------------------------------------------------------------------------------------------------
// Blue winged seeker
// ---------------------------------------------------------------------------------------------------------

function seeker(p) {
  const defs =
    lin(`${p}b`, 0, 0, 0, 1, [
      [0, '#b3dcff'],
      [0.35, '#3d8bff'],
      [0.75, '#1f5fe6'],
      [1, '#0b2f8a'],
    ]) +
    lin(`${p}w`, 1, 1, 0, 0, [
      [0, '#9fbfee'],
      [0.45, '#e6f0ff'],
      [1, '#ffffff'],
    ]) +
    lin(`${p}f`, 0, 0, 1, 0, [
      [0, '#3d6bff'],
      [0.55, '#7fe8ff'],
      [1, '#ffffff'],
    ]);
  // top-down view: body pointing right, a feathered angel wing on each side (mirrored across y = 50)
  const wing = `
    <path d="M60 42 C58 25 45 10 20 5 C24 11 22 14 14 15 C21 20 19 24 10 26 C18 30 17 34 9 37 C20 41 38 44 60 42 Z" fill="url(#${p}w)" stroke="${OL}" stroke-width="3.2" stroke-linejoin="round"/>
    <path d="M50 36 C42 26 32 19 22 15 M48 40 C38 34 28 30 17 28 M44 42 C34 40 24 39 16 38" fill="none" stroke="#8fa9d4" stroke-width="1.7" stroke-linecap="round"/>`;
  const inner = `
  <path d="M19 43 C9 43 2 48 -3 50 C2 52 9 57 19 57 Z" fill="url(#${p}f)" stroke="${OL}" stroke-width="2.6" stroke-linejoin="round"/>
  ${wing}
  <g transform="matrix(1 0 0 -1 0 100)">${wing}</g>
  <path d="M20 39 H66 C80 39 91 44 94 50 C91 56 80 61 66 61 H20 Q16 61 16 57 V43 Q16 39 20 39 Z" fill="url(#${p}b)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M22 44.5 H62" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>
  <circle cx="84" cy="48.5" r="3.4" fill="#fff" opacity=".95"/>
  <ellipse cx="68" cy="50" rx="4.5" ry="15" fill="none" stroke="${OL}" stroke-width="7.5"/>
  <ellipse cx="68" cy="50" rx="4.5" ry="15" fill="none" stroke="#7fe8ff" stroke-width="3.4"/>
  <path d="M65 37.5 A4.5 15 0 0 0 65 62.5" fill="none" stroke="#fff" stroke-width="1.4" opacity=".8"/>`;
  return wrap(defs, place(52, 50, 0.9, -30, inner) + sparkle(86, 16, 6.5) + sparkle(14, 86, 4.5) + sparkle(90, 62, 3.5));
}

// ---------------------------------------------------------------------------------------------------------
// Credit bag
// ---------------------------------------------------------------------------------------------------------

function goldDefs(p) {
  return (
    lin(`${p}gd`, 0, 0, 1, 1, [
      [0, '#fff6b8'],
      [0.45, '#ffd23f'],
      [1, '#e08e00'],
    ]) +
    lin(`${p}gi`, 1, 1, 0, 0, [
      [0, '#fff1a0'],
      [0.5, '#ffcc2e'],
      [1, '#eea000'],
    ])
  );
}

function credits(p) {
  const defs =
    goldDefs(p) +
    rad(`${p}t`, 0.38, 0.35, 0.8, [
      [0, '#fff4d8'],
      [0.5, '#f0c47e'],
      [1, '#b67a36'],
    ]) +
    lin(`${p}r`, 0, 0, 0, 1, [
      [0, '#9ff4ff'],
      [0.5, '#27d3f0'],
      [1, '#0f8fb0'],
    ]);
  const body = `
  <ellipse cx="19" cy="87" rx="9" ry="4.2" fill="url(#${p}gd)" stroke="${OL}" stroke-width="2.6"/>
  <path d="M35 37 C13 50 11 90 50 91 C89 90 87 50 65 37 Z" fill="url(#${p}t)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M33 18 C37 24 41 20 44 25 C46 20 54 20 56 25 C59 20 63 24 67 18 L61 36 H39 Z" fill="url(#${p}t)" stroke="${OL}" stroke-width="3" stroke-linejoin="round"/>
  <rect x="35" y="32" width="30" height="8.5" rx="4.2" fill="url(#${p}r)" stroke="${OL}" stroke-width="3"/>
  <path d="M64 37 C70 41 72 47 70 52" fill="none" stroke="${OL}" stroke-width="5" stroke-linecap="round"/>
  <path d="M64 37 C70 41 72 47 70 52" fill="none" stroke="#27d3f0" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M26 57 C24 68 27 78 35 84" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".55"/>
  <circle cx="52" cy="65" r="14.5" fill="url(#${p}gd)" stroke="${OL}" stroke-width="3"/>
  <circle cx="52" cy="65" r="10.5" fill="url(#${p}gi)" stroke="#c98a00" stroke-width="1.8"/>
  <path d="M57 60 A6.8 6.8 0 1 0 57 70" fill="none" stroke="#a86400" stroke-width="3.8" stroke-linecap="round"/>
  <path d="M52 54.5 V57 M52 73 V75.5" stroke="#a86400" stroke-width="2.6" stroke-linecap="round"/>
  <ellipse cx="85" cy="82" rx="5.5" ry="8.5" fill="url(#${p}gd)" stroke="${OL}" stroke-width="2.6"/>
  <ellipse cx="85" cy="82" rx="2.4" ry="4.6" fill="none" stroke="#c98a00" stroke-width="1.4"/>`;
  return wrap(defs, body + sparkle(82, 22, 7) + sparkle(15, 42, 4.5) + sparkle(90, 56, 3.5));
}

// ---------------------------------------------------------------------------------------------------------
// Decoy box
// ---------------------------------------------------------------------------------------------------------

function decoy(p) {
  const defs =
    lin(`${p}t`, 0, 0, 1, 1, [
      [0, '#ffe3f0'],
      [1, '#ff8cc0'],
    ]) +
    lin(`${p}l`, 0, 0, 1, 1, [
      [0, '#ff78b4'],
      [1, '#d9267a'],
    ]) +
    lin(`${p}r`, 0, 0, 1, 1, [
      [0, '#d02a74'],
      [1, '#8c1048'],
    ]);
  const q = `<path d="M-7 -9 C-7 -19 8 -19 8 -10 C8 -3 0 -3 0 5" fill="none" stroke="${OL}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="0" cy="14" r="4.6" fill="${OL}"/>
    <path d="M-7 -9 C-7 -19 8 -19 8 -10 C8 -3 0 -3 0 5" fill="none" stroke="#fff" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="0" cy="14" r="2.6" fill="#fff"/>`;
  const body = `
  <path d="M41 24 C36 16 37 9 42 6 C42 12 45 17 48 21 Z" fill="#ff3a6a" stroke="${OL}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M59 24 C64 16 63 9 58 6 C58 12 55 17 52 21 Z" fill="#ff3a6a" stroke="${OL}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M50 16 L85 32 L50 48 L15 32 Z" fill="url(#${p}t)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M15 32 L50 48 L50 91 L15 75 Z" fill="url(#${p}l)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M50 48 L85 32 L85 75 L50 91 Z" fill="url(#${p}r)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M19 35 L50 49.5 L81 35" fill="none" stroke="#fff" stroke-width="1.8" opacity=".7"/>
  <path d="M50 20 L78 32.5 L50 45 L22 32.5 Z" fill="none" stroke="#fff" stroke-width="1.4" opacity=".6"/>
  <g transform="matrix(0.62 0.29 0 0.82 32.5 63) rotate(180)">${q}</g>
  <g transform="matrix(0.62 -0.29 0 0.82 67.5 63) rotate(180)">${q}</g>
  <path d="M86 70 C94 68 95 60 90 57 C92 62 90 64 86 64" fill="none" stroke="${OL}" stroke-width="5" stroke-linecap="round"/>
  <path d="M86 70 C94 68 95 60 90 57 C92 62 90 64 86 64" fill="none" stroke="#ff3a6a" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M90 57 L87.5 51.5 L94.5 54 Z" fill="#ff3a6a" stroke="${OL}" stroke-width="2" stroke-linejoin="round"/>`;
  return wrap(defs, body + sparkle(14, 16, 5, '#ffe3f0'));
}

// ---------------------------------------------------------------------------------------------------------
// Credit coin + Pyroxene crystal
// ---------------------------------------------------------------------------------------------------------

function coin(p) {
  const defs = goldDefs(p);
  const body = `
  <circle cx="50" cy="52" r="44" fill="#b56f00" stroke="${OL}" stroke-width="4"/>
  <circle cx="50" cy="48" r="44" fill="url(#${p}gd)" stroke="${OL}" stroke-width="4"/>
  <circle cx="50" cy="48" r="34" fill="url(#${p}gi)" stroke="#cc8500" stroke-width="3"/>
  <path d="M62 36 A17 17 0 1 0 62 60" fill="none" stroke="#a45f00" stroke-width="9.5" stroke-linecap="round"/>
  <path d="M61 35 A17 17 0 1 0 38 63" fill="none" stroke="#ffe98a" stroke-width="2.4" stroke-linecap="round" opacity=".8" transform="translate(-1.6 -1.6)"/>
  <path d="M50 20 V27 M50 69 V76" stroke="#a45f00" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M20 38 A31 31 0 0 1 38 18" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".75"/>
  <path d="M76 72 A31 31 0 0 1 66 79" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".45"/>`;
  return wrap(defs, body);
}

function crystal(p) {
  const defs =
    lin(`${p}c`, 0, 0, 0, 1, [
      [0, '#9ff0ff'],
      [0.5, '#35b6ff'],
      [1, '#3b55e6'],
    ]) +
    rad(`${p}g`, 0.5, 0.5, 0.5, [
      [0, '#bff4ff', 0.75],
      [1, '#7fdcff', 0],
    ]);
  const f = (pts, fill) => `<polygon points="${pts}" fill="${fill}" stroke="#fff" stroke-opacity=".55" stroke-width="1.2" stroke-linejoin="round"/>`;
  const body = `
  <circle cx="50" cy="50" r="48" fill="url(#${p}g)"/>
  ${f('50,5 18,30 38,34', '#c9f2ff')}
  ${f('50,5 62,34 82,30', '#78d3ff')}
  ${f('50,5 38,34 62,34', '#e8fbff')}
  ${f('18,30 38,34 34,66 26,72', '#4fb3ff')}
  ${f('38,34 62,34 66,66 34,66', `url(#${p}c)`)}
  ${f('62,34 82,30 74,72 66,66', '#2f6bdc')}
  ${f('26,72 34,66 50,95', '#3f7cee')}
  ${f('34,66 66,66 50,95', '#6a55e8')}
  ${f('66,66 74,72 50,95', '#2d3aa8')}
  <polygon points="50,5 82,30 74,72 50,95 26,72 18,30" fill="none" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M42 40 L50 38 L46 56 Z" fill="#fff" opacity=".55"/>`;
  return wrap(defs, body + sparkle(30, 20, 6.5) + sparkle(80, 76, 4.5));
}

// ---------------------------------------------------------------------------------------------------------
// Fallback + public API
// ---------------------------------------------------------------------------------------------------------

function fallback(p, id) {
  const c = ITEMS[id]?.color || '#8a93a6';
  return wrap(
    rad(`${p}f`, 0.4, 0.35, 0.7, [
      [0, '#ffffff'],
      [1, c],
    ]),
    `<circle cx="50" cy="50" r="36" fill="url(#${p}f)" stroke="${OL}" stroke-width="4"/>
     <path d="M40 40 C40 28 60 28 60 40 C60 48 50 48 50 57" fill="none" stroke="${OL}" stroke-width="6" stroke-linecap="round"/>
     <circle cx="50" cy="67" r="4" fill="${OL}"/>`,
  );
}

const BUILDERS = { drink, drink3, card, ramen, ramen3, bullet, bullet3, missile, missile3, grenade, halo, tablet, seeker, credits, decoy };

export const ITEM_ICON_IDS = Object.keys(BUILDERS);

const nextPrefix = (id) => `ssk${(++uid).toString(36)}${id.replace(/[^a-z0-9]/gi, '')}`;

export function itemIconSVG(id) {
  const b = BUILDERS[id];
  const p = nextPrefix(id || 'x');
  return b ? b(p) : fallback(p, id);
}

const toURL = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const urlCache = new Map();

export function itemIconURL(id) {
  let u = urlCache.get(id);
  if (!u) {
    u = toURL(itemIconSVG(id));
    urlCache.set(id, u);
  }
  return u;
}

export const coinIconSVG = () => coin(nextPrefix('coin'));
export const crystalIconSVG = () => crystal(nextPrefix('pyro'));

let coinURL = null;
let crystalURL = null;
export const coinIconURL = () => (coinURL ??= toURL(coinIconSVG()));
export const crystalIconURL = () => (crystalURL ??= toURL(crystalIconSVG()));
