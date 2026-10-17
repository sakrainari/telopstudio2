// Centre pane: the 9:16 stage (drag to place) and the single text editor.
import { FRAME, SPEAKERS, clone, uid, setPath } from "../style.js";
import {
  project, row, rowIndex, ui, change, select, emit, on, undo, redo, LIMITS, breakHistoryMerge,
} from "../store.js";
import { graphemes, graphemeIndex, updateText, applyMark, newRow, utf16Offset } from "../text.js";
import { renderCaption, styleOf, captionCenter } from "../render.js";
import { $, escapeHTML, toast } from "./common.js";
import { fontsReady } from "./fonts-ready.js";
import { addRows } from "./list.js";

// Approximate areas covered by each app's buttons and captions (percent of the frame).
// They are guides only; overlay a real screenshot to check precisely.
export const GUIDES = {
  youtube: { top: 9, right: 15, bottom: 20, left: 4 },
  tiktok: { top: 10, right: 16, bottom: 22, left: 4 },
  reels: { top: 10, right: 15, bottom: 21, left: 4 },
};
// Screen sizes in pixels (portrait). "video" shows the bare 1080x1920 frame.
// notch: wide cut-out at the top; home: no cut-out (home-button phones).
export const DEVICES = {
  video: { name: "動画の枠（9:16）", w: 1080, h: 1920 },
  pixel8pro: { name: "Pixel 8 Pro", w: 1344, h: 2992 },
  pixel8: { name: "Pixel 8", w: 1080, h: 2400 },
  iphone15: { name: "iPhone 15・16", w: 1179, h: 2556, notch: true },
  galaxys24: { name: "Galaxy S24", w: 1080, h: 2340 },
  iphonese: { name: "iPhone SE", w: 750, h: 1334, home: true },
};
const VIEW_KEY = "telopstudio2-view";
const view = { bg: "checker", guide: "youtube", device: "video", fit: "width" };
let drawJob = 0,
  current = null, // { canvas, centerX, centerY, plan }
  drag = null,
  referenceURL = null;

function loadView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    if (["checker", "dark", "light"].includes(saved.bg)) view.bg = saved.bg;
    if (["youtube", "tiktok", "reels", "off"].includes(saved.guide)) view.guide = saved.guide;
    if (Object.hasOwn(DEVICES, saved.device)) view.device = saved.device;
    if (["width", "fill"].includes(saved.fit)) view.fit = saved.fit;
  } catch {}
}
function saveView() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {}
}

const stageScale = () => $("stage").clientWidth / FRAME.width;

// ---------- zoom ----------
// 1 = fit the whole frame. Above 1 the stage grows and the area scrolls.
const ZOOM_MIN = 1,
  ZOOM_MAX = 5;
let zoom = 1;

function fitHeight() {
  const area = $("stageArea");
  const style = getComputedStyle(area);
  const inner = area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  return Math.min(inner, window.innerHeight * 0.72);
}

// Keep the point under `focus` (client coordinates) in place while zooming; default is the caption.
function setZoom(next, focus) {
  const area = $("stageArea"),
    stage = $("device");
  const value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
  const before = stage.getBoundingClientRect();
  let fx, fy;
  if (focus) {
    fx = (focus.x - before.left) / before.width;
    fy = (focus.y - before.top) / before.height;
  } else {
    const c = $("caption").getBoundingClientRect();
    fx = c.width ? (c.left + c.width / 2 - before.left) / before.width : 0.5;
    fy = c.height ? (c.top + c.height / 2 - before.top) / before.height : 0.5;
  }
  zoom = value;
  const zoomed = zoom > 1;
  stage.classList.toggle("zoomed", zoomed);
  area.classList.toggle("zoomed", zoomed);
  stage.style.height = zoomed ? `${fitHeight() * zoom}px` : "";
  $("zoomFit").textContent = zoomed ? `${Math.round(zoom * 100)}%` : "全体";
  $("zoomOut").disabled = zoom <= ZOOM_MIN;
  $("zoomIn").disabled = zoom >= ZOOM_MAX;
  place();
  if (zoomed) {
    const after = stage.getBoundingClientRect(),
      areaBox = area.getBoundingClientRect();
    const targetX = focus ? focus.x - areaBox.left : area.clientWidth / 2,
      targetY = focus ? focus.y - areaBox.top : area.clientHeight / 2;
    area.scrollLeft += after.left + fx * after.width - areaBox.left - targetX;
    area.scrollTop += after.top + fy * after.height - areaBox.top - targetY;
  }
}

