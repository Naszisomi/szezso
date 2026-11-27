// Silver bullet kereskedés (HYPE, a 7. „SB” számlán, cross-ban, a rácstól külön) – az 5 perces gyertyákon végigjátszva.
//
// Szabályok (a megbeszéltek szerint):
//  • Ablakok (NY idő): 03–04 (London), 10–11 (NY AM), 14–15 (NY PM).
//  • A lényeg: az ár visszatér a kiindulóponthoz. A cél (TP) az ablak Milana-nyitásának első FVG-je (15m, ahogy a
//    Milana rajzolja – gyakorlatilag az iFVG / abandoned baby, amit az ár céloz): London → TLO FVG, NY AM → NYAM FVG,
//    NY PM → TPM FVG; a belépő felőli széle, 2 tickkel előtte.
//    Ha az FVG-n belül rés van (iFVG / abandoned baby: 3 gyertyás FVG vagy két gyertya kanóca közti rés, 15m), azt az ár
//    kitölti és visszaellenőrzi – ilyenkor az a cél: a belépő felől elsőként elért, még ki nem töltött belső rés TÚLSÓ széle
//    (short: az alja, long: a teteje), 2 tickkel előtte. A várakozó megbízás TP-je gyertyánként frissül, teljesüléskor rögzül.
//  • Az ablak első 15m FVG-je a jel: miután kiderült, MINDKÉT irányba kerül limit megbízás –
//    short az FVG fölötti, long az FVG alatti legvastagabb egyezésvonalon (n ≥ 5), az ártól legfeljebb 2,5 15m-ATR-re.
//    Pl. nov. 27. London: short 66,65, long 65,15, mindkettő TP-je a TLO FVG.
//  • A megbízás az ablak vége után 3 óráig él (de a következő ablak kezdetekor törlődik). Ha épp nincs megfelelő vonal,
//    addig keres, amíg az idő tart.
//  • DCA: 3 (1/1/2/4 egység), a belépőn túli következő vastag egyezésvonalakon (nincs 3 $-os korlát; ha nincs vonal, 1 ATR).
//    DCA után a TP: átlagár + 0,10 $ (az első visszatérésnél kiszáll). DCA nélkül a TP a következő ablak FVG-jéhez igazodik.
//  • Ázsia (20:00–00:00 NY = 02:00–06:00 Budapest) alatt nincs silver bullet: a kezdetekor a megbízások törlődnek,
//    a nyitott pozíciók piaci áron zárnak.
//  • Irányonként egyszerre egy silver bullet fut (egy long és egy short lehet egyszerre).
//  • Méret: az SB számla egyenlegéből, a rácséval azonos feltétellel (50 $-os esés/emelkedés se likvidálja), díjak: limit 2 bp.
//  • Ablakonként napló készül (mi történt / miért nem nyílt).
import { nyOffset } from "./ind/milana.js";
import { UNITS } from "./engine/tradeutil.js";
import { unitFor } from "./grid.js";

const MAKER = 0.0002, TAKER = 0.0005, AFTER = 3 * 3600000, ASIA = 20 * 60, BE = 0.1;
const WINDOWS = [[180, 240], [600, 660], [840, 900]];                 // percek NY idő szerint
const WNAME = ["03–04", "10–11", "14–15"], TARGET = ["TLO", "NYAM", "TPM"];
const OPENS = [["TWO", 18 * 60, true], ["TDO", 0], ["TAO", 20 * 60 + 30], ["TLO", 2 * 60 + 30], ["TNY", 8 * 60 + 30], ["NYAM", 9 * 60 + 30], ["TPM", 14 * 60 + 30]];

