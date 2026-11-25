// A szezsoT további rejtett elemei (csak igazolás, nem rajzolnak):
//  - Mozdulat (DGT zigzag, © dgtrd) és a folyamatban lévő láb fib-szintjei
//  - Leggyakrabban érintett ár (gyakori ár)
//  - Premium & Discount (BigBeluga) – 50 és 200 gyertyás tartomány, egyensúly
//  - Golden Pocket Zones (napi gyertyákból, ADR10 alapján, erősség ≥ 7/10)
//  - Elliott Wave (BigBeluga) – 5 hullámos impulzus, (a)(b)(c) célok
//  - OTE & A-B-C zóna (SwiftEdge) – OTE sáv és TP1–3 kiterjesztések
//  - Points of Interest (RBME) – a 11:00–13:30 NY sáv egyensúlya, amíg meg nem érinti
//  - Angle Market Structure (BigBeluga) – irány, egymás utáni kitörések, ±1/2/3 eltérésszint
import { atr } from "./gaps.js";
import { ema } from "./osc.js";
import { inSession, parseSession } from "./ny.js";

const hh = (bars, i, n) => { let m = -Infinity; for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.max(m, bars[k].h); return m; };
const ll = (bars, i, n) => { let m = Infinity; for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.min(m, bars[k].l); return m; };

// ── DGT zigzag (mélység 11, eltérés 3 × ATR10) ──
export function dgtMove(bars, depth = 11, devMult = 3) {
  const N = bars.length, len = Math.floor(depth / 2), a10 = atr(bars, 10);
  let x0 = null, p0 = null, x1 = null, p1 = null, hi = false;
  for (let i = 2 * len; i < N; i++) {
    const c = i - len, th = a10[i] / bars[i].c * 100 * devMult;
    let isH = true, isL = true;
    for (let k = i - 2 * len; k <= i; k++) { if (bars[k].h > bars[c].h) isH = false; if (bars[k].l < bars[c].l) isL = false; }
    const dev = (base, p) => 100 * (p - base) / p;
    if (isH) {
      if (hi && x1 !== null) { if (bars[c].h > p1) { x1 = c; p1 = bars[c].h; } }
      else if (x1 === null || Math.abs(dev(p1, bars[c].h)) > th) { x0 = x1; p0 = p1; x1 = c; p1 = bars[c].h; hi = true; }
    } else if (isL) {
      if (!hi && x1 !== null) { if (bars[c].l < p1) { x1 = c; p1 = bars[c].l; } }
      else if (x1 === null || Math.abs(dev(p1, bars[c].l)) > th) { x0 = x1; p0 = p1; x1 = c; p1 = bars[c].l; hi = false; }
    }
  }
  if (x0 === null) return null;
  const d = Math.abs(p0 - p1), lv = r => (p1 < p0 ? p0 - d * r : p0 + d * r);
  return { x0, p0, x1, p1, up: p1 > p0, levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618].map(r => ({ r, p: lv(r) })) };
}

// ── Leggyakrabban érintett ár (200 gyertya, 100 sor) ──
export function mostTouched(bars, look = 200, rows = 100) {
  const N = bars.length, from = Math.max(0, N - look);
  let hi = -Infinity, lo = Infinity;
  for (let i = from; i < N; i++) { hi = Math.max(hi, bars[i].h); lo = Math.min(lo, bars[i].l); }
  const st = (hi - lo) / rows;
  if (!(st > 0)) return null;
  const cnt = new Int32Array(rows);
  for (let i = from; i < N; i++) {
    const a = Math.max(0, Math.min(rows - 1, Math.floor((bars[i].l - lo) / st))), b = Math.max(0, Math.min(rows - 1, Math.floor((bars[i].h - lo) / st)));
    for (let j = a; j <= b; j++) cnt[j]++;
  }
  let best = 0; for (let j = 1; j < rows; j++) if (cnt[j] > cnt[best]) best = j;
  return lo + (best + 0.5) * st;
}

