// Project data, autosave, undo history and change notifications.
// Screen modules read from here and listen for topics; they never call each other.
import {
  SPEAKERS,
  clone,
  uid,
  defaultSpeakers,
  mergeStyle,
  cleanStylePatch,
  cleanMark,
} from "./style.js";
import { graphemes, newRow, parseScript } from "./text.js";

const STORAGE_KEY = "telopstudio2-library";
const LIMITS = { projects: 100, rows: 300, chars: 2000, sets: 100 };
export { LIMITS };

export let library;
export const ui = {
  scope: "speaker", // "speaker" | "row" | "chars"
  scopeBeforeChars: "speaker",
  range: null, // { start, end } in visible characters of the selected caption
  checked: new Set(),
  storageError: false,
  oversize: 0,
};

// ---------- notifications ----------
const listeners = new Map();
export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
}
export function emit(...topics) {
  const called = new Set();
  for (const topic of topics)
    for (const fn of listeners.get(topic) || [])
      if (!called.has(fn)) {
        called.add(fn);
        fn(topics);
      }
}

// ---------- accessors ----------
export const project = () =>
  library.projects.find((p) => p.id === library.active) || library.projects[0];
export const row = () => project().rows.find((r) => r.id === project().selected) || null;
export const rowIndex = () => project().rows.indexOf(row());
export const speakerOf = () => row()?.speaker || "A";

// One rule for "how many characters" everywhere: visible characters (an emoji counts as one).
export const charCount = (text) => graphemes(text).length;

// Leave "selected characters" mode whenever the selection can no longer be valid
// (switching, adding, splitting, joining, deleting, undoing).
export function clearSelection() {
  ui.range = null;
  if (ui.scope === "chars") ui.scope = ui.scopeBeforeChars;
}

function makeProject(name, rows) {
  return { id: uid(), name, speakers: defaultSpeakers(), rows, selected: rows[0]?.id || null };
}

export const SAMPLE_SCRIPT = `! 世界遺産クイズ！

A: この絶景、
どこの国かわかる？

B: えっ、まさかの標高3,800m！？

N: ヒントは『湖』と『葦の島』

※ 答えは動画の最後に`;

// ---------- persistence ----------
let saveTimer;
export let saveState = "saved";
function setSaveState(value) {
  saveState = value;
  emit("save");
}
export function saveNow() {
  clearTimeout(saveTimer);
  if (ui.storageError) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...library, app: "telopstudio2", version: 3 }));
    setSaveState("saved");
  } catch {
    setSaveState("failed");
  }
}
export function saveSoon() {
  setSaveState("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

export function initStore() {
  let loaded = null;
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) {
      loaded = readLibrary(JSON.parse(text));
      ui.oversize = loaded.oversize;
      delete loaded.legacy;
      delete loaded.oversize;
    }
  } catch {
    ui.storageError = true; // never overwrite data we could not read
  }
  library = loaded || {
    projects: [makeProject("はじめてのショート", parseScript(SAMPLE_SCRIPT))],
    sets: [],
    active: null,
  };
  if (!library.projects.some((p) => p.id === library.active)) library.active = library.projects[0].id;
  window.addEventListener("pagehide", saveNow);
}

// ---------- history ----------
const histories = new Map();
function history() {
  const p = project();
  if (!histories.has(p.id))
    histories.set(p.id, { items: [{ name: "開いたとき", data: clone(p) }], cursor: 0, key: null, time: 0 });
  return histories.get(p.id);
}
export const historyInfo = () => {
  const h = history();
  return { canUndo: h.cursor > 0, canRedo: h.cursor < h.items.length - 1, items: h.items, cursor: h.cursor };
};

// Every saved change to a project goes through here. Rapid edits with the same key merge into one step.
export function change(name, fn, key = null) {
  const h = history();
  fn(project());
  const now = Date.now(),
    snapshot = { name, data: clone(project()) };
  if (key && key === h.key && now - h.time < 1000 && h.cursor === h.items.length - 1 && h.cursor > 0)
    h.items[h.cursor] = snapshot;
  else {
    h.items = h.items.slice(0, h.cursor + 1);
    h.items.push(snapshot);
    if (h.items.length > 80) h.items.shift();
    h.cursor = h.items.length - 1;
  }
  h.key = key;
  h.time = now;
  saveSoon();
  emit("change");
}
export function breakHistoryMerge() {
  history().key = null;
}

export function restore(index) {
  const h = history();
  if (index < 0 || index >= h.items.length) return;
  h.cursor = index;
  h.key = null;
  const data = clone(h.items[index].data);
  library.projects[library.projects.findIndex((p) => p.id === data.id)] = data;
  clearSelection();
  for (const id of [...ui.checked]) if (!data.rows.some((r) => r.id === id)) ui.checked.delete(id);
  saveSoon();
  emit("all");
}
export const undo = () => restore(history().cursor - 1);
export const redo = () => restore(history().cursor + 1);

// ---------- selection & projects ----------
export function select(id) {
  if (!project().rows.some((r) => r.id === id) || project().selected === id) return;
  project().selected = id;
  clearSelection();
  breakHistoryMerge();
  saveSoon();
  emit("all");
}

export function switchProject(id) {
  if (!library.projects.some((p) => p.id === id)) return;
  library.active = id;
  clearSelection();
  ui.checked.clear();
  saveSoon();
  emit("all");
}

export function addProject(name) {
  if (library.projects.length >= LIMITS.projects) throw Error(`プロジェクトは${LIMITS.projects}件までです。`);
  const p = makeProject(name, [newRow("")]);
  library.projects.push(p);
  switchProject(p.id);
}

