// Közös motor: minden építőelemet egyszer számol ki a gyertyákból, és ebből rajzolja
// a bekapcsolt rétegeket. A rétegek csak rajzolnak – a számítás akkor is lefut, ha egy réteg ki van kapcsolva,
// mert a motor (célár, EGYEZÉS, narratíva) használja.
import { nyClock } from "./ny.js";
import { kzSessions, kzLayer, KZ_DEFAULTS } from "./kz.js";
import { milana, MILANA_DEFAULTS } from "../ind/milana.js";
import { atr, computeGaps, gapLayer, crtColors } from "./gaps.js";
import { volumeProfile, vpArrowLayer } from "./vp.js";
import { orderBlocks, liquidity, volumaticFvg, htfLevels } from "./struct.js";
import { oscillators } from "./osc.js";
import { gannEvents, gannTimeScore, GANN_YEARS } from "./gann.js";
import { autoFib, gann, fibLayer } from "./fib.js";
import { supertrend } from "./st.js";
import { allPatterns } from "./patterns.js";
import { wyckoff } from "./wyckoff.js";
import { weeklyProfile } from "./weekly.js";
import { confluence, confluenceLayer } from "./confluence.js";
import { narrativeLayer } from "./narrative.js";
import { dgtMove, mostTouched, premiumDiscount, goldenPocketZones, elliott, oteAbc, pois, angleStructure } from "./struct2.js";
import { tgif, tgifLayer, volDivergence, volDivLayer } from "./extra.js";

export const LAYERS = [
  { key: "kz",     label: "Killzone",  def: true },
  { key: "milana", label: "Milana",    def: true },
  { key: "gaps",   label: "Rések",     def: true },
  { key: "crt",    label: "CRT szín",  def: true },
  { key: "vp",     label: "VP nyíl",   def: true },
  { key: "fib",    label: "Auto Fib",  def: false },
  { key: "tgif",   label: "TGIF",      def: true },
  { key: "voldiv", label: "Vol. div.", def: true },
  { key: "cf",     label: "Egyezés",   def: true },
  { key: "ict",    label: "ICT-rajz",  def: true },
];

// input: { bars, barSec, daily, layers:{kz:true,...} } -> { items, ctx, barColors }
export function runEngine({ bars, barSec, daily, layers, tick }) {
  const items = [];
  if (!bars.length) return { items, ctx: null };
  const ny = nyClock(bars);
  const sessions = kzSessions(bars, ny, KZ_DEFAULTS);
  const atr14 = atr(bars, 14);
  const gaps = computeGaps(bars, barSec, atr14);
  const vp = volumeProfile(bars, tick);
  const ctx = { ny, sessions, atr14, gaps, vp,
    ob: orderBlocks(bars), liq: liquidity(bars), vfvg: volumaticFvg(bars), htf: htfLevels(bars, barSec, daily),
    osc: oscillators(bars, daily) };
  const now = bars[bars.length - 1].t;
  ctx.gann = gannEvents(daily, now - 30 * 86400000, now + 120 * 86400000);
  ctx.gannNow = gannTimeScore(ctx.gann, now);
  ctx.gannYear = GANN_YEARS[new Date(now).getUTCFullYear()] || null;
  ctx.fib = autoFib(bars);
  ctx.gannBox = gann(bars, ctx.fib);
  ctx.st = supertrend(bars);
  ctx.tgif = barSec <= 3600 ? tgif(bars, barSec, ny) : [];
  ctx.voldiv = volDivergence(bars, 5, 6, atr14);
  ctx.move = dgtMove(bars);
  ctx.touched = mostTouched(bars);
  ctx.pd = premiumDiscount(bars);
  ctx.gpz = goldenPocketZones(daily);
  ctx.ew = elliott(bars);
  ctx.ote = oteAbc(bars, barSec);
  ctx.poi = pois(bars, barSec, ny);
  ctx.ams = angleStructure(bars);
  ctx.pat = allPatterns(bars);
  ctx.wy = wyckoff(bars);
  ctx.week = weeklyProfile(bars, barSec, ny);
  ctx.dwm = dwmLevels(daily, now);
  const milItems = milana(bars, barSec, MILANA_DEFAULTS).items;
  ctx.cf = confluence(bars, ctx, milItems);
  ctx.n = bars.length;
  ctx.milanaTargets = milItems.flatMap(it => it.type === "line" && it.p1 === it.p2 ? [it.p1] : it.type === "box" ? [it.p1, it.p2] : []);
  const nr = narrativeLayer(bars, barSec, ny, ctx);
  ctx.nr = nr.info;

  if (layers.kz) items.push(...kzLayer(bars, barSec, ny, sessions, daily, KZ_DEFAULTS));
  if (layers.milana) items.push(...milItems);
  if (layers.gaps) items.push(...gapLayer(bars, barSec, gaps));
  if (layers.vp) items.push(...vpArrowLayer(bars, vp));
  if (layers.fib) items.push(...fibLayer(bars, barSec, ctx.fib));
  if (layers.tgif) items.push(...tgifLayer(bars, barSec, ctx.tgif));
  if (layers.voldiv) items.push(...volDivLayer(bars, ctx.voldiv));
  if (layers.cf) items.push(...confluenceLayer(bars, barSec, ctx.cf));
  if (layers.ict) items.push(...nr.items);
  const barColors = layers.crt ? crtColors(bars) : null;
  return { items, ctx, barColors };
}

// előző nap / hét / hónap H, L, közép és a nap/hét nyitója a napi gyertyákból (UTC), az EGYEZÉS-hez
function dwmLevels(daily, now) {
  if (!daily || !daily.length) return [];
  const out = [], d0 = new Date(now);
  const dayS = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
  const wkS = dayS - ((d0.getUTCDay() + 6) % 7) * 86400000, moS = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1);
  const prevMo = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 1, 1);
  for (const [a, b] of [[dayS - 86400000, dayS], [wkS - 7 * 86400000, wkS], [prevMo, moS]]) {
    let h = -Infinity, l = Infinity;
    for (const x of daily) if (x.t >= a && x.t < b) { h = Math.max(h, x.h); l = Math.min(l, x.l); }
    if (isFinite(h)) out.push(h, l, (h + l) / 2);
  }
  const dOpen = daily.find(x => x.t === dayS), wOpen = daily.find(x => x.t === wkS);
  if (dOpen) out.push(dOpen.o);
  if (wOpen) out.push(wOpen.o);
  return out;
}
