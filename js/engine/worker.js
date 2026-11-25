// A motor külön szálon: a chart görgetése és az élő ár sosem akad meg a számítás miatt.
// Üzenetek: { id, seq, bars? (teljes), tail? (utolsó gyertyák), daily?, barSec, layers, tick } -> { id, seq, items, codes, t0 }
import { runEngine } from "./index.js";

const state = new Map();
const CODE = { "#FFEB3B": 1, "#9C27B0": 2 };   // CRT szín kódok (a fő szálon visszafejtve)

self.onmessage = e => {
  const m = e.data;
  if (m.drop) { state.delete(m.id); return; }
  const s = state.get(m.id) || { bars: [], daily: null };
  if (m.bars) s.bars = m.bars;
  if (m.tail) for (const b of m.tail) {
    const last = s.bars[s.bars.length - 1];
    if (last && last.t === b.t) s.bars[s.bars.length - 1] = b;
    else if (!last || b.t > last.t) s.bars.push(b);
  }
  if (m.daily !== undefined) s.daily = m.daily;
  state.set(m.id, s);
  let items = [], codes = new Uint8Array(0);
  try {
    const r = runEngine({ bars: s.bars, barSec: m.barSec, daily: s.daily, layers: m.layers, tick: m.tick });
    items = r.items;
    if (r.barColors) { codes = new Uint8Array(s.bars.length); r.barColors.forEach((c, i) => { if (c) codes[i] = CODE[c] || 0; }); }
  } catch (err) { self.postMessage({ id: m.id, seq: m.seq, error: String(err && err.message || err) }); return; }
  self.postMessage({ id: m.id, seq: m.seq, items, codes, hasColors: codes.length > 0, t0: s.bars.length ? s.bars[0].t : 0 }, [codes.buffer]);
};
