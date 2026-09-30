// Music notation + song compiler (owner: audio agent). Pure JS (no Web Audio) so songs can be validated in Node.
//
// SONG FORMAT (see songs.js)
// {
//   name, bpm, swing (0.5 = straight, 0.6 = light shuffle, 0.667 = triplet swing; applied to 8ths),
//   swing16 (same for 16ths), gain, reverb (send return level), delay: { beats, fb, mix },
//   transpose (semitones, whole song),
//   tracks: { <name>: { inst | kit, vol, pan, rev, dly, gen?: 'bass'|'pad'|'arp'|'stab', pattern?, oct?, center?,
//                       fx?: { drive, lp, hp }, gate?, ...instrument params } },
//   patterns: { <name>: { k: 'x...x...', s: '....x...', h: ... } },   // drum patterns (1 char = one 16th)
//   sections: { <name>: { chords: 'C G/B Am:2 F:2 | ...', <track>: 'MML' | false, pat: { <track>: pattern },
//                         mute: [track...], transpose } },
//   form: ['intro', 'A', 'B'],  loop: 1   // index into form where the loop restarts
// }
//
// CHORDS: whitespace separated symbols, one bar (4 beats) each unless suffixed ':<beats>'. '%' repeats the previous
//   chord, '_' = no chord, '|' is ignored. Symbols: C, Cm, C7, Cm7, Cmaj7, Cdim, Cdim7, Cm7b5, Caug, Csus2, Csus4,
//   C7sus4, C6, Cm6, Cadd9, Cmadd9, C9, Cm9, Cmaj9, C5, C7b9, C/E (slash bass). Accidentals '#' / 'b'.
//
// MML (melodic tracks): o<n> octave (o4 = middle C octave), < > octave down/up, l<n> default length,
//   notes c d e f g a b with + or # (sharp) / - (flat), length digits (4 = quarter, 8, 16, 2, 1, 12 = triplet 8th...),
//   dots, ties ^<len>, r = rest, v<0-10> velocity, q<1-8> gate, ~ before a note = slide from the previous note,
//   [ ... ]<n> repeat n times, { c e g }<len> = tuplet (the group shares <len>), | bar check (ignored for timing).
//
// GENERATOR PATTERNS (1 char = one 16th, spaces ignored, cycles through the section):
//   bass: R root, O octave, 5 fifth, 3 third, 7 seventh, L fifth below, A chromatic approach to the next chord,
//         lowercase = ghost note, '-' hold, '.' rest
//   pad/stab: x hit, X accent, o soft, '-' hold, '.' rest      (pattern 'sus' = hold every chord)
//   arp: digits 0-9 = index into the chord (ascending, wraps up octaves), '-' hold, '.' rest

const NOTE_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

