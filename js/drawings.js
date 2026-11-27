// Saját rajzok a charton (1. kör): trendvonal, vízszintes vonal, vízszintes sugár, téglalap, nyíl, törött vonal (nyíllal).
// Rajzolás a TradingView mobil módszerével: eszközválasztás után célkereszt jelenik meg; az ujj húzása a célkeresztet
// mozgatja (eltolva, hogy látszódjon), koppintás rakja le a pontot. A törött vonalat a „Kész” vagy egy dupla koppintás
// (koppintás az utolsó pontra) zárja, a „Mégse” elveti.
// Kijelölés koppintással; a fogópontok és az egész rajz húzható; szín, vastagság, törlés, visszavonás, mágnes (OHLC).
// A rajzok termékenként tárolódnak a tableten, minden idősíkon és számlafülön látszanak.
import { getPref, setPref } from "./store.js";

export const COLORS = ["#2962FF", "#F23645", "#089981", "#FF9800", "#9C27B0", "#111111", "#FFEB3B", "#787B86"];
const TOOLS = [
  ["select", "✋", "Kijelölés / húzás"], ["trend", "╱", "Trendvonal"], ["hline", "―", "Vízszintes vonal"], ["ray", "⟶", "Vízszintes sugár"],
  ["rect", "▭", "Téglalap"], ["arrow", "↗", "Nyíl"], ["path", "⟋⟍", "Törött vonal nyíllal"],
];
const NPTS = { trend: 2, hline: 1, ray: 1, rect: 2, arrow: 2 };
const HIT = 24;                      // érintési tűrés (képpont)

let seq = Date.now();
export const drawState = {
  tool: "select", color: COLORS[0], width: 2, magnet: getPref("draw.magnet", true), visible: getPref("draw.visible", true), locked: getPref("draw.locked", true),
  sel: null, undo: [], listeners: new Set(),
  changed() { for (const f of this.listeners) f(); },
};

export function loadDrawings(key) { try { return JSON.parse(localStorage.getItem("szezso.draw." + key)) || []; } catch { return []; } }
function saveDrawings(key, list) { try { localStorage.setItem("szezso.draw." + key, JSON.stringify(list)); } catch {} }
function remember(key) {
  drawState.undo.push({ key, list: JSON.stringify(loadDrawings(key)) });
  if (drawState.undo.length > 50) drawState.undo.shift();
}

// a rajzok jelenet-elemei (a kijelöltnél fogópontokkal)
export function drawItems(key, extra) {
  if (!drawState.visible) return [];
  const list = loadDrawings(key).concat(extra ? [extra] : []), out = [];
  for (const d of list) {
    const c = d.color, w = d.width || 2, P = d.pts;
    if (d.type === "trend" && P.length === 2) out.push({ type: "line", t1: P[0].t, p1: P[0].p, t2: P[1].t, p2: P[1].p, color: c, width: w });
    else if (d.type === "arrow" && P.length === 2) out.push({ type: "line", t1: P[0].t, p1: P[0].p, t2: P[1].t, p2: P[1].p, color: c, width: w, arrow: true });
    else if (d.type === "hline") out.push({ type: "hline", p: P[0].p, color: c, width: w, text: fmt(P[0].p) });
    else if (d.type === "ray") out.push({ type: "hline", p: P[0].p, t1: P[0].t, color: c, width: w, text: fmt(P[0].p) });
    else if (d.type === "rect" && P.length === 2) out.push({ type: "box", t1: P[0].t, p1: P[0].p, t2: P[1].t, p2: P[1].p, border: c, borderWidth: w, bg: c + "22" });
    else if (d.type === "path" && P.length >= 2) out.push({ type: "poly", points: P, color: c, width: w, arrow: true });
    if (drawState.sel && drawState.sel.id === d.id || d === extra) for (const q of P) out.push({ type: "dot", t: q.t, p: q.p, r: 7, color: c });
  }
  return out;
}
const fmt = p => String(+(+p).toPrecision(6));

