// Rajzoló réteg: a Pine Script rajzelemeinek megfelelői (doboz, vonal, felirat, tört vonal),
// a Lightweight Charts „series primitive” bővítményén keresztül.
// Az elemek koordinátái: idő (ms, UTC – lehet a jövőben is) és ár.
//
// Elem-formátumok (scene.items):
//  { type:"line",  t1,p1,t2,p2, color, width, style:"solid"|"dashed"|"dotted", arrow:false }
//  { type:"box",   t1,p1,t2,p2, border, borderWidth, bg, text, textColor, textSize, hAlign:"left"|"center"|"right" }
//  { type:"label", t,p, text, color, bg, size, align:"left"|"center"|"right", vAlign:"middle"|"above"|"below" }
//  { type:"poly",  points:[{t,p}], color, width, style, arrow:false }
//  { type:"vline", t, color, width, style }   – függőleges vonal a panel teljes magasságában
//  { type:"hline", p, t1?, color, width, style } – vízszintes vonal a teljes szélességben (t1-gyel: sugár jobbra)
//  { type:"dot",   t,p, r, color, fill }          – kör képpontban (a rajzok fogópontjai)
// A feliratok legkisebb mérete 12 px (ne legyen „hangyányi”).

export function rgba(hex, transp = 0) {          // transp: 0..100, mint a Pine-ban
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${(100 - transp) / 100})`;
}

const DASH = { solid: [], dashed: [6, 4], dotted: [2, 3] };
const MIN_FONT = 12;

export class SceneLayer {
  // getBars(): a panel aktuális gyertyái; getScene(): {items}; barSec: gyertyahossz mp-ben
  constructor(getBars, getScene, getBarSec) {
    this.getBars = getBars; this.getScene = getScene; this.getBarSec = getBarSec;
    // a dobozok és függőlegesek a gyertyák MÖGÖTT, a vonalak és feliratok előttük
    this._back = { renderer: () => ({ draw: target => this.draw(target, true) }), zOrder: () => "bottom" };
    this._view = { renderer: () => ({ draw: target => this.draw(target, false) }), zOrder: () => "top" };
  }
  attached(p) { this.chart = p.chart; this.series = p.series; this.requestUpdate = p.requestUpdate; }
  detached() { this.chart = null; }
  updateAllViews() {}
  paneViews() { return [this._back, this._view]; }
  refresh() { if (this.requestUpdate) this.requestUpdate(); }

  // idő (ms) -> x képpont; a jövőbeli időpontokat a gyertyahosszal vetíti előre
  x(t) {
    const bars = this.getBars();
    if (!bars.length) return null;
    const sec = this.getBarSec() * 1000;
    let logical;
    const last = bars.length - 1;
    if (t >= bars[last].t) logical = last + (t - bars[last].t) / sec;
    else if (t <= bars[0].t) logical = (t - bars[0].t) / sec;
    else {
      let lo = 0, hi = last;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bars[m].t <= t) lo = m; else hi = m; }
      logical = lo + (t - bars[lo].t) / Math.max(1, bars[hi].t - bars[lo].t);
    }
    // a Lightweight Charts az adatokon túli TÖRT logikai indexre 0-t ad (ettől nyúltak vissza a rajzok a chart bal szélére),
    // ezért két egész index koordinátája között interpolálunk
    const ts = this.chart.timeScale(), i0 = Math.floor(logical), fr = logical - i0;
    const c0 = ts.logicalToCoordinate(i0);
    if (c0 == null || fr === 0) return c0;
    const c1 = ts.logicalToCoordinate(i0 + 1);
    return c1 == null ? c0 : c0 + (c1 - c0) * fr;
  }
  y(p) { return this.series.priceToCoordinate(p); }

  draw(target, back) {
    const scene = this.getScene();
    if (!scene || !scene.items.length || !this.chart) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      // a szétválogatás jelenetenként egyszer (nem minden képkockánál)
      if (!scene._sorted) {
        const order = { box: 0, vline: 1, line: 1, hline: 1, poly: 2, label: 3, dot: 4 };
        const isBack = it => it.type === "box" || it.type === "vline";
        const all = [...scene.items].sort((a, b) => order[a.type] - order[b.type]);
        scene._sorted = { back: all.filter(isBack), front: all.filter(it => !isBack(it)) };
      }
      const items = back ? scene._sorted.back : scene._sorted.front;
      for (const it of items) {
        try { this[it.type](ctx, it, mediaSize); } catch { /* egy hibás elem ne állítsa meg a többit */ }
      }
    });
  }

  line(ctx, it) {
    const x1 = this.x(it.t1), x2 = this.x(it.t2), y1 = this.y(it.p1), y2 = this.y(it.p2);
    if ([x1, x2, y1, y2].some(v => v === null)) return;
    ctx.save();
    ctx.strokeStyle = it.color; ctx.lineWidth = it.width || 1; ctx.setLineDash(DASH[it.style || "solid"]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (it.arrow) this.arrowHead(ctx, x1, y1, x2, y2, it.color, it.width || 1);
    ctx.restore();
  }

  hline(ctx, it, size) {
    const y = this.y(it.p), x0 = it.t1 != null ? this.x(it.t1) : 0;
    if (y === null || x0 === null) return;
    ctx.save();
    ctx.strokeStyle = it.color; ctx.lineWidth = it.width || 1; ctx.setLineDash(DASH[it.style || "solid"]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(size.width, y); ctx.stroke();
    if (it.text) {
      ctx.font = `${MIN_FONT}px system-ui, sans-serif`; ctx.fillStyle = it.color; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      ctx.fillText(it.text, size.width - 6, y - 3);
    }
    ctx.restore();
  }

  dot(ctx, it) {
    const x = this.x(it.t), y = this.y(it.p);
    if (x === null || y === null) return;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, it.r || 6, 0, Math.PI * 2);
    ctx.fillStyle = it.fill || "#fff"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = it.color || "#2962FF"; ctx.setLineDash([]); ctx.stroke();
    ctx.restore();
  }

  vline(ctx, it, size) {
    const x = this.x(it.t);
    if (x === null) return;
    ctx.save();
    ctx.strokeStyle = it.color; ctx.lineWidth = it.width || 1; ctx.setLineDash(DASH[it.style || "dotted"]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.height); ctx.stroke();
    ctx.restore();
  }

  poly(ctx, it) {
    const pts = it.points.map(q => [this.x(q.t), this.y(q.p)]).filter(q => q[0] !== null && q[1] !== null);
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = it.color; ctx.lineWidth = it.width || 1; ctx.setLineDash(DASH[it.style || "solid"]);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    if (it.arrow) { const a = pts[pts.length - 2], b = pts[pts.length - 1]; this.arrowHead(ctx, a[0], a[1], b[0], b[1], it.color, it.width || 1); }
    ctx.restore();
  }

  arrowHead(ctx, x1, y1, x2, y2, color, w) {
    const ang = Math.atan2(y2 - y1, x2 - x1), L = 8 + 2 * w;
    ctx.setLineDash([]); ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - L * Math.cos(ang - 0.45), y2 - L * Math.sin(ang - 0.45));
    ctx.lineTo(x2 - L * Math.cos(ang + 0.45), y2 - L * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
  }

  box(ctx, it) {
    const x1 = this.x(it.t1), x2 = this.x(it.t2), y1 = this.y(it.p1), y2 = this.y(it.p2);
    if ([x1, x2, y1, y2].some(v => v === null)) return;
    const l = Math.min(x1, x2), t = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.max(1, Math.abs(y2 - y1));
    ctx.save();
    if (it.bg) { ctx.fillStyle = it.bg; ctx.fillRect(l, t, w, h); }
    if (it.border) { ctx.strokeStyle = it.border; ctx.lineWidth = it.borderWidth || 1; ctx.setLineDash(DASH[it.borderStyle || "solid"]); ctx.strokeRect(l + .5, t + .5, w, h); }
    if (it.text && it.textColor) {
      ctx.font = `${Math.max(MIN_FONT, it.textSize || MIN_FONT)}px system-ui, sans-serif`;
      ctx.fillStyle = it.textColor; ctx.textBaseline = "middle";
      const a = it.hAlign || "right";
      ctx.textAlign = a;
      const tx = a === "left" ? l + 4 : a === "center" ? l + w / 2 : l + w - 4;
      ctx.fillText(it.text, tx, t + h / 2);
    }
    ctx.restore();
  }

  label(ctx, it) {
    const x = this.x(it.t), y = this.y(it.p);
    if (x === null || y === null) return;
    ctx.save();
    const size = Math.max(it.minSize || MIN_FONT, it.size || MIN_FONT);   // minSize: kifejezett kérésre kisebb (pl. EGYEZÉS 10)
    ctx.font = `${it.bold ? "600 " : ""}${size}px system-ui, sans-serif`;
    const lines = String(it.text).split("\n");
    const w = Math.max(...lines.map(s => ctx.measureText(s).width)), lh = size * 1.25, h = lh * lines.length;
    const pad = it.bg ? 4 : 2;
    const a = it.align || "left";
    let left = a === "left" ? x + 4 : a === "right" ? x - 4 - w - 2 * pad : x - w / 2 - pad;
    const va = it.vAlign || "middle";
    let top = va === "above" ? y - h - 2 * pad - 2 : va === "below" ? y + 2 : y - h / 2 - pad;
    if (it.bg) { ctx.fillStyle = it.bg; ctx.fillRect(left, top, w + 2 * pad, h + 2 * pad); }
    ctx.fillStyle = it.color; ctx.textBaseline = "top"; ctx.textAlign = "left";
    lines.forEach((s, i) => ctx.fillText(s, left + pad, top + pad + i * lh + (lh - size) / 2));
    ctx.restore();
  }
}
