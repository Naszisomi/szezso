// Napi kereskedési tervek: Ázsia végén (00:00 NY) rögzítve, az 1 órás adatokból, mindkét irányra.
// London végén (05:00 NY) egyszer frissülhet az az irány, amelynek az entryje még nem jött meg.
// A tervekből a grid.js folyamatos rácsot játszik végig a 15 perces gyertyákon (számlák, szerepek, TP-k
// idősíkonként, napváltás, méretezés) – ez a papírkereskedés és a chart rajza is.
// RSI-jel (70/30, választható idősíkon): nyereséges, nyitott pozíciónál „RSI ✋” a következő TP mellett.
// A tervek a tabletre mentődnek (localStorage), a gyertyák az IndexedDB-be.
import { makeFilter, to15 } from "./filters.js";
import { nyToUtc, nyDate } from "./ind/milana.js";
import { computeGaps, atr } from "./engine/gaps.js";
import { rsi } from "./engine/osc.js";
import { simulate, ACC_NAMES } from "./grid.js";
import { simulateSB } from "./sb.js";
import { saveCandles, getPref } from "./store.js";
import { arrowPlans } from "./drawings.js";
export { ACC_NAMES };

const H = 3600000, DAY = 86400000, KEEP_DAYS = 30, TV = 7;
const COL = { long: "#089981", short: "#F23645", done: "#9E9E9E", old: "#8D6E63", pos: "#2962FF" };   // long zöld, short piros, teljesült szürke, előző napi barna
const fmtDay = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short", day: "numeric" });
// méretezés: ekkora esés (long, legfeljebb 0-ig) / emelkedés (short) se likvidálja a számlát, mind a 4 láb kitelve
export const SWAN = 50;
export const DEFAULT_BAL = 102000 / 6;   // 6 OKX-számla: Fő, Al1–Al4 (rács) és Al5 = SB (silver bullet + extrém izo) – 17 000 $ mindegyik
export const ALL_ACC = [...ACC_NAMES, "SB"];
// szabályverzió: minden szabályváltozásnál nő; az élő napló eseményei ezt is rögzítik
export const RULES = { v: 2, date: "2026-11-27", reset: 4,
  note: "végleges felosztás: 6 OKX-számla, 17 000 $ mindegyik – Fő, Al1–Al4 rács (cross + izo kör, 3 DCA), Al5 = SB (silver bullet + extrém izo); a napló ezzel újraszámolva",
  changes: [
    { v: 1, note: "napló-indító: rács + SB (London/TNY/NY AM/NY PM), szűrők, C2, vészfék 20 %, tick-átütés, csúszás" },
    { v: 1.1, note: "javítás: TP1 a legközelebbi vastag egyezésvonalon (mai terv), pozitív SL 1 $ nyereségtől (nem swing)" },
    { v: 1.2, note: "extrém visszafordulás izolált kereskedés az SB számlán (RSI 15m+1h 20/80, J 15m; GP 9–10/10; 2 DCA; margin ≤ 10 %, +20 $ védelem)" },
    { v: 1.3, note: "rács: számlánként és irányonként cross + izo; az izo kör az utolsó cross indulása után, a cross méretével" },
    { v: 2, note: "6 számla (5 rács + SB), 17 000 $ / számla" }] };
// görbe [[t, érték]] → függvény: az utolsó t-ig ismert érték
function curveAt(c) { return t => { let lo = 0, hi = c.length - 1, r = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m][0] <= t) { r = c[m][1]; lo = m + 1; } else hi = m - 1; } return r; }; }

export function asiaClose(ms, back = 0) {           // a NY-nap kezdete (= az Ázsia-killzone vége), back nappal korábban
  const d = nyDate(ms), u = new Date(Date.UTC(d.y, d.m - 1, d.d - back));
  return nyToUtc(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), 0, 0);
}
function londonClose(T) { const x = nyDate(T + H); return nyToUtc(x.y, x.m, x.d, 5, 0); }

