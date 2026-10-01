// Super Serika Kart - extra original soundtrack (owner: audio agent). All compositions are original.
// Same format as songs.js (see notation.js); merged into SONGS there.
//
//  key         style                                         key / tempo     used for
//  eurobeat    eurobeat (octave bass, supersaw, brass stabs) F# minor, 156   race music mix
//  highway     uplifting trance / synth-pop                  A minor, 138    race music mix
//  ska         ska-punk (offbeat skank, horns, punk chorus)  G major, 176    race music mix
//  chiptune    8-bit rally (pulse lead, noise drums)         C major, 160    race music mix
//  lounge      bossa nova (flute, Rhodes, rim clave)         D major, 128    Options / How to Play / Sound Test
//  online      future funk (slap bass, house beat)           Bb major, 118   online lobby
//  tournament  anthem (brass, strings, timpani)              G major, 112    between online tournament races

// ------------------------------------------------------------------------------------------------------------
// EUROBEAT - "Drift Queen of Kivotos"
// ------------------------------------------------------------------------------------------------------------
const EU_A =
  'o5 c+8 c+8 < b8 > c+8 r8 e8 d8 c+8 | d4 c+8 < b8 a4 f+4 | g+8 g+8 a8 b8 r8 > e8 d8 < b8 | > c+2 < g+4 e4 |' +
  ' > c+8 c+8 < b8 > c+8 r8 f+8 e8 c+8 | d4 e8 f+8 a4 f+4 | e8 f+8 e8 d8 c+4 < b4 | > c+1 |';
const EU_B =
  'o5 f+4 f+8 e8 f+4 a4 | g+4. f+8 e4 c+4 | a4 a8 g+8 a4 > c+4 | < b2 a4 g+4 |' +
  ' f+4 f+8 e8 f+4 a4 | b4. a8 g+4 e4 | f+8 g+8 a8 b8 > c+4 < b8 a8 | f+1 |';
const eurobeat = {
  name: 'Drift Queen of Kivotos',
  bpm: 156,
  reverb: 0.2,
  delay: { beats: 0.75, fb: 0.32, mix: 0.3 },
  tracks: {
    lead: { inst: 'supersaw', spread: 18, lp: 5200, q: 0.7, vol: 0.115, dly: 0.22, rev: 0.15, a: 0.005, s: 0.8, vib: 10 },
    brass: { inst: 'brass', vol: 0.085, rev: 0.15, pan: -0.2 },
    stab: { inst: 'brass', gen: 'pad', pattern: 'x..x..x...x..x..', center: 66, vol: 0.06, pan: 0.2, a: 0.005, swell: 0.02 },
    arp: { inst: 'saw', gen: 'arp', pattern: '0123012301230123', center: 73, lp: 2600, q: 2, d: 0.08, s: 0.3, vol: 0.04, dly: 0.25, pan: -0.3, gate: 0.5 },
    pad: { inst: 'pad', gen: 'pad', pattern: 'sus', center: 62, vol: 0.04, lp: 2400, rev: 0.35 },
    bass: { inst: 'sawBass', gen: 'bass', pattern: 'RORORORORORORORO', oct: 2, vol: 0.27, lp: 520, fenv: 1300, fdecay: 0.07 },
    drums: { kit: 'synth', vol: 0.5, rev: 0.12 },
  },
  patterns: {
    euro: { k: 'x...x...x...x...', c: '....x.......x...', o: '..x...x...x...x.', h: 'x.x.x.x.x.x.x.x.' },
    eurox: { k: 'x...x...x...x...', c: '....x.......x...', o: '..x...x...x...x.', h: 'x.x.x.x.x.x.x.x.', x: 'X...............' },
    euroF: { k: 'x...x...x...x...', s: '....x...x.x.xxXX', c: '....x...........' },
    euroI: { k: 'x...x...x...x...', h: 'xxxxxxxxxxxxxxxx' },
    euroR: { k: 'x.x.x.x.xxxxxxxx', s: 'x.x.x.x.xxxxXXXX' },
  },
  sections: {
    intro: { chords: 'F#m D E E', drums: 'euroI*3 euroR', mute: ['pad'] },
    A: { chords: 'F#m D E C#m F#m D E C#7', lead: EU_A, drums: 'eurox euro*6 euroF', mute: ['brass'] },
    B: { chords: 'D E F#m E D E Bm7:2 C#7:2 F#m', lead: EU_B, brass: EU_B.replace('o5', 'o4'), drums: 'eurox euro*6 euroF', pat: { arp: '0123432101234321' } },
  },
  form: ['intro', 'A', 'B', 'A', 'B'],
  loop: 1,
};

