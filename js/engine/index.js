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
import { planPair } from "./trade.js";
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
  { key: "plan",   label: "Javaslat",  def: true },
];

// input: { bars, barSec, daily, layers:{kz:true,...} } -> { items, ctx, barColors }
export function runEngine({ bars, barSec, daily, layers, tick, plan, minGap }) {
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
  ctx.nrPast = nr.past;
  if (plan) ctx.plans = planPair(bars, ctx, milItems, minGap);

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

// az adatfülhöz: a számított állapot kis, átküldhető összefoglalója
export function ctxInfo(ctx, bars) {
  if (!ctx) return null;
  const now = bars[bars.length - 1].t, o = ctx.osc || {};
  const top = ctx.nr && ctx.nr.scenarios && ctx.nr.scenarios[0];
  let dir = top && top.dir && top.id !== 4 ? top.dir : 0, src = top && dir ? "ICT-forgatókönyv" : "";
  if (!dir && ctx.week && ctx.week.list && ctx.week.list[0]) { dir = ctx.week.list[0].dir; src = "heti profil"; }
  if (!dir && ctx.st) { dir = ctx.st.trend; src = "Supertrend"; }
  const close = bars[bars.length - 1].c;
  const tgts = [top && top.dir === dir ? top.target : null, ...((ctx.cf && ctx.cf.forecast) || []).map(f => f.p), ctx.wy && ctx.wy.dir === dir ? ctx.wy.target : null]
    .filter(x => x != null && isFinite(x) && (dir > 0 ? x > close : x < close)).sort((a, b) => Math.abs(a - close) - Math.abs(b - close));
  return JSON.parse(JSON.stringify({
    t: now, close, bias: { dir, src, target: tgts[0] ?? null },
    nr: ctx.nr, nrPast: ctx.nrPast || [],
    forecast: (ctx.cf && ctx.cf.forecast) || [],
    week: ctx.week && ctx.week.list ? ctx.week.list.slice(0, 3) : [],
    st: ctx.st ? { trend: ctx.st.trend, line: ctx.st.line } : null,
    osc: { rsi: o.rsi, rsiState: o.rsiState, k: o.k, d: o.d, j: o.j, ema: o.ema },
    wy: ctx.wy, pd: ctx.pd && ctx.pd.sr,
    gannNow: ctx.gannNow, gannYear: ctx.gannYear,
    gann: (ctx.gann || []).filter(e => e.t2 >= now).slice(0, 6),
    voldiv: (ctx.voldiv || []).slice(-1).map(v => ({ bear: v.bear, t: bars[v.b] ? bars[v.b].t : null })),
    cf: ((ctx.cf && ctx.cf.all) || []).map(g => ({ p: g.p, n: g.n, codes: g.codes })),
    nyrev: nyReversal(ctx, bars),
  }));
}

// NY reversal jel: a NY AM killzone-ban (09:30–11:00 NY) egy nagy volumenű (≥ 2× átlag) gyertya kisöpör egy erős
// (LIQ tényezős) egyezésvonalat és visszazár mögé; ha előtte ellenirányú volumen-divergencia volt, az megerősíti.
function nyReversal(ctx, bars) {
  const N = bars.length, ny = ctx.ny, lines = ((ctx.cf && ctx.cf.all) || []).filter(g => g.codes.includes("LIQ"));
  if (!ny || !ny.min || !lines.length) return null;
  const now = bars[N - 1].t;
  for (let i = N - 1; i >= Math.max(20, N - 200); i--) {
    if (now - bars[i].t > 16 * 3600000) break;
    const m = ny.min[i];
    if (!(m >= 570 && m < 660)) continue;
    let av = 0; for (let k = i - 20; k < i; k++) av += bars[k].v; av /= 20;
    const b = bars[i];
    if (!(b.v >= 2 * av)) continue;
    for (const g of lines) {
      const dir = b.l < g.p && b.c > g.p ? 1 : b.h > g.p && b.c < g.p ? -1 : 0;
      if (!dir) continue;
      const vd = (ctx.voldiv || []).filter(v => bars[v.b] && b.t - bars[v.b].t < 24 * 3600000 && bars[v.b].t <= b.t).pop();
      return { dir, t: b.t, line: g.p, n: g.n, codes: g.codes, vol: b.v / av, div: vd ? (vd.bear ? -1 : 1) === dir : false };
    }
  }
  return null;
}

