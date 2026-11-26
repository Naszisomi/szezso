// Adatfül (HYPE / BTC / BNB adatok): a napi tervek számlánként, az előző napok, az ICT-forgatókönyvek és
// -értékelések, az indikátorok és a Gann-naptár – szövegesen, hogy a chart tiszta maradhasson.
const fmtT = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtD = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short", day: "numeric" });
const STATE = { "vár": "vár", "aktív": "aktív", "részben": "részben zárva", "védett": "pozitív stoppal", "lezárva": "lezárva", "lejárt": "lejárt" };
const ROLE = { full: "egyben zár (TP1)", split: "50/30/20 + SL+", swing: "swing (TP2/TP3/1D)" };
export const money = (x, sim) => x == null || !isFinite(x) ? "–" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}${sim && sim.hype ? " $" : ""}`;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = x => x == null || isNaN(x) ? "–" : Math.round(x * 100) + "%";

export function biasText(info, f) {
  if (!info || !info.bias || !info.bias.dir) return "";
  const b = info.bias;
  return `${b.dir > 0 ? "Bull" : "Bear"} – célár: ${b.target != null ? f(b.target) : "–"}`;
}

export function renderData(el, key, inst, plans) {
  const d = plans.data.get(key), info = d && d.info, hist = plans.history(key), sim = plans.sim(key);
  const dec = String(inst.tick).includes(".") ? String(inst.tick).split(".")[1].length : 0;
  const f = x => x == null || !isFinite(x) ? "–" : (+x).toFixed(dec);
  const out = [];
  const last = d && d.bars.length ? d.bars[d.bars.length - 1] : null;
  out.push(`<h2>${esc(inst.name)}</h2>`);
  out.push(`<p class="big">${last ? "Ár: <b>" + f(last.c) + "</b>" : "Adatok betöltése…"}${info && info.bias.dir ? ` · <b class="${info.bias.dir > 0 ? "up" : "dn"}">${esc(biasText(info, f))}</b> <span class="muted">(${esc(info.bias.src)})</span>` : ""}</p>`);

  // napi tervek számlánként (a folyamatos rács kereskedései)
  const today = hist.length ? hist.filter(r => r.T === hist[0].T) : [];
  if (!hist.length) out.push(`<p class="muted">Még nincs rögzített terv (az Ázsia vége után, 06:00-kor készül).</p>`);
  for (const r of today) out.push(planTable(r, f, true, sim));
  const running = sim ? sim.trades.filter(t => t.day !== (hist[0] && hist[0].T) && ["aktív", "részben", "védett"].includes(t.state)) : [];
  if (running.length) out.push(`<h3>Korábbi napokról még futó kereskedések</h3>` + tradeTable(running, f, sim, true));
  const prev = hist.filter(r => !today.includes(r));
  if (prev.length) {
    out.push(`<h3>Előző napok</h3><table><tr><th>Nap</th><th>Irány</th><th>Alap entry</th><th>Kereskedések</th><th>Nettó eredmény</th></tr>`);
    for (const r of prev) {
      const net = r.trades.reduce((s, t) => s + t.realized - t.fees, 0), cnt = {};
      for (const t of r.trades) cnt[t.state] = (cnt[t.state] || 0) + 1;
      out.push(`<tr><td>${esc(r.day)}</td><td class="${r.plan.dir > 0 ? "up" : "dn"}">${r.plan.dir > 0 ? "LONG" : "SHORT"}</td><td>${f(r.plan.entry.p)}</td>` +
        `<td>${Object.entries(cnt).map(([k, v]) => `${v} ${esc(STATE[k] || k)}`).join(", ")}</td><td>${money(net, sim)}</td></tr>`);
    }
    out.push(`</table>`);
  }

  // ICT
  if (info && info.nr && info.nr.scenarios && info.nr.scenarios.length) {
    out.push(`<h3>ICT-forgatókönyvek (ma, 1h)</h3><ol>`);
    for (const s of info.nr.scenarios) out.push(`<li><b>${esc(s.title)}</b> ${s.dir > 0 ? "↑" : s.dir < 0 ? "↓" : "↔"} · esély ${pct(s.prob)}` +
      `${s.target != null ? ` · cél ${f(s.target)}${s.tag ? " (" + esc(s.tag) + ")" : ""}` : ""}${s.votes ? " · " + esc(s.votes.text) + (s.votes.names ? " (" + esc(s.votes.names.join(", ")) + ")" : "") : ""}</li>`);
    out.push(`</ol>`);
  }
  if (info && info.nrPast && info.nrPast.length) {
    out.push(`<h3>ICT-értékelések (előző napok)</h3><ul>`);
    for (const p of info.nrPast.slice().reverse()) out.push(`<li class="${p.ok ? "up" : "dn"}">${esc(fmtD.format(p.t))}: ${esc(p.text)}</li>`);
    out.push(`</ul>`);
  }

  // indikátorok
  if (info) {
    const o = info.osc || {}, rows = [];
    if (o.rsi != null) rows.push(["RSI(14), 1h", `${o.rsi.toFixed(1)} ${esc(o.rsiState || "")}`]);
    if (o.k != null) rows.push(["KDJ", `K ${o.k.toFixed(1)} · D ${o.d.toFixed(1)} · J ${o.j.toFixed(1)}`]);
    if (o.ema) rows.push(["EMA 50 / 100 / 200", Object.values(o.ema).map(f).join(" / ")]);
    if (info.st) rows.push(["Supertrend", `${info.st.trend > 0 ? "emelkedő" : "eső"} · vonal ${f(info.st.line)}`]);
    if (info.pd) rows.push(["Premium / discount", `${info.pd.premium ? "premium" : "discount"} · egyensúly ${f(info.pd.eq)}`]);
    if (info.wy) rows.push(["Wyckoff", `${esc(info.wy.type)} · ${esc(info.wy.phase)} fázis${info.wy.events && info.wy.events.length ? " · " + esc(info.wy.events.join(", ")) : ""}${info.wy.target != null ? " · cél " + f(info.wy.target) : ""}`]);
    if (info.week && info.week.length) rows.push(["Heti profil", info.week.map(w => `${esc(w.name)} ${pct(w.p)}`).join("<br>")]);
    if (info.forecast && info.forecast.length) rows.push(["Várható ár", info.forecast.map(x => `${f(x.p)} (${esc(x.src)})`).join(", ")]);
    if (info.voldiv && info.voldiv[0]) rows.push(["Volumen-divergencia (utolsó)", `${info.voldiv[0].bear ? "bear" : "bull"}${info.voldiv[0].t ? " · " + fmtT.format(info.voldiv[0].t) : ""}`]);
    if (rows.length) out.push(`<h3>Indikátorok</h3><table>${rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join("")}</table>`);
    const g = [];
    if (info.gannYear) g.push(`<li><b>Év:</b> ${esc(info.gannYear)}</li>`);
    if (info.gannNow && info.gannNow.why && info.gannNow.why.length) g.push(`<li><b>Most:</b> ${info.gannNow.why.map(esc).join("; ")}</li>`);
    for (const e of info.gann || []) g.push(`<li>${esc(fmtD.format(e.t1))}–${esc(fmtD.format(e.t2))}: ${esc(e.text)}</li>`);
    if (g.length) out.push(`<h3>Gann-naptár</h3><ul>${g.join("")}</ul>`);
  }
  out.push(`<p class="muted">Gazdasági naptár (FOMC stb.): egy későbbi lépésben kerül ide.</p>`);
  el.innerHTML = out.join("");
}

function planTable(r, f, full, sim) {
  const p = r.plan, side = p.dir > 0 ? "LONG" : "SHORT", cls = p.dir > 0 ? "up" : "dn";
  return `<h3 class="${cls}">${side} – ${esc(r.day)}${r.primary ? " · valószínűbb irány" : ""}${p.revised ? " · London után frissítve" : ""}</h3>` +
    `<p class="muted">Alap (entry 1) oka: ${esc(p.entry.why)}${p.why ? " · " + esc(p.why) : ""}${p.prob != null ? " · esély " + pct(p.prob) : ""}${p.votes ? " · " + esc(p.votes) : ""}</p>` +
    (r.trades.length ? tradeTable(r.trades.filter(t => t.state !== "lejárt" || t.filled), f, sim, false) : `<p class="muted">Nincs kereskedés.</p>`);
}

export function tradeTable(trades, f, sim, showDay) {
  const h = [`<table class="plan"><tr>${showDay ? "<th>Nap</th>" : ""}<th>Számla</th><th>Irány</th><th>Állapot</th><th>Szerep</th><th>Egység</th><th>Entry</th><th>DCA1</th><th>DCA2</th><th>DCA3</th><th>Átlag / menny.</th><th>TP1 (15m)</th><th>TP2 (1h)</th><th>TP3 (4h)</th><th>Swing (1D)</th><th>SL+</th><th>Nettó</th></tr>`];
  for (const t of trades) {
    const ok = (x, done) => `${f(x)}${done ? " ✓" : ""}`;
    h.push(`<tr>${showDay ? `<td>${esc(fmtD.format(t.day))}</td>` : ""}<td>${t.acc}</td><td class="${t.dir > 0 ? "up" : "dn"}">${t.dir > 0 ? "long" : "short"}</td><td>${esc(STATE[t.state] || t.state)}</td><td>${t.role ? esc(ROLE[t.role]) : "–"}</td>` +
      `<td>${sim && sim.hype ? t.unit + " HYPE" : "–"}</td>` +
      t.legs.map((l, i) => `<td>${ok(l.p, i < t.filled)}</td>`).join("") +
      `<td>${t.avg != null ? f(t.avg) + (sim && sim.hype ? " / " + t.qty.toFixed(1) : "") : "–"}</td>` +
      (t.tps || [null, null, null, null]).map((x, i) => `<td title="${esc(x && x.why)}">${x && t.shares[i] ? ok(x.p, t.tpHit.includes(i)) + ` <span class="muted">${Math.round(t.shares[i] * 100)}%</span>` : "–"}</td>`).join("") +
      `<td>${t.stop != null ? f(t.stop) : "–"}</td><td>${t.exits.length || t.fills.length ? money(t.realized - t.fees + (t.unreal || 0), sim) + (t.unreal ? ' <span class="muted">(nyitott)</span>' : "") : "–"}</td></tr>`);
  }
  h.push(`</table>`);
  return h.join("");
}
