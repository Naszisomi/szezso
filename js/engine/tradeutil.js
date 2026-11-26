export const UNITS = [1, 1, 2, 4];

// TP-k az átlagárhoz: a profit oldalon a legközelebbi 3 szint, egymástól legalább tpGap-re
export function tpsFor(plan, avg) {
  const out = [], d = plan.dir, g = plan.tpGap || 0;
  const lv = plan.levels.filter(x => d > 0 ? x.p > avg + g : x.p < avg - g).sort((x, y) => Math.abs(x.p - avg) - Math.abs(y.p - avg));
  let ref = avg;
  for (const x of lv) { if (out.length === 3) break; if (Math.abs(x.p - ref) >= g) { out.push(x); ref = x.p; } }
  while (out.length < 3) { ref += d * Math.max(g * 4, Math.abs(avg) * 0.005); out.push({ p: ref, why: "nincs stratégiai szint" }); }
  return out;
}