// rajzoló vezérlő egy chart-panelhez
export class DrawController {
  // panel: ChartPanel (chart, candles, layer, el, key, ds)
  constructor(panel) {
    this.p = panel; this.draft = null; this.drag = null; this.lastTap = 0; this.ptrs = new Set();
    const el = panel.el, opt = { capture: true, passive: false };
    // két ujj (nagyítás) soha nem mozdít rajzot: a második ujjra a húzás visszaáll
    el.addEventListener("pointerdown", e => { this.ptrs.add(e.pointerId); if (this.ptrs.size > 1) { this.abortDrag(); return; } this.down(e); }, opt);
    for (const n of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(n, e => this.ptrs.delete(e.pointerId), { capture: true });
    el.addEventListener("pointermove", e => this.move(e), opt);
    el.addEventListener("pointerup", e => this.up(e), opt);
    el.addEventListener("pointercancel", () => { this.drag = null; this.lockChart(false); }, opt);
    // a touch-eseményeket is el kell nyelni rajzolás közben, különben a chart görget
    const eat = e => { if (this.busy()) { e.stopPropagation(); e.preventDefault(); } };
    for (const n of ["touchstart", "touchmove", "touchend", "mousedown", "mousemove", "mouseup"]) el.addEventListener(n, eat, opt);
  }
  busy() { return drawState.tool !== "select" || !!this.drag || !!this.touch; }
  lockChart(on) { this.p.chart.applyOptions({ handleScroll: !on, handleScale: !on }); }

  // képernyő-koordináta → {t, p}; mágnessel a gyertya OHLC-jére
  toTP(e) {
    const r = this.p.el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const bars = this.p.ds ? this.p.ds.bars : [];
    if (!bars.length) return null;
    const lg = this.p.chart.timeScale().coordinateToLogical(x);
    if (lg == null) return null;
    const last = bars.length - 1, sec = this.p.barSec() * 1000;
    let t;
    if (lg >= last) t = bars[last].t + (lg - last) * sec;
    else if (lg <= 0) t = bars[0].t + lg * sec;
    else { const i = Math.floor(lg), f = lg - i; t = bars[i].t + f * (bars[i + 1].t - bars[i].t); }
    let p = this.p.candles.coordinateToPrice(y);
    if (p == null) return null;
    if (drawState.magnet) {
      const i = Math.round(lg);
      if (i >= 0 && i <= last) {
        const b = bars[i];
        let best = null, bd = 24;
        for (const v of [b.o, b.h, b.l, b.c]) { const dy = Math.abs(this.p.candles.priceToCoordinate(v) - y); if (dy < bd) { bd = dy; best = v; } }
        if (best != null) { p = best; t = b.t; }
      }
    }
    return { t: Math.round(t), p, x, y };
  }
  sx(t) { return this.p.layer.x(t); }
  sy(p) { return this.p.candles.priceToCoordinate(p); }

  // találat: fogópont vagy a rajz teste
  hit(x, y) {
    const list = loadDrawings(this.p.key);
    for (let k = list.length - 1; k >= 0; k--) {
      const d = list[k];
      for (let i = 0; i < d.pts.length; i++) {
        const px = d.type === "hline" ? x : this.sx(d.pts[i].t), py = this.sy(d.pts[i].p);
        if (px != null && py != null && Math.hypot(px - x, py - y) <= HIT) return { d, i };
      }
      if (this.near(d, x, y)) return { d, i: -1 };
    }
    return null;
  }
  near(d, x, y) {
    const P = d.pts.map(q => [this.sx(q.t), this.sy(q.p)]);
    if (P.some(q => q[0] == null || q[1] == null)) return false;
    if (d.type === "hline") return Math.abs(P[0][1] - y) <= HIT;
    if (d.type === "ray") return Math.abs(P[0][1] - y) <= HIT && x >= P[0][0] - HIT;
    if (d.type === "rect") {
      const l = Math.min(P[0][0], P[1][0]), r = Math.max(P[0][0], P[1][0]), t = Math.min(P[0][1], P[1][1]), b = Math.max(P[0][1], P[1][1]);
      return x >= l - HIT && x <= r + HIT && y >= t - HIT && y <= b + HIT;
    }
    for (let i = 1; i < P.length; i++) if (segDist(x, y, P[i - 1], P[i]) <= HIT) return true;
    return false;
  }

  // képpont → {t, p} (mágnessel)
  tpAt(x, y) {
    const r = this.p.el.getBoundingClientRect();
    return this.toTP({ clientX: r.left + x, clientY: r.top + y });
  }
  paneSize() { const r = this.p.el.getBoundingClientRect(); return { w: r.width - 70, h: (this.p.chart.panes ? this.p.chart.panes()[0].getHeight() : r.height * 0.7) }; }

  down(e) {
    const tool = drawState.tool;
    if (tool === "select") {
      const q = this.toTP(e);
      if (!q) return;
      const h = this.hit(q.x, q.y);
      if (!h) { if (drawState.sel) { drawState.sel = null; drawState.changed(); } return; }
      drawState.sel = { key: this.p.key, id: h.d.id };
      // zárolt rajz (alapból mind): kijelölhető (szín, törlés), de nem mozdul – a chart szabadon görgethető, nagyítható
      if (drawState.locked || h.d.locked) { drawState.changed(); return; }
      e.stopPropagation(); e.preventDefault();
      remember(this.p.key);
      this.drag = { id: h.d.id, i: h.i, start: q, orig: JSON.parse(JSON.stringify(h.d.pts)) };
      this.lockChart(true); drawState.changed();
      return;
    }
    // rajzolás: a célkereszt mozgatása / koppintás
    e.stopPropagation(); e.preventDefault();
    this.lockChart(true);
    const ps = this.paneSize();
    if (!this.cross) this.cross = { x: ps.w * 0.55, y: ps.h * 0.45 };
    this.touch = { fx: e.clientX, fy: e.clientY, cx: this.cross.x, cy: this.cross.y, moved: false };
    this.showCross();
  }
  move(e) {
    if (this.touch) {
      e.stopPropagation(); e.preventDefault();
      const dx = e.clientX - this.touch.fx, dy = e.clientY - this.touch.fy;
      if (Math.hypot(dx, dy) > 6) this.touch.moved = true;
      const ps = this.paneSize();
      this.cross = { x: Math.max(0, Math.min(ps.w, this.touch.cx + dx)), y: Math.max(0, Math.min(ps.h, this.touch.cy + dy)) };
      this.showCross();
      return;
    }
    if (!this.drag) return;
    const q = this.toTP(e);
    if (!q) return;
    e.stopPropagation(); e.preventDefault();
    const list = loadDrawings(this.p.key), d = list.find(x => x.id === this.drag.id);
    if (!d) return;
    if (this.drag.i >= 0) d.pts[this.drag.i] = { t: q.t, p: q.p };
    else { const dt = q.t - this.drag.start.t, dp = q.p - this.drag.start.p; d.pts = this.drag.orig.map(o => ({ t: o.t + dt, p: o.p + dp })); }
    saveDrawings(this.p.key, list); drawState.changed();
  }
  abortDrag() {
    if (!this.drag) return;
    const list = loadDrawings(this.p.key), d = list.find(x => x.id === this.drag.id);
    if (d) { d.pts = this.drag.orig; saveDrawings(this.p.key, list); }
    this.drag = null; this.lockChart(false); drawState.changed();
  }
  up(e) {
    if (this.drag) { this.drag = null; this.lockChart(false); e.stopPropagation(); return; }
    if (!this.touch) return;
    e.stopPropagation(); e.preventDefault();
    const tap = !this.touch.moved;
    this.touch = null;
    if (tap) this.placePoint();
  }
  // a célkereszt helyére pontot rak
  placePoint() {
    const q = this.cross && this.tpAt(this.cross.x, this.cross.y), tool = drawState.tool;
    if (!q) return;
    const pt = { t: q.t, p: q.p };
    if (!this.draft) {
      this.draft = { id: "d" + (++seq), type: tool, color: drawState.color, width: drawState.width, pts: [pt] };
      if (NPTS[tool] === 1) { this.finish(); return; }
      this.draft.pts.push({ ...pt });                       // előnézet: a következő pont a célkeresztet követi
    } else if (tool === "path") {
      // dupla koppintás (vagy koppintás az utolsó pontra) lezárja a törött vonalat – mint a TradingView-on
      // (a célkereszt csak húzásra mozdul: két koppintás húzás nélkül = ugyanaz a pont)
      const P = this.draft.pts, prev = P[P.length - 2];
      if (P.length >= 3 && prev && prev.t === pt.t && Math.abs(prev.p - pt.p) <= Math.abs(pt.p) * 0.0008) { this.finish(); return; }
      P[P.length - 1] = pt; P.push({ ...pt });
    }
    else { this.draft.pts[1] = pt; this.finish(); return; }
    this.showCross();
  }
  // célkereszt (és a vázlat utolsó pontja) kirajzolása
  showCross() {
    const q = this.cross && this.tpAt(this.cross.x, this.cross.y);
    if (q && this.draft) this.draft.pts[this.draft.pts.length - 1] = { t: q.t, p: q.p };
    this.p.crossItems = q ? [
      { type: "hline", p: q.p, color: "#555", width: 1, style: "dashed", text: fmt(q.p) },
      { type: "vline", t: q.t, color: "#555", width: 1, style: "dashed" },
      { type: "dot", t: q.t, p: q.p, r: 5, color: "#111", fill: "#fff" },
    ] : [];
    this.refresh();
  }
  cancel() { this.draft = null; this.cross = null; this.touch = null; this.p.crossItems = []; this.p.drawDraft = null; this.lockChart(false); this.p.drawLayer.refresh(); }
  finish() {
    const d = this.draft;
    this.draft = null; this.cross = null; this.p.crossItems = []; this.p.drawDraft = null; this.lockChart(false);
    if (!d) { drawState.tool = "select"; drawState.changed(); return; }
    if (d.type === "path") { d.pts.pop(); d.pts = d.pts.filter((q, i, a) => i === 0 || q.t !== a[i - 1].t || q.p !== a[i - 1].p); if (d.pts.length < 2) { drawState.tool = "select"; drawState.changed(); return; } }
    delete d.downAt;
    remember(this.p.key);
    const list = loadDrawings(this.p.key); list.push(d); saveDrawings(this.p.key, list);
    drawState.sel = { key: this.p.key, id: d.id }; drawState.tool = "select"; drawState.changed();
  }
  refresh() { this.p.drawDraft = this.draft; this.p.drawLayer.refresh(); }
}

function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

// eszközsor (a fejlécben): eszközök, szín, vastagság, mágnes, törlés, visszavonás, elrejtés, „Kész” a törött vonalhoz
export function buildDrawBar(box, controllers) {
  const s = drawState;
  box.innerHTML = "";
  const btn = (txt, title, on, fn, cls = "") => { const b = document.createElement("button"); b.textContent = txt; b.title = title; b.className = (on ? "on " : "") + cls; b.onclick = fn; box.appendChild(b); return b; };
  for (const [k, ic, title] of TOOLS) btn(ic, title, s.tool === k, () => { for (const c of controllers()) c.cancel(); s.tool = k; s.changed(); });
  if (s.tool !== "select") {
    btn("✓ Kész", "A rajz lezárása", false, () => { for (const c of controllers()) if (c.draft) c.finish(); s.tool = "select"; for (const c of controllers()) c.cancel(); s.changed(); }, "tog");
    btn("✕ Mégse", "A rajzolás elvetése", false, () => { for (const c of controllers()) c.cancel(); s.tool = "select"; s.changed(); }, "tog");
  }
  const sel = s.sel && loadDrawings(s.sel.key).find(d => d.id === s.sel.id);
  const col = document.createElement("span"); col.className = "colors";
  for (const c of COLORS) {
    const b = document.createElement("button"); b.className = "sw" + ((sel ? sel.color : s.color) === c ? " on" : ""); b.style.background = c; b.title = c;
    b.onclick = () => { s.color = c; if (sel) edit(x => x.color = c); s.changed(); };
    col.appendChild(b);
  }
  box.appendChild(col);
  btn("≡" + (sel ? sel.width : s.width), "Vastagság", false, () => { const w = ((sel ? sel.width : s.width) % 4) + 1; s.width = w; if (sel) edit(x => x.width = w); s.changed(); });
  btn(s.locked ? "🔒" : "🔓", s.locked ? "A rajzok zárolva (nem mozdulnak) – koppints a szerkesztéshez" : "A rajzok szerkeszthetők – koppints a zároláshoz", s.locked, () => { s.locked = !s.locked; setPref("draw.locked", s.locked); s.changed(); });
  btn("🧲", "Mágnes (OHLC)", s.magnet, () => { s.magnet = !s.magnet; setPref("draw.magnet", s.magnet); s.changed(); });
  btn("🗑", "Kijelölt rajz törlése", false, () => { if (!sel) return; remember(s.sel.key); saveDrawings(s.sel.key, loadDrawings(s.sel.key).filter(d => d.id !== sel.id)); s.sel = null; s.changed(); });
  btn("↶", "Visszavonás", false, () => { const u = s.undo.pop(); if (u) { localStorage.setItem("szezso.draw." + u.key, u.list); s.sel = null; s.changed(); } });
  btn(s.visible ? "👁" : "🚫", "Rajzok mutatása / elrejtése", false, () => { s.visible = !s.visible; setPref("draw.visible", s.visible); s.changed(); });
  btn("📋 Rajzok", "A rajzok listája (törlés innen is)", s.list, () => { s.list = !s.list; s.changed(); });
  if (s.list) {
    const box2 = document.createElement("div"); box2.className = "drawlist";
    const NAME = { trend: "trendvonal", hline: "vízsz. vonal", ray: "sugár", rect: "téglalap", arrow: "nyíl", path: "törött vonal" };
    let any = false;
    for (const key of ["HYPE", "BTC", "BNB"]) for (const d of loadDrawings(key)) {
      any = true;
      const row = document.createElement("div"), on = s.sel && s.sel.id === d.id;
      row.innerHTML = `<span style="color:${d.color}">■</span> ${key} · ${NAME[d.type] || d.type} · ${d.pts.map(q => fmt(q.p)).join(" → ")}`;
      row.className = on ? "on" : "";
      row.onclick = () => { s.sel = { key, id: d.id }; s.changed(); };
      const del = document.createElement("button"); del.textContent = "🗑";
      del.onclick = ev => { ev.stopPropagation(); remember(key); saveDrawings(key, loadDrawings(key).filter(x => x.id !== d.id)); if (s.sel && s.sel.id === d.id) s.sel = null; s.changed(); };
      row.appendChild(del); box2.appendChild(row);
    }
    if (!any) box2.textContent = "Nincs rajz.";
    box.appendChild(box2);
  }
  function edit(f) { remember(s.sel.key); const l = loadDrawings(s.sel.key), d = l.find(x => x.id === s.sel.id); if (d) { f(d); saveDrawings(s.sel.key, l); } }
}

// a rajzolt nyilak értelmezése (az elemzésed): az 1. nyíl vége az entry, a többi nyíl vége a DCA-k.
// A nyíl az ár útját mutatja a szintig: lefelé mutató nyíl → long a végénél, felfelé mutató → short.
export function arrowPlans(key, since = 0) {
  const list = loadDrawings(key).filter(d => (d.type === "arrow" || d.type === "path") && d.pts.length >= 2 && +String(d.id).slice(1) >= since);
  const out = { long: [], short: [] };
  for (const d of list) {
    const a = d.pts[d.pts.length - 2], b = d.pts[d.pts.length - 1];
    if (b.p === a.p) continue;
    (b.p < a.p ? out.long : out.short).push({ p: b.p, t: b.t, id: d.id });
  }
  out.long.sort((x, y) => y.p - x.p); out.short.sort((x, y) => x.p - y.p);
  return out;
}
