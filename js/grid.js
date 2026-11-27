// Folyamatos rács-szimuláció (papírkereskedés és a chart terve), a 15 perces gyertyákon végigjátszva.
//
// Szabályok (a megbeszéltek szerint):
//  • Irányonként 6 számla (Fő, Al1–Al5), számlánként egy rács-kereskedés: entry + 3 DCA, 1/1/2/4 egység. Mind cross.
//  • Minden nap az Ázsia végén (00:00 NY) az aznapi terv a rács alapja (Ázsia alja / teteje). Ugyanazon a szinten nem lehet
//    két aktív kereskedés. 6 $-os szabály: ha az Ázsia végi ár legalább 6 $-ra van a legtávolabbi futó entrytől, az a
//    kereskedés az árhoz legközelebbi láncszem, új rács-entry csak azon túl nyílik (a köztes zónát a silver bullet viszi).
//  • Szerepek az egy oldalon nyitott összes kereskedés (minden alszámla, a részben zártak is) entryje szerint:
//      1 fut → swing;  2 vagy több → az árhoz legközelebbi TP1-nél egyben zár (ha már részben zárt, a maradéka
//      az átlagárából újraszámolt TP1-nél), a középsők 60/25/15% + pozitív stop, a legtávolabbi swing.
//  • A részben zárt (stop nélküli) kereskedés DCA-ja is teljesül; a maradék kiegészítése választható:
//      a) az első DCA az eredeti entry + DCA1 méretére egészít ki; b) az eredeti entry méretére;
//      c) a maradék méretével indul; utána mindhárom a szokásos duplázással (minden DCA = a nyitott méret).
//    A swing (a legtávolabbi entry) 60% TP1, 25% TP2, 15% a swing-célnál, stop nélkül, a DCA-i megmaradnak.
//  • TP1 a 15m (legalább 1 $-ra az átlagártól), TP2 az 1h (legalább 2 $; a 15m rés pontosítja), TP3 a 4h;
//    swing-cél: 4h VPOC, 10/10-es golden pocket, POI, az 1D legvastagabb egyezésvonala, minták és a rajzolt nyilak.
//  • Jelzésre zárás (15m gyertyazáráskor, legalább 1 $ nyereségnél, és ha az ár már legalább félúton van a TP felé):
//    a soron következő TP-részlet (a swing-cél kivételével) azonnal zár, ha
//    abandoned baby van, vagy legalább kettő a többiből: RSI 70/30, vastag egyezésvonal, Milana-szint (silver bullet cél),
//    EMA 50/100/200 érintése, fordulóminta (esti/hajnalcsillag, akasztott ember / kalapács, hullócsillag, három varjú /
//    katona, bekebelezés, doji a szélsőértéken).
//  • Napváltáskor: a swing és a nem nyereséges kereskedés bent marad; a nyereséges többi, ha az új Ázsia-határnál rosszabb
//    helyen van, zár; ha jobb helyen, a legfelső az új TP1-ig fut, a többi pozitív stopot kap. A meg nem nyílt megbízások törlődnek.
//  • Méretezés (HYPE): a számla akkor se likvidálódjon, ha az ár 70 $-t esik (long, legfeljebb 0-ig) / emelkedik (short),
//    mind a 4 láb kitelve. Díjak: limit 2 bp, stop és piaci zárás 5 bp.
import { UNITS } from "./engine/tradeutil.js";

export const ACC_NAMES = ["Fő", "Al1", "Al2", "Al3", "Al4", "Al5"];
const DAY = 86400000, MAKER = 0.0002, TAKER = 0.0005;
const SHARES = { full: [1, 0, 0, 0], split: [0.6, 0.25, 0.15, 0], swing: [0.6, 0.25, 0, 0.15] };

