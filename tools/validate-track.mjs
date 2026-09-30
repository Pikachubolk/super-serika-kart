#!/usr/bin/env node
// Geometry validator for track definitions (pure math, runs in Node).
//
//   node tools/validate-track.mjs                 # validate every track in the registry
//   node tools/validate-track.mjs abydos-desert   # validate one track
//   node tools/validate-track.mjs abydos-desert --svg shots/abydos-layout.svg
//
// Checks:
//   * the file loads and has the required fields
//   * lap length is in a sensible range (600..2200 units)
//   * no two non-adjacent parts of the track overlap (unless separated vertically by >= 7 units: bridges)
//   * the tightest corner radius is larger than the inner half-width (road + off-road), so meshes don't fold
//   * slopes are drivable (<= 22%)
//   * features have valid positions and types
// Exit code 1 if any ERROR was found.

import { TrackPath } from '../src/world/TrackPath.js';
import { TRACKS, TEST_TRACKS } from '../src/data/tracks/index.js';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const svgIdx = args.indexOf('--svg');
const svgOut = svgIdx >= 0 ? args[svgIdx + 1] : null;
const ids = args.filter((a, i) => !a.startsWith('--') && (svgIdx < 0 || i !== svgIdx + 1));

const FEATURE_TYPES = new Set(['boost', 'ramp', 'itemRow', 'coins', 'hazard', 'slow', 'hazardZone']);

function fmt(n) {
  return Number(n).toFixed(1);
}

async function validate(entry) {
  const errors = [];
  const warnings = [];
  let def;
  try {
    def = await entry.load();
  } catch (e) {
    errors.push(`failed to import: ${e.stack || e}`);
    return { errors, warnings };
  }
  for (const k of ['id', 'name', 'points', 'theme']) if (!def[k]) errors.push(`missing field "${k}"`);
  if (def.id && def.id !== entry.id) errors.push(`def.id "${def.id}" != registry id "${entry.id}"`);
  if (errors.length) return { errors, warnings };

  const p = new TrackPath(def);
  const S = p.samples;
  const N = S.length;
  const info = [];
  info.push(`length ${fmt(p.length)}  samples ${N}  controlPoints ${def.points.length}`);
  if (p.length < 600) errors.push(`lap too short (${fmt(p.length)} < 600)`);
  if (p.length > 2200) warnings.push(`lap very long (${fmt(p.length)} > 2200)`);

  // corner radius vs inner extent
  let minMargin = Infinity;
  let minAt = 0;
  let minRadius = Infinity;
  for (const s of S) {
    const k = Math.abs(s.curvature);
    if (k < 1e-5) continue;
    const r = 1 / k;
    const inner = s.halfWidth + (s.curvature > 0 ? s.offR : s.offL);
    if (r < minRadius) minRadius = r;
    if (r - inner < minMargin) {
      minMargin = r - inner;
      minAt = s.d;
    }
  }
  info.push(`tightest radius ${fmt(minRadius)}  (radius - inner extent margin ${fmt(minMargin)} at d=${fmt(minAt)})`);
  if (minMargin < 1) errors.push(`corner too tight at d=${fmt(minAt)} (t=${(minAt / p.length).toFixed(3)}): inner edge folds. Widen the corner radius or reduce width/off-road there.`);
  else if (minMargin < 4) warnings.push(`very tight corner at d=${fmt(minAt)} (t=${(minAt / p.length).toFixed(3)})`);

  // slopes
  let maxSlope = 0;
  let maxSlopeAt = 0;
  for (let i = 0; i < N; i++) {
    const a = S[i];
    const b = S[(i + 3) % N];
    const dh = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) || 1e-6;
    const sl = Math.abs(b.pos.y - a.pos.y) / dh;
    if (sl > maxSlope) {
      maxSlope = sl;
      maxSlopeAt = a.d;
    }
  }
  info.push(`max slope ${(maxSlope * 100).toFixed(1)}% at d=${fmt(maxSlopeAt)}   elevation ${fmt(p.bounds.min.y)}..${fmt(p.bounds.max.y)}`);
  if (maxSlope > 0.22) errors.push(`slope too steep (${(maxSlope * 100).toFixed(0)}%) at d=${fmt(maxSlopeAt)}`);

  // overlap check (skip neighbours along the path)
  const overlaps = [];
  const stride = 2;
  for (let i = 0; i < N; i += stride) {
    const a = S[i];
    const ea = a.halfWidth + Math.max(a.offL, a.offR);
    for (let j = i + stride; j < N; j += stride) {
      let gap = Math.abs(i - j);
      if (p.closed) gap = Math.min(gap, N - gap);
      const b = S[j];
      const eb = b.halfWidth + Math.max(b.offL, b.offR);
      if (gap * p.step < (ea + eb) * 2.2) continue; // neighbours
      const dx = a.pos.x - b.pos.x;
      const dz = a.pos.z - b.pos.z;
      const dist = Math.hypot(dx, dz);
      const need = ea + eb + 2;
      if (dist < need && Math.abs(a.pos.y - b.pos.y) < 7) {
        overlaps.push({ da: a.d, db: b.d, dist });
      }
    }
  }
  if (overlaps.length) {
    // collapse runs
    const shown = [];
    for (const o of overlaps) if (!shown.some((s) => Math.abs(s.da - o.da) < 30 && Math.abs(s.db - o.db) < 30)) shown.push(o);
    for (const o of shown.slice(0, 6))
      errors.push(`track overlaps itself: d=${fmt(o.da)} (t=${(o.da / p.length).toFixed(3)}) vs d=${fmt(o.db)} (t=${(o.db / p.length).toFixed(3)}), centerline distance ${fmt(o.dist)}; separate them or make one a bridge (>=7 units higher)`);
  }

  // features
  for (const f of def.features || []) {
    if (!FEATURE_TYPES.has(f.type)) warnings.push(`unknown feature type "${f.type}"`);
    if (typeof f.t !== 'number' && typeof f.d !== 'number') errors.push(`feature ${JSON.stringify(f)} needs t or d`);
    if (typeof f.t === 'number' && (f.t < 0 || f.t >= 1)) errors.push(`feature t out of range: ${JSON.stringify(f)}`);
    if (typeof f.lateral === 'number') {
      const fr = p.frameAt(p.resolveD(f));
      if (Math.abs(f.lateral) > fr.halfWidth + 0.01) warnings.push(`feature lateral ${f.lateral} beyond road half-width ${fmt(fr.halfWidth)}: ${JSON.stringify(f)}`);
    }
  }
  const nItemRows = (def.features || []).filter((f) => f.type === 'itemRow').length;
  if (nItemRows < 2) warnings.push(`only ${nItemRows} item rows (recommend 3-4 per lap)`);

  // start line sanity: grid must be on the road
  for (let s = 0; s < 8; s++) {
    const g = p.gridSlot(s);
    const pr = p.project(g.position, null);
    if (pr.surface !== 'road') errors.push(`grid slot ${s} is not on the road (surface=${pr.surface})`);
  }

  if (svgOut) writeSvg(p, def, svgOut);
  return { errors, warnings, info };
}

