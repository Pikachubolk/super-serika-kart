// Super Serika Kart - original soundtrack (owner: audio agent). All compositions are original.
// Format: see notation.js. Every section is 8 bars unless noted; '|' marks are checked bar lengths.
//
//  key         style                                         key / tempo
//  title       heroic main theme (fanfare intro)             D major, 152
//  menu        bouncy shuffle                                F major, 126
//  charselect  jazzy funk (ii-V, tritone subs)               Bb major, 112
//  results     relaxed lo-fi vibes                           G major, 92
//  victory     fanfare -> happy loop                         C major, 144
//  defeat      sad-cute music box                            A minor, 84
//  trophy      grand brass fanfare                           Eb major, 104
//  abydos      desert adventure, phrygian dominant           E phr.dom / A minor, 150
//  shibaseki   sunset city funk                              Eb major, 106
//  trinity     bright bells, orchestral                      A major, 132
//  millennium  synthwave / electro                           C minor, 124
//  hyakkiyako  Japanese festival (hirajoshi / yo)            D minor / F, 140
//  redwinter   minor march with bells                        G minor, 124
//  gehenna     hard-rock / metal chiptune                    E minor, 172
//  arona       dreamy sparkly "sky road"                     E major, 162
//  race        default circuit theme (title motif, rock)     A major, 156

import { EXTRA_SONGS } from './songsExtra.js';

