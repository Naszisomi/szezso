// Silver bullet kereskedés (HYPE, a 7. „SB” számlán, cross-ban, a rácstól külön) – az 5 perces gyertyákon végigjátszva.
//
// Szabályok (a megbeszéltek szerint):
//  • Ablakok (NY idő): 03–04, 10–11, 14–15.
//  • A silver bullet lényege, hogy az ár visszatér az FVG-hez: az FVG a CÉL, nem a belépő.
//  • Az ablak első 5m FVG-je az ablak első felében derül ki; csak utána nyílhat kereskedés.
//  • Ha az ár az FVG fölött van → short, alatta → long. A belépő limit a legközelebbi erős szinten az ár túloldalán
//    (vastag egyezésvonal vagy Milana-nyitóvonal), a fals mozdulat végénél – pl. a 66-os egyezésvonalnál, onnan le az FVG-ig.
//    Ha az ár előbb visszaér az FVG-hez, vagy az ablak vége után egy órával sem teljesül, a megbízás törlődik.
//  • DCA: itt is 3 (1/1/2/4 egység), legalább 3 $ lépéssel.
//  • TP: az FVG közelebbi széle (2 tickkel előtte), egyben zárva. Ha az ablakban nem jön össze, a kereskedés marad,
//    és a TP a következő ablak FVG-jéhez igazodik.
//  • Ha összejön, új belépő a következő ablakban. Egyszerre egy silver bullet kereskedés fut.
//  • Méret: az SB számla egyenlegéből, a rácséval azonos feltétellel (70 $-os esés/emelkedés se likvidálja), díjak: limit 2 bp.
import { nyOffset } from "./ind/milana.js";
import { UNITS } from "./engine/tradeutil.js";
import { unitFor } from "./grid.js";

const MAKER = 0.0002;
const WINDOWS = [[180, 240], [600, 660], [840, 900]];                 // percek NY idő szerint
const OPENS = [["TWO", 18 * 60, true], ["TDO", 0], ["TAO", 20 * 60 + 30], ["TLO", 2 * 60 + 30], ["TNY", 8 * 60 + 30], ["NYAM", 9 * 60 + 30], ["TPM", 14 * 60 + 30]];

