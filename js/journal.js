// Élő napló: a papírkereskedés „befagyasztott” változata. Ami egyszer bekerült, az utólag nem számolódik újra –
// így ez mutatja a rendszer valódi teljesítményét (a „Újraszámolt” nézet a mostani szabályokkal az egész múltat
// újrajátssza). Indításkor a v1 szabályokkal újraszámolt teljes múlt (minden teljesülés és zárás) kerül be kiindulásként,
// onnantól csak a lezárt gyertyák új eseményei íródnak hozzá.
// Csak a lezárt gyertyák eseményei kerülnek be; minden esemény a szabályverzióval együtt. A tabletre mentődik.
const LS = k => "szezso.journal." + k;
const Q = 900000;

// Utólagos javítások: technikai hiba miatt kimaradt események pótlása (csak egyszer, jelölve; a szabályok nem változnak)
const FIXES = [
  { id: "2026-11-28-sb-london-long", note: "frissítési hiba miatt kimaradt, pótolva",
    ev: [{"t":1795862100000,"k":"SB|1|207850|62.6955","acc":"SB","dir":1,"w":"London 09–10","kind":"fill","p":62.6955,"qty":40.7,"fee":0.5103,"why":"entry","rv":2.6},
         {"t":1795862700000,"k":"SB|1|207850|62.6955","acc":"SB","dir":1,"w":"London 09–10","kind":"fill","p":62.148,"qty":40.7,"fee":0.5059,"why":"DCA1","rv":2.6},
         {"t":1795863300000,"k":"SB|1|207850|62.6955","acc":"SB","dir":1,"w":"London 09–10","kind":"exit","p":62.5643,"qty":81.4,"fee":1.0185,"pnl":11.6049,"why":"TP","rv":2.6}] },
];
const DIAG_MAX = 300;

export function keyOf(t) {
  return t.acc === "SB" ? `SB|${t.dir}|${t.wkey}|${t.legs[0].p.toFixed(4)}` : `${t.acc}|${t.dir}|${t.day}|${t.legs[0].p.toFixed(4)}`;
}
export function loadJournal(key) { try { return JSON.parse(localStorage.getItem(LS(key))) || null; } catch { return null; } }
function save(j) { try { localStorage.setItem(LS(j.key), JSON.stringify(j)); } catch (e) { console.warn("napló mentése nem sikerült", e); } }

export function updateJournal(sim, bal, rules) {
  if (!sim) return null;
  const all = [...sim.trades, ...(sim.sb ? sim.sb.trades : []), ...(sim.rsi ? sim.rsi.trades : [])];
  let cut = Math.floor(Date.now() / Q) * Q;                              // csak a lezárt 15m gyertyák
  if (sim.last) cut = Math.min(cut, sim.last.t);
  if (sim.sb && sim.sb.last) cut = Math.min(cut, Math.floor(sim.sb.last.t / Q) * Q);
  let j = loadJournal(sim.key), dirty = false;
  // újraindítás: régi formátum, vagy hibajavítás miatti újraszámolás (a szabályverzió reset-száma nő)
  if (j && (j.v !== 2 || (j.reset || 0) < (rules.reset || 0))) j = null;
  if (!j) {
    // indítás: a v1 szabályokkal újraszámolt múlt minden eseménye bekerül (ez a kiinduló), az egyenlegek a beállítottak
    j = { v: 2, reset: rules.reset || 0, key: sim.key, start: cut, lastT: 0, rules: [{ ...rules, from: cut }], startBal: { ...bal }, pos: [], ev: [], fixes: FIXES.map(f => f.id), diag: [] };
    dirty = true;                                                       // indításkor a teljes múlt bekerül: a javítások feleslegesek
  }
  if (!j.fixes) j.fixes = [];
  if (!j.diag) j.diag = [];
  for (const f of FIXES) {
    if (j.fixes.includes(f.id)) continue;
    j.fixes.push(f.id); dirty = true;
    if (sim.key !== "HYPE" || f.ev.some(e => e.t < j.start) || j.ev.some(e => e.k === f.ev[0].k)) continue;   // a napló kezdete előtti, vagy már benne van
    for (const e of f.ev) j.ev.push({ ...e, fix: f.note });
    j.ev.sort((a, b) => a.t - b.t);
  }
  if (!j.rules.some(r => r.v === rules.v)) { j.rules.push({ ...rules, from: j.lastT }); dirty = true; }
  const seen = { g: sim.trades.filter(t => t.fills.length).length, sb: sim.sb ? sim.sb.trades.filter(t => t.fills.length).length : 0, rsi: sim.rsi ? sim.rsi.trades.filter(t => t.fills.length).length : 0 };
  const n0 = j.ev.length;
  if (cut > j.lastT) {
    const from = j.lastT;
    for (const t of all) {
      const k = keyOf(t), w = t.window || null;
      for (const f of t.fills) if (f.t >= from && f.t < cut) j.ev.push({ t: f.t, k, acc: t.acc, dir: t.dir, w, kind: "fill", p: f.p, qty: f.qty, fee: f.fee, why: f.why, rv: rules.v });
      for (const x of t.exits) if (x.t >= from && x.t < cut) j.ev.push({ t: x.t, k, acc: t.acc, dir: t.dir, w, kind: "exit", p: x.p, qty: x.qty, fee: x.fee, pnl: x.pnl, why: x.why, rv: rules.v });
    }
    j.ev.sort((a, b) => a.t - b.t);
    j.lastT = cut; dirty = true;
  }
  // diagnosztika: mikor, melyik lezárt gyertyáig, hány (teljesült) kereskedést látott, és hány esemény került be
  const dl = j.diag[j.diag.length - 1], last5 = sim.sb && sim.sb.last ? sim.sb.last.t : null;
  if (!dl || dl.cut !== cut || dl.g !== seen.g || dl.sb !== seen.sb || dl.rsi !== seen.rsi || j.ev.length !== n0) {
    j.diag.push({ at: Date.now(), cut, last15: sim.last ? sim.last.t : null, last5, ...seen, add: j.ev.length - n0 });
    if (j.diag.length > DIAG_MAX) j.diag.splice(0, j.diag.length - DIAG_MAX);
    dirty = true;
  }
  if (dirty) save(j);
  return j;
}

