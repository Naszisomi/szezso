// Gann-időnaptár (Soma képernyőképei alapján) – időbeli igazolás a motorhoz (±2 nap tűrés):
//  1) a 8 szezonális fordulópont (a 360°-os kör 45°-onként), 2) a figyelőablakok,
//  3) a jelentős csúcsoktól/aljaktól mért ciklusok (naptári napok), 4) évfordulók (6 hó, 1, 2, 5 év).
import { swings } from "./osc.js";

const DAY = 86400000;
export const GANN_SEASONAL = [
  { deg: 0,   m: 3,  d: [21],     major: true,  text: "Tavaszi napéjegyenlőség (Gann-év kezdete)" },
  { deg: 45,  m: 5,  d: [5, 6],   major: false, text: "Tavaszi napéjegyenlőség – nyári napforduló felezője" },
  { deg: 90,  m: 6,  d: [21, 22], major: true,  text: "Nyári napforduló" },
  { deg: 135, m: 8,  d: [7, 8],   major: false, text: "Nyári napforduló – őszi napéjegyenlőség felezője" },
  { deg: 180, m: 9,  d: [22, 23], major: true,  text: "Őszi napéjegyenlőség" },
  { deg: 225, m: 11, d: [7, 8],   major: false, text: "Őszi napéjegyenlőség – téli napforduló felezője" },
  { deg: 270, m: 12, d: [21, 22], major: true,  text: "Téli napforduló" },
  { deg: 315, m: 2,  d: [4],      major: false, text: "Téli napforduló – tavaszi napéjegyenlőség felezője" },
];
export const GANN_WINDOWS = [
  { m: 1, d1: 2,  d2: 7,  text: "Évnyitó pozícionálás" },
  { m: 1, d1: 15, d2: 21, text: "Első korrekciós ablak" },
  { m: 7, d1: 3,  d2: 7,  text: "Féléves forduló" },
  { m: 7, d1: 20, d2: 27, text: "Féléves forduló" },
];
export const GANN_CYCLES = [7, 14, 21, 30, 45, 60, 90, 120, 135, 144, 180, 225, 270, 315, 360];
export const GANN_YEARS = {
  2026: "18,6 és 60 éves ciklus metszéspontja: pánik/esés vége, magas volatilitású trendváltó ablak",
  2027: "A 2027–2031-es ciklus kezdete (alacsony árak, mélypontok); a 7-re végződő évek éles korrekciókat hoznak",
};

// Események egy időablakban: { t1, t2, kind, weight, text }
export function gannEvents(daily, fromMs, toMs, tol = 2) {
  const out = [], y0 = new Date(fromMs).getUTCFullYear(), y1 = new Date(toMs).getUTCFullYear();
  for (let y = y0; y <= y1; y++) {
    for (const s of GANN_SEASONAL) {
      const a = Date.UTC(y, s.m - 1, s.d[0]) - tol * DAY, b = Date.UTC(y, s.m - 1, s.d[s.d.length - 1]) + tol * DAY;
      out.push({ t1: a, t2: b, kind: "szezonális", weight: s.major ? 2 : 1, text: `Gann ${s.deg}° – ${s.text}` });
    }
    for (const w of GANN_WINDOWS) out.push({ t1: Date.UTC(y, w.m - 1, w.d1), t2: Date.UTC(y, w.m - 1, w.d2) + DAY - 1, kind: "ablak", weight: 1, text: "Gann-ablak – " + w.text });
  }
  if (daily && daily.length > 30) {
    // jelentős swingek a napi charton (10 nap mindkét oldalon) + az időszak csúcsa/alja
    const sw = swings(daily, 10), piv = [];
    for (const i of sw.hi) piv.push({ t: daily[i].t, hi: true, p: daily[i].h });
    for (const i of sw.lo) piv.push({ t: daily[i].t, hi: false, p: daily[i].l });
    let hiI = 0, loI = 0;
    daily.forEach((b, i) => { if (b.h > daily[hiI].h) hiI = i; if (b.l < daily[loI].l) loI = i; });
    const majors = [{ t: daily[hiI].t, hi: true, p: daily[hiI].h, major: true }, { t: daily[loI].t, hi: false, p: daily[loI].l, major: true }];
    for (const p of piv.slice(-8).concat(majors)) {
      for (const c of GANN_CYCLES) {
        const t = p.t + c * DAY;
        if (t >= fromMs - tol * DAY && t <= toMs + tol * DAY)
          out.push({ t1: t - tol * DAY, t2: t + tol * DAY, kind: "ciklus", weight: c >= 90 ? 2 : 1,
            text: `${c} nap ${p.hi ? "a csúcstól" : "az aljtól"} (${new Date(p.t).toLocaleDateString("hu-HU", { timeZone: "UTC" })})` });
      }
    }
    for (const p of majors) {
      const d = new Date(p.t);
      for (const [mo, lbl] of [[6, "6 hónapos"], [12, "1 éves"], [24, "2 éves"], [60, "5 éves"]]) {
        const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + mo, d.getUTCDate());
        if (t >= fromMs - tol * DAY && t <= toMs + tol * DAY)
          out.push({ t1: t - tol * DAY, t2: t + tol * DAY, kind: "évforduló", weight: 2, text: `${lbl} évforduló – ${p.hi ? "csúcs" : "alj"} ${p.p}` });
      }
    }
  }
  return out.filter(e => e.t2 >= fromMs && e.t1 <= toMs).sort((a, b) => a.t1 - b.t1);
}

// Az adott időpontra eső Gann-súly (az EGYEZÉS időtényezője)
export function gannTimeScore(events, t) {
  let w = 0; const why = [];
  for (const e of events) if (t >= e.t1 && t <= e.t2) { w += e.weight; why.push(e.text); }
  return { w, why };
}
