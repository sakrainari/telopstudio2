// Caption layout and drawing. One caption is drawn once, then either cropped
// (transparent PNG of the caption only) or placed on a 1080 x 1920 frame.
import { FRAME, mergeStyle } from "./style.js";
import { tokens, breakOpportunities } from "./text.js";
import { fontString } from "./fonts.js";

const ASCENT = 0.88,
  DESCENT = 0.24,
  MIN_FIT = 0.55;

const measureContext = document.createElement("canvas").getContext("2d");

export const styleOf = (row, speakers) => mergeStyle(speakers[row.speaker], row.override);

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function breakLines(items, style, fit, allowed) {
  const spacing = style.letterSpacing * fit,
    limit = style.wrap.width;
  const lines = [[]];
  const widthOf = (line) =>
    line.reduce((w, t) => w + t.width, 0) + spacing * Math.max(0, line.length - 1);
  for (const item of items) {
    if (item.char === "\n") {
      lines.push([]);
      continue;
    }
    let line = lines.at(-1);
    line.push(item);
    while (style.wrap.on && line.length > 1 && widthOf(line) > limit) {
      // Prefer the last word boundary that keeps kinsoku rules; otherwise cut before this character.
      let cut = -1;
      for (let k = line.length - 1; k > 0; k--)
        if (allowed.has(line[k].index) && widthOf(line.slice(0, k)) <= limit) {
          cut = k;
          break;
        }
      if (cut < 0) cut = line.length - 1;
      const rest = line.splice(cut);
      lines.push(rest);
      line = rest;
    }
  }
  return lines;
}

export function layout(row, speakers) {
  const style = styleOf(row, speakers);
  const chars = tokens(row, style);
  const allowed = breakOpportunities(row.text);
  let fit = 1,
    lines;
  for (;;) {
    const items = chars.map((t) => {
      const size = t.style.size * fit;
      measureContext.font = fontString(t.style.font, size);
      if (t.char === "\n") return { ...t, size, width: 0, ink: null };
      const m = measureContext.measureText(t.char);
      // Ink extents: the painted shape, without the empty side bearings of full-width punctuation.
      const ink = { left: m.actualBoundingBoxLeft || 0, right: m.actualBoundingBoxRight ?? m.width, ascent: m.actualBoundingBoxAscent || 0, descent: m.actualBoundingBoxDescent || 0 };
      return { ...t, size, width: m.width, ink };
    });
    lines = breakLines(items, style, fit, allowed);
    const tooMany = style.wrap.on && style.wrap.shrink && lines.length > style.wrap.maxLines;
    if (!tooMany || fit <= MIN_FIT) break;
    fit = Math.max(MIN_FIT, fit * 0.92);
  }
  const spacing = style.letterSpacing * fit,
    gap = style.lineGap * fit;
  let y = 0,
    blockWidth = 1;
  const placed = lines.map((items) => {
    const top = Math.max(style.size * fit, ...items.map((t) => t.size));
    let x = 0;
    const glyphs = items.map((t) => {
      const g = { ...t, x };
      x += t.width + spacing;
      return g;
    });
    const width = Math.max(0, x - (items.length ? spacing : 0));
    const line = { glyphs, width, top: y, ascent: top * ASCENT, height: top * (ASCENT + DESCENT) };
    y += line.height + gap;
    blockWidth = Math.max(blockWidth, width);
    return line;
  });
  const blockHeight = Math.max(1, y - gap);
  const align = { left: 0, center: 0.5, right: 1 }[style.align] ?? 0.5;
  for (const line of placed) line.left = (blockWidth - line.width) * align;

  const warnings = [];
  if (style.wrap.on && lines.length > style.wrap.maxLines)
    warnings.push(`${style.wrap.maxLines}行を超えています（${lines.length}行）`);
  const boxW = blockWidth + (style.box.on ? style.box.padX * 2 : 0);
  if (boxW > FRAME.width) warnings.push("横幅が画面からはみ出しています");
  if (fit < 1) warnings.push(`行数に合わせて${Math.round(fit * 100)}%に縮小`);
  // Painted area of the glyphs (plus their outlines) relative to the block's top-left corner.
  let ink = null;
  for (const line of placed)
    for (const g of line.glyphs) {
      if (!g.ink || /\s/.test(g.char)) continue;
      const reach = g.style.outlines.reduce((w, o) => w + (o.on ? o.width : 0), 0) * fit;
      const x = line.left + g.x,
        y = line.top + line.ascent;
      const r = { left: x - g.ink.left - reach, right: x + g.ink.right + reach, top: y - g.ink.ascent - reach, bottom: y + g.ink.descent + reach };
      ink = ink
        ? { left: Math.min(ink.left, r.left), right: Math.max(ink.right, r.right), top: Math.min(ink.top, r.top), bottom: Math.max(ink.bottom, r.bottom) }
        : r;
    }
  return { style, lines: placed, fit, blockWidth, blockHeight, lineCount: lines.length, warnings, ink };
}

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function outlineReach(style, fit) {
  return style.outlines.reduce((w, o) => w + (o.on ? o.width : 0), 0) * fit;
}

