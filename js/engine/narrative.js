// Napi ICT-narratíva (Asia → London → NY AM) – a szezsoT átirata, kibővítve az összes igazolással.
//  Dangstrat / Sir Pickle forgatókönyvei: 1 fordulás (AMD), 2 folytatás, 3 NY konszolidáció, 4 Seek & Destroy.
//  London előtt/közben a legvalószínűbb 3 minta (cikcakk, szaggatott, nyílheggyel, rangsor-színnel: fekete, kék,
//  narancs, lila, türkiz), London után a lezajlott Londonhoz illő + az alternatíva. A minta a NY PM végéig marad.
//  A százalékok a chart saját múltjából (n = esetszám); a lezárt napok ✓ / ✗ felirattal.
import { inSession, parseSession } from "./ny.js";

export const NR_DEFAULTS = { days: 20, exp: 1.3, con: 0.8, dirMin: 0.5, max: 3, past: 10,
  colors: ["#000000", "#2962FF", "#FF9800", "#9C27B0", "#00897B"], neutral: "#9E9E9E", ok: "#2E7D32", bad: "#C62828",
  A: "2000-0000", L: "0200-0500", N: "0930-1100", P: "1330-1600", big: 14, small: 12 };

const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
function aState(h, l, o, c, av, cfg) {
  const r = h - l, rr = !(av > 0) ? 1 : r / av, dk = r > 0 && Math.abs(c - o) / r >= cfg.dirMin;
  return rr >= cfg.exp && dk ? (c > o ? "XU" : "XD") : "R";
}
function lState(s, av, cfg) {
  const sH = s.lH > s.aH, sL = s.lL < s.aL, rr = !(av > 0) ? 1 : (s.lH - s.lL) / av;
  if (sH && sL) return "SD";
  if (sL && s.lC > s.aL) return "ML";
  if (sH && s.lC < s.aH) return "MH";
  if (s.lC > s.aH) return "EU";
  if (s.lC < s.aL) return "ED";
  return rr <= cfg.con ? "C" : (s.lC > s.lO ? "EU" : "ED");
}
export function scen(a, l) {
  if (l === "SD") return [4, 0];
  if (l === "ML") return [1, 1];
  if (l === "MH") return [1, -1];
  if (l === "EU") return [a === "XU" ? 2 : 3, 1];
  if (l === "ED") return [a === "XD" ? 2 : 3, -1];
  if (l === "C" && a !== "R") return [2, a === "XU" ? 1 : -1];
  return [0, 0];
}
export function title(a, l, id) {
  const sA = a === "R" ? "Ázsia range" : "Ázsia expanzió";
  const tl = l === "ML" || l === "MH" ? "London manipuláció" : l === "EU" || l === "ED" ? "London expanzió" : l === "SD" ? "London: mindkét szél kiszúrva" : "London konszolidáció";
  const tn = id === 1 ? "NY fordulás" : id === 2 ? "NY folytatás" : id === 3 ? "NY konszolidáció" : id === 4 ? "Search & Destroy – kerülendő" : "nincs tiszta minta";
  return id === 4 ? sA + " → Search & Destroy – kerülendő" : `${sA} → ${tl} → ${tn}`;
}
const pct = (a, b) => b > 0 ? Math.round(100 * a / b) + "%" : "–";

