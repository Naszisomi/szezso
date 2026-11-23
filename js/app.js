// szezso – alap chart: élő gyertyák, idősík-váltó, magyar idő, fülek.
// Fülek: 6 HYPE számlafül (Fő, Al1–Al5), BTC, ETH, „6×HYPE” (mind a 6 számla egyszerre)
// és „HYPE·BTC·ETH” (a három termék egyszerre).
import { BARS, fetchLatest, fetchOlder, LiveFeed } from "./okx.js";
import { loadCandles, saveCandles, merge, getPref, setPref } from "./store.js";
import { SceneLayer } from "./draw.js";
import { milana, MILANA_DEFAULTS } from "./ind/milana.js";

// Rétegek ki-be kapcsolása (a részletes beállítások az 5. lépésben jönnek)
const layers = { milana: getPref("layer.milana", true) };

const LWC = window.LightweightCharts;

export const INSTRUMENTS = {
  HYPE: { instId: "HYPE-USD_UM_XPERP-310523", name: "HYPEUSD UM X-Perp (2031 máj.)", short: "HYPE", tick: 0.001 },
  BTC:  { instId: "BTC-USD_UM_XPERP-310404",  name: "BTCUSD UM X-Perp (2031 ápr.)",  short: "BTC",  tick: 0.1 },
  ETH:  { instId: "ETH-USD_UM_XPERP-310404",  name: "ETHUSD UM X-Perp (2031 ápr.)",  short: "ETH",  tick: 0.01 },
};
const ACCOUNTS = ["Fő", "Al1", "Al2", "Al3", "Al4", "Al5"];
// fül -> elrendezés: [termék, számla] cellák
const TABS = [
  ...ACCOUNTS.map(a => ({ id: a, label: a, layout: "single", cells: [["HYPE", a]] })),
  { id: "BTC", label: "BTC", layout: "single", cells: [["BTC", null]] },
  { id: "ETH", label: "ETH", layout: "single", cells: [["ETH", null]] },
  { id: "6HYPE", label: "6×HYPE", layout: "six", cells: ACCOUNTS.map(a => ["HYPE", a]) },
  { id: "TRIO", label: "HYPE·BTC·ETH", layout: "three", cells: [["HYPE", null], ["BTC", null], ["ETH", null]] },
];
const UP = "#089981", DOWN = "#F23645";

// ── Magyar idő: az adat UTC-ben marad (így az óraátállításnál sem lesz dupla időpont),
// csak a kiírás budapesti idő szerint történik. ──
const fmtFull = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtHM   = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit" });
const fmtDay  = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short", day: "numeric" });
const fmtMon  = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short" });
const fmtYear = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", year: "numeric" });
const chartTime = ms => Math.floor(ms / 1000);
function tickFmt(t, type) {
  const d = new Date(t * 1000);
  return type === 0 ? fmtYear.format(d) : type === 1 ? fmtMon.format(d) : type === 2 ? fmtDay.format(d) : fmtHM.format(d);
}
function decimals(tick) { const s = String(tick); return s.includes(".") ? s.split(".")[1].length : 0; }

function setStatus(msg, cls) {
  const s = document.getElementById("status");
  s.textContent = msg; s.className = "status " + (cls || "");
}

