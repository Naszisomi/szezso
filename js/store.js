// A letöltött gyertyák tárolása a tableten (IndexedDB), hogy gyorsan induljon,
// és idővel egyre több múltbeli nap legyen meg a statisztikákhoz.

const DB = "szezso";
const STORE = "candles";
const MAX_BARS = 30000;   // idősíkonként ennyi gyertyát tart meg

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function loadCandles(instId, tf) {
  try {
    const db = await open();
    return await new Promise(res => {
      const q = db.transaction(STORE).objectStore(STORE).get(instId + "|" + tf);
      q.onsuccess = () => res(q.result || []);
      q.onerror = () => res([]);
    });
  } catch { return []; }
}

export async function saveCandles(instId, tf, bars) {
  try {
    const db = await open();
    const data = bars.length > MAX_BARS ? bars.slice(bars.length - MAX_BARS) : bars;
    db.transaction(STORE, "readwrite").objectStore(STORE).put(data, instId + "|" + tf);
  } catch { /* a tárolás csak gyorsítás, hiba esetén nem gond */ }
}

// Két növekvő gyertyalista összefésülése idő szerint (az újabb adat felülírja a régit).
export function merge(a, b) {
  const m = new Map();
  for (const x of a) m.set(x.t, x);
  for (const x of b) m.set(x.t, x);
  return [...m.values()].sort((x, y) => x.t - y.t);
}

// Beállítások (számlafül, idősík, elrendezés) megjegyzése.
export function getPref(k, d) { try { const v = localStorage.getItem("szezso." + k); return v === null ? d : JSON.parse(v); } catch { return d; } }
export function setPref(k, v) { try { localStorage.setItem("szezso." + k, JSON.stringify(v)); } catch {} }
