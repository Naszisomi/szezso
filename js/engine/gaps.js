// Gyertyatest-szakadások (rések) és CRT gyertyaszín – a szezsoT szabályai szerint.
//  Rés: két egymást követő gyertya teste közötti űr. Felfelé zöld (két sárga CRT között sárga),
//  lefelé piros (két lila CRT között lila). Csak a saját idősík egy későbbi, LEZÁRT, UGYANOLYAN
//  IRÁNYÚ gyertyájának teste oldja fel, ha teljesen átmegy rajta (ekkor eltűnik); ha csak belelóg,
//  szürke lesz. A ≥ 1 ATR rések sötétek, vastag kerettel; a kisebbek halványak.
import { rgba } from "../draw.js";

export const GAP_DEFAULTS = {
  max: 150, minAtr: 0.02, minTfSec: 3600, ext: 5,
  upCol: "#4CAF50", upCrt: "#FFEB3B", dnCol: "#F44336", dnCrt: "#9C27B0",
  fill: "#F5DEB3", fillT: 15, wick: "#BDBDBD", wickT: 35, bigW: 3, bigAtr: 1.0, light: 70,
  crtBull: "#FFEB3B", crtBear: "#9C27B0",
};

// Pine ta.atr(14): RMA a valódi tartományon
export function atr(bars, len = 14) {
  const out = new Float64Array(bars.length);
  let sum = 0, prev = NaN;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], pc = i ? bars[i - 1].c : NaN;
    const tr = i ? Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)) : b.h - b.l;
    if (i < len) { sum += tr; prev = i === len - 1 ? sum / len : NaN; }
    else prev = (prev * (len - 1) + tr) / len;
    out[i] = prev;
  }
  return out;
}

export function crtFlags(b) {
  const body = Math.abs(b.c - b.o), up = b.h - Math.max(b.o, b.c), lo = Math.min(b.o, b.c) - b.l;
  const is = body > up + lo;
  return { up: is && b.c > b.o, dn: is && b.c < b.o };
}

// A rések számítása (a motor többi része is használja: célár, EGYEZÉS).
export function computeGaps(bars, barSec, atrArr, cfg = GAP_DEFAULTS) {
  const gaps = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    if (!b.done) break;                               // csak lezárt gyertya (barstate.isconfirmed)
    const cTop = Math.max(b.o, b.c), cBot = Math.min(b.o, b.c);
    // 1) a meglévők ellenőrzése
    for (let k = gaps.length - 1; k >= 0; k--) {
      const g = gaps[k];
      if (g.closed || i <= g.i) continue;
      const sameDir = g.bull ? b.c > b.o : b.c < b.o;
      if (sameDir && cBot <= g.bot && cTop >= g.top) { g.closed = true; g.end = i; gaps.splice(k, 1); continue; }
      if (!g.wicked && (g.bull ? b.l <= g.top : b.h >= g.bot)) g.wicked = true;
    }
    // 2) új rés
    const p = bars[i - 1], pTop = Math.max(p.o, p.c), pBot = Math.min(p.o, p.c);
    const a = atrArr[i];
    const minGap = barSec >= cfg.minTfSec ? 0 : (isNaN(a) ? 0 : a * cfg.minAtr);
    const pc = crtFlags(p), cc = crtFlags(b);
    if (cBot > pTop && cBot - pTop > minGap)
      gaps.push({ i, top: cBot, bot: pTop, bull: true, crt: pc.up && cc.up, big: !isNaN(a) && cBot - pTop >= a * cfg.bigAtr, wicked: false });
    if (cTop < pBot && pBot - cTop > minGap)
      gaps.push({ i, top: pBot, bot: cTop, bull: false, crt: pc.dn && cc.dn, big: !isNaN(a) && pBot - cTop >= a * cfg.bigAtr, wicked: false });
    while (gaps.length > cfg.max) gaps.shift();
  }
  return gaps;                                        // csak a nyitott (fel nem oldott) rések
}

export function gapLayer(bars, barSec, gaps, cfg = GAP_DEFAULTS) {
  const items = [];
  if (!bars.length) return items;
  const lastT = bars[bars.length - 1].t + cfg.ext * barSec * 1000;
  for (const g of gaps) {
    const col = g.bull ? (g.crt ? cfg.upCrt : cfg.upCol) : (g.crt ? cfg.dnCrt : cfg.dnCol);
    const fillT = g.big ? cfg.fillT : Math.max(cfg.fillT, cfg.light + 10);
    const wickT = g.big ? cfg.wickT : Math.max(cfg.wickT, cfg.light + 10);
    items.push({
      type: "box", t1: bars[g.i - 1].t, p1: g.top, t2: lastT, p2: g.bot,
      bg: g.wicked ? rgba(cfg.wick, wickT) : rgba(cfg.fill, fillT),
      border: g.big ? col : rgba(col, cfg.light), borderWidth: g.big ? cfg.bigW : 1,
    });
  }
  return items;
}

// CRT gyertyaszín: index -> szín (csak a CRT gyertyák)
export function crtColors(bars, cfg = GAP_DEFAULTS) {
  const out = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const f = crtFlags(bars[i]);
    if (f.up) out[i] = cfg.crtBull; else if (f.dn) out[i] = cfg.crtBear;
  }
  return out;
}