// ------------------------------------------------------------------------------------------------------------
// HIGHWAY - "Kivotos Highway" (trance)
// ------------------------------------------------------------------------------------------------------------
const HW_A = 'o5 e4. d8 c4 < b4 | a4. g8 a4 > c4 | d4. c8 < b4 g4 | b2 > c4 d4 | e4. d8 c4 e4 | f4. e8 d4 c4 | < b4 > c8 d8 e4 g4 | e1 |';
const HW_B = 'o5 a4 a8 b8 > c4 < a4 | g4 g8 a8 b4 g4 | f4 f8 g8 a4 > c4 | < b2. g4 | a4 a8 b8 > c4 e4 | d4 c8 d8 e4 g4 | f4 e4 d4 < b4 | a1 |';
const highway = {
  name: 'Kivotos Highway',
  gain: 1.25, // level trim (offline level report)
  bpm: 138,
  reverb: 0.3,
  delay: { beats: 0.75, fb: 0.4, mix: 0.38 },
  tracks: {
    lead: { inst: 'supersaw', spread: 22, lp: 3400, q: 0.9, vol: 0.11, dly: 0.3, rev: 0.25, a: 0.01, s: 0.85, vib: 6 },
    pluck: { inst: 'pluck', gen: 'arp', pattern: '0.1.2.0.1.2.0.1.', center: 69, vol: 0.065, bright: 4200, decay: 0.28, dly: 0.35, rev: 0.2, pan: 0.25 },
    pad: { inst: 'pad', gen: 'pad', pattern: 'sus', center: 64, vol: 0.05, lp: 2600, rev: 0.45, swell: 1.2 },
    bass: { inst: 'sawBass', gen: 'bass', pattern: '..R-..R-..R-..R-', oct: 2, vol: 0.28, lp: 600, fenv: 900, fdecay: 0.06 },
    sub: { inst: 'subBass', gen: 'bass', pattern: 'R...R...R...R...', oct: 1, vol: 0.22 },
    drums: { kit: 'synth', vol: 0.48, rev: 0.18 },
  },
  patterns: {
    tr: { k: 'x...x...x...x...', c: '....x.......x...', o: '..x...x...x...x.', h: 'xxxxxxxxxxxxxxxx' },
    trx: { k: 'x...x...x...x...', c: '....x.......x...', o: '..x...x...x...x.', h: 'xxxxxxxxxxxxxxxx', x: 'X...............' },
    trF: { k: 'x...x...x...x...', s: 'x.x.x.x.xxxxXXXX' },
    brk: { h: '..x...x...x...x.' },
    brkF: { s: '....x...x.x.xxxx', x: '...............X' },
  },
  sections: {
    intro: { chords: 'Am F C G', drums: 'brk*3 brkF', mute: ['bass', 'sub'] },
    A: { chords: 'Am F G Em Am Dm G Am', lead: HW_A, drums: 'trx tr*6 trF' },
    B: { chords: 'F G F G Am G Dm:2 E7:2 Am', lead: HW_B, drums: 'trx tr*6 trF', pat: { pluck: '0.1.2.3.2.1.2.3.' } },
  },
  form: ['intro', 'A', 'B', 'A', 'B'],
  loop: 1,
};

// ------------------------------------------------------------------------------------------------------------
// SKA - "Credit Crunch Ska"
// ------------------------------------------------------------------------------------------------------------
const SK_A =
  'o5 d8 d8 r8 b8 r8 g8 a8 b8 | > c4 < b8 a8 g4 e4 | e8 e8 r8 g8 r8 e8 f+8 g8 | a2 f+4 d4 |' +
  ' d8 d8 r8 b8 r8 g8 a8 b8 | > c4 d8 e8 d4 c4 | < b4 g4 a4 f+4 | g2. r4 |';
