// Kereskedési javaslat: 1 entry + 3 DCA + 3 TP, dinamikusan (csak jelzés, nem köt).
//  Irány: a narratíva fő forgatókönyve (ha S&D / nincs minta: a heti profil, végül a Supertrend).
//  Entry (longnál, shortnál tükrözve):
//   - Ázsia alja: ha London előtt/alatt vagyunk és az ár az Ázsia alja körül jár vagy átlépte → az Ázsia alja,
//   - silver bullet: a Milana első FVG / nyitóvonal, ha az irányban az ár alatt van,
//   - réstöltés: a legközelebbi nyitott 1h/4h rés széle,
//   - különben a legközelebbi EGYEZÉS az ár alatt.
//  DCA 1–3: a következő stratégiai szintek az entry alatt (EGYEZÉS, majd TLO → London Low → TNY → NYAM → TPM
//   vonalak, killzone-mélyek, PDL, FVG/OB/rés), egymástól legalább 0,5 ATR-re. Méret: duplázás (1·2·4·8 egység).
//  TP 1–3: az entry fölötti stratégiai szintek (DCA után az átlagárhoz igazodnak): TP1 a legközelebbi egyezés,
//   TP2 a narratíva célára, TP3 a várható ár / a következő egyezés.

export function tradePlan(bars, ctx, milItems) {
  const N = bars.length;
  if (N < 50) return null;
  const close = bars[N - 1].c, a = ctx.atr14 ? ctx.atr14[N - 1] : close * 0.01, gap = a * 0.5;
  const sc = ctx.nr && ctx.nr.scenarios && ctx.nr.scenarios[0];
  let dir = sc && sc.dir && sc.id !== 4 ? sc.dir : 0, why = sc && dir ? sc.title : "";
  if (!dir && ctx.week && ctx.week.dir) { dir = ctx.week.dir; why = "heti profil: " + ctx.week.list[0].name; }
  if (!dir && ctx.st) { dir = ctx.st.trend; why = "Supertrend"; }
  if (!dir) return null;
  const below = p => dir > 0 ? p < close : p > close;          // a belépés oldalán
  const further = (p, ref) => dir > 0 ? p < ref - gap : p > ref + gap;
  const sess = ctx.nr && ctx.nr.session;
  // stratégiai szintek a belépés oldalán
  const mil = (milItems || []).filter(it => it.type === "label" && /^(TLO|TNY|NYAM|TPM|TDO)$/.test(it.text)).map(it => ({ p: it.p, why: it.text }));
  const kzLows = Object.entries(ctx.sessions || {}).map(([k, l]) => l[l.length - 1] ? { p: dir > 0 ? l[l.length - 1].lo : l[l.length - 1].hi, why: k + (dir > 0 ? " Low" : " High") } : null).filter(Boolean);
  const struct = [
    ...(ctx.gaps || []).map(g => ({ p: dir > 0 ? g.top : g.bot, why: "rés" })),
    ...((ctx.ob && [...ctx.ob.bulls, ...ctx.ob.bears]) || []).map(o => ({ p: dir > 0 ? o.top : o.bot, why: "OB" })),
    ...(ctx.vfvg || []).map(f => ({ p: dir > 0 ? f.top : f.bot, why: "FVG" })),
    ...(ctx.dwm || []).map(p => ({ p, why: "PD/PW" })),
  ];
  const cf = ((ctx.cf && ctx.cf.all) || []).map(g => ({ p: g.p, why: "EGYEZÉS " + g.n + " (" + g.codes.join("·") + ")", n: g.n }));
  const pool = [...cf, ...mil, ...kzLows, ...struct].filter(x => x.p != null && isFinite(x.p) && below(x.p))
    .sort((x, y) => Math.abs(x.p - close) - Math.abs(y.p - close));
  // ── entry ──
  let entry = null;
  if (sess && sess.ph <= 3 && sess.aL != null) {
    const edge = dir > 0 ? sess.aL : sess.aH;
    if (Math.abs(close - edge) <= 2 * a || (dir > 0 ? close < edge : close > edge)) entry = { p: edge, why: dir > 0 ? "Ázsia alja (London előtt/alatt átlépve → long)" : "Ázsia teteje (→ short)" };
  }
  if (!entry) { const sb = mil.filter(m => below(m.p)).sort((x, y) => Math.abs(x.p - close) - Math.abs(y.p - close))[0]; if (sb && Math.abs(sb.p - close) <= 3 * a) entry = { p: sb.p, why: "silver bullet: " + sb.why }; }
  if (!entry) { const g = (ctx.gaps || []).filter(g => below(dir > 0 ? g.top : g.bot)).sort((x, y) => Math.abs((dir > 0 ? x.top : x.bot) - close) - Math.abs((dir > 0 ? y.top : y.bot) - close))[0]; if (g && Math.abs((dir > 0 ? g.top : g.bot) - close) <= 3 * a) entry = { p: dir > 0 ? g.top : g.bot, why: "réstöltés" }; }
  if (!entry && pool[0]) entry = pool[0];
  if (!entry) entry = { p: close, why: "piaci ár" };
  // ── 3 DCA ──
  const dca = [];
  let ref = entry.p;
  for (const x of pool) { if (dca.length === 3) break; if (further(x.p, ref)) { dca.push(x); ref = x.p; } }
  while (dca.length < 3) { ref = ref - dir * 1.5 * a; dca.push({ p: ref, why: "1,5 ATR (nincs stratégiai szint)" }); }
  // ── átlagár (duplázás: 1, 2, 4, 8) ──
  const units = [1, 2, 4, 8], legs = [entry, ...dca];
  const avgs = []; let q = 0, v = 0;
  legs.forEach((l, i) => { q += units[i]; v += units[i] * l.p; avgs.push(v / q); });
  // ── 3 TP az entry fölött / alatt (DCA-teljesülés után a papírkereskedés az átlagárhoz igazítja) ──
  const avgAll = entry.p, above = p => dir > 0 ? p > avgAll + gap * 0.5 : p < avgAll - gap * 0.5;
  const ups = [...((ctx.cf && ctx.cf.all) || []).map(g => ({ p: g.p, why: "EGYEZÉS " + g.n })),
    ...(sc && sc.target != null ? [{ p: sc.target, why: "ICT-cél" + (sc.tag ? " (" + sc.tag + ")" : "") }] : []),
    ...((ctx.cf && ctx.cf.forecast) || []).map(f => ({ p: f.p, why: "várható ár (" + f.src + ")" })),
    ...mil.map(m => ({ p: m.p, why: m.why }))]
    .filter(x => x.p != null && isFinite(x.p) && above(x.p)).sort((x, y) => Math.abs(x.p - avgAll) - Math.abs(y.p - avgAll));
  const tp = []; let r2 = avgAll;
  for (const x of ups) { if (tp.length === 3) break; if (dir > 0 ? x.p > r2 + gap * 0.5 : x.p < r2 - gap * 0.5) { tp.push(x); r2 = x.p; } }
  while (tp.length < 3) { r2 = r2 + dir * a; tp.push({ p: r2, why: "1 ATR (nincs stratégiai szint)" }); }
  return { dir, why, entry, dca, units, avgs, tp, votes: sc && sc.votes };
}

