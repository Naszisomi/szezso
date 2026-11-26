// szezso – alap chart: élő gyertyák, idősík-váltó, magyar idő, fülek.
// Fülek: 6 HYPE számlafül (Fő, Al1–Al5), BTC, BNB, „6×HYPE” (mind a 6 számla egyszerre),
// „HYPE·BTC·BNB” (a három termék egyszerre), adatfülek és a papírkereskedés. Kereskedés csak HYPE-pal,
// a BTC és a BNB csak számolva, tájékoztatásként.
import { BARS, fetchLatest, fetchOlder, LiveFeed, findInstId, instAlive } from "./okx.js";
import { loadCandles, saveCandles, merge, getPref, setPref } from "./store.js";
import { hlHistory, hlRange } from "./hl.js";
import { SceneLayer } from "./draw.js";
import { milanaHistoryFrom } from "./ind/milana.js";
import { runEngine, LAYERS } from "./engine/index.js";
import { PlanManager } from "./plans.js";
import { renderData, biasText } from "./dataview.js";
import { renderPaper } from "./paperview.js";
import { DrawController, drawItems, drawState, buildDrawBar } from "./drawings.js";

// Rétegek ki-be kapcsolása (a részletes beállítások az 5. lépésben jönnek)
const layers = Object.fromEntries(LAYERS.map(l => [l.key, getPref("layer." + l.key, l.def)]));

const LWC = window.LightweightCharts;
const HISTORY_BARS = 5000;   // ennyi gyertya előzményt tölt vissza a háttérben (1D alatt)

