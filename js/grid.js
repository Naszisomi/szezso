// Folyamatos rács-szimuláció (papírkereskedés és a chart terve), a 15 perces gyertyákon végigjátszva.
//
// Szabályok (a megbeszéltek szerint):
//  • Irányonként 6 számla (Fő, Al1–Al5), számlánként egy rács-kereskedés: entry + 3 DCA, 1/1/2/4 egység.
//  • Minden nap az Ázsia végén (00:00 NY) az aznapi terv a rács alapja (Ázsia alja / teteje). Ha egy korábbi
//    kereskedés entryje 3 dolláron belül van az alaphoz, az a mai alap. A szabad számlák (Fő elöl) a lépcső
//    következő szabad helyeire kerülnek; ugyanazon a szinten nem lehet két aktív kereskedés.
//  • Zárási szerepek az aktív (még semmit nem zárt) kereskedések átlagára szerint:
//      legrosszabb → TP1-nél egyben zár;  középsők (és ha csak egy fut) → 50/30/20% TP1/TP2/TP3, TP1 után pozitív stop;
//      legjobb (legtávolabbi) → swing: 50/30/20% TP2/TP3/1D cél, stop nélkül.
//  • TP-k idősíkonként: TP1 a 15m, TP2 az 1h (legalább 2 $-ra az átlagártól; a 15m rés pontosítja), TP3 a 4h,
//    a swing végső célja az 1D rése / szintje (TP3 és a swing legalább 1 $-ra az előzőtől). Hiányában a többi stratégiai szint.
//  • Napváltáskor: a nem nyereséges kereskedés bent marad; a swing fut tovább; a nyereséges többi, ha az új Ázsia-
//    határnál rosszabb helyen van, az Ázsia végén zár; ha jobb helyen van, a legfelső (legrosszabb) az új TP1-ig
//    fut, a többi pozitív stopot kap. A meg nem nyílt megbízások törlődnek.
//  • Méretezés (HYPE): az egység akkora, hogy a számla 10 $-ig esve (long) / 150 $-ig emelkedve (short) se
//    likvidálódjon, a cross mellett egy ugyanakkora izolált rácsot is feltételezve (annak csak a marginja veszhet el).
//  • Díjak: limit (entry, DCA, TP) 2 bp, stop és piaci zárás 5 bp.
import { UNITS } from "./engine/tradeutil.js";

export const ACC_NAMES = ["Fő", "Al1", "Al2", "Al3", "Al4", "Al5"];
const DAY = 86400000, MAKER = 0.0002, TAKER = 0.0005;
const SHARES = { full: [1, 0, 0, 0], split: [0.5, 0.3, 0.2, 0], swing: [0, 0.5, 0.3, 0.2] };

// a rács helyei egy napi tervből: entry, majd mindig az előző DCA1-e, legalább `gap` lépéssel
export function positions(p, n = 12) {
  const d = p.dir, gap = p.gap || 3, out = [{ entry: p.entry, dca: p.dca }];
  const pool = p.levels.filter(x => d > 0 ? x.p < p.entry.p : x.p > p.entry.p).sort((a, b) => d * (b.p - a.p));
  while (out.length < n) {
    const entry = out[out.length - 1].dca[0], dca = [];
    let ref = entry.p;
    for (const x of pool) { if (dca.length === 3) break; if (d > 0 ? x.p <= ref - gap : x.p >= ref + gap) { dca.push(x); ref = x.p; } }
    while (dca.length < 3) { ref -= d * gap; dca.push({ p: ref, why: "min. távolság" }); }
    out.push({ entry, dca });
  }
  return out;
}

