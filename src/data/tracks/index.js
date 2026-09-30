// Track registry + cups. Track definitions are loaded lazily so a broken track file can't take the game down.
//
// Each entry: { id, name, cup, order, blurb, color (menu accent), load: () => Promise<def> }

const lazy = (loader) => () => loader().then((m) => m.default ?? m);

export const TRACKS = [
  {
    id: 'abydos-desert',
    name: 'Abydos Desert Circuit',
    cup: 'credit',
    order: 0,
    blurb: 'Sand-swept streets around Abydos High. Watch the dunes!',
    color: '#f2b45a',
    load: lazy(() => import('./abydos-desert.js')),
  },
  {
    id: 'shibaseki-street',
    name: 'Shibaseki Ramen Street',
    cup: 'credit',
    order: 1,
    blurb: 'Sunset city blocks past the best ramen shop in Kivotos.',
    color: '#ff7a45',
    load: lazy(() => import('./shibaseki-street.js')),
  },
  {
    id: 'trinity-garden',
    name: 'Trinity Garden Speedway',
    cup: 'credit',
    order: 2,
    blurb: 'Rolling hills, rose gardens and a cathedral finish.',
    color: '#8fd16a',
    load: lazy(() => import('./trinity-garden.js')),
  },
  {
    id: 'millennium-cyber',
    name: 'Millennium Cyber Loop',
    cup: 'credit',
    order: 3,
    blurb: 'Neon night drive through the science school skyline.',
    color: '#39d0ff',
    load: lazy(() => import('./millennium-cyber.js')),
  },
  {
    id: 'hyakkiyako-sakura',
    name: 'Hyakkiyako Sakura Pass',
    cup: 'pyroxene',
    order: 0,
    blurb: 'Mountain road under a thousand torii and falling petals.',
    color: '#ff9ec7',
    load: lazy(() => import('./hyakkiyako-sakura.js')),
  },
  {
    id: 'red-winter',
    name: 'Red Winter Snow Fortress',
    cup: 'pyroxene',
    order: 1,
    blurb: 'Icy corners around the Federal Academy fortress. Slippery!',
    color: '#9fd8ff',
    load: lazy(() => import('./red-winter.js')),
  },
  {
    id: 'gehenna-inferno',
    name: 'Gehenna Inferno Rally',
    cup: 'pyroxene',
    order: 2,
    blurb: 'Lava rivers, demon castles and zero guard rails.',
    color: '#ff5533',
    load: lazy(() => import('./gehenna-inferno.js')),
  },
  {
    id: 'arona-sky',
    name: "Arona's Sky Classroom",
    cup: 'pyroxene',
    order: 3,
    blurb: 'A shimmering road through the clouds of the Shittim Chest.',
    color: '#b18cff',
    load: lazy(() => import('./arona-sky.js')),
  },
];

/** Debug / test tracks (not shown in cups). */
export const TEST_TRACKS = [
  {
    id: 'test-oval',
    name: 'Test Oval',
    cup: null,
    order: 0,
    blurb: 'Development test track.',
    color: '#aaaaaa',
    load: lazy(() => import('./test-oval.js')),
  },
];

export const CUPS = [
  { id: 'credit', name: 'Credit Cup', icon: 'coin', color: '#ffd23f', tracks: [] },
  { id: 'pyroxene', name: 'Pyroxene Cup', icon: 'crystal', color: '#3fd0ff', tracks: [] },
];
for (const cup of CUPS) {
  cup.tracks = TRACKS.filter((t) => t.cup === cup.id)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.id);
}

const ALL = [...TRACKS, ...TEST_TRACKS];
export const getTrackEntry = (id) => ALL.find((t) => t.id === id) ?? null;

/** Load a track definition by id (returns the def object). Falls back to the test oval if loading fails. */
export async function loadTrackDef(id) {
  const entry = getTrackEntry(id);
  if (!entry) throw new Error(`Unknown track "${id}"`);
  try {
    return await entry.load();
  } catch (err) {
    console.error(`[tracks] failed to load "${id}", falling back to test-oval`, err);
    return await TEST_TRACKS[0].load();
  }
}
