// Rejtett struktúra-elemek (nem rajzolnak; a célár / EGYEZÉS / narratíva igazolásához), a szezsoT szerint:
//  - Order Blocks (FVG Order Blocks [BigBeluga] logika, © BigBeluga, CC BY-NC-SA 4.0)
//  - Liquidity Location (Liquidity Location Detector [BigBeluga] logika)
//  - Volumatic FVG (Volumatic Fair Value Gaps [BigBeluga] származék)
//  - az utolsó lezárt 1h / 4h / napi gyertya kanócvégei
import { atr } from "./gaps.js";

function sma(arr, len) {
  const out = new Float64Array(arr.length); let s = 0;
  for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= len) s -= arr[i - len]; out[i] = i >= len - 1 ? s / len : NaN; }
  return out;
}
function rollingMax(arr, len) {                      // ta.percentile_nearest_rank(x, len, 100)
  const out = new Float64Array(arr.length), dq = [];
  for (let i = 0; i < arr.length; i++) {
    while (dq.length && arr[dq[dq.length - 1]] <= arr[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - len) dq.shift();
    out[i] = arr[dq[0]];
  }
  return out;
}

// ── Order Blocks ──
export function orderBlocks(bars, cfg = { filter: 0.5, amount: 6 }) {
  const a200 = atr(bars, 200), bulls = [], bears = [];
  const manage = (arr, bull, b) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      const o = arr[i];
      const broken = bull ? b.h < o.bot : b.l > o.top;
      let overl = false;
      for (let j = 0; j < arr.length; j++) if (j !== i && arr[j].top < o.top && arr[j].top > o.bot) { overl = true; break; }
      if (broken || overl) arr.splice(i, 1);
    }
    while (arr.length > cfg.amount) arr.shift();
  };
  for (let i = 2; i < bars.length; i++) {
    const b = bars[i], b1 = bars[i - 1], b2 = bars[i - 2], at = a200[i];
    if (b.done && !isNaN(at)) {
      if (b2.h < b.l && b2.h < b1.h && b2.l < b.l && (b.l - b2.h) / b.l * 100 > cfg.filter)
        bulls.push({ i: i - 1, top: b2.h, bot: b2.h - at, bull: true });
      if (b2.l > b.h && b2.l > b1.l && b2.h > b.h && (b2.l - b.h) / b2.l * 100 > cfg.filter)
        bears.push({ i: i - 1, top: b2.l + at, bot: b2.l, bull: false });
    }
    manage(bulls, true, b); manage(bears, false, b);
  }
  return { bulls, bears };
}

// ── Liquidity Location ──
export function liquidity(bars, cfg = { amount: 30 }) {
  const n = bars.length, vol = bars.map(b => b.v), v10 = sma(vol, 10).map(x => x / 10);
  // a 99. percentilis a legutóbbi 1000 gyertyából (egy közös referenciával – rejtett számításhoz elég)
  const recent = Array.from(v10.slice(Math.max(0, n - 1000))).filter(x => !isNaN(x)).sort((a, b) => a - b);
  const ref = recent.length ? recent[Math.min(recent.length - 1, Math.ceil(0.99 * recent.length) - 1)] : 1;
  const norm = i => Math.min((v10[i] || 0) / (ref || 1) * 5, 10);
  const hh = i => { let m = -Infinity; for (let k = Math.max(0, i - 14); k <= i; k++) m = Math.max(m, bars[k].h); return m; };
  const ll = i => { let m = Infinity; for (let k = Math.max(0, i - 14); k <= i; k++) m = Math.min(m, bars[k].l); return m; };
  const ups = [], dns = [], all = [];
  for (let i = 1; i < n; i++) {
    const b = bars[i], p = bars[i - 1], sz = (p.h - p.l) / 2, strength = norm(i - 1);
    if (hh(i - 1) === p.h && b.h < hh(i)) { const z = { i: i - 1, top: p.h + sz, bot: p.h, up: true, strength }; ups.push(z); all.push(z); }
    if (ll(i - 1) === p.l && b.l > ll(i)) { const z = { i: i - 1, top: p.l, bot: p.l - sz, up: false, strength }; dns.push(z); all.push(z); }
    for (let k = ups.length - 1; k >= 0; k--) if (b.h > ups[k].top) ups.splice(k, 1);
    for (let k = dns.length - 1; k >= 0; k--) if (b.l < dns[k].bot) dns.splice(k, 1);
    while (all.length > cfg.amount) {
      const old = all.shift();
      let k = ups.indexOf(old); if (k >= 0) ups.splice(k, 1);
      k = dns.indexOf(old); if (k >= 0) dns.splice(k, 1);
    }
  }
  return { ups, dns };
}

// ── Volumatic FVG ──
export function volumaticFvg(bars) {
  const n = bars.length, diff = new Float64Array(n);
  for (let i = 2; i < n; i++) {
    const b = bars[i], p = bars[i - 1], b2 = bars[i - 2];
    diff[i] = p.c > p.o ? (b.l - b2.h) / b.l * 100 : (b2.l - b.h) / b.h * 100;
  }
  const mx = rollingMax(diff, 1000), fvgs = [];
  for (let i = 101; i < n; i++) {
    const b = bars[i], p = bars[i - 1], b2 = bars[i - 2];
    const size = mx[i] ? diff[i] / mx[i] * 100 : 0;
    if (b2.h < b.l && b2.h < p.h && b2.l < b.l && size > 10) fvgs.push({ i: i - 1, top: b.l, bot: b2.h, bull: true });
    if (b2.l > b.h && b2.l > p.l && b2.h > b.h && size > 10) fvgs.push({ i: i - 1, top: b2.l, bot: b.h, bull: false });
    for (let k = fvgs.length - 1; k >= 0; k--) { const f = fvgs[k]; if (f.bull ? b.l < f.bot : b.h > f.top) fvgs.splice(k, 1); }
    for (let k = fvgs.length - 1; k >= 0; k--) {
      const f = fvgs[k];
      if (fvgs.some((o, j) => j !== k && o.top < f.top && o.top > f.bot)) fvgs.splice(k, 1);
    }
    while (fvgs.length > 10) fvgs.shift();
  }
  return fvgs;
}

// ── Az utolsó LEZÁRT 1h / 4h / napi gyertya csúcsa és alja ──
export function htfLevels(bars, barSec, daily) {
  const out = {};
  if (!bars.length) return out;
  const now = bars[bars.length - 1].t;
  for (const [name, sec] of [["1h", 3600], ["4h", 14400]]) {
    if (barSec > sec) continue;
    const ms = sec * 1000, cur = Math.floor(now / ms) * ms, prev = cur - ms;
    let h = -Infinity, l = Infinity;
    for (let i = bars.length - 1; i >= 0 && bars[i].t >= prev; i--) if (bars[i].t < cur) { h = Math.max(h, bars[i].h); l = Math.min(l, bars[i].l); }
    if (isFinite(h)) out[name] = { h, l };
  }
  if (daily && daily.length > 1) { const d = daily[daily.length - 2]; out.D = { h: d.h, l: d.l }; }
  return out;
}
