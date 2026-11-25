// Közös motor: minden építőelemet egyszer számol ki a gyertyákból, és ebből rajzolja
// a bekapcsolt rétegeket. A rétegek csak rajzolnak – a számítás akkor is lefut, ha egy réteg ki van kapcsolva,
// mert a motor (célár, EGYEZÉS, narratíva) használja.
import { nyClock } from "./ny.js";
import { kzSessions, kzLayer, KZ_DEFAULTS } from "./kz.js";
import { milana, MILANA_DEFAULTS } from "../ind/milana.js";
import { atr, computeGaps, gapLayer, crtColors } from "./gaps.js";
import { volumeProfile, vpArrowLayer } from "./vp.js";
import { orderBlocks, liquidity, volumaticFvg, htfLevels } from "./struct.js";
import { oscillators } from "./osc.js";
import { gannEvents, gannTimeScore, GANN_YEARS } from "./gann.js";

export const LAYERS = [
  { key: "kz",     label: "Killzone",  def: true },
  { key: "milana", label: "Milana",    def: true },
  { key: "gaps",   label: "Rések",     def: true },
  { key: "crt",    label: "CRT szín",  def: true },
  { key: "vp",     label: "VP nyíl",   def: true },
];

// input: { bars, barSec, daily, layers:{kz:true,...} } -> { items, ctx, barColors }
export function runEngine({ bars, barSec, daily, layers, tick }) {
  const items = [];
  if (!bars.length) return { items, ctx: null };
  const ny = nyClock(bars);
  const sessions = kzSessions(bars, ny, KZ_DEFAULTS);
  const atr14 = atr(bars, 14);
  const gaps = computeGaps(bars, barSec, atr14);
  const vp = volumeProfile(bars, tick);
  const ctx = { ny, sessions, atr14, gaps, vp,
    ob: orderBlocks(bars), liq: liquidity(bars), vfvg: volumaticFvg(bars), htf: htfLevels(bars, barSec, daily),
    osc: oscillators(bars, daily) };
  const now = bars[bars.length - 1].t;
  ctx.gann = gannEvents(daily, now - 30 * 86400000, now + 120 * 86400000);
  ctx.gannNow = gannTimeScore(ctx.gann, now);
  ctx.gannYear = GANN_YEARS[new Date(now).getUTCFullYear()] || null;

  if (layers.kz) items.push(...kzLayer(bars, barSec, ny, sessions, daily, KZ_DEFAULTS));
  if (layers.milana) items.push(...milana(bars, barSec, MILANA_DEFAULTS).items);
  if (layers.gaps) items.push(...gapLayer(bars, barSec, gaps));
  if (layers.vp) items.push(...vpArrowLayer(bars, vp));
  const barColors = layers.crt ? crtColors(bars) : null;
  return { items, ctx, barColors };
}
