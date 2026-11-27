// EGYEZÉS: kék vonal ott, ahol legalább `min` KÜLÖNBÖZŐ tényező esik egy árra (tűrésen belül).
// Vastagság: 5 tényező = 1, 6 = 2, … A vonal bal felén 10-es betűvel, rövidítve az okok.
// Tényezőkódok: KZ killzone-doboz széle/közepe · MIL Milana-nyitás/első FVG · DWM előző nap/hét/hónap H-L-M, nyitók, heti/havi zárás ·
// 1h/4h/D kanócvég · FIB (Auto Fib + DGT) · GP golden pocket · GY gyakori ár · PD prémium/diszkont · FVG (OB+VFVG) ·
// LIQ likviditás · EW Elliott · OTE · POI · GAP rés · VP VPOC/VAH/VAL · AMS · EMA (napi és saját EMA/SMA) ·
// ST Supertrend · GANN doboz/legyező · TGIF · WY Wyckoff · MINTA (chart/harmonikus) · IDŐ (Gann-időablak most).
// A "várható ár": fib-kiterjesztés + OTE TP-zóna + Elliott (b)/(c) egyezése (a szezsoT szerint) – rejtett célár.

export const CF_DEFAULTS = { min: 5, tolPct: 0.03, maxLines: 8, color: "#2962FF", labelSize: 10, back: 40, fwd: 20 };

export function collectFactors(bars, ctx, milanaItems) {
  const P = [], R = [];                               // P: {p, k} szintek; R: {t, b, k} zónák
  const lv = (p, k) => { if (p != null && isFinite(p)) P.push({ p, k }); };
  const rg = (a, b, k) => { if (a != null && b != null && isFinite(a) && isFinite(b)) R.push({ t: Math.max(a, b), b: Math.min(a, b), k }); };
  for (const list of Object.values(ctx.sessions || {})) {
    const s = list[list.length - 1];
    if (s) { lv(s.hi, "KZ"); lv(s.lo, "KZ"); lv((s.hi + s.lo) / 2, "KZ"); }
  }
  for (const it of milanaItems || []) {
    if (it.type === "line" && it.p1 === it.p2) lv(it.p1, "MIL");
    if (it.type === "box") rg(it.p1, it.p2, "MIL");
  }
  if (ctx.dwm) for (const p of ctx.dwm) lv(p, "DWM");
  if (ctx.htf) for (const [k, v] of Object.entries(ctx.htf)) { lv(v.h, k); lv(v.l, k); }
  if (ctx.fib) { for (const l of ctx.fib.levels) lv(l.p, "FIB"); rg(ctx.fib.pocket[0], ctx.fib.pocket[1], "GP"); for (const a of ctx.fib.abc) lv(a.p, "FIB"); }
  if (ctx.move) for (const l of ctx.move.levels) lv(l.p, "FIB");
  if (ctx.gpz) for (const z of ctx.gpz) rg(z.upper, z.lower, "GP");
  lv(ctx.touched, "GY");
  if (ctx.pd) for (const v of Object.values(ctx.pd)) { lv(v.eq, "PD"); lv(v.h, "PD"); lv(v.l, "PD"); }
  if (ctx.ob) for (const o of [...ctx.ob.bulls, ...ctx.ob.bears]) rg(o.top, o.bot, "FVG");
  if (ctx.vfvg) for (const f of ctx.vfvg) rg(f.top, f.bot, "FVG");
  if (ctx.liq) for (const z of [...ctx.liq.ups, ...ctx.liq.dns]) rg(z.top, z.bot, "LIQ");
  if (ctx.ew && ctx.ew.valid) { lv(ctx.ew.w4, "EW"); lv(ctx.ew.w5, "EW"); lv(ctx.ew.b, "EW"); lv(ctx.ew.c, "EW"); }
  if (ctx.ote) { rg(...ctx.ote.ote, "OTE"); rg(...ctx.ote.tp1, "OTE"); rg(...ctx.ote.tp2, "OTE"); rg(...ctx.ote.tp3, "OTE"); }
  if (ctx.poi) for (const q of ctx.poi) lv(q.lvl, "POI");
  if (ctx.gaps) for (const g of ctx.gaps) rg(g.top, g.bot, "GAP");
  if (ctx.vp) { lv(ctx.vp.poc, "VP"); lv(ctx.vp.vah, "VP"); lv(ctx.vp.val, "VP"); }
  if (ctx.ams) for (const l of ctx.ams.levels) lv(l.p, "AMS");
  if (ctx.osc) {
    for (const v of Object.values(ctx.osc.ema)) lv(v, "EMA");
    for (const v of Object.values(ctx.osc.sma)) lv(v, "EMA");
    if (ctx.osc.dailyLv) for (const v of Object.values(ctx.osc.dailyLv)) lv(v, "EMA");
  }
  if (ctx.st) { lv(ctx.st.line, "ST"); for (const l of ctx.st.levels) if (!l.crossed) lv(l.p, "ST"); }
  if (ctx.gannBox) { for (const l of ctx.gannBox.boxLv) lv(l.p, "GANN"); for (const f of ctx.gannBox.fan) lv(f.p, "GANN"); }
  if (ctx.tgif && ctx.tgif.length) lv(ctx.tgif[ctx.tgif.length - 1].level, "TGIF");
  if (ctx.wy && ctx.wy.lo) { lv(ctx.wy.lo, "WY"); lv(ctx.wy.hi, "WY"); lv(ctx.wy.target, "WY"); }
  if (ctx.pat) {
    for (const c of ctx.pat.chart) { lv(c.neck, "MINTA"); lv(c.target, "MINTA"); }
    for (const h of ctx.pat.harmonic) { lv(h.prz, "MINTA"); lv(h.target, "MINTA"); }
  }
  return { P, R };
}