// ── Premium & Discount ──
export function premiumDiscount(bars) {
  const N = bars.length, out = {};
  for (const [k, n] of [["sr", 50], ["macro", 200]]) {
    if (N < 10) continue;
    const h = hh(bars, N - 1, n), l = ll(bars, N - 1, n), eq = (h + l) / 2;
    out[k] = { h, l, eq, premium: bars[N - 1].c > eq };
  }
  return out;
}

// ── Golden Pocket Zones (napi) ──
export function goldenPocketZones(daily, look = 20, hPct = 3, minCandle = 60, minStr = 7) {
  if (!daily || daily.length < 12) return [];
  const done = daily.filter(d => d.done), adr = i => { let s = 0, n = 0; for (let k = Math.max(0, i - 9); k <= i; k++) { s += done[k].h - done[k].l; n++; } return s / n; };
  const curAdr = adr(done.length - 1), half = curAdr * hPct / 100 / 2, tmp = [];
  for (let i = Math.max(0, done.length - look); i < done.length; i++) {
    const d = done[i], cs = d.h - d.l, A = adr(i);
    if (!(A > 0) || cs / A * 100 < minCandle) continue;
    const sp = cs / A * 100, str = sp >= 160 ? 10 : sp >= 140 ? 9 : sp >= 120 ? 8 : sp >= 100 ? 7 : sp >= 80 ? 6 : sp >= 60 ? 5 : 4;
    const mid = d.l + cs * 0.559;
    tmp.push({ upper: mid + half, lower: mid - half, t: d.t, strength: str });
  }
  const out = [], used = new Array(tmp.length).fill(false);
  for (let i = 0; i < tmp.length; i++) {
    if (used[i]) continue;
    const z = { ...tmp[i] };
    for (let j = i + 1; j < tmp.length; j++) if (!used[j] && !(z.upper < tmp[j].lower || tmp[j].upper < z.lower)) {
      z.upper = Math.max(z.upper, tmp[j].upper); z.lower = Math.min(z.lower, tmp[j].lower); z.strength = Math.max(z.strength, tmp[j].strength); used[j] = true;
    }
    if (z.strength >= minStr) out.push(z);
  }
  return out;
}

// ── Elliott Wave (BigBeluga, hossz 20) ──
export function elliott(bars, len = 20) {
  const N = bars.length, piv = [];
  let dir = 0, il = null, l = null, ih = null, h = null, start = -1e9, res = null, broke = false;
  for (let i = 1; i < N; i++) {
    const b = bars[i], hiN = hh(bars, i, len), loN = ll(bars, i, len), prevDir = dir;
    if (b.h === hiN) dir = 1;
    if (b.l === loN) dir = -1;
    if (bars[i - 1].l === ll(bars, i - 1, len) && b.l > loN) { il = i - 1; l = bars[i - 1].l; }
    if (bars[i - 1].h === hh(bars, i - 1, len) && b.h < hiN) { ih = i - 1; h = bars[i - 1].h; }
    if (dir !== prevDir && dir === 1 && l !== null) piv.push({ v: l, i: il, low: true });
    if (dir !== prevDir && dir === -1 && h !== null) piv.push({ v: h, i: ih, low: false });
    while (piv.length > 7) piv.shift();
    if (piv.length === 7) {
      const [, p1, p2, p3, p4, p5, p6] = piv.map(p => p.v);
      const cond = p1 > p2 && p1 < p3 && p3 < p5 && p4 < p3 && p4 > p2 && p6 < p5 && p6 < p3 && p6 > p1;
      if (cond && !broke && i - start > 200) { start = i; res = { w5: p5, w4: p4, b: (p5 + p6) / 2, c: p6, pts: piv.slice(), valid: true }; }
    }
    if (res && res.valid && b.c > res.w5 && bars[i - 1].c < res.w5 && i - start < 100 && !broke) { res.valid = false; broke = true; }
  }
  return res;
}