export const INSTRUMENTS = {
  HYPE: { instId: "HYPE-USD_UM_XPERP-310523", name: "HYPEUSD UM X-Perp (2031 máj.)", short: "HYPE", tick: 0.001 },
  BTC:  { instId: "BTC-USD_UM_XPERP-310404",  name: "BTCUSD UM X-Perp (2031 ápr.)",  short: "BTC",  tick: 0.1 },
  BNB:  { instId: "BNB-USD_UM_XPERP-310523",  name: "BNBUSD UM X-Perp (2031 máj.)",  short: "BNB",  tick: 0.1, find: /^BNB-USD_UM_XPERP-3105/ },
};
const ACCOUNTS = ["Fő", "Al1", "Al2", "Al3", "Al4", "Al5", "SB"];   // SB: silver bullet (7. számla)
// fül -> elrendezés: [termék, számla] cellák
const TABS = [
  ...ACCOUNTS.map(a => ({ id: a, label: a, layout: "single", cells: [["HYPE", a]] })),
  { id: "BTC", label: "BTC", layout: "single", cells: [["BTC", null]] },
  { id: "BNB", label: "BNB", layout: "single", cells: [["BNB", null]] },
  { id: "6HYPE", label: "6×HYPE", layout: "six", cells: ACCOUNTS.slice(0, 6).map(a => ["HYPE", a]) },
  { id: "TRIO", label: "HYPE·BTC·BNB", layout: "three", cells: [["HYPE", null], ["BTC", null], ["BNB", null]] },
  ...["HYPE", "BTC", "BNB"].map(k => ({ id: "d" + k, label: k + " adat", layout: "data", key: k, cells: [] })),
  { id: "PAPER", label: "Papír", layout: "data", key: "HYPE", paper: true, cells: [] },
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
// ── Motor-szál ──
let dsCounter = 0;
const engine = (() => {
  const cbs = new Map();
  let w = null;
  try { w = new Worker(new URL("./engine/worker.js", import.meta.url), { type: "module" }); } catch {}
  if (w) w.onmessage = e => { const cb = cbs.get(e.data.id); if (cb) cb(e.data); };
  return {
    send(msg, cb) {
      cbs.set(msg.id, cb);
      if (w) { w.postMessage(msg); return; }
      // tartalék: ha nincs Worker, a fő szálon számol
      import("./engine/index.js").then(({ runEngine, ctxInfo }) => {
        const st = (this._st ||= new Map()), s0 = st.get(msg.id) || { bars: [], daily: null };
        if (msg.bars) s0.bars = msg.bars;
        if (msg.tail) for (const b of msg.tail) { const l = s0.bars[s0.bars.length - 1]; if (l && l.t === b.t) s0.bars[s0.bars.length - 1] = b; else if (!l || b.t > l.t) s0.bars.push(b); }
        if (msg.daily !== undefined) s0.daily = msg.daily;
        st.set(msg.id, s0);
        const r = runEngine({ bars: s0.bars, barSec: msg.barSec, daily: s0.daily, layers: msg.layers, tick: msg.tick, plan: msg.plan, minGap: msg.minGap });
        const codes = new Uint8Array(r.barColors ? s0.bars.length : 0);
        if (r.barColors) r.barColors.forEach((c, i) => { codes[i] = c === "#FFEB3B" ? 1 : c === "#9C27B0" ? 2 : 0; });
        cb({ id: msg.id, seq: msg.seq, items: r.items, plans: r.ctx && r.ctx.plans, info: msg.info ? ctxInfo(r.ctx, s0.bars) : null, codes, hasColors: !!r.barColors, t0: s0.bars.length ? s0.bars[0].t : 0 });
      });
    },
    drop(id) { cbs.delete(id); if (this._st) this._st.delete(id); if (w) w.postMessage({ id, drop: true }); },
  };
})();
function sameCodes(a, at, b, bt) {
  if (!a || !b) return !a && !b;
  if (at !== bt || a.length > b.length + 2 || b.length > a.length + 2) return false;
  const n = Math.min(a.length, b.length) - 1;           // az utolsó gyertyát a frissítés úgyis kezeli
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── A gyenge (kis forgalmú) OKX-kezdet felismerése, instrumentumonként ──
// Az a nap, amelytől legalább 7 egymást követő napon a napi forgalom eléri az utolsó 3 hónap
// napi medián forgalmának 10%-át. Ami előtte van, azt a Hyperliquid USDC adata helyettesíti.
const EXT_TFS = ["1h", "4h", "1D", "1W", "1M"];
const liqCache = new Map();
function liquidStart(inst) {
  if (!liqCache.has(inst.instId)) liqCache.set(inst.instId, (async () => {
    let days = await fetchLatest(inst.instId, "1D");
    for (let k = 0; k < 10 && days.length; k++) {
      const older = await fetchOlder(inst.instId, "1D", days[0].t);
      if (!older.length) break;
      days = merge(older, days);
    }
    const done = days.filter(d => d.done);
    if (!done.length) return 0;
    const recent = done.slice(-90).map(d => d.v).sort((a, b) => a - b);
    const thr = 0.1 * recent[Math.floor(recent.length / 2)];
    let at = done[0].t;
    for (let i = 0; i + 6 < done.length; i++) {
      if (done.slice(i, i + 7).every(d => d.v >= thr)) { at = done[i].t; break; }
    }
    const txt = new Date(at).toLocaleDateString("hu-HU", { timeZone: "UTC" });
    console.info(`[szezso] ${inst.short}: OKX UM adat ettől: ${txt} (előtte Hyperliquid USDC)`);
    liqInfo[inst.short] = txt;
    showLiqInfo();
    return at;
  })().catch(e => { liqCache.delete(inst.instId); throw e; }));
  return liqCache.get(inst.instId);
}
const liqInfo = {};
function showLiqInfo() {
  const t = Object.entries(liqInfo).map(([k, v]) => `${k}: ${v}`).join(" · ");
  setStatus("OKX adat ettől – " + t);
  clearTimeout(showLiqInfo.tm); showLiqInfo.tm = setTimeout(() => setStatus(""), 15000);
}

class DataSet {
  constructor(key, tf) {
    this.key = key; this.tf = tf; this.inst = INSTRUMENTS[key];
    this.bars = []; this.panels = new Set(); this.scene = { items: [] };
    this.wid = ++dsCounter; this.seq = 0;
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
      while (!this.dead && this.bars.length < 1000 && !this.noMoreOlder) {
        if (this.loadingOlder) { await new Promise(r => setTimeout(r, 200)); continue; }
        await this.loadOlder(true);
      }
      this.save();
      this.loadDaily();
      await this.backfill();
      await this.extendHistory();
    } catch (e) { setStatus("Adathiba: " + e.message, "err"); }
  }
  // Az indikátoroknak szükséges előzmény (pl. Milana heti nyitás) visszatöltése a háttérben,
  // egyben, hogy a chart ne ugráljon. A letöltött adat a gyorsítótárba kerül.
  async backfill() {
    if (!this.bars.length) return;
    // legalább HISTORY_BARS gyertya (mint a TradingView ingyenes csomagja), hogy a régi, még nyitott
    // rések és szintek is meglegyenek; és a Milana heti nyitása is benne legyen
    const sec = BARS[this.tf].sec;
    const need = sec >= 86400 ? -Infinity : Math.min(milanaHistoryFrom(Date.now(), sec), Date.now() - HISTORY_BARS * sec * 1000);
    if (!isFinite(need)) return;
    if (!(this.bars[0].t > need)) return;
    while (this.loadingOlder) await new Promise(r => setTimeout(r, 200));
    this.loadingOlder = true;
    const start = this.bars[0].t, before = this.bars.length;
    let acc = this.bars;
    try {
      while (!this.dead && acc[0].t > need) {
        const pct = Math.min(99, Math.round(100 * (start - acc[0].t) / (start - need)));
        setStatus(`előzmény töltése (${this.inst.short} ${this.tf})… ${pct}%`);
        const older = await fetchOlder(this.inst.instId, this.tf, acc[0].t);
        if (!older.length) { this.noMoreOlder = true; break; }
        acc = merge(older, acc);
      }
      if (this.dead) return;
      this.bars = merge(acc, this.bars);   // közben érkezett élő gyertyák megtartása
      this.emitReset(this.bars.length - before);
      this.save();
      setStatus("");
    } catch (e) { setStatus("Előzmény hiba: " + e.message, "err"); }
    finally { this.loadingOlder = false; }
  }
  // Napi gyertyák (előző nap/hét/hónap H/L-hez) az 1D alatti idősíkokon; naponta frissül.
  async loadDaily() {
    if (BARS[this.tf].sec >= 86400) return;
    try {
      this.daily = await fetchLatest(this.inst.instId, "1D");
      this.dailyDay = Math.floor(Date.now() / 86400000);
      if (!this.dead) this.emitReset();
    } catch {}
  }
  save() { saveCandles(this.inst.instId, this.tf, this.bars.filter(b => !b.ext)); }
  // 1D/1W/1M: az OKX X-Perp teljes múltja, előtte a Hyperliquid USDC adat (halványan, jelölve).
  // 1h/4h/1D/1W/1M: az OKX X-Perp kezdete előtti ÉS a gyenge (kis forgalmú) kezdeti szakasza helyett
  // a Hyperliquid USDC gyertyái (halványan). A gyenge kezdet instrumentumonként automatikusan felismerve.
  async extendHistory() {
    if (!EXT_TFS.includes(this.tf) || !this.bars.length || this.bars[0].ext) return;
    const sec = BARS[this.tf].sec * 1000;
    if (this.tf === "1D" || this.tf === "1W" || this.tf === "1M") {
      while (!this.dead && !this.noMoreOlder) {
        if (this.loadingOlder) { await new Promise(r => setTimeout(r, 200)); continue; }
        await this.loadOlder(true);
      }
    }
    if (this.dead || !this.bars.length) return;
    try {
      const ls = await liquidStart(this.inst);
      if (this.dead || this.bars[0].ext) return;
      const real = this.bars.filter(b => !b.ext && b.t >= ls);
      if (!real.length) return;
      const before = this.bars.length, first = real[0].t;
      let ext;
      if (this.tf === "1h" || this.tf === "4h") {
        const start = Math.max(Date.now() - HISTORY_BARS * sec, 0);
        if (first <= start) return;                    // az OKX adat végig jó, nincs mit cserélni
        ext = await hlRange(this.key, this.tf, start, first);
      } else ext = await hlHistory(this.key, this.tf, first);
      if (this.dead || this.bars[0].ext) return;
      if (!ext.length && real.length === this.bars.length) return;
      this.bars = ext.concat(merge(real, this.bars.filter(b => b.t >= first)));
      this.emitReset(this.bars.length - before);
    } catch (e) { setStatus("Hyperliquid előzmény nem érhető el", "err"); }
  }
  // A motor a háttérszálon fut: ide csak a kérés és az eredmény átvétele tartozik.
  compute() {
    if (this.busy) { this.pending = true; return; }
    this.busy = true; this.pending = false;
    const msg = { id: this.wid, seq: ++this.seq, barSec: BARS[this.tf].sec, layers: { ...layers }, tick: this.inst.tick };
    const b = this.bars, first = b.length ? b[0].t : 0;
    if (this.sentFirst === first && b.length >= this.sentLen && b.length - this.sentLen <= 2) msg.tail = b.slice(Math.max(0, this.sentLen - 1));
    else msg.bars = b;
    this.sentFirst = first; this.sentLen = b.length;
    if (this.dailySent !== this.daily) { msg.daily = this.daily || null; this.dailySent = this.daily; }
    engine.send(msg, r => this.onResult(r));
  }
  onResult(r) {
    this.busy = false;
    if (this.dead) return;
    if (r.error) setStatus("Motor hiba: " + r.error, "err");
    else {
      const old = this.codes, oldT0 = this.codesT0;
      this.engItems = r.items.filter(it => !it.pane);
      this.mergeScene();
      this.volScene = { items: r.items.filter(it => it.pane === "vol") };
      this.codes = r.hasColors ? r.codes : null; this.codesT0 = r.t0;
      const recolor = !sameCodes(old, oldT0, this.codes, this.codesT0);
      for (const p of this.panels) p.applyResult(recolor);
    }
    if (this.pending) setTimeout(() => this.compute(), 120);
  }
  // a motor rajzai (a napi tervek számlánként a panelekben kerülnek hozzá)
  mergeScene() { this.scene = { items: this.engItems || [] }; }
  // a gyertya CRT színe (az eredmény a küldéskori gyertyákhoz igazodik, ezért idő szerint keressük)
  colorAt(i) {
    if (!this.codes || !this.bars.length) return null;
    const off = this.codesIndexBase();
    const c = this.codes[i - off];
    return c === 1 ? "#FFEB3B" : c === 2 ? "#9C27B0" : null;
  }
  codesIndexBase() {
    if (this._cb && this._cb.t0 === this.codesT0 && this._cb.first === this.bars[0].t) return this._cb.off;
    let lo = 0, hi = this.bars.length - 1, off = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.bars[m].t < this.codesT0) lo = m + 1; else { off = m; hi = m - 1; } }
    this._cb = { t0: this.codesT0, first: this.bars[0].t, off };
    return off;
  }
  emitReset(shift = 0) { this.compute(); for (const p of this.panels) p.reset(shift); }
  async loadOlder(silent) {
    if (this.loadingOlder || this.noMoreOlder || !this.bars.length || this.dead || this.bars[0].ext) return;
    this.loadingOlder = true;
    try {
      const older = await fetchOlder(this.inst.instId, this.tf, this.bars[0].t);
      if (this.dead) return;
      if (!older.length) { this.noMoreOlder = true; return; }
      const before = this.bars.length;
      this.bars = merge(older, this.bars);
      this.emitReset(silent ? 0 : this.bars.length - before);
      this.save();
    } catch (e) { setStatus("Régebbi adat hiba: " + e.message, "err"); }
    finally { this.loadingOlder = false; }
  }
  onLive(bar) {
    if (!this.bars.length) return;
    const last = this.bars[this.bars.length - 1];
    if (bar.t < last.t) return;
    if (bar.t === last.t) this.bars[this.bars.length - 1] = bar; else this.bars.push(bar);
    if (this.dailyDay !== undefined && Math.floor(Date.now() / 86400000) !== this.dailyDay) { this.dailyDay = undefined; this.loadDaily(); }
    for (const p of this.panels) p.update(bar);
    this.compute();                     // a háttérszál foglaltsága magától ritkítja az élő számolást
    if (bar.done) this.save();
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

let plansVer = 0;
const plans = new PlanManager({
  engine, fetchLatest, fetchOlder, merge, loadCandles, insts: INSTRUMENTS,
  onChange: key => {
    plansVer++;
    for (const ds of hub.sets.values()) if (ds.key === key && !ds.dead) { ds.mergeScene(); for (const p of ds.panels) { p.applyResult(false); p.setTitle(); } }
    renderInfoTab(key);
  },
});
plans.rsiTf = getPref("rsiTf", "1h");
window.szezsoPlans = plans;   // az adatfülhöz és hibakereséshez
setTimeout(() => { window.szezsoHub = hub; });

const hub = {
  tf: BARS[getPref("tf", "15m")] ? getPref("tf", "15m") : "15m",
  sets: new Map(),
  get(key) {
    const k = key + "|" + this.tf;
    if (!this.sets.has(k)) {
      this.sets.set(k, new DataSet(key, this.tf));
      feed.subscribe(INSTRUMENTS[key].instId, this.tf);
      plans.watch(key);
    }
    return this.sets.get(k);
  },
  setTf(tf) {
    for (const ds of this.sets.values()) { ds.dead = true; engine.drop(ds.wid); feed.unsubscribe(ds.inst.instId, ds.tf); }
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
// Gyertya pont: a régi (Hyperliquid) szakasz halványan, a CRT gyertyák színezve (mint a szezsoT barcolor).
function candlePoint(b, crt) {
  const d = { time: chartTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c };
  if (crt) { d.color = crt; d.borderColor = crt; d.wickColor = crt; }
  if (b.ext) { const c = (crt || (b.c >= b.o ? UP : DOWN)) + "59"; d.color = c; d.borderColor = c; d.wickColor = c; }
  return d;
}

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
      this.volLayer = new SceneLayer(() => this.ds ? this.ds.bars : [], () => this.ds ? this.ds.volScene : null, () => BARS[hub.tf].sec);
      this.volume.attachPrimitive(this.volLayer);
    }
    this.layer = new SceneLayer(() => this.ds ? this.ds.bars : [], () => this.ds ? this.panelScene() : null, () => BARS[hub.tf].sec);
    this.candles.attachPrimitive(this.layer);
    // saját rajzok (külön réteg, a motor rajzai fölött)
    this.drawLayer = new SceneLayer(() => this.ds ? this.ds.bars : [], () => ({ items: drawItems(this.key, this.drawDraft) }), () => BARS[hub.tf].sec);
    this.candles.attachPrimitive(this.drawLayer);
    this.draw = new DrawController(this);
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && r.from < 30 && this.ds) this.ds.loadOlder(); this.scheduleHL(); });
    // a látható szakasz csúcsa és alja az ártengelyen (mint a TradingView-n)
    const hl = title => this.candles.createPriceLine({ price: 0, title, color: "#787B86", lineVisible: false, axisLabelVisible: false,
      axisLabelColor: "#E3EFFD", axisLabelTextColor: "#131722" });
    this.hiLine = hl("High"); this.loLine = hl("Low");
    this.titleEl = document.createElement("div");
    this.titleEl.className = "ctitle" + (small ? " small" : "");
    el.appendChild(this.titleEl);
    this.first = true;
  }
  barSec() { return BARS[hub.tf].sec; }
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
    const ds = this.ds;
    this.candles.setData(bars.map((b, i) => candlePoint(b, ds && ds.colorAt(i))));
    if (this.volume) this.volume.setData(bars.map(b => b.ext ? { time: chartTime(b.t) } :
      { time: chartTime(b.t), value: b.v, color: (b.c >= b.o ? UP : DOWN) + "66" }));
    if (bars.length && this.first) {
      this.candles.priceScale().applyOptions({ autoScale: true });   // új idősík/termék: ár-tengely újra automatikus
      ts.scrollToRealTime(); this.first = false;
    }
    else if (r && shift) ts.setVisibleLogicalRange({ from: r.from + shift, to: r.to + shift });
    this.layer.refresh();
    this.setTitle();
  }
  update(b) {
    const ds = this.ds, n = ds ? ds.bars.length : 0;
    this.candles.update(candlePoint(b, ds && ds.bars[n - 1] === b ? ds.colorAt(n - 1) : null));
    if (this.volume) this.volume.update({ time: chartTime(b.t), value: b.v, color: (b.c >= b.o ? UP : DOWN) + "66" });
    this.layer.refresh();
    this.setTitle();
  }
  // a motor új eredménye: ha a CRT színek változtak, újraszínez; különben csak az utolsó gyertya + rajzok
  // a közös motorrajz + ennek a számlának a terve (Fő, Al1 … Al5; számla nélkül a Fő)
  panelScene() {
    const ds = this.ds, n = ds.bars.length;
    if (this._sc && this._sc.base === ds.scene && this._sc.ver === plansVer && this._sc.last === (n && ds.bars[n - 1].t)) return this._sc.scene;
    const pi = layers.plan && n ? plans.items(this.key, ds.bars[n - 1].t, BARS[ds.tf].sec, this.account) : [];
    const scene = { items: ds.scene.items.concat(pi) };
    this._sc = { base: ds.scene, ver: plansVer, last: n && ds.bars[n - 1].t, scene };
    return scene;
  }
  applyResult(recolor) {
    const ds = this.ds, bars = ds ? ds.bars : [];
    if (recolor) this.candles.setData(bars.map((b, i) => candlePoint(b, ds.colorAt(i))));
    else if (bars.length) this.candles.update(candlePoint(bars[bars.length - 1], ds.colorAt(bars.length - 1)));
    this.layer.refresh();
    if (this.volLayer) this.volLayer.refresh();
  }
  scheduleHL() {
    if (this.hlRaf) return;
    this.hlRaf = requestAnimationFrame(() => { this.hlRaf = 0; this.updateHL(); });
  }
  updateHL() {
    const bars = this.ds ? this.ds.bars : [], r = this.chart.timeScale().getVisibleLogicalRange();
    if (!bars.length || !r) { this.hiLine.applyOptions({ axisLabelVisible: false }); this.loLine.applyOptions({ axisLabelVisible: false }); return; }
    const a = Math.max(0, Math.floor(r.from)), b = Math.min(bars.length - 1, Math.ceil(r.to));
    let h = -Infinity, l = Infinity;
    for (let i = a; i <= b; i++) { if (bars[i].h > h) h = bars[i].h; if (bars[i].l < l) l = bars[i].l; }
    const ok = isFinite(h);
    this.hiLine.applyOptions({ price: ok ? h : 0, axisLabelVisible: ok });
    this.loLine.applyOptions({ price: ok ? l : 0, axisLabelVisible: ok });
  }
  setTitle() {
    this.scheduleHL();
    const bars = this.ds ? this.ds.bars : [];
    const last = bars[bars.length - 1];
    const acc = this.account ? `<span class="acc">${this.account}</span> ` : "";
    const name = this.small ? this.inst.short : this.inst.name;
    const pd = this.showBias && plans.data.get(this.key), bias = pd && pd.info ? biasText(pd.info, x => (+x).toFixed(decimals(this.inst.tick))) : "";
    this.titleEl.innerHTML = `${acc}<b>${name}</b> · ${hub.tf}` +
      (last ? ` · <span style="color:${last.c >= last.o ? UP : DOWN}">${last.c.toFixed(decimals(this.inst.tick))}</span>` : "") +
      (bias ? ` · <b style="color:${pd.info.bias.dir > 0 ? UP : DOWN}">${bias}</b>` : "");
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
  if (tab.layout === "data") { plans.watch(tab.key); return { el, panels: [], key: tab.key }; }
  const small = tab.layout !== "single";
  const panels = tab.cells.map(([key, acc], i) => {
    const cell = document.createElement("div");
    cell.className = "cell c" + i;
    el.appendChild(cell);
    // a 3-as elrendezésben a HYPE nagy chart, volumennel
    const p = new ChartPanel(cell, key, acc, small && !(tab.layout === "three" && i === 0));
    p.showBias = tab.layout === "three";      // a hármas charton: „Bull – célár: …”
    return p;
  });
  return { el, panels };
}

