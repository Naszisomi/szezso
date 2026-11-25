// Közös motor: minden építőelemet egyszer számol ki a gyertyákból, és ebből rajzolja
// a bekapcsolt rétegeket. A rétegek csak rajzolnak – a számítás akkor is lefut, ha egy réteg ki van kapcsolva,
// mert a motor (célár, EGYEZÉS, narratíva) használja.
import { nyClock } from "./ny.js";
import { kzSessions, kzLayer, KZ_DEFAULTS } from "./kz.js";
import { milana, MILANA_DEFAULTS } from "../ind/milana.js";
import { atr, computeGaps, gapLayer, crtColors } from "./gaps.js";

export const LAYERS = [
  { key: "kz",     label: "Killzone",  def: true },
  { key: "milana", label: "Milana",    def: true },
  { key: "gaps",   label: "Rések",     def: true },
  { key: "crt",    label: "CRT szín",  def: true },
];

// input: { bars, barSec, daily, layers:{kz:true,...} } -> { items, ctx, barColors }
export function runEngine({ bars, barSec, daily, layers }) {
  const items = [];
  if (!bars.length) return { items, ctx: null };
  const ny = nyClock(bars);
  const sessions = kzSessions(bars, ny, KZ_DEFAULTS);
  const atr14 = atr(bars, 14);
  const gaps = computeGaps(bars, barSec, atr14);
  const ctx = { ny, sessions, atr14, gaps };

  if (layers.kz) items.push(...kzLayer(bars, barSec, ny, sessions, daily, KZ_DEFAULTS));
  if (layers.milana) items.push(...milana(bars, barSec, MILANA_DEFAULTS).items);
  if (layers.gaps) items.push(...gapLayer(bars, barSec, gaps));
  const barColors = layers.crt ? crtColors(bars) : null;
  return { items, ctx, barColors };
}
