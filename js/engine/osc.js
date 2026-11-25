// Oszcillátorok és mozgóátlagok (rejtett igazolás):
//  RSI(14, Wilder), KDJ(9,3,3), EMA/SMA 50/100/200 a saját idősíkon és a napi gyertyákból,
//  keresztezések (golden/death cross, ár × átlag, K × D), RSI-divergencia a swingeken.

export function ema(src, len) {
  const out = new Float64Array(src.length), k = 2 / (len + 1);
  let prev = NaN, sum = 0;
  for (let i = 0; i < src.length; i++) {
    if (i < len) { sum += src[i]; prev = i === len - 1 ? sum / len : NaN; }   // Pine: az első érték SMA
    else prev = src[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
export function sma(src, len) {
  const out = new Float64Array(src.length); let s = 0;
  for (let i = 0; i < src.length; i++) { s += src[i]; if (i >= len) s -= src[i - len]; out[i] = i >= len - 1 ? s / len : NaN; }
  return out;
}
export function rsi(close, len = 14) {
  const out = new Float64Array(close.length).fill(NaN);
  let up = 0, dn = 0;
  for (let i = 1; i < close.length; i++) {
    const ch = close[i] - close[i - 1], u = Math.max(ch, 0), d = Math.max(-ch, 0);
    if (i <= len) { up += u; dn += d; if (i === len) { up /= len; dn /= len; } else continue; }
    else { up = (up * (len - 1) + u) / len; dn = (dn * (len - 1) + d) / len; }
    out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}
export function kdj(bars, n = 9, m1 = 3, m2 = 3) {
  const N = bars.length, K = new Float64Array(N), D = new Float64Array(N), J = new Float64Array(N);
  let k = 50, d = 50;
  for (let i = 0; i < N; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = Math.max(0, i - n + 1); j <= i; j++) { hh = Math.max(hh, bars[j].h); ll = Math.min(ll, bars[j].l); }
    const rsv = hh > ll ? (bars[i].c - ll) / (hh - ll) * 100 : 50;
    k = ((m1 - 1) * k + rsv) / m1; d = ((m2 - 1) * d + k) / m2;
    K[i] = k; D[i] = d; J[i] = 3 * k - 2 * d;
  }
  return { K, D, J };
}

function crosses(a, b, from) {
  const out = [];
  for (let i = Math.max(1, from); i < a.length; i++) {
    if ([a[i], b[i], a[i - 1], b[i - 1]].some(isNaN)) continue;
    if (a[i - 1] <= b[i - 1] && a[i] > b[i]) out.push({ i, up: true });
    else if (a[i - 1] >= b[i - 1] && a[i] < b[i]) out.push({ i, up: false });
  }
  return out;
}

// egyszerű swing-pontok (len gyertya mindkét oldalon)
export function swings(bars, len = 5) {
  const hi = [], lo = [];
  for (let i = len; i < bars.length - len; i++) {
    let isH = true, isL = true;
    for (let j = i - len; j <= i + len && (isH || isL); j++) {
      if (j === i) continue;
      if (j < i ? bars[j].h >= bars[i].h : bars[j].h > bars[i].h) isH = false;
      if (j < i ? bars[j].l <= bars[i].l : bars[j].l < bars[i].l) isL = false;
    }
    if (isH) hi.push(i);
    if (isL) lo.push(i);
  }
  return { hi, lo };
}

export function oscillators(bars, daily) {
  const N = bars.length;
  if (N < 30) return null;
  const close = bars.map(b => b.c);
  const r = rsi(close), kd = kdj(bars);
  const E = { 50: ema(close, 50), 100: ema(close, 100), 200: ema(close, 200) };
  const S = { 50: sma(close, 50), 100: sma(close, 100), 200: sma(close, 200) };
  const from = Math.max(1, N - 300);                  // csak a közelmúlt keresztezései érdekesek
  const cross = {
    golden: crosses(E[50], E[200], from).filter(c => c.up), death: crosses(E[50], E[200], from).filter(c => !c.up),
    e50_100: crosses(E[50], E[100], from), e100_200: crosses(E[100], E[200], from),
    priceE50: crosses(close, E[50], from), priceE200: crosses(close, E[200], from), kd: crosses(kd.K, kd.D, from),
  };
  // RSI-divergencia az utolsó két swingen
  const sw = swings(bars, 5), div = [];
  const h = sw.hi.slice(-2), l = sw.lo.slice(-2);
  if (h.length === 2 && bars[h[1]].h > bars[h[0]].h && r[h[1]] < r[h[0]]) div.push({ bear: true, i: h[1], from: h[0] });
  if (l.length === 2 && bars[l[1]].l < bars[l[0]].l && r[l[1]] > r[l[0]]) div.push({ bear: false, i: l[1], from: l[0] });
  // napi EMA / SMA szintek (a napi gyertyákból, minden idősíkon szintként)
  let dailyLv = null;
  if (daily && daily.length >= 50) {
    const dc = daily.map(b => b.c), L = dc.length - 1, lv = {};
    for (const n of [50, 100, 200]) if (dc.length >= n) { lv["EMA" + n] = ema(dc, n)[L]; lv["SMA" + n] = sma(dc, n)[L]; }
    dailyLv = lv;
  }
  const last = N - 1;
  return {
    rsi: r[last], rsiState: r[last] >= 70 ? "túlvett" : r[last] <= 30 ? "túladott" : "semleges",
    k: kd.K[last], d: kd.D[last], j: kd.J[last],
    ema: { 50: E[50][last], 100: E[100][last], 200: E[200][last] }, sma: { 50: S[50][last], 100: S[100][last], 200: S[200][last] },
    cross, div, dailyLv, series: { rsi: r, K: kd.K, D: kd.D, J: kd.J },
  };
}
