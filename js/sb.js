// Silver bullet kereskedés (HYPE, a 7. „SB” számlán, cross-ban, a rácstól külön) – az 5 perces gyertyákon végigjátszva.
//
// Szabályok (a megbeszéltek szerint):
//  • Ablakok (NY idő): 03–04 (London), 10–11 (NY AM), 14–15 (NY PM).
//  • A lényeg: az ár visszatér a kiindulóponthoz. A cél (TP) az ablak Milana-nyitóvonala:
//    London → TLO, NY AM → NYAM, NY PM → TPM, 2 tickkel előtte.
//  • Az ablak első 5m FVG-je a jel: miután kiderült, MINDKÉT irányba kerül limit megbízás –
//    short a cél fölötti, long a cél alatti legvastagabb egyezésvonalon (n ≥ 5), az ártól legfeljebb 2,5 15m-ATR-re.
//    Pl. nov. 27. London: short 66,65, long 65,15, mindkettő TP-je a TLO.
//  • A megbízás az ablak vége után 3 óráig él (de a következő ablak kezdetekor törlődik). Ha épp nincs megfelelő vonal,
//    addig keres, amíg az idő tart.
//  • DCA: 3 (1/1/2/4 egység), 3 $ lépéssel. Ha a TP-ig nem jön össze, a kereskedés marad, és a következő ablak
//    nyitóvonalához igazodik (ha az az átlagár jó oldalán van).
//  • Irányonként egyszerre egy silver bullet fut (egy long és egy short lehet egyszerre).
//  • Méret: az SB számla egyenlegéből, a rácséval azonos feltétellel (50 $-os esés/emelkedés se likvidálja), díjak: limit 2 bp.
//  • Ablakonként napló készül (mi történt / miért nem nyílt).
import { nyOffset } from "./ind/milana.js";
import { UNITS } from "./engine/tradeutil.js";
import { unitFor } from "./grid.js";

