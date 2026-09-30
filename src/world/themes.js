// Theme presets + theme normalisation (owner: world agent).
//
// Track files may write a full `theme` object (ARCHITECTURE.md §4), or start from a preset:
//     theme: { preset: 'desert', fog: { far: 800 }, particles: 'petals' }
// `preset` is deep-merged: every sub-object of the preset is kept unless overridden field by field.
// Legacy keys `skyTop` / `skyBottom` are accepted as `sky.top` / `sky.bottom`.
//
// resolveTheme(theme) always returns a COMPLETE theme (every field filled), so the builders never need
// optional chaining. It never mutates its input.

export const GROUND_TYPES = ['sand', 'grass', 'asphalt', 'snow', 'rock', 'lava', 'cloud', 'water', 'space', 'none'];
export const ROAD_STYLES = ['asphalt', 'stone', 'brick', 'neon', 'rainbow', 'ice', 'dirt', 'wood', 'tile'];
export const EDGE_STYLES = ['curb', 'line', 'glow', 'none'];
export const OFFROAD_TYPES = ['sand', 'grass', 'snow', 'dirt', 'gravel', 'flowers', 'none'];
export const WALL_STYLES = ['barrier', 'fence', 'stone', 'glow', 'hedge', 'snowbank', 'tires', 'none'];
export const VOID_TYPES = ['lava', 'water', 'sky', 'abyss'];
export const PARTICLE_TYPES = ['dust', 'petals', 'snow', 'embers', 'sparkles', 'leaves'];