// a rács helyei egy napi tervből: entry, majd mindig az előző DCA1-e, legalább `gap` lépéssel
//  A DCA-hely ráhúzódik a közeli (HYPE: 1 $-on belüli) erős egyezésvonalra (4h vagy LIQ tényezővel), ha a lépés így is megvan.
export function positions(p, n = 12) {
  const d = p.dir, gap = p.gap || 3, snapD = gap / 3;
  const strong = [...((p.cand && p.cand.h1 && p.cand.h1.cf) || []), ...((p.cand && p.cand.h4 && p.cand.h4.cf) || []), ...((p.cand && p.cand.m15 && p.cand.m15.cf) || [])].filter(strongCf);
  const snap = (x, ref) => {
    const c = strong.filter(g => Math.abs(g.p - x.p) <= snapD && (d > 0 ? g.p <= ref - gap : g.p >= ref + gap)).sort((a, b) => cfRank(b) - cfRank(a))[0];
    return c ? { p: c.p, why: `EGYEZÉS ${c.n} (${c.codes.join("·")})` } : x;
  };
  const pool = p.levels.filter(x => d > 0 ? x.p < p.entry.p : x.p > p.entry.p).sort((a, b) => d * (b.p - a.p));
  const build = entry => {
    const dca = [];
    let ref = entry.p;
    for (const x of pool) { if (dca.length === 3) break; if (d > 0 ? x.p <= ref - gap : x.p >= ref + gap) { const y = snap(x, ref); dca.push(y); ref = y.p; } }
    while (dca.length < 3) { const y = snap({ p: ref - d * gap, why: "min. távolság" }, ref); dca.push(y); ref = y.p; }
    return dca;
  };
  const out = [{ entry: p.entry, dca: build(p.entry) }];
  while (out.length < n) { const entry = out[out.length - 1].dca[0]; out.push({ entry, dca: build(entry) }); }
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
  for (const g of c.cf || []) if (d > 0 ? g.p > ref : g.p < ref) out.push({ p: g.p, why: `EGYEZÉS ${g.n} (${g.codes.join("·")})`, cf: cfRank(g) });
  if (tf === "d1") {
    // swing-célok: a minták mért távja (4h) és a rajzolt nyilak vége; ha a közelében (1,5%) rés van, arra igazítva –
    // elsősorban az iránnyal ellentétes résre (longnál a fenti medve-rés), különben bármelyik jelentős résre
    const src = [...((p.cand.h4 && p.cand.h4.pat) || []).filter(x => x.dir === d).map(x => ({ p: x.target, why: "minta: " + x.name })), ...(p.swingX || []), ...(p.cand.sw || [])];
    const gaps = ["d1", "h4", "h1"].flatMap(k => ((p.cand[k] && p.cand[k].gaps) || []).map(g => ({ bot: g[0], top: g[1], bull: g[2], tf: k })));
    for (const x of src) {
      if (!(d > 0 ? x.p > ref : x.p < ref)) continue;
      const near = gaps.filter(g => Math.abs((d > 0 ? g.bot : g.top) - x.p) <= x.p * 0.015)
        .sort((a, b) => ((d > 0 ? a.bull : !a.bull) - (d > 0 ? b.bull : !b.bull)) || Math.abs((d > 0 ? a.bot : a.top) - x.p) - Math.abs((d > 0 ? b.bot : b.top) - x.p))[0];
      out.push(near ? { p: d > 0 ? near.bot : near.top, why: `${x.why} → ${near.tf} rés`, swing: true } : { ...x, swing: true });
    }
  }
  if (tf === "m15") for (const x of p.levels) if (/^(TLO|TNY|NYAM|TPM|TDO|TAO|TWO)$|^Milana/.test(x.why || "") && (d > 0 ? x.p > ref : x.p < ref)) out.push(x);
  return out.sort((a, b) => d * (a.p - b.p));
}
// egyezésvonal ereje: a 4h és a LIQ tényező különösen erős (fordulópont), utána a tényezők száma
function cfRank(g) { return g.n + (g.codes.includes("4h") ? 3 : 0) + (g.codes.includes("LIQ") ? 3 : 0); }
export function strongCf(g) { return g.n >= 5 && (g.codes.includes("4h") || g.codes.includes("LIQ")); }
function nearest(p, tf, d, from, step) {
  const all = targets(p, tf, d, from);
  if (tf === "d1") { const sw = all.find(x => x.swing); if (sw) return sw; }
  // a legközelebbi cél környékén (≈ 1 ATR) az egyezésvonal nyer (a legerősebb), és a TP 2 tickkel a vonal elé kerül
  const win = Math.max(p.atr || 0, Math.abs(from) * 0.004);
  let t = all[0];
  if (t) {
    const cf = all.filter(x => x.cf && d * (x.p - all[0].p) <= win).sort((a, b) => b.cf - a.cf)[0];
    if (cf) t = { p: cf.p - d * 2 * (p.tick || 0), why: cf.why + " (2 tickkel előtte)" };
  }
  const l = p.levels.filter(x => d > 0 ? x.p > from : x.p < from).sort((a, b) => d * (a.p - b.p))[0];
  // ha az idősík célja nagyon messze van (> 5%), a közelebbi stratégiai szint a tartalék
  if (t && !(l && d * (t.p - from) > Math.abs(from) * 0.05 && d * (l.p - from) < d * (t.p - from))) return t;
  return l ? { p: l.p, why: l.why + " (tartalék)" } : { p: from + d * step, why: "nincs szint" };
}
// TP1 (15m), TP2 (1h, ≥ minTp2 az átlagártól), TP3 (4h), swing cél (1D)
export function tpSet(p, avg, chain, minTp2) {
  const d = p.dir, g = p.tpGap || Math.abs(avg) * 0.002, step = Math.max(g * 4, Math.abs(avg) * 0.01), m1 = Math.max(g, minTp2 / 2);   // TP1 legalább 1 $ (HYPE)
  const f1 = chain != null ? (d > 0 ? Math.max(avg + m1, chain + g) : Math.min(avg - m1, chain - g)) : avg + d * m1;
  const t1 = nearest(p, "m15", d, f1, step);
  const t2 = nearest(p, "h1", d, d > 0 ? Math.max(t1.p + m1, avg + minTp2) : Math.min(t1.p - m1, avg - minTp2), step);   // TP2 a TP1-től is legalább 1 $
  const sp = Math.max(g, minTp2 / 2);                 // a további TP-k is legalább fél „TP2-távolságra” egymástól
  const t3 = nearest(p, "h4", d, t2.p + d * sp, step);
  const t4 = nearest(p, "d1", d, t3.p + d * sp, step);
  return [t1, t2, t3, t4];
}

