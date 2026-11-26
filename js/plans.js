// Napi kereskedési tervek: Ázsia végén (00:00 NY) rögzítve, az 1 órás adatokból, mindkét irányra.
// London végén (05:00 NY) egyszer frissülhet az az irány, amelynek az entryje még nem jött meg.
// A tervekből a grid.js folyamatos rácsot játszik végig a 15 perces gyertyákon (számlák, szerepek, TP-k
// idősíkonként, napváltás, méretezés) – ez a papírkereskedés és a chart rajza is.
// RSI-jel (70/30, választható idősíkon): nyereséges, nyitott pozíciónál „RSI ✋” a következő TP mellett.
// A tervek a tabletre mentődnek (localStorage), a gyertyák az IndexedDB-be.
import { nyToUtc, nyDate } from "./ind/milana.js";
import { computeGaps, atr } from "./engine/gaps.js";
import { rsi } from "./engine/osc.js";
import { simulate, ACC_NAMES } from "./grid.js";
import { saveCandles, getPref } from "./store.js";
export { ACC_NAMES };

const H = 3600000, DAY = 86400000, KEEP_DAYS = 30, TV = 3;
const COL = { long: "#089981", short: "#F23645", done: "#9E9E9E", old: "#8D6E63", pos: "#2962FF" };   // long zöld, short piros, teljesült szürke, előző napi barna
const fmtDay = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short", day: "numeric" });
export const DEFAULT_BAL = 17000;

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