function initZoom() {
  $("zoomIn").onclick = () => setZoom(zoom * 1.5);
  $("zoomOut").onclick = () => setZoom(zoom / 1.5);
  $("zoomFit").onclick = () => setZoom(1);
  // Ctrl (or ⌘) + wheel zooms around the pointer; a pinch on a trackpad arrives the same way.
  $("stageArea").addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY * 0.0025), { x: e.clientX, y: e.clientY });
    },
    { passive: false },
  );
  window.addEventListener("resize", () => zoom > 1 && setZoom(zoom));
  setZoom(1);
}

// Fraction of the video's width that is visible on screen (1 unless "fill" crops the sides).
function visibleWidth() {
  const d = DEVICES[view.device];
  if (view.device === "video" || view.fit !== "fill") return 1;
  return Math.min(1, (d.w / d.h) / (FRAME.width / FRAME.height));
}

function applyView() {
  const stage = $("stage");
  stage.className = `stage bg-${view.bg}`;
  const d = DEVICES[view.device],
    device = $("device");
  device.style.setProperty("--screen", `${d.w} / ${d.h}`);
  device.classList.toggle("phone", view.device !== "video");
  device.classList.toggle("notch", Boolean(d.notch));
  device.classList.toggle("home", Boolean(d.home));
  device.classList.toggle("fill", view.fit === "fill" && view.device !== "video");
  $("devicePreset").value = view.device;
  $("deviceFit").value = view.fit;
  $("deviceFit").hidden = view.device === "video";
  for (const b of document.querySelectorAll("[data-bg]")) b.setAttribute("aria-pressed", String(b.dataset.bg === view.bg));
  $("guidePreset").value = view.guide;
  const g = GUIDES[view.guide];
  $("guide").hidden = !g;
  if (g) for (const side of ["top", "right", "bottom", "left"]) $("guide").style.setProperty(`--g-${side}`, g[side] + "%");
}

// ---------- drawing ----------
async function draw() {
  const job = ++drawJob;
  await fontsReady();
  if (job !== drawJob) return;
  const r = row();
  const canvas = $("caption");
  if (!r) {
    canvas.hidden = true;
    $("stageInfo").textContent = "左の「＋ 追加」からテロップを作りましょう。";
    return;
  }
  try {
    current = renderCaption(r, project().speakers);
  } catch (e) {
    current = null;
    canvas.hidden = true;
    $("stageInfo").textContent = "描画できません：" + e.message;
    return;
  }
  canvas.hidden = false;
  canvas.width = current.canvas.width;
  canvas.height = current.canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(current.canvas, 0, 0);
  place();
}

// Visible area of the caption in frame pixels: painted glyphs and outlines, plus the box if any.
// Shadows are soft and transparent side bearings are empty, so neither counts.
function captionBounds(style, center) {
  const { plan } = current;
  const originX = center.x - plan.blockWidth / 2,
    originY = center.y - plan.blockHeight / 2;
  let b = plan.ink
    ? { left: originX + plan.ink.left, right: originX + plan.ink.right, top: originY + plan.ink.top, bottom: originY + plan.ink.bottom }
    : { left: center.x, right: center.x, top: center.y, bottom: center.y };
  if (style.box.on) {
    b = {
      left: Math.min(b.left, originX - style.box.padX),
      right: Math.max(b.right, originX + plan.blockWidth + style.box.padX),
      top: Math.min(b.top, originY - style.box.padY),
      bottom: Math.max(b.bottom, originY + plan.blockHeight + style.box.padY),
    };
  }
  return b;
}

