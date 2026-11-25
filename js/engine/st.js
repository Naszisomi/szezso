// Supertrend Extensions [BOSWaves] (MPL 2.0) – rejtett irány-igazolás:
//  ATR(14) × 5 sáv, trend és flip, a flip árától mért deviációs szintek (SMA(high−low,100) × 2,7 lépésekben, 4 db),
//  a szintek átlépésének figyelésével (az át nem lépett szintek célárként szolgálnak).
import { atr } from "./gaps.js";

export function supertrend(bars, mult = 5, len = 14, devMult = 2.7, devCnt = 4) {
  const N = bars.length;
  if (N < 120) return null;
  const a = atr(bars, len);
  let lo = NaN, up = NaN, trend = 0, flip = null, levels = [];
  const rngSum = []; let s = 0;
  for (let i = 0; i < N; i++) {
    const b = bars[i], hl2 = (b.h + b.l) / 2, pc = i ? bars[i - 1].c : NaN;
    s += b.h - b.l; if (i >= 100) s -= bars[i - 100].h - bars[i - 100].l;
    const dev = i >= 99 ? s / 100 * devMult : NaN;
    const rawU = hl2 + a[i] * mult, rawL = hl2 - a[i] * mult;
    lo = !isNaN(lo) && pc > lo ? Math.max(rawL, lo) : rawL;
    up = !isNaN(up) && pc < up ? Math.min(rawU, up) : rawU;
    const prev = trend;
    if (b.c > up) trend = 1;
    if (b.c < lo) trend = -1;
    if (trend !== prev && prev !== 0 && !isNaN(dev)) {
      flip = { i, price: b.c, up: trend === 1 };
      levels = [];
      for (let k = 1; k <= devCnt; k++) levels.push({ k, p: trend === 1 ? b.c + dev * k : b.c - dev * k, crossed: false });
    }
    for (const l of levels) {
      if (l.crossed) continue;
      const p1 = i ? bars[i - 1] : b;
      if (trend === 1 && b.h > l.p && p1.h <= l.p) { l.crossed = true; l.vol = b.v; }
      if (trend === -1 && b.l < l.p && p1.l >= l.p) { l.crossed = true; l.vol = b.v; }
    }
  }
  return { trend, line: trend === 1 ? lo : up, flip, levels };
}