// TP-jelöltek idősíkonként a terv idejében: nyitott rések [alja, teteje] és CRT (az utolsó 3 lezárt gyertya csúcsa/alja)
function candidates(bars, sec, T, ref) {
  const b = bars.filter(x => x.t + sec * 1000 <= T).map(x => ({ ...x, done: true }));
  if (b.length < 30) return { gaps: [], crt: [] };
  const gaps = computeGaps(b, sec, atr(b)).filter(g => Math.abs(g.bot - ref) <= ref * 0.35).map(g => [g.bot, g.top]);
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
    for (let k = 0; k < 20 && (bars.length < want || bars[0].t > from); k++) {
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
    d.daily = await this.fetchLatest(inst.instId, "1D");
  }

  // TP-célok idősíkonként a terv idejében: TP1 15m, TP2 1h, TP3 4h, swing 1D
  addGaps(key, p, T) {
    const d = this.data.get(key);
    if (!p || p.tv === TV) return p;
    const ref = p.entry.p;
    p.cand = { m15: candidates(d.bars15, 900, T, ref), h1: candidates(d.bars, 3600, T, ref), h4: candidates(d.bars4, 14400, T, ref), d1: candidates(d.daily, 86400, T, ref) };
    delete p.gapTps; delete p.gapTps2; delete p.crtTps;
    p.tv = TV;
    return p;
  }

  run(key, T) {
    const d = this.data.get(key), inst = this.insts[key];
    const bars = d.bars.filter(b => b.t + H <= T).map(b => ({ ...b, done: true }));
    if (bars.length < 200) return Promise.resolve(null);
    const minGap = inst.short === "HYPE" ? 3 : bars[bars.length - 1].c * 0.05;
    const id = "plan:" + key + ":" + T + ":" + (++this.seq);
    return new Promise(res => this.engine.send({ id, seq: 1, bars, daily: d.daily.filter(x => x.t < T), barSec: 3600, layers: {}, tick: inst.tick, plan: true, minGap },
      r => {
        this.engine.drop(id);
        const pl = r && r.plans;
        if (pl) for (const k of ["long", "short"]) if (pl[k]) { pl[k].gap = pl[k].gap || minGap; this.addGaps(key, pl[k], T); }
        res(pl);
      }));
  }

  // az adatfülhöz: a motor összefoglalója az 1 órás adatokból (a mostani állapot)
  info(key) {
    const d = this.data.get(key), inst = this.insts[key];
    if (d.bars.length < 200) return Promise.resolve(null);
    const id = "info:" + key + ":" + (++this.seq), bars = d.bars.map((b, i) => i < d.bars.length - 1 ? { ...b, done: true } : b);
    return new Promise(res => this.engine.send({ id, seq: 1, bars, daily: d.daily, barSec: 3600, layers: {}, tick: inst.tick, info: true },
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
        this.addGaps(key, day[k], day[k].from || day.T); changed = true;
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
  balances() { const b = getPref("paper.bal", {}); return Object.fromEntries(ACC_NAMES.map(a => [a, +b[a] || DEFAULT_BAL])); }

  // a folyamatos rács végigjátszása a 15m gyertyákon (csak HYPE-pal kereskedünk: a többinél méretezés nélkül)
  runSim(key) {
    const d = this.data.get(key), st = this.store(key), hype = this.insts[key].short === "HYPE";
    if (!d || !d.bars15.length) return null;
    const days = Object.values(st.days).sort((a, b) => a.T - b.T).map(x => ({ ...x, L: londonClose(x.T) }));
    const bars = d.bars15.filter(b => b.t >= (days[0] ? days[0].T : Infinity));
    const sim = simulate(days, bars, { bal: this.balances(), lo: 10, hi: 150, sized: hype, minTp2: avg => hype ? 2 : avg * 0.033 }, Date.now());
    sim.days = days; sim.key = key; sim.hype = hype;
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
    for (const t of s.trades) {
      if (t.acc !== acc) continue;
      const open = t.state === "aktív" || t.state === "részben" || t.state === "védett", today = t.day === T0;
      // nyitott, várakozó, és a ma lezárt kereskedések (szürkén); a lejárt megbízások nem
      if (!(open || t.state === "vár" || (t.state === "lezárva" && (today || t.closeT >= T0)))) continue;
      const sd = t.dir > 0 ? "L" : "S", old = !today, pre = old ? `${fmtDay.format(t.day)} ` : "";
      const t1 = Math.min(Math.max(t.from, lastT - 40 * bs), lastT - 12 * bs);
      const day = s.days.find(x => x.T === t.day), primary = day && day.primary === t.dir;
      const w = !old && primary ? 3 : 2, base = old ? COL.old : t.dir > 0 ? COL.long : COL.short;
      const rows = [];
      t.legs.forEach((l, i) => rows.push({ y: l.p, text: `${pre}${sd}${i ? "DCA" + i : "E"} ${f(l.p)}`, done: i < t.filled, width: i ? Math.max(1, w - 1) : w, style: i ? "dotted" : "solid" }));
      if (t.tps) t.tps.forEach((x, i) => { if (t.shares[i]) rows.push({ y: x.p, text: `${pre}${sd}${i < 3 ? "TP" + (i + 1) : "SWING"} ${f(x.p)} · ${Math.round(t.shares[i] * 100)}%`, done: t.tpHit.includes(i), width: Math.max(1, w - 1), style: "dashed" }); });
      if (t.stop != null) rows.push({ y: t.stop, text: `${pre}${sd}SL+ ${f(t.stop)}`, done: t.exits.some(e => e.why === "pozitív stop"), width: 1, style: "dashed", color: "#616161" });
      if (open && t.open > 0) {                                     // pozíció-vonal, mint a TradingView papírkereskedésénél
        const u = t.dir * (last - t.avg) * t.open;
        rows.push({ y: t.avg, text: `${sd} ${s.hype ? +t.open.toFixed(1) + " HYPE · " : ""}átl. ${f(t.avg)} · ${u >= 0 ? "+" : ""}${u.toFixed(2)}${s.hype ? " $" : ""}`, done: false, width: 1, style: "solid", color: COL.pos });
      }
      if (rsiFlag && !old && open && rsiFlag.dir === t.dir && (last - t.avg) * t.dir > 0 && t.tps) {
        const k = [0, 1, 2, 3].find(i => t.shares[i] && !t.tpHit.includes(i));
        if (k != null) rows.push({ y: t.tps[k].p, text: `RSI ${Math.round(rsiFlag.v)} ✋ (${rsiFlag.tf})`, done: false, width: 0, style: "solid", color: "#6A1B9A", noLine: true });
      }
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