// ------------------------------------------------------------------------------------------------------------
// shared drum patterns (1 char = one 16th; X accent, x hit, o ghost, R 32nd roll)
// ------------------------------------------------------------------------------------------------------------
const ROCK = {
  rockA: { k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  rockAx: { k: 'x.....x.x.......', s: '....x.......x...', h: '..x.x.x.x.x.x.x.', x: 'X...............' },
  rockB: { k: 'x.....x.x.x.....', s: '....x.......x..o', h: 'x.x.x.x.x.x.x...', o: '..............x.' },
  rockBx: { k: 'x.....x.x.x.....', s: '....x.......x..o', h: '..x.x.x.x.x.x...', o: '..............x.', x: 'X...............' },
  fill1: { k: 'x.......x.......', s: '....x...x.xxXxXX', h: 'x.x.x.x.........' },
  fillT: { k: 'x.....x.........', s: '....x...........', t: '........xx......', m: '..........xx....', f: '............xXxX' },
  half: { k: 'x.........x.....', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' },
  halfx: { k: 'x.........x.....', s: '........x.......', h: '..x.x.x.x.x.x.x.', x: 'X...............' },
};

// ------------------------------------------------------------------------------------------------------------
// TITLE - "Super Serika Kart!" (main theme)
// ------------------------------------------------------------------------------------------------------------
const T_VERSE =
  'o4 r8 a8 > d8 e8 f+8 e8 d8 < a8 | b4 a8 b8 > d4 < b4 | r8 g8 b8 > d8 g4 f+8 e8 | f+4 e4 c+4 < a4 |' +
  ' r8 a8 > d8 e8 f+8 a8 f+8 e8 | d4 e8 f+8 d4 < b4 | > e4 d8 e8 g4 f+8 e8 | e4 c+8 e8 a4 g4 |';
const T_CHORUS =
  'o5 f+4 g8 a8 b4. a8 | a4 g8 f+8 e4 c+8 e8 | f+4. e8 f+8 a8 > c+4 | < b2 r8 a8 b8 > d8 |' +
  ' e4 d8 c+8 < b4 a8 b8 | > c+4 < b8 a8 g4 e8 g8 | f+4 a4 > d4. c+8 | d2. r4 |';
const T_BRIDGE = 'o5 f+2 d4 f+4 | g2. a4 | a2 f+4 d4 | e1 | f+2 b4 a4 | g4 f+4 g4 b4 | b2 a4 g4 | a2 g4 e4 |';

const TITLE_SECTIONS = {
  intro: {
    chords: 'Bb:2 C:2 D',
    lead: 'o5 f8. f16 b-8 > d8 c8. c16 e8 g8 | f+2. r4 |',
    brass: 'o5 d8. d16 f8 b-8 g8. g16 > c8 e8 | d2. r4 |',
    bass: 'o1 b-8. b-16 b-8 b-8 > c8. c16 c8 c8 | d2. r4 |',
    drums: 'introA introB',
    mute: ['stab', 'bell', 'gtr'],
  },
  A: {
    chords: 'D Bm G A D Bm Em7 A7',
    lead: T_VERSE,
    drums: 'rockAx rockA*6 fill1',
    mute: ['bell'],
  },
  B: {
    chords: 'Gmaj7 A7 F#m7 Bm7 Gmaj7 A7 D Bm7:2 A7:2',
    lead: T_CHORUS,
    brass: T_CHORUS.replace('o5', 'o4'),
    pat: { bass: 'R--RR-O-R--RR-A-' },
    drums: 'rockBx rockB*6 fillT',
    mute: ['stab'],
  },
  C: {
    chords: 'Bm G D A Bm G Em7 A7sus4:2 A7:2',
    lead: T_BRIDGE,
    bell: T_BRIDGE.replace('o5', 'o6'),
    pat: { bass: 'R-------R---5---', stab: 'x-------........' },
    drums: 'halfx half*6 fill1',
  },
};

const title = {
  name: 'Super Serika Kart! (Main Theme)',
  bpm: 152,
  reverb: 0.22,
  delay: { beats: 0.75, fb: 0.28, mix: 0.3 },
  tracks: {
    lead: { inst: 'pulse', duty: 0.25, detune: 7, vib: 16, vol: 0.2, rev: 0.15, dly: 0.16, d: 0.3, s: 0.7 },
    brass: { inst: 'brass', vol: 0.13, rev: 0.2, pan: -0.15 },
    bell: { inst: 'bell', gen: 'arp', pattern: '0..1..2.3..2..1.', center: 79, vol: 0.08, rev: 0.25, dly: 0.25, pan: 0.25, index: 1.4, decay: 0.9 },
    stab: { inst: 'brass', gen: 'pad', pattern: '..x-..x-..x-..x-', center: 64, vol: 0.055, pan: 0.2, a: 0.01, swell: 0.03 },
    pad: { inst: 'strings', gen: 'pad', pattern: 'sus', center: 62, vol: 0.055, rev: 0.3 },
    bass: { inst: 'sawBass', gen: 'bass', pattern: 'R-R-O-R-R-R-O-R-', oct: 2, vol: 0.32, lp: 420, fenv: 1600 },
    drums: { kit: 'rock', vol: 0.55, rev: 0.08 },
  },
  patterns: {
    ...ROCK,
    introA: { k: 'x.......x.......', s: 'o.o.o.o.x.x.xxXX', x: 'X...............' },
    introB: { k: 'X...............', x: 'X...............', t: '............x.x.', m: '.............x.x' },
  },
  sections: TITLE_SECTIONS,
  form: ['intro', 'A', 'B', 'C', 'B'],
  loop: 1,
};

// default race theme: the main theme re-arranged as a rock circuit track in A major
const race = {
  name: 'Serika Circuit',
  bpm: 156,
  transpose: -5,
  reverb: 0.18,
  delay: { beats: 0.75, fb: 0.3, mix: 0.3 },
  tracks: {
    lead: { inst: 'pulse', duty: 0.25, detune: 8, vib: 18, vol: 0.19, rev: 0.12, dly: 0.2 },
    brass: { inst: 'guitar', vib: 20, vol: 0.1, fx: { drive: 12, lp: 4200, post: 0.3 }, pan: -0.2 },
    bell: { inst: 'bell', gen: 'arp', pattern: '0.1.2.3.2.1.0.1.', center: 84, vol: 0.06, dly: 0.25, rev: 0.2, pan: 0.3, decay: 0.6 },
    gtr: { inst: 'guitar', gen: 'pad', power: true, oct: 3, pattern: 'x.x.x.x.x.x.x.xx', palm: true, vol: 0.1, fx: { drive: 26, lp: 3400, post: 0.28, hp: 90 }, pan: 0.18 },
    pad: { inst: 'pad', gen: 'pad', pattern: 'sus', center: 64, vol: 0.035, lp: 1800, rev: 0.3 },
    bass: { inst: 'sawBass', gen: 'bass', pattern: 'R-R-R-R-R-R-O-R-', oct: 2, vol: 0.3, lp: 450, fenv: 1400 },
    drums: { kit: 'rock', vol: 0.55, rev: 0.08 },
  },
  patterns: {
    ...ROCK,
    rockA: { k: 'x.....x.x.x.....', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
    rockAx: { k: 'x.....x.x.x.....', s: '....x.......x...', h: '.xxxxxxxxxxxxxxx', x: 'X...............' },
  },
  sections: TITLE_SECTIONS,
  form: ['A', 'B', 'C', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// MENU - bouncy shuffle
// ------------------------------------------------------------------------------------------------------------
const M_A =
  'o5 c8 f8 a8 f8 > c4 < a8 f8 | a8 g8 f8 d8 f4 r4 | b-8 a8 g8 d8 g4 b-8 > d8 | c4 < b-8 g8 e4 r4 |' +
  ' c8 f8 a8 > c8 f4 e8 c8 | d4 c8 < a8 f4 d4 | g8 a8 b-8 > c8 d8 c8 < b-8 g8 | f4 a4 f4 r4 |';
const M_B =
  'o5 d4. c8 d8 f8 a4 | g4 e8 c8 e4 r4 | f4. d8 f8 a8 > c4 | < b-2 g4 r4 |' +
  ' a4. f8 a8 > c8 d4 | c+4 < a8 e8 g4 e4 | f8 e8 d8 c8 < b8 > d8 f8 a8 | g8 a8 b-8 g8 e8 c8 d8 e8 |';
const menuA = { chords: 'F Dm7 Gm7 C7 F Dm7 Gm7:2 C7:2 F', lead: M_A, drums: 'bounce*7 bounceF', mute: ['mallet'] };
const menu = {
  name: 'Kivotos Lounge',
  gain: 0.94, // level trim (offline level report)
  bpm: 126,
  swing: 0.6,
  reverb: 0.2,
  tracks: {
    lead: { inst: 'pulse', duty: 0.5, lp: 2600, vib: 10, vol: 0.15, dly: 0.12, rev: 0.12, d: 0.2, s: 0.55 },
    mallet: { inst: 'mallet', gen: 'arp', pattern: '0.1.2.3.4.3.2.1.', center: 72, vol: 0.13, decay: 0.45, bright: 0.5, rev: 0.15, pan: 0.3 },
    keys: { inst: 'epiano', gen: 'pad', pattern: '..x...x...x...x.', center: 62, vol: 0.07, pan: -0.2, gate: 0.5 },
    bass: { inst: 'triBass', gen: 'bass', pattern: 'R-.RO-..R-.R5-.A', oct: 2, vol: 0.45 },
    drums: { kit: 'pop', vol: 0.42 },
  },
  patterns: {
    bounce: { k: 'x.......x.......', c: '....x.......x...', sh: 'x.x.x.x.x.x.x.x.' },
    bounceF: { k: 'x.......x.......', c: '....x...........', sh: 'x.x.x.x.x.x.....', t: '............x.x.', m: '.............x.x' },
  },
  sections: {
    A: menuA,
    B: { chords: 'Bbmaj7 Am7 Gm7 C7 Bbmaj7 A7 Dm7:2 G7:2 Gm7:2 C7:2', lead: M_B, drums: 'bounce*7 bounceF' },
    A2: { ...menuA, mallet: M_A, mute: [] },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// CHARACTER SELECT - jazzy funk
// ------------------------------------------------------------------------------------------------------------
const C_A =
  'o5 r8 g8 b-8 > d8 c8 < b-8 g4 | a4 f8 a8 r8 g8 a8 > c8 | < b-4. g8 e-8 c8 e-8 g8 | f4 a8 > c8 e-4 r4 |' +
  ' d8 e-8 d8 < b-8 g4 b-8 > d8 | c4 < a8 f8 a4 r4 | b-8 a8 g8 f8 e8 g8 b-8 > d8 | c2 < a4 r4 |';
const C_B =
  'o5 r8 d8 f8 a8 b-4 a8 f8 | g4 e8 g8 b-4 g4 | a2 e8 f8 a8 > c8 | d2 r4 c8 d8 |' +
  ' < b-4 g8 e8 d4 e8 g8 | c+4 e8 g8 b-4 a4 | f8 e8 d8 c8 < b8 a-8 f8 e-8 | > e-4 g8 b-8 > c4 < a4 |';
const csA = { chords: 'Ebmaj7 Dm7 Cm7 F7 Ebmaj7 Dm7 Gm7:2 C7:2 F7sus4:2 F7:2', lead: C_A, drums: 'funk*7 funkF' };
const charselect = {
  name: 'Choose Your Student',
  gain: 1.5, // level trim (offline level report)
  bpm: 112,
  swing16: 0.57,
  reverb: 0.2,
  delay: { beats: 0.5, fb: 0.25, mix: 0.25 },
  tracks: {
    lead: { inst: 'saw', lp: 2200, q: 2, fenv: 1200, fdecay: 0.25, glide: 0.06, vib: 14, vol: 0.13, rev: 0.12, dly: 0.12, s: 0.6 },
    vibes: { inst: 'mallet', trem: 5, decay: 1.1, partial: 4, bright: 0.2, vol: 0.13, rev: 0.25, pan: 0.3 },
    keys: { inst: 'epiano', gen: 'pad', pattern: 'x..x..x...x..x..', center: 63, vol: 0.085, gate: 0.6, pan: -0.25 },
    bass: { inst: 'slapBass', gen: 'bass', pattern: 'R.rR..O.R.rR.5O.', oct: 2, vol: 0.34 },
    drums: { kit: 'jazz', vol: 0.5 },
  },
  patterns: {
    funk: { k: 'x..x......x..x..', s: '....x..o.o..x...', h: 'xoxoxoxoxoxoxoxo' },
    funkF: { k: 'x..x......x.....', s: '....x..o.o..xoxX', h: 'xoxoxoxoxoxo....' },
  },
  sections: {
    A: csA,
    B: { chords: 'Gm7 C7 Fmaj7 Bbmaj7 Em7b5 A7 Dm7:2 Db7:2 Cm7:2 F7:2', lead: C_B, drums: 'funk*7 funkF', pat: { keys: '..x..x....x..x..' } },
    A2: { ...csA, vibes: C_A },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// RESULTS - relaxed
// ------------------------------------------------------------------------------------------------------------
const R_A =
  'o5 b4. a8 b4 > d4 | e2 r4 d8 e8 | c2 < a4 g8 a8 | f+2. r4 | g4. f+8 g4 b4 | > d2 < b8 a8 g4 | e4. f+8 g4 b4 | a2 f+2 |';
const R_B =
  'o5 e4 g4 b4. a8 | f+2 d4 f+8 a8 | g4 e4 c4 e4 | d2. r4 | g4. b8 > d4 c8 < b8 | a4 f+4 d+4 f+4 | g4 e4 c+4 e4 | c4 < a4 > c4 d4 |';
const resA = { chords: 'Gmaj7 Em7 Am7 D7 Gmaj7 Em7 Cmaj7 D7sus4:2 D7:2', lead: R_A, drums: 'chill*7 chillF' };
const results = {
  name: 'After-School Tea Time',
  bpm: 92,
  swing: 0.62,
  reverb: 0.3,
  delay: { beats: 0.75, fb: 0.3, mix: 0.25 },
  tracks: {
    lead: { inst: 'mallet', trem: 5.5, decay: 1.3, partial: 4, bright: 0.15, vol: 0.24, rev: 0.3, dly: 0.15 },
    flute: { inst: 'flute', vol: 0.09, rev: 0.3, breath: 0.4, vib: 14 },
    keys: { inst: 'epiano', gen: 'pad', pattern: 'x.....x...x.....', center: 60, vol: 0.085, gate: 0.9, rev: 0.2 },
    pad: { inst: 'pad', gen: 'pad', pattern: 'sus', center: 64, vol: 0.03, lp: 1200, rev: 0.3 },
    bass: { inst: 'triBass', gen: 'bass', pattern: 'R-----..5-....A-', oct: 2, vol: 0.42 },
    drums: { kit: 'jazz', vol: 0.38 },
  },
  patterns: {
    chill: { k: 'x.........x.....', sn: '....x.......x...', sh: 'x.x.x.x.x.x.x.x.' },
    chillF: { k: 'x.........x.....', sn: '....x.......x...', sh: 'x.x.x.x.x.x.x.x.', t: '..............x.' },
  },
  sections: {
    A: resA,
    B: { chords: 'Cmaj7 Bm7 Am7 D7 Cmaj7 B7 Em7:2 A7:2 Am7:2 D7:2', lead: R_B, drums: 'chill*7 chillF' },
    A2: { ...resA, flute: R_A },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// VICTORY - fanfare then happy loop
// ------------------------------------------------------------------------------------------------------------
const V_A =
  'o5 c8 e8 g8 e8 c8 e8 g8 a8 | > c4 < a8 e8 a4 e4 | f8 a8 > c8 < a8 f8 a8 > c8 e8 | d4 < b8 g8 b4 > d4 |' +
  ' < c8 e8 g8 e8 c8 e8 g8 > c8 | < b4 a8 e8 a4 > c4 | d4 < a8 f8 g8 b8 > d8 f8 | e4 c4 < g4 r4 |';
const V_B = 'o5 a4. g8 f4 a4 | b4. a8 g4 b4 | g4. a8 b4 > e4 | c2 < a2 | a4. g8 f4 d4 | g4. a8 b4 > d4 | f2 e2 | d4 < b4 g4 f4 |';
const victory = {
  name: 'Victory Lap!',
  bpm: 144,
  reverb: 0.22,
  tracks: {
    lead: { inst: 'pulse', duty: 0.25, detune: 6, vib: 14, vol: 0.18, dly: 0.15, rev: 0.15 },
    brass: { inst: 'brass', vol: 0.13, rev: 0.2, pan: -0.2 },
    bell: { inst: 'bell', gen: 'arp', pattern: '0.1.2.3.2.1.0.1.', center: 76, vol: 0.065, dly: 0.2, rev: 0.2, pan: 0.25, decay: 0.7 },
    stab: { inst: 'epiano', gen: 'pad', pattern: '..x...x...x...x.', center: 64, vol: 0.075, gate: 0.5 },
    bass: { inst: 'sawBass', gen: 'bass', pattern: 'R-O-R-O-R-O-5-O-', oct: 2, vol: 0.3 },
    drums: { kit: 'pop', vol: 0.5 },
  },
  patterns: {
    vicIntro: { k: 'x...x...x...x...', s: 'X...x...x.x.xxxx', x: 'X...............' },
    vicIntro2: { k: 'X...............', x: 'X...............', s: '............xxXX' },
    vic: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.' },
    vicx: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.', x: 'X...............' },
    vicF: { k: 'x...x...x...x...', s: '....x...x.x.xxXX', h: '..x...x.........' },
  },
  sections: {
    intro: {
      chords: 'C:2 F:2 C',
      lead: 'o5 {g g g}4 > c4 < a8. b16 > c8 d8 | e2. r4 |',
      brass: 'o5 {e e e}4 e4 f8. f16 f8 a8 | g2. r4 |',
      bass: 'o2 c4 c4 f4 f4 | c2. r4 |',
      drums: 'vicIntro vicIntro2',
      mute: ['bell', 'stab'],
    },
    A: { chords: 'C Am F G C Am Dm7:2 G7:2 C', lead: V_A, drums: 'vicx vic*6 vicF', mute: ['bell'] },
    B: { chords: 'F G Em Am Dm G Csus4:2 C:2 G7', lead: V_B, brass: V_B.replace('o5', 'o4'), drums: 'vicx vic*6 vicF' },
  },
  form: ['intro', 'A', 'B'],
  loop: 1,
};

// ------------------------------------------------------------------------------------------------------------
// DEFEAT - sad but cute
// ------------------------------------------------------------------------------------------------------------
const D_A = 'o5 e4 a4 g8 e8 c4 | d4 f4 e8 d8 < a4 | b4 > d4 c8 < b8 g+4 | a2. r4 | > c4 f4 e8 f8 a4 | g4 f4 e8 d8 f4 | e4 a4 g+4 b4 | a2 r2 |';
const D_B = 'o5 a4. g8 f4 c4 | d4. e8 d4 < b4 | > e4 g4 f+8 e8 < b4 | > c2. r4 | d4 f4 a4 f4 | g4 d4 < b4 > d4 | e4 g4 > c4 < g4 | g+4 b4 e4 d4 |';
const defeat = {
  name: 'Maybe Next Time...',
  bpm: 84,
  swing: 0.58,
  reverb: 0.35,
  tracks: {
    lead: { inst: 'mallet', partial: 5.4, bright: 0.3, decay: 1.0, vol: 0.24, rev: 0.35, dly: 0.12 },
    soft: { inst: 'pulse', duty: 0.5, lp: 1400, vol: 0.05, vib: 12, a: 0.03, rev: 0.3 },
    counter: { inst: 'bell', vol: 0.08, decay: 1.2, rev: 0.4, pan: 0.3, index: 1.2 },
    pad: { inst: 'pad', gen: 'pad', pattern: 'sus', center: 60, vol: 0.035, lp: 1000, rev: 0.4 },
    bass: { inst: 'triBass', gen: 'bass', pattern: 'R-------5-------', oct: 2, vol: 0.36 },
    drums: { kit: 'jazz', vol: 0.3 },
  },
  patterns: {
    sad: { k: 'x.........x.....', sn: '........x.......', sh: '..x...x...x...x.' },
  },
  sections: {
    intro: { chords: 'F:2 E:2 Am', lead: 'o5 a8 g8 f4 g+8 b8 e4 | c2 < a2 |', soft: 'o5 a8 g8 f4 g+8 b8 e4 | c2 < a2 |' },
    A: {
      chords: 'Am Dm/F E7 Am F Dm E7sus4:2 E7:2 Am',
      lead: D_A,
      soft: D_A,
      counter: 'o6 r1 | r1 | r1 | r2 c8 < b8 a8 e8 | r1 | r1 | r1 | r2 e8 g+8 b8 > e8 |',
      drums: 'sad*8',
    },
    B: { chords: 'F G Em Am Dm G C E7', lead: D_B, drums: 'sad*8' },
  },
  form: ['intro', 'A', 'B'],
  loop: 1,
};

// ------------------------------------------------------------------------------------------------------------
// TROPHY - grand fanfare
// ------------------------------------------------------------------------------------------------------------
const TR_A = 'o5 g4. a-8 b-4 > e-4 | d4. c8 < b-2 | > c4. d8 e-4 g4 | f2 d2 | e-4. f8 e-4 c4 | < b-4. > c8 < b-4 g4 | a-4 > c4 d4 f4 | e-2. r4 |';
const TR_B = 'o5 g2 e-4 g4 | a-2 > c2 | < b-2 g4 b-4 | > d1 | e-2 d4 c4 | c2 < a-4 > c4 | f2. e-4 | e-2 d2 |';
const trophy = {
  name: 'The Shittim Cup',
  bpm: 104,
  reverb: 0.35,
  tracks: {
    lead: { inst: 'brass', vol: 0.16, rev: 0.3, harm: 8, vib: 12 },
    brass2: { inst: 'brass', vol: 0.1, rev: 0.3, pan: -0.25 },
    glock: { inst: 'bell', index: 1.6, decay: 0.9, vol: 0.065, rev: 0.35, pan: 0.3 },
    strings: { inst: 'strings', gen: 'pad', pattern: 'sus', center: 63, vol: 0.065, rev: 0.4 },
    choir: { inst: 'choir', gen: 'pad', pattern: 'sus', center: 67, vol: 0.05, rev: 0.4 },
    timp: { inst: 'timpani', gen: 'bass', pattern: 'R.......R...R.R.', oct: 2, vol: 0.32, rev: 0.2 },
    bass: { inst: 'triBass', gen: 'bass', pattern: 'R-------R-------', oct: 2, vol: 0.3 },
    drums: { kit: 'orch', vol: 0.45, rev: 0.25 },
  },
  patterns: {
    tI1: { k: 'X...............', x: 'X...............', s: '........RRRRRRRR' },
    tI2: { k: 'x.......x.......', s: 'x.......x.......' },
    tI4: { k: 'x...x...x...x...', s: 'RRRRRRRRRRRRXXXX' },
    trA: { k: 'x.......x.......', s: '....x.......x..o' },
    trAx: { k: 'x.......x.......', s: '....x.......x..o', x: 'X...............' },
    trF: { k: 'x.......x.......', s: '....x...RRRRRRRR' },
  },
  sections: {
    intro: {
      chords: 'Eb Ab Eb/G Bb7',
      lead: 'o5 {b- b- b-}4 > e-2. | c4. < b-8 a-4 > c4 | < b-4. a-8 g4 b-4 | a-2 f2 |',
      brass2: 'o5 {g g g}4 b-2. | a-4. g8 e-4 a-4 | g4. f8 e-4 g4 | f2 d2 |',
      drums: 'tI1 tI2 tI2 tI4',
      mute: ['choir'],
    },
    A: { chords: 'Eb Bb/D Cm Gm/Bb Ab Eb/G Fm7:2 Bb7:2 Eb', lead: TR_A, glock: TR_A.replace('o5', 'o6'), drums: 'trAx trA*6 trF', mute: ['choir'] },
    B: { chords: 'Cm Ab Eb Bb Cm Ab Fm7 Bb7sus4:2 Bb7:2', lead: TR_B, brass2: TR_B.replace('o5', 'o4'), drums: 'trAx trA*6 trF' },
  },
  form: ['intro', 'A', 'B'],
  loop: 1,
};

// ------------------------------------------------------------------------------------------------------------
// ABYDOS - desert adventure (E phrygian dominant / A minor)
// ------------------------------------------------------------------------------------------------------------
const AB_A =
  'o5 e8 f8 g+8 a8 b4 a8 g+8 | a8 g+8 f8 e8 f4 r8 e8 | e8 g+8 b8 > c8 < b8 a8 g+8 f8 | e4 d8 f8 a4 g+4 |' +
  ' b8 > c8 < b8 a8 g+8 a8 b8 > d8 | c4 < a8 > c8 < a4 f4 | g8 a8 b8 g8 a8 g8 f8 a8 | g+2 e2 |';
const AB_B = 'o5 a4. b8 > c4 < a4 | f4. e8 d4 f4 | g4. a8 b4 g4 | > c2. < b8 a8 | a4. g8 f4 a4 | f4. e8 d4 f4 | g+4 b4 > d4 c4 | < b2 g+4 f4 |';
const abA = { chords: 'E F E Dm/E E F G:2 F:2 E', lead: AB_A, drums: 'desertx desert*6 desertF' };
const abydos = {
  name: 'Sands of Abydos',
  gain: 0.9, // level trim (offline level report)
  bpm: 150,
  reverb: 0.22,
  delay: { beats: 0.75, fb: 0.3, mix: 0.3 },
  tracks: {
    lead: { inst: 'oud', vol: 0.3, rev: 0.15, dly: 0.1, decay: 0.6 },
    lead2: { inst: 'pulse', duty: 0.25, vib: 22, vibRate: 6, vol: 0.15, rev: 0.15, dly: 0.2, glide: 0.04 },
    flute: { inst: 'flute', vol: 0.12, rev: 0.25, vib: 22, breath: 0.6, pan: 0.2 },
    pad: { inst: 'strings', gen: 'pad', pattern: 'sus', center: 60, vol: 0.045, rev: 0.3 },
    arp: { inst: 'pluck', gen: 'arp', pattern: '0.1.2.1.0.1.2.3.', center: 64, vol: 0.055, pan: -0.3, dly: 0.2, decay: 0.3 },
    bass: { inst: 'sawBass', gen: 'bass', pattern: 'R-.RR-.RR-.R5-O-', oct: 2, vol: 0.3 },
    drums: { kit: 'pop', vol: 0.5 },
  },
  patterns: {
    desert: { k: 'x..x..x.x..x..x.', s: '....x.......x...', tb: '..x...x...x...x.', rim: '.x.x...x.x.x...x' },
    desertx: { k: 'x..x..x.x..x..x.', s: '....x.......x...', tb: '..x...x...x...x.', rim: '.x.x...x.x.x...x', x: 'X...............' },
    desertF: { k: 'x..x..x.x.......', s: '....x.......x...', t: '........x.x.....', m: '..........x.x...', f: '............x.xX' },
    desertB: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.', tb: 'x.x.x.x.x.x.x.x.' },
    desertBx: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.', tb: 'x.x.x.x.x.x.x.x.', x: 'X...............' },
  },
  sections: {
    A: abA,
    B: { chords: 'Am Dm G C F Dm E E7', lead: AB_B.replace('o5', 'o4'), lead2: AB_B, drums: 'desertBx desertB*6 desertF', pat: { bass: 'R-R-R-R-R-R-O-R-' } },
    A2: { ...abA, flute: AB_A },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// SHIBASEKI - sunset city funk
// ------------------------------------------------------------------------------------------------------------
const SH_A =
  'o5 r8 e-16 f16 g8 b-8 r16 g16 b-8 > c8 < b-8 | g4 f8 d8 f4. r8 | r8 c16 e-16 f8 a-8 r16 f16 a-8 b-8 a-8 | g4 f8 e-8 d4 r4 |' +
  ' r8 g16 b-16 > d8 < b-8 r16 g16 b-8 > d8 e-8 | d4 c8 < b-8 g4. r8 | a-8 b-8 > c8 e-8 d8 f8 g8 f8 | e-4 c8 < a-8 b-4 > d4 |';
const SH_B = 'o5 f2. e-8 f8 | g2 e-4 g4 | f2. d-8 f8 | g2 b-4 > d-4 | c2. < b-8 > c8 | d2 < b-4 g4 | e-4 g4 a4 > c4 | < a-4 f4 d4 f4 |';
const shA = { chords: 'Abmaj7 Gm7 Fm7 Bb7sus4:2 Bb7:2 Ebmaj7 Cm7 Fm7:2 Gm7:2 Abmaj7:2 Bb7:2', lead: SH_A, drums: 'funkAx funkA*6 funkF', mute: ['brass'] };
const shibaseki = {
  name: 'Shibaseki Sunset Drive',
  gain: 1.25, // level trim (offline level report)
  bpm: 106,
  swing16: 0.55,
  reverb: 0.22,
  delay: { beats: 0.75, fb: 0.32, mix: 0.3 },
  tracks: {
    lead: { inst: 'saw', voices: 2, spread: 8, lp: 2600, q: 1.5, glide: 0.05, vib: 12, vol: 0.13, rev: 0.15, dly: 0.2, a: 0.01, s: 0.75 },
    keys: { inst: 'epiano', gen: 'pad', pattern: 'x..x..x..x..x.x.', center: 63, vol: 0.075, gate: 0.55, pan: -0.2, rev: 0.15 },
    brass: { inst: 'brass', gen: 'pad', pattern: 'X.......X..X....', center: 67, vol: 0.055, pan: 0.2, a: 0.01, gate: 0.4 },
    pad: { inst: 'pad', gen: 'pad', pattern: 'sus', center: 60, vol: 0.03, lp: 1400, rev: 0.3 },
    bass: { inst: 'slapBass', gen: 'bass', pattern: 'R.rR..O.R.r..5O.', oct: 2, vol: 0.34 },
    drums: { kit: 'pop', vol: 0.5 },
  },
  patterns: {
    funkA: { k: 'x..x......x..x..', c: '....x.......x...', h: 'xoxoxoxoxoxoxoxo' },
    funkAx: { k: 'x..x......x..x..', c: '....x.......x...', h: 'xoxoxoxoxoxoxoxo', x: 'X...............' },
    funkF: { k: 'x..x......x.....', c: '....x.......x...', h: 'xoxoxoxoxoxo....', t: '............x.x.', m: '.............x.x' },
    funkB: { k: 'x.........x..x..', c: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '..x...x...x...x.', cb: 'x......x........' },
  },
  sections: {
    A: shA,
    B: { chords: 'Dbmaj7 Cm7 Bbm7 Eb7 Abmaj7 Gm7 Cm7:2 F7:2 Fm7:2 Bb7:2', lead: SH_B, drums: 'funkAx funkB*6 funkF', pat: { bass: 'R--rR-O.R--rR-A.' } },
    A2: { ...shA, mute: [] },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// TRINITY - bright bells, orchestral
// ------------------------------------------------------------------------------------------------------------
const TN_A = 'o5 e4. c+8 e4 a4 | g+2 b4 e4 | f+4. a8 > c+4 < b8 a8 | g+2. e4 | f+4. a8 > d4 c+8 < b8 | a4 e4 c+4 e4 | d4 f+4 a4 b4 | g+2. r4 |';
const TN_B = 'o5 a2 f+4 a4 | b2 g+4 b4 | > c+2 < b4 g+4 | a2 f+2 | f+4 a4 d4 f+4 | g+4 b4 e4 g+4 | a4 > c+4 d4 f+4 | e2 d2 |';
const TN_BS = 'o5 f+2 d4 f+4 | g+2 e4 g+4 | e2 e4 c+4 | f+2 c+2 | d4 f+4 < b4 > d4 | e4 g+4 < b4 > e4 | c+4 e4 f+4 a4 | g+2 f+2 |';
const tnA = { chords: 'A E/G# F#m C#m/E D A/C# Bm7 E7', lead: TN_A, drums: 'orchAx orchA*6 orchF', mute: ['choir'] };
const trinity = {
  name: 'Trinity Garden Bells',
  bpm: 132,
  reverb: 0.32,
  delay: { beats: 0.5, fb: 0.25, mix: 0.2 },
  tracks: {
    lead: { inst: 'bell', index: 1.8, decay: 1.1, vol: 0.22, rev: 0.3, dly: 0.12 },
    strings: { inst: 'strings', vol: 0.085, rev: 0.35, pan: -0.15 },
    harp: { inst: 'pluck', gen: 'arp', pattern: '0123456543210123', center: 64, vol: 0.055, bright: 3500, decay: 0.5, rev: 0.3, pan: 0.3 },
    pad: { inst: 'strings', gen: 'pad', pattern: 'sus', center: 62, vol: 0.045, rev: 0.4 },
    choir: { inst: 'choir', gen: 'pad', pattern: 'sus', center: 67, vol: 0.045, rev: 0.45 },
    bass: { inst: 'triBass', gen: 'bass', pattern: 'R-..R-..R-..5-..', oct: 2, vol: 0.38 },
    timp: { inst: 'timpani', gen: 'bass', pattern: 'R...............', oct: 2, vol: 0.22, rev: 0.2 },
    drums: { kit: 'orch', vol: 0.4, rev: 0.2 },
  },
  patterns: {
    orchA: { k: 'x.......x.......', s: '....x.......x...', tb: '..x...x...x...x.' },
    orchAx: { k: 'x.......x.......', s: '....x.......x...', tb: '..x...x...x...x.', x: 'X...............' },
    orchB: { k: 'x...x...x...x...', s: '....x.......x...', tb: 'x.x.x.x.x.x.x.x.' },
    orchBx: { k: 'x...x...x...x...', s: '....x.......x...', tb: 'x.x.x.x.x.x.x.x.', x: 'X...............' },
    orchF: { k: 'x.......x.......', s: '....x...RRRRRRRR' },
  },
  sections: {
    A: tnA,
    B: { chords: 'D E C#m F#m Bm7 E7 A:2 D:2 E7', lead: TN_B, strings: TN_BS, drums: 'orchBx orchB*6 orchF' },
    A2: { ...tnA, strings: TN_A.replace('o5', 'o4') },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// MILLENNIUM - synthwave / electro
// ------------------------------------------------------------------------------------------------------------
const MI_A = 'o5 g4. e-8 c4 d8 e-8 | c4. < a-8 > c4 e-4 | g4. f8 e-4 b-4 | a-4 g4 f4 d4 | g4. e-8 c4 g4 | a-4. g8 e-4 c4 | f4. g8 a-4 > c4 | < b2 > d2 |';
const MI_B =
  'o5 e-8 f8 g8 a-8 g8 f8 e-8 c8 | d8 e-8 f8 b-8 a-8 g8 f8 d8 | b-8 a-8 g8 d8 g8 b-8 > d8 < b-8 | > c2 < g4 e-4 |' +
  ' a-8 g8 a-8 > c8 e-4 c4 | d8 c8 < b-8 > c8 d4 f4 | e-4 d8 c8 < b4 g4 | f4 d4 < b4 g4 |';
const miA = { chords: 'Cm Ab Eb Bb Cm Ab Fm G', lead: MI_A, drums: 'wavex wave*6 waveF' };
const millennium = {
  name: 'Millennium Neon Grid',
  gain: 1.1, // level trim (offline level report)
  bpm: 124,
  reverb: 0.3,
  delay: { beats: 0.75, fb: 0.38, mix: 0.4 },
  tracks: {
    lead: { inst: 'supersaw', spread: 16, lp: 3800, q: 0.8, vol: 0.12, dly: 0.3, rev: 0.2, a: 0.01, s: 0.8, vib: 8 },
    chip: { inst: 'chip', duty: 0.125, vol: 0.09, dly: 0.25, rev: 0.1, pan: 0.2 },
    arp: { inst: 'saw', gen: 'arp', pattern: '0123012301230123', center: 67, lp: 1800, q: 3, fenv: 1800, fdecay: 0.1, d: 0.1, s: 0.3, vol: 0.055, dly: 0.25, pan: -0.25, gate: 0.6 },
    pad: { inst: 'pad', gen: 'pad', pattern: 'sus', center: 62, vol: 0.045, lp: 2200, rev: 0.4, swell: 1.5 },
    bass: { inst: 'sawBass', gen: 'bass', pattern: 'RrRrRrRrRrRrRrRr', oct: 2, vol: 0.27, lp: 300, fenv: 900, fdecay: 0.08 },
    drums: { kit: 'synth', vol: 0.5, rev: 0.15 },
  },
  patterns: {
    wave: { k: 'x...x...x...x...', s: '....x.......x...', c: '....x.......x...', h: '..x...x...x...x.' },
    wavex: { k: 'x...x...x...x...', s: '....x.......x...', c: '....x.......x...', h: '..x...x...x...x.', x: 'X...............' },
    waveB: { k: 'x...x...x...x...', s: '....x.......x...', c: '....x.......x...', h: 'xoxoxoxoxoxoxoxo', o: '..x...x...x...x.' },
    waveF: { k: 'x...x...x...x...', s: '....x...x.x.xxxx', c: '....x...........' },
  },
  sections: {
    A: miA,
    B: { chords: 'Ab Bb Gm Cm Ab Bb G G7', lead: MI_B.replace('o5', 'o4'), chip: MI_B, drums: 'wavex waveB*6 waveF', pat: { arp: '0123432101234321' } },
    A2: { ...miA, chip: MI_A },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// HYAKKIYAKO - Japanese festival
// ------------------------------------------------------------------------------------------------------------
const HY_A = 'o5 a8 a8 f8 e8 d4 e8 f8 | b-4 a8 f8 a4. r8 | e8 f8 a8 b-8 a4 f8 e8 | d2. r4 | > d8 d8 < b-8 a8 b-4 a8 f8 | b-4 a8 f8 d4 f4 | e4 d4 e8 f8 e4 | e2. r4 |';
const HY_B = 'o5 f4 g8 a8 > c4 < a8 g8 | g4. a8 g4 d4 | f4. g8 a4 d4 | f2. r4 | a4 > c8 d8 c4 < a8 g8 | g4 a8 g8 d4 c4 | d4 f4 g4 > c4 | < a2 d2 |';
const hyA = { chords: 'Dm Bb C Dm Bb Gm Asus4 A', lead: HY_A, taiko: 'matsuri*7 matsuriF' };
const hyakkiyako = {
  name: 'Hyakkiyako Lantern Festival',
  gain: 0.88, // level trim (offline level report)
  bpm: 140,
  reverb: 0.3,
  delay: { beats: 0.75, fb: 0.3, mix: 0.3 },
  tracks: {
    lead: { inst: 'koto', vol: 0.28, rev: 0.25, dly: 0.12 },
    flute: { inst: 'flute', vol: 0.13, rev: 0.3, vib: 26, vibRate: 5.2, breath: 0.7, glide: 0.1 },
    arp: { inst: 'koto', gen: 'arp', pattern: '0.1.2.1.0.1.2.1.', center: 62, vol: 0.07, pan: -0.3, decay: 0.6 },
    pad: { inst: 'strings', gen: 'pad', pattern: 'sus', center: 60, vol: 0.035, rev: 0.4 },
    bass: { inst: 'sawBass', gen: 'bass', pattern: 'R-R-.RR-R-R-.R5-', oct: 2, vol: 0.28 },
    taiko: { kit: 'taiko', vol: 0.55, rev: 0.2 },
  },
  patterns: {
    matsuri: { tk: 'x.....x.x.......', sm: '....x..x....x.x.', rim: '..x...x...x...x.', k: 'x.......x.......' },
    matsuriF: { tk: 'x.x.x.x.xxxxXXXX', sm: '....x.......x...', k: 'x.......x.......' },
    matsuriB: { tk: 'x..x..x.x..x..x.', sm: 'o.o.o.o.o.o.o.o.', rim: '....x.......x...', k: 'x...x...x...x...' },
    matsuriBx: { tk: 'x..x..x.x..x..x.', sm: 'o.o.o.o.o.o.o.o.', rim: '....x.......x...', k: 'x...x...x...x...', x: 'X...............' },
  },
  sections: {
    A: hyA,
    B: { chords: 'F C Dm Bb F C Bb:2 C:2 Dm', flute: HY_B, lead: false, taiko: 'matsuriBx matsuriB*6 matsuriF', pat: { arp: '0.1.2.3.2.1.0.1.' } },
    A2: { ...hyA, flute: HY_A },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// RED WINTER - minor march with bells
// ------------------------------------------------------------------------------------------------------------
const RW_A =
  'o5 d8. d16 g8. a16 b-4 a8 g8 | f+4 a4 d4 r4 | b-8. b-16 > d8. c16 < b-4 a8 g8 | g4 e-4 f+4 d4 |' +
  ' g8. g16 b-8. > c16 d4 c8 < b-8 | > e-4 d8 c8 < b-4 g4 | g8 f8 e-8 d8 c4 e-4 | d2 f+4 a4 |';
const RW_B = 'o5 d2 f4 b-4 | a2. > c4 | < b-2 g4 d4 | f+2. r4 | g2 b-4 > e-4 | d2 < b-4 f4 | g4 e-4 f+4 a4 | g2. r4 |';
const rwA = { chords: 'Gm D7 Gm Cm:2 D:2 Gm Eb Cm D7', lead: RW_A, drums: 'marchx march*6 marchF' };
const redwinter = {
  name: 'Red Winter Parade',
  gain: 0.85, // level trim (offline level report)
  bpm: 124,
  reverb: 0.3,
  tracks: {
    lead: { inst: 'bell', index: 1.4, decay: 0.8, vol: 0.22, rev: 0.25, dly: 0.1 },
    brass: { inst: 'brass', vol: 0.12, rev: 0.25, pan: -0.2, vib: 8 },
    strings: { inst: 'strings', gen: 'pad', pattern: 'sus', center: 62, vol: 0.045, rev: 0.35 },
    stab: { inst: 'brass', gen: 'pad', pattern: '....x.......x...', center: 60, vol: 0.05, gate: 0.5, pan: 0.2 },
    bass: { inst: 'triBass', gen: 'bass', pattern: 'R-......L-......', oct: 2, vol: 0.44 },
    drums: { kit: 'orch', vol: 0.5, rev: 0.2 },
  },
  patterns: {
    march: { k: 'x.......x.......', s: 'x..xx.x.x..xx.x.', jb: 'x.x.x.x.x.x.x.x.' },
    marchx: { k: 'x.......x.......', s: 'x..xx.x.x..xx.x.', jb: 'x.x.x.x.x.x.x.x.', x: 'X...............' },
    marchF: { k: 'x.......x.......', s: 'x.x.x.x.RRRRXXXX', jb: 'x.x.x.x.........' },
    marchB: { k: 'x...x...x...x...', s: '....x.......x...', jb: 'x.x.x.x.x.x.x.x.' },
    marchBx: { k: 'x...x...x...x...', s: '....x.......x...', jb: 'x.x.x.x.x.x.x.x.', x: 'X...............' },
  },
  sections: {
    A: rwA,
    B: { chords: 'Bb F Gm D Eb Bb Cm:2 D7:2 Gm', lead: RW_B, brass: RW_B.replace('o5', 'o4'), drums: 'marchBx marchB*6 marchF' },
    A2: { ...rwA, brass: RW_A.replace('o5', 'o4') },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// GEHENNA - hard rock / metal chiptune
// ------------------------------------------------------------------------------------------------------------
const GE_A =
  'o5 e8 e8 g8 e8 a8 e8 b8 a8 | g8 e8 d8 e8 g4 a4 | c8 c8 e8 c8 g8 c8 a8 g8 | f+8 e8 d8 e8 f+4 a4 |' +
  ' b4 > e4 d8 < b8 a8 g8 | a8 b8 g8 e8 d8 e8 g8 a8 | b4 g4 > c4 < a4 | b2 > d+4 < b4 |';
const GE_B = 'o5 a4. b8 > c4 d4 | e4. d8 c4 < g4 | f+4. g8 a4 > d4 | < b2. r4 | > c4. < b8 a4 > e4 | d4. c8 < b4 g4 | f+4 a4 b4 > d+4 | < b2 a4 f+4 |';
const geA = { chords: 'E5 E5 C5 D5 E5 E5 G5:2 A5:2 B5', lead: GE_A, drums: 'metalx metal*6 metalF', mute: ['organ'] };
const gehenna = {
  name: 'Gehenna Inferno Riot',
  gain: 0.88, // level trim (offline level report)
  bpm: 172,
  reverb: 0.18,
  delay: { beats: 0.75, fb: 0.25, mix: 0.25 },
  tracks: {
    lead: { inst: 'guitar', vib: 22, vol: 0.13, fx: { drive: 14, lp: 4200, post: 0.3 }, rev: 0.15, dly: 0.12, glide: 0.05 },
    chip: { inst: 'chip', duty: 0.25, vol: 0.075, pan: 0.25, dly: 0.2 },
    gtr: { inst: 'guitar', gen: 'pad', power: true, oct: 3, pattern: 'x.xxx.xxx.xxx.xx', palm: true, vol: 0.12, fx: { drive: 30, lp: 3600, post: 0.28, hp: 90 }, pan: -0.15 },
    organ: { inst: 'organ', gen: 'pad', pattern: 'sus', center: 60, vol: 0.045, rev: 0.25 },
    bass: { inst: 'sawBass', gen: 'bass', pattern: 'R.RRR.RRR.RRR.RR', oct: 2, vol: 0.27, lp: 500, fenv: 900, fdecay: 0.06 },
    drums: { kit: 'rock', vol: 0.55, rev: 0.1 },
  },
  patterns: {
    metal: { k: 'x.x...x.x.x...x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    metalx: { k: 'x.x...x.x.x...x.', s: '....x.......x...', h: '..x.x.x.x.x.x.x.', x: 'X...............' },
    metalB: { k: 'xxxxxxxxxxxxxxxx', s: '....x.......x...', h: 'x...x...x...x...', x: 'x.......x.......' },
    metalF: { k: 'x.x.x.x.x.......', s: '....x.......x...', t: '........xx......', m: '..........xx....', f: '............xxXX' },
  },
  sections: {
    A: geA,
    B: { chords: 'Am C D Em Am C B7 B7', lead: GE_B, chip: GE_B.replace('o5', 'o6'), drums: 'metalB*7 metalF', pat: { gtr: 'x-x-x-x-x-x-x-x-', bass: 'RRRRRRRRRRRRRRRR' } },
    A2: { ...geA, chip: GE_A.replace('o5', 'o6'), mute: [] },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

// ------------------------------------------------------------------------------------------------------------
// ARONA - dreamy sparkly sky road
// ------------------------------------------------------------------------------------------------------------
const AR_A = 'o5 b4. g+8 e4 > d+4 | c+4. < b8 a+4 f+4 | g+4. e8 g+4 b4 | f+2 b4 > e4 | c+4. < b8 a4 g+4 | f+4. d+8 b4 > d+4 | c+4. < a8 f+4 e4 | e2 d+4 f+4 |';
const AR_B =
  'o5 e8 g+8 b8 > c+8 e8 c+8 < b8 g+8 | a8 > c+8 e8 < a8 > c+4 < b4 | g+8 b8 > e8 < b8 g+8 e8 g+8 b8 | > d+4 < b4 f+4 b4 |' +
  ' > e4. d+8 c+4 < b4 | a4. g+8 a4 > c+4 | < b4 a4 f+4 e4 | d+4 f+4 a4 b4 |';
const arA = { chords: 'Emaj7 D#m7 C#m7 B:2 Bsus4:2 Amaj7 G#m7 F#m7 B7sus4:2 B7:2', lead: AR_A, drums: 'skyx sky*6 skyF' };
const arona = {
  name: 'Arona Sky Road',
  gain: 1.15, // level trim (offline level report)
  bpm: 162,
  reverb: 0.35,
  delay: { beats: 0.75, fb: 0.4, mix: 0.4 },
  tracks: {
    lead: { inst: 'pulse', duty: 0.25, detune: 9, vib: 18, vol: 0.17, dly: 0.28, rev: 0.25 },
    glock: { inst: 'bell', ratio: 3.5, index: 1.2, decay: 0.8, vol: 0.075, rev: 0.35, dly: 0.2, pan: -0.25 },
    bell: { inst: 'bell', gen: 'arp', pattern: '0123432101234321', center: 76, index: 1.2, decay: 0.5, vol: 0.055, dly: 0.3, rev: 0.3, pan: 0.3 },
    pad: { inst: 'choir', gen: 'pad', pattern: 'sus', center: 66, vol: 0.045, rev: 0.45 },
    pad2: { inst: 'pad', gen: 'pad', pattern: 'sus', center: 58, vol: 0.03, lp: 1800, rev: 0.4 },
    bass: { inst: 'sawBass', gen: 'bass', pattern: 'R.O.R.O.R.O.R.O.', oct: 2, vol: 0.26, lp: 350, fenv: 1100 },
    drums: { kit: 'synth', vol: 0.45, rev: 0.2 },
  },
  patterns: {
    sky: { k: 'x...x...x...x...', c: '....x.......x...', o: '..x...x...x...x.', h: 'xx.xxx.xxx.xxx.x' },
    skyx: { k: 'x...x...x...x...', c: '....x.......x...', o: '..x...x...x...x.', h: '.x.xxx.xxx.xxx.x', x: 'X...............' },
    skyF: { k: 'x...x...x...x...', c: '....x...........', s: '........x.xxXXXX' },
  },
  sections: {
    A: arA,
    B: { chords: 'C#m A E B C#m A F#m7 B7', lead: AR_B, glock: AR_B.replace('o5', 'o6'), drums: 'skyx sky*6 skyF' },
    A2: { ...arA, glock: AR_A.replace('o5', 'o6') },
  },
  form: ['A', 'B', 'A2', 'B'],
  loop: 0,
};

export const SONGS = {
  title,
  menu,
  charselect,
  results,
  victory,
  defeat,
  trophy,
  abydos,
  shibaseki,
  trinity,
  millennium,
  hyakkiyako,
  redwinter,
  gehenna,
  arona,
  race,
  ...EXTRA_SONGS, // eurobeat, highway, ska, chiptune, lounge, online, tournament (songsExtra.js)
};

/**
 * The soundtrack in Sound Test order: { key, where, style }. Song titles are SONGS[key].name.
 * `race: true` marks songs that can play during races (Options -> Race Music).
 */
export const SOUNDTRACK = [
  { key: 'title', where: 'Title screen', style: 'Main theme' },
  { key: 'menu', where: 'Main menu', style: 'Bouncy shuffle' },
  { key: 'charselect', where: 'Character select', style: 'Jazz funk' },
  { key: 'lounge', where: 'Options · How to Play', style: 'Bossa nova' },
  { key: 'online', where: 'Online lobby', style: 'Future funk' },
  { key: 'race', where: 'Race mix', style: 'Circuit rock', race: true },
  { key: 'abydos', where: 'Abydos Desert Circuit', style: 'Desert adventure', race: true },
  { key: 'shibaseki', where: 'Shibaseki Ramen Street', style: 'Sunset city funk', race: true },
  { key: 'trinity', where: 'Trinity Garden Speedway', style: 'Orchestral bells', race: true },
  { key: 'millennium', where: 'Millennium Cyber Loop', style: 'Synthwave', race: true },
  { key: 'hyakkiyako', where: 'Hyakkiyako Sakura Pass', style: 'Festival', race: true },
  { key: 'redwinter', where: 'Red Winter Snow Fortress', style: 'Winter march', race: true },
  { key: 'gehenna', where: 'Gehenna Inferno Rally', style: 'Chiptune metal', race: true },
  { key: 'arona', where: "Arona's Sky Classroom", style: 'Sky road', race: true },
  { key: 'eurobeat', where: 'Race mix', style: 'Eurobeat', race: true },
  { key: 'highway', where: 'Race mix', style: 'Trance', race: true },
  { key: 'ska', where: 'Race mix', style: 'Ska punk', race: true },
  { key: 'chiptune', where: 'Race mix', style: '8-bit', race: true },
  { key: 'results', where: 'Race results', style: 'Lo-fi' },
  { key: 'tournament', where: 'Tournament standings', style: 'Anthem' },
  { key: 'victory', where: 'Victory', style: 'Fanfare' },
  { key: 'defeat', where: 'Defeat', style: 'Music box' },
  { key: 'trophy', where: 'Trophy ceremony', style: 'Grand brass' },
];

/** Songs that can be picked as race music. */
export const RACE_MUSIC = SOUNDTRACK.filter((t) => t.race).map((t) => t.key);

/** Fallback for unknown music keys. */
export const DEFAULT_SONG = 'race';