export function deleteProject() {
  const p = project();
  library.projects = library.projects.filter((x) => x.id !== p.id);
  histories.delete(p.id);
  if (!library.projects.length) library.projects.push(makeProject("新しいプロジェクト", [newRow("")]));
  switchProject(library.projects[0].id);
}

// ---------- import / export ----------
export function exportProjectJSON() {
  return JSON.stringify({ app: "telopstudio2", version: 3, projects: [project()], sets: library.sets }, null, 2);
}

// Captions over the limit are kept as they are (never cut, never block the rest of the data);
// only absurd sizes that cannot come from this app are rejected.
let oversize = 0;
function readRow(r, speakers, legacy) {
  if (!r || typeof r.text !== "string") throw Error("テロップの形式が正しくありません。");
  if (r.text.length > LIMITS.chars * 20) throw Error("テロップの文字数が大きすぎるデータです。");
  if (charCount(r.text) > LIMITS.chars) oversize++;
  const speaker = Object.hasOwn(SPEAKERS, legacy ? r.role : r.speaker) ? (legacy ? r.role : r.speaker) : "A";
  const override = cleanStylePatch(legacy ? legacyStyle(r.override) : r.override);
  const chars = graphemes(r.text);
  let marks;
  if (legacy) {
    // Old marks were stored per code point; take the mark at each character's first code point.
    const base = mergeStyle(speakers[speaker], override).size;
    let cp = 0;
    marks = chars.map((c) => {
      const old = Array.isArray(r.marks) ? r.marks[cp] : null;
      cp += Array.from(c).length;
      if (!old) return null;
      return cleanMark({
        color: old.color,
        font: old.font,
        noAuto: old.noAuto,
        scale: typeof old.size === "number" && base ? old.size / base : undefined,
      });
    });
  } else marks = chars.map((_, i) => cleanMark(Array.isArray(r.marks) ? r.marks[i] : null));
  return { id: uid(), text: r.text, speaker, override, marks };
}

// Field names used by the first Telop Studio (sakrainari/telopstudio).
function legacyStyle(s) {
  if (!s || typeof s !== "object") return {};
  const out = {
    font: s.font,
    size: s.size,
    letterSpacing: s.letterSpacing,
    lineGap: s.lineGap,
    align: s.align,
    color: s.color,
    color2: s.color2,
    gradient: s.gradient,
    fill: s.fillOn,
  };
  if (Array.isArray(s.edges)) out.outlines = s.edges.map((e) => ({ on: e?.on, color: e?.color, width: e?.width }));
  if (s.shadow) out.shadow = { ...s.shadow };
  if (s.auto) out.auto = { on: s.auto.on, color: s.auto.color, scale: s.auto.scale };
  if (s.box)
    out.box = {
      on: s.box.on,
      color: s.box.color,
      opacity: s.box.opacity,
      radius: s.box.radius,
      padX: s.box.padLeft ?? s.box.padding,
      padY: s.box.padTop ?? s.box.padding,
    };
  return out;
}

function readSpeakers(input, legacy) {
  const speakers = defaultSpeakers();
  for (const key of Object.keys(SPEAKERS)) {
    const source = legacy ? input?.[key] : input?.[key];
    if (source) speakers[key] = mergeStyle(speakers[key], cleanStylePatch(legacy ? legacyStyle(source) : source));
  }
  return speakers;
}

export function readLibrary(data) {
  oversize = 0;
  const legacy = data?.app !== "telopstudio2" && [1, 2].includes(data?.version);
  if (!data || (!legacy && data.version !== 3) || !Array.isArray(data.projects))
    throw Error("Telop Studio のプロジェクトJSONではありません。");
  if (data.projects.length > LIMITS.projects) throw Error(`プロジェクトは${LIMITS.projects}件までです。`);
  const projects = data.projects.map((p) => {
    if (!p || !Array.isArray(p.rows) || p.rows.length > LIMITS.rows)
      throw Error(`1プロジェクトのテロップは${LIMITS.rows}枚までです。`);
    const speakers = readSpeakers(legacy ? p.roles : p.speakers, legacy);
    const rows = p.rows.map((r) => readRow(r, speakers, legacy));
    const index = Math.max(0, p.rows.findIndex((r) => r.id === p.selected));
    return { id: uid(), name: String(p.name || "名称未設定").slice(0, 80), speakers, rows, selected: rows[index]?.id || null };
  });
  const sets = Array.isArray(data.sets)
    ? data.sets.slice(0, LIMITS.sets).map((s) => ({
        id: uid(),
        name: String(s?.name || "マイセット").slice(0, 80),
        speakers: readSpeakers(legacy ? s?.roles : s?.speakers, legacy),
      }))
    : [];
  const activeIndex = Math.max(0, data.projects.findIndex((p) => p.id === data.active));
  return { projects, sets, active: projects[activeIndex]?.id || null, legacy, oversize };
}

export function importLibrary(data) {
  const incoming = readLibrary(data);
  if (library.projects.length + incoming.projects.length > LIMITS.projects)
    throw Error(`プロジェクトの合計が${LIMITS.projects}件を超えます。`);
  library.projects.push(...incoming.projects);
  library.sets.push(...incoming.sets.slice(0, Math.max(0, LIMITS.sets - library.sets.length)));
  if (incoming.projects.length) switchProject(incoming.projects[0].id);
  else emit("all");
  saveSoon();
  return incoming;
}