// tároláshoz: a stratégiai szintekből csak az entry közeliek maradnak
function slim(p) {
  if (!p) return p;
  const o = { ...p };
  for (const k of ["long", "short"]) if (p[k]) {
    const e = p[k].entry.p;
    o[k] = { ...p[k], levels: p[k].levels.filter(x => Math.abs(x.p - e) <= e * 0.4).sort((a, b) => Math.abs(a.p - e) - Math.abs(b.p - e)).slice(0, 150).map(x => ({ p: x.p, why: x.why })) };
  }
  return o;
}

// 4h volumenprofil legnagyobb forgalmú szintje (a gyertyák forgalma a tartományukra egyenletesen szétosztva)
function vpoc(bars) {
  if (bars.length < 20) return null;
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); }
  const N = 120, step = (hi - lo) / N || 1, v = new Float64Array(N);
  for (const b of bars) {
    const a = Math.max(0, Math.floor((b.l - lo) / step)), z = Math.min(N - 1, Math.floor((b.h - lo) / step));
    for (let k = a; k <= z; k++) v[k] += (b.v || 0) / (z - a + 1);
  }
  let m = 0; for (let k = 1; k < N; k++) if (v[k] > v[m]) m = k;
  return lo + (m + 0.5) * step;
}

// TP-jelöltek idősíkonként a terv idejében: nyitott rések [alja, teteje] és CRT (az utolsó 3 lezárt gyertya csúcsa/alja)
function candidates(bars, sec, T, ref) {
  const b = bars.filter(x => x.t + sec * 1000 <= T).map(x => ({ ...x, done: true }));
  if (b.length < 30) return { gaps: [], crt: [] };
  const gaps = computeGaps(b, sec, atr(b)).filter(g => Math.abs(g.bot - ref) <= ref * 0.35).map(g => [g.bot, g.top, g.bull ? 1 : 0]);
  const crt = b.slice(-3).flatMap(x => [x.h, x.l]);
  return { gaps, crt };
}