// célok egy idősíkon a ref-en túl (profit oldalon), a legközelebbitől
function targets(p, tf, d, ref) {
  const c = p.cand && p.cand[tf];
  if (!c) return [];
  const out = [];
  for (const [bot, top] of c.gaps || []) {
    if (d > 0 ? bot <= ref : top >= ref) continue;
    let x = d > 0 ? bot : top, why = `${tf} rés`;
    if (tf === "h1") {                                  // a 15m rés pontosítja az 1h rést
      for (const [b2, t2] of (p.cand.m15 && p.cand.m15.gaps) || []) if (t2 >= bot && b2 <= top) {
        const y = d > 0 ? b2 : t2;
        if (y >= bot && y <= top && (d > 0 ? y > ref && y < x : y < ref && y > x)) { x = y; why = "1h rés (15m pontosítva)"; }
      }
    }
    out.push({ p: x, why });
  }
  for (const x of c.crt || []) if (d > 0 ? x > ref : x < ref) out.push({ p: x, why: `CRT ${tf}` });
  if (tf === "m15") for (const x of p.levels) if (/^(TLO|TNY|NYAM|TPM|TDO|TAO|TWO)$|^Milana/.test(x.why || "") && (d > 0 ? x.p > ref : x.p < ref)) out.push(x);
  return out.sort((a, b) => d * (a.p - b.p));
}
function nearest(p, tf, d, from, step) {
  const t = targets(p, tf, d, from)[0];
  const l = p.levels.filter(x => d > 0 ? x.p > from : x.p < from).sort((a, b) => d * (a.p - b.p))[0];
  // ha az idősík célja nagyon messze van (> 5%), a közelebbi stratégiai szint a tartalék
  if (t && !(l && d * (t.p - from) > Math.abs(from) * 0.05 && d * (l.p - from) < d * (t.p - from))) return t;
  return l ? { p: l.p, why: l.why + " (tartalék)" } : { p: from + d * step, why: "nincs szint" };
}
// TP1 (15m), TP2 (1h, ≥ minTp2 az átlagártól), TP3 (4h), swing cél (1D)
export function tpSet(p, avg, chain, minTp2) {
  const d = p.dir, g = p.tpGap || Math.abs(avg) * 0.002, step = Math.max(g * 4, Math.abs(avg) * 0.01);
  const f1 = chain != null ? (d > 0 ? Math.max(avg + g, chain + g) : Math.min(avg - g, chain - g)) : avg + d * g;
  const t1 = nearest(p, "m15", d, f1, step);
  const t2 = nearest(p, "h1", d, d > 0 ? Math.max(t1.p + g, avg + minTp2) : Math.min(t1.p - g, avg - minTp2), step);
  const sp = Math.max(g, minTp2 / 2);                 // a további TP-k is legalább fél „TP2-távolságra” egymástól
  const t3 = nearest(p, "h4", d, t2.p + d * sp, step);
  const t4 = nearest(p, "d1", d, t3.p + d * sp, step);
  return [t1, t2, t3, t4];
}

// egységnyi (1/1/2/4) rács kockázata dollárban, egységenként
function riskPerUnit(d, legs, lo, hi) {
  let r = 0;
  legs.forEach((l, i) => { const u = UNITS[i]; r += u * (d > 0 ? l.p - lo : hi - l.p) + u * l.p / 10; });
  return r;
}

