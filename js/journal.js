// Élő napló: a papírkereskedés „befagyasztott” változata. Ami egyszer bekerült, az utólag nem számolódik újra –
// így ez mutatja a rendszer valódi teljesítményét (a „Újraszámolt” nézet a mostani szabályokkal az egész múltat
// újrajátssza, ezért az mindig szebb). Indításkor a mostani újraszámolt állapot (egyenlegek, nyitott pozíciók) a kiinduló.
// Csak a lezárt gyertyák eseményei kerülnek be; minden esemény a szabályverzióval együtt. A tabletre mentődik.
const LS = k => "szezso.journal." + k;
const Q = 900000;

export function keyOf(t) {
  return t.acc === "SB" ? `SB|${t.dir}|${t.wkey}|${t.legs[0].p.toFixed(4)}` : `${t.acc}|${t.dir}|${t.day}|${t.legs[0].p.toFixed(4)}`;
}
export function loadJournal(key) { try { return JSON.parse(localStorage.getItem(LS(key))) || null; } catch { return null; } }
function save(j) { try { localStorage.setItem(LS(j.key), JSON.stringify(j)); } catch (e) { console.warn("napló mentése nem sikerült", e); } }

export function updateJournal(sim, bal, rules) {
  if (!sim) return null;
  const all = [...sim.trades, ...(sim.sb ? sim.sb.trades : [])];
  let cut = Math.floor(Date.now() / Q) * Q;                              // csak a lezárt 15m gyertyák
  if (sim.last) cut = Math.min(cut, sim.last.t);
  if (sim.sb && sim.sb.last) cut = Math.min(cut, Math.floor(sim.sb.last.t / Q) * Q);
  let j = loadJournal(sim.key), dirty = false;
  if (!j) {
    const startBal = { ...bal };
    for (const e of [...sim.events, ...(sim.sb ? sim.sb.events : [])]) if (e.t < cut) startBal[e.acc] = (startBal[e.acc] ?? 0) + e.pnl;
    const pos = [];
    for (const t of all) {
      const fs = t.fills.filter(f => f.t < cut), xs = t.exits.filter(x => x.t < cut);
      const qf = fs.reduce((s, f) => s + f.qty, 0), q = qf - xs.reduce((s, x) => s + x.qty, 0);
      if (q > 1e-9) pos.push({ k: keyOf(t), acc: t.acc, dir: t.dir, w: t.window || null, qty: q, avg: fs.reduce((s, f) => s + f.qty * f.p, 0) / qf, t0: fs[0].t });
    }
    j = { v: 1, key: sim.key, start: cut, lastT: cut, rules: [{ ...rules, from: cut }], startBal, pos, ev: [] };
    dirty = true;
  }
  if (!j.rules.some(r => r.v === rules.v)) { j.rules.push({ ...rules, from: j.lastT }); dirty = true; }
  if (cut > j.lastT) {
    for (const t of all) {
      const k = keyOf(t), w = t.window || null;
      for (const f of t.fills) if (f.t >= j.lastT && f.t < cut) j.ev.push({ t: f.t, k, acc: t.acc, dir: t.dir, w, kind: "fill", p: f.p, qty: f.qty, fee: f.fee, why: f.why, rv: rules.v });
      for (const x of t.exits) if (x.t >= j.lastT && x.t < cut) j.ev.push({ t: x.t, k, acc: t.acc, dir: t.dir, w, kind: "exit", p: x.p, qty: x.qty, fee: x.fee, pnl: x.pnl, why: x.why, rv: rules.v });
    }
    j.ev.sort((a, b) => a.t - b.t);
    j.lastT = cut; dirty = true;
  }
  if (dirty) save(j);
  return j;
}

// a napló kereskedésekké és eseményekké alakítva (a papír-nézet ugyanúgy jeleníti meg, mint az újraszámoltat)
export function journalView(j, sim) {
  if (!j) return null;
  const simBy = new Map([...sim.trades, ...(sim.sb ? sim.sb.trades : [])].map(t => [keyOf(t), t]));
  const byK = new Map(), events = [];
  const get = (k, x) => {
    if (!byK.has(k)) byK.set(k, { k, acc: x.acc, dir: x.dir, window: x.w, fills: [], exits: [], qty: 0, open: 0, cost: 0, avg: null, realized: 0, fees: 0, state: "aktív", closeT: null });
    return byK.get(k);
  };
  for (const p of j.pos) {
    const T = get(p.k, p);
    T.fills.push({ t: p.t0, p: p.avg, qty: p.qty, why: "átvett pozíció (a napló kezdetén)", fee: 0 });
    T.qty += p.qty; T.open += p.qty; T.cost += p.qty * p.avg; T.avg = p.avg; T.carried = true;
  }
  for (const e of j.ev) {
    const T = get(e.k, e);
    if (e.kind === "fill") {
      T.fills.push({ t: e.t, p: e.p, qty: e.qty, why: e.why, fee: e.fee });
      T.qty += e.qty; T.open += e.qty; T.cost += e.qty * e.p; T.avg = T.cost / T.qty; T.fees += e.fee;
      events.push({ t: e.t, acc: e.acc, pnl: -e.fee, why: `${e.acc === "SB" ? "SB " : ""}${e.dir > 0 ? "long" : "short"} ${e.why} díj` });
    } else {
      T.exits.push({ t: e.t, p: e.p, qty: e.qty, why: e.why, pnl: e.pnl, fee: e.fee });
      T.open -= e.qty; T.realized += e.pnl; T.fees += e.fee;
      events.push({ t: e.t, acc: e.acc, pnl: e.pnl - e.fee, why: `${e.acc === "SB" ? "SB " : ""}${e.dir > 0 ? "long" : "short"} ${e.why}` });
      if (T.open <= 1e-9) { T.open = 0; T.state = "lezárva"; T.closeT = e.t; }
    }
  }
  // a még nyitottaknál a TP-k, szerep, stop a mostani szimulációból (ezek élő megbízások, nem múltbeli adatok)
  for (const T of byK.values()) {
    const s = simBy.get(T.k);
    if (!s) { T.orphan = true; continue; }
    Object.assign(T, { tp: s.tp, tps: s.tps, shares: s.shares, tpHit: s.tpHit, role: s.role, stop: s.stop, stopT: s.stopT, legs: s.legs, unit: s.unit, filled: s.filled });
    if (T.state !== "lezárva" && s.avg) T.avg = s.avg;
    if (T.state !== "lezárva" && OPENST.includes(s.state)) T.state = s.state;
  }
  return { trades: [...byK.values()], events, startBal: j.startBal, start: j.start, rules: j.rules };
}
const OPENST = ["aktív", "részben", "védett"];
