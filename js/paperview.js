// Papírkereskedés fül (a TradingView papírkereskedése mintájára), HYPE: a folyamatos rács végigjátszott
// kereskedései számlánként – pozíciók, megbízások, lezárt kereskedések, egyenlegtörténet, elemzés, egyenlegek.
import { ACC_NAMES } from "./grid.js";
import { getPref, setPref } from "./store.js";
import { DEFAULT_BAL, ALL_ACC } from "./plans.js";

const fmtT = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usd = (x, sign = true) => !isFinite(x) ? "–" : `${sign && x >= 0 ? "+" : ""}${x.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const cls = x => x >= 0 ? "up" : "dn";
const OPEN = ["aktív", "részben", "védett"];
let acc = "Összes", sub = "pos", mode = "all";

export function renderPaper(el, plans, key, rerender) {
  const sim = plans.sim(key), bal = plans.balances(), f = x => (+x).toFixed(3);
  if (!sim) { el.innerHTML = `<p class="muted">Adatok betöltése…</p>`; return; }
  const sb = mode === "sb", all = mode === "all", sbs = sim.sb || { trades: [], events: [] };
  const src = sb ? sbs : all ? { trades: [...sim.trades, ...sbs.trades], events: [...sim.events, ...sbs.events].sort((a, b) => a.t - b.t) } : sim;
  const mine = t => sb || all || acc === "Összes" || t.acc === acc;
  const trades = src.trades.filter(mine), events = src.events.filter(e => sb || all || acc === "Összes" || e.acc === acc);
  const start = sb ? bal.SB : all ? ALL_ACC.reduce((s, a) => s + bal[a], 0) : acc === "Összes" ? ACC_NAMES.reduce((s, a) => s + bal[a], 0) : bal[acc];
  const realized = events.reduce((s, e) => s + e.pnl, 0);
  const open = trades.filter(t => OPEN.includes(t.state) && t.open > 0), last = sim.last ? sim.last.c : NaN;
  const unreal = open.reduce((s, t) => s + t.dir * (last - t.avg) * t.open, 0);
  const margin = open.reduce((s, t) => s + t.avg * t.open / 10, 0);
  const o = [];
  o.push(`<p style="float:right"><button data-export="1">⇩ Export (elemzéshez)</button></p>`);
  o.push(`<h2>Papírkereskedés – HYPE</h2><p class="muted">A rendszer szabályai szerint, automatikusan (a 15 perces gyertyákon végigjátszva). Kezdés: ${sim.days[0] ? fmtT.format(sim.days[0].T) : "–"}.</p>`);
  // a rács és a silver bullet külön: így a rácsos kereskedés statisztikája tiszta marad
  o.push(`<div class="ptabs"><button data-mode="all" class="${all ? "on" : ""}">Összesen (rács + SB)</button><button data-mode="grid" class="${mode === "grid" ? "on" : ""}">Rács (cross)</button><button data-mode="sb" class="${sb ? "on" : ""}">Silver bullet (SB számla)</button></div>`);
  if (sb) o.push(`<p class="muted">A 7. („SB”) számlán, cross-ban. Ablakok (NY): 03–04, 10–11, 14–15 (Budapest: 09–10, 16–17, 20–21). Belépő a fals mozdulat végén, az 5m FVG-nél; 3 DCA; TP a kiindulópont felé eső Milana-szinten, ha nem jön össze, a következő ablakhoz igazodik.</p>`);
  else if (!all) o.push(`<div class="ptabs">${["Összes", ...ACC_NAMES].map(a => `<button data-acc="${a}" class="${a === acc ? "on" : ""}">${a}</button>`).join("")}</div>`);
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
      return [t.acc + (t.window ? " " + t.window : ""), side(t), t.open.toFixed(1), f(t.avg), f(last), `<span class="${cls(u)}">${usd(u)}</span>`, `${(u / (t.avg * t.open / 10) * 100).toFixed(2)}%`,
        usd(t.avg * t.open, false), usd(t.avg * t.open / 10, false), t.acc === "SB" ? "TP " + f(t.tp.p) : roleTxt(t), t.stop != null ? f(t.stop) : "–"];
    }), "Nincs nyitott pozíció."));
  } else if (sub === "ord") {
    const rows = [];
    for (const t of trades) {
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
    o.push(`<h3>Kumulált PnL</h3>` + spark(pts, start));
  } else if (sub === "set") {
    o.push(`<p>Számlánkénti kezdőegyenleg (alapból ${DEFAULT_BAL.toLocaleString("hu-HU")} $, 7 számla, összesen 102 000 $; az SB a silver bullet számlája, mind cross). A méretezés ebből számol: 70 $-os esés (long, legfeljebb 0-ig) vagy emelkedés (short) se likvidálja a számlát, mind a 4 láb kitelve.</p>`);
    o.push(`<table>${ALL_ACC.map(a => `<tr><th>${a}</th><td><input type="number" step="100" min="0" data-bal="${a}" value="${bal[a]}"> $</td></tr>`).join("")}</table>`);
    const rm = getPref("paper.remMode", "a");
    o.push(`<h3>Részben zárt kereskedés DCA-ja (a maradék kiegészítése)</h3>` + [["a", "a) az első DCA az eredeti entry + DCA1 méretére egészít ki"], ["b", "b) az első DCA az eredeti entry méretére egészít ki"], ["c", "c) az első DCA a maradék méretével, utána duplázva"]]
      .map(([k, l]) => `<label style="display:block;margin:4px 0"><input type="radio" name="rm" value="${k}" ${rm === k ? "checked" : ""}> ${l}</label>`).join("") + `<p class="muted">Utána mindhárom a szokásos duplázással megy: minden további DCA a nyitott mérettel egyenlő.</p>`);
    o.push(`<p><button data-save="1">Mentés</button></p>`);
  }
  el.innerHTML = o.join("");
  el.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { mode = b.dataset.mode; rerender(); });
  el.querySelectorAll("[data-acc]").forEach(b => b.onclick = () => { acc = b.dataset.acc; rerender(); });
  el.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => { sub = b.dataset.sub; rerender(); });
  const ex = el.querySelector("[data-export]");
  if (ex) ex.onclick = () => exportAll(plans);
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
      silverBullet: s && s.sb ? { trades: s.sb.trades, events: s.sb.events } : null,
      last: s && s.last,
      drawings: (() => { try { return JSON.parse(localStorage.getItem("szezso.draw." + key)) || []; } catch { return []; } })(),
    };
  }
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const a = document.createElement("a"), d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `szezso-export-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

