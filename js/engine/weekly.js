// Heti ICT-profil: a futó hét eddigi New York-i kereskedési napjait (H–P, hétvége nélkül) a 12 sablonhoz méri.
//  Az eddigi napokat és a sablon azonos napjait is a saját (eddigi) tartományukra méretezi, és az
//  [nyitó, záró, max, min] eltérésből hasonlóságot számol; ezt a múltbeli hetek gyakoriságával súlyozza.
//  Az azonos alakú párok (pl. Seek & Destroy = Consolidation Thursday Reversal) közös százalékot kapnak,
//  mindkét névvel.
import { WEEKLY_PROFILES } from "./weekly_profiles.js";

function nyDays(bars, ny) {
  const days = [];
  for (let i = 0; i < bars.length; i++) {
    const wd = ny.wd[i];
    if (wd === 0 || wd === 6) continue;              // hétvége nélkül
    const b = bars[i], d = days[days.length - 1];
    if (!d || d.key !== ny.day[i]) days.push({ key: ny.day[i], wd, o: b.o, h: b.h, l: b.l, c: b.c });
    else { d.h = Math.max(d.h, b.h); d.l = Math.min(d.l, b.l); d.c = b.c; }
  }
  // hetekre bontás (hétfőtől)
  const weeks = [];
  for (const d of days) {
    const w = weeks[weeks.length - 1];
    if (!w || d.wd <= w[w.length - 1].wd) weeks.push([d]); else w.push(d);
  }
  return weeks;
}

function norm(days) {
  let hi = -Infinity, lo = Infinity;
  for (const d of days) { hi = Math.max(hi, d.h); lo = Math.min(lo, d.l); }
  const r = hi - lo || 1;
  return days.map(d => [(d.o - lo) / r, (d.c - lo) / r, (d.h - lo) / r, (d.l - lo) / r]);
}

function score(actual, tpl) {
  const n = actual.length;
  const t = norm(tpl.days.slice(0, n).map(([o, c, h, l]) => ({ o, c, h, l })));
  const a = norm(actual);
  let d = 0;
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) d += Math.abs(a[i][k] - t[i][k]);
  return Math.exp(-3 * d / (4 * n));
}

export function weeklyProfile(bars, barSec, ny) {
  if (barSec > 3600) return null;                     // NY-napokhoz napon belüli gyertyák kellenek
  const weeks = nyDays(bars, ny);
  if (!weeks.length) return null;
  const cur = weeks[weeks.length - 1];
  // múltbeli gyakoriság (a lezárt, teljes heteken melyik sablon illett a legjobban)
  const freq = new Map(WEEKLY_PROFILES.map(p => [p.id, 1]));
  for (const w of weeks.slice(0, -1)) if (w.length === 5) {
    let best = null, bs = -1;
    for (const p of WEEKLY_PROFILES) { const s = score(w, p); if (s > bs) { bs = s; best = p.id; } }
    freq.set(best, freq.get(best) + 1);
  }
  // azonos alakú párok összevonása
  const groups = new Map();
  for (const p of WEEKLY_PROFILES) {
    const key = [p.id, p.same].filter(Boolean).sort().join("|");
    const g = groups.get(key) || { names: [], ids: [], dir: p.dir, w: 0, tpl: p };
    if (!g.ids.includes(p.id)) { g.names.push(p.name); g.ids.push(p.id); g.w += score(cur, p) * freq.get(p.id); }
    groups.set(key, g);
  }
  const list = [...groups.values()], tot = list.reduce((s, g) => s + g.w, 0) || 1;
  list.forEach(g => g.p = g.w / tot);
  list.sort((a, b) => b.p - a.p);
  const top = list[0];
  // a legvalószínűbb sablon hátralévő napjai: várható irány a hét végéig
  const n = cur.length, rest = top.tpl.days.slice(n);
  return { days: n, list: list.slice(0, 4).map(g => ({ name: g.names.join(" / "), dir: g.dir, p: g.p })),
    dir: top.dir, restPath: rest.map(([o, c]) => Math.sign(c - o)) };
}
