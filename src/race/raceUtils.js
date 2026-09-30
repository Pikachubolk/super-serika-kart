// Small race helpers (owner: race agent): scene-graph resource collection for leak-free disposal, Time Trial
// record storage, and a loading-yield helper.
//
//   collectResources(root, into?) -> { geometries:Set, materials:Set, textures:Set }
//   disposeResources(res)          disposes everything collected (skips objects flagged userData.shared)
//   readTTRecord(trackId) -> { time, lapTimes, characterId } | null
//   writeTTRecord(trackId, { time, lapTimes, characterId }) -> bool
//   yieldFrame() -> Promise        lets the loading screen animate between heavy build steps

/** Walk a scene graph and collect every geometry / material / texture it references. */
export function collectResources(root, into = null) {
  const res = into || { geometries: new Set(), materials: new Set(), textures: new Set() };
  if (!root) return res;
  const addTex = (t) => {
    if (t && t.isTexture) res.textures.add(t);
  };
  const addMat = (m) => {
    if (!m || res.materials.has(m)) return;
    res.materials.add(m);
    for (const key in m) {
      const v = m[key];
      if (v && v.isTexture) addTex(v);
    }
    const u = m.uniforms;
    if (u) {
      for (const key in u) {
        const v = u[key]?.value;
        if (v && v.isTexture) addTex(v);
        else if (Array.isArray(v)) for (const t of v) addTex(t);
      }
    }
  };
  root.traverse?.((o) => {
    if (o.userData?.shared === true) return; // e.g. instanced props: geometry/material live in a shared cache
    if (o.geometry) res.geometries.add(o.geometry);
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(addMat);
      else addMat(o.material);
    }
    if (o.isScene) {
      addTex(o.background);
      addTex(o.environment);
    }
  });
  return res;
}

/** Dispose collected GPU resources. Double-dispose is harmless in three.js; shared caches are skipped. */
export function disposeResources(res) {
  if (!res) return;
  const shared = (x) => x?.userData?.shared === true;
  for (const g of res.geometries) {
    if (shared(g)) continue;
    try {
      g.dispose();
    } catch {
      /* ignore */
    }
  }
  for (const m of res.materials) {
    if (shared(m)) continue;
    try {
      m.dispose();
    } catch {
      /* ignore */
    }
  }
  for (const t of res.textures) {
    if (shared(t) || t.isRenderTargetTexture) continue;
    try {
      t.dispose();
    } catch {
      /* ignore */
    }
  }
  res.geometries.clear();
  res.materials.clear();
  res.textures.clear();
}

/** Time Trial record: `localStorage['ssk.tt.<trackId>']` holds `{ time, lapTimes, characterId }` (a bare
 *  number written by older code / the menus is accepted too). Detailed splits may also live in 'ssk.ttx.<id>'. */
export function readTTRecord(trackId) {
  let rec = null;
  try {
    const raw = localStorage.getItem(`ssk.tt.${trackId}`);
    if (raw != null && raw !== '') {
      let v;
      try {
        v = JSON.parse(raw);
      } catch {
        v = parseFloat(raw);
      }
      if (typeof v === 'number' && v > 0) rec = { time: v, lapTimes: null, characterId: null };
      else if (v && typeof v === 'object' && Number(v.time) > 0) rec = { time: Number(v.time), lapTimes: Array.isArray(v.lapTimes) ? v.lapTimes : null, characterId: v.characterId ?? null };
    }
    if (rec && !rec.lapTimes) {
      const x = JSON.parse(localStorage.getItem(`ssk.ttx.${trackId}`) || 'null');
      if (x && Array.isArray(x.lapTimes) && Math.abs(Number(x.time) - rec.time) < 0.01) {
        rec.lapTimes = x.lapTimes;
        rec.characterId = rec.characterId ?? x.characterId ?? null;
      }
    }
  } catch {
    /* storage blocked / corrupt: no record */
  }
  return rec;
}

export function writeTTRecord(trackId, { time, lapTimes, characterId }) {
  try {
    const rec = { time: Math.round(time * 1000) / 1000, lapTimes: (lapTimes || []).map((t) => Math.round(t * 1000) / 1000), characterId: characterId ?? null };
    localStorage.setItem(`ssk.tt.${trackId}`, JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

export const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