// egységnyi (1/1/2/4) rács kockázata dollárban, egységenként: az entrytől `swan` dolláros esés (long, legfeljebb 0-ig)
// vagy emelkedés (short), mind a 4 láb kitelve
export function riskPerUnit(d, legs, swan = 70) {
  const lo = Math.max(0, legs[0].p - swan), hi = legs[0].p + swan;
  let r = 0;
  legs.forEach((l, i) => { r += UNITS[i] * (d > 0 ? l.p - lo : hi - l.p); });
  return r;
}
export function unitFor(eq, d, legs, swan = 70) { return Math.floor(eq / 1.1 / riskPerUnit(d, legs, swan) * 10) / 10; }

// 15m jelzések gyertyánként: RSI(14), EMA 50/100/200, fordulóminták (a záráshoz: bear = a long zárását segíti)
function signals(bars) {
  const n = bars.length, rsi = new Float64Array(n), ema = [50, 100, 200].map(() => new Float64Array(n));
  let g = 0, l = 0;
  for (let i = 0; i < n; i++) {
    const ch = i ? bars[i].c - bars[i - 1].c : 0, up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= 14) { g += up / 14; l += dn / 14; } else { g = (g * 13 + up) / 14; l = (l * 13 + dn) / 14; }
    rsi[i] = i < 14 ? 50 : l === 0 ? 100 : 100 - 100 / (1 + g / l);
    [50, 100, 200].forEach((len, k) => { const a = 2 / (len + 1); ema[k][i] = i ? ema[k][i - 1] + a * (bars[i].c - ema[k][i - 1]) : bars[i].c; });
  }
  const body = b => Math.abs(b.c - b.o), rng = b => b.h - b.l || 1e-9, up = b => b.c > b.o;
  const top = b => Math.max(b.o, b.c), bot = b => Math.min(b.o, b.c);
  const pat = new Array(n);
  for (let i = 2; i < n; i++) {
    const c = bars[i], p = bars[i - 1], q = bars[i - 2], out = { bear: [], bull: [] };
    let hi = -Infinity, lo = Infinity; for (let k = Math.max(0, i - 9); k <= i; k++) { hi = Math.max(hi, bars[k].h); lo = Math.min(lo, bars[k].l); }
    const ab = body(p) <= rng(p) * 0.1;
    // abandoned baby: doji, amely testtel elszakad mindkét szomszédjától
    if (up(q) && ab && bot(p) > top(q) && !up(c) && top(c) < bot(p)) out.bear.push("abandoned baby");
    if (!up(q) && ab && top(p) < bot(q) && up(c) && bot(c) > top(p)) out.bull.push("abandoned baby");
    if (up(q) && body(p) <= body(q) * 0.3 && !up(c) && c.c < (q.o + q.c) / 2) out.bear.push("esti csillag");
    if (!up(q) && body(p) <= body(q) * 0.3 && up(c) && c.c > (q.o + q.c) / 2) out.bull.push("hajnalcsillag");
    const loW = bot(c) - c.l, upW = c.h - top(c);
    if (c.h >= hi && loW >= 2 * body(c) && upW <= body(c) * 0.5 && body(c) > 0) out.bear.push("akasztott ember");
    if (c.l <= lo && loW >= 2 * body(c) && upW <= body(c) * 0.5 && body(c) > 0) out.bull.push("kalapács");
    if (c.h >= hi && upW >= 2 * body(c) && loW <= body(c) * 0.5 && body(c) > 0) out.bear.push("hullócsillag");
    if ([q, p, c].every(b => !up(b)) && c.c < p.c && p.c < q.c) out.bear.push("három varjú");
    if ([q, p, c].every(up) && c.c > p.c && p.c > q.c) out.bull.push("három katona");
    if (!up(c) && up(p) && c.o >= p.c && c.c <= p.o && body(c) > body(p)) out.bear.push("medvés bekebelezés");
    if (up(c) && !up(p) && c.o <= p.c && c.c >= p.o && body(c) > body(p)) out.bull.push("bikás bekebelezés");
    if (body(c) <= rng(c) * 0.1 && c.h >= hi) out.bear.push("doji a csúcson");
    if (body(c) <= rng(c) * 0.1 && c.l <= lo) out.bull.push("doji az alján");
    pat[i] = out;
  }
  return { rsi, ema, pat };
}

