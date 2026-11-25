// Wyckoff-fázis (rejtett, valószínűséggel) – a szabványos sémák (Pruden / Forte) egyszerűsített szabályai:
//  kereskedési tartomány az utolsó `look` gyertyán (a zárók 5–95%-a), előtte lévő trend iránya,
//  események: SC/BC (kifulladás nagy volumennel a tartomány szélén), AR, Spring / UTAD (kanóc a tartományon
//  túl, visszazárás belülre), SOS / SOW (zárás a tartományon túl átlag feletti volumennel), LPS / LPSY (reteszt).
//  Típus: akkumuláció / disztribúció (a megelőző trenddel ellentétes) vagy re-akkumuláció / redisztribúció
//  (a nagyobb trend – EMA200 – folytatása); a tartományon kívül markup / markdown.
import { ema } from "./osc.js";
import { atr } from "./gaps.js";

export function wyckoff(bars, look = 80) {
  const N = bars.length;
  if (N < look * 2 + 10) return null;
  const s = N - look, closes = bars.slice(s).map(b => b.c).sort((a, b) => a - b);
  const lo = closes[Math.floor(look * 0.05)], hi = closes[Math.floor(look * 0.95)];
  const a = atr(bars, 14)[N - 1], w = hi - lo;
  if (!(w > 0) || w > 12 * a) return { phase: "trend", type: bars[N - 1].c > bars[s].c ? "markup" : "markdown", p: 0.5 };
  const prior = bars[s].c - bars[Math.max(0, s - look)].c;          // a tartomány előtti láb
  const e200 = ema(bars.map(b => b.c), 200), bigUp = e200[N - 1] > e200[Math.max(0, N - look)];
  const priorUp = prior > 0;
  let vAvg = 0; for (let i = s; i < N; i++) vAvg += bars[i].v; vAvg /= look;
  // események
  const ev = {};
  for (let i = s; i < Math.min(N, s + Math.floor(look / 3)); i++) {
    const b = bars[i];
    if (b.v > 2 * vAvg && b.l <= lo + w * 0.1) ev.SC = i;
    if (b.v > 2 * vAvg && b.h >= hi - w * 0.1) ev.BC = i;
  }
  for (let i = s + 5; i < N; i++) {
    const b = bars[i];
    if (b.l < lo - a * 0.3 && b.c > lo) ev.Spring = i;
    if (b.h > hi + a * 0.3 && b.c < hi) ev.UTAD = i;
    if (b.c > hi + a * 0.2 && b.v > 1.3 * vAvg) ev.SOS = i;
    if (b.c < lo - a * 0.2 && b.v > 1.3 * vAvg) ev.SOW = i;
    if (ev.SOS !== undefined && i > ev.SOS && b.l <= hi + a * 0.2 && b.c > hi) ev.LPS = i;
    if (ev.SOW !== undefined && i > ev.SOW && b.h >= lo - a * 0.2 && b.c < lo) ev.LPSY = i;
  }
  const accum = !priorUp, cont = priorUp === bigUp;
  const type = accum ? (cont ? "re-akkumuláció" : "akkumuláció") : (cont ? "redisztribúció" : "disztribúció");
  const want = accum ? ["SC", "Spring", "SOS", "LPS"] : ["BC", "UTAD", "SOW", "LPSY"];
  const got = want.filter(k => ev[k] !== undefined);
  const phase = got.includes(want[3]) ? "E" : got.includes(want[2]) ? "D" : got.includes(want[1]) ? "C" : got.includes(want[0]) ? "A–B" : "B";
  const dir = accum ? 1 : -1;
  return { type, phase, events: got, dir, lo, hi, p: Math.min(0.9, 0.35 + 0.15 * got.length),
    target: dir === 1 ? hi + w : lo - w };
}