// ── a múlt végigjárása: statisztika + a mai nap állapota ──
export function narrativeState(bars, ny, cfg = NR_DEFAULTS) {
  const A = parseSession(cfg.A), L = parseSession(cfg.L), Nn = parseSession(cfg.N);
  const cnt = new Map(), get = k => cnt.get(k) || 0, inc = k => cnt.set(k, get(k) + 1);
  const rA = [], rL = [], rN = [], push = (a, v) => { a.push(v); if (a.length > cfg.days) a.shift(); };
  let s = { ph: 0 }, past = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], m = ny.min[i], pm = ny.min[i - 1];
    const inA = inSession(m, A), wasA = inSession(pm, A), inL = inSession(m, L), wasL = inSession(pm, L), inN = inSession(m, Nn), wasN = inSession(pm, Nn);
    if (inA && !wasA) s = { ph: 1, t0: b.t, aO: b.o, aH: b.h, aL: b.l, aC: b.c };
    else if (inA && s.ph === 1) { s.aH = Math.max(s.aH, b.h); s.aL = Math.min(s.aL, b.l); s.aC = b.c; }
    if (!inA && wasA && s.ph === 1) { s.aSt = aState(s.aH, s.aL, s.aO, s.aC, avg(rA), cfg); push(rA, s.aH - s.aL); s.ph = 2; }
    if (inL && !wasL && s.ph === 2) { s.ph = 3; s.lO = b.o; s.lH = b.h; s.lL = b.l; s.lC = b.c; }
    else if (inL && s.ph === 3) { s.lH = Math.max(s.lH, b.h); s.lL = Math.min(s.lL, b.l); s.lC = b.c; }
    if (!inL && wasL && s.ph === 3) {
      s.lSt = lState(s, avg(rL), cfg); push(rL, s.lH - s.lL);
      inc("A" + s.aSt); inc("A" + s.aSt + "|" + s.lSt);
      s.pred = pct(get("S" + s.aSt + "|" + s.lSt), get("P" + s.aSt + "|" + s.lSt));
      s.ph = 4;
    }
    if (inN && !wasN && s.ph === 4) { s.ph = 5; s.yO = b.o; s.yH = b.h; s.yL = b.l; s.yC = b.c; }
    else if (inN && s.ph === 5) { s.yH = Math.max(s.yH, b.h); s.yL = Math.min(s.yL, b.l); s.yC = b.c; }
    if (!inN && wasN && s.ph === 5) {
      const avN = avg(rN), [id, dr] = scen(s.aSt, s.lSt), r = s.yH - s.yL, mid = (s.aH + s.aL) / 2;
      let ok = false;
      if (id === 1) ok = dr > 0 ? s.yC > s.yO && s.yC > mid : s.yC < s.yO && s.yC < mid;
      else if (id === 2) ok = dr > 0 ? s.yC > s.yO && s.yH > Math.max(s.aH, s.lH) : s.yC < s.yO && s.yL < Math.min(s.aL, s.lL);
      else if (id === 3) ok = !isNaN(avN) && r <= avN;
      else if (id === 4) ok = r > 0 && Math.abs(s.yC - s.yO) / r < cfg.dirMin;
      s.ok = ok; push(rN, r);
      const key = s.aSt + "|" + s.lSt; inc("P" + key); if (ok) inc("S" + key);
      s.ph = 6;
      if (id > 0) past.push({ t: b.t, p: s.yH, text: title(s.aSt, s.lSt, id) + (dr > 0 ? " ↑ " : dr < 0 ? " ↓ " : " ") + s.pred + (ok ? "  ✓" : "  ✗"), ok });
      if (past.length > cfg.past) past.shift();
    }
  }
  return { s, get, rN, past };
}

// ── irány-igazolás: a motor összes rejtett számítása szavaz ──
export function votes(ctx, dr, close) {
  const v = [];
  const add = (name, x) => { if (x) v.push({ name, x }); };
  add("AMS", ctx.ams ? ctx.ams.dir : 0);
  add("VP", ctx.vp ? (ctx.vp.kind === 3 ? 1 : ctx.vp.kind === 2 ? -1 : 0) : 0);
  add("OTE", ctx.ote ? (ctx.ote.up ? 1 : -1) : 0);
  add("PD", ctx.pd && ctx.pd.sr ? (close < ctx.pd.sr.eq ? 1 : -1) : 0);
  add("ST", ctx.st ? ctx.st.trend : 0);
  add("EMA200", ctx.osc && ctx.osc.ema[200] ? (close > ctx.osc.ema[200] ? 1 : -1) : 0);
  add("RSI", ctx.osc ? (ctx.osc.rsi <= 30 ? 1 : ctx.osc.rsi >= 70 ? -1 : 0) : 0);
  add("KDJ", ctx.osc ? (ctx.osc.j < 0 ? 1 : ctx.osc.j > 100 ? -1 : 0) : 0);
  add("HÉT", ctx.week ? ctx.week.dir : 0);
  add("WY", ctx.wy && ctx.wy.dir && ctx.wy.phase !== "B" ? ctx.wy.dir : 0);
  for (const c of (ctx.pat && ctx.pat.chart) || []) add(c.name, c.dir);
  for (const h of (ctx.pat && ctx.pat.harmonic) || []) add(h.name, h.dir);
  for (const d of ctx.voldiv || []) if (d.live || d.b >= (ctx.n || 0) - 10) add("VolDiv", d.bear ? -1 : 1);
  const agr = v.filter(x => x.x === dr);
  return { agr: agr.length, tot: v.length, names: agr.map(x => x.name), text: `igazol ${agr.length}/${v.length}` };
}

