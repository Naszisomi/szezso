// Volumenprofil (Volume Profile Anatomies számítása): POC / VAH / VAL, alakzat (D / B / P / dupla zóna)
// és a trendnyíl az elmúlt `look` gyertyán (felfelé zöld, lefelé piros), a gyertyák fölött/alatt 2 sorral.
export const VP_DEFAULTS = { look: 100, rows: 30, va: 0.70, smooth: 2, second: 0.60, valley: 0.70, posHi: 0.66, posLo: 0.34,
  up: "#1aa88a", dn: "#e5383b" };

function valueArea(v, poc, pct) {
  const n = v.length, total = v.reduce((a, b) => a + b, 0);
  let acc = v[poc], up = poc, dn = poc;
  while (acc < total * pct && (up < n - 1 || dn > 0)) {
    const upV = up < n - 1 ? v[up + 1] : -1, dnV = dn > 0 ? v[dn - 1] : -1;
    if (upV >= dnV) { up++; acc += upV; } else { dn--; acc += dnV; }
  }
  return [up, dn];
}

function classify(v, cfg) {
  const n = v.length;
  let s = v.slice();
  for (let p = 0; p < cfg.smooth; p++) {
    const t = s.slice();
    for (let i = 0; i < n; i++) s[i] = (t[Math.max(i - 1, 0)] + 2 * t[i] + t[Math.min(i + 1, n - 1)]) / 4;
  }
  const pocV = Math.max(...s), poc = s.indexOf(pocV), minSep = Math.max(3, Math.round(n * 0.2));
  let p2 = -1, p2V = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(i - poc) < minSep) continue;
    const cv = s[i], lv = s[Math.max(i - 1, 0)], rv = s[Math.min(i + 1, n - 1)];
    if ((i === 0 || cv >= lv) && (i === n - 1 || cv >= rv) && cv > p2V) { p2V = cv; p2 = i; }
  }
  let kind = 0;
  if (p2 >= 0 && p2V >= cfg.second * pocV) {
    let valley = pocV;
    for (let j = Math.min(poc, p2); j <= Math.max(poc, p2); j++) valley = Math.min(valley, s[j]);
    if (valley <= cfg.valley * p2V) kind = 4;
  }
  if (!kind) { const pos = n > 1 ? poc / (n - 1) : 0.5; kind = pos > cfg.posHi ? 3 : pos < cfg.posLo ? 2 : 1; }
  return kind;
}

export function volumeProfile(bars, tick, cfg = VP_DEFAULTS) {
  const N = bars.length;
  if (N < 26) return null;
  const lb = Math.min(cfg.look, N), from = N - lb;
  let hi = -Infinity, lo = Infinity;
  for (let i = from; i < N; i++) { if (bars[i].h > hi) hi = bars[i].h; if (bars[i].l < lo) lo = bars[i].l; }
  const stp = Math.max((hi - lo) / cfg.rows, tick || 1e-9);
  const vols = new Array(cfg.rows).fill(0);
  const row = p => Math.max(0, Math.min(cfg.rows - 1, Math.floor((p - lo) / stp)));
  for (let i = from; i < N; i++) {
    const b = bars[i], bv = b.v > 0 ? b.v : 1, r0 = row(b.l), r1 = row(b.h);
    if (b.h - b.l <= 0) { vols[r0] += bv; continue; }
    for (let r = r0; r <= r1; r++) {
      const rl = lo + r * stp, ov = Math.max(0, Math.min(b.h, rl + stp) - Math.max(b.l, rl));
      vols[r] += bv * ov / (b.h - b.l);
    }
  }
  const kind = classify(vols, cfg);
  const pocI = vols.indexOf(Math.max(...vols));
  const [upI, dnI] = valueArea(vols, pocI, cfg.va);
  const cStart = bars[from].c, cEnd = bars[N - 1].c, up = cEnd >= cStart;
  return { from, lb, hi, lo, stp, vols, kind, up,
    poc: lo + (pocI + 0.5) * stp, vah: lo + (upI + 1) * stp, val: lo + dnI * stp, cStart, cEnd };
}

export function vpArrowLayer(bars, vp, cfg = VP_DEFAULTS) {
  if (!vp) return [];
  const shift = (vp.up ? -1 : 1) * vp.stp * 2;
  return [{ type: "line", t1: bars[vp.from].t, p1: vp.cStart + shift, t2: bars[bars.length - 1].t, p2: vp.cEnd + shift,
    color: vp.up ? cfg.up : cfg.dn, width: 3, arrow: true }];
}
