// Papírkereskedés fül (a TradingView papírkereskedése mintájára), HYPE: a folyamatos rács végigjátszott
// kereskedései számlánként – pozíciók, megbízások, lezárt kereskedések, egyenlegtörténet, elemzés, egyenlegek.
import { ACC_NAMES } from "./grid.js";
import { getPref, setPref } from "./store.js";
import { DEFAULT_BAL, ALL_ACC, SWAN, RULES } from "./plans.js";
import { updateJournal, journalView, loadJournal } from "./journal.js";

const fmtT = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usd = (x, sign = true) => !isFinite(x) ? "–" : `${sign && x >= 0 ? "+" : ""}${x.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const cls = x => x >= 0 ? "up" : "dn";
const OPEN = ["aktív", "részben", "védett"];
let acc = "Összes", sub = "pos", mode = "all", view = "naplo";

export function renderPaper(el, plans, key, rerender) {
  const sim = plans.sim(key), bal = plans.balances(), f = x => (+x).toFixed(3);
  if (!sim) { el.innerHTML = `<p class="muted">Adatok betöltése…</p>`; return; }
  const ext = mode === "ext", sb = mode === "sb" || ext, all = mode === "all", sbs = sim.sb || { trades: [], events: [] };
  // élő napló (befagyasztott) vagy újraszámolt (a mostani szabályokkal az egész múlt)
  const jv = journalView(updateJournal(sim, bal, RULES), sim), J = view === "naplo" && !!jv;
  const gT = J ? jv.trades.filter(t => t.acc !== "SB") : sim.trades, sT = J ? jv.trades.filter(t => t.acc === "SB") : sbs.trades;
  const gE = J ? jv.events.filter(e => e.acc !== "SB") : sim.events, sE = J ? jv.events.filter(e => e.acc === "SB") : sbs.events;
  const B = J ? { ...bal, ...jv.startBal } : bal;
  const isExt = t => !!t.ext || t.window === "Extrém izo";
  const extE = e => /^Extrém izo/.test(e.why || "");
  const src = ext ? { trades: sT.filter(isExt), events: sE.filter(extE) } : sb ? { trades: sT.filter(t => !isExt(t)), events: sE.filter(e => !extE(e)) } : all ? { trades: [...gT, ...sT], events: [...gE, ...sE].sort((a, b) => a.t - b.t) } : { trades: gT, events: gE };
  const mine = t => sb || all || acc === "Összes" || t.acc === acc;
  const trades = src.trades.filter(mine), events = src.events.filter(e => sb || all || acc === "Összes" || e.acc === acc);
  const ordTrades = (ext ? sbs.trades.filter(isExt) : sb ? sbs.trades.filter(t => !isExt(t)) : all ? [...sim.trades, ...sbs.trades] : sim.trades).filter(mine);     // élő megbízások: mindig a mostani szabályokból
  const start = sb ? B.SB : all ? ALL_ACC.reduce((s, a) => s + B[a], 0) : acc === "Összes" ? ACC_NAMES.reduce((s, a) => s + B[a], 0) : B[acc];
  const haltOn = [sim.halts, sbs.halts].some(h => h && h.length && h[h.length - 1].on);
  const realized = events.reduce((s, e) => s + e.pnl, 0);
  const open = trades.filter(t => OPEN.includes(t.state) && t.open > 0), last = sim.last ? sim.last.c : NaN;
  const unreal = open.reduce((s, t) => s + t.dir * (last - t.avg) * t.open, 0);
  const mg = t => t.iso && t.margin ? t.margin : t.avg * t.open / 10;      // izolált: a lekötött (kiegészített) margin
  const margin = open.reduce((s, t) => s + mg(t), 0);
  const o = [];
  o.push(`<p style="float:right"><button data-export="1">⇩ Export (elemzéshez)</button> <button data-export-data="1" title="A gyertyák, tervek és beállítások – ezzel a valódi napokon tesztelhetők a szabályok">⇩ Adat export (teszthez)</button></p>`);
  o.push(`<h2>Papírkereskedés – HYPE</h2>`);
  o.push(`<div class="ptabs"><button data-view="naplo" class="${J ? "on" : ""}">Élő napló</button><button data-view="ujra" class="${!J ? "on" : ""}">Újraszámolt (szabályteszt)</button></div>`);
  o.push(`<p class="muted">Szabályverzió: v${RULES.v} (${RULES.date}). ${J ? `Napló indult: ${fmtT.format(jv.start)} (előtte a v1 szabályokkal újraszámolt múlt a kiinduló) – ami bekerült, nem számolódik újra.` : `A mostani szabályokkal újrajátszva ${sim.days[0] ? fmtT.format(sim.days[0].T) : "–"} óta (szebb, mint a valóság).`}</p>`);
  if (haltOn) o.push(`<p style="background:#FFEBEE;color:#B71C1C;padding:6px 10px;border-radius:6px"><b>VÉSZFÉK:</b> a fiók saját tőkéje 20 %-nál többet esett – új belépő nincs, csak a meglévők kezelése.</p>`);
  // a rács és a silver bullet külön: így a rácsos kereskedés statisztikája tiszta marad
  o.push(`<div class="ptabs"><button data-mode="all" class="${all ? "on" : ""}">Összesen (rács + SB)</button><button data-mode="grid" class="${mode === "grid" ? "on" : ""}">Rács (cross)</button><button data-mode="sb" class="${sb && !ext ? "on" : ""}">Silver bullet (SB számla)</button><button data-mode="ext" class="${ext ? "on" : ""}">Extrém izo (SB számla)</button></div>`);
  if (ext) {
    const x = sbs.extNow, v = n => n == null || !isFinite(n) ? "–" : Math.round(n);
    const near = x && ((x.r15 < 30 && x.r1h < 30) || (x.r15 > 70 && x.r1h > 70));
    o.push(`<p class="muted">Jel: long, ha a 15m és az 1h RSI < 20 és a 15m J < 0; short, ha RSI > 80 és J > 100 (Ázsiában is). Izolált, a margin ≤ az SB tőke 10 %-a (+20 $ védelem), 2 DCA, zárás a vastag vonalnál vagy az RSI/KDJ megállításakor.</p>`);
    o.push(`<p>Most (utolsó lezárt gyertyák): 15m RSI <b>${v(x && x.r15)}</b> · 1h RSI <b>${v(x && x.r1h)}</b> · 15m J <b>${v(x && x.j15)}</b>${near ? " – <b>közel az extrém zónához</b>" : ""}</p>`);
  }
  if (!sb && !all) o.push(`<div class="ptabs">${["Összes", ...ACC_NAMES].map(a => `<button data-acc="${a}" class="${a === acc ? "on" : ""}">${a}</button>`).join("")}</div>`);
  o.push(`<div class="cards">` + [
    ["Egyenleg", usd(start + realized, false)], ["Saját tőke (equity)", usd(start + realized + unreal, false)],
    ["Nem realizált PnL", `<span class="${cls(unreal)}">${usd(unreal)}</span>`], ["Realizált PnL", `<span class="${cls(realized)}">${usd(realized)}</span>`],
    ["Lekötött margin (10×)", usd(margin, false)], ["Margin-tartalék", `${start + realized + unreal > 0 ? (100 - margin / (start + realized + unreal) * 100).toFixed(2) : "–"}%`],
  ].map(([a, b]) => `<div class="card"><div class="muted">${a}</div><div class="v">${b}</div></div>`).join("") + `</div>`);
  const SUBS = [["pos", `Pozíciók ${open.length}`], ["ord", "Megbízások"], ["hist", "Kereskedések"], ["bal", "Egyenlegtörténet"], ["ana", "Elemzés"], ["set", "Egyenlegek"]];
  o.push(`<div class="ptabs">${SUBS.map(([k, l]) => `<button data-sub="${k}" class="${k === sub ? "on" : ""}">${l}</button>`).join("")}</div>`);

  if (sub === "pos") {
    o.push(table(["Számla", "Irány", "Menny.", "Átlagár", "Utolsó ár", "Nem real. PnL", "%", "Érték", "Margin", "Szerep", "SL+"], open.map(t => {
      const u = t.dir * (last - t.avg) * t.open;
      return [t.acc + (t.window ? " " + t.window : ""), side(t), t.open.toFixed(1), f(t.avg), f(last), `<span class="${cls(u)}">${usd(u)}</span>`, `${(u / mg(t) * 100).toFixed(2)}%`,
        usd(t.avg * t.open, false), usd(mg(t), false) + (t.iso ? " (izo)" : ""), t.acc === "SB" ? (t.tp ? "TP " + f(t.tp.p) : "–") : roleTxt(t), t.stop != null ? f(t.stop) : "–"];
    }), "Nincs nyitott pozíció."));
  } else if (sub === "ord") {
    const rows = [];
    for (const t of ordTrades) {
      if (t.state === "vár" || (t.state === "aktív" && !t.exits.length)) t.legs.forEach((l, i) => { if (i >= t.filled) rows.push([t.acc, t.dir > 0 ? "Vétel" : "Eladás", "Limit", (l.units * t.unit).toFixed(1), f(l.p), i ? "DCA" + i : "entry", fmtT.format(t.from)]); });
      if (OPEN.includes(t.state) && t.tps) t.tps.forEach((x, i) => { if (t.shares[i] && !t.tpHit.includes(i)) rows.push([t.acc, t.dir > 0 ? "Eladás" : "Vétel", "Limit (TP)", (t.qty * t.shares[i]).toFixed(1), f(x.p), (i < 3 ? "TP" + (i + 1) : "swing") + " · " + esc(x.why), "–"]); });
      if (OPEN.includes(t.state) && t.stop != null) rows.push([t.acc, t.dir > 0 ? "Eladás" : "Vétel", "Stop", t.open.toFixed(1), f(t.stop), "pozitív stop", fmtT.format(t.stopT)]);
    }
    o.push(table(["Számla", "Oldal", "Típus", "Menny.", "Ár", "Mi", "Elhelyezve"], rows, "Nincs élő megbízás."));
  } else if (sub === "hist") {
    const done = trades.filter(t => t.state === "lezárva" && t.fills.length).sort((a, b) => b.closeT - a.closeT);
    o.push(table(["Számla", "Irány", "Nyitás", "Zárás", "Menny.", "Átlagár", "Zárások", "Díj", "Nettó"], done.map(t => {
      const net = t.realized - t.fees;
      return [t.acc + (t.window ? " " + t.window : ""), side(t), fmtT.format(t.fills[0].t), fmtT.format(t.closeT), t.qty.toFixed(1), f(t.avg),
        t.exits.map(e => `${esc(e.why)} ${f(e.p)} × ${e.qty.toFixed(1)}`).join("<br>"), usd(-t.fees), `<span class="${cls(net)}">${usd(net)}</span>`];
    }), "Még nincs lezárt kereskedés."));
  } else if (sub === "bal") {
    let b = start; const rows = events.map(e => { b += e.pnl; return [fmtT.format(e.t), e.acc, esc(e.why), `<span class="${cls(e.pnl)}">${usd(e.pnl)}</span>`, usd(b, false)]; }).reverse();
    o.push(table(["Idő", "Számla", "Esemény", "Realizált", "Egyenleg utána"], rows, "Még nincs esemény."));
  } else if (sub === "ana") {
    const done = trades.filter(t => t.state === "lezárva"), nets = done.map(t => t.realized - t.fees);
    const win = nets.filter(x => x > 0).length, gp = nets.filter(x => x > 0).reduce((s, x) => s + x, 0), gl = -nets.filter(x => x < 0).reduce((s, x) => s + x, 0);
    let cum = 0, peak = 0, dd = 0; const pts = events.map(e => { cum += e.pnl; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); return [e.t, cum]; });
    o.push(`<div class="cards">` + [
      ["Nyereséges kereskedések", done.length ? `${(win / done.length * 100).toFixed(2)}% (${win}/${done.length})` : "–"],
      ["Profit factor", gl > 0 ? (gp / gl).toFixed(3) : gp > 0 ? "∞" : "–"],
      ["Összes nettó", usd(cum)], ["Legnagyobb visszaesés", usd(-dd)],
      ["Hozam a kezdőtőkére", `${(cum / start * 100).toFixed(2)}%`],
    ].map(([a, b]) => `<div class="card"><div class="muted">${a}</div><div class="v">${b}</div></div>`).join("") + `</div>`);
    // szakaszonként: melyik hozza a pénzt, melyik csak a kockázatot
    const secOf = t => t.acc !== "SB" ? "Rács" : (t.window || "SB").replace(/\s[\d:–]+$/, "");
    const secs = [...new Set(done.map(secOf))];
    const hrs = x => x >= 24 ? (x / 24).toFixed(1) + " nap" : x.toFixed(1) + " óra";
    o.push(`<h3>Szakaszonként</h3>` + table(["Szakasz", "Db", "Nyerő %", "Átl. nyerő", "Átl. vesztő", "Profit factor", "Nettó", "Átl. idő bent"], secs.map(k => {
      const ts = done.filter(t => secOf(t) === k), n = ts.map(t => t.realized - t.fees), w = n.filter(x => x > 0), l = n.filter(x => x <= 0);
      const sw = w.reduce((a, x) => a + x, 0), sl = -l.reduce((a, x) => a + x, 0), tm = ts.reduce((a, t) => a + (t.closeT - t.fills[0].t), 0) / ts.length / 3600000;
      return [k, ts.length, `${(w.length / ts.length * 100).toFixed(0)}%`, w.length ? usd(sw / w.length) : "–", l.length ? usd(-sl / l.length) : "–", sl > 0 ? (sw / sl).toFixed(2) : sw > 0 ? "∞" : "–", `<span class="${cls(sw - sl)}">${usd(sw - sl)}</span>`, hrs(tm)];
    }), "Még nincs lezárt kereskedés."));
    o.push(`<h3>Kumulált PnL</h3>` + spark(pts, start));
  } else if (sub === "set") {
    o.push(`<p>Számlánkénti kezdőegyenleg (alapból ${DEFAULT_BAL.toLocaleString("hu-HU")} $, 7 számla, összesen 102 000 $; az SB a silver bullet számlája, mind cross). A méretezés ebből számol: ${SWAN} $-os esés (long, legfeljebb 0-ig) vagy emelkedés (short) se likvidálja a számlát, mind a 4 láb kitelve.</p>`);
    o.push(`<table>${ALL_ACC.map(a => `<tr><th>${a}</th><td><input type="number" step="100" min="0" data-bal="${a}" value="${bal[a]}"> $</td></tr>`).join("")}</table>`);
    const rm = getPref("paper.remMode", "a");
    o.push(`<h3>Részben zárt kereskedés DCA-ja (a maradék kiegészítése)</h3>` + [["a", "a) az első DCA az eredeti entry + DCA1 méretére egészít ki"], ["b", "b) az első DCA az eredeti entry méretére egészít ki"], ["c", "c) az első DCA a maradék méretével, utána duplázva"]]
      .map(([k, l]) => `<label style="display:block;margin:4px 0"><input type="radio" name="rm" value="${k}" ${rm === k ? "checked" : ""}> ${l}</label>`).join("") + `<p class="muted">Utána mindhárom a szokásos duplázással megy: minden további DCA a nyitott mérettel egyenlő.</p>`);
    o.push(`<p><button data-save="1">Mentés</button></p>`);
  }
  el.innerHTML = o.join("");
  el.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { view = b.dataset.view; rerender(); });
  el.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { mode = b.dataset.mode; rerender(); });
  el.querySelectorAll("[data-acc]").forEach(b => b.onclick = () => { acc = b.dataset.acc; rerender(); });
  el.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => { sub = b.dataset.sub; rerender(); });
  const ex = el.querySelector("[data-export]");
  if (ex) ex.onclick = () => exportAll(plans);
  const exd = el.querySelector("[data-export-data]");
  if (exd) exd.onclick = () => exportData(plans);
  const sv = el.querySelector("[data-save]");
  if (sv) sv.onclick = () => {
    const nb = {}; el.querySelectorAll("[data-bal]").forEach(i => nb[i.dataset.bal] = Math.max(0, +i.value || DEFAULT_BAL));
    setPref("paper.bal", nb);
    const r = el.querySelector('input[name="rm"]:checked'); if (r) setPref("paper.remMode", r.value);
    plans.runSim(key); rerender();
  };
}

const side = t => `<span class="${t.dir > 0 ? "up" : "dn"}">${t.dir > 0 ? "Long" : "Short"}</span>`;
const roleTxt = t => ({ full: "egyben TP1", split: "50/30/20", swing: "swing" }[t.role] || "–");
function table(head, rows, empty) {
  if (!rows.length) return `<p class="muted">${empty}</p>`;
  return `<table class="plan"><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
}
// egyszerű vonaldiagram (SVG) a kumulált PnL-ről
function spark(pts, start) {
  if (pts.length < 2) return `<p class="muted">Még kevés az adat.</p>`;
  const W = 640, Hh = 180, t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  const ys = pts.map(p => p[1]), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys) || 1;
  const X = t => 40 + (t - t0) / Math.max(1, t1 - t0) * (W - 50), Y = v => 10 + (hi - v) / (hi - lo || 1) * (Hh - 30);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${W} ${Hh}" style="max-width:${W}px;width:100%;background:#fafafa;border-radius:6px">
    <line x1="40" x2="${W - 10}" y1="${Y(0)}" y2="${Y(0)}" stroke="#ccc"/>
    <path d="${d}" fill="none" stroke="#2962FF" stroke-width="2"/>
    <text x="4" y="${Y(hi) + 4}" font-size="11" fill="#555">${hi.toFixed(0)} $</text>
    <text x="4" y="${Y(lo) + 4}" font-size="11" fill="#555">${lo.toFixed(0)} $</text>
    <text x="${W - 10}" y="${Hh - 4}" font-size="11" text-anchor="end" fill="#555">${(ys[ys.length - 1] / start * 100).toFixed(2)}%</text></svg>`;
}

// minden adat egy fájlba (ezt lehet csatolni a beszélgetésbe elemzéshez): tervek, kereskedések, események, rajzok
function exportAll(plans) {
  const out = { exported: new Date().toISOString(), app: "szezso", balances: plans.balances(), instruments: {} };
  for (const key of plans.data.keys()) {
    const s = plans.sim(key), st = plans.store(key);
    out.instruments[key] = {
      days: st.days,
      trades: s ? s.trades.map(t => { const { plan, ...rest } = t; return { ...rest, planDay: t.day, planDir: plan.dir }; }) : [],
      events: s ? s.events : [],
      journal: loadJournal(key),
      rules: RULES,
      silverBullet: s && s.sb ? { trades: s.sb.trades.map(({ L, ...t }) => t), events: s.sb.events, windows: s.sb.windows } : null,
      last: s && s.last,
      drawings: (() => { try { return JSON.parse(localStorage.getItem("szezso.draw." + key)) || []; } catch { return []; } })(),
    };
  }
  download(out, "szezso-export");
}
// tesztadat: a nyers gyertyák (5m, 15m, 1h, 4h, 1D), a tervek, beállítások és rajzok – ebből a szimuláció pontosan visszajátszható
function exportData(plans) {
  const out = { exported: new Date().toISOString(), app: "szezso", kind: "testdata", rules: RULES, balances: plans.balances(),
    prefs: { remMode: getPref("paper.remMode", "a") }, instruments: {} };
  for (const [key, d] of plans.data.entries()) {
    out.instruments[key] = { inst: plans.insts[key], days: plans.store(key).days, bars5: d.bars5 || [], bars15: d.bars15, bars1h: d.bars, bars4h: d.bars4, daily: d.daily,
      drawings: (() => { try { return JSON.parse(localStorage.getItem("szezso.draw." + key)) || []; } catch { return []; } })(), journal: loadJournal(key) };
  }
  download(out, "szezso-tesztadat");
}
function download(out, name) {
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const a = document.createElement("a"), d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

