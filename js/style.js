// Style model shared by the editor, renderer and storage.
// Positions and wrap widths are measured in the 1080 x 1920 short-video frame.

export const FRAME = { width: 1080, height: 1920 };

export const SPEAKERS = {
  A: "話者A",
  B: "話者B",
  N: "ナレーション",
  "※": "注釈",
  "!": "インパクト",
};

export const BUILTIN_FONTS = [
  { family: "Noto Sans JP", label: "Noto Sans JP", weight: 900 },
  { family: "M PLUS Rounded 1c", label: "M PLUS Rounded 1c", weight: 800 },
  { family: "Dela Gothic One", label: "Dela Gothic One", weight: 400 },
  { family: "RocknRoll One", label: "RocknRoll One", weight: 400 },
  { family: "Zen Maru Gothic", label: "Zen Maru Gothic", weight: 900 },
  { family: "Shippori Mincho B1", label: "しっぽり明朝", weight: 800 },
];

export const clone = (value) => structuredClone(value);
export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);

const outline = (on, color, width) => ({ on, color, width });

export function baseStyle() {
  return {
    font: "Noto Sans JP",
    size: 76,
    letterSpacing: 0,
    lineGap: 14,
    align: "center",
    fill: true,
    color: "#ffffff",
    color2: "#ffd23f",
    gradient: false,
    outlines: [
      outline(true, "#151821", 10),
      outline(false, "#3d7bff", 8),
      outline(false, "#ffffff", 6),
    ],
    shadow: {
      on: true,
      color: "#000000",
      opacity: 0.55,
      blur: 12,
      distance: 8,
      angle: 90,
    },
    box: {
      on: false,
      color: "#000000",
      opacity: 0.6,
      radius: 20,
      padX: 28,
      padY: 18,
    },
    wrap: { on: true, width: 900, maxLines: 3, shrink: true },
    pos: { x: 50, y: 70 },
    auto: { on: true, color: "#ffd23f", scale: 1.25 },
  };
}

export function defaultSpeakers() {
  const A = baseStyle(),
    B = baseStyle(),
    N = baseStyle(),
    note = baseStyle(),
    hit = baseStyle();
  Object.assign(B, { font: "RocknRoll One", color: "#fff27a" });
  B.outlines[0].color = "#3a1a0c";
  B.pos.y = 62;
  Object.assign(N, { font: "M PLUS Rounded 1c", size: 60 });
  N.outlines[0].width = 0;
  N.outlines[0].on = false;
  N.shadow.on = false;
  N.box.on = true;
  N.pos.y = 78;
  Object.assign(note, { size: 40, color: "#1b1f2a" });
  note.outlines[0].on = false;
  note.shadow.on = false;
  note.auto.on = false;
  Object.assign(note.box, { on: true, color: "#ffffff", opacity: 0.92 });
  note.pos.y = 86;
  note.wrap.width = 940;
  Object.assign(hit, {
    font: "Dela Gothic One",
    size: 112,
    gradient: true,
    color: "#fff6a8",
    color2: "#ffae1f",
  });
  hit.outlines = [
    outline(true, "#1a1410", 10),
    outline(true, "#ffffff", 8),
    outline(true, "#e3304a", 10),
  ];
  hit.wrap.maxLines = 2;
  hit.pos.y = 40;
  return { A, B, N, "※": note, "!": hit };
}

// Sample looks only change colours and fonts; positions stay as the user set them.
export const SAMPLES = {
  standard: "標準",
  study: "解説・学び",
  game: "実況",
  calm: "落ち着き",
  mystery: "謎解き",
};

export function sampleSpeakers(key) {
  const set = defaultSpeakers();
  for (const [speaker, s] of Object.entries(set)) {
    if (key === "study") {
      s.font = speaker === "!" ? "Dela Gothic One" : "M PLUS Rounded 1c";
      s.outlines[1] = outline(speaker !== "※", "#1f8a7a", 8);
      s.auto.color = "#7ef0d6";
    }
    if (key === "game") {
      s.outlines[1] = outline(speaker !== "※", "#8b4dff", 9);
      s.auto.color = "#ff6fae";
      if (speaker !== "※") s.color2 = "#ff6fae";
    }
    if (key === "calm") {
      s.font = "Shippori Mincho B1";
      s.gradient = false;
      s.color = speaker === "※" ? "#1b1f2a" : "#f3eee2";
      s.outlines[1].on = false;
      s.outlines[2].on = false;
      s.auto.color = "#e0805f";
      s.shadow.blur = 18;
    }
    if (key === "mystery") {
      s.font = speaker === "!" ? "Dela Gothic One" : "Shippori Mincho B1";
      s.color = "#f6eac8";
      s.color2 = "#b48e4d";
      s.outlines[1] = outline(speaker !== "※", "#264f49", 8);
      s.auto.color = "#f5ae53";
      Object.assign(s.box, { on: speaker === "N" || speaker === "※", color: "#11231f", opacity: 0.85 });
    }
  }
  return set;
}

