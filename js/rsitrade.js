// „RSI” kereskedés (v2.5): lazább RSI–KDJ–ICT–CRT jel, mindig a legalsó rácsnak fenntartott számlán (Al4).
// A tesztelt legjobb (F) változat, az 55 napos valódi adaton: 13 kereskedés, egy sem ragadt bent, max. ellenmozgás 6,5 $.
//  • Jel a 15m gyertya zárásakor: long, ha a 15m RSI < 30 és a J < 15, az ár áttörte az előző 4h gyertya alját,
//    és a 4h RSI is nyújtott (< 35). Short: RSI > 70, J > 85, az előző 4h teteje áttörve, 4h RSI > 65.
//  • Belépő: piaci áron a záráskor. Irányonként egyszerre egy.
//  • Cél: az előző (lezárt) 1h gyertya teteje (longnál) – 1. DCA után a közepe, 2. DCA után az alja; mindig legalább
//    0,1 $-ral az átlagár jó oldalán.
//  • DCA1: 4h RSI + KDJ jel (long: 4h RSI < 30 és J < 15; short: > 70 és > 85), ha az ár a belépő rossz oldalán van.
//    DCA2: az előző napi gyertya aljának (longnál) / tetejének kivétele. Lábak: 1/1/2 egység.
//  • Végső kilépés: ha a 2. DCA után az ár még 5 $-t megy ellenünk, piaci áron zár (a teszten nem kellett, csak védelem).
import { rsi, kdj } from "./engine/osc.js";
import { unitFor } from "./grid.js";

const H = 3600000, MAKER = 0.0002, TAKER = 0.0005, UN = [1, 1, 2], STOPX = 5;