// ── Adatközpont: termékenként és idősíkonként egyszer tölti le és frissíti a gyertyákat,
// akárhány chart mutatja is őket. ──
class DataSet {
  constructor(key, tf) {
    this.key = key; this.tf = tf; this.inst = INSTRUMENTS[key];
    this.bars = []; this.panels = new Set(); this.scene = { items: [] };
    this.loadingOlder = false; this.noMoreOlder = false; this.dead = false;
    this.ready = this.init();
  }
  async init() {
    const cached = await loadCandles(this.inst.instId, this.tf);
    if (this.dead) return;
    if (cached.length) { this.bars = cached; this.emitReset(); }
    try {
      const fresh = await fetchLatest(this.inst.instId, this.tf);
      if (this.dead) return;
      const gap = cached.length && fresh.length && fresh[0].t > cached[cached.length - 1].t;
      this.bars = gap ? fresh : merge(cached, fresh);
      this.emitReset();
      while (!this.dead && this.bars.length < 1000 && !this.noMoreOlder) await this.loadOlder(true);
      saveCandles(this.inst.instId, this.tf, this.bars);
    } catch (e) { setStatus("Adathiba: " + e.message, "err"); }
  }
  compute() {
    const items = [];
    if (layers.milana) items.push(...milana(this.bars, BARS[this.tf].sec, MILANA_DEFAULTS).items);
    this.scene = { items };
  }
  emitReset(shift = 0) { this.compute(); for (const p of this.panels) p.reset(shift); }
  async loadOlder(silent) {
    if (this.loadingOlder || this.noMoreOlder || !this.bars.length || this.dead) return;
    this.loadingOlder = true;
    try {
      const older = await fetchOlder(this.inst.instId, this.tf, this.bars[0].t);
      if (this.dead) return;
      if (!older.length) { this.noMoreOlder = true; return; }
      const before = this.bars.length;
      this.bars = merge(older, this.bars);
      this.emitReset(silent ? 0 : this.bars.length - before);
      saveCandles(this.inst.instId, this.tf, this.bars);
    } catch (e) { setStatus("Régebbi adat hiba: " + e.message, "err"); }
    finally { this.loadingOlder = false; }
  }
  onLive(bar) {
    if (!this.bars.length) return;
    const last = this.bars[this.bars.length - 1];
    if (bar.t < last.t) return;
    if (bar.t === last.t) this.bars[this.bars.length - 1] = bar; else this.bars.push(bar);
    this.compute();
    for (const p of this.panels) p.update(bar);
    if (bar.done) saveCandles(this.inst.instId, this.tf, this.bars);
  }
  async refreshLatest() {
    try {
      const fresh = await fetchLatest(this.inst.instId, this.tf);
      if (this.dead) return;
      this.bars = merge(this.bars, fresh);
      this.emitReset();
    } catch {}
  }
}

const hub = {
  tf: getPref("tf", "15m"),
  sets: new Map(),
  get(key) {
    const k = key + "|" + this.tf;
    if (!this.sets.has(k)) {
      this.sets.set(k, new DataSet(key, this.tf));
      feed.subscribe(INSTRUMENTS[key].instId, this.tf);
    }
    return this.sets.get(k);
  },
  setTf(tf) {
    for (const ds of this.sets.values()) { ds.dead = true; feed.unsubscribe(ds.inst.instId, ds.tf); }
    this.sets.clear();
    this.tf = tf;
  },
};

const feed = new LiveFeed(
  (instId, tf, bar) => {
    for (const ds of hub.sets.values()) if (ds.inst.instId === instId && ds.tf === tf) ds.onLive(bar);
  },
  st => {
    const dot = document.getElementById("live");
    dot.className = "live " + st;
    dot.title = st === "ok" ? "Élő adat" : st === "connecting" ? "Kapcsolódás…" : "Nincs kapcsolat – újrapróbálja";
  }
);
feed.onReconnect = () => hub.sets.forEach(ds => ds.refreshLatest());
document.addEventListener("visibilitychange", () => { if (!document.hidden) hub.sets.forEach(ds => ds.refreshLatest()); });