// ── célár: prioritás szerint, az irányban a legközelebbi ──
export function target(ctx, dr, ref, minD, maxD, sess) {
  const near = (cur, p) => {
    const ok = p != null && isFinite(p) && (dr > 0 ? p > ref + minD : p < ref - minD) && Math.abs(p - ref) <= maxD;
    return ok && (cur == null || Math.abs(p - ref) < Math.abs(cur - ref)) ? p : cur;
  };
  const tries = [
    ["GAP", () => (ctx.gaps || []).map(g => dr > 0 ? g.bot : g.top)],
    ["EGYEZÉS", () => [...((ctx.cf && ctx.cf.forecast) || []).map(f => f.p), ...((ctx.cf && ctx.cf.all) || []).map(g => g.p)]],
    ["TDO/FVG", () => ctx.milanaTargets || []],
    ["FVG/OB", () => [...(ctx.vfvg || []).map(f => dr > 0 ? f.bot : f.top), ...((ctx.ob && [...ctx.ob.bulls, ...ctx.ob.bears]) || []).map(o => dr > 0 ? o.bot : o.top)]],
    ["VP", () => ctx.vp ? [ctx.vp.poc, ctx.vp.vah, ctx.vp.val] : []],
    ["FIB", () => ctx.fib ? ctx.fib.levels.map(l => l.p) : []],
    ["AMS", () => ctx.ams ? ctx.ams.levels.map(l => l.p) : []],
    ["PD", () => ctx.pd && ctx.pd.sr ? [ctx.pd.sr.eq, ctx.pd.sr.h, ctx.pd.sr.l] : []],
    ["SÁV", () => [sess.aH, sess.aL, sess.lH, sess.lL, ...(ctx.dwm || [])]],
  ];
  for (const [tag, f] of tries) {
    let t = null;
    for (const p of f()) t = near(t, p);
    if (t != null) return { t, tag };
  }
  return { t: null, tag: "" };
}