export class PlanManager {
  constructor({ engine, fetchLatest, fetchOlder, merge, loadCandles, insts, onChange }) {
    Object.assign(this, { engine, fetchLatest, fetchOlder, merge, loadCandles, insts, onChange });
    this.data = new Map(); this.busy = new Set(); this.seq = 0; this.rsiTf = "1h"; this.sims = new Map();
    setInterval(() => this.tickAll(), 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.tickAll(); });
  }
  store(key) { try { return JSON.parse(localStorage.getItem("szezso.plans." + key)) || { days: {} }; } catch { return { days: {} }; } }
  save(key, st) {
    const keys = Object.keys(st.days).map(Number).sort((a, b) => b - a);
    for (const k of keys.slice(KEEP_DAYS)) delete st.days[k];
    try { localStorage.setItem("szezso.plans." + key, JSON.stringify(st)); } catch {}
  }
  watch(key) { if (!this.data.has(key)) { this.data.set(key, { bars: [], bars4: [], bars15: [], daily: [] }); this.tick(key); } }
  tickAll() { for (const k of this.data.keys()) this.tick(k); }

  // gyertyák: a tárolt + a legfrissebb, szükség esetén régebbi lapokkal, amíg el nem éri a `from` időpontot / `want` darabot
  async series(inst, tf, have, want, from = Infinity) {
    let bars = have.length ? have : await this.loadCandles(inst.instId, tf);
    bars = this.merge(bars, await this.fetchLatest(inst.instId, tf));
    for (let k = 0; k < 40 && (bars.length < want || bars[0].t > from); k++) {
      const older = await this.fetchOlder(inst.instId, tf, bars[0].t);
      if (!older.length) break;
      bars = this.merge(older, bars);
    }
    bars = bars.filter(b => !b.ext);
    saveCandles(inst.instId, tf, bars);
    return bars;
  }
  async load(key) {
    const inst = this.insts[key], d = this.data.get(key), st = this.store(key);
    const from = (st.start || asiaClose(Date.now(), 1)) - 2 * DAY;
    d.bars = await this.series(inst, "1h", d.bars, 900);
    d.bars4 = await this.series(inst, "4h", d.bars4, 600);
    d.bars15 = await this.series(inst, "15m", d.bars15, 400, from);
    if (inst.short === "HYPE") d.bars5 = await this.series(inst, "5m", d.bars5 || [], 400, from);   // a silver bullethez
    d.daily = await this.fetchLatest(inst.instId, "1D");
  }

  // TP-célok idősíkonként a terv idejében: TP1 15m, TP2 1h, TP3 4h, swing 1D; mindegyikhez az idősík egyezésvonalai is
  async addGaps(key, p, T) {
    const d = this.data.get(key);
    if (!p || p.tv === TV) return p;
    const ref = p.entry.p;
    p.cand = { m15: candidates(d.bars15, 900, T, ref), h1: candidates(d.bars, 3600, T, ref), h4: candidates(d.bars4, 14400, T, ref), d1: candidates(d.daily, 86400, T, ref) };
    p.cand.m15.cf = (await this.cfAt(key, d.bars15, 900, T)).cf || [];
    const i4 = await this.cfAt(key, d.bars4, 14400, T);
    p.cand.h4.cf = i4.cf || []; p.cand.h4.pat = i4.pat || [];
    // swing-célok: 4h VPOC (30 nap), a 10/10-es golden pocket, POI (1h), az 1D legvastagabb egyezésvonala
    const i1 = await this.cfAt(key, d.bars, 3600, T), iD = await this.cfAt(key, d.daily, 86400, T), sw = [];
    const vp = vpoc(d.bars4.filter(x => x.t + 14400000 <= T).slice(-180));
    if (vp != null) sw.push({ p: vp, why: "4h VPOC" });
    for (const z of i4.gpz || []) if (z.strength >= 10) sw.push({ p: (z.upper + z.lower) / 2, why: "golden pocket 10/10" });
    for (const q of i1.poi || []) sw.push({ p: q, why: "POI" });
    const thick = (iD.cf || []).slice().sort((a, b) => b.n - a.n)[0];
    if (thick) sw.push({ p: thick.p, why: `1D legvastagabb egyezés (${thick.n})` });
    p.cand.sw = sw;
    p.cand.gpz = (i4.gpz || []).filter(z => z.strength >= 9).map(z => ({ upper: z.upper, lower: z.lower, strength: z.strength }));   // az extrém izo belépőjéhez
    p.cand.h1.cf = p.levels.filter(x => /^EGYEZÉS/.test(x.why || "")).map(x => { const m = /^EGYEZÉS (\d+) \((.*)\)/.exec(x.why) || []; return { p: x.p, n: +m[1] || 5, codes: (m[2] || "").split("·") }; });
    p.tick = this.insts[key].tick; p.atr = (p.tpGap || 0) * 4;
    delete p.gapTps; delete p.gapTps2; delete p.crtTps;
    p.tv = TV;
    return p;
  }
  // egy idősík egyezésvonalai a T időpontban (a motorból)
  cfAt(key, bars, sec, T) {
    const inst = this.insts[key], b = bars.filter(x => x.t + sec * 1000 <= T).map(x => ({ ...x, done: true }));
    if (b.length < 100) return Promise.resolve({});
    const id = "cf:" + key + ":" + sec + ":" + T + ":" + (++this.seq);
    return new Promise(res => this.engine.send({ id, seq: 1, bars: b, daily: this.data.get(key).daily.filter(x => x.t < T), barSec: sec, layers: {}, tick: inst.tick, info: true },
      r => { this.engine.drop(id); res((r && r.info) || {}); }));
  }

  run(key, T) {
    const d = this.data.get(key), inst = this.insts[key];
    const bars = d.bars.filter(b => b.t + H <= T).map(b => ({ ...b, done: true }));
    if (bars.length < 200) return Promise.resolve(null);
    const minGap = inst.short === "HYPE" ? 3 : bars[bars.length - 1].c * 0.05;
    const id = "plan:" + key + ":" + T + ":" + (++this.seq);
    return new Promise(res => this.engine.send({ id, seq: 1, bars, daily: d.daily.filter(x => x.t < T), barSec: 3600, layers: {}, tick: inst.tick, plan: true, minGap },
      async r => {
        this.engine.drop(id);
        const pl = r && r.plans;
        if (pl) for (const k of ["long", "short"]) if (pl[k]) { pl[k].gap = pl[k].gap || minGap; await this.addGaps(key, pl[k], T); }
        res(pl);
      }));
  }

  // az adatfülhöz: a motor összefoglalója az 1 órás adatokból (a mostani állapot)
  info(key, src, sec = 3600) {
    const d = this.data.get(key), inst = this.insts[key], all = src || d.bars;
    if (all.length < 200) return Promise.resolve(null);
    const id = "info:" + key + ":" + sec + ":" + (++this.seq), bars = all.map((b, i) => i < all.length - 1 ? { ...b, done: true } : b);
    return new Promise(res => this.engine.send({ id, seq: 1, bars, daily: d.daily, barSec: sec, layers: {}, tick: inst.tick, info: true },
      r => { this.engine.drop(id); res(r && r.info); }));
  }

  async tick(key) {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    try {
      await this.load(key);
      const d = this.data.get(key), now = Date.now(), st = this.store(key);
      let changed = false;
      if (!st.start) {                                     // egyszeri tiszta kezdés: a korábbi napok törlése, az előzmény innen gyűlik
        st.start = asiaClose(now);
        for (const k of Object.keys(st.days)) if (+k < st.start) delete st.days[k];
        changed = true;
      }
      for (const back of [1, 0]) {                         // tegnapi (ha hiányzik) és mai terv
        const T = asiaClose(now, back);
        if (T < st.start) continue;
        if (!st.days[T]) { const p = await this.run(key, T); if (p) { st.days[T] = { T, ...slim(p), rev: false }; changed = true; } }
      }
      // a korábban (rés-TP nélkül) mentett tervek kiegészítése
      for (const day of Object.values(st.days)) for (const k of ["long", "short"]) if (day[k] && day[k].tv !== TV) {
        day[k].gap = day[k].gap || (this.insts[key].short === "HYPE" ? 3 : day[k].entry.p * 0.05);
        await this.addGaps(key, day[k], day[k].from || day.T); changed = true;
      }
      const T0 = asiaClose(now), day = st.days[T0], L = nyToUtc(...(() => { const x = nyDate(T0 + H); return [x.y, x.m, x.d]; })(), 5, 0);
      if (day && !day.rev && now >= L) {
        const p = slim(await this.run(key, L));
        if (p) {
          const hit = q => d.bars15.some(b => b.t >= T0 && b.t < L && (q.dir > 0 ? b.l <= q.entry.p : b.h >= q.entry.p));
          for (const k of ["long", "short"]) if (day[k] && p[k] && !hit(day[k])) { day[k] = { ...p[k], revised: true, from: L }; }
          day.primary = p.primary || day.primary;
        }
        day.rev = true; changed = true;
      }
      if (changed) this.save(key, st);
      this.runSim(key);
      d.info = await this.info(key);
      d.info15 = await this.info(key, d.bars15, 900);
      this.onChange(key);
    } catch (e) { console.warn("[szezso] terv:", e); }
    finally { this.busy.delete(key); }
  }

  // RSI(14) jelzés a választott idősíkon: ≥ 70 → a long zárását segíti, ≤ 30 → a shortét
  rsiFlag(key) {
    const d = this.data.get(key), tf = this.rsiTf || "1h";
    const bars = tf === "4h" ? d && d.bars4 : tf === "15m" ? d && d.bars15 : d && d.bars;
    if (!bars || bars.length < 30) return null;
    const r = rsi(bars.map(b => b.c), 14), v = r[r.length - 1];
    return v >= 70 ? { dir: 1, v, tf } : v <= 30 ? { dir: -1, v, tf } : null;
  }
  setRsiTf(tf) { this.rsiTf = tf; this.tickAll(); }

  // papírszámlák egyenlege (a tableten, számlánként szerkeszthető)
  balances() { const b = getPref("paper.bal6", {}); return Object.fromEntries(ALL_ACC.map(a => [a, +b[a] || DEFAULT_BAL])); }

  // a folyamatos rács végigjátszása a 15m gyertyákon (csak HYPE-pal kereskedünk: a többinél méretezés nélkül)
  runSim(key) {
    const d = this.data.get(key), st = this.store(key), hype = this.insts[key].short === "HYPE";
    if (!d || !d.bars15.length) return null;
    const ap = arrowPlans(key);       // a rajzolt nyilak vége: felfelé mutató → long swing-cél, lefelé → short swing-cél
    const days = Object.values(st.days).sort((a, b) => a.T - b.T).map(x => ({ ...x, L: londonClose(x.T) }));
    for (const day of days) {
      if (day.long) day.long = { ...day.long, swingX: ap.short.map(a => ({ p: a.p, why: "a rajzod nyila" })) };
      if (day.short) day.short = { ...day.short, swingX: ap.long.map(a => ({ p: a.p, why: "a rajzod nyila" })) };
    }
    const bars = d.bars15.filter(b => b.t >= (days[0] ? days[0].T : Infinity));
    // belépési szűrő (volumendivergencia 5m/15m + RSI/KDJ): a rácsra és a silver bulletre is
    const b5 = d.bars5 ? d.bars5.filter(b => b.t >= (days[0] ? days[0].T - 86400000 : 0)) : null;
    const filter = makeFilter(b5, b5 ? to15(b5) : d.bars15);
    const bal = this.balances(), tick = this.insts[key].tick;
    const gridCfg = { filter, tick, bal, remMode: getPref("paper.remMode", "a"), swan: SWAN, six: hype ? 6 : null, sized: hype, minTp2: (avg, p) => hype ? 2 : Math.max(2 * ((p && p.atr) || avg * 0.004), avg * 0.004) };
    const sbRun = hype && d.bars5 && days[0] ? extEq => simulateSB(d.bars5.filter(b => b.t >= days[0].T), { filter, tick, sized: true, bal: bal.SB, swan: SWAN, extStart: ACC_NAMES.reduce((s, a) => s + bal[a], 0), extEq, bars1h: d.bars,
      // vastag egyezésvonalak a silver bullet belépőjéhez: az adott nap tervéből (15m, 1h, 4h)
      gpz: t => { const day = days.filter(x => x.T <= t).pop() || days[0]; return (day.long && day.long.cand && day.long.cand.gpz) || (day.short && day.short.cand && day.short.cand.gpz) || []; },
      cfLines: t => { const day = days.filter(x => x.T <= t).pop() || days[0]; return ["long", "short"].flatMap(k => day[k] && day[k].cand ? ["m15", "h1", "h4"].flatMap(f => (day[k].cand[f] && day[k].cand[f].cf) || []) : []).filter(g => g.n >= 5); } }) : null;
    // vészfék a teljes fiókra (rács + SB): az SB előzetes görbéje a rácsnak, a rács görbéje az SB-nek
    const sb0 = sbRun ? sbRun(null) : null;
    const sim = simulate(days, bars, { ...gridCfg, extStart: hype ? bal.SB : 0, extEq: sb0 ? curveAt(sb0.curve) : null }, Date.now());
    sim.days = days; sim.key = key; sim.hype = hype; sim.rules = RULES;
    if (sbRun) sim.sb = sbRun(curveAt(sim.curve));
    this.sims.set(key, sim);
    return sim;
  }
  sim(key) { return this.sims.get(key) || this.runSim(key); }

  // az adatfülhöz: a napok tervei és a hozzájuk tartozó kereskedések
  history(key) {
    const s = this.sim(key);
    if (!s) return [];
    const out = [];
    for (const day of s.days.slice().reverse()) for (const k of ["long", "short"]) if (day[k])
      out.push({ T: day.T, day: fmtDay.format(day.T), plan: day[k], primary: day.primary === day[k].dir, trades: s.trades.filter(t => t.day === day.T && t.dir === day[k].dir) });
    return out;
  }

  // a chart rajzai egy számlához (null = Fő)
  items(key, lastT, barSec, account) {
    const s = this.sim(key);
    if (!s) return [];
    const acc = account || "Fő", T0 = asiaClose(Date.now()), items = [], bs = barSec * 1000;
    const t2 = lastT + 6 * bs, f = p => +p.toPrecision(6);
    const rsiFlag = this.rsiFlag(key), last = s.last ? s.last.c : NaN;
    const sbT = acc === "SB" && s.sb ? s.sb.trades.filter(t => t.state === "vár" || t.state === "aktív" || (t.state === "lezárva" && t.closeT >= T0)) : [];
    for (const t of [...s.trades, ...sbT]) {
      if (t.acc !== acc) continue;
      const open = t.state === "aktív" || t.state === "részben" || t.state === "védett", today = t.day === T0;
      // nyitott, várakozó, és a ma lezárt kereskedések (szürkén); a lejárt megbízások nem
      if (!(open || t.state === "vár" || (t.state === "lezárva" && (today || t.closeT >= T0)))) continue;
      const sb = t.acc === "SB", sd = (sb ? "SB " : "") + (t.dir > 0 ? "L" : "S"), old = !today && !sb, pre = old ? `${fmtDay.format(t.day)} ` : "";
      const t1 = Math.min(Math.max(t.from, lastT - 40 * bs), lastT - 12 * bs);
      const day = s.days.find(x => x.T === t.day), primary = day && day.primary === t.dir;
      const w = !old && primary && !sb ? 3 : 2, base = sb ? "#9C27B0" : old ? COL.old : t.dir > 0 ? COL.long : COL.short;
      const rows = [];
      t.legs.forEach((l, i) => rows.push({ y: l.p, text: `${pre}${sd}${i ? "DCA" + i : "E"} ${f(l.p)}`, done: i < t.filled, width: i ? Math.max(1, w - 1) : w, style: i ? "dotted" : "solid" }));
      if (t.tps) t.tps.forEach((x, i) => { if (t.shares[i]) rows.push({ y: x.p, text: sb ? `${sd}TP ${f(x.p)}` : `${pre}${sd}${i < 3 ? "TP" + (i + 1) : "SWING"} ${f(x.p)} · ${Math.round(t.shares[i] * 100)}%`, done: t.tpHit.includes(i), width: Math.max(1, w - 1), style: "dashed" }); });
      if (t.stop != null) rows.push({ y: t.stop, text: `${pre}${sd}SL+ ${f(t.stop)}`, done: t.exits.some(e => e.why === "pozitív stop"), width: 1, style: "dashed", color: "#616161" });
      if (open && t.open > 0) items.push({ type: "dot", t: Math.max(t.fills[0].t, t1), p: t.avg, r: 7, color: "#B8860B", fill: "#FFD700" });   // arany pötty: a futó pozíció átlagára (a látható szakaszon)
      if (open && t.open > 0) {                                     // pozíció-vonal, mint a TradingView papírkereskedésénél
        const u = t.dir * (last - t.avg) * t.open;
        rows.push({ y: t.avg, text: `${sd} ${s.hype ? +t.open.toFixed(1) + " HYPE · " : ""}átl. ${f(t.avg)} · ${u >= 0 ? "+" : ""}${u.toFixed(2)}${s.hype ? " $" : ""}`, done: false, width: 1, style: "solid", color: COL.pos });
      }
      if (rsiFlag && !old && open && rsiFlag.dir === t.dir && (last - t.avg) * t.dir > 0 && t.tps) {
        const k = [0, 1, 2, 3].find(i => t.shares[i] && !t.tpHit.includes(i));
        if (k != null) rows.push({ y: t.tps[k].p, text: `RSI ${Math.round(rsiFlag.v)} ✋ (${rsiFlag.tf})`, done: false, width: 0, style: "solid", color: "#6A1B9A", noLine: true });
      }
      // korábbi napról futó kereskedésnél a múlt (teljesült lábak, elért TP-k) nem kell, csak ami még él
      if (old) for (let k = rows.length - 1; k >= 0; k--) if (rows[k].done) rows.splice(k, 1);
      rows.sort((x, y) => x.y - y.y);
      let lastY = null, shift = 0;
      for (const row of rows) {
        // egymáshoz nagyon közeli szinteknél a címke vízszintesen elcsúszik
        shift = lastY != null && Math.abs(row.y - lastY) < row.y * 0.004 ? shift + 1 : 0; lastY = row.y;
        const color = row.done ? COL.done : row.color || base, text = row.text + (row.done ? " ✓" : "");
        if (!row.noLine) items.push({ type: "line", t1, p1: row.y, t2, p2: row.y, color, width: row.width, style: row.style });
        const lt = t.dir > 0 ? t1 + shift * 9 * bs : t2 - shift * 9 * bs;
        items.push({ type: "label", t: lt, p: row.y, text, color, size: 12, align: t.dir > 0 ? "left" : "right", vAlign: "above", bold: row.width > 2, bg: "rgba(255,255,255,0.85)" });
      }
    }
    return items;
  }
}