const CHORD_QUALITIES = {
  '': [0, 4, 7],
  M: [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  '+': [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  '5': [0, 7],
  '7b9': [0, 4, 7, 10, 13],
  mM7: [0, 3, 7, 11],
  '69': [0, 4, 7, 9, 14],
};

function parsePc(letter, acc) {
  let pc = NOTE_PC[letter.toLowerCase()];
  if (acc === '#') pc += 1;
  else if (acc === 'b') pc -= 1;
  return (pc + 12) % 12;
}

/** Parse a chord progression string -> [{ beat, dur, root, tones: [semitones], bass, symbol }] */
export function parseChords(str, transpose = 0, warnings = []) {
  const out = [];
  let beat = 0;
  let prev = null;
  const tokens = String(str || '').replace(/\|/g, ' ').trim().split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    let sym = tok;
    let dur = 4;
    const ci = tok.lastIndexOf(':');
    if (ci > 0) {
      sym = tok.slice(0, ci);
      dur = Number(tok.slice(ci + 1));
      if (!(dur > 0)) {
        warnings.push(`bad chord duration "${tok}"`);
        dur = 4;
      }
    }
    let ch;
    if (sym === '%') ch = prev ? { ...prev } : null;
    else if (sym === '_') ch = { root: null, tones: [], bass: null, symbol: '_' };
    else {
      const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(sym);
      if (!m || !(m[3] in CHORD_QUALITIES)) {
        warnings.push(`unknown chord "${sym}"`);
        ch = { root: null, tones: [], bass: null, symbol: sym };
      } else {
        const root = (parsePc(m[1], m[2]) + transpose + 120) % 12;
        const bass = m[4] ? (parsePc(m[4], m[5]) + transpose + 120) % 12 : root;
        ch = { root, tones: CHORD_QUALITIES[m[3]], bass, symbol: sym };
      }
    }
    if (!ch) ch = { root: null, tones: [], bass: null, symbol: '_' };
    out.push({ ...ch, beat, dur });
    prev = ch;
    beat += dur;
  }
  return out;
}

function expandRepeats(src) {
  let s = src;
  for (let guard = 0; guard < 50; guard++) {
    const next = s.replace(/\[([^[\]]*)\]\s*(\d*)/g, (_, body, n) => ` ${body} `.repeat(Number(n || 2)));
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Parse MML into events [{ b, d, n (midi), v, g (gate 0..1), s (slide) }] with beats relative to 0.
 * Returns { events, length, warnings }.
 */
export function parseMML(src, { octave = 4, len = 8, vel = 0.8, gate = 0.9, label = '' } = {}) {
  const s = expandRepeats(String(src || ''));
  const events = [];
  const warnings = [];
  let i = 0;
  let oct = octave;
  let defLen = 4 / len;
  let v = vel;
  let q = gate;
  let beat = 0;
  let barStart = 0;
  let barNo = 1;
  let slideNext = false;
  let lastNote = null;

  const peek = () => s[i];
  const readInt = () => {
    const m = /^\d+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const readLen = (fallback) => {
    let n = readInt();
    let d = n ? 4 / n : fallback;
    let dotAdd = d / 2;
    while (peek() === '.') {
      d += dotAdd;
      dotAdd /= 2;
      i++;
    }
    // ties ^len
    while (peek() === '^') {
      i++;
      n = readInt();
      let td = n ? 4 / n : defLen;
      let ta = td / 2;
      while (peek() === '.') {
        td += ta;
        ta /= 2;
        i++;
      }
      d += td;
    }
    return d;
  };
  const readNote = () => {
    // returns { midi | null (rest) } without length
    const c = s[i].toLowerCase();
    i++;
    if (c === 'r') return { midi: null };
    let pc = NOTE_PC[c];
    while (peek() === '+' || peek() === '#' || peek() === '-') {
      pc += peek() === '-' ? -1 : 1;
      i++;
    }
    return { midi: (oct + 1) * 12 + pc };
  };

  while (i < s.length) {
    const c = s[i];
    const lc = c.toLowerCase();
    if (/\s/.test(c)) {
      i++;
    } else if (c === '|') {
      i++;
      const got = beat - barStart;
      if (Math.abs(got - 4) > 1e-6) warnings.push(`${label} bar ${barNo}: ${+got.toFixed(3)} beats`);
      barStart = beat;
      barNo++;
    } else if (lc === 'o') {
      i++;
      const n = readInt();
      if (n !== null) oct = n;
    } else if (c === '<') {
      i++;
      oct--;
    } else if (c === '>') {
      i++;
      oct++;
    } else if (lc === 'l') {
      i++;
      defLen = readLen(defLen);
    } else if (lc === 'v') {
      i++;
      const n = readInt();
      if (n !== null) v = n / 10;
    } else if (lc === 'q') {
      i++;
      const n = readInt();
      if (n !== null) q = n / 8;
    } else if (c === '~') {
      i++;
      slideNext = true;
    } else if (c === '{') {
      // tuplet group
      i++;
      const items = [];
      while (i < s.length && s[i] !== '}') {
        const cc = s[i];
        const lcc = cc.toLowerCase();
        if (/\s/.test(cc)) i++;
        else if (cc === '<') {
          oct--;
          i++;
        } else if (cc === '>') {
          oct++;
          i++;
        } else if (cc === '~') {
          i++;
          slideNext = true;
        } else if ('abcdefgr'.includes(lcc)) {
          const nt = readNote();
          nt.slide = slideNext;
          slideNext = false;
          items.push(nt);
        } else {
          warnings.push(`${label}: unexpected "${cc}" in tuplet`);
          i++;
        }
      }
      i++; // }
      const total = readLen(defLen);
      const each = total / Math.max(1, items.length);
      for (const it of items) {
        if (it.midi !== null) {
          events.push({ b: beat, d: each, n: it.midi, v, g: q, s: !!it.slide && lastNote !== null });
          lastNote = it.midi;
        }
        beat += each;
      }
    } else if ('abcdefgr'.includes(lc)) {
      const nt = readNote();
      const d = readLen(defLen);
      if (nt.midi !== null) {
        events.push({ b: beat, d, n: nt.midi, v, g: q, s: slideNext && lastNote !== null });
        lastNote = nt.midi;
      }
      slideNext = false;
      beat += d;
    } else {
      warnings.push(`${label}: unexpected "${c}" at ${i}`);
      i++;
    }
  }
  return { events, length: beat, warnings };
}

function cleanPattern(p) {
  return String(p || '').replace(/\s+/g, '');
}

function chordAt(chords, beat) {
  for (let i = chords.length - 1; i >= 0; i--) if (chords[i].beat <= beat + 1e-6) return { ch: chords[i], idx: i };
  return { ch: chords[0], idx: 0 };
}

function bassNote(ch, oct) {
  const low = 12 * (oct + 1) - 3; // oct 2 -> A1..G#2
  let m = low + ((((ch.bass ?? ch.root) - low) % 12) + 12) % 12;
  return m;
}

function voicing(ch, center) {
  const res = [];
  for (const iv of ch.tones) {
    const pc = (ch.root + iv) % 12;
    let m = pc + 12 * Math.floor(center / 12);
    while (m < center - 6) m += 12;
    while (m >= center + 6) m -= 12;
    if (!res.includes(m)) res.push(m);
  }
  return res.sort((a, b) => a - b);
}

function arpNotes(ch, center) {
  const base = voicing({ ...ch, tones: [0] }, center)[0];
  const tones = ch.tones.map((iv) => base + iv).sort((a, b) => a - b);
  const out = [];
  for (let o = 0; o < 4; o++) for (const t of tones) out.push(t + o * 12);
  return out;
}

/** Generate events for a generator track over a section. */
function generate(kind, pattern, chords, lenBeats, P) {
  const pat = cleanPattern(pattern);
  const events = [];
  if (!pat.length) return events;
  const steps = Math.round(lenBeats * 4);
  const oct = P.oct ?? 2;
  const center = P.center ?? 64;
  let open = []; // currently sounding events
  let openChordIdx = -1;
  let openSym = null;
  const close = (beat) => {
    for (const e of open) e.d = Math.max(0.05, beat - e.b);
    open = [];
  };
  const start = (sym, ch, idx, beat, vel) => {
    openChordIdx = idx;
    openSym = sym;
    if (ch.root === null) return;
    const mk = (n, v = vel) => {
      const e = { b: beat, d: 0.25, n, v, g: P.gate ?? 1, s: false };
      events.push(e);
      open.push(e);
    };
    if (kind === 'bass') {
      const r = bassNote(ch, oct);
      const up = sym.toUpperCase();
      let n = r;
      if (up === 'O') n = r + 12;
      else if (up === '5') n = r + 7;
      else if (up === 'L') n = r - 5;
      else if (up === '3') n = bassNote({ bass: (ch.root + (ch.tones[1] ?? 4)) % 12 }, oct);
      else if (up === '7') n = r + (ch.tones[3] ?? 10);
      else if (up === 'A') {
        const next = chords[idx + 1] || chords[0];
        const nr = next.root === null ? ch : next;
        const target = bassNote(nr, oct);
        n = target === r ? r + 7 : target - 1;
      }
      mk(n);
    } else if (kind === 'arp') {
      const k = Number(sym);
      const notes = arpNotes(ch, center);
      mk(notes[k % notes.length]);
    } else {
      // pad / stab
      let notes;
      if (P.power) {
        // power chord (root, fifth, octave) - chord quality ignored
        const r = bassNote(ch, P.oct ?? 3);
        notes = [r, r + 7, r + 12];
      } else {
        notes = voicing(ch, center);
        if (P.bassNote) notes.unshift(bassNote(ch, P.oct ?? 3));
        if (P.top) notes.push(notes[0] + 12);
      }
      for (const n of notes) mk(n);
    }
  };
  const velFor = (c) => {
    if (c === 'X') return 1;
    if (c === 'o' || (c >= 'a' && c <= 'z' && c !== 'x')) return 0.5;
    return 0.8;
  };

  if (pat === 'sus') {
    for (let ci = 0; ci < chords.length; ci++) {
      const ch = chords[ci];
      if (ch.beat >= lenBeats) break;
      close(ch.beat);
      start('x', ch, ci, ch.beat, 0.8);
    }
    close(lenBeats);
    return events;
  }

  for (let st = 0; st < steps; st++) {
    const beat = st / 4;
    const c = pat[st % pat.length];
    const { ch, idx } = chordAt(chords, beat);
    if (c === '.') {
      close(beat);
    } else if (c === '-') {
      if (open.length && idx !== openChordIdx) {
        // chord changed during a hold: re-voice
        const v = open[0].v;
        close(beat);
        start(openSym || 'x', ch, idx, beat, v);
      }
    } else {
      close(beat);
      start(c, ch, idx, beat, velFor(c));
    }
  }
  close(lenBeats);
  return events;
}

const BUILTIN_DRUMS = {
  four: { k: 'x...x...x...x...', c: '....x.......x...', h: '..x...x...x...x.' },
  rock: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  fillA: { k: 'x.......x.......', s: '....x...x.xxXxXX', h: 'x.x.x.x.........' },
  fillTom: { k: 'x...............', s: '....x...........', t: '........xx......', m: '..........xx....', f: '............xxXX' },
  crash: { k: 'x...............', x: 'X...............' },
};

function drumPattern(name, songPatterns, warnings) {
  const p = (songPatterns && songPatterns[name]) || BUILTIN_DRUMS[name];
  if (!p) {
    warnings.push(`unknown drum pattern "${name}"`);
    return null;
  }
  return p;
}

/** Compile drums sequence 'main*3 fill' into events [{ b, dv (voice), v }] */
function compileDrums(seq, songPatterns, lenBeats, warnings, rngSeed) {
  const events = [];
  let beat = 0;
  let seed = rngSeed >>> 0 || 1;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const tokens = String(seq).trim().split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const [name, cnt] = tok.split('*');
    const n = Number(cnt || 1);
    const p = drumPattern(name, songPatterns, warnings);
    if (!p) continue;
    const lines = Object.entries(p).map(([k, v]) => [k, cleanPattern(v)]);
    const steps = Math.max(...lines.map(([, v]) => v.length));
    for (let r = 0; r < n; r++) {
      for (const [voice, line] of lines) {
        for (let st = 0; st < line.length; st++) {
          const ch = line[st];
          if (ch === '.' || ch === '-') continue;
          const b = beat + st / 4;
          if (b >= lenBeats - 1e-6) continue;
          const hum = 1 + (rnd() - 0.5) * 0.12;
          if (ch === 'R') {
            events.push({ b, dv: voice, v: 0.55 * hum });
            events.push({ b: b + 0.125, dv: voice, v: 0.65 * hum });
          } else if (ch === 'T') {
            // triplet roll across the 16th
            for (let k = 0; k < 3; k++) events.push({ b: b + k / 12, dv: voice, v: (0.5 + k * 0.12) * hum });
          } else {
            const v = ch === 'X' ? 1 : ch === 'o' ? 0.38 : 0.78;
            events.push({ b, dv: voice, v: v * hum });
          }
        }
      }
      beat += steps / 4;
    }
  }
  if (beat > lenBeats + 1e-6) warnings.push(`drums "${seq}" = ${beat} beats > section ${lenBeats}`);
  return events;
}

/**
 * Compile a song definition into flat per-track event lists.
 * Returns { key, name, bpm, swing, swing16, gain, reverb, delay, length, loopStart, tracks: [...], sections: [...], warnings }
 */
export function compileSong(key, def) {
  const warnings = [];
  const trackDefs = Object.entries(def.tracks || {});
  const tracks = trackDefs.map(([name, p]) => ({ name, params: p, drum: !!p.kit, events: [] }));
  const sections = [];
  let beat = 0;
  let loopStart = 0;
  const form = def.form || Object.keys(def.sections || {});
  const loopIdx = def.loop ?? 0;
  form.forEach((secRef, fi) => {
    const sec = typeof secRef === 'string' ? def.sections[secRef] : secRef;
    const secName = typeof secRef === 'string' ? secRef : sec?.name || `#${fi}`;
    if (!sec) {
      warnings.push(`${key}: missing section ${secRef}`);
      return;
    }
    if (fi === loopIdx) loopStart = beat;
    const tr = (def.transpose || 0) + (sec.transpose || 0);
    const chords = parseChords(sec.chords || '_', tr, warnings);
    const chordLen = chords.reduce((a, c) => a + c.dur, 0);
    const len = sec.bars ? sec.bars * 4 : chordLen;
    if (sec.bars && Math.abs(chordLen - len) > 1e-6 && sec.chords) warnings.push(`${key}.${secName}: chords ${chordLen} beats vs bars ${len}`);
    tracks.forEach((track, ti) => {
      if (sec.mute && sec.mute.includes(track.name)) return;
      const src = sec[track.name];
      const P = track.params;
      if (track.drum) {
        if (typeof src === 'string' && src.trim()) {
          const evs = compileDrums(src, def.patterns, len, warnings, (fi + 1) * 7919 + ti * 131);
          for (const e of evs) track.events.push({ ...e, b: e.b + beat });
        }
        return;
      }
      if (typeof src === 'string') {
        const res = parseMML(src, { octave: P.octave ?? 4, len: P.len ?? 8, vel: P.vel ?? 0.8, gate: P.gate ?? 0.9, label: `${key}.${secName}.${track.name}` });
        warnings.push(...res.warnings);
        if (res.length > len + 1e-6) warnings.push(`${key}.${secName}.${track.name}: ${res.length} beats > section ${len}`);
        else if (res.length < len - 1e-6 && res.length > 0 && !P.allowShort) warnings.push(`${key}.${secName}.${track.name}: ${res.length} beats < section ${len}`);
        for (const e of res.events) {
          if (e.b >= len - 1e-6) continue;
          track.events.push({ ...e, b: e.b + beat, n: e.n + tr, d: Math.min(e.d, len - e.b + 8) });
        }
        return;
      }
      if (src === false) return;
      if (P.gen) {
        const pattern = sec.pat?.[track.name] ?? P.pattern ?? (P.gen === 'pad' ? 'sus' : 'R-R-R-R-R-R-R-R-');
        if (pattern === false) return;
        const evs = generate(P.gen, pattern, chords, len, P);
        for (const e of evs) track.events.push({ ...e, b: e.b + beat });
      }
    });
    sections.push({ name: secName, start: beat, length: len, chords: chords.map((c) => ({ ...c, beat: c.beat + beat })) });
    beat += len;
  });
  for (const t of tracks) t.events.sort((a, b) => a.b - b.b);
  return {
    key,
    name: def.name || key,
    bpm: def.bpm || 120,
    swing: def.swing ?? 0.5,
    swing16: def.swing16 ?? 0.5,
    gain: def.gain ?? 1,
    reverb: def.reverb ?? 0.25,
    delay: def.delay || null,
    length: beat,
    loopStart: Math.min(loopStart, Math.max(0, beat - 1)),
    tracks,
    sections,
    warnings,
  };
}

/** Map a straight beat position to a swung one (8th and 16th swing). */
export function swingBeat(b, swing = 0.5, swing16 = 0.5) {
  if (swing !== 0.5) {
    const whole = Math.floor(b + 1e-9);
    const p = b - whole;
    b = whole + (p < 0.5 ? p * 2 * swing : swing + (p - 0.5) * 2 * (1 - swing));
  }
  if (swing16 !== 0.5) {
    const half = Math.floor(b * 2 + 1e-9) / 2;
    const p = (b - half) * 2;
    b = half + (p < 0.5 ? p * 2 * swing16 : swing16 + (p - 0.5) * 2 * (1 - swing16)) / 2;
  }
  return b;
}