function place(posOverride) {
  const r = row();
  if (!current || !r) return;
  const style = styleOf(r, project().speakers);
  if (posOverride) style.pos = posOverride;
  const scale = stageScale(),
    center = captionCenter(style),
    canvas = $("caption");
  canvas.style.width = `${current.canvas.width * scale}px`;
  canvas.style.left = `${(center.x - current.centerX) * scale}px`;
  canvas.style.top = `${(center.y - current.centerY) * scale}px`;

  const wrapGuide = $("wrapGuide");
  wrapGuide.hidden = !style.wrap.on;
  wrapGuide.style.left = `${(center.x - style.wrap.width / 2) * scale}px`;
  wrapGuide.style.width = `${style.wrap.width * scale}px`;

  const b = captionBounds(style, center),
    notes = [...current.plan.warnings];
  const off = b.left < 0 || b.top < 0 || b.right > FRAME.width || b.bottom > FRAME.height;
  canvas.classList.toggle("offscreen", off);
  if (off) notes.unshift("画面の外にはみ出しています");
  const half = (FRAME.width * visibleWidth()) / 2;
  if (!off && (b.left < FRAME.width / 2 - half || b.right > FRAME.width / 2 + half))
    notes.unshift(`${DEVICES[view.device].name}では左右が切れて見えます`);
  const g = GUIDES[view.guide];
  if (g && !off) {
    const inside =
      b.left >= (g.left / 100) * FRAME.width &&
      b.right <= (1 - g.right / 100) * FRAME.width &&
      b.top >= (g.top / 100) * FRAME.height &&
      b.bottom <= (1 - g.bottom / 100) * FRAME.height;
    if (!inside) notes.unshift("ガイドの外（ボタンや説明文と重なる位置）にかかっています");
  }
  const where = ui.scope === "speaker" ? `${SPEAKERS[r.speaker]}の位置` : "このテロップの位置";
  $("stageInfo").innerHTML =
    `${escapeHTML(where)}：横 ${Math.round(style.pos.x)}% ・ 縦 ${Math.round(style.pos.y)}% ／ ${current.plan.lineCount}行` +
    notes.map((n) => ` ／ <span class="warn">${escapeHTML(n)}</span>`).join("");
}

// Dragging writes the position for the current scope: the speaker's default, or this caption only.
function commitPosition(pos, name) {
  const r = row();
  if (!r) return;
  const value = { x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10 };
  change(name, (p) => {
    if (ui.scope === "speaker") {
      p.speakers[r.speaker].pos = value;
    } else {
      setPath(r.override, "pos.x", value.x);
      setPath(r.override, "pos.y", value.y);
    }
  }, name === "位置を微調整" ? `nudge:${r.id}:${ui.scope}` : null);
}

function initDrag() {
  const canvas = $("caption");
  canvas.addEventListener("pointerdown", (e) => {
    const r = row();
    if (!r) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, start: { ...styleOf(r, project().speakers).pos }, pos: null };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const scale = stageScale();
    let x = drag.start.x + ((e.clientX - drag.x) / scale / FRAME.width) * 100;
    const y = drag.start.y + ((e.clientY - drag.y) / scale / FRAME.height) * 100;
    if (Math.abs(x - 50) < 1.2 && !e.altKey) x = 50; // snap to the centre line
    drag.pos = { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
    place(drag.pos);
  });
  const end = () => {
    if (drag?.pos) commitPosition(drag.pos, "位置を移動");
    drag = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 2 : 0.5,
      d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d || !row()) return;
    e.preventDefault();
    const pos = styleOf(row(), project().speakers).pos;
    commitPosition({ x: Math.min(100, Math.max(0, pos.x + d[0])), y: Math.min(100, Math.max(0, pos.y + d[1])) }, "位置を微調整");
  });
  new ResizeObserver(() => place()).observe($("device"));
}

// ---------- editor ----------
function syncEditor() {
  const r = row(),
    i = rowIndex(),
    count = project().rows.length;
  $("editor").value = r?.text || "";
  $("editor").disabled = !r;
  $("speaker").innerHTML = Object.entries(SPEAKERS)
    .map(([k, v]) => `<option value="${escapeHTML(k)}"${k === r?.speaker ? " selected" : ""}>${escapeHTML(v)}</option>`)
    .join("");
  $("speaker").disabled = !r;
  $("cutLabel").textContent = r ? `${i + 1} / ${count}` : "";
  $("prevRow").disabled = i <= 0;
  $("nextRow").disabled = i < 0 || i >= count - 1;
  $("mergeRow").disabled = i < 0 || i >= count - 1;
  syncSelection();
}