// a napló kereskedésekké és eseményekké alakítva (a papír-nézet ugyanúgy jeleníti meg, mint az újraszámoltat)
export function journalView(j, sim) {
  if (!j) return null;
  const simBy = new Map([...sim.trades, ...(sim.sb ? sim.sb.trades : []), ...(sim.rsi ? sim.rsi.trades : [])].map(t => [keyOf(t), t]));
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
      T.fills.push({ t: e.t, p: e.p, qty: e.qty, why: e.why + (e.fix ? " (javítás)" : ""), fee: e.fee }); if (e.fix) T.fixed = e.fix;
      T.qty += e.qty; T.open += e.qty; T.cost += e.qty * e.p; T.avg = T.cost / T.qty; T.fees += e.fee;
      events.push({ t: e.t, acc: e.acc, pnl: -e.fee, why: `${pfx(e)}${e.dir > 0 ? "long" : "short"} ${e.why} díj${e.fix ? " (javítás)" : ""}` });
    } else {
      T.exits.push({ t: e.t, p: e.p, qty: e.qty, why: e.why, pnl: e.pnl, fee: e.fee });
      T.open -= e.qty; T.realized += e.pnl; T.fees += e.fee;
      events.push({ t: e.t, acc: e.acc, pnl: e.pnl - e.fee, why: `${pfx(e)}${e.dir > 0 ? "long" : "short"} ${e.why}${e.fix ? " (javítás: " + e.fix + ")" : ""}` });
      if (T.open <= 1e-9) { T.open = 0; T.state = "lezárva"; T.closeT = e.t; }
    }
  }
  // a még nyitottaknál a TP-k, szerep, stop a mostani szimulációból (ezek élő megbízások, nem múltbeli adatok)
  for (const T of byK.values()) {
    const s = simBy.get(T.k);
    if (!s) { T.orphan = true; continue; }
    Object.assign(T, { tp: s.tp, tps: s.tps, shares: s.shares, tpHit: s.tpHit, role: s.role, stop: s.stop, stopT: s.stopT, legs: s.legs, unit: s.unit, filled: s.filled, iso: s.iso, margin: s.margin, ext: s.ext });
    if (T.state !== "lezárva" && s.avg) T.avg = s.avg;
    if (T.state !== "lezárva" && OPENST.includes(s.state)) T.state = s.state;
  }
  return { trades: [...byK.values()], events, startBal: j.startBal, start: j.start, rules: j.rules };
}
const pfx = e => e.w === "Extrém izo" ? "Extrém izo " : e.w === "RSI" ? "RSI " : e.acc === "SB" ? "SB " : "";
const OPENST = ["aktív", "részben", "védett"];
