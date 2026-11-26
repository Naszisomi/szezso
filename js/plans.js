// Napi kereskedési tervek: Ázsia végén (00:00 NY) rögzítve, az 1 órás adatokból, mindkét irányra.
// London végén (05:00 NY) egyszer frissülhet az az irány, amelynek az entryje még nem jött meg.
// Lépcsőzetes számlák (HYPE): Fő entry = a napi terv entryje; Al1 entry = a Fő DCA1-e; Al2 entry = az Al1 DCA1-e …
// Minden számla: entry + 3 DCA, 1/1/2/4 adag. A short lépcső tükrözve (felfelé) megy.
// TP: a nagyobb idősík (4h, 1h) nyitott, nagy (≥ 1 ATR) réseinek közelebbi széle, tartalékként a stratégiai szintek.
// A legrosszabb átlagárú számla kapja a legközelebbi TP-t (az zár először), a jobbak a következő réseket (tovább futnak).
// Minden DCA-teljesülés és minden zárás után újrarangsorol.
// Állapot számlánként: vár → aktív → lezárva (TP1) / lejárt (a következő Ázsia végéig nem jött meg az entry).
// Az előző napi, még aktív terv barnán marad a charton. A tervek a tabletre mentődnek (localStorage).
import { nyToUtc, nyDate } from "./ind/milana.js";
import { UNITS } from "./engine/tradeutil.js";
import { computeGaps, atr } from "./engine/gaps.js";

const H = 3600000, DAY = 86400000, KEEP_DAYS = 14, NACC = 6;
export const ACC_NAMES = ["Fő", "Al1", "Al2", "Al3", "Al4", "Al5"];
const COL = { long: "#089981", short: "#F23645", done: "#9E9E9E", old: "#8D6E63" };   // long zöld, short piros, teljesült szürke, előző napi barna
const fmtDay = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short", day: "numeric" });

function asiaClose(ms, back = 0) {           // a NY-nap kezdete (= az Ázsia-killzone vége), back nappal korábban
  const d = nyDate(ms), u = new Date(Date.UTC(d.y, d.m - 1, d.d - back));
  return nyToUtc(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), 0, 0);
}

// tároláshoz: a stratégiai szintekből csak az entry közeliek maradnak
function slim(p) {
  if (!p) return p;
  const o = { ...p };
  for (const k of ["long", "short"]) if (p[k]) {
    const e = p[k].entry.p;
    o[k] = { ...p[k], levels: p[k].levels.filter(x => Math.abs(x.p - e) <= e * 0.4).sort((a, b) => Math.abs(a.p - e) - Math.abs(b.p - e)).slice(0, 120).map(x => ({ p: x.p, why: x.why })) };
  }
  return o;
}

// nyitott, nagy rések közelebbi széle a profit oldalon (a terv idejében)
function gapTargets(bars, barSec, T, dir, ref, tag, big = true) {
  const b = bars.filter(x => x.t + barSec * 1000 <= T).map(x => ({ ...x, done: true }));
  if (b.length < 30) return [];
  return computeGaps(b, barSec, atr(b)).filter(g => g.big === big && (dir > 0 ? g.bot > ref : g.top < ref))
    .map(g => ({ p: dir > 0 ? g.bot : g.top, why: `${tag} rés` }));
}

// a lépcső: 6 számla, mindegyik entry + 3 DCA
export function ladder(p) {
  const d = p.dir, gap = p.gap || 3, accs = [{ entry: p.entry, dca: p.dca }];
  const further = (x, ref) => d > 0 ? x <= ref - gap : x >= ref + gap;
  const pool = p.levels.filter(x => d > 0 ? x.p < p.entry.p : x.p > p.entry.p).sort((a, b) => d * (b.p - a.p));
  for (let k = 1; k < NACC; k++) {
    const entry = accs[k - 1].dca[0], dca = [];
    let ref = entry.p;
    for (const x of pool) { if (dca.length === 3) break; if (further(x.p, ref)) { dca.push(x); ref = x.p; } }
    while (dca.length < 3) { ref -= d * gap; dca.push({ p: ref, why: "min. távolság" }); }
    accs.push({ entry, dca });
  }
  return accs;
}