export function simulateSB(bars, cfg) {
  const trades = [], events = [], logs = [];
  if (bars.length < 50) return { trades, events, windows: [] };
  const offs = new Map(), nyMin = t => {
    const h = Math.floor(t / 3600000);
    if (!offs.has(h)) offs.set(h, nyOffset(h * 3600000));
    const d = new Date(t + offs.get(h));
    return { m: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: d.getUTCDay() };
  };
  // 5m ATR(14) → ≈ 15m ATR (×√3)
  const atr = []; let a = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1] || b, tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14; atr.push(a * 1.73);
  }
  const tick = cfg.tick || 0.001, f3 = x => +x.toFixed(3);
  const lv = {}, m15 = []; let c15 = null;
  let win = null, lastWin = null, id = 0, wasAsia = false;
  const live = () => trades.filter(t => t.state === "vár" || t.state === "aktív");
  const wlog = (t, msg) => { const w = logs.find(x => x.key === t.wkey); if (w) w.log.push(msg); };
  const side = d => d > 0 ? "long" : "short";

  const fill = (t, k, b) => {
    const l = t.legs[k], q = l.units * t.unit, fee = q * l.p * MAKER;
    t.qty += q; t.open += q; t.cost += q * l.p; t.avg = t.cost / t.qty; t.filled = k + 1; t.lastFill = b.t; t.fees += fee;
    t.fills.push({ t: b.t, p: l.p, qty: q, why: k ? "DCA" + k : "entry", fee });
    events.push({ t: b.t, acc: "SB", pnl: -fee, trade: t.id, why: `SB ${side(t.dir)} ${k ? "DCA" + k : "entry"} díj` });
    if (t.state === "vár") t.state = "aktív";
    wlog(t, `${side(t.dir)} ${k ? "DCA" + k : "belépő"} teljesült ${f3(l.p)}`);
  };
  const setTp = (t, p, why, b) => { if (t.tp && t.tp.p === p) return; t.tp = { p, why }; t.tps = [t.tp]; t.tpLog.push({ t: b.t, p, why }); };
  // a cél: a nyitás FVG-jének belépő felőli széle, vagy – ha van – az FVG-n belüli, még ki nem töltött rés túlsó széle
  const tpFor = (dir, k, L) => {
    const [gb, gt] = L.fvg, edge = dir > 0 ? gb : gt, inner = [];
    const all = c15 ? [...m15, c15] : m15;
    for (let j = L.j + 1; j < m15.length; j++) {
      const x = m15[j], x1 = m15[j - 1], x2 = m15[j - 2], gs = [];
      if (x.l > x2.h) gs.push([x2.h, x.l, "iFVG"]); else if (x.h < x2.l) gs.push([x.h, x2.l, "iFVG"]);
      if (x.l > x1.h) gs.push([x1.h, x.l, "rés"]); else if (x.h < x1.l) gs.push([x.h, x1.l, "rés"]);
      for (const [lo0, hi0, nm] of gs) {
        if (lo0 < gb - tick || hi0 > gt + tick || hi0 - lo0 < 2 * tick) continue;   // teljesen az FVG-n belül legyen
        const lo = lo0, hi = hi0;
        // még ki nem töltött: a belépő felőli irányból a túlsó szélét azóta nem érte el az ár
        let open = true;
        for (let q = j + 1; q < all.length; q++) if (dir < 0 ? all[q].l <= lo : all[q].h >= hi) { open = false; break; }
        if (open) inner.push({ lo, hi, nm });
      }
    }
    if (!inner.length) return { p: edge - dir * 2 * tick, why: `${k} FVG ${f3(edge)} (2 tickkel előtte)` };
    const g = inner.sort((a, z) => dir < 0 ? z.hi - a.hi : a.lo - z.lo)[0], far = dir < 0 ? g.lo : g.hi;
    return { p: far - dir * 2 * tick, why: `${k} FVG-n belüli ${g.nm} ${f3(g.lo)} – ${f3(g.hi)} kitöltése (${f3(far)}, 2 tickkel előtte)` };
  };

  for (let i = 2; i < bars.length; i++) {
    const b = bars[i], { m, wd } = nyMin(b.t);
    for (const [k, mm, monday] of OPENS) if (m === mm && (!monday || wd === 0)) lv[k] = { open: b.o, t: b.t, i15: m15.length + (c15 && c15.t !== Math.floor(b.t / 900000) * 900000 ? 1 : 0), fvg: null };
    // 15m gyertyák az 5m-ből; a nyitások első 15m FVG-je (a Milana szerint: a nyitógyertyával kezdődő is számít)
    const t15 = Math.floor(b.t / 900000) * 900000;
    if (!c15 || c15.t !== t15) c15 = { t: t15, o: b.o, h: b.h, l: b.l, c: b.c }; else { c15.h = Math.max(c15.h, b.h); c15.l = Math.min(c15.l, b.l); c15.c = b.c; }
    if (b.t + 300000 >= t15 + 900000) {
      m15.push(c15); c15 = null;
      const j = m15.length - 1;
      for (const [k, v] of Object.entries(lv)) if (!v.fvg && j - 2 >= v.i15) {
        const x = m15[j], x2 = m15[j - 2];
        if (x.l > x2.h) v.fvg = [x2.h, x.l]; else if (x.h < x2.l) v.fvg = [x.h, x2.l];
        if (v.fvg) v.j = j;
      }
      // az ablak első 15m FVG-je (a jel): három, az ablakban kezdődő 15m gyertyából
      if (win && !win.fvg && m15[j - 2] && m15[j - 2].t >= win.t) {
        const x = m15[j], x2 = m15[j - 2];
        if (x.l > x2.h) win.fvg = [x2.h, x.l]; else if (x.h < x2.l) win.fvg = [x.h, x2.l];
        if (win.fvg) win.log.push(`15m FVG ${win.fvg.map(f3).join(" – ")}`);
      }
    }
    // ablak
    const wi = WINDOWS.findIndex(([s, e]) => m >= s && m < e), wkey = Math.floor(b.t / 86400000) * 10 + wi;
    if (wi >= 0 && (!win || win.key !== wkey)) {
      win = { key: wkey, idx: wi, t: b.t, fvg: null, placed: {}, miss: {}, log: [] };
      logs.push(win);
    } else if (win && wi < 0) { win.tEnd = b.t; lastWin = win; win = null; }

    // Ázsia (20:00–00:00 NY) alatt nincs silver bullet: a kezdetén a megbízások törlődnek, a nyitott pozíciók piaci áron zárnak
    const asia = m >= ASIA;
    if (asia && !wasAsia) for (const t of live()) {
      if (t.state === "vár") { t.state = "lejárt"; t.closeT = b.t; wlog(t, `${side(t.dir)} törölve: Ázsia kezdődik`); continue; }
      const px = b.o, q = t.open, fee = q * px * TAKER, pnl = t.dir * (px - t.avg) * q;
      t.open = 0; t.fees += fee; t.realized += pnl; t.exits.push({ t: b.t, p: px, qty: q, why: "Ázsia előtti zárás", pnl, fee });
      t.state = "lezárva"; t.closeT = b.t;
      wlog(t, `${side(t.dir)} Ázsia előtt zárva piaci áron ${f3(px)}: ${pnl - fee >= 0 ? "+" : ""}${(pnl - fee).toFixed(2)} $`);
      events.push({ t: b.t, acc: "SB", pnl: pnl - fee, trade: t.id, why: `SB ${side(t.dir)} zárás Ázsia előtt` });
    }
    wasAsia = asia;

    // élő kereskedések: belépő/DCA-k, TP, lejárat
    for (const t of live()) {
      const d = t.dir;
      if (t.state === "vár") {
        const late = (win && win.key !== t.wkey) || (!win && (!lastWin || b.t >= lastWin.tEnd + AFTER));
        if (late) { t.state = "lejárt"; t.closeT = b.t; wlog(t, `${side(d)} törölve: lejárt, nem teljesült`); continue; }
      }
      if (t.state === "vár" && t.L) { const x = tpFor(d, t.target, t.L); if (x.p !== t.tp.p) { setTp(t, x.p, x.why, b); wlog(t, `${side(d)} TP frissítve → ${f3(x.p)} (${x.why})`); } }
      let filled = false;
      while (t.filled < 4 && (d > 0 ? b.l <= t.legs[t.filled].p : b.h >= t.legs[t.filled].p)) { fill(t, t.filled, b); filled = true; }
      if (t.state !== "aktív") continue;
      if (filled && t.filled >= 2) { setTp(t, t.avg + d * BE, `DCA után: átlagár + ${BE} $`, b); wlog(t, `${side(d)} DCA után a TP → ${f3(t.tp.p)} (átlagár ${f3(t.avg)} + ${BE} $)`); }
      if (t.lastFill !== b.t && d * (t.tp.p - t.avg) > 0 && (d > 0 ? b.h >= t.tp.p : b.l <= t.tp.p)) {
        const px = t.tp.p, q = t.open, fee = q * px * MAKER, pnl = d * (px - t.avg) * q;
        t.open = 0; t.fees += fee; t.realized += pnl; t.exits.push({ t: b.t, p: px, qty: q, why: "TP", pnl, fee });
        t.state = "lezárva"; t.closeT = b.t; t.tpHit = [0];
        wlog(t, `${side(d)} TP ${f3(px)}: ${pnl - fee >= 0 ? "+" : ""}${(pnl - fee).toFixed(2)} $`);
        events.push({ t: b.t, acc: "SB", pnl: pnl - fee, trade: t.id, why: `SB ${side(d)} TP` });
      }
    }

    // megbízások: az FVG után mindkét irányba, a cél (az ablak nyitóvonala) két oldalán
    const act = win || (lastWin && b.t < lastWin.tEnd + AFTER ? lastWin : null);
    if (!act || !act.fvg || (act.placed[1] && act.placed[-1])) continue;
    const L = lv[TARGET[act.idx]];
    if (!L || L.t < act.t - 12 * 3600000 || !L.fvg) { if (!act.noTgt) { act.noTgt = true; act.log.push(`a cél (${TARGET[act.idx]} FVG) még nem ismert – várakozik`); } continue; }
    const [gb, gt] = L.fvg, lines = cfg.cfLines ? cfg.cfLines(b.t) : [];
    if (!act.tgtLog) { act.tgtLog = true; act.log.push(`cél: ${TARGET[act.idx]} FVG ${f3(gb)} – ${f3(gt)}`); }
    for (const dir of [-1, 1]) {
      if (act.placed[dir]) continue;
      const edge = dir > 0 ? gb : gt, tx = tpFor(dir, TARGET[act.idx], L), tpP = tx.p, why = tx.why;
      const run = live().find(t => t.dir === dir);
      if (run) {
        act.placed[dir] = true;
        if (run.wkey !== act.key) {
          if (run.state === "aktív" && run.filled < 2 && d0(run, tpP)) { setTp(run, tpP, why, b); act.log.push(`fut egy korábbi ${side(dir)} (átl. ${f3(run.avg)}) – TP → ${f3(tpP)}`); }
          else act.log.push(`fut egy korábbi ${side(dir)} – marad a TP-je`);
        }
        continue;
      }
      // az FVG túloldalán (short: fölötte, long: alatta) a legvastagabb vonal, az ártól ≤ 2,5 ATR-re
      const c = lines.filter(g => -dir * (g.p - edge) >= 0.5 * atr[i] && -dir * (g.p - b.c) > 2 * tick && Math.abs(g.p - b.c) <= 2.5 * atr[i])
        .sort((x, y) => (y.n - x.n) || Math.abs(x.p - b.c) - Math.abs(y.p - b.c))[0];
      if (!c) { if (!act.miss[dir]) { act.miss[dir] = true; act.log.push(`${side(dir)}: nincs vastag vonal az FVG ${dir > 0 ? "alatt" : "fölött"} 2,5 ATR-en belül (ár ${f3(b.c)}) – keres tovább`); } continue; }
      // DCA-k: a belépőn túli következő vastag vonalakon (egymástól ≥ 0,5 ATR), ha nincs, 1 ATR-es lépéssel
      const e = c.p, legs = [{ p: e, why: `entry (EGYEZÉS ${c.n})`, units: UNITS[0] }];
      const beyond = lines.filter(g => -dir * (g.p - e) > 0).sort((x, y) => Math.abs(x.p - e) - Math.abs(y.p - e));
      for (let k = 1; k < 4; k++) {
        const prev = legs[k - 1].p, g = beyond.find(x => -dir * (x.p - prev) >= 0.5 * atr[i]);
        legs.push(g ? { p: g.p, why: `DCA${k} (EGYEZÉS ${g.n})`, units: UNITS[k] } : { p: prev - dir * atr[i], why: `DCA${k} (1 ATR)`, units: UNITS[k] });
      }
      const unit = cfg.sized ? unitFor(cfg.bal || 14571, dir, legs, cfg.swan || 70) : 1;
      const t = { id: ++id, acc: "SB", dir, legs, unit, filled: 0, qty: 0, cost: 0, avg: null, open: 0, state: "vár", from: b.t, day: act.t, window: WNAME[act.idx],
        wkey: act.key, fvg: act.fvg, target: TARGET[act.idx], L, atr: atr[i], fills: [], exits: [], fees: 0, realized: 0, closeT: null, lastFill: -1, tpHit: [], shares: [1], tpLog: [] };
      setTp(t, tpP, why, b);
      trades.push(t); act.placed[dir] = true;
      act.log.push(`megbízás: ${side(dir)} limit ${f3(e)} (EGYEZÉS ${c.n}) → TP ${f3(tpP)} (${why})`);
    }
  }
  function d0(t, p) { return t.dir * (p - t.avg) > 0; }
  const last = bars[bars.length - 1];
  for (const t of trades) t.unreal = t.state === "aktív" ? t.dir * (last.c - t.avg) * t.open : 0;
  for (const w of logs) if (!w.fvg) w.log.push("nem alakult ki FVG az ablakban");
  const windows = logs.map(w => ({ t: w.t, window: WNAME[w.idx], log: w.log }));
  return { trades, events, last, windows };
}
