// OKX nyilvános piaci adatok (kulcs nélkül): REST gyertyák + WebSocket élő gyertyák.
// A teszt szerint a globális cím (www.okx.com) a böngészőből közvetlenül elérhető,
// és ugyanazt az európai X-Perp adatot adja, mint a TradingView OKX:…UM… szimbólumai.

export const REST = "https://www.okx.com";
export const WS_BUSINESS = "wss://ws.okx.com:8443/ws/v5/business";

// Idősík -> OKX bar kód. A napi/heti/havi gyertya UTC szerint (mint a TradingView).
export const BARS = {
  "5m":  { okx: "5m",    sec: 300 },
  "15m": { okx: "15m",   sec: 900 },
  "1h":  { okx: "1H",    sec: 3600 },
  "4h":  { okx: "4H",    sec: 14400 },
  "1D":  { okx: "1Dutc", sec: 86400 },
  "1W":  { okx: "1Wutc", sec: 604800 },
  "1M":  { okx: "1Mutc", sec: 2592000 },   // a hónap hossza változó; csak a jövőbe rajzoláshoz közelítés
};

// OKX gyertya-sor: [ts, o, h, l, c, vol(szerz.), volCcy(coin), volCcyQuote(USD), confirm]
// Belső formátum: {t (ms, UTC), o, h, l, c, v (USD-volumen, mint a TradingView-n), done}
export function parseRow(r) {
  return { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[7], done: r[8] === "1" };
}

async function getJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 429) { await sleep(1200); return getJson(url); }
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  if (j.code !== "0") throw new Error("OKX " + j.code + ": " + j.msg);
  return j.data;
}
const sleep = ms => new Promise(res => setTimeout(res, ms));

// Termék keresése a nyilvános terméklistában (ha a beírt azonosító nem él), pl. /^BNB-USD_UM_XPERP-3105/
export async function findInstId(re) {
  for (const t of ["FUTURES", "SWAP"]) {
    try { const d = await getJson(`${REST}/api/v5/public/instruments?instType=${t}`); const x = d.find(i => re.test(i.instId)); if (x) return x.instId; } catch {}
  }
  return null;
}
export async function instAlive(instId) {
  try { const d = await getJson(`${REST}/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=1H&limit=1`); return d.length > 0; } catch { return false; }
}

// A legfrissebb (legfeljebb 300) gyertya, növekvő időrendben.
export async function fetchLatest(instId, tf) {
  const d = await getJson(`${REST}/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${BARS[tf].okx}&limit=300`);
  return d.map(parseRow).reverse();
}

// Régebbi gyertyák egy adott időpont (ms) előttről, legfeljebb 100, növekvő időrendben.
export async function fetchOlder(instId, tf, beforeMs) {
  const d = await getJson(`${REST}/api/v5/market/history-candles?instId=${encodeURIComponent(instId)}&bar=${BARS[tf].okx}&after=${beforeMs}&limit=100`);
  return d.map(parseRow).reverse();
}

// Élő gyertyák WebSocketen, automatikus újrakapcsolódással.
// onCandle(instId, tf, candle), onState("ok" | "connecting" | "down")
export class LiveFeed {
  constructor(onCandle, onState) {
    this.onCandle = onCandle;
    this.onState = onState || (() => {});
    this.subs = new Map();           // kulcs: instId|tf
    this.ws = null;
    this.retry = 0;
    this.pingTimer = null;
    this.closedByUser = false;
    this.onReconnect = null;         // hívódik újrakapcsolódás után (hézag pótlásához)
    this.connect();
  }
  key(instId, tf) { return instId + "|" + tf; }
  arg(instId, tf) { return { channel: "candle" + BARS[tf].okx, instId }; }

  connect() {
    this.onState("connecting");
    const ws = new WebSocket(WS_BUSINESS);
    this.ws = ws;
    ws.onopen = () => {
      const wasRetry = this.retry > 0;
      this.retry = 0;
      this.onState("ok");
      const args = [...this.subs.values()].map(s => this.arg(s.instId, s.tf));
      if (args.length) ws.send(JSON.stringify({ op: "subscribe", args }));
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => { if (ws.readyState === 1) ws.send("ping"); }, 25000);
      if (wasRetry && this.onReconnect) this.onReconnect();
    };
    ws.onmessage = ev => {
      if (ev.data === "pong") return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m.data || !m.arg) return;
      const ch = m.arg.channel;                        // pl. "candle15m"
      const tf = Object.keys(BARS).find(k => "candle" + BARS[k].okx === ch);
      if (!tf) return;
      for (const r of m.data) this.onCandle(m.arg.instId, tf, parseRow(r));
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.closedByUser) return;
      this.onState("down");
      this.retry++;
      setTimeout(() => this.connect(), Math.min(15000, 1000 * this.retry));
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  subscribe(instId, tf) {
    const k = this.key(instId, tf);
    if (this.subs.has(k)) return;
    this.subs.set(k, { instId, tf });
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ op: "subscribe", args: [this.arg(instId, tf)] }));
  }
  unsubscribe(instId, tf) {
    const k = this.key(instId, tf);
    if (!this.subs.has(k)) return;
    this.subs.delete(k);
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ op: "unsubscribe", args: [this.arg(instId, tf)] }));
  }
}
