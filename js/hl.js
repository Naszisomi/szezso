// Hyperliquid nyilvános adatok (kulcs nélkül) – csak a régi napi/heti/havi előzmény pótlására,
// az OKX UM X-Perp kezdete előtti időszakra. USDC-ben jegyzett párok.
//  HYPE: HYPE/USDC spot ("@107"), ha az üres, a HYPE-USDC perp; BTC, ETH: USDC perp.
import { loadCandles, saveCandles } from "./store.js";

const INFO = "https://api.hyperliquid.xyz/info";
const SOURCES = { HYPE: ["@107", "HYPE"], BTC: ["BTC"], ETH: ["ETH"] };
const DAY = 86400000;

async function snapshot(coin, interval, startTime, endTime) {
  const r = await fetch(INFO, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } }),
  });
  if (!r.ok) throw new Error("Hyperliquid HTTP " + r.status);
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

// Napi gyertyák (UTC), a legrégebbitől. A volumen USD-becslés (darab × záróár).
export async function hlDaily(key) {
  const coins = SOURCES[key];
  if (!coins) return [];
  const cacheKey = "HL:" + key;
  const cached = await loadCandles(cacheKey, "1D");
  // A régi szakasz nem változik; naponta legfeljebb egyszer frissítjük.
  if (cached.length && Date.now() - cached[cached.length - 1].t < 2 * DAY) return cached;
  for (const coin of coins) {
    const rows = await snapshot(coin, "1d", Date.now() - 4900 * DAY, Date.now());
    if (rows.length) {
      const out = rows.map(x => ({ t: +x.t, o: +x.o, h: +x.h, l: +x.l, c: +x.c, v: +x.v * +x.c, done: true, src: coin }))
        .sort((a, b) => a.t - b.t);
      saveCandles(cacheKey, "1D", out);
      return out;
    }
  }
  return cached;
}

// Napi gyertyákból heti (hétfő 00:00 UTC) vagy havi (hónap 1., 00:00 UTC) gyertya.
function bucketStart(t, tf) {
  const d = new Date(t);
  if (tf === "1M") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (tf === "1W") { const wd = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - wd); }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
export function aggregate(days, tf) {
  if (tf === "1D") return days.map(b => ({ ...b }));
  const out = [];
  for (const b of days) {
    const t = bucketStart(b.t, tf);
    const cur = out[out.length - 1];
    if (cur && cur.t === t) { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
    else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, done: true, src: b.src });
  }
  return out;
}

// A megadott idősíkhoz az előzmény a `beforeMs` előtti részre (ext: true jelöléssel).
export async function hlHistory(key, tf, beforeMs) {
  const days = await hlDaily(key);
  return aggregate(days, tf).filter(b => b.t < beforeMs).map(b => ({ ...b, ext: true }));
}

// 1h / 4h gyertyák egy időszakra (a régi szakasz nem változik, ezért a gyorsítótár elég, ha lefedi).
const HL_IV = { "1h": "1h", "4h": "4h" };
export async function hlRange(key, tf, start, end) {
  const iv = HL_IV[tf], coins = SOURCES[key];
  if (!iv || !coins || end <= start) return [];
  const cacheKey = "HL:" + key, sec = tf === "1h" ? 3600000 : 14400000;
  const cached = await loadCandles(cacheKey, tf);
  const covers = cached.length && cached[0].t <= start + sec && cached[cached.length - 1].t >= end - 2 * sec;
  let rows = cached;
  if (!covers) {
    for (const coin of coins) {
      const d = await snapshot(coin, iv, start, end);
      if (d.length) {
        rows = d.map(x => ({ t: +x.t, o: +x.o, h: +x.h, l: +x.l, c: +x.c, v: +x.v * +x.c, done: true, src: coin })).sort((a, b) => a.t - b.t);
        saveCandles(cacheKey, tf, rows);
        break;
      }
    }
  }
  return rows.filter(b => b.t >= start && b.t < end).map(b => ({ ...b, ext: true }));
}
