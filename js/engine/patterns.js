// Minták (rejtett igazolás): chartminták, gyertyaminták, harmonikus minták.
//  A chartmintákat a theEccentricTrader-könyvtárak helyett saját szabályokkal ismeri fel (azok kódja nem olvasható),
//  a harmonikusokat a küldött cheat sheet fib-arányaival, a gyertyamintákat a szokásos definíciókkal.
import { swings } from "./osc.js";
import { atr } from "./gaps.js";

// váltakozó (csúcs–alj–csúcs…) pivotsor a swingekből; az utolsó, még futó szélsőérték is bekerül
export function zigzag(bars, len = 5) {
  const sw = swings(bars, len), pts = [];
  for (const i of sw.hi) pts.push({ i, p: bars[i].h, hi: true });
  for (const i of sw.lo) pts.push({ i, p: bars[i].l, hi: false });
  pts.sort((a, b) => a.i - b.i);
  const z = [];
  for (const q of pts) {
    const l = z[z.length - 1];
    if (l && l.hi === q.hi) { if (q.hi ? q.p > l.p : q.p < l.p) z[z.length - 1] = q; }
    else z.push(q);
  }
  // futó szélsőérték az utolsó pivot után
  const last = z[z.length - 1];
  if (last) {
    let k = last.i + 1, best = null;
    for (let i = last.i + 1; i < bars.length; i++) {
      const v = last.hi ? bars[i].l : bars[i].h;
      if (best === null || (last.hi ? v < best : v > best)) { best = v; k = i; }
    }
    if (best !== null) z.push({ i: k, p: best, hi: !last.hi, live: true });
  }
  return z;
}

// ── Chartminták ──
export function chartPatterns(bars, z, a) {
  const out = [], n = z.length, tol = a * 0.6;
  if (n < 5) return out;
  const P = k => z[n - 1 - k];                         // P(0) = legutolsó
  const [p0, p1, p2, p3, p4] = [P(0), P(1), P(2), P(3), P(4)];
  // dupla csúcs / alj (p2 és p0 azonos szintű csúcs/alj, köztük p1 a nyakvonal)
  if (Math.abs(p0.p - p2.p) <= tol && p0.hi === p2.hi) {
    const neck = p1.p, h = Math.abs(p2.p - neck);
    out.push(p0.hi ? { name: "Dupla csúcs", dir: -1, neck, target: neck - h } : { name: "Dupla alj", dir: 1, neck, target: neck + h });
  }
  // fej-váll (p4, p2, p0 vállak–fej–váll; p3, p1 nyakvonal)
  if (n >= 5 && p0.hi === p2.hi && p2.hi === p4.hi) {
    const head = p2.p, sh = [p4.p, p0.p], neck = (p1.p + p3.p) / 2;
    if (p0.hi && head > Math.max(...sh) + tol && Math.abs(sh[0] - sh[1]) <= 2 * tol)
      out.push({ name: "Fej-váll", dir: -1, neck, target: neck - (head - neck) });
    if (!p0.hi && head < Math.min(...sh) - tol && Math.abs(sh[0] - sh[1]) <= 2 * tol)
      out.push({ name: "Fordított fej-váll", dir: 1, neck, target: neck + (neck - head) });
  }
  // háromszögek / ékek / csatornák (az utolsó két csúcs és két alj meredeksége)
  const hs = z.slice(-6).filter(q => q.hi), ls = z.slice(-6).filter(q => !q.hi);
  if (hs.length >= 2 && ls.length >= 2) {
    const [h1, h2] = hs.slice(-2), [l1, l2] = ls.slice(-2);
    const sh = (h2.p - h1.p) / Math.max(1, h2.i - h1.i), sl = (l2.p - l1.p) / Math.max(1, l2.i - l1.i), flat = a * 0.05;
    const H = Math.max(h1.p, h2.p) - Math.min(l1.p, l2.p);
    let pat = null;
    if (Math.abs(sh) <= flat && sl > flat) pat = { name: "Emelkedő háromszög", dir: 1, target: h2.p + H };
    else if (sh < -flat && Math.abs(sl) <= flat) pat = { name: "Ereszkedő háromszög", dir: -1, target: l2.p - H };
    else if (sh < -flat && sl > flat) pat = { name: "Szimmetrikus háromszög", dir: 0, target: null };
    else if (sh > flat && sl > flat && sl > sh * 1.2) pat = { name: "Emelkedő ék", dir: -1, target: Math.min(l1.p, l2.p) };
    else if (sh < -flat && sl < -flat && sh < sl * 1.2) pat = { name: "Ereszkedő ék", dir: 1, target: Math.max(h1.p, h2.p) };
    else if (sh > flat && sl > flat && Math.abs(sh - sl) <= Math.abs(sh) * 0.3) pat = { name: "Emelkedő csatorna", dir: 1, target: h2.p + sh * 10 };
    else if (sh < -flat && sl < -flat && Math.abs(sh - sl) <= Math.abs(sh) * 0.3) pat = { name: "Ereszkedő csatorna", dir: -1, target: l2.p + sl * 10 };
    if (pat) out.push(pat);
  }
  return out;
}