function syncSelection() {
  const r = row(),
    range = ui.range;
  const text = r && range ? graphemes(r.text).slice(range.start, range.end).join("") : "";
  $("selectionLabel").textContent = range ? `選択中「${text.length > 16 ? text.slice(0, 16) + "…" : text}」` : "";
  for (const b of document.querySelectorAll("[data-quick]")) b.disabled = !range;
}

function readSelection() {
  const r = row(),
    el = $("editor");
  // Browsers can replay "select" after focus has moved elsewhere; only the focused editor counts.
  if (!r || document.activeElement !== el) return;
  const start = graphemeIndex(r.text, el.selectionStart),
    end = graphemeIndex(r.text, el.selectionEnd);
  const range = end > start ? { start, end } : null;
  const same = range?.start === ui.range?.start && range?.end === ui.range?.end;
  if (same) return;
  ui.range = range;
  // Selecting characters switches the design pane to those characters; clearing switches back.
  if (range && ui.scope !== "chars") {
    ui.scopeBeforeChars = ui.scope;
    ui.scope = "chars";
  } else if (!range && ui.scope === "chars") ui.scope = ui.scopeBeforeChars;
  breakHistoryMerge();
  syncSelection();
  emit("scope");
}

function restoreSelection() {
  const r = row(),
    el = $("editor");
  if (!r || !ui.range) return;
  el.focus({ preventScroll: true });
  el.setSelectionRange(utf16Offset(r.text, ui.range.start), utf16Offset(r.text, ui.range.end));
}

const QUICK = {
  important: { color: "#ff4d5e", scale: 1.25 },
  red: { color: "#ff4d5e" },
  yellow: { color: "#ffd23f" },
  blue: { color: "#59a6ff" },
  plain: { noAuto: true },
};
function quick(action) {
  const r = row(),
    range = ui.range;
  if (!r || !range) return toast("先に入力欄で文字を選んでください。");
  const names = { bigger: "選んだ文字を大きく", smaller: "選んだ文字を小さく", clear: "選んだ文字の装飾を消す", plain: "選んだ文字の強調をやめる" };
  change(names[action] || "選んだ文字を装飾", () => {
    if (action === "clear") applyMark(r, range, null);
    else if (action === "bigger" || action === "smaller")
      for (let i = range.start; i < range.end; i++) {
        const scale = (r.marks[i]?.scale || 1) * (action === "bigger" ? 1.2 : 1 / 1.2);
        applyMark(r, { start: i, end: i + 1 }, { scale: Math.min(3, Math.max(0.3, Math.round(scale * 100) / 100)) });
      }
    else applyMark(r, range, QUICK[action]);
  });
  restoreSelection();
}

function navigate(delta) {
  const p = project(),
    next = p.rows[rowIndex() + delta];
  if (next) {
    select(next.id);
    $("editor").focus();
  }
}

function addAfter() {
  const r = row();
  if (addRows([newRow("", r?.speaker || "A")])) $("editor").focus();
}

function split() {
  const r = row(),
    el = $("editor");
  if (!r) return;
  const at = graphemeIndex(r.text, el.selectionStart),
    chars = graphemes(r.text);
  if (at <= 0 || at >= chars.length) return toast("文章の途中にカーソルを置いてください。");
  if (project().rows.length >= LIMITS.rows) return toast(`1プロジェクトは${LIMITS.rows}枚までです。`, true);
  change("テロップを分ける", (p) => {
    const next = { ...clone(r), id: uid() };
    next.text = chars.slice(at).join("").replace(/^\n/, "");
    next.marks = r.marks.slice(at + (chars[at] === "\n" ? 1 : 0));
    r.text = chars.slice(0, at).join("").replace(/\n$/, "");
    r.marks = r.marks.slice(0, graphemes(r.text).length);
    p.rows.splice(p.rows.indexOf(r) + 1, 0, next);
    p.selected = next.id;
  });
  ui.range = null;
  emit("all");
  $("editor").focus();
  $("editor").setSelectionRange(0, 0);
}

