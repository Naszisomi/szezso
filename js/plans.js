// Napi kereskedési tervek: Ázsia végén (00:00 NY) rögzítve, az 1 órás adatokból, mindkét irányra.
// London végén (05:00 NY) egyszer frissülhet az az irány, amelynek az entryje még nem jött meg.
// Állapot: vár → aktív (entry megvan, DCA-k telnek, TP az átlagárhoz igazodik) → lezárva (TP1) / lejárt
// (a következő Ázsia végéig nem jött meg az entry). Az előző napi, még aktív terv barnán marad a charton.
// A tervek a tabletre mentődnek (localStorage), így frissítés után is ugyanazok.
import { nyToUtc, nyDate } from "./ind/milana.js";
import { tpsFor, UNITS } from "./engine/tradeutil.js";

const H = 3600000, DAY = 86400000, KEEP_DAYS = 14;
const COL = { long: "#089981", short: "#F23645", done: "#9E9E9E", old: "#8D6E63" };   // long zöld, short piros, teljesült szürke, előző napi barna
const fmtDay = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short", day: "numeric" });

function asiaClose(ms, back = 0) {           // a NY-nap kezdete (= az Ázsia-killzone vége), back nappal korábban
  const d = nyDate(ms), u = new Date(Date.UTC(d.y, d.m - 1, d.d - back));
  return nyToUtc(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), 0, 0);
}

// tároláshoz: a stratégiai szintekből csak az entry közeliek maradnak (a TP-khez elég)
function slim(p) {
  if (!p) return p;
  const o = { ...p };
  for (const k of ["long", "short"]) if (p[k]) {
    const e = p[k].entry.p;
    o[k] = { ...p[k], levels: p[k].levels.filter(x => Math.abs(x.p - e) <= e * 0.3).sort((a, b) => Math.abs(a.p - e) - Math.abs(b.p - e)).slice(0, 80).map(x => ({ p: x.p, why: x.why })) };
  }
  return o;
}

export function evalPlan(p, bars, T, now) {
  const legs = [p.entry, ...p.dca], d = p.dir;
  const touch = (b, x) => d > 0 ? b.l <= x : b.h >= x, reach = (b, x) => d > 0 ? b.h >= x : b.l <= x;
  let filled = 0, q = 0, v = 0, avg = null, tps = tpsFor(p, p.entry.p), state = "vár", lastFill = -1, closeT = null, closeP = null, tpHit = 0;
  const t0 = p.from || T;                       // a London utáni frissített terv csak onnan figyel
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.t < t0) continue;
    if (state === "vár" && b.t >= T + DAY) { state = "lejárt"; break; }
    if (state === "lezárva") { while (tpHit < 3 && reach(b, tps[tpHit].p)) tpHit++; if (tpHit === 3) break; continue; }
    if (state === "vár" || state === "aktív") {
      let n = 0;
      while (filled < 4 && touch(b, legs[filled].p)) { q += UNITS[filled]; v += UNITS[filled] * legs[filled].p; filled++; n++; }
      if (n) { state = "aktív"; avg = v / q; tps = tpsFor(p, avg); lastFill = i; continue; }
      if (state === "aktív" && i > lastFill && reach(b, tps[0].p)) { state = "lezárva"; closeT = b.t; closeP = tps[0].p; tpHit = 1; while (tpHit < 3 && reach(b, tps[tpHit].p)) tpHit++; }
    }
  }
  if (state === "vár" && now >= T + DAY) state = "lejárt";
  return { state, filled, avg, tps, closeT, closeP, tpHit };
}