/** Built-in theme presets (also used by the debug track scene: /?scene=track&theme=<preset>). */
export const THEME_PRESETS = {
  desert: {
    sky: { top: '#2b78e8', bottom: '#cfe6ff', horizon: '#ffe8c2', stars: false, sunDisc: true, clouds: true },
    fog: { color: '#f0dcb6', near: 180, far: 900 },
    sun: { color: '#fff0d4', intensity: 2.6, dir: [0.5, 0.95, 0.3] },
    ambient: { sky: '#cfe6ff', ground: '#d9b77a', intensity: 1.05 },
    ground: { type: 'sand', color: '#ecc98a', color2: '#dcae68' },
    road: { style: 'asphalt', color: '#6b6761', color2: '#5d5953', lines: true },
    edge: { style: 'curb', colorA: '#e8304f', colorB: '#ffffff' },
    offroad: { type: 'sand', color: '#e8c27d' },
    wall: { style: 'barrier', color: '#eef1f5', color2: '#1fb6ff' },
    void: { type: 'lava', color: '#ff5a1f' },
    grip: 1.0,
    particles: 'dust',
    music: 'abydos',
    night: false,
  },
  'city-sunset': {
    sky: { top: '#34458f', bottom: '#ffb27a', horizon: '#ffcc88', stars: false, sunDisc: true, clouds: true },
    fog: { color: '#f2a67c', near: 150, far: 760 },
    sun: { color: '#ffc088', intensity: 2.3, dir: [-0.65, 0.38, 0.55] },
    ambient: { sky: '#ffc9a8', ground: '#5a4b6a', intensity: 0.95 },
    ground: { type: 'asphalt', color: '#77737c', color2: '#66626c' },
    road: { style: 'asphalt', color: '#4b4b53', color2: '#42424a', lines: true },
    edge: { style: 'line', colorA: '#ffd23f', colorB: '#ffffff' },
    offroad: { type: 'gravel', color: '#8c8680' },
    wall: { style: 'barrier', color: '#ecebf0', color2: '#ff7a45' },
    void: { type: 'water', color: '#2c5f8a' },
    grip: 1.0,
    particles: 'leaves',
    music: 'shibaseki',
    night: false,
  },
  garden: {
    sky: { top: '#3f8cff', bottom: '#d9eeff', horizon: '#fff6e2', stars: false, sunDisc: true, clouds: true },
    fog: { color: '#e0f0ff', near: 200, far: 880 },
    sun: { color: '#fff5e2', intensity: 2.5, dir: [0.35, 1.0, -0.4] },
    ambient: { sky: '#d4ecff', ground: '#6c9a4a', intensity: 1.1 },
    ground: { type: 'grass', color: '#7cc45a', color2: '#61ab44' },
    road: { style: 'stone', color: '#c4bcb0', color2: '#aaa296', lines: false },
    edge: { style: 'line', colorA: '#ffffff', colorB: '#ffffff' },
    offroad: { type: 'flowers', color: '#7cc85a' },
    wall: { style: 'hedge', color: '#3f9a3c', color2: '#2f7f30' },
    void: { type: 'water', color: '#3a8fd0' },
    grip: 1.0,
    particles: 'leaves',
    music: 'trinity',
    night: false,
  },
  'neon-night': {
    sky: { top: '#04061a', bottom: '#1d1242', horizon: '#46207a', stars: true, sunDisc: false, clouds: false },
    fog: { color: '#1b1442', near: 120, far: 650 },
    sun: { color: '#a8bcff', intensity: 0.9, dir: [0.3, 1.0, 0.2] },
    ambient: { sky: '#5a6cff', ground: '#241046', intensity: 0.85 },
    ground: { type: 'asphalt', color: '#1c1e2c', color2: '#15161f' },
    road: { style: 'neon', color: '#151a2e', color2: '#39d0ff', lines: true },
    edge: { style: 'glow', colorA: '#39d0ff', colorB: '#ff4fd8' },
    offroad: { type: 'none', color: '#232842' },
    wall: { style: 'glow', color: '#1c2033', color2: '#39d0ff' },
    void: { type: 'abyss', color: '#6a3cff' },
    grip: 1.0,
    particles: 'sparkles',
    music: 'millennium',
    night: true,
  },
  sakura: {
    sky: { top: '#66a6ff', bottom: '#ffe4f0', horizon: '#ffd5e6', stars: false, sunDisc: true, clouds: true },
    fog: { color: '#f8dcea', near: 160, far: 800 },
    sun: { color: '#fff0f0', intensity: 2.35, dir: [-0.4, 0.85, 0.35] },
    ambient: { sky: '#ffe0ef', ground: '#7a8a5a', intensity: 1.05 },
    ground: { type: 'grass', color: '#8cc56a', color2: '#73ad55' },
    road: { style: 'wood', color: '#b98552', color2: '#a0703f', lines: false },
    edge: { style: 'line', colorA: '#ffffff', colorB: '#ff9ec7' },
    offroad: { type: 'grass', color: '#86c264' },
    wall: { style: 'fence', color: '#c0392b', color2: '#2b2323' },
    void: { type: 'water', color: '#4a8fc8' },
    grip: 1.0,
    particles: 'petals',
    music: 'hyakkiyako',
    night: false,
  },
  snow: {
    sky: { top: '#6b9ad8', bottom: '#e9f3ff', horizon: '#f5f9ff', stars: false, sunDisc: true, clouds: true },
    fog: { color: '#e5eef9', near: 140, far: 700 },
    sun: { color: '#ffffff', intensity: 2.2, dir: [0.3, 0.7, -0.6] },
    ambient: { sky: '#e0ecff', ground: '#9fb3c8', intensity: 1.2 },
    ground: { type: 'snow', color: '#f3f7ff', color2: '#d9e6f5' },
    road: { style: 'ice', color: '#d6ebff', color2: '#a6d2f5', lines: false },
    edge: { style: 'curb', colorA: '#d8243a', colorB: '#ffffff' },
    offroad: { type: 'snow', color: '#f1f5fb' },
    wall: { style: 'snowbank', color: '#ffffff', color2: '#cfe0f2' },
    void: { type: 'water', color: '#2a6f9e' },
    grip: 0.6,
    particles: 'snow',
    music: 'redwinter',
    night: false,
  },
  lava: {
    sky: { top: '#260812', bottom: '#ff6a2a', horizon: '#ff8c3c', stars: false, sunDisc: false, clouds: true },
    fog: { color: '#5c1c16', near: 110, far: 620 },
    sun: { color: '#ffb07a', intensity: 1.8, dir: [-0.3, 0.8, 0.4] },
    ambient: { sky: '#ff9a6a', ground: '#3a1a14', intensity: 0.95 },
    ground: { type: 'lava', color: '#ff5a1f', color2: '#ffb03a' },
    road: { style: 'dirt', color: '#4a3b36', color2: '#3b2f2b', lines: false },
    edge: { style: 'glow', colorA: '#ff6a1f', colorB: '#ffd23f' },
    offroad: { type: 'gravel', color: '#4a3a36' },
    wall: { style: 'stone', color: '#3d3337', color2: '#ff5a1f' },
    void: { type: 'lava', color: '#ff5a1f' },
    grip: 1.0,
    particles: 'embers',
    music: 'gehenna',
    night: false,
  },
  sky: {
    sky: { top: '#4a9fff', bottom: '#eaf6ff', horizon: '#ffffff', stars: false, sunDisc: true, clouds: true },
    fog: { color: '#e2f2ff', near: 220, far: 950 },
    sun: { color: '#ffffff', intensity: 2.4, dir: [0.4, 1.0, 0.3] },
    ambient: { sky: '#e8f4ff', ground: '#b8c8ff', intensity: 1.2 },
    ground: { type: 'cloud', color: '#ffffff', color2: '#e3eeff' },
    road: { style: 'rainbow', color: '#ffffff', color2: '#ffffff', lines: false },
    edge: { style: 'glow', colorA: '#8fd8ff', colorB: '#ff9ee6' },
    offroad: { type: 'none', color: '#dfe8ff' },
    wall: { style: 'glow', color: '#ffffff', color2: '#8fd8ff' },
    void: { type: 'sky', color: '#ffffff' },
    grip: 1.0,
    particles: 'sparkles',
    music: 'arona',
    night: false,
  },
};