// ── rajz ──
export function narrativeLayer(bars, barSec, ny, ctx, cfg = NR_DEFAULTS) {
  const items = [], N = bars.length;
  if (barSec > 3600 || N < 50) return { items, info: null, past: [] };
  const { s, get, rN, past } = narrativeState(bars, ny, cfg);
  const close = bars[N - 1].c, now = bars[N - 1].t;
  const R = info => ({ items, info, past });          // a múltbeli ✓/✗ értékelések az adatfülre mennek, nem a chartra
  if (!s.t0) return R(null);
  const off = sess => { const m = parseSession(sess), A0 = parseSession(cfg.A)[0]; return [((m[0] - A0 + 1440) % 1440) * 60000, ((m[1] - A0 + 1440) % 1440) * 60000]; };
  const [, aE] = off(cfg.A), [lS, lE] = off(cfg.L), [nS, nE] = off(cfg.N), [, pE] = off(cfg.P);
  const tAs = s.t0, tAe = s.t0 + aE, tLs = s.t0 + lS, tLe = s.t0 + lE, tNs = s.t0 + nS, tNe = s.t0 + nE, tPe = s.t0 + pE;
  const KZC = { A: "#2962FF", L: "#F23645", N: "#089981" };
  const box = (t1, t2, hi, lo, c) => { if (isFinite(hi) && isFinite(lo) && t2 > t1) items.push({ type: "box", t1, t2, p1: Math.max(hi, lo), p2: Math.min(hi, lo), bg: c + "1A", border: c + "73", borderWidth: 1 }); };
  const rng = (pts, t1, t2) => { let h = -Infinity, l = Infinity; for (const p of pts) if (p.t >= t1 && p.t <= t2) { h = Math.max(h, p.p); l = Math.min(l, p.p); } return [h, l]; };
  if (s.ph === 1) { box(tAs, tAe, s.aH, s.aL, KZC.A); return R(null); }      // új Ázsia: az előző napi rajz eltűnik
  if (!(s.ph >= 2 && s.ph <= 5) && !(s.ph === 6 && now <= tPe)) return R(null);
  const ar = Math.max(s.aH - s.aL, 1e-9), avN = avg(rN), a = ctx.atr14 ? ctx.atr14[N - 1] : ar;
  const minD = a * 0.1, maxD = isNaN(avN) ? a * 20 : Math.max(avN * 2.5, a * 3);
  const poly = (pts, color, width, style = "dashed") => {
    const q = []; for (const p of pts) if (!q.length || p.t > q[q.length - 1].t) q.push(p);
    if (q.length >= 2) items.push({ type: "poly", points: q, color, width, style, arrow: true });
  };
  const zz = (pts, t0, t1, p0, p1, amp, n) => {
    if (!pts.length) pts.push({ t: t0, p: p0 });
    for (let k = 1; k <= n; k++) pts.push({ t: t0 + Math.round((t1 - t0) * k / n), p: k === n ? p1 : p0 + (p1 - p0) * k / n + (k % 2 ? amp : -amp) });
  };
  const lbl = (t, p, big, small, color) => {
    items.push({ type: "label", t, p, text: big, color, size: cfg.big, align: "right", vAlign: "above", bold: true });
    if (small) items.push({ type: "label", t, p, text: small, color, size: cfg.small, align: "right", vAlign: "below" });
  };
  const lonSeg = (pts, k, real) => {
    const st = s.aC, tm = tLs + Math.round((tLe - tLs) * 0.6);
    let end;
    if (k === "ML" || k === "MH") {
      const sw = real ? (k === "ML" ? s.lL : s.lH) : (k === "ML" ? s.aL - 0.15 * ar : s.aH + 0.15 * ar);
      end = real ? s.lC : (k === "ML" ? s.aL + 0.3 * ar : s.aH - 0.3 * ar);
      pts.push({ t: tLs, p: st }); zz(pts, tLs, tm, st, sw, 0.08 * ar, 3); pts.push({ t: tLe, p: end });
    } else if (k === "EU" || k === "ED") {
      const ex = real ? (k === "EU" ? s.lH : s.lL) : (k === "EU" ? s.aH + 0.6 * ar : s.aL - 0.6 * ar);
      end = real ? s.lC : ex;
      pts.push({ t: tLs, p: st }); zz(pts, tLs, tLe, st, ex, 0.1 * ar, 4);
    } else if (k === "SD") {
      const hi = real ? s.lH : s.aH + 0.15 * ar, lo = real ? s.lL : s.aL - 0.15 * ar;
      end = real ? s.lC : (s.aH + s.aL) / 2;
      pts.push({ t: tLs, p: st }, { t: tLs + Math.round((tLe - tLs) * 0.35), p: hi }, { t: tLs + Math.round((tLe - tLs) * 0.7), p: lo }, { t: tLe, p: end });
    } else { end = real ? s.lC : st; pts.push({ t: tLs, p: st }); zz(pts, tLs, tLe, st, end, 0.2 * ar, 4); }
    return end;
  };
  const nySeg = (pts, id, dr, p0, tgt, lHi, lLo) => {
    pts.push({ t: tNs, p: p0 });
    if (id === 1 || id === 2) zz(pts, tNs, tNe, p0, tgt, 0.15 * Math.abs(tgt - p0), 4);
    else if (id === 3) zz(pts, tNs, tNe, dr > 0 ? lHi : lLo, (lHi + lLo) / 2, 0.15 * ar, 4);
    else if (id === 4) pts.push({ t: tNs + Math.round((tNe - tNs) / 3), p: Math.max(s.aH, lHi) }, { t: tNs + Math.round(2 * (tNe - tNs) / 3), p: Math.min(s.aL, lLo) }, { t: tNe, p: (s.aH + s.aL) / 2 });
  };
  // Ázsia-szakasz
  const pa = [];
  if (s.aSt === "R") pa.push({ t: tAs, p: s.aO }, { t: tAs + (tAe - tAs) * 0.2, p: s.aH }, { t: tAs + (tAe - tAs) * 0.4, p: s.aL }, { t: tAs + (tAe - tAs) * 0.6, p: s.aH }, { t: tAs + (tAe - tAs) * 0.8, p: s.aL }, { t: tAe, p: s.aC });
  else zz(pa, tAs, tAe, s.aSt === "XU" ? s.aL : s.aH, s.aSt === "XU" ? s.aH : s.aL, 0.12 * ar, 4);
  box(tAs, tAe, s.aH, s.aL, KZC.A);
  const info = { scenarios: [] };
  if (s.ph <= 3) {
    const sHi = s.ph === 3 && s.lH > s.aH, sLo = s.ph === 3 && s.lL < s.aL, nA = get("A" + s.aSt), cands = [];
    for (const k of ["ML", "MH", "EU", "ED", "SD", "C"]) {
      const okK = !(sHi && !sLo && (k === "ML" || k === "ED")) && !(sLo && !sHi && (k === "MH" || k === "EU")) && !(sHi && sLo && k !== "SD");
      const [cid] = scen(s.aSt, k);
      if (!okK || !cid) continue;
      const pL = nA > 0 ? get("A" + s.aSt + "|" + k) / nA : 0, nP = get("P" + s.aSt + "|" + k);
      cands.push({ k, p: nP > 0 ? pL * get("S" + s.aSt + "|" + k) / nP : pL * 0.5 });
    }
    cands.sort((x, y) => y.p - x.p);
    cands.slice(0, cfg.max).forEach(({ k }, i) => {
      const [cid, cdr] = scen(s.aSt, k), key = s.aSt + "|" + k, nP = get("P" + key), nS = get("S" + key);
      const pL = nA > 0 ? get("A" + key) / nA : 0, pS = nP > 0 ? nS / nP : NaN;
      const pc = nA > 0 && !isNaN(pS) ? `esély ${Math.round(100 * pL * pS)}%` : "esély ? (még kevés a lezárt nap)";
      const c = cfg.colors[i], pts = [], lEnd = lonSeg(pts, k, false), lHi = Math.max(s.aH, lEnd), lLo = Math.min(s.aL, lEnd);
      let tgt = null, tg = "";
      if (cid === 1 || cid === 2) { const r = target(ctx, cdr, cdr > 0 ? lHi : lLo, minD, maxD, s); tgt = r.t != null ? r.t : lEnd + cdr * ar; tg = r.tag; }
      const nyStart = pts.length;
      nySeg(pts, cid, cdr, lEnd, tgt, lHi, lLo);
      if (i === 0) {
        const [lh, ll] = rng(pts.slice(0, nyStart), tLs, tLe), [nh, nl] = rng(pts.slice(nyStart), tNs, tNe);
        box(tLs, tLe, s.ph === 3 ? Math.max(lh, s.lH) : lh, s.ph === 3 ? Math.min(ll, s.lL) : ll, KZC.L);
        box(tNs, tNe, nh, nl, KZC.N);
        poly(pa.concat(pts), c, 2, "solid");
      } else poly(pts, c, 2);
      const e = pts[pts.length - 1], vt = cdr ? votes(ctx, cdr, close) : null;
      const det = `London ${pct(get("A" + key), nA)} × NY ${pct(nS, nP)}` + (tgt == null ? "" : ` · cél ${+tgt.toPrecision(6)}${tg ? " (" + tg + ")" : ""}`) + (vt ? " · " + vt.text : "");
      if (i === 0) lbl(tNe, e.p, title(s.aSt, k, cid) + (cdr > 0 ? " ↑ " : cdr < 0 ? " ↓ " : " ") + pc, det, c);
      else lbl(tNe, e.p, `${i + 1}. ${cdr > 0 ? "↑" : cdr < 0 ? "↓" : "↔"} ${pc.replace(/ \(.*\)/, "")}`, "", c);   // a részletek az adatfülön
      info.scenarios.push({ rank: i, id: cid, dir: cdr, title: title(s.aSt, k, cid), prob: nA > 0 && !isNaN(pS) ? pL * pS : null, target: tgt, tag: tg, votes: vt });
    });
  } else {
    const [sid, sdr] = scen(s.aSt, s.lSt), key = s.aSt + "|" + s.lSt;
    let nP = get("P" + key), nS = get("S" + key);
    if (s.ph === 6) { nP = Math.max(0, nP - 1); nS = Math.max(0, nS - (s.ok ? 1 : 0)); }
    const pPrim = nP > 0 ? nS / nP : NaN, altFirst = [1, 2, 3].includes(sid) && !isNaN(pPrim) && pPrim < 0.5;
    const c = altFirst ? cfg.colors[1] : cfg.colors[0], cA = altFirst ? cfg.colors[0] : cfg.colors[1];
    const ref = s.ph === 6 ? s.yO : close, pts = [], lEnd = lonSeg(pts, s.lSt, true), p0 = s.ph >= 5 ? s.yO : lEnd;
    let tgt = null, tg = "";
    if (sid === 1 || sid === 2) { const r = target(ctx, sdr, ref, minD, maxD, s); tgt = r.t != null ? r.t : ref + sdr * ar; tg = r.tag; }
    const nyStart = pts.length;
    nySeg(pts, sid, sdr, p0, tgt, s.lH, s.lL);
    box(tLs, tLe, s.lH, s.lL, KZC.L);
    if (!altFirst) { const [nh, nl] = rng(pts.slice(nyStart), tNs, tNe); box(tNs, tNe, nh, nl, KZC.N); }
    poly(altFirst ? pts : pa.concat(pts), c, 2, altFirst ? "dashed" : "solid");
    const e = pts[pts.length - 1], vt = sdr && sid !== 4 ? votes(ctx, sdr, close) : null;
    const det = `NY ${pct(nS, nP)} (n=${nP})` + (tgt == null ? "" : ` · cél ${+tgt.toPrecision(6)}${tg ? " (" + tg + ")" : ""}`) +
      (sid === 3 ? ` · London-sáv közepe ${+((s.lH + s.lL) / 2).toPrecision(6)}` : "") + (vt ? " · " + vt.text : "");
    lbl(tNe, e.p, title(s.aSt, s.lSt, sid) + (sid === 4 || !sid ? " " : sdr > 0 ? " ↑ " : " ↓ ") + (sid > 0 ? (nP > 0 ? "esély " + pct(nS, nP) : "esély ? (még kevés a lezárt nap)") : ""), det, c);
    info.scenarios.push({ rank: 0, id: sid, dir: sdr, title: title(s.aSt, s.lSt, sid), prob: isNaN(pPrim) ? null : pPrim, target: tgt, tag: tg, votes: vt });
    if ([1, 2, 3].includes(sid)) {
      const adr = sid === 3 ? sdr : -sdr, r2 = target(ctx, adr, ref, minD, maxD, s);
      if (r2.t != null) {
        const p2 = [], a0 = s.ph >= 5 ? s.yO : lEnd;
        p2.push({ t: tNs, p: a0 }); zz(p2, tNs, tNe, a0, r2.t, 0.15 * Math.abs(r2.t - a0), 4);
        if (altFirst) { const [nh, nl] = rng(p2, tNs, tNe); box(tNs, tNe, nh, nl, KZC.N); poly(pa.concat(pts.slice(0, nyStart), p2), cA, 2, "solid"); }
        else poly(p2, cA, 2);
        const v2 = votes(ctx, adr, close);
        lbl(tNe, r2.t, (sid === 3 ? "ha folytatja " : "ha nem ") + (adr > 0 ? "↑ " : "↓ ") + (nP > 0 ? "esély " + pct(nP - nS, nP) : "esély ?"), altFirst ? `cél ${+r2.t.toPrecision(6)} (${r2.tag}) · ${v2.text}` : "", cA);
        info.scenarios.push({ rank: 1, id: sid === 3 ? 2 : sid, dir: adr, title: "alternatíva", prob: nP > 0 ? (nP - nS) / nP : null, target: r2.t, tag: r2.tag, votes: v2 });
      }
    }
  }
  info.session = { aH: s.aH, aL: s.aL, lH: s.lH, lL: s.lL, ph: s.ph, aSt: s.aSt, lSt: s.lSt, t0: s.t0, tLs, tLe, tNs, tNe, tPe };
  return R(info);
}