export class PlanManager {
  constructor({ engine, fetchLatest, fetchOlder, merge, loadCandles, insts, onChange }) {
    Object.assign(this, { engine, fetchLatest, fetchOlder, merge, loadCandles, insts, onChange });
    this.data = new Map(); this.busy = new Set(); this.seq = 0;
    setInterval(() => this.tickAll(), 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.tickAll(); });
  }
  store(key) { try { return JSON.parse(localStorage.getItem("szezso.plans." + key)) || { days: {} }; } catch { return { days: {} }; } }
  save(key, st) {
    const keys = Object.keys(st.days).map(Number).sort((a, b) => b - a);
    for (const k of keys.slice(KEEP_DAYS)) delete st.days[k];
    try { localStorage.setItem("szezso.plans." + key, JSON.stringify(st)); } catch {}
  }
  watch(key) { if (!this.data.has(key)) { this.data.set(key, { bars: [], daily: [] }); this.tick(key); } }
  tickAll() { for (const k of this.data.keys()) this.tick(k); }

  async load(key) {
    const inst = this.insts[key], d = this.data.get(key);
    let bars = d.bars.length ? d.bars : await this.loadCandles(inst.instId, "1h");
    bars = this.merge(bars, await this.fetchLatest(inst.instId, "1h"));
    for (let k = 0; k < 6 && bars.length < 900; k++) {
      const older = await this.fetchOlder(inst.instId, "1h", bars[0].t);
      if (!older.length) break;
      bars = this.merge(older, bars);
    }
    d.bars = bars.filter(b => !b.ext);
    d.daily = await this.fetchLatest(inst.instId, "1D");
  }

  run(key, T) {
    const d = this.data.get(key), inst = this.insts[key];
    const bars = d.bars.filter(b => b.t + H <= T).map(b => ({ ...b, done: true }));
    if (bars.length < 200) return Promise.resolve(null);
    const minGap = inst.short === "HYPE" ? 3 : bars[bars.length - 1].c * 0.05;
    const id = "plan:" + key + ":" + T + ":" + (++this.seq);
    return new Promise(res => this.engine.send({ id, seq: 1, bars, daily: d.daily.filter(x => x.t < T), barSec: 3600, layers: {}, tick: inst.tick, plan: true, minGap },
      r => { this.engine.drop(id); res(r && r.plans); }));
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
      const T0 = asiaClose(now), day = st.days[T0], L = nyToUtc(...(() => { const x = nyDate(T0 + H); return [x.y, x.m, x.d]; })(), 5, 0);
      if (day && !day.rev && now >= L) {
        const p = slim(await this.run(key, L));
        if (p) {
          for (const k of ["long", "short"]) if (day[k] && p[k] && evalPlan(day[k], d.bars, T0, L).state === "vár") { day[k] = { ...p[k], revised: true, from: L }; }
          day.primary = p.primary || day.primary;
        }
        day.rev = true; changed = true;
      }
      if (changed) this.save(key, st);
      this.cache = null;
      this.onChange(key);
    } catch (e) { console.warn("[szezso] terv:", e); }
    finally { this.busy.delete(key); }
  }

  // az összes tárolt terv állapottal (az adatfülhöz is)
  history(key) {
    const d = this.data.get(key);
    if (!d) return [];
    const st = this.store(key), now = Date.now(), out = [];
    for (const day of Object.values(st.days).sort((a, b) => b.T - a.T))
      for (const k of ["long", "short"]) if (day[k]) out.push({ T: day.T, day: fmtDay.format(day.T), plan: day[k], primary: day.primary === day[k].dir, ...evalPlan(day[k], d.bars, day.T, now) });
    return out;
  }

  items(key, lastT, barSec) {
    const h = this.history(key), T0 = asiaClose(Date.now()), items = [];
    const t2 = lastT + 6 * barSec * 1000, f = p => +p.toPrecision(6);
    for (const r of h) {
      const today = r.T === T0;
      if (!today && r.state !== "aktív") continue;          // korábbi napokból csak a még futó (barna)
      const p = r.plan, sd = p.dir > 0 ? "L" : "S", old = !today;
      const t1 = Math.min(Math.max(r.T, lastT - 40 * barSec * 1000), lastT - 12 * barSec * 1000), pre = old ? `${r.day} ` : "";
      const w = !old && r.primary ? 3 : 2, base = old ? COL.old : p.dir > 0 ? COL.long : COL.short;
      const row = (y, text, done, width, style) => {
        const color = done ? COL.done : base;
        items.push({ type: "line", t1, p1: y, t2, p2: y, color, width, style });
        items.push({ type: "label", t: t2, p: y, text, color, size: 12, align: "right", vAlign: "above", bold: width > 2, bg: "rgba(255,255,255,0.85)" });
      };
      // címke: LE / LDCA1 / LTP1 (short: SE / SDCA1 / STP1) + ár; entry folytonos, DCA pöttyös, TP szaggatott
      [p.entry, ...p.dca].forEach((l, i) =>
        row(l.p, `${pre}${sd}${i ? "DCA" + i : "E"} ${f(l.p)}`, i < r.filled, i ? Math.max(1, w - 1) : w, i ? "dotted" : "solid"));
      r.tps.forEach((t, i) => row(t.p, `${pre}${sd}TP${i + 1} ${f(t.p)}`, i < r.tpHit, Math.max(1, w - 1), "dashed"));
    }
    return items;
  }
}
