// Belépési szűrők a papírkereskedéshez (rács és silver bullet):
//  • Volumendivergencia (5m és 15m): bikás után nincs új short belépő (illogikus alul shortolni), medvés után nincs új long.
//    A tiltás feloldódik, ha az ár a divergencia szélső pontjától legalább 1 ATR-t elmozdult a jelzett irányba,
//    vagy elérte az onnan számított első vastag egyezésvonalat – legfeljebb 4 óráig él.
//  • RSI / KDJ (5m vagy 15m) plusz jelként felülírja a tiltást: short mellett RSI ≥ 70 vagy J > 100, long mellett RSI ≤ 30 vagy J < 0.
import { volDivergence } from "./engine/extra.js";
import { rsi, kdj } from "./engine/osc.js";

const MAXAGE = 4 * 3600000;

function atr14(arr) {
  const out = []; let a = 0;
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i], p = arr[i - 1] || b, tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14; out.push(a);
  }
  return out;
}
// 5m gyertyákból 15m
export function to15(bars) {
  const out = [];
  for (const b of bars) {
    const t = Math.floor(b.t / 900000) * 900000, x = out[out.length - 1];
    if (x && x.t === t) { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.v += b.v || 0; }
    else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
  }
  return out;
}

export function makeFilter(bars5, bars15) {
  const ser = [], divs = [];
  for (const [arr, ms, tf] of [[bars5, 300000, "5m"], [bars15, 900000, "15m"]]) {
    if (!arr || arr.length < 30) continue;
    const r = rsi(arr.map(b => b.c)), { J } = kdj(arr), at = atr14(arr);
    ser.push({ arr, ms, tf, r, J });
    for (const d of volDivergence(arr, 5, 100000)) if (arr[d.b + 5])
      divs.push({ conf: arr[d.b + 5].t + ms, bear: d.bear, tf, ext: d.bear ? arr[d.b].h : arr[d.b].l, atr: at[d.b] });
  }
  divs.sort((x, y) => x.conf - y.conf);
  const fine = ser[0];                                   // a legfinomabb idősík az ár követéséhez
  // az utolsó, t időpontig lezárt gyertya indexe
  const idx = (s, t) => { let lo = 0, hi = s.arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s.arr[m].t + s.ms <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };

  return {
    // null, ha szabad; különben { why }. dir: 1 long, -1 short; lines: vastag egyezésvonalak [{p}]
    check(t, dir, lines = []) {
      let d = null;
      for (const x of divs) { if (x.conf > t) break; if (x.conf > t - MAXAGE) d = x; }
      if (!d || (d.bear ? 1 : -1) !== dir) return null;
      // feloldás: elmozdulás a jelzett irányba (bikásnál fel, medvésnél le) a megerősítés óta
      if (fine) {
        const a = idx(fine, d.conf) + 1, z = idx(fine, t);
        let ext = d.bear ? Infinity : -Infinity;
        for (let i = Math.max(0, a); i <= z; i++) ext = d.bear ? Math.min(ext, fine.arr[i].l) : Math.max(ext, fine.arr[i].h);
        const line = d.bear ? Math.max(...lines.map(g => g.p).filter(p => p < d.ext - d.atr * 0.2), -Infinity)
                            : Math.min(...lines.map(g => g.p).filter(p => p > d.ext + d.atr * 0.2), Infinity);
        if (d.bear ? ext <= d.ext - d.atr || ext <= line : ext >= d.ext + d.atr || ext >= line) return null;
      }
      // RSI / KDJ felülírja
      for (const s of ser) {
        const i = idx(s, t); if (i < 0) continue;
        if (dir < 0 ? s.r[i] >= 70 || s.J[i] > 100 : s.r[i] <= 30 || s.J[i] < 0) return null;
      }
      return { why: `${d.bear ? "medvés" : "bikás"} volumendivergencia (${d.tf})` };
    },
  };
}