// Draw the caption with the block centre at the centre of the returned canvas.
export function renderCaption(row, speakers) {
  const plan = layout(row, speakers);
  const { style, lines, fit, blockWidth, blockHeight } = plan;
  const padX = style.box.on ? style.box.padX : 0,
    padY = style.box.on ? style.box.padY : 0;
  const shadowReach = style.shadow.on ? style.shadow.blur * 2 + style.shadow.distance : 0;
  const margin = Math.ceil(outlineReach(style, fit) + shadowReach + 24 + style.size * 0.4);
  const w = blockWidth + padX * 2 + margin * 2,
    h = blockHeight + padY * 2 + margin * 2;
  const out = canvas(w, h),
    ctx = out.getContext("2d");
  const originX = margin + padX,
    originY = margin + padY;

  if (style.box.on) {
    ctx.fillStyle = rgba(style.box.color, style.box.opacity);
    ctx.beginPath();
    ctx.roundRect(margin, margin, blockWidth + padX * 2, blockHeight + padY * 2, style.box.radius);
    ctx.fill();
  }

  const text = canvas(w, h),
    tc = text.getContext("2d");
  tc.lineJoin = "round";
  tc.lineCap = "round";
  const each = (fn) => {
    for (const line of lines)
      for (const g of line.glyphs)
        fn(g, originX + line.left + g.x, originY + line.top + line.ascent, line);
  };
  // Outer layers first across the whole caption, so a neighbour's outline never covers a fill.
  for (let k = 2; k >= 0; k--) {
    each((g, x, y) => {
      const layers = g.style.outlines;
      if (!layers[k].on || !layers[k].width) return;
      const reach = layers.slice(0, k + 1).reduce((s, o) => s + (o.on ? o.width : 0), 0) * fit;
      tc.font = fontString(g.style.font, g.size);
      tc.lineWidth = reach * 2;
      tc.strokeStyle = layers[k].color;
      tc.strokeText(g.char, x, y);
    });
  }
  each((g, x, y, line) => {
    if (!g.style.fill) return;
    tc.font = fontString(g.style.font, g.size);
    if (g.style.gradient) {
      const top = originY + line.top,
        grad = tc.createLinearGradient(0, top, 0, top + line.height);
      grad.addColorStop(0, g.style.color);
      grad.addColorStop(1, g.style.color2);
      tc.fillStyle = grad;
    } else tc.fillStyle = g.style.color;
    tc.fillText(g.char, x, y);
  });

  if (style.shadow.on && style.shadow.opacity > 0) {
    const a = (style.shadow.angle * Math.PI) / 180,
      far = w + 100;
    ctx.save();
    ctx.shadowColor = rgba(style.shadow.color, style.shadow.opacity);
    ctx.shadowBlur = style.shadow.blur;
    ctx.shadowOffsetX = far + style.shadow.distance * Math.cos(a);
    ctx.shadowOffsetY = style.shadow.distance * Math.sin(a);
    ctx.drawImage(text, -far, 0); // only the shadow lands on the canvas
    ctx.restore();
  }
  ctx.drawImage(text, 0, 0);
  return { canvas: out, centerX: originX + blockWidth / 2, centerY: originY + blockHeight / 2, plan };
}

// Transparent PNG of the caption only, trimmed with a 12px margin.
export function crop(source) {
  const { width: w, height: h } = source;
  const data = source.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return canvas(24, 24);
  const out = canvas(maxX - minX + 25, maxY - minY + 25);
  out.getContext("2d").drawImage(source, minX, minY, maxX - minX + 1, maxY - minY + 1, 12, 12, maxX - minX + 1, maxY - minY + 1);
  return out;
}

export function captionCenter(style) {
  return { x: (style.pos.x / 100) * FRAME.width, y: (style.pos.y / 100) * FRAME.height };
}

// Full 1080 x 1920 transparent frame with the caption at its saved position.
export function renderFrame(row, speakers) {
  const caption = renderCaption(row, speakers);
  const frame = canvas(FRAME.width, FRAME.height);
  const c = captionCenter(caption.plan.style);
  frame.getContext("2d").drawImage(caption.canvas, Math.round(c.x - caption.centerX), Math.round(c.y - caption.centerY));
  return frame;
}

export function renderOutput(row, speakers, mode) {
  return mode === "crop" ? crop(renderCaption(row, speakers).canvas) : renderFrame(row, speakers);
}