export function confluence(bars, ctx, milanaItems, cfg = CF_DEFAULTS) {
  const N = bars.length;
  if (!N) return { lines: [], forecast: [] };
  const close = bars[N - 1].c, tol = close * cfg.tolPct / 100;
  const { P, R } = collectFactors(bars, ctx, milanaItems);
  const a = ctx.atr14 ? ctx.atr14[N - 1] : 0, timeNow = ctx.gannNow && ctx.gannNow.w > 0;
  const cand = P.map(x => x.p);
  for (const r of R) cand.push(r.t, r.b, (r.t + r.b) / 2);
  const hits = [];
  for (const c of cand) {
    const codes = new Set();
    for (const x of P) if (Math.abs(x.p - c) <= tol) codes.add(x.k);
    for (const r of R) if (c >= r.b - tol && c <= r.t + tol) codes.add(r.k);
    if (timeNow && Math.abs(c - close) <= a) codes.add("IDŐ");
    if (codes.size >= cfg.min) hits.push({ p: c, codes: [...codes], n: codes.size });
  }
  // csoportosítás: a tűrésen belül egymáshoz eső jelöltekből egy vonal (a legtöbb tényezős marad)
  hits.sort((x, y) => x.p - y.p);
  const groups = [];
  let g0 = null, best = null;
  for (const h of hits.concat([null])) {
    if (g0 !== null && (!h || h.p - g0 > tol)) { groups.push(best); g0 = null; best = null; }
    if (!h) break;
    if (g0 === null) { g0 = h.p; best = h; } else if (h.n > best.n) best = h;
  }
  // a láncolódás miatt egymáshoz túl közeli vonalak összevonása (2 × tűrés)
  const merged = [];
  for (const g of groups) {
    const l = merged[merged.length - 1];
    if (l && g.p - l.p <= 2 * tol) { if (g.n > l.n) merged[merged.length - 1] = g; }
    else merged.push(g);
  }
  groups.length = 0; groups.push(...merged);
  groups.sort((x, y) => Math.abs(x.p - close) - Math.abs(y.p - close));
  // várható ár (fib-kiterjesztés × OTE TP × Elliott)
  const ftol = close * 0.3 / 100, inR = (v, z) => z && v >= Math.min(...z) - ftol && v <= Math.max(...z) + ftol;
  const fc = [];
  if (ctx.fib) for (const l of ctx.fib.levels.filter(l => l.kind === "ext")) {
    const src = ["FIB"];
    if (ctx.ote && (inR(l.p, ctx.ote.tp1) || inR(l.p, ctx.ote.tp2) || inR(l.p, ctx.ote.tp3))) src.push("OTE");
    if (ctx.ew && ctx.ew.valid && (Math.abs(ctx.ew.b - l.p) <= ftol || Math.abs(ctx.ew.c - l.p) <= ftol)) src.push("EW");
    if (src.length >= 2) fc.push({ p: l.p, src: src.join("+") });
  }
  if (!fc.length && ctx.fib) {
    const ext = ctx.fib.levels.filter(l => l.kind === "ext").sort((x, y) => Math.abs(x.p - close) - Math.abs(y.p - close));
    if (ext[0]) fc.push({ p: ext[0].p, src: "FIB" });
  }
  return { lines: groups.slice(0, cfg.maxLines), all: groups, forecast: fc };
}

export function confluenceLayer(bars, barSec, cf, cfg = CF_DEFAULTS) {
  const items = [], N = bars.length;
  if (!N || !cf) return items;
  const ms = barSec * 1000, tR = bars[N - 1].t + cfg.fwd * ms, tL = bars[Math.max(0, N - cfg.back)].t;
  for (const g of cf.lines) {
    const w = Math.max(1, g.n - cfg.min + 1);
    items.push({ type: "line", t1: tL, p1: g.p, t2: tR, p2: g.p, color: cfg.color, width: w, style: "solid" });
    items.push({ type: "label", t: tL, p: g.p, text: g.codes.join("·"), color: cfg.color, size: cfg.labelSize, align: "left", vAlign: "above", minSize: cfg.labelSize });
  }
  return items;
}