// adat- és papírfül újrarajzolása (csak ha épp az látszik)
function renderInfoTab(key) {
  const tab = TABS.find(t => t.id === current);
  if (!tab || tab.layout !== "data" || tab.key !== key) return;
  const v = views.get(current);
  if (!v) return;
  const top = v.el.scrollTop;
  if (tab.paper) renderPaper(v.el, plans, key, () => renderInfoTab(key));
  else renderData(v.el, key, INSTRUMENTS[key], plans);
  v.el.scrollTop = top;
}
function showTab(id) {
  current = id; setPref("tab", id);
  const tab = TABS.find(t => t.id === id);
  if (!views.has(id)) views.set(id, buildView(tab));
  for (const [vid, v] of views) v.el.style.display = vid === id ? "" : "none";
  const v = views.get(id);
  for (const p of v.panels) p.attach(hub.get(p.key));
  if (tab.layout === "data") renderInfoTab(tab.key);
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
// rajzeszközsor: a „Rajz” gombbal nyitható; változáskor minden panel rajzrétege frissül
function allPanels() { return [...views.values()].flatMap(v => v.panels); }
drawState.listeners.add(() => {
  for (const p of allPanels()) { p.drawLayer.refresh(); }
  buildDrawButtons();
});
function buildDrawButtons() {
  const box = document.getElementById("drawbar");
  if (!box) return;
  const open = getPref("drawOpen", false);
  box.innerHTML = "";
  const tog = document.createElement("button");
  tog.className = "tog"; tog.textContent = open ? "Rajz ▴" : "✏️ Rajz";
  tog.onclick = () => { setPref("drawOpen", !open); if (open) { drawState.tool = "select"; } buildDrawButtons(); window.dispatchEvent(new Event("resize")); };
  box.appendChild(tog);
  if (!open) return;
  const inner = document.createElement("span"); inner.className = "group";
  box.appendChild(inner);
  buildDrawBar(inner, () => allPanels().map(p => p.draw));
}
function buildLayerButtons() {
  const box = document.getElementById("layers");
  box.innerHTML = "";
  // a rétegsor összecsukható, hogy több hely maradjon a chartnak
  const open = getPref("layersOpen", true), tog = document.createElement("button");
  tog.className = "tog"; tog.textContent = open ? "Rétegek ▴" : "Rétegek ▾";
  tog.onclick = () => { setPref("layersOpen", !open); buildLayerButtons(); window.dispatchEvent(new Event("resize")); };
  box.classList.toggle("closed", !open);
  box.appendChild(tog);
  for (const { key: k, label } of LAYERS) {
    const b = document.createElement("button");
    b.textContent = label; b.className = layers[k] ? "on" : "";
    b.onclick = () => {
      layers[k] = !layers[k]; setPref("layer." + k, layers[k]); buildLayerButtons();
      for (const ds of hub.sets.values()) { ds.emitReset(); ds.backfill(); }
    };
    box.appendChild(b);
  }
  // az RSI-zárási jel idősíkja (a javaslat TP-inél)
  const r = document.createElement("button");
  r.textContent = "RSI-jel: " + plans.rsiTf; r.className = layers.plan ? "on" : "";
  r.onclick = () => { const o = ["15m", "1h", "4h"], n = o[(o.indexOf(plans.rsiTf) + 1) % o.length]; setPref("rsiTf", n); plans.setRsiTf(n); buildLayerButtons(); };
  box.appendChild(r);
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

// a kézzel beírt azonosító ellenőrzése; ha nem él, keresés a terméklistában (eredmény a tableten tárolva)
async function resolveInsts() {
  await Promise.all(Object.entries(INSTRUMENTS).filter(([, i]) => i.find).map(async ([k, i]) => {
    const saved = getPref("inst." + k, null);
    if (saved) { i.instId = saved; return; }
    if (await instAlive(i.instId)) return;
    const id = await findInstId(i.find);
    if (id) { i.instId = id; setPref("inst." + k, id); }
    else console.warn("[szezso] nem található:", k);
  }));
}

window.addEventListener("DOMContentLoaded", async () => {
  buildTfButtons();
  buildLayerButtons();
  buildDrawButtons();
  await Promise.race([resolveInsts(), new Promise(r => setTimeout(r, 4000))]);
  showTab(current);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
});