// days: [{T, long, short, L?, rev?}] időrendben; bars: 15m gyertyák; cfg: {bal: {Fő: 17000…}, lo, hi, sized, minTp2, gap}
export function simulate(days, bars, cfg, now) {
  const trades = [], events = [], sig = signals(bars);
  let id = 0;
  const byDir = { 1: [], [-1]: [] };                  // nyitott (vár / aktív / részben / védett) kereskedések irányonként
  const isOpen = t => t.state === "aktív" || t.state === "részben" || t.state === "védett";
  const touch = (b, d, x) => d > 0 ? b.l <= x : b.h >= x, reach = (b, d, x) => d > 0 ? b.h >= x : b.l <= x;

  const fill = (t, k, b) => {
    const l = t.legs[k], first = t.exits.length && !t.remDca;
    let q = l.units * t.unit;
    if (t.exits.length) {                                // részben zárt kereskedés DCA-ja: a maradékhoz igazítva
      const m = cfg.remMode || "a";
      q = first ? (m === "a" ? Math.max(0, 2 * t.unit - t.open) : m === "b" ? Math.max(0, t.unit - t.open) : t.open) : t.open;
      if (first) t.remDca = true;
      if (q <= 0) q = t.open;
    }
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
    // az oldal összes nyitott kereskedése az entry szerint: elöl az árhoz legközelebbi (longnál a legmagasabb entry)
    const all = byDir[d].filter(isOpen).sort((a, b) => d * (b.legs[0].p - a.legs[0].p)), n = all.length;
    const list = all.filter(t => t.state === "aktív" && !t.lock);
    let prev = null;
    list.forEach(t => {
      const k = all.indexOf(t);
      t.role = n === 1 || k === n - 1 ? "swing" : k === 0 ? "full" : "split";
      t.tps = tpSet(t.plan, t.avg, prev ? prev.tps[0].p : null, cfg.minTp2(t.avg, t.plan)); t.shares = SHARES[t.role];
      prev = t;
    });
    // a részben zárt, árhoz legközelebbi kereskedés (ha több fut): a maradék az átlagárából újraszámolt TP1-nél egyben zár
    const near = all[0];
    if (n >= 2 && near && near.exits.length && near.role !== "full" && near.stop == null) {
      near.role = "full"; near.tps = tpSet(near.plan, near.avg, null, cfg.minTp2(near.avg, near.plan)); near.tpHit = []; near.shares = SHARES.full;
    }
    for (const t of byDir[d]) if (t.lock && t.state === "aktív") t.tps = tpSet(t.plan, t.avg, null, cfg.minTp2(t.avg, t.plan));
    for (const t of byDir[d]) if (t.state === "vár") { t.tps = tpSet(t.plan, t.legs[0].p, null, cfg.minTp2(t.legs[0].p, t.plan)); t.shares = SHARES.split; }
  };

  // új megbízások a nap tervéből a szabad számlákra
  const place = (p, T, dayT, revised, beyond = null) => {
    const d = p.dir, gap = p.gap || 3, open = byDir[d].filter(isOpen);
    const busy = new Set(byDir[d].map(t => t.acc));
    const free = ACC_NAMES.filter(a => !busy.has(a));
    const occupied = x => open.some(t => Math.abs(t.legs[0].p - x) < gap);
    for (const pos of positions(p)) {
      if (!free.length) break;
      if (occupied(pos.entry.p)) continue;
      if (beyond != null && d * (beyond - pos.entry.p) < gap) continue;          // 6 $-os szabály: csak a futó láncszemen túl
      const legs = [pos.entry, ...pos.dca].map((l, i) => ({ p: l.p, why: l.why, units: UNITS[i] }));
      let unit = 1;
      if (cfg.sized) {
        const acc = free[0], eq = (cfg.bal[acc] || 17000);
        unit = unitFor(eq, d, legs, cfg.swan || 70);
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
      for (const t of byDir[d]) if (t.state === "vár") { t.state = "lejárt"; t.closeT = T; }
      byDir[d] = byDir[d].filter(t => t.state !== "lejárt");
      const open = byDir[d].filter(isOpen);
      let beyond = null;
      if (open.length && p) {
        const far = open.slice().sort((a, b) => d * (a.legs[0].p - b.legs[0].p))[0];   // a legtávolabbi entry = swing
        const prof = open.filter(t => t !== far && t.role !== "swing" && d * (price - t.avg) > t.avg * (MAKER + TAKER));
        const edge = p.entry.p, better = prof.filter(t => d > 0 ? t.avg < edge : t.avg > edge);
        for (const t of prof) if (!better.includes(t)) exit(t, t.open, price, T, "napváltás (Ázsia vége)", TAKER);
        better.sort((a, b) => d * (b.avg - a.avg));
        better.forEach((t, k) => {
          if (k === 0) { t.plan = p; t.tps = tpSet(p, t.avg, null, cfg.minTp2(t.avg, t.plan)); t.role = "full"; t.shares = SHARES.full; t.tpHit = []; t.lock = true; }
          else if (t.stop == null) { t.stop = t.avg * (1 + d * (MAKER + TAKER)); t.stopT = T; t.state = "védett"; }
        });
      }
      byDir[d] = byDir[d].filter(isOpen);
      // 6 $-os szabály: ha az ár legalább 6 $-ra van a legtávolabbi futó entrytől, új rács-entry csak azon túl
      const far = byDir[d].slice().sort((a, b) => d * (a.legs[0].p - b.legs[0].p))[0];
      if (far && p && d * (price - far.legs[0].p) >= (cfg.six ?? (p.gap || 3) * 2)) beyond = far.legs[0].p;
      if (p) place(p, T, day.T, false, beyond);
    }
  };

  // zárási jelzések egy gyertyán (a kereskedés irányával szemben): abandoned baby egymagában, a többiből legalább kettő
  const exitSignal = (t, b, i, d) => {
    const pt = sig.pat[i] || { bear: [], bull: [] }, pats = d > 0 ? pt.bear : pt.bull, got = [];
    if (pats.includes("abandoned baby")) return "abandoned baby";
    if (d > 0 ? sig.rsi[i] >= 70 : sig.rsi[i] <= 30) got.push(`RSI ${Math.round(sig.rsi[i])}`);
    const p = t.plan, tol = b.c * 0.001, inBar = x => x >= b.l - tol && x <= b.h + tol && d * (x - t.avg) > 0;
    const cfs = ["m15", "h1", "h4"].flatMap(k => (p.cand && p.cand[k] && p.cand[k].cf) || []).filter(g => g.n >= 6 || strongCf(g));   // vastag vonal
    if (cfs.some(g => inBar(g.p))) got.push("vastag egyezésvonal");
    if (p.levels.some(x => /^(TLO|TNY|NYAM|TPM|TDO|TAO|TWO)$|^Milana/.test(x.why || "") && inBar(x.p))) got.push("Milana-szint");
    if (sig.ema.some(e => inBar(e[i]))) got.push("EMA");
    if (pats.length) got.push(pats[0]);
    return got.length >= 2 ? got.join(" + ") : null;
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
        if (t.state !== "vár" && t.state !== "aktív" && t.state !== "részben") continue;
        if (t.stop != null) continue;                    // pozitív stoppal védett kereskedés nem DCA-z
        while (t.filled < 4 && touch(b, d, t.legs[t.filled].p)) { fill(t, t.filled, b); ch = true; }
      }
      if (ch) {
        for (const t of byDir[d]) if (t.lastFill === b.t && t.exits.length && t.stop == null) {   // maradék + DCA: új átlagár, új TP-k
          t.tps = tpSet(t.plan, t.avg, null, cfg.minTp2(t.avg, t.plan)); t.tpHit = []; t.shares = SHARES[t.role === "full" ? "full" : t.role || "split"];
        }
        rank(d);
      }
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
        // jelzésre zárás a gyertya záróárán: a soron következő TP-részlet
        if (isOpen(t) && t.tps && d * (b.c - t.avg) >= cfg.minTp2(t.avg, t.plan) / 2) {
          const k = [0, 1, 2].find(j => t.shares[j] && !t.tpHit.includes(j));   // a swing-cél (15%) nem zár jelzésre, fut a célig
          const half = k != null && d * (b.c - t.avg) >= 0.5 * d * (t.tps[k].p - t.avg);   // csak ha már félúton van a TP felé
          const why = k == null || !half ? null : exitSignal(t, b, i, d);
          if (why) {
            t.tpHit.push(k); re = true;
            const lastTp = !t.shares.slice(k + 1).some(x => x);
            exit(t, lastTp ? t.open : t.qty * t.shares[k], b.c, b.t, `TP${k + 1} jelzésre (${why})`, TAKER);
            if (isOpen(t) && t.role !== "swing" && t.stop == null) { t.stop = t.avg * (1 + d * (MAKER + TAKER)); t.stopT = b.t; t.state = "részben"; }
            else if (t.state === "aktív") t.state = "részben";
          }
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