// Generic per-field defaults (used when a theme has no preset and leaves fields out).
const FIELD_DEFAULTS = {
  sky: { top: '#3d8bff', bottom: '#cfe8ff', horizon: null, stars: false, sunDisc: true, clouds: true },
  fog: { color: null, near: 150, far: 700 },
  sun: { color: '#fff4e0', intensity: 2.3, dir: [0.4, 1, 0.3] },
  ambient: { sky: '#cfe6ff', ground: '#7d6a52', intensity: 1.0 },
  ground: { type: 'grass', color: '#6fbf4a', color2: null },
  road: { style: 'asphalt', color: '#55575f', color2: null, lines: undefined },
  edge: { style: 'curb', colorA: '#e8304f', colorB: '#ffffff' },
  offroad: { type: 'grass', color: '#7ac653' },
  wall: { style: 'barrier', color: '#e9eef5', color2: '#1fb6ff' },
  void: null,
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b || {})) {
    const v = b[k];
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(a[k]) ? deepMerge(a[k], v) : v;
  }
  return out;
}

/** Default void type for a ground type (used when the theme has wall-less edges but no `void`). */
function defaultVoid(groundType) {
  if (groundType === 'lava') return 'lava';
  if (groundType === 'water') return 'water';
  if (groundType === 'cloud' || groundType === 'none') return 'sky';
  if (groundType === 'space') return 'abyss';
  return 'water';
}

const VOID_COLORS = { lava: '#ff5a1f', water: '#2f78b8', sky: '#ffffff', abyss: '#5a3cff' };

/**
 * Fill every theme field. Accepts `preset`, legacy `skyTop/skyBottom`, partial sub-objects.
 * With a preset, the track's theme is deep-merged onto it. Without one, each sub-object keeps exactly what
 * the track wrote and missing fields get neutral defaults (derived from the track's own colours).
 * @returns a complete theme object (fresh copy)
 */
export function resolveTheme(theme = {}) {
  theme = theme || {};
  const preset = theme.preset && THEME_PRESETS[theme.preset];
  let t;
  if (preset) {
    t = deepMerge(preset, theme);
  } else {
    t = { ...theme };
    for (const k of Object.keys(FIELD_DEFAULTS)) {
      if (FIELD_DEFAULTS[k] === null) continue;
      t[k] = { ...FIELD_DEFAULTS[k], ...(isObj(theme[k]) ? theme[k] : {}) };
    }
  }
  t.sky = { ...t.sky };
  // legacy keys
  if (theme.skyTop) t.sky.top = theme.skyTop;
  if (theme.skyBottom) t.sky.bottom = theme.skyBottom;
  t.sky.horizon = t.sky.horizon || t.sky.bottom;
  t.fog = { ...t.fog, color: t.fog.color || t.sky.horizon };
  // validate enums (unknown -> sensible default, never throw)
  if (!GROUND_TYPES.includes(t.ground.type)) t.ground.type = 'grass';
  if (!ROAD_STYLES.includes(t.road.style)) t.road.style = 'asphalt';
  if (!EDGE_STYLES.includes(t.edge.style)) t.edge.style = 'curb';
  if (!OFFROAD_TYPES.includes(t.offroad.type)) t.offroad.type = 'grass';
  if (!WALL_STYLES.includes(t.wall.style)) t.wall.style = 'barrier';
  if (!isObj(t.void) || !VOID_TYPES.includes(t.void.type)) {
    const type = isObj(t.void) && VOID_TYPES.includes(t.void.type) ? t.void.type : defaultVoid(t.ground.type);
    t.void = { type, color: (isObj(t.void) && t.void.color) || VOID_COLORS[type] };
  }
  t.void = { ...t.void, color: t.void.color || VOID_COLORS[t.void.type] };
  if (t.particles && !PARTICLE_TYPES.includes(t.particles)) t.particles = null;
  t.ground.color2 = t.ground.color2 || t.ground.color;
  t.road.color2 = t.road.color2 || t.road.color;
  t.edge.colorA = t.edge.colorA || '#e8304f';
  t.edge.colorB = t.edge.colorB || '#ffffff';
  t.wall.color2 = t.wall.color2 || t.wall.color;
  if (t.road.lines === undefined) t.road.lines = t.road.style === 'asphalt';
  t.fog.near = t.fog.near ?? 150;
  t.fog.far = t.fog.far ?? 700;
  t.sun.dir = Array.isArray(t.sun.dir) && t.sun.dir.length === 3 ? t.sun.dir : [0.4, 1, 0.3];
  t.grip = t.grip ?? 1;
  t.night = !!t.night;
  t.particles = t.particles ?? null;
  return t;
}

/** Ground types that have a solid, walkable terrain heightfield. */
export const isSolidGround = (type) => type === 'sand' || type === 'grass' || type === 'asphalt' || type === 'snow' || type === 'rock';
/** Ground types where the "ground" is a liquid surface far below the road (causeways / embankments). */
export const isLiquidGround = (type) => type === 'lava' || type === 'water';
/** Ground types with nothing solid below (floating roads). */
export const isFloatingGround = (type) => type === 'cloud' || type === 'space' || type === 'none';
