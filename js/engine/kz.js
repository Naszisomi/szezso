// ICT Killzones & Pivots [TFO] – a TradingView-on használt alapbeállításokkal:
//  dobozok (ASIA, LNDN, NYAM, NYPM), pivotvonalak "ASIA High/Low" felirattal (a legutóbbi
//  munkamenet vonala a letörésig nyúlik), középvonal (midline), előző nap/hét/hónap H/L + középvonal,
//  nyitóárak (NY Open, Midday, Close) és időbélyeg-függőlegesek.
//  1 óráig látszik (kérésre), 3 munkamenet / időszak marad. Vonalvastagság a TradingView-os beállítás szerint.
import { rgba } from "../draw.js";
import { inSession, parseSession } from "./ny.js";

const C = { blue: "#2196F3", red: "#F23645", teal: "#089981", orange: "#FF9800", fuchsia: "#E040FB",
  black: "#363A45", green: "#4CAF50", gray: "#787B86", pure_red: "#FF0000" };

export const KZ_DEFAULTS = {
  tfLimit: 3600, maxDays: 3, transp: 60,
  zones: [
    { name: "ASIA", sess: "2000-0000", color: C.blue,    on: true },
    { name: "LNDN", sess: "0200-0500", color: C.red,     on: true },
    { name: "NYAM", sess: "0930-1100", color: C.teal,    on: true },
    { name: "NYL",  sess: "1200-1300", color: C.orange,  on: false },
    { name: "NYPM", sess: "1330-1600", color: C.fuchsia, on: true },
    { name: "RTH",  sess: "0930-1600", color: C.black,   on: false },
  ],
  pivots: true, pivotStyle: "solid", pivotWidth: 3, midpoints: true, midStyle: "dashed", midWidth: 3, pivotLabels: true,
  dwm: [
    { tf: "D", color: C.blue,  hl: true, mid: true, open: true },
    { tf: "W", color: C.teal,  hl: true, mid: true, open: true },
    { tf: "M", color: C.red,   hl: true, mid: true, open: false },
  ],
  dwmStyle: "dotted", dwmWidth: 3,
  opens: [ { hhmm: 570, color: C.blue, text: "NY Open" }, { hhmm: 720, color: C.orange, text: "Midday" },
           { hhmm: 960, color: C.pure_red, text: "Close" } ],
  openStyle: "dashed",
  stamps: [ { hhmm: 570, color: C.green }, { hhmm: 720, color: C.orange }, { hhmm: 960, color: C.red } ],
  labelSize: 12,
};

// A killzone-munkamenetek (a motor többi része is használja: célár, EGYEZÉS, narratíva).
export function kzSessions(bars, ny, cfg = KZ_DEFAULTS) {
  const out = {};
  for (const z of cfg.zones) {
    const ses = parseSession(z.sess), list = [];
    let prev = false;
    for (let i = 0; i < bars.length; i++) {
      const t = inSession(ny.min[i], ses);
      const b = bars[i];
      if (t && !prev) list.push({ i0: i, i1: i, hi: b.h, lo: b.l, hiI: i, loI: i });
      if (t) {
        const s = list[list.length - 1];
        s.i1 = i;
        if (b.h > s.hi) { s.hi = b.h; s.hiI = i; }
        if (b.l < s.lo) { s.lo = b.l; s.loI = i; }
      }
      prev = t;
    }
    out[z.name] = list;
  }
  return out;
}