const NESTED = ["shadow", "box", "wrap", "pos", "auto"];

// Deep enough for this model: nested sections merge, outlines merge per layer.
export function mergeStyle(base, patch) {
  if (!patch) return base;
  const out = { ...base, ...patch };
  for (const key of NESTED)
    if (patch[key]) out[key] = { ...base[key], ...patch[key] };
  out.outlines = base.outlines.map((o, i) => ({ ...o, ...patch.outlines?.[i] }));
  return out;
}

// Write `value` at a dotted path into a partial patch object.
export function setPath(target, path, value) {
  const keys = path.split(".");
  let node = target;
  keys.slice(0, -1).forEach((key, i) => {
    const nextIsIndex = /^\d+$/.test(keys[i + 1]);
    if (node[key] == null) node[key] = nextIsIndex ? [] : {};
    node = node[key];
  });
  node[keys.at(-1)] = value;
}

export const getPath = (obj, path) =>
  path.split(".").reduce((v, k) => (v == null ? v : v[k]), obj);

export function deletePath(target, path) {
  const keys = path.split(".");
  const parent = keys.slice(0, -1).reduce((v, k) => v?.[k], target);
  if (parent) delete parent[keys.at(-1)];
}

// ---------- validation of stored / imported values ----------

const isColor = (v) => typeof v === "string" && /^#[\da-f]{6}$/i.test(v);
const num = (v, min, max) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(max, Math.max(min, v))
    : undefined;
const isFont = (v) => typeof v === "string" && /^[^"'\\<>;{}]{1,100}$/.test(v);

const LIMITS = {
  size: [16, 260],
  letterSpacing: [-40, 120],
  lineGap: [-40, 200],
  "shadow.opacity": [0, 1],
  "shadow.blur": [0, 60],
  "shadow.distance": [0, 80],
  "shadow.angle": [0, 360],
  "box.opacity": [0, 1],
  "box.radius": [0, 120],
  "box.padX": [0, 200],
  "box.padY": [0, 200],
  "wrap.width": [200, 1080],
  "wrap.maxLines": [1, 8],
  "pos.x": [0, 100],
  "pos.y": [0, 100],
  "auto.scale": [1, 2],
};
const COLORS = ["color", "color2", "shadow.color", "box.color", "auto.color"];
const BOOLS = ["fill", "gradient", "shadow.on", "box.on", "wrap.on", "wrap.shrink", "auto.on"];

// Returns a partial style containing only valid fields.
export function cleanStylePatch(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  if (isFont(input.font)) out.font = input.font;
  if (["left", "center", "right"].includes(input.align)) out.align = input.align;
  for (const [path, [min, max]] of Object.entries(LIMITS)) {
    const v = num(getPath(input, path), min, max);
    if (v !== undefined) setPath(out, path, v);
  }
  for (const path of COLORS) {
    const v = getPath(input, path);
    if (isColor(v)) setPath(out, path, v);
  }
  for (const path of BOOLS) {
    const v = getPath(input, path);
    if (typeof v === "boolean") setPath(out, path, v);
  }
  if (Array.isArray(input.outlines)) {
    out.outlines = [0, 1, 2].map((i) => {
      const o = input.outlines[i] || {},
        r = {};
      if (typeof o.on === "boolean") r.on = o.on;
      if (isColor(o.color)) r.color = o.color;
      const w = num(o.width, 0, 40);
      if (w !== undefined) r.width = w;
      return r;
    });
  }
  return out;
}

export const cleanStyle = (input) => mergeStyle(baseStyle(), cleanStylePatch(input));

// Per-character decoration: a deliberately small vocabulary.
export function cleanMark(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  if (isColor(input.color)) out.color = input.color;
  const scale = num(input.scale, 0.3, 3);
  if (scale !== undefined) out.scale = scale;
  if (isFont(input.font)) out.font = input.font;
  if (input.noAuto === true) out.noAuto = true;
  return Object.keys(out).length ? out : null;
}