// days: [{T, long, short, L?, rev?}] időrendben; bars: 15m gyertyák; cfg: {bal: {Fő: 17000…}, lo, hi, sized, minTp2, gap}
export function simulate(days, bars, cfg, now) {
  const trades = [], events = [];
  let id = 0;
  const byDir = { 1: [], [-1]: [] };                  // nyitott (vár / aktív / részben / védett) kereskedések irányonként
  const isOpen = t => t.state === "aktív" || t.state === "részben" || t.state === "védett";
  const touch = (b, d, x) => d > 0 ? b.l <= x : b.h >= x, reach = (b, d, x) => d > 0 ? b.h >= x : b.l <= x;

  const fill = (t, k, b) => {
    const l = t.legs[k], q = l.units * t.unit;
    t.qty += q; t.open += q; t.cost += q * l.p; t.avg = t.cost / t.qty; t.filled = k + 1; t.lastFill = b.t;
    const fee = q * l.p * MAKER;
    t.fees += fee; t.fills.push({ t: b.t, p: l.p, qty: q, why: k ? "DCA" + k : "entry", fee });
    events.push({ t: b.t, acc: t.acc, pnl: -fee, trade: t.id, why: (t.dir > 0 ? "long " : "short ") + (k ? "DCA" + k : "entry") + " díj" });
    if (t.state === "vár") t.state = "aktív";
  };
  const exit = (t, qty, px, time, why, fee) => {
    const q = Math.min(t.open, qty), f = q * px * fee, pnl = t.dir * (px - t.avg) * q;
    t.open -= q; t.fees += f; t.realized += pnl;
    t.exits.push({ t: time, p: px, qty: q, why, pnl, fee: f });
    events.push({ t: time, acc: t.acc, pnl: pnl - f, trade: t.id, why: (t.dir > 0 ? "long " : "short ") + why });
    if (t.open <= 1e-9) { t.open = 0; t.state = "lezárva"; t.closeT = time; }
  };

  // szerepek és TP-k az aktív (még semmit nem zárt) kereskedésekre
  const rank = d => {
    const list = byDir[d].filter(t => t.state === "aktív" && !t.lock);
    list.sort((a, b) => d * (b.avg - a.avg));
    let prev = null;
    list.forEach((t, k) => {
      t.role = list.length === 1 ? "split" : k === 0 ? "full" : k === list.length - 1 ? "swing" : "split";
      t.tps = tpSet(t.plan, t.avg, prev ? prev.tps[0].p : null, cfg.minTp2(t.avg)); t.shares = SHARES[t.role];
      prev = t;
    });
    for (const t of byDir[d]) if (t.lock && t.state === "aktív") t.tps = tpSet(t.plan, t.avg, null, cfg.minTp2(t.avg));
    for (const t of byDir[d]) if (t.state === "vár") { t.tps = tpSet(t.plan, t.legs[0].p, null, cfg.minTp2(t.legs[0].p)); t.shares = SHARES.split; }
  };

  // új megbízások a nap tervéből a szabad számlákra
  const place = (p, T, dayT, revised) => {
    const d = p.dir, gap = p.gap || 3, open = byDir[d].filter(isOpen);
    const busy = new Set(byDir[d].map(t => t.acc));
    const free = ACC_NAMES.filter(a => !busy.has(a));
    const occupied = x => open.some(t => Math.abs(t.legs[0].p - x) < gap);
    for (const pos of positions(p)) {
      if (!free.length) break;
      if (occupied(pos.entry.p)) continue;
      const legs = [pos.entry, ...pos.dca].map((l, i) => ({ p: l.p, why: l.why, units: UNITS[i] }));
      let unit = 1;
      if (cfg.sized) {
        const acc = free[0], eq = (cfg.bal[acc] || 17000);
        unit = Math.floor(eq / 1.1 / riskPerUnit(d, legs, cfg.lo, cfg.hi) * 10) / 10;
      }
      const t = { id: ++id, dir: d, acc: free.shift(), day: dayT, from: T, plan: p, legs, unit, filled: 0, qty: 0, cost: 0, avg: null, open: 0,
        state: "vár", role: null, tps: null, shares: SHARES.split, tpHit: [], stop: null, stopT: null, lock: false, lastFill: -1,
        fills: [], exits: [], fees: 0, realized: 0, closeT: null, revised: !!revised };
      trades.push(t); byDir[d].push(t);
    }
    rank(d);
  };

  // napváltás: a megbízások törlése, a nyitott kereskedések kezelése
  const rollover = (day, price, T) => {
    for (const d of [1, -1]) {
      const p = d > 0 ? day.long : day.short;
      for (const t of byDir[d]) if (t.lock && t.state === "aktív") t.tps = tpSet(t.plan, t.avg, null, cfg.minTp2(t.avg));
    for (const t of byDir[d]) if (t.state === "vár") { t.state = "lejárt"; t.closeT = T; }
      byDir[d] = byDir[d].filter(t => t.state !== "lejárt");
      const open = byDir[d].filter(isOpen);
      if (open.length && p) {
        const fresh = open.filter(t => t.state === "aktív");
        const best = fresh.slice().sort((a, b) => d * (a.avg - b.avg))[0];        // legjobb átlagár = swing
        const prof = open.filter(t => t !== best && t.role !== "swing" && d * (price - t.avg) > t.avg * (MAKER + TAKER));
        const edge = p.entry.p, better = prof.filter(t => d > 0 ? t.avg < edge : t.avg > edge);
        for (const t of prof) if (!better.includes(t)) exit(t, t.open, price, T, "napváltás (Ázsia vége)", TAKER);
        better.sort((a, b) => d * (b.avg - a.avg));
        better.forEach((t, k) => {
          if (k === 0) { t.plan = p; t.tps = tpSet(p, t.avg, null, cfg.minTp2(t.avg)); t.role = "full"; t.shares = SHARES.full; t.tpHit = []; t.lock = true; }
          else if (t.stop == null) { t.stop = t.avg * (1 + d * (MAKER + TAKER)); t.stopT = T; t.state = "védett"; }
        });
      }
      byDir[d] = byDir[d].filter(isOpen);
      if (p) place(p, T, day.T, false);
    }
  };

  let di = 0, pendingRev = null, lastPrice = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    while (di < days.length && b.t >= days[di].T) {
      const day = days[di++];
      rollover(day, lastPrice ?? b.o, day.T);
      pendingRev = day.L && (day.long && day.long.revised || day.short && day.short.revised) ? day : null;
    }
    if (pendingRev && b.t >= pendingRev.L) {           // London utáni frissítés: a meg nem nyílt megbízások cseréje
      for (const d of [1, -1]) {
        const p = d > 0 ? pendingRev.long : pendingRev.short;
        if (!p || !p.revised) continue;
        const waiting = byDir[d].filter(t => t.state === "vár" && t.day === pendingRev.T);
        if (waiting.length !== byDir[d].filter(t => t.day === pendingRev.T).length) continue;   // már indult → marad
        for (const t of waiting) { t.state = "lejárt"; t.closeT = b.t; }
        byDir[d] = byDir[d].filter(t => t.state !== "lejárt");
        place(p, pendingRev.L, pendingRev.T, true);
      }
      pendingRev = null;
    }
    for (const d of [1, -1]) {
      let ch = false;
      for (const t of byDir[d]) {
        if (t.state !== "vár" && t.state !== "aktív") continue;
        if (t.stop != null || t.exits.length) continue;
        while (t.filled < 4 && touch(b, d, t.legs[t.filled].p)) { fill(t, t.filled, b); ch = true; }
      }
      if (ch) rank(d);
      let re = false;
      for (const t of byDir[d]) {
        if (!isOpen(t) || t.lastFill === b.t) continue;
        for (let k = 0; k < 4; k++) {
          if (!t.shares[k] || t.tpHit.includes(k) || !t.tps || !reach(b, d, t.tps[k].p)) continue;
          // a TP-k sorrendben teljesülnek
          if (t.shares.slice(0, k).some((s, j) => s && !t.tpHit.includes(j))) break;
          t.tpHit.push(k); re = true;
          const lastTp = !t.shares.slice(k + 1).some(x => x);
          exit(t, lastTp ? t.open : t.qty * t.shares[k], t.tps[k].p, b.t, "TP" + (k + 1), MAKER);
          if (t.state === "lezárva") break;
          if (t.role !== "swing" && t.stop == null) { t.stop = t.avg * (1 + d * (MAKER + TAKER)); t.stopT = b.t; t.state = "részben"; }
          else if (t.state === "aktív") t.state = "részben";
        }
        if (isOpen(t) && t.stop != null && b.t > t.stopT && touch(b, d, t.stop)) { exit(t, t.open, t.stop, b.t, "pozitív stop", TAKER); re = true; }
      }
      byDir[d] = byDir[d].filter(t => t.state === "vár" || isOpen(t));
      if (re) rank(d);
    }
    lastPrice = b.c;
  }
  const last = bars.length ? bars[bars.length - 1] : null;
  for (const t of trades) t.unreal = isOpen(t) && last ? t.dir * (last.c - t.avg) * t.open : 0;
  return { trades, events, last };
}