// ── Egy chart-panel ──
class ChartPanel {
  constructor(el, key, account, small) {
    this.el = el; this.key = key; this.inst = INSTRUMENTS[key]; this.account = account; this.small = small;
    this.ds = null;
    this.chart = LWC.createChart(el, {
      autoSize: true,
      layout: { background: { color: "#ffffff" }, textColor: "#333", fontSize: small ? 11 : 12, panes: { separatorColor: "#e0e0e0" } },
      grid: { vertLines: { color: "#f2f2f2" }, horzLines: { color: "#f2f2f2" } },
      crosshair: { mode: LWC.CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#ddd" },
      timeScale: { borderColor: "#ddd", timeVisible: true, secondsVisible: false, rightOffset: 8, tickMarkFormatter: tickFmt },
      localization: { locale: "hu-HU", timeFormatter: t => fmtFull.format(new Date(t * 1000)) },
    });
    this.candles = this.chart.addSeries(LWC.CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      priceFormat: { type: "price", precision: decimals(this.inst.tick), minMove: this.inst.tick },
    });
    if (!small) {
      this.volume = this.chart.addSeries(LWC.HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
      const panes = this.chart.panes();
      if (panes[1]) panes[1].setStretchFactor(0.18);
      if (panes[0]) panes[0].setStretchFactor(0.82);
    }
    this.layer = new SceneLayer(() => this.ds ? this.ds.bars : [], () => this.ds ? this.ds.scene : null, () => BARS[hub.tf].sec);
    this.candles.attachPrimitive(this.layer);
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && r.from < 30 && this.ds) this.ds.loadOlder(); });
    this.titleEl = document.createElement("div");
    this.titleEl.className = "ctitle" + (small ? " small" : "");
    el.appendChild(this.titleEl);
    this.first = true;
  }
  attach(ds) {
    if (this.ds === ds) return;
    if (this.ds) this.ds.panels.delete(this);
    this.ds = ds; this.first = true;
    ds.panels.add(this);
    this.reset(0);
  }
  reset(shift) {
    const bars = this.ds ? this.ds.bars : [];
    const ts = this.chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    this.candles.setData(bars.map(b => ({ time: chartTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    if (this.volume) this.volume.setData(bars.map(b => ({ time: chartTime(b.t), value: b.v, color: (b.c >= b.o ? UP : DOWN) + "66" })));
    if (bars.length && this.first) { ts.scrollToRealTime(); this.first = false; }
    else if (r && shift) ts.setVisibleLogicalRange({ from: r.from + shift, to: r.to + shift });
    this.layer.refresh();
    this.setTitle();
  }
  update(b) {
    this.candles.update({ time: chartTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c });
    if (this.volume) this.volume.update({ time: chartTime(b.t), value: b.v, color: (b.c >= b.o ? UP : DOWN) + "66" });
    this.layer.refresh();
    this.setTitle();
  }
  setTitle() {
    const bars = this.ds ? this.ds.bars : [];
    const last = bars[bars.length - 1];
    const acc = this.account ? `<span class="acc">${this.account}</span> ` : "";
    const name = this.small ? this.inst.short : this.inst.name;
    this.titleEl.innerHTML = `${acc}<b>${name}</b> · ${hub.tf}` +
      (last ? ` · <span style="color:${last.c >= last.o ? UP : DOWN}">${last.c.toFixed(decimals(this.inst.tick))}</span>` : "");
  }
}

// ── Fülek és elrendezések ──
const views = new Map();   // fül id -> {el, panels}
let current = getPref("tab", "Fő");
if (!TABS.some(t => t.id === current)) current = "Fő";

function buildView(tab) {
  const el = document.createElement("div");
  el.className = "view " + tab.layout;
  document.getElementById("views").appendChild(el);
  const small = tab.layout !== "single";
  const panels = tab.cells.map(([key, acc], i) => {
    const cell = document.createElement("div");
    cell.className = "cell c" + i;
    el.appendChild(cell);
    // a 3-as elrendezésben a HYPE nagy chart, volumennel
    return new ChartPanel(cell, key, acc, small && !(tab.layout === "three" && i === 0));
  });
  return { el, panels };
}

function showTab(id) {
  current = id; setPref("tab", id);
  const tab = TABS.find(t => t.id === id);
  if (!views.has(id)) views.set(id, buildView(tab));
  for (const [vid, v] of views) v.el.style.display = vid === id ? "" : "none";
  for (const p of views.get(id).panels) p.attach(hub.get(p.key));
  buildTabs();
}

function setTf(tf) {
  setPref("tf", tf);
  hub.setTf(tf);
  for (const v of views.values()) for (const p of v.panels) { if (p.ds) p.ds.panels.delete(p); p.ds = null; }
  showTab(current);
  buildTfButtons();
}

function buildTfButtons() {
  const box = document.getElementById("tfs");
  box.innerHTML = "";
  for (const k of Object.keys(BARS)) {
    const b = document.createElement("button");
    b.textContent = k; b.className = k === hub.tf ? "on" : "";
    b.onclick = () => { setStatus(""); setTf(k); };
    box.appendChild(b);
  }
}
function buildLayerButtons() {
  const box = document.getElementById("layers");
  box.innerHTML = "";
  for (const [k, label] of [["milana", "Milana"]]) {
    const b = document.createElement("button");
    b.textContent = label; b.className = layers[k] ? "on" : "";
    b.onclick = () => {
      layers[k] = !layers[k]; setPref("layer." + k, layers[k]); buildLayerButtons();
      for (const ds of hub.sets.values()) ds.emitReset();
    };
    box.appendChild(b);
  }
}
function buildTabs() {
  const box = document.getElementById("tabs");
  box.innerHTML = "";
  for (const t of TABS) {
    const b = document.createElement("button");
    b.textContent = t.label; b.className = (t.id === current ? "on " : "") + (ACCOUNTS.includes(t.id) ? "acct" : "multi");
    b.onclick = () => showTab(t.id);
    box.appendChild(b);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  buildTfButtons();
  buildLayerButtons();
  showTab(current);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
});
