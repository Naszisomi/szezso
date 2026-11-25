// TGIF-ár és volumendivergencia.
//  TGIF: a hét eddigi (hétfő 00:00 NY óta) tartományának 25%-os visszahúzódása a hét irányával szemben
//  (bikás hétnél a csúcstól lefelé, medvésnél az aljtól felfelé) – narancs vonal "TGIF" felirattal, minden napra.
//  Volumendivergencia: két egymást követő swing-csúcsnál magasabb ár, de kisebb volumen = medvés (piros);
//  két swing-aljnál alacsonyabb ár, de kisebb volumen = bikás (zöld, fogy az eladó). A volumen panelen,
//  szaggatott vonallal a volumenoszlopok fölött.
import { swings } from "./osc.js";

export function tgif(bars, barSec, ny, pct = 0.25) {
  const days = [];
  let wkStart = -1, wkOpen = 0, hi = -Infinity, lo = Infinity, curDay = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (ny.wd[i] === 1 && (i === 0 || ny.wd[i - 1] !== 1)) { wkStart = i; wkOpen = b.o; hi = -Infinity; lo = Infinity; }
    if (wkStart < 0) continue;
    if (!curDay || curDay.day !== ny.day[i]) {
      if (curDay) days.push(curDay);
      curDay = { day: ny.day[i], i0: i, i1: i, level: NaN, bull: true };
    }
    hi = Math.max(hi, b.h); lo = Math.min(lo, b.l);
    const bull = b.c >= wkOpen;
    curDay.i1 = i; curDay.bull = bull; curDay.level = bull ? hi - (hi - lo) * pct : lo + (hi - lo) * pct; curDay.fri = ny.wd[i] === 5;
  }
  if (curDay) days.push(curDay);
  return days.slice(-5);
}

export function tgifLayer(bars, barSec, days) {
  const items = [], last = bars.length - 1;
  days.forEach((d, k) => {
    if (isNaN(d.level)) return;
    const recent = k === days.length - 1;
    const t2 = recent ? bars[last].t + 5 * barSec * 1000 : bars[d.i1].t;
    items.push({ type: "line", t1: bars[d.i0].t, p1: d.level, t2, p2: d.level, color: "#FF9800", width: d.fri ? 3 : 2, style: "solid" });
    items.push({ type: "label", t: t2, p: d.level, text: `TGIF ${+d.level.toPrecision(6)}`, color: "#FF9800", size: 13, align: "left", vAlign: "middle", bold: d.fri });
  });
  return items;
}

export function volDivergence(bars, len = 5, keep = 6) {
  const sw = swings(bars, len), out = [];
  for (let k = 1; k < sw.hi.length; k++) {
    const a = sw.hi[k - 1], b = sw.hi[k];
    if (bars[b].h > bars[a].h && bars[b].v < bars[a].v) out.push({ a, b, bear: true });
  }
  for (let k = 1; k < sw.lo.length; k++) {
    const a = sw.lo[k - 1], b = sw.lo[k];
    if (bars[b].l < bars[a].l && bars[b].v < bars[a].v) out.push({ a, b, bear: false });
  }
  return out.sort((x, y) => x.b - y.b).slice(-keep);
}

export function volDivLayer(bars, divs) {
  return divs.map(d => ({ type: "line", pane: "vol", t1: bars[d.a].t, p1: bars[d.a].v * 1.08, t2: bars[d.b].t, p2: bars[d.b].v * 1.08,
    color: d.bear ? "#F23645" : "#089981", width: 2, style: "dashed" }));
}