// ── OTE & A-B-C (SwiftEdge) ──
export function oteAbc(bars, barSec) {
  const N = bars.length, mult = barSec / 3600, look = Math.max(1, Math.round(100 * mult)), emaP = Math.max(1, Math.round(50 * mult));
  if (N < Math.max(look, emaP) + 2) return null;
  const e = ema(bars.map(b => b.c), emaP), a14 = atr(bars, 14);
  let fh = 0, fl = 0, conf = false;
  for (let i = look; i < N; i++) {
    const b = bars[i], up = b.c > e[i], dn = b.c < e[i], sh = hh(bars, i - 1, look), sl = ll(bars, i - 1, look);
    const newSw = b.h > sh || b.l < sl;
    if (newSw && !conf && (up || dn)) { fh = Math.max(sh, b.h); fl = Math.min(sl, b.l); conf = true; }
    if ((up && b.l < fl) || (dn && b.h > fh)) conf = false;
  }
  const r = fh - fl, up = bars[N - 1].c > e[N - 1];
  if (!(r > 0)) return null;
  const tp = k => up ? [fh + r * k * 0.618, fh + r * k * 0.786] : [fl - r * k * 0.618, fl - r * k * 0.786];
  return { up, ote: [fh - r * 0.618, fh - r * 0.786], tp1: tp(1.272), tp2: tp(1.618), tp3: tp(2.0) };
}

// ── Points of Interest (RBME): 11:00–13:30 NY sáv közepe, érintésig ──
export function pois(bars, barSec, ny, sess = "1100-1330", tapMin = 870) {
  if (barSec > 3600) return [];
  const ses = parseSession(sess), out = [];
  let h = null, l = null, prev = false;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], inS = inSession(ny.min[i], ses);
    if (inS && !prev) { h = b.h; l = b.l; } else if (inS) { h = Math.max(h, b.h); l = Math.min(l, b.l); }
    if (!inS && prev && h !== null) {
      const fri = ny.wd[i] === 5;
      out.push({ lvl: (h + l) / 2, active: b.t + tapMin * 60000 + (fri ? 2 * 86400000 : 0) });
      h = l = null;
      while (out.length > 10) out.shift();
    }
    for (let k = out.length - 1; k >= 0; k--) if (b.t >= out[k].active && b.l <= out[k].lvl && b.h >= out[k].lvl) out.splice(k, 1);
    prev = inS;
  }
  return out;
}

// ── Angle Market Structure (BigBeluga) ──
export function angleStructure(bars, len = 5, angle = 0.1, devM = 1.0) {
  const N = bars.length, a200 = atr(bars, 200);
  let hv = NaN, lv = NaN, up = 0, dn = 0, dir = 0, base = NaN, step = NaN;
  for (let i = 2 * len; i < N; i++) {
    const c = i - len;
    let isH = true, isL = true;
    for (let k = c - len; k <= c + len; k++) {   // Pine pivot: balra szigorúan, jobbra egyenlőség megengedett
      if (k === c) continue;
      if (k < c ? bars[k].h >= bars[c].h : bars[k].h > bars[c].h) isH = false;
      if (k < c ? bars[k].l <= bars[c].l : bars[k].l < bars[c].l) isL = false;
    }
    const at = isNaN(a200[i]) ? 0 : a200[i];
    if (isH) hv = bars[c].h; else if (!isNaN(hv)) hv -= at * angle;
    if (isL) lv = bars[c].l; else if (!isNaN(lv)) lv += at * angle;
    const b = bars[i], p = bars[i - 1];
    if (!isNaN(hv) && b.h > hv && p.h <= hv + at * angle) { up++; dn = 0; dir = 1; base = hv; step = at * devM; hv = NaN; }
    if (!isNaN(lv) && b.l < lv && p.l >= lv - at * angle) { dn++; up = 0; dir = -1; base = lv; step = at * devM; lv = NaN; }
  }
  const levels = isNaN(base) ? [] : [1, 2, 3].map(k => ({ k, p: base + dir * step * k }));
  return { dir, upCount: up, dnCount: dn, base, levels };
}