function writeSvg(p, def, file) {
  const { min, max } = p.bounds;
  const pad = 20;
  const w = max.x - min.x + pad * 2;
  const h = max.z - min.z + pad * 2;
  const pts = p.samples.map((s) => `${(s.pos.x - min.x + pad).toFixed(1)},${(s.pos.z - min.z + pad).toFixed(1)}`).join(' ');
  const hw = p.samples[0].halfWidth * 2;
  const st = p.samples[0].pos;
  const feats = (def.features || [])
    .map((f) => {
      const fr = p.frameAt(p.resolveD(f));
      const x = fr.pos.x - min.x + pad;
      const z = fr.pos.z - min.z + pad;
      const col = { boost: '#ff9900', ramp: '#aa55ff', itemRow: '#33ccff', coins: '#ffd700', hazard: '#ff3333' }[f.type] || '#999';
      return `<circle cx="${x.toFixed(1)}" cy="${z.toFixed(1)}" r="4" fill="${col}"/>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${Math.min(1200, w).toFixed(0)}">
<rect width="100%" height="100%" fill="#1b2433"/>
<polyline points="${pts}" fill="none" stroke="#556" stroke-width="${hw + 2 * 7}" stroke-linejoin="round"/>
<polyline points="${pts}" fill="none" stroke="#bbb" stroke-width="${hw}" stroke-linejoin="round"/>
<polyline points="${pts}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="4 4"/>
<circle cx="${(st.x - min.x + pad).toFixed(1)}" cy="${(st.z - min.z + pad).toFixed(1)}" r="6" fill="#ff2255"/>
${feats}
</svg>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg);
}

const entries = [...TRACKS, ...TEST_TRACKS].filter((e) => !ids.length || ids.includes(e.id));
if (!entries.length) {
  console.error('No matching tracks:', ids.join(', '));
  process.exit(1);
}
let failed = false;
for (const e of entries) {
  const exists = fs.existsSync(path.resolve('src/data/tracks', `${e.id}.js`));
  if (!exists) {
    console.log(`\n== ${e.id}: (file not created yet)`);
    continue;
  }
  const r = await validate(e);
  console.log(`\n== ${e.id}`);
  for (const l of r.info || []) console.log(`   ${l}`);
  for (const w of r.warnings) console.log(`   WARN  ${w}`);
  for (const er of r.errors) console.log(`   ERROR ${er}`);
  if (!r.errors.length) console.log('   OK');
  else failed = true;
}
process.exit(failed ? 1 : 0);