export function simulateSB(bars, cfg) {
  const trades = [], events = [];
  if (bars.length < 50) return { trades, events };
  const offs = new Map(), nyMin = t => {
    const h = Math.floor(t / 3600000);
    if (!offs.has(h)) offs.set(h, nyOffset(h * 3600000));
    const loc = t + offs.get(h), d = new Date(loc);
    return { m: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: d.getUTCDay() };
  };
  // 5m ATR(14) → ≈ 15m ATR (×√3)
  const atr = []; let a = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1] || b, tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14; atr.push(a * 1.73);
  }
  const lv = {}, fvgWait = {};
  let win = null, lastWin = null, cur = null, pending = null, id = 0, lastWinDone = -1;
  const gap = cfg.gap || 3, tick = cfg.tick || 0.001;

  const levels = () => {
    const out = [];
    for (const [k, v] of Object.entries(lv)) { out.push({ p: v.open, why: k }); if (v.fvg) out.push({ p: v.fvg[0], why: k + " FVG" }, { p: v.fvg[1], why: k + " FVG" }); }
    if (win) out.push({ p: win.start, why: "ablak-nyitó" });
    return out;
  };
  const tpFrom = (d, ref) => {
    const min = Math.max(tick * 10, ref * 0.001);
    const c = levels().filter(x => d * (x.p - ref) >= min).sort((x, y) => d * (x.p - y.p))[0];
    return c ? { p: c.p - d * 2 * tick, why: c.why + " (2 tickkel előtte)" } : { p: ref + d * Math.max(min, (cur ? cur.atr : 0.5)), why: "nincs szint" };
  };
  const fill = (t, k, b) => {
    const l = t.legs[k], q = l.units * t.unit, fee = q * l.p * MAKER;
    t.qty += q; t.open += q; t.cost += q * l.p; t.avg = t.cost / t.qty; t.filled = k + 1; t.lastFill = b.t; t.fees += fee;
    t.fills.push({ t: b.t, p: l.p, qty: q, why: k ? "DCA" + k : "entry", fee });
    events.push({ t: b.t, acc: "SB", pnl: -fee, trade: t.id, why: `SB ${t.dir > 0 ? "long" : "short"} ${k ? "DCA" + k : "entry"} díj` });
    if (t.state === "vár") t.state = "aktív";
  };

  for (let i = 2; i < bars.length; i++) {
    const b = bars[i], pb = bars[i - 1], { m, wd } = nyMin(b.t);
    // Milana-nyitások és az utánuk következő első 5m FVG
    for (const [k, mm, monday] of OPENS) if (m === mm && (!monday || wd === 0)) { lv[k] = { open: b.o, fvg: null }; fvgWait[k] = i; }
    for (const k of Object.keys(fvgWait)) {
      if (i - fvgWait[k] > 24) { delete fvgWait[k]; continue; }
      const b2 = bars[i - 2];
      if (i - 2 >= fvgWait[k] - 1 && (b.l > b2.h || b.h < b2.l)) { lv[k].fvg = b.l > b2.h ? [b2.h, b.l] : [b.h, b2.l]; delete fvgWait[k]; }
    }
    // ablak
    const wi = WINDOWS.findIndex(([s, e]) => m >= s && m < e);
    if (wi >= 0 && (!win || win.key !== Math.floor(b.t / 86400000) * 10 + wi)) {
      win = { key: Math.floor(b.t / 86400000) * 10 + wi, idx: wi, start: b.o, hi: b.h, lo: b.l, s: WINDOWS[wi][0], e: WINDOWS[wi][1], t: b.t, done: false };
      // (a futó kereskedés TP-je az új ablak FVG-jéhez igazodik, amint az kiderül)
    } else if (win && wi < 0) {
      win.tEnd = b.t; lastWin = win; win = null;          // a megbízás még egy óráig élhet
    }
    if (win) { win.hi = Math.max(win.hi, b.h); win.lo = Math.min(win.lo, b.l); }

    // nyitott kereskedés: DCA-k és TP
    if (cur) {
      const d = cur.dir;
      let filled = false;
      while (cur.filled < 4 && (d > 0 ? b.l <= cur.legs[cur.filled].p : b.h >= cur.legs[cur.filled].p)) { fill(cur, cur.filled, b); filled = true; }
      if (filled && d * (cur.tp.p - cur.avg) <= 0) { cur.tp = tpFrom(d, cur.avg); cur.tpLog.push({ t: b.t, p: cur.tp.p, why: cur.tp.why }); }
      if (cur.state === "aktív" && cur.lastFill !== b.t && (d > 0 ? b.h >= cur.tp.p : b.l <= cur.tp.p)) {
        const px = cur.tp.p, q = cur.open, f = q * px * MAKER, pnl = d * (px - cur.avg) * q;
        cur.open = 0; cur.fees += f; cur.realized += pnl; cur.exits.push({ t: b.t, p: px, qty: q, why: "TP", pnl, fee: f });
        cur.state = "lezárva"; cur.closeT = b.t; cur.tpHit = [0];
        events.push({ t: b.t, acc: "SB", pnl: pnl - f, trade: cur.id, why: `SB ${d > 0 ? "long" : "short"} TP` });
        lastWinDone = (win || lastWin || {}).key;                       // új belépő csak a következő ablakban
        cur = null;
      }
    }

    // az ablak első 5m FVG-je (a cél); ha ismert, a futó kereskedés TP-je is hozzá igazodik
    if (win && !win.fvg && m < win.s + 30 && bars[i - 2].t >= win.t) {
      const b2 = bars[i - 2];
      if (b.l > b2.h) win.fvg = [b2.h, b.l]; else if (b.h < b2.l) win.fvg = [b.h, b2.l];
      if (win.fvg && cur && cur.state === "aktív") {
        const x = cur.dir > 0 ? win.fvg[0] - 2 * tick : win.fvg[1] + 2 * tick;
        if (cur.dir * (x - cur.avg) > 0) { cur.tp = { p: x, why: "az ablak FVG-je (2 tickkel előtte)" }; cur.tpLog.push({ t: b.t, p: x, why: cur.tp.why }); }
      }
    }
    // új belépő: az FVG ismertté válása után, az ablak végéig (+1 óra), ha nincs futó silver bullet
    const act = win || (lastWin && b.t < lastWin.tEnd + 3600000 ? lastWin : null);
    if (act && act.fvg && !cur && !act.done && act.key !== lastWinDone) {
      const [fb, ft] = act.fvg, dir = b.c > ft ? -1 : b.c < fb ? 1 : 0;
      if (dir) {
        // a belépő: a legközelebbi erős szint az ár túloldalán (short: fölötte), legfeljebb 2,5 15m-ATR-re
        const cands = [...(cfg.cfLines ? cfg.cfLines(b.t) : []).map(g => ({ p: g.p, why: `EGYEZÉS ${g.n}` })), ...Object.entries(lv).map(([k, v]) => ({ p: v.open, why: k }))]
          .filter(x => -dir * (x.p - b.c) > 2 * tick && Math.abs(x.p - b.c) <= 2.5 * atr[i]).sort((a, z) => Math.abs(a.p - b.c) - Math.abs(z.p - b.c));
        if (cands.length) {
          const e = cands[0].p;
          const legs = [0, 1, 2, 3].map(k => ({ p: e - dir * gap * k, why: k ? "DCA" + k : "entry (" + cands[0].why + ")", units: UNITS[k] }));
          const unit = cfg.sized ? unitFor(cfg.bal || 14571, dir, legs, cfg.swan || 70) : 1;
          cur = { id: ++id, acc: "SB", dir, legs, unit, filled: 0, qty: 0, cost: 0, avg: null, open: 0, state: "vár", from: b.t, day: act.t, window: ["03–04", "10–11", "14–15"][act.idx],
            fvg: act.fvg, atr: atr[i], fills: [], exits: [], fees: 0, realized: 0, closeT: null, lastFill: -1, tpHit: [], shares: [1], tpLog: [] };
          cur.tp = { p: dir > 0 ? fb - 2 * tick : ft + 2 * tick, why: "az ablak FVG-je (2 tickkel előtte)" };
          cur.tpLog.push({ t: b.t, p: cur.tp.p, why: cur.tp.why });
          trades.push(cur); act.done = true; pending = cur;
        }
      }
    }
    // a várakozó megbízás törlése, ha az ár előbb visszaért az FVG-hez, vagy lejárt az idő
    if (pending && pending.state === "vár") {
      const [fb, ft] = pending.fvg, back = pending.dir < 0 ? b.l <= ft : b.h >= fb;
      const late = !win && (!lastWin || b.t >= lastWin.tEnd + 3600000);
      if (back || late) { pending.state = "lejárt"; pending.closeT = b.t; if (cur === pending) cur = null; pending = null; }
    }
    if (cur) cur.tps = [cur.tp];
    if (pending && pending.state !== "vár") pending = null;
  }
  const last = bars[bars.length - 1];
  for (const t of trades) t.unreal = t.state === "aktív" ? t.dir * (last.c - t.avg) * t.open : 0;
  return { trades, events, last };
}
