// Milana – True Opens + első FVG.
// A TradingView-on futó "milána" Pine Script (a jobban egyező, első verzió) átirata.
//  - 7 nyitás (NY idő): TWO hétfő 18:00, TDO 00:00, TAO 20:30, TLO 02:30,
//    TNY 08:30, NYAM 09:30, TPM 14:30
//  - minden nyitás után az első FVG (a nyitógyertyával kezdődő is számít)
//  - az előző vonal / FVG a következő ugyanilyen nyitásnál ér véget
//  - 30m-ig minden nyitás, 1h-n TDO + TWO, 4h-n TDO (felirattal), napi charton semmi
import { rgba } from "../draw.js";

export const MILANA_DEFAULTS = {
  on: true,
  opens: [
    { name: "TWO",  hh: 18, mm: 0,  monday: true, color: "#7E6FA6", maxTf: 3600,  on: true, fvg: true },
    { name: "TDO",  hh: 0,  mm: 0,  color: "#5B7DB1", maxTf: 14400, on: true, fvg: true },
    { name: "TAO",  hh: 20, mm: 30, color: "#5E9E99", maxTf: 1800,  on: true, fvg: true },
    { name: "TLO",  hh: 2,  mm: 30, color: "#B39B66", maxTf: 1800,  on: true, fvg: true },
    { name: "TNY",  hh: 8,  mm: 30, color: "#B07474", maxTf: 1800,  on: true, fvg: true },
    { name: "NYAM", hh: 9,  mm: 30, color: "#5E9970", maxTf: 1800,  on: true, fvg: true },
    { name: "TPM",  hh: 14, mm: 30, color: "#8A8F94", maxTf: 1800,  on: true, fvg: true },
  ],
  bullCol: "#4CAF73", bearCol: "#C76464", transp: 80,
  fvgLabels: true, fvgLabelCol: "#8A8F94",
  style: "dashed", width: 1, ext: 5,
  labels: true, labelMaxTf: 14400,
  keep: true, days: 30,
};

// ── New York-i idő -> UTC (nyári/téli időszámítással) ──
const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
function nyParts(ms) { return Object.fromEntries(nyFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])); }
function nyOffset(ms) {           // NY helyi idő - UTC, ms-ben
  const p = nyParts(ms);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
export function nyToUtc(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let res = guess - nyOffset(guess);
  const off2 = nyOffset(res);
  if (guess - off2 !== res) res = guess - off2;
  return res;
}
export function nyDate(ms) { const p = nyParts(ms); return { y: +p.year, m: +p.month, d: +p.day, wd: p.weekday }; }

// Az adott NY-időpontokat tartalmazó gyertyák indexei (növekvő), a Pine f_hit logikája szerint:
// az a gyertya, amelynek záróideje a célidő után van, és az előzőé legfeljebb a célidő.
const hitCache = new Map();
function hitIndices(bars, barMs, o, fromMs) {
  const ck = [bars.length && bars[0].t, bars.length, barMs, o.name, o.hh, o.mm, Math.floor(fromMs / 86400000)].join("|");
  if (hitCache.has(ck)) return hitCache.get(ck);
  const out = hitIndicesRaw(bars, barMs, o, fromMs);
  if (hitCache.size > 200) hitCache.clear();
  hitCache.set(ck, out);
  return out;
}
function hitIndicesRaw(bars, barMs, o, fromMs) {
  const out = [];
  if (!bars.length) return out;
  const lastClose = bars[bars.length - 1].t + barMs;
  let { y, m, d } = nyDate(Math.max(fromMs, bars[0].t));
  const endDay = nyDate(lastClose);
  const endKey = endDay.y * 10000 + endDay.m * 100 + endDay.d;
  for (let guard = 0; guard < 2000; guard++) {
    const key = y * 10000 + m * 100 + d;
    if (key > endKey) break;
    const target = nyToUtc(y, m, d, o.hh, o.mm);
    const okDay = !o.monday || new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
    if (okDay && target >= bars[0].t && target < lastClose) {
      // első gyertya, amelynek záróideje > célidő
      let lo = 0, hi = bars.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].t + barMs > target) hi = mid; else lo = mid + 1; }
      if (lo > 0 && (!out.length || out[out.length - 1] !== lo)) out.push(lo);
    }
    const nd = new Date(Date.UTC(y, m - 1, d + 1));
    y = nd.getUTCFullYear(); m = nd.getUTCMonth() + 1; d = nd.getUTCDate();
  }
  return out;
}

