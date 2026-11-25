// Közös motor: minden építőelemet egyszer számol ki a gyertyákból, és ebből rajzolja
// a bekapcsolt rétegeket. A rétegek csak rajzolnak – a számítás akkor is lefut, ha egy réteg ki van kapcsolva,
// mert a motor (célár, EGYEZÉS, narratíva) használja.
import { nyClock } from "./ny.js";
import { kzSessions, kzLayer, KZ_DEFAULTS } from "./kz.js";
import { milana, MILANA_DEFAULTS } from "../ind/milana.js";

export const LAYERS = [
  { key: "kz",     label: "Killzone",  def: true },
  { key: "milana", label: "Milana",    def: true },
];

// input: { bars, barSec, daily, layers:{kz:true,...} } -> { items, ctx }
export function runEngine({ bars, barSec, daily, layers }) {
  const items = [];
  if (!bars.length) return { items, ctx: null };
  const ny = nyClock(bars);
  const sessions = kzSessions(bars, ny, KZ_DEFAULTS);
  const ctx = { ny, sessions };

  if (layers.kz) items.push(...kzLayer(bars, barSec, ny, sessions, daily, KZ_DEFAULTS));
  if (layers.milana) items.push(...milana(bars, barSec, MILANA_DEFAULTS).items);
  return { items, ctx };
}