// TP-jelöltek: először a rések, utánuk a stratégiai szintek, végül egyenletes lépések
function pickTps(p, from, n = 3) {
  const d = p.dir, g = p.tpGap || 0, out = [];
  const beyond = (x, ref) => d > 0 ? x >= ref : x <= ref;
  const srt = a => a.slice().sort((x, y) => d * (x.p - y.p));
  let ref = from;
  for (const src of [srt(p.gapTps || []), srt(p.gapTps2 || []), srt(p.levels)]) {
    for (const x of src) { if (out.length === n) break; if (beyond(x.p, ref)) { out.push(x); ref = x.p + d * g; } }
    if (out.length === n) break;
  }
  while (out.length < n) { ref += d * Math.max(g * 4, Math.abs(from) * 0.005); out.push({ p: ref, why: "nincs szint" }); }
  return out;
}

// a 6 számla együttes végigjátszása az 1 órás gyertyákon
export function evalLadder(p, bars, T, now) {
  const d = p.dir, g = p.tpGap || 0, accs = ladder(p);
  const touch = (b, x) => d > 0 ? b.l <= x : b.h >= x, reach = (b, x) => d > 0 ? b.h >= x : b.l <= x;
  const st = accs.map(a => ({ legs: [a.entry, ...a.dca], filled: 0, q: 0, v: 0, avg: null, state: "vár", lastFill: -1, tps: null, tpHit: 0, closeT: null }));
  const rank = () => {
    const act = st.filter(a => a.state === "aktív").sort((x, y) => d * (y.avg - x.avg));   // legrosszabb átlagár elöl
    let prev = null;
    for (const a of act) { a.tps = pickTps(p, prev ? Math.max(d * (a.avg + d * g), d * (prev.tps[0].p + d * g)) * d : a.avg + d * g); prev = a; }
    let ref = prev ? prev.tps[0].p : null;
    for (const a of st) if (a.state === "vár") a.tps = pickTps(p, ref != null && d * ref > d * a.legs[0].p ? ref + d * g : a.legs[0].p + d * g);
  };
  rank();
  const t0 = p.from || T;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.t < t0) continue;
    let ch = false;
    for (const a of st) {
      if (a.state === "vár" && b.t >= T + DAY) { a.state = "lejárt"; continue; }
      if (a.state === "lezárva") { while (a.tpHit < 3 && reach(b, a.tps[a.tpHit].p)) a.tpHit++; continue; }
      if (a.state !== "vár" && a.state !== "aktív") continue;
      while (a.filled < 4 && touch(b, a.legs[a.filled].p)) { const u = UNITS[a.filled]; a.q += u; a.v += u * a.legs[a.filled].p; a.filled++; a.state = "aktív"; a.lastFill = i; a.avg = a.v / a.q; ch = true; }
    }
    if (ch) rank();
    let closed = false;
    for (const a of st) if (a.state === "aktív" && i > a.lastFill && reach(b, a.tps[0].p)) {
      a.state = "lezárva"; a.closeT = b.t; a.tpHit = 1; closed = true;
      while (a.tpHit < 3 && reach(b, a.tps[a.tpHit].p)) a.tpHit++;
    }
    if (closed) rank();
  }
  for (const a of st) { if (a.state === "vár" && now >= T + DAY) a.state = "lejárt"; if (a.q) a.avg = a.v / a.q; }
  return st.map((a, k) => ({ acc: ACC_NAMES[k], entry: a.legs[0], dca: a.legs.slice(1), state: a.state, filled: a.filled, avg: a.avg, tps: a.tps, tpHit: a.tpHit, closeT: a.closeT }));
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
  watch(key) { if (!this.data.has(key)) { this.data.set(key, { bars: [], bars4: [], daily: [] }); this.tick(key); } }
  tickAll() { for (const k of this.data.keys()) this.tick(k); }

  async series(inst, tf, have, want) {
    let bars = have.length ? have : await this.loadCandles(inst.instId, tf);
    bars = this.merge(bars, await this.fetchLatest(inst.instId, tf));
    for (let k = 0; k < 6 && bars.length < want; k++) {
      const older = await this.fetchOlder(inst.instId, tf, bars[0].t);
      if (!older.length) break;
      bars = this.merge(older, bars);
    }
    return bars.filter(b => !b.ext);
  }
  async load(key) {
    const inst = this.insts[key], d = this.data.get(key);
    d.bars = await this.series(inst, "1h", d.bars, 900);
    d.bars4 = await this.series(inst, "4h", d.bars4, 600);
    d.daily = await this.fetchLatest(inst.instId, "1D");
  }

  // a TP-rések hozzáadása (4h és 1h nagy, nyitott rések a terv idejében)
  addGaps(key, p, T) {
    const d = this.data.get(key);
    if (!p || p.gapTps2) return p;
    const ref = p.entry.p;
    p.gapTps = [...gapTargets(d.bars4, 14400, T, p.dir, ref, "4h"), ...gapTargets(d.bars, 3600, T, p.dir, ref, "1h")];
    p.gapTps2 = gapTargets(d.bars4, 14400, T, p.dir, ref, "4h kis", false);     // tartalék: a kisebb 4h rések
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
      for (const day of Object.values(st.days)) for (const k of ["long", "short"]) if (day[k] && !day[k].gapTps2) {
        day[k].gap = day[k].gap || (this.insts[key].short === "HYPE" ? 3 : day[k].entry.p * 0.05);
        this.addGaps(key, day[k], day[k].from || day.T); changed = true;
      }
      const T0 = asiaClose(now), day = st.days[T0], L = nyToUtc(...(() => { const x = nyDate(T0 + H); return [x.y, x.m, x.d]; })(), 5, 0);
      if (day && !day.rev && now >= L) {
        const p = slim(await this.run(key, L));
        if (p) {
          for (const k of ["long", "short"]) if (day[k] && p[k] && evalLadder(day[k], d.bars, T0, L)[0].state === "vár") { day[k] = { ...p[k], revised: true, from: L }; }
          day.primary = p.primary || day.primary;
        }
        day.rev = true; changed = true;
      }
      if (changed) this.save(key, st);
      this.onChange(key);
    } catch (e) { console.warn("[szezso] terv:", e); }
    finally { this.busy.delete(key); }
  }

  // az összes tárolt terv, számlánként, állapottal (az adatfülhöz is)
  history(key) {
    const d = this.data.get(key);
    if (!d) return [];
    const st = this.store(key), now = Date.now(), out = [];
    for (const day of Object.values(st.days).sort((a, b) => b.T - a.T))
      for (const k of ["long", "short"]) if (day[k])
        out.push({ T: day.T, day: fmtDay.format(day.T), plan: day[k], primary: day.primary === day[k].dir, accounts: evalLadder(day[k], d.bars, day.T, now) });
    return out;
  }

  // a chart rajzai egy számlához (null = Fő)
  items(key, lastT, barSec, account) {
    const ai = Math.max(0, ACC_NAMES.indexOf(account || "Fő"));
    const h = this.history(key), T0 = asiaClose(Date.now()), items = [], bs = barSec * 1000;
    const t2 = lastT + 6 * bs, f = p => +p.toPrecision(6);
    for (const r of h) {
      const a = r.accounts[ai], today = r.T === T0;
      if (!a || (!today && a.state !== "aktív")) continue;   // korábbi napokból csak a még futó (barna)
      const p = r.plan, sd = p.dir > 0 ? "L" : "S", old = !today;
      const t1 = Math.min(Math.max(r.T, lastT - 40 * bs), lastT - 12 * bs), pre = old ? `${r.day} ` : "";
      const w = !old && r.primary ? 3 : 2, base = old ? COL.old : p.dir > 0 ? COL.long : COL.short;
      // a long címkéi a vonal elején (balra), a short címkéi a végén (jobbra), hogy ne takarják egymást
      const rows = [];
      [a.entry, ...a.dca].forEach((l, i) => rows.push({ y: l.p, text: `${pre}${sd}${i ? "DCA" + i : "E"} ${f(l.p)}`, done: i < a.filled, width: i ? Math.max(1, w - 1) : w, style: i ? "dotted" : "solid" }));
      a.tps.forEach((t, i) => rows.push({ y: t.p, text: `${pre}${sd}TP${i + 1} ${f(t.p)}`, done: i < a.tpHit, width: Math.max(1, w - 1), style: "dashed" }));
      rows.sort((x, y) => x.y - y.y);
      let lastY = null, shift = 0;
      for (const row of rows) {
        // egymáshoz nagyon közeli szinteknél a címke vízszintesen elcsúszik
        shift = lastY != null && Math.abs(row.y - lastY) < row.y * 0.004 ? shift + 1 : 0; lastY = row.y;
        const color = row.done ? COL.done : base, text = row.text + (row.done ? " ✓" : "");
        items.push({ type: "line", t1, p1: row.y, t2, p2: row.y, color, width: row.width, style: row.style });
        const lt = p.dir > 0 ? t1 + shift * 9 * bs : t2 - shift * 9 * bs;
        items.push({ type: "label", t: lt, p: row.y, text, color, size: 12, align: p.dir > 0 ? "left" : "right", vAlign: "above", bold: row.width > 2, bg: "rgba(255,255,255,0.85)" });
      }
    }
    return items;
  }
}