// Milyen régre kell visszamenni az adatnak, hogy minden bekapcsolt nyitás legutóbbi
// előfordulása (és a gyertya előtte) benne legyen. ms-ben adja vissza (vagy Infinity).
export function milanaHistoryFrom(nowMs, barSec, cfg = MILANA_DEFAULTS) {
  let need = Infinity;
  const today = nyDate(nowMs);
  for (const o of cfg.opens) {
    if (!o.on || barSec > o.maxTf || barSec >= 86400) continue;
    for (let back = 0; back < 9; back++) {
      const nd = new Date(Date.UTC(today.y, today.m - 1, today.d - back));
      if (o.monday && nd.getUTCDay() !== 1) continue;
      const target = nyToUtc(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate(), o.hh, o.mm);
      if (target <= nowMs) { need = Math.min(need, target - 3 * barSec * 1000); break; }
    }
  }
  return need;
}

// Kiszámolja a Milana-rajzokat a gyertyákból. bars: [{t,o,h,l,c,done}], barSec: gyertyahossz.
export function milana(bars, barSec, cfg = MILANA_DEFAULTS) {
  const items = [];
  if (!cfg.on || !bars.length || barSec >= 86400) return { items };
  const barMs = barSec * 1000;
  const last = bars.length - 1;
  const tAt = i => i <= last ? bars[i].t : bars[last].t + (i - last) * barMs;   // index -> idő (jövőben is)
  const lblOn = cfg.labels && barSec <= cfg.labelMaxTf;
  const style = cfg.style;

  for (const o of cfg.opens) {
    if (!o.on || barSec > o.maxTf) continue;
    const spanDays = o.monday ? (cfg.days + 2) * 7 : cfg.days + 3;
    const from = bars[last].t - spanDays * 86400000;
    let hits = hitIndices(bars, barMs, o, from);
    if (!cfg.keep) hits = hits.slice(-1);
    else hits = hits.slice(-(cfg.days + 1));        // a mai + a megtartott előző napok

    hits.forEach((s, k) => {
      const isCur = k === hits.length - 1;
      const endIdx = isCur ? last + cfg.ext : hits[k + 1];   // a régi a következő nyitásnál ér véget
      const price = bars[s].o;
      items.push({ type: "line", t1: tAt(s), p1: price, t2: tAt(endIdx), p2: price, color: o.color, width: cfg.width, style });
      if (lblOn) items.push({ type: "label", t: tAt(endIdx), p: price, text: o.name, color: o.color, size: 11, align: "left", vAlign: "middle" });

      if (!o.fvg) return;
      // első FVG: a nyitás után, a következő nyitásig, csak lezárt gyertyákon
      const stop = isCur ? last : hits[k + 1] - 1;
      for (let j = s + 2; j <= stop; j++) {
        const b = bars[j];
        if (j === last && !b.done) break;
        const b2 = bars[j - 2];
        const bull = b.l > b2.h, bear = b.h < b2.l;
        if (!bull && !bear) continue;
        const top = bull ? b.l : b2.l, bot = bull ? b2.h : b.h;
        const bc = bull ? cfg.bullCol : cfg.bearCol;
        items.push({ type: "box", t1: tAt(j - 2), p1: top, t2: tAt(endIdx), p2: bot,
          border: rgba(bc, 50), borderWidth: 1, bg: rgba(bc, cfg.transp),
          text: o.name + " FVG", textColor: cfg.fvgLabels && lblOn ? cfg.fvgLabelCol : null, textSize: 11, hAlign: "right" });
        break;
      }
    });
  }
  return { items };
}
