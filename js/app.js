// szezso – alap chart (2. lépés): élő gyertyák, idősík-váltó, magyar idő,
// BTC/ETH kiegészítő chart, számlafülek (a kereskedés a 7. lépésben jön).
import { BARS, fetchLatest, fetchOlder, LiveFeed } from "./okx.js";
import { loadCandles, saveCandles, merge, getPref, setPref } from "./store.js";

const LWC = window.LightweightCharts;

export const INSTRUMENTS = {
  HYPE: { instId: "HYPE-USD_UM_XPERP-310523", name: "HYPEUSD UM X-Perp (2031 máj.)", tick: 0.001 },
  BTC:  { instId: "BTC-USD_UM_XPERP-310404",  name: "BTCUSD UM X-Perp (2031 ápr.)",  tick: 0.1 },
  ETH:  { instId: "ETH-USD_UM_XPERP-310404",  name: "ETHUSD UM X-Perp (2031 ápr.)",  tick: 0.01 },
};
const ACCOUNTS = ["Fő", "Al1", "Al2", "Al3", "Al4", "Al5", "Mind"];
const UP = "#089981", DOWN = "#F23645";

// ── Magyar idő: az adat UTC-ben marad (így a nyári/téli óraátállításnál sem
// keletkezik dupla időpont), csak a kiírás budapesti idő szerint történik. ──
const fmtFull = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtHM   = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit" });
const fmtDay  = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short", day: "numeric" });
const fmtMon  = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short" });
const fmtYear = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", year: "numeric" });
const chartTime = ms => Math.floor(ms / 1000);
function tickFmt(t, type) {
  const d = new Date(t * 1000);
  // 0 év, 1 hónap, 2 nap, 3 idő, 4 idő másodperccel
  return type === 0 ? fmtYear.format(d) : type === 1 ? fmtMon.format(d) : type === 2 ? fmtDay.format(d) : fmtHM.format(d);
}

function decimals(tick) { const s = String(tick); return s.includes(".") ? s.split(".")[1].length : 0; }

