// AUTO FIB EVO (© Alpha_Wizard, MPL 2.0) – a chart-idősíkos swing-motor átirata:
//  megerősített pivotok (pivLen mindkét oldalon), A→B láb ≥ minLegAtr × ATR, automatikus irány,
//  C pont, retracement / extension szintek, golden pocket (0.618–0.65), OTE (0.62–0.79), ABC-vetítés,
//  élő retracement és zóna. Hozzá a Gann-doboz és -legyező ugyanabból a lábból.
import { atr } from "./gaps.js";
import { rgba } from "../draw.js";

export const FIB_DEFAULTS = { pivLen: 20, minLegAtr: 2.0, extendR: 30,
  ret: [0, 0.236, 0.382, 0.5, 0.618, 0.65, 0.705, 0.786, 1], ext: [1.272, 1.618, 2.0, 2.618],
  bull: "#6FAF9F", bear: "#B66A76", gold: "#C6A15B", gold2: "#A9884F", accent: "#7892AA", soft: "#667281" };

function pivots(bars, len) {
  const N = bars.length, ph = new Array(N).fill(null), pl = new Array(N).fill(null);
  for (let i = len; i < N - len; i++) {
    let isH = true, isL = true;
    for (let j = i - len; j <= i + len; j++) {
      if (j === i) continue;
      if (j < i ? bars[j].h >= bars[i].h : bars[j].h > bars[i].h) isH = false;
      if (j < i ? bars[j].l <= bars[i].l : bars[j].l < bars[i].l) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) ph[i + len] = i;          // a megerősítés gyertyáján ismert
    if (isL) pl[i + len] = i;
  }
  return { ph, pl };
}

export function autoFib(bars, cfg = FIB_DEFAULTS) {
  const N = bars.length;
  if (N < cfg.pivLen * 2 + 20) return null;
  const a14 = atr(bars, 14), { ph, pl } = pivots(bars, cfg.pivLen);
  let lastPH = null, lastPL = null, leg = null;
  for (let i = 0; i < N; i++) {
    if (!bars[i].done) break;
    const hNew = ph[i] !== null, lNew = pl[i] !== null;
    if (hNew) lastPH = { i: ph[i], p: bars[ph[i]].h, atr: a14[ph[i]] };
    if (lNew) lastPL = { i: pl[i], p: bars[pl[i]].l, atr: a14[pl[i]] };
    if (hNew && lastPL && lastPH.i > lastPL.i && !isNaN(lastPH.atr) && lastPH.p - lastPL.p >= cfg.minLegAtr * lastPH.atr)
      leg = { a: lastPL, b: lastPH, dir: 1, c: null };
    if (lNew && lastPH && lastPL.i > lastPH.i && !isNaN(lastPL.atr) && lastPH.p - lastPL.p >= cfg.minLegAtr * lastPL.atr)
      leg = { a: lastPH, b: lastPL, dir: -1, c: null };
    if (leg) {
      if (leg.dir === 1 && lNew && pl[i] > leg.b.i) leg.c = { i: pl[i], p: bars[pl[i]].l };
      if (leg.dir === -1 && hNew && ph[i] > leg.b.i) leg.c = { i: ph[i], p: bars[ph[i]].h };
    }
  }
  if (!leg) return null;
  const A = leg.a.p, B = leg.b.p, retr = r => B - (B - A) * r, extd = e => A + (B - A) * e;
  const close = bars[N - 1].c, live = (B - close) / (B - A);
  const zone = live < 0 ? "EXTENSION" : live < 0.382 ? "SEKÉLY" : live < 0.485 ? "KÖZÉP" : live <= 0.515 ? "EGYENSÚLY"
    : live >= 0.618 && live <= 0.65 ? "GOLDEN POCKET" : live >= 0.62 && live <= 0.79 ? "OTE" : live < 1 ? "MÉLY" : "TELJES";
  const levels = cfg.ret.map(r => ({ r, p: retr(r), kind: "ret" })).concat(cfg.ext.map(e => ({ r: e, p: extd(e), kind: "ext" })));
  const mag = Math.abs(B - A), sgn = leg.dir;
  const abc = leg.c ? [{ r: 1, p: leg.c.p + sgn * mag }, { r: 1.618, p: leg.c.p + sgn * mag * 1.618 }] : [];
  return { leg, A, B, levels, pocket: [retr(0.618), retr(0.65)], ote: [retr(0.62), retr(0.79)], eq: retr(0.5),
    abc, live, zone, premium: leg.dir === 1 ? close > retr(0.5) : close < retr(0.5) };
}