// ── Gyertyaminták (az utolsó lezárt gyertyákon) ──
export function candlePatterns(bars, a) {
  const out = [];
  let N = bars.length; if (N && !bars[N - 1].done) N--;
  if (N < 4) return out;
  const c = bars[N - 1], p = bars[N - 2], q = bars[N - 3];
  const body = b => Math.abs(b.c - b.o), rng = b => b.h - b.l || 1e-9, up = b => b.c > b.o;
  const upW = b => b.h - Math.max(b.o, b.c), loW = b => Math.min(b.o, b.c) - b.l;
  const down = bars[N - 5] && c.c < bars[N - 5].c, rise = bars[N - 5] && c.c > bars[N - 5].c;   // rövid környezet
  if (body(c) <= rng(c) * 0.1) out.push({ name: "Doji", dir: 0 });
  if (loW(c) >= 2 * body(c) && upW(c) <= body(c) * 0.5 && body(c) > 0) out.push({ name: down ? "Kalapács" : "Akasztott ember", dir: down ? 1 : -1 });
  if (upW(c) >= 2 * body(c) && loW(c) <= body(c) * 0.5 && body(c) > 0) out.push({ name: rise ? "Hullócsillag" : "Fordított kalapács", dir: rise ? -1 : 1 });
  if (up(c) && !up(p) && c.c >= p.o && c.o <= p.c && body(c) > body(p)) out.push({ name: "Bikás bekebelezés", dir: 1 });
  if (!up(c) && up(p) && c.o >= p.c && c.c <= p.o && body(c) > body(p)) out.push({ name: "Medvés bekebelezés", dir: -1 });
  if (Math.max(c.o, c.c) < Math.max(p.o, p.c) && Math.min(c.o, c.c) > Math.min(p.o, p.c) && body(p) > a * 0.5)
    out.push({ name: up(p) ? "Medvés harami" : "Bikás harami", dir: up(p) ? -1 : 1 });
  if (c.h < p.h && c.l > p.l) out.push({ name: "Inside bar", dir: 0 });
  if (Math.abs(c.h - p.h) <= a * 0.05 && up(p) && !up(c)) out.push({ name: "Csipesz csúcs", dir: -1 });
  if (Math.abs(c.l - p.l) <= a * 0.05 && !up(p) && up(c)) out.push({ name: "Csipesz alj", dir: 1 });
  if (!up(q) && body(p) <= body(q) * 0.3 && up(c) && c.c > (q.o + q.c) / 2) out.push({ name: "Hajnalcsillag", dir: 1 });
  if (up(q) && body(p) <= body(q) * 0.3 && !up(c) && c.c < (q.o + q.c) / 2) out.push({ name: "Esti csillag", dir: -1 });
  if ([q, p, c].every(up) && c.c > p.c && p.c > q.c && [q, p, c].every(b => body(b) > a * 0.5)) out.push({ name: "Három fehér katona", dir: 1 });
  if ([q, p, c].every(b => !up(b)) && c.c < p.c && p.c < q.c && [q, p, c].every(b => body(b) > a * 0.5)) out.push({ name: "Három fekete varjú", dir: -1 });
  return out;
}

// ── Harmonikus minták (X-A-B-C-D, ±5% tűrés) ──
const HARM = [
  { name: "Gartley",   ab: [0.618, 0.618], bc: [0.382, 0.886], cd: [1.272, 1.618], ad: [0.786, 0.786] },
  { name: "Bat",       ab: [0.382, 0.5],   bc: [0.382, 0.886], cd: [1.618, 2.618], ad: [0.886, 0.886] },
  { name: "Butterfly", ab: [0.786, 0.786], bc: [0.382, 0.886], cd: [1.618, 2.24],  ad: [1.27, 1.618] },
  { name: "Crab",      ab: [0.382, 0.618], bc: [0.382, 0.886], cd: [2.24, 3.618],  ad: [1.618, 1.618] },
  { name: "Deep Crab", ab: [0.886, 0.886], bc: [0.382, 0.886], cd: [2.0, 3.618],   ad: [1.618, 1.618] },
  { name: "Shark",     ab: [0.382, 0.886], bc: [1.13, 1.618],  cd: [1.618, 2.24],  ad: [0.886, 1.13] },
  { name: "Cypher",    ab: [0.382, 0.618], bc: [1.272, 1.414], cd: [1.272, 2.0],   ad: [0.786, 0.786] },
];
export function harmonics(z) {
  const out = [], n = z.length;
  if (n < 5) return out;
  const [X, A, B, C, D] = z.slice(-5);
  const XA = Math.abs(A.p - X.p), AB = Math.abs(B.p - A.p), BC = Math.abs(C.p - B.p), CD = Math.abs(D.p - C.p), AD = Math.abs(A.p - D.p);
  if (!XA || !AB || !BC) return out;
  const r = { ab: AB / XA, bc: BC / AB, cd: CD / BC, ad: AD / XA };
  const ok = (v, [lo, hi]) => v >= lo * 0.95 && v <= hi * 1.05;
  const bull = !D.hi;                                   // D egy alj → bikás minta
  for (const h of HARM) if (ok(r.ab, h.ab) && ok(r.bc, h.bc) && ok(r.cd, h.cd) && ok(r.ad, h.ad))
    out.push({ name: (bull ? "Bikás " : "Medvés ") + h.name, dir: bull ? 1 : -1, prz: D.p, live: !!D.live, target: C.p });
  // AB=CD
  if (ok(r.bc, [0.382, 0.886]) && CD / AB >= 0.9 && CD / AB <= 1.1)
    out.push({ name: (bull ? "Bikás" : "Medvés") + " AB=CD", dir: bull ? 1 : -1, prz: D.p, live: !!D.live, target: B.p });
  return out;
}

export function allPatterns(bars) {
  if (bars.length < 40) return { chart: [], candle: [], harmonic: [] };
  const a = atr(bars, 14)[bars.length - 1] || 0, z = zigzag(bars, 5);
  return { chart: chartPatterns(bars, z, a), candle: candlePatterns(bars, a), harmonic: harmonics(z), zz: z.slice(-8) };
}
