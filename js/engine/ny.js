// New York-i óra a gyertyákhoz (nyári/téli időszámítással), egyszer kiszámolva a motor összes moduljának.
// min[i]: a gyertya nyitásának NY-i perce a napon belül (0..1439); day[i]: NY-i nap kulcsa (ééééhhnn);
// wd[i]: a NY-i nap a héten (0 = vasárnap).

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const offCache = new Map();     // UTC-óra -> NY eltolás (perc)

export function nyOffsetMin(ms) {
  const hk = Math.floor(ms / 3600000);
  let off = offCache.get(hk);
  if (off === undefined) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(hk * 3600000)).map(x => [x.type, x.value]));
    off = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - hk * 3600000) / 60000);
    if (offCache.size > 50000) offCache.clear();
    offCache.set(hk, off);
  }
  return off;
}

export function nyClock(bars) {
  const n = bars.length, min = new Int16Array(n), day = new Int32Array(n), wd = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const loc = bars[i].t + nyOffsetMin(bars[i].t) * 60000;   // "NY-i falióra" UTC-ként kezelve
    const d = new Date(loc);
    min[i] = d.getUTCHours() * 60 + d.getUTCMinutes();
    day[i] = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    wd[i] = d.getUTCDay();
  }
  return { min, day, wd };
}

// "HHMM-HHMM" -> [kezdő perc, záró perc]; a 0000 vég éjfélt (1440) jelent.
export function parseSession(s) {
  const [a, b] = s.split("-");
  const m = x => +x.slice(0, 2) * 60 + +x.slice(2, 4);
  let e = m(b); if (e === 0) e = 1440;
  return [m(a), e];
}
export function inSession(minute, [s, e]) {
  return s < e ? minute >= s && minute < e : minute >= s || minute < e;
}