function dayStart(t) { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
function periodStart(t, tf) {
  const d = new Date(t);
  if (tf === "M") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (tf === "W") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return dayStart(t);
}

export function kzLayer(bars, barSec, ny, sessions, daily, cfg = KZ_DEFAULTS) {
  const items = [];
  if (!bars.length || barSec > cfg.tfLimit) return items;
  const last = bars.length - 1, T = i => bars[i].t, fs = cfg.labelSize;

  // ── Killzone dobozok, pivotok, középvonal ──
  for (const z of cfg.zones) {
    if (!z.on) continue;
    const list = sessions[z.name] || [];
    const keep = list.slice(-cfg.maxDays);
    keep.forEach((s, k) => {
      const recent = k === keep.length - 1;
      const col = rgba(z.color, cfg.transp), solid = z.color;
      items.push({ type: "box", t1: T(s.i0), p1: s.hi, t2: T(s.i1), p2: s.lo, bg: col, border: col });
      if (!cfg.pivots) return;
      // a munkamenet után: csak a legutóbbi nyúlik tovább, a letörésig (a letörő gyertyáig)
      const next = list[list.indexOf(s) + 1];
      const stopAt = next ? next.i0 - 1 : last;
      let hiEnd = s.i1, loEnd = s.i1, hiBroke = false, loBroke = false;
      if (recent || !next) {
        for (let i = s.i1 + 1; i <= stopAt; i++) {
          if (!hiBroke) { hiEnd = i; if (bars[i].h > s.hi) hiBroke = true; }
          if (!loBroke) { loEnd = i; if (bars[i].l < s.lo) loBroke = true; }
          if (hiBroke && loBroke) break;
        }
      } else {
        // a régebbiek addig értek, amíg a következő azonos killzone el nem indult
        for (let i = s.i1 + 1; i < next.i0; i++) {
          if (!hiBroke) { hiEnd = i; if (bars[i].h > s.hi) hiBroke = true; }
          if (!loBroke) { loEnd = i; if (bars[i].l < s.lo) loBroke = true; }
          if (hiBroke && loBroke) break;
        }
      }
      items.push({ type: "line", t1: T(s.hiI), p1: s.hi, t2: T(hiEnd), p2: s.hi, color: solid, width: cfg.pivotWidth, style: cfg.pivotStyle });
      items.push({ type: "line", t1: T(s.loI), p1: s.lo, t2: T(loEnd), p2: s.lo, color: solid, width: cfg.pivotWidth, style: cfg.pivotStyle });
      if (cfg.midpoints) {
        const mid = (s.hi + s.lo) / 2, mEnd = recent ? last : (next ? next.i0 - 1 : last);
        items.push({ type: "line", t1: T(s.i1), p1: mid, t2: T(Math.max(s.i1, mEnd)), p2: mid, color: solid, width: cfg.midWidth, style: cfg.midStyle });
      }
      if (cfg.pivotLabels) {
        items.push({ type: "label", t: T(hiEnd), p: s.hi, text: z.name + " High", color: solid, size: fs, align: "left", vAlign: hiBroke ? "above" : "middle" });
        items.push({ type: "label", t: T(loEnd), p: s.lo, text: z.name + " Low", color: solid, size: fs, align: "left", vAlign: loBroke ? "below" : "middle" });
      }
    });
  }

  // ── Előző nap / hét / hónap H, L, középvonal (a napi gyertyákból) ──
  if (daily && daily.length) {
    for (const d of cfg.dwm) {
      if (!d.hl && !d.open) continue;
      // időszakok a betöltött gyertyák szerint, a legutóbbi 3
      const starts = [];
      for (let i = 0; i <= last; i++) {
        const ps = periodStart(bars[i].t, d.tf);
        if (!starts.length || starts[starts.length - 1].t !== ps) starts.push({ t: ps, i });
      }
      const ks = starts.slice(-cfg.maxDays);
      ks.forEach((p, k) => {
        const prevStart = periodStart(p.t - 1, d.tf);
        let h = -Infinity, l = Infinity;
        for (const b of daily) if (b.t >= prevStart && b.t < p.t) { if (b.h > h) h = b.h; if (b.l < l) l = b.l; }
        const nxt = ks[k + 1], t1 = Math.max(p.t, bars[0].t), t2 = nxt ? T(nxt.i) : T(last);
        const lines = [];
        if (d.open) {
          // az időszak nyitóára: a napi gyertyából, ha van, különben az időszak első betöltött gyertyájából
          const db = daily.find(b => b.t >= p.t);
          const o = db && periodStart(db.t, d.tf) === p.t ? db.o : bars[p.i].o;
          lines.push([o, d.tf + " OPEN"]);
        }
        if (d.hl && isFinite(h)) {
          lines.push([h, "P" + d.tf + "H"], [l, "P" + d.tf + "L"]);
          if (d.mid) lines.push([(h + l) / 2, "P" + d.tf + "M"]);
        }
        for (const [y, txt] of lines) {
          items.push({ type: "line", t1, p1: y, t2, p2: y, color: d.color, width: cfg.dwmWidth, style: cfg.dwmStyle });
          items.push({ type: "label", t: t2, p: y, text: txt, color: d.color, size: fs, align: "left", vAlign: "middle" });
        }
      });
    }
  }

  // ── Nyitóárak (a legutóbbi) és időbélyegek ──
  const barMin = barSec / 60;
  const lastHit = hhmm => {
    for (let i = last; i >= 0; i--) if (ny.min[i] <= hhmm && hhmm < ny.min[i] + barMin) return i;
    return -1;
  };
  for (const o of cfg.opens) {
    const i = lastHit(o.hhmm);
    if (i < 0) continue;
    const end = Math.max(i, last);
    items.push({ type: "line", t1: T(i), p1: bars[i].o, t2: T(end), p2: bars[i].o, color: o.color, width: 1, style: cfg.openStyle });
    items.push({ type: "label", t: T(end), p: bars[i].o, text: o.text, color: o.color, size: fs, align: "left", vAlign: "middle" });
  }
  for (const s of cfg.stamps) {
    const i = lastHit(s.hhmm);
    if (i >= 0) items.push({ type: "vline", t: T(i), color: s.color, width: 1, style: "dotted" });
  }
  return items;
}