export function tradeLayer(bars, barSec, plan) {
  if (!plan) return [];
  const items = [], N = bars.length, ms = barSec * 1000, t1 = bars[N - 1].t + 2 * ms, t2 = bars[N - 1].t + 28 * ms;
  const row = (p, text, color, width, style) => {
    items.push({ type: "line", t1, p1: p, t2, p2: p, color, width, style });
    items.push({ type: "label", t: t2, p, text, color, size: 12, align: "left", vAlign: "middle", bold: width > 1, bg: "rgba(255,255,255,0.85)" });
  };
  const f = p => +p.toPrecision(6), side = plan.dir > 0 ? "LONG" : "SHORT";
  row(plan.entry.p, `${side} ENTRY ${f(plan.entry.p)} ×1`, "#2962FF", 3, "solid");
  plan.dca.forEach((d, i) => row(d.p, `DCA${i + 1} ${f(d.p)} ×${plan.units[i + 1]} · átl. ${f(plan.avgs[i + 1])}`, "#FF9800", 2, "dashed"));
  plan.tp.forEach((t, i) => row(t.p, `TP${i + 1} ${f(t.p)}`, "#089981", 2, "dashed"));
  return items;
}

// szöveges összefoglaló (adatfülre / felirathoz)
export function tradeText(plan) {
  if (!plan) return "Nincs javaslat (nincs egyértelmű irány).";
  const f = p => +p.toPrecision(6);
  return [`${plan.dir > 0 ? "LONG" : "SHORT"} – ${plan.why}${plan.votes ? " · " + plan.votes.text : ""}`,
    `Entry ${f(plan.entry.p)} (${plan.entry.why})`,
    ...plan.dca.map((d, i) => `DCA${i + 1} ${f(d.p)} ×${plan.units[i + 1]} – ${d.why} · átlag ${f(plan.avgs[i + 1])}`),
    ...plan.tp.map((t, i) => `TP${i + 1} ${f(t.p)} – ${t.why}`)].join("\n");
}
