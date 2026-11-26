// Kereskedési javaslat – naponta egyszer, Ázsia végén (00:00 NY), az 1 órás adatokból; mindkét irányra
// (a long és a short egyszerre futhat). A motor itt csak a terv két felét számolja ki; a rögzítést,
// az állapotot (vár / aktív / lezárva / lejárt) és a rajzot a fő szál (js/plans.js) végzi.
//  Entry (longnál, shortnál tükrözve): Ázsia alja → silver bullet (Milana-nyitás) → réstöltés → legközelebbi EGYEZÉS.
//  DCA 1–3: a következő stratégiai szintek az entry alatt, egymástól legalább `minGap` (HYPE: 3 $) távolságra.
//  Adagok: entry 1, DCA1 1, DCA2 2, DCA3 4.
//  TP: az átlagár fölötti legközelebbi stratégiai szintek (a `levels` listából, DCA-teljesüléskor újraszámolva).

import { UNITS } from "./tradeutil.js";
export { UNITS };

function strategic(ctx, milItems) {
  const mil = (milItems || []).filter(it => it.type === "label" && /^(TLO|TNY|NYAM|TPM|TDO|TAO|TWO)$/.test(it.text)).map(it => ({ p: it.p, why: it.text }));
  const kz = [];
  for (const [k, l] of Object.entries(ctx.sessions || {})) {
    const s = l[l.length - 1];
    if (s) kz.push({ p: s.lo, why: k + " Low" }, { p: s.hi, why: k + " High" });
  }
  const struct = [
    ...(ctx.gaps || []).flatMap(g => [{ p: g.top, why: "rés" }, { p: g.bot, why: "rés" }]),
    ...((ctx.ob && [...ctx.ob.bulls, ...ctx.ob.bears]) || []).flatMap(o => [{ p: o.top, why: "OB" }, { p: o.bot, why: "OB" }]),
    ...(ctx.vfvg || []).flatMap(f => [{ p: f.top, why: "FVG" }, { p: f.bot, why: "FVG" }]),
    ...(ctx.dwm || []).map(p => ({ p, why: "PD/PW/PM" })),
  ];
  const cf = ((ctx.cf && ctx.cf.all) || []).map(g => ({ p: g.p, why: "EGYEZÉS " + g.n + " (" + g.codes.join("·") + ")" }));
  const fc = ((ctx.cf && ctx.cf.forecast) || []).map(f => ({ p: f.p, why: "várható ár (" + f.src + ")" }));
  return { mil, all: [...cf, ...fc, ...mil, ...kz, ...struct].filter(x => x.p != null && isFinite(x.p)) };
}

// a legutóbbi (lezárt vagy épp záródó) Ázsia-szakasz (20:00–24:00 NY) csúcsa és alja, az utolsó ~30 gyertyából
function asiaRange(bars, ny) {
  if (!ny || !ny.min) return null;
  const N = bars.length;
  let h = -Infinity, l = Infinity, seen = false;
  for (let i = N - 1; i >= Math.max(0, N - 30); i--) {
    const inA = ny.min[i] >= 1200;
    if (inA) { seen = true; h = Math.max(h, bars[i].h); l = Math.min(l, bars[i].l); }
    else if (seen) break;
  }
  return seen ? { h, l } : null;
}

export function tradePlan(bars, ctx, milItems, dir, minGap) {
  const N = bars.length;
  if (N < 50 || !dir) return null;
  const close = bars[N - 1].c, a = ctx.atr14 ? ctx.atr14[N - 1] : close * 0.01;
  const gap = Math.max(minGap || 0, a * 0.5);
  const { mil, all } = strategic(ctx, milItems);
  const side = p => dir > 0 ? p < close : p > close;
  const further = (p, ref) => dir > 0 ? p <= ref - gap : p >= ref + gap;
  const near = (x, y) => Math.abs(x - close) - Math.abs(y - close);
  const pool = all.filter(x => side(x.p)).sort((x, y) => near(x.p, y.p));
  const asia = asiaRange(bars, ctx.ny);
  let entry = null;
  if (asia) {
    const edge = dir > 0 ? asia.l : asia.h;
    if (side(edge) || Math.abs(close - edge) <= a) entry = { p: edge, why: dir > 0 ? "Ázsia alja" : "Ázsia teteje" };
  }
  if (!entry) { const sb = mil.filter(m => side(m.p)).sort((x, y) => near(x.p, y.p))[0]; if (sb && Math.abs(sb.p - close) <= 3 * a) entry = { p: sb.p, why: "silver bullet: " + sb.why }; }
  if (!entry) { const g = (ctx.gaps || []).map(g => dir > 0 ? g.top : g.bot).filter(side).sort(near)[0]; if (g != null && Math.abs(g - close) <= 3 * a) entry = { p: g, why: "réstöltés" }; }
  if (!entry && pool[0]) entry = pool[0];
  if (!entry) entry = { p: close, why: "piaci ár" };
  const dca = []; let ref = entry.p;
  for (const x of pool) { if (dca.length === 3) break; if (further(x.p, ref)) { dca.push(x); ref = x.p; } }
  while (dca.length < 3) { ref -= dir * gap; dca.push({ p: ref, why: "min. távolság (nincs stratégiai szint)" }); }
  const levels = all.map(x => ({ p: x.p, why: x.why })).sort((x, y) => x.p - y.p);
  const sc = ctx.nr && ctx.nr.scenarios && ctx.nr.scenarios.find(s => s.dir === dir);
  return { dir, entry: { p: entry.p, why: entry.why }, dca: dca.map(d => ({ p: d.p, why: d.why })), units: UNITS, levels,
    tpGap: a * 0.25, gap, why: sc ? sc.title : "", prob: sc ? sc.prob : null, votes: sc && sc.votes ? sc.votes.text : "" };
}

export function planPair(bars, ctx, milItems, minGap) {
  const sc = ctx.nr && ctx.nr.scenarios && ctx.nr.scenarios[0];
  let primary = sc && sc.dir && sc.id !== 4 ? sc.dir : 0;
  if (!primary && ctx.week && ctx.week.dir) primary = ctx.week.dir;
  if (!primary && ctx.st) primary = ctx.st.trend;
  return { long: tradePlan(bars, ctx, milItems, 1, minGap), short: tradePlan(bars, ctx, milItems, -1, minGap), primary };
}