const SK_B = 'o5 g4 g4 a4 b4 | > c2 < b2 | a4 a4 b4 > c4 | d1 | < e4 e4 f+4 g4 | a2 g4 f+4 | e4 d4 e4 f+4 | g1 |';
const ska = {
  name: 'Credit Crunch Ska',
  gain: 0.95, // level trim (offline level report)
  bpm: 176,
  reverb: 0.16,
  delay: { beats: 0.5, fb: 0.2, mix: 0.15 },
  tracks: {
    horns: { inst: 'brass', vol: 0.15, rev: 0.15, pan: -0.1 },
    sax: { inst: 'brass', vol: 0.09, rev: 0.15, pan: 0.25, vib: 12 },
    skank: { inst: 'organ', gen: 'pad', pattern: '..x...x...x...x.', center: 64, vol: 0.06, gate: 0.4, pan: 0.2 },
    gtr: { inst: 'guitar', gen: 'pad', pattern: '..x...x...x...x.', center: 60, vol: 0.06, gate: 0.35, fx: { drive: 4, lp: 4500, post: 0.4 }, pan: -0.25 },
    bass: { inst: 'triBass', gen: 'bass', pattern: 'R.3.5.O.5.3.R.A.', oct: 2, vol: 0.4 },
    drums: { kit: 'rock', vol: 0.52, rev: 0.08 },
  },
  patterns: {
    skaA: { k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', rim: '..x...x...x...x.' },
    skaAx: { k: 'x.......x.......', s: '....x.......x...', h: '..x.x.x.x.x.x.x.', rim: '..x...x...x...x.', x: 'X...............' },
    punk: { k: 'x...x...x...x...', s: '..x...x...x...x.', h: 'xxxxxxxxxxxxxxxx' },
    punkx: { k: 'x...x...x...x...', s: '..x...x...x...x.', h: '.xxxxxxxxxxxxxxx', x: 'X...............' },
    skaF: { k: 'x.......x.......', s: '....x...xxXxXXXX', t: '........x.x.....', f: '............x.x.' },
  },
  sections: {
    A: { chords: 'G Em C D G C G:2 D:2 G', horns: SK_A, drums: 'skaAx skaA*6 skaF', mute: ['sax'] },
    B: { chords: 'G C D D C Am D G', horns: SK_B, sax: SK_B.replace('o5', 'o4'), drums: 'punkx punk*6 skaF', pat: { skank: 'x.x.x.x.x.x.x.x.', bass: 'R.R.R.R.R.R.R.R.' } },
  },
  form: ['A', 'A', 'B', 'A', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// CHIPTUNE - "Arona's 8-Bit Rally"
// ------------------------------------------------------------------------------------------------------------
const CH_A =
  'o5 e8 g8 > c8 < g8 e8 g8 > c8 e8 | d8 c8 < a8 e8 a4 r4 | f8 a8 > c8 < a8 f8 a8 > c8 f8 | e8 d8 < b8 g8 b4 r4 |' +
  ' e8 g8 > c8 < g8 e8 g8 > c8 e8 | g8 e8 c8 < a8 > c4 r4 | d8 f8 a8 f8 d8 e8 f8 a8 | g4 f4 e4 d4 |';
const CH_B = 'o5 c4 e8 g8 > c4 < b4 | a4 g8 e8 g2 | f4 a8 > c8 f4 e4 | d2 < b4 g4 | a4 > c8 e8 a4 g4 | f4 e8 d8 e4 c4 | d4 c4 < b4 > d4 | c1 |';
const chiptune = {
  name: "Arona's 8-Bit Rally",
  gain: 1.15, // level trim (offline level report)
  bpm: 160,
  reverb: 0.08,
  delay: { beats: 0.375, fb: 0.25, mix: 0.18 },
  tracks: {
    lead: { inst: 'chip', duty: 0.25, vol: 0.14, vib: 10, dly: 0.15 },
    echo: { inst: 'chip', duty: 0.125, vol: 0.065, pan: 0.3 },
    arp: { inst: 'chip', gen: 'arp', pattern: '0123012301230123', center: 72, duty: 0.5, vol: 0.045, pan: -0.3, gate: 0.5 },
    bass: { inst: 'triBass', gen: 'bass', pattern: 'R.R.O.R.R.R.O.R.', oct: 2, vol: 0.42 },
    drums: { kit: 'chip', vol: 0.5 },
  },
  patterns: {
    c8: { k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    c8x: { k: 'x.....x.x.......', s: '....x.......x...', h: '..x.x.x.x.x.x.x.', x: 'X...............' },
    c8B: { k: 'x...x...x...x...', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
    c8F: { k: 'x.....x.........', s: '....x...xxxxXXXX' },
  },
  sections: {
    A: { chords: 'C Am F G C Am Dm G', lead: CH_A, drums: 'c8x c8*6 c8F', mute: ['echo'] },
    B: { chords: 'C C F G Am F G C', lead: CH_B, echo: CH_B.replace('o5', 'o4'), drums: 'c8x c8B*6 c8F', pat: { arp: '0.1.2.3.2.1.0.1.' } },
  },
  form: ['A', 'B', 'A', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// LOUNGE - "Schale Office Bossa"
// ------------------------------------------------------------------------------------------------------------
const LO_A = 'o5 f+4. e8 d4 c+4 | d2 r4 < b4 | > e4. d8 c+4 < b4 | a2. r4 | > g4. f+8 e4 d4 | c+4 e4 a4 g4 | f+2. e4 | e2. r4 |';
const LO_B = 'o5 b4. a8 g4 f+4 | b-2. g4 | a4. g8 f+4 e4 | d+2 f+4 a4 | g4. f+8 e4 d4 | c+4 d4 e4 g4 | f+1 | r1 |';
const lounge = {
  name: 'Schale Office Bossa',
  gain: 1.05, // level trim (offline level report)
  bpm: 128,
  reverb: 0.3,
  delay: { beats: 0.75, fb: 0.2, mix: 0.15 },
  tracks: {
    lead: { inst: 'flute', vol: 0.15, rev: 0.3, vib: 16, breath: 0.5 },
    vibes: { inst: 'mallet', trem: 5, decay: 1.0, partial: 4, bright: 0.2, vol: 0.09, rev: 0.3, pan: 0.3 },
    keys: { inst: 'epiano', gen: 'pad', pattern: 'x..x..x...x..x..', center: 62, vol: 0.08, gate: 0.55, pan: -0.2, rev: 0.2 },
    nylon: { inst: 'pluck', gen: 'arp', pattern: '0...1.2...1.2.1.', center: 57, vol: 0.05, bright: 2400, decay: 0.45, rev: 0.2, pan: 0.2 },
    bass: { inst: 'triBass', gen: 'bass', pattern: 'R-----5-R-----5-', oct: 2, vol: 0.4 },
    drums: { kit: 'jazz', vol: 0.34, rev: 0.12 },
  },
  patterns: {
    bossa: { k: 'x.....x.x.....x.', rim: 'x..x..x...x..x..', sh: 'x.xxx.xxx.xxx.xx' },
    bossaE: { k: 'x.....x.x.....x.', rim: 'x..x..x...x..x..', sh: 'x.xxx.xxx.xxx.xx', r: 'x...............' },
  },
  sections: {
    A: { chords: 'Dmaj7 Em7 F#m7 B7 Em7 A7 Dmaj7 A7', lead: LO_A, drums: 'bossaE bossa*7', mute: ['vibes'] },
    B: { chords: 'Gmaj7 Gm6 F#m7 B7 Em7 A7 Dmaj7 Dmaj7', lead: LO_B.replace('o5', 'o4'), vibes: LO_B, drums: 'bossaE bossa*7' },
  },
  form: ['A', 'B', 'A', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// ONLINE - "Link Start!" (future funk)
// ------------------------------------------------------------------------------------------------------------
const ON_A =
  'o5 g8 f8 d8 f8 r8 g8 b-8 g8 | f4 d8 c8 d4 < a4 | > c8 d8 e-8 g8 r8 f8 e-8 c8 | d4. c8 < a2 |' +
  ' > g8 f8 d8 f8 r8 g8 b-8 > d8 | c4 < a8 f8 a4 r4 | b-8 a8 g8 f8 e8 g8 b-8 > c8 | < a2. r4 |';
const ON_B = 'o5 g4 b-8 a8 g4 e-4 | f4 a8 g8 f4 c4 | d4 f8 e-8 d8 c8 < b-4 | > d2 g4 f4 | e-4 g8 f8 e-4 c4 | f8 g8 a8 > c8 < a4 f4 | b-4 d4 f4 a4 | b-2. r4 |';
const online = {
  name: 'Link Start!',
  gain: 1.15, // level trim (offline level report)
  bpm: 118,
  swing16: 0.55,
  reverb: 0.25,
  delay: { beats: 0.75, fb: 0.3, mix: 0.25 },
  tracks: {
    lead: { inst: 'square', detune: 6, vib: 12, lp: 3200, vol: 0.1, dly: 0.25, rev: 0.15, a: 0.005, d: 0.2, s: 0.6 },
    keys: { inst: 'epiano', gen: 'pad', pattern: 'x..x..x...x.x...', center: 63, vol: 0.08, gate: 0.5, pan: -0.25, rev: 0.15 },
    strings: { inst: 'strings', gen: 'pad', pattern: 'sus', center: 67, vol: 0.04, rev: 0.4 },
    bass: { inst: 'slapBass', gen: 'bass', pattern: 'R.Rr.OR.R.r.O.5.', oct: 2, vol: 0.34 },
    drums: { kit: 'pop', vol: 0.48, rev: 0.1 },
  },
  patterns: {
    house: { k: 'x...x...x...x...', c: '....x.......x...', o: '..x...x...x...x.', h: 'x.x.x.x.x.x.x.x.' },
    housex: { k: 'x...x...x...x...', c: '....x.......x...', o: '..x...x...x...x.', h: 'x.x.x.x.x.x.x.x.', x: 'X...............' },
    funk: { k: 'x..x..x...x..x..', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx', o: '..............x.' },
    funkF: { k: 'x..x..x.........', s: '....x...x.xxxXxX' },
  },
  sections: {
    A: { chords: 'Ebmaj7 Dm7 Cm7 F7 Ebmaj7 Dm7 Gm7:2 C7:2 F7', lead: ON_A, drums: 'housex house*6 funkF', mute: ['strings'] },
    B: { chords: 'Cm7 F7 Bbmaj7 Gm7 Cm7 F7 Bbmaj7 Bbmaj7', lead: ON_B, drums: 'funk*7 funkF' },
  },
  form: ['A', 'B', 'A', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// TOURNAMENT - "Road to the Kivotos Cup"
// ------------------------------------------------------------------------------------------------------------
const TO_A = 'o4 g4. a8 b4 > d4 | c4 < b8 a8 b2 | a4. b8 > c4 e4 | d2. r4 | e4. d8 c4 < b4 | a4 b8 > c8 d4 g4 | f+4 e4 d4 c4 | d1 |';
const TO_B = 'o5 g4. f+8 e4 d4 | e4 d8 c8 < b2 | > c4. d8 e4 g4 | f+2 d2 | g4. a8 b4 g4 | e4 f+8 g8 a4 f+4 | g4 d4 e4 f+4 | g1 |';
const tournament = {
  name: 'Road to the Kivotos Cup',
  bpm: 112,
  reverb: 0.32,
  delay: { beats: 0.5, fb: 0.2, mix: 0.12 },
  tracks: {
    lead: { inst: 'brass', vol: 0.15, rev: 0.25 },
    strings: { inst: 'strings', vol: 0.08, rev: 0.35, pan: -0.15 },
    bell: { inst: 'bell', gen: 'arp', pattern: '0...1...2...1...', center: 79, vol: 0.06, rev: 0.3, dly: 0.2, pan: 0.25, decay: 0.8 },
    pad: { inst: 'strings', gen: 'pad', pattern: 'sus', center: 60, vol: 0.05, rev: 0.4 },
    bass: { inst: 'triBass', gen: 'bass', pattern: 'R-------5-------', oct: 2, vol: 0.38 },
    timp: { inst: 'timpani', gen: 'bass', pattern: 'R...........R.R.', oct: 2, vol: 0.2, rev: 0.25 },
    drums: { kit: 'orch', vol: 0.42, rev: 0.22 },
  },
  patterns: {
    march: { k: 'x.......x.......', s: 'x..xx.x.x..xx.x.' },
    marchx: { k: 'x.......x.......', s: 'x..xx.x.x..xx.x.', x: 'X...............' },
    marchF: { k: 'x.......x.......', s: 'x.x.x.x.RRRRRRRR', x: '...............X' },
  },
  sections: {
    A: { chords: 'G C Am D C G D7 D7', lead: TO_A, drums: 'marchx march*6 marchF', mute: ['strings'] },
    B: { chords: 'G C Am D G Em C:2 D:2 G', lead: TO_B, strings: TO_B.replace('o5', 'o4'), drums: 'marchx march*6 marchF' },
  },
  form: ['A', 'B', 'A', 'B'],
  loop: 0,
};

export const EXTRA_SONGS = { eurobeat, highway, ska, chiptune, lounge, online, tournament };