const MAKER = 0.0002, AFTER = 3 * 3600000;
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
  const gap = cfg.gap || 3, tick = cfg.tick || 0.001, f3 = x => +x.toFixed(3);
  const lv = {};
  let win = null, lastWin = null, id = 0;
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
  const setTp = (t, p, why, b) => { t.tp = { p, why }; t.tps = [t.tp]; t.tpLog.push({ t: b.t, p, why }); };

  for (let i = 2; i < bars.length; i++) {
    const b = bars[i], { m, wd } = nyMin(b.t);
    for (const [k, mm, monday] of OPENS) if (m === mm && (!monday || wd === 0)) lv[k] = { open: b.o, t: b.t };
    // ablak
    const wi = WINDOWS.findIndex(([s, e]) => m >= s && m < e), wkey = Math.floor(b.t / 86400000) * 10 + wi;
    if (wi >= 0 && (!win || win.key !== wkey)) {
      win = { key: wkey, idx: wi, t: b.t, fvg: null, placed: {}, miss: {}, log: [] };
      logs.push(win);
    } else if (win && wi < 0) { win.tEnd = b.t; lastWin = win; win = null; }

    // élő kereskedések: belépő/DCA-k, TP, lejárat
    for (const t of live()) {
      const d = t.dir;
      if (t.state === "vár") {
        const late = (win && win.key !== t.wkey) || (!win && (!lastWin || b.t >= lastWin.tEnd + AFTER));
        if (late) { t.state = "lejárt"; t.closeT = b.t; wlog(t, `${side(d)} törölve: lejárt, nem teljesült`); continue; }
      }
      let filled = false;
      while (t.filled < 4 && (d > 0 ? b.l <= t.legs[t.filled].p : b.h >= t.legs[t.filled].p)) { fill(t, t.filled, b); filled = true; }
      if (t.state !== "aktív") continue;
      if (filled && d * (t.tp.p - t.avg) <= 0) wlog(t, `${side(d)} figyelem: a TP (${f3(t.tp.p)}) az átlagár (${f3(t.avg)}) rossz oldalán – a következő ablak céljára vár`);
      if (t.lastFill !== b.t && d * (t.tp.p - t.avg) > 0 && (d > 0 ? b.h >= t.tp.p : b.l <= t.tp.p)) {
        const px = t.tp.p, q = t.open, fee = q * px * MAKER, pnl = d * (px - t.avg) * q;
        t.open = 0; t.fees += fee; t.realized += pnl; t.exits.push({ t: b.t, p: px, qty: q, why: "TP", pnl, fee });
        t.state = "lezárva"; t.closeT = b.t; t.tpHit = [0];
        wlog(t, `${side(d)} TP ${f3(px)}: ${pnl - fee >= 0 ? "+" : ""}${(pnl - fee).toFixed(2)} $`);
        events.push({ t: b.t, acc: "SB", pnl: pnl - fee, trade: t.id, why: `SB ${side(d)} TP` });
      }
    }

    // az ablak első 5m FVG-je (a jel)
    if (win && !win.fvg && bars[i - 2].t >= win.t) {
      const b2 = bars[i - 2];
      if (b.l > b2.h) win.fvg = [b2.h, b.l]; else if (b.h < b2.l) win.fvg = [b.h, b2.l];
      if (win.fvg) win.log.push(`FVG ${win.fvg.map(f3).join(" – ")}`);
    }

    // megbízások: az FVG után mindkét irányba, a cél (az ablak nyitóvonala) két oldalán
    const act = win || (lastWin && b.t < lastWin.tEnd + AFTER ? lastWin : null);
    if (!act || !act.fvg || (act.placed[1] && act.placed[-1])) continue;
    const L = lv[TARGET[act.idx]];
    if (!L || L.t < act.t - 12 * 3600000) { if (!act.noTgt) { act.noTgt = true; act.log.push(`a cél (${TARGET[act.idx]}) még nem ismert – várakozik`); } continue; }
    const target = L.open, lines = cfg.cfLines ? cfg.cfLines(b.t) : [];
    for (const dir of [-1, 1]) {
      if (act.placed[dir]) continue;
      const tpP = target - dir * 2 * tick, why = `${TARGET[act.idx]} ${f3(target)} (2 tickkel előtte)`;
      const run = live().find(t => t.dir === dir);
      if (run) {
        act.placed[dir] = true;
        if (run.wkey !== act.key) {
          if (run.state === "aktív" && d0(run, tpP)) { setTp(run, tpP, why, b); act.log.push(`fut egy korábbi ${side(dir)} (átl. ${f3(run.avg)}) – TP → ${f3(tpP)}`); }
          else act.log.push(`fut egy korábbi ${side(dir)} – marad a TP-je`);
        }
        continue;
      }
      // a cél túloldalán (short: fölötte, long: alatta) a legvastagabb vonal, az ártól ≤ 2,5 ATR-re
      const c = lines.filter(g => -dir * (g.p - target) >= 0.5 * atr[i] && -dir * (g.p - b.c) > 2 * tick && Math.abs(g.p - b.c) <= 2.5 * atr[i])
        .sort((x, y) => (y.n - x.n) || Math.abs(x.p - b.c) - Math.abs(y.p - b.c))[0];
      if (!c) { if (!act.miss[dir]) { act.miss[dir] = true; act.log.push(`${side(dir)}: nincs vastag vonal a cél ${dir > 0 ? "alatt" : "fölött"} 2,5 ATR-en belül (ár ${f3(b.c)}) – keres tovább`); } continue; }
      const e = c.p, legs = [0, 1, 2, 3].map(k => ({ p: e - dir * gap * k, why: k ? "DCA" + k : `entry (EGYEZÉS ${c.n})`, units: UNITS[k] }));
      const unit = cfg.sized ? unitFor(cfg.bal || 14571, dir, legs, cfg.swan || 70) : 1;
      const t = { id: ++id, acc: "SB", dir, legs, unit, filled: 0, qty: 0, cost: 0, avg: null, open: 0, state: "vár", from: b.t, day: act.t, window: WNAME[act.idx],
        wkey: act.key, fvg: act.fvg, target: TARGET[act.idx], atr: atr[i], fills: [], exits: [], fees: 0, realized: 0, closeT: null, lastFill: -1, tpHit: [], shares: [1], tpLog: [] };
      setTp(t, tpP, why, b);
      trades.push(t); act.placed[dir] = true;
      act.log.push(`megbízás: ${side(dir)} limit ${f3(e)} (EGYEZÉS ${c.n}) → TP ${f3(tpP)} (${TARGET[act.idx]})`);
    }
  }
  function d0(t, p) { return t.dir * (p - t.avg) > 0; }
  const last = bars[bars.length - 1];
  for (const t of trades) t.unreal = t.state === "aktív" ? t.dir * (last.c - t.avg) * t.open : 0;
  for (const w of logs) if (!w.fvg) w.log.push("nem alakult ki FVG az ablakban");
  const windows = logs.map(w => ({ t: w.t, window: WNAME[w.idx], log: w.log }));
  return { trades, events, last, windows };
}