export function simulateRSI(b15, b1h, b4h, daily, cfg) {
  const trades = [], events = [];
  if (!b15 || b15.length < 50 || !b4h || b4h.length < 20) return { trades, events };
  const R15 = rsi(b15.map(x => x.c)), J15 = kdj(b15).J, R4 = rsi(b4h.map(x => x.c)), J4 = kdj(b4h).J;
  const tk = cfg.tick || 0, slip = 2 * tk, acc = cfg.acc || "Al4", from = cfg.from || 0;
  const lastClosed = (arr, t, ms) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t + ms <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
  const cur = { 1: null, [-1]: null };
  let id = 0, real = 0;
  const side = d => d > 0 ? "long" : "short";
  const fill = (T, p, units, t, why, rate) => {
    const q = units * T.unit, fee = q * p * rate;
    T.qty += q; T.open += q; T.cost += q * p; T.avg = T.cost / T.qty; T.fees += fee; T.filled++; T.lastFill = t;
    T.fills.push({ t, p, qty: q, why, fee }); real -= fee;
    events.push({ t, acc, pnl: -fee, trade: T.id, why: `RSI ${side(T.dir)} ${why} díj` });
  };
  const close = (T, px, t, why, rate) => {
    const q = T.open, fee = q * px * rate, pnl = T.dir * (px - T.avg) * q;
    T.open = 0; T.fees += fee; T.realized += pnl; T.exits.push({ t, p: px, qty: q, why, pnl, fee }); T.state = "lezárva"; T.closeT = t; T.tpHit = [0];
    real += pnl - fee; events.push({ t, acc, pnl: pnl - fee, trade: T.id, why: `RSI ${side(T.dir)} ${why}` });
  };
  const tpOf = T => {
    const h = T.h1, d = T.dir, k = Math.min(T.filled, 3) - 1;
    let p = d > 0 ? [h.h, (h.h + h.l) / 2, h.l][k] : [h.l, (h.h + h.l) / 2, h.h][k];
    if (d * (p - T.avg) < 0.1) p = T.avg + d * 0.1;
    const why = ["az előző 1h teteje/alja", "az előző 1h közepe", "az előző 1h alja/teteje"][k];
    T.tp = { p, why }; T.tps = [T.tp];
  };
  for (let i = 30; i < b15.length; i++) {
    const x = b15[i], tC = x.t + 900000;
    // futó kereskedések
    for (const d of [1, -1]) {
      const T = cur[d];
      if (!T) continue;
      if (T.filled === 1) {
        const k = lastClosed(b4h, tC, 4 * H);
        if (k > 0 && R4[k] != null && (d > 0 ? R4[k] < 30 && J4[k] < 15 : R4[k] > 70 && J4[k] > 85) && d * (T.legs[0].p - x.c) > 0) {
          T.legs.push({ p: x.c, why: "DCA1 (4h RSI/KDJ jel)", units: UN[1] }); fill(T, x.c + d * slip, UN[1], x.t, "DCA1", TAKER); tpOf(T);
        }
      }
      if (T.filled === 2) {
        const kd = lastClosed(daily, x.t, 86400000);
        if (kd >= 0) {
          const lvl = d > 0 ? daily[kd].l : daily[kd].h;
          if (d > 0 ? x.l < lvl - tk && lvl < T.legs[1].p : x.h > lvl + tk && lvl > T.legs[1].p) { T.legs.push({ p: lvl, why: "DCA2 (előző napi alj/tető kivétele)", units: UN[2] }); fill(T, lvl, UN[2], x.t, "DCA2", MAKER); tpOf(T); }
        }
      }
      if (T.filled === 3 && d * (T.legs[2].p - (d > 0 ? x.l : x.h)) >= STOPX) { close(T, T.legs[2].p - d * STOPX - d * slip, x.t, `végső kilépés (${STOPX} $ a 2. DCA után)`, TAKER); cur[d] = null; continue; }
      if (T.lastFill !== x.t && (d > 0 ? x.h >= T.tp.p + tk : x.l <= T.tp.p - tk)) { close(T, T.tp.p, x.t, `TP (${T.tp.why})`, MAKER); cur[d] = null; }
    }
    // új jel a 15m záráskor
    if (x.t < from || R15[i] == null) continue;
    for (const d of [1, -1]) {
      if (cur[d] || cfg.halted && cfg.halted(x.t)) continue;
      if (!(d > 0 ? R15[i] < 30 && J15[i] < 15 : R15[i] > 70 && J15[i] > 85)) continue;
      const k4 = lastClosed(b4h, tC, 4 * H);
      if (k4 < 0 || R4[k4] == null) continue;
      const p4 = b4h[k4];
      if (!(d > 0 ? R4[k4] < 35 : R4[k4] > 65)) continue;                      // F: a 4h RSI is nyújtott
      if (!(d > 0 ? x.l < p4.l : x.h > p4.h)) continue;                          // az előző 4h alja/teteje áttörve
      const k1 = lastClosed(b1h, tC, H);
      if (k1 < 0) continue;
      const h1 = b1h[k1];
      if (d * ((d > 0 ? h1.h : h1.l) - x.c) <= 0.1) continue;                    // a cél a jó oldalon legyen
      const e = x.c + d * slip, eq = (cfg.bal || 17000) + real;
      const unit = cfg.sized ? unitFor(eq, d, [{ p: e, units: 1 }, { p: e - d * 5, units: 1 }, { p: e - d * 10, units: 2 }], cfg.swan || 50) : 1;
      if (unit <= 0) continue;
      const T = { id: ++id, acc, kind: "rsi", window: "RSI", dir: d, day: x.t, from: x.t, legs: [{ p: e, why: `entry (15m RSI ${Math.round(R15[i])}, J ${Math.round(J15[i])}, 4h RSI ${Math.round(R4[k4])})`, units: UN[0] }],
        unit, filled: 0, qty: 0, cost: 0, avg: null, open: 0, state: "aktív", role: "rsi", fills: [], exits: [], fees: 0, realized: 0, closeT: null, lastFill: -1, tpHit: [], shares: [1], h1 };
      fill(T, e, UN[0], x.t, "entry", TAKER); tpOf(T);
      trades.push(T); cur[d] = T;
    }
  }
  const last = b15[b15.length - 1];
  for (const T of trades) T.unreal = T.state === "aktív" ? T.dir * (last.c - T.avg) * T.open : 0;
  return { trades, events, last };
}