// Gann-doboz és -legyező az A→B lábból: a doboz ár- és időszintjei (1/8-ok, 1/3-ok), a legyező szögei
// (1×1, 1×2, 2×1, 1×4, 4×1, 1×8, 8×1) az A pontból; a mai időpontra eső árszintek az igazoláshoz.
export function gann(bars, fib) {
  if (!fib) return null;
  const { a, b } = fib.leg, N = bars.length, dt = b.i - a.i, dp = b.p - a.p;
  if (dt <= 0) return null;
  const boxLv = [0, 1/8, 1/4, 1/3, 3/8, 1/2, 5/8, 2/3, 3/4, 7/8, 1].map(f => ({ f, p: a.p + dp * f }));
  const fanR = [[1, 1], [1, 2], [2, 1], [1, 4], [4, 1], [1, 8], [8, 1]];
  const now = N - 1, fan = fanR.map(([pr, ti]) => ({ name: `${pr}×${ti}`, p: a.p + dp * (pr / ti) * ((now - a.i) / dt) }));
  const timeLv = [1, 1.5, 2, 3, 4].map(m => a.i + Math.round(dt * m));   // időbeli dobozhatárok (gyertyaindex)
  return { boxLv, fan, timeLv };
}

export function fibLayer(bars, barSec, fib, cfg = FIB_DEFAULTS) {
  if (!fib) return [];
  const items = [], up = fib.leg.dir === 1, lastT = bars[bars.length - 1].t + cfg.extendR * barSec * 1000;
  const aT = bars[fib.leg.a.i].t, bT = bars[fib.leg.b.i].t;
  const col = r => [0.618, 0.65, 1.618].includes(r) ? cfg.gold : [0.5, 0.705, 1, 1.272].includes(r) ? cfg.gold2 : cfg.accent;
  const solid = r => [0.618, 1.618, 1, 0, 0.5, 0.705, 1.272].includes(r);
  items.push({ type: "line", t1: aT, p1: fib.A, t2: bT, p2: fib.B, color: rgba(up ? cfg.bull : cfg.bear, 20), width: 3 });
  items.push({ type: "label", t: aT, p: fib.A, text: "A", color: cfg.gold, size: 12, align: "center", vAlign: up ? "below" : "above", bold: true });
  items.push({ type: "label", t: bT, p: fib.B, text: "B", color: cfg.gold, size: 12, align: "center", vAlign: up ? "above" : "below", bold: true });
  items.push({ type: "box", t1: aT, p1: Math.max(...fib.pocket), t2: lastT, p2: Math.min(...fib.pocket), bg: rgba(cfg.gold, 84), border: "rgba(0,0,0,0)" });
  items.push({ type: "box", t1: aT, p1: Math.max(...fib.ote), t2: lastT, p2: Math.min(...fib.ote), bg: rgba(cfg.gold2, 93), border: rgba(cfg.gold2, 72) });
  for (const l of fib.levels) {
    const c = col(l.r);
    items.push({ type: "line", t1: aT, p1: l.p, t2: lastT, p2: l.p, color: rgba(c, 15), width: [0.618, 1.618, 0.5, 0.705, 1].includes(l.r) ? 2 : 1, style: solid(l.r) ? "solid" : "dashed" });
    items.push({ type: "label", t: lastT, p: l.p, text: `${l.r.toFixed(3)}${[0.618, 1.618].includes(l.r) ? " ★" : ""}  ${+l.p.toPrecision(6)}`, color: c, size: 12, align: "left", vAlign: "middle" });
  }
  if (fib.leg.c) {
    const cT = bars[fib.leg.c.i].t;
    for (const pr of fib.abc) {
      items.push({ type: "line", t1: cT, p1: fib.leg.c.p, t2: lastT, p2: pr.p, color: rgba(cfg.accent, 40), width: 1, style: pr.r === 1 ? "dotted" : "dashed" });
      items.push({ type: "label", t: lastT, p: pr.p, text: `ABC ${pr.r.toFixed(3)}  ${+pr.p.toPrecision(6)}`, color: cfg.accent, size: 12, align: "left", vAlign: "middle" });
    }
  }
  const last = bars[bars.length - 1];
  items.push({ type: "label", t: last.t + barSec * 1000, p: last.c, text: `◆ ${(fib.live * 100).toFixed(1)}% · ${fib.zone}`, color: fib.zone === "GOLDEN POCKET" ? cfg.gold : fib.zone === "OTE" ? cfg.gold2 : cfg.accent, size: 12, align: "left", vAlign: "middle", bg: "rgba(255,255,255,0.8)" });
  return items;
}