// ── Egy chart-panel (fő vagy kiegészítő) ──
class ChartPanel {
  constructor(el, key, opts = {}) {
    this.el = el; this.key = key; this.inst = INSTRUMENTS[key];
    this.small = !!opts.small;
    this.bars = []; this.tf = null; this.loadingOlder = false; this.noMoreOlder = false;
    this.chart = LWC.createChart(el, {
      autoSize: true,
      layout: { background: { color: "#ffffff" }, textColor: "#333", fontSize: this.small ? 11 : 12,
                panes: { separatorColor: "#e0e0e0" } },
      grid: { vertLines: { color: "#f2f2f2" }, horzLines: { color: "#f2f2f2" } },
      crosshair: { mode: LWC.CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#ddd" },
      timeScale: { borderColor: "#ddd", timeVisible: true, secondsVisible: false, rightOffset: 8, tickMarkFormatter: tickFmt },
      localization: { locale: "hu-HU", timeFormatter: t => fmtFull.format(new Date(t * 1000)) },
    });
    const d = decimals(this.inst.tick);
    this.candles = this.chart.addSeries(LWC.CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      priceFormat: { type: "price", precision: d, minMove: this.inst.tick },
    });
    if (!this.small) {
      this.volume = this.chart.addSeries(LWC.HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
      const panes = this.chart.panes();
      if (panes[1]) panes[1].setStretchFactor(0.18);
      if (panes[0]) panes[0].setStretchFactor(0.82);
    }
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && r.from < 30) this.loadOlder(); });
    this.titleEl = document.createElement("div");
    this.titleEl.className = "ctitle";
    el.appendChild(this.titleEl);
  }

  setTitle() {
    const last = this.bars[this.bars.length - 1];
    const d = decimals(this.inst.tick);
    this.titleEl.innerHTML = `<b>${this.inst.name}</b> · ${this.tf}` +
      (last ? ` · <span style="color:${last.c >= last.o ? UP : DOWN}">${last.c.toFixed(d)}</span>` : "");
  }

  toSeries() {
    this.candles.setData(this.bars.map(b => ({ time: chartTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    if (this.volume) this.volume.setData(this.bars.map(b => ({ time: chartTime(b.t), value: b.v, color: (b.c >= b.o ? UP : DOWN) + "66" })));
    this.setTitle();
  }

  async show(tf, feed) {
    if (this.tf && feed) feed.unsubscribe(this.inst.instId, this.tf);
    this.tf = tf; this.noMoreOlder = false;
    const myTf = tf;
    // 1) a tabletre mentett gyertyák azonnal
    const cached = await loadCandles(this.inst.instId, tf);
    if (this.tf !== myTf) return;
    this.bars = cached;
    this.toSeries();
    if (cached.length) this.chart.timeScale().scrollToRealTime();
    // 2) friss adat az OKX-től
    try {
      const fresh = await fetchLatest(this.inst.instId, tf);
      if (this.tf !== myTf) return;
      const gap = cached.length && fresh.length && fresh[0].t > cached[cached.length - 1].t;
      this.bars = gap ? fresh : merge(cached, fresh);   // ha hézag lenne, inkább friss adattól indul
      this.toSeries();
      if (!cached.length) this.chart.timeScale().scrollToRealTime();
      // legyen legalább ~1000 gyertya a statisztikákhoz
      while (this.tf === myTf && this.bars.length < 1000 && !this.noMoreOlder) await this.loadOlder(true);
      saveCandles(this.inst.instId, tf, this.bars);
    } catch (e) { setStatus("Adathiba: " + e.message, "err"); }
    if (feed) feed.subscribe(this.inst.instId, tf);
  }

  async loadOlder(silent) {
    if (this.loadingOlder || this.noMoreOlder || !this.bars.length) return;
    this.loadingOlder = true;
    const myTf = this.tf;
    try {
      const older = await fetchOlder(this.inst.instId, myTf, this.bars[0].t);
      if (this.tf !== myTf) return;
      if (!older.length) { this.noMoreOlder = true; return; }
      const ts = this.chart.timeScale();
      const r = ts.getVisibleLogicalRange();
      const before = this.bars.length;
      this.bars = merge(older, this.bars);
      this.toSeries();
      if (r && !silent) ts.setVisibleLogicalRange({ from: r.from + (this.bars.length - before), to: r.to + (this.bars.length - before) });
      saveCandles(this.inst.instId, myTf, this.bars);
    } catch (e) { setStatus("Régebbi adat hiba: " + e.message, "err"); }
    finally { this.loadingOlder = false; }
  }

  onLive(tf, bar) {
    if (tf !== this.tf || !this.bars.length) return;
    const last = this.bars[this.bars.length - 1];
    if (bar.t < last.t) return;
    if (bar.t === last.t) this.bars[this.bars.length - 1] = bar; else this.bars.push(bar);
    this.candles.update({ time: chartTime(bar.t), open: bar.o, high: bar.h, low: bar.l, close: bar.c });
    if (this.volume) this.volume.update({ time: chartTime(bar.t), value: bar.v, color: (bar.c >= bar.o ? UP : DOWN) + "66" });
    this.setTitle();
    if (bar.done) saveCandles(this.inst.instId, tf, this.bars);
  }

  async refreshLatest() {
    if (!this.tf) return;
    try {
      const fresh = await fetchLatest(this.inst.instId, this.tf);
      this.bars = merge(this.bars, fresh);
      this.toSeries();
    } catch {}
  }
}

// ── Állapotsor ──
function setStatus(msg, cls) {
  const s = document.getElementById("status");
  s.textContent = msg; s.className = "status " + (cls || "");
}

// ── Indítás ──
const panels = {};
let tf = getPref("tf", "15m");
let showSide = getPref("side", true);
let account = getPref("account", "Fő");

const feed = new LiveFeed(
  (instId, t, bar) => { for (const p of Object.values(panels)) if (p.inst.instId === instId) p.onLive(t, bar); },
  st => {
    const dot = document.getElementById("live");
    dot.className = "live " + st;
    dot.title = st === "ok" ? "Élő adat" : st === "connecting" ? "Kapcsolódás…" : "Nincs kapcsolat – újrapróbálja";
  }
);
feed.onReconnect = () => Object.values(panels).forEach(p => p.refreshLatest());
document.addEventListener("visibilitychange", () => { if (!document.hidden) Object.values(panels).forEach(p => p.refreshLatest()); });

function buildTfButtons() {
  const box = document.getElementById("tfs");
  box.innerHTML = "";
  for (const k of Object.keys(BARS)) {
    const b = document.createElement("button");
    b.textContent = k; b.className = k === tf ? "on" : "";
    b.onclick = () => { tf = k; setPref("tf", tf); buildTfButtons(); showAll(); };
    box.appendChild(b);
  }
}
function buildAccounts() {
  const box = document.getElementById("accounts");
  box.innerHTML = "";
  for (const a of ACCOUNTS) {
    const b = document.createElement("button");
    b.textContent = a; b.className = a === account ? "on" : "";
    b.onclick = () => { account = a; setPref("account", a); buildAccounts(); };
    box.appendChild(b);
  }
}
function applySide() {
  document.body.classList.toggle("noside", !showSide);
  document.getElementById("sideBtn").className = showSide ? "on" : "";
  if (showSide && !panels.BTC) {
    panels.BTC = new ChartPanel(document.getElementById("cBTC"), "BTC", { small: true });
    panels.ETH = new ChartPanel(document.getElementById("cETH"), "ETH", { small: true });
    panels.BTC.show(tf, feed); panels.ETH.show(tf, feed);
  }
}
function showAll() {
  setStatus("");
  for (const p of Object.values(panels)) p.show(tf, feed);
}

window.addEventListener("DOMContentLoaded", () => {
  panels.HYPE = new ChartPanel(document.getElementById("cMain"), "HYPE");
  buildTfButtons(); buildAccounts();
  document.getElementById("sideBtn").onclick = () => { showSide = !showSide; setPref("side", showSide); applySide(); };
  panels.HYPE.show(tf, feed);
  applySide();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
});
