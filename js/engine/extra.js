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

// Futó láb divergenciája (még meg nem erősített swinggel is), a klasszikus szabály szerint:
// medvés: az ár ÚJ csúcsot tesz (az utolsó 5 gyertyában), de a csúcs körüli volumen legalább 30%-kal kisebb,
// mint a láb előző csúcsánál, és a volumen most sem nő (utolsó 3 átlaga ≤ előző 3); bikás: ugyanez aljakkal.
// (Egy egyszeri, ellentétes irányú volumenkiugrás nem számít – a két árcsúcs/-alj körüli volument vetjük össze.)
function legDivergence(bars, atrArr, look = 40) {
  const N = bars.length;
  if (N < look + 10) return null;
  const s = N - look, a = atrArr[N - 1];
  let iLo = s, iHi = s;
  for (let i = s; i < N; i++) { if (bars[i].l < bars[iLo].l) iLo = i; if (bars[i].h > bars[iHi].h) iHi = i; }
  if (isNaN(a) || bars[iHi].h - bars[iLo].l < 2 * a) return null;
  const vAt = i => { let t = 0, n = 0; for (let k = Math.max(0, i - 2); k <= Math.min(N - 1, i + 2); k++) { t += bars[k].v; n++; } return t / n; };
  const avg = (x, y) => { let t = 0; for (let k = x; k <= y; k++) t += bars[k].v; return t / (y - x + 1); };
  const notRising = avg(N - 3, N - 1) <= avg(N - 6, N - 4);
  const bear = iLo < iHi && iHi >= N - 5, bull = iHi < iLo && iLo >= N - 5;
  if (!(bear || bull) || !notRising) return null;
  // a láb előző csúcsa / alja (a mostani lökés előtt)
  const from = bear ? iLo : iHi, to = N - 6;
  if (to - from < 3) return null;
  let j = from;
  for (let i = from; i <= to; i++) if (bear ? bars[i].h > bars[j].h : bars[i].l < bars[j].l) j = i;
  const k = bear ? iHi : iLo;
  if (k - j < 4) return null;
  if (bear ? bars[k].h <= bars[j].h : bars[k].l >= bars[j].l) return null;
  if (vAt(k) >= 0.7 * vAt(j)) return null;
  return { a: j, b: k, bear, live: true };
}

export function volDivergence(bars, len = 5, keep = 6, atrArr = null) {
  const sw = swings(bars, len), out = [];
  for (let k = 1; k < sw.hi.length; k++) {
    const a = sw.hi[k - 1], b = sw.hi[k];
    if (bars[b].h > bars[a].h && bars[b].v < bars[a].v) out.push({ a, b, bear: true });
  }
  for (let k = 1; k < sw.lo.length; k++) {
    const a = sw.lo[k - 1], b = sw.lo[k];
    if (bars[b].l < bars[a].l && bars[b].v < bars[a].v) out.push({ a, b, bear: false });
  }
  const res = out.sort((x, y) => x.b - y.b).slice(-keep);
  if (atrArr) { const lg = legDivergence(bars, atrArr); if (lg) res.push(lg); }
  return res;
}

export function volDivLayer(bars, divs) {
  return divs.map(d => ({ type: "line", pane: "vol", t1: bars[d.a].t, p1: bars[d.a].v * 1.08, t2: bars[d.b].t, p2: bars[d.b].v * 1.08,
    color: d.bear ? "#F23645" : "#089981", width: d.live ? 3 : 2, style: "dashed", arrow: !!d.live }));
}