function merge() {
  const p = project(),
    r = row(),
    next = p.rows[rowIndex() + 1];
  if (!r || !next) return;
  if (graphemes(r.text + next.text).length > LIMITS.chars) return toast(`つなげると${LIMITS.chars}文字を超えます。`, true);
  const caret = r.text.length;
  change("次のテロップとつなげる", () => {
    r.text += next.text;
    r.marks = [...r.marks, ...next.marks];
    p.rows.splice(p.rows.indexOf(next), 1);
    ui.checked.delete(next.id);
  });
  ui.range = null;
  emit("all");
  $("editor").focus();
  $("editor").setSelectionRange(caret, caret);
}

function isOtherTextField(target) {
  const field = target.closest?.("input,textarea,[contenteditable]");
  return field && field.id !== "editor" && !["checkbox", "radio", "range", "button", "color"].includes(field.type);
}

export function initStage() {
  loadView();
  applyView();
  initDrag();
  initZoom();
  for (const b of document.querySelectorAll("[data-bg]"))
    b.onclick = () => {
      view.bg = b.dataset.bg;
      saveView();
      applyView();
    };
  $("devicePreset").onchange = () => {
    view.device = $("devicePreset").value;
    saveView();
    applyView();
    setZoom(1);
  };
  $("deviceFit").onchange = () => {
    view.fit = $("deviceFit").value;
    saveView();
    applyView();
    setZoom(zoom);
  };
  $("guidePreset").onchange = () => {
    view.guide = $("guidePreset").value;
    saveView();
    applyView();
    place();
  };
  $("referenceOpen").onclick = () => {
    if (referenceURL) {
      URL.revokeObjectURL(referenceURL);
      referenceURL = null;
      $("referenceImage").hidden = true;
      $("referenceOpen").textContent = "実画面を重ねる";
      return;
    }
    $("referenceFile").value = "";
    $("referenceFile").click();
  };
  $("referenceFile").onchange = () => {
    const file = $("referenceFile").files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast("PNG・JPEG・WebPの画像を選んでください。", true);
    referenceURL = URL.createObjectURL(file);
    $("referenceImage").src = referenceURL;
    $("referenceImage").hidden = false;
    $("referenceOpen").textContent = "実画面を外す";
    toast("スクリーンショットを重ねました（この画面を閉じると外れます）。");
  };

  $("editor").addEventListener("input", () => {
    const r = row();
    if (!r) return;
    const value = $("editor").value;
    if (graphemes(value).length > LIMITS.chars) return;
    change("文字を編集", () => updateText(r, value), `text:${r.id}`);
    readSelection();
  });
  for (const type of ["select", "keyup", "pointerup"]) $("editor").addEventListener(type, readSelection);
  $("editor").addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      addAfter();
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      navigate(e.key === "ArrowUp" ? -1 : 1);
    }
  });
  $("speaker").onchange = () => {
    const r = row();
    if (!r) return;
    change("話者を変更", () => (r.speaker = $("speaker").value));
    emit("all");
  };
  // Keep the text selection when pressing a quick button.
  $("quick").addEventListener("pointerdown", (e) => e.target.closest("button") && e.preventDefault());
  $("quick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-quick]");
    if (b) quick(b.dataset.quick);
  });
  $("prevRow").onclick = () => navigate(-1);
  $("nextRow").onclick = () => navigate(1);
  $("addAfter").onclick = addAfter;
  $("splitRow").onclick = split;
  $("mergeRow").onclick = merge;

  document.addEventListener("keydown", (e) => {
    if (e.isComposing || e.defaultPrevented || document.querySelector("dialog[open]") || isOtherTextField(e.target)) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if ((e.ctrlKey || e.metaKey) && key === "y") {
      e.preventDefault();
      redo();
    }
  });

  on("all", () => {
    syncEditor();
    draw();
  });
  on("change", () => {
    $("cutLabel").textContent = row() ? `${rowIndex() + 1} / ${project().rows.length}` : "";
    draw();
  });
  on("scope", () => place());
  on("selection", syncSelection);
}
