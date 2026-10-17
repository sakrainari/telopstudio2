// Right pane: change how captions look, for a speaker, one caption, or selected characters.
import { SPEAKERS, SAMPLES, clone, uid, setPath, getPath, deletePath, sampleSpeakers } from "../style.js";
import { project, row, ui, change, emit, on, library, saveSoon, LIMITS } from "../store.js";
import { applyMark } from "../text.js";
import { styleOf } from "../render.js";
import { allFonts, addFontFile, addLocalFont, removeFont, weightOf, canListLocalFonts, localFontFamilies } from "../fonts.js";
import { $, escapeHTML, toast, askName } from "./common.js";
import { fontsChanged } from "./fonts-ready.js";

const OPEN_KEY = "telopstudio2-sections";
let openSections = { font: true, text: true, outline: true };
let styleClipboard = null;

// ---------- field schema ----------
const range = (path, label, min, max, step = 1, unit = "") => ({ type: "range", path, label, min, max, step, unit });
const color = (path, label) => ({ type: "color", path, label });
const toggle = (path, label) => ({ type: "toggle", path, label });

const SECTIONS = [
  { id: "font", title: "フォント", chars: true, custom: "font" },
  {
    id: "text", title: "文字", chars: true,
    fields: [
      range("size", "大きさ", 16, 260, 1, "px"),
      toggle("fill", "文字を塗る"),
      color("color", "文字の色"),
      toggle("gradient", "グラデーション"),
      color("color2", "下側の色"),
      range("letterSpacing", "字間", -40, 120),
      range("lineGap", "行間", -40, 200),
      { type: "align", path: "align", label: "揃え" },
    ],
  },
  { id: "outline", title: "フチ", custom: "outline" },
  {
    id: "shadow", title: "影",
    fields: [toggle("shadow.on", "影をつける"), color("shadow.color", "色"), range("shadow.opacity", "濃さ", 0, 1, 0.05), range("shadow.blur", "ぼかし", 0, 60), range("shadow.distance", "距離", 0, 80), range("shadow.angle", "向き", 0, 360, 5, "°")],
  },
  {
    id: "box", title: "座布団（背景の帯）",
    fields: [toggle("box.on", "座布団を敷く"), color("box.color", "色"), range("box.opacity", "濃さ", 0, 1, 0.05), range("box.radius", "角の丸み", 0, 120), range("box.padX", "左右の余白", 0, 200), range("box.padY", "上下の余白", 0, 200)],
  },
  {
    id: "layout", title: "折り返しと位置", custom: "layout",
    fields: [toggle("wrap.on", "自動で折り返す"), range("wrap.width", "折り返し幅", 200, 1080, 10, "px"), range("wrap.maxLines", "最大行数", 1, 8), toggle("wrap.shrink", "入らない時は縮小"), range("pos.x", "横の位置", 0, 100, 0.5, "%"), range("pos.y", "縦の位置", 0, 100, 0.5, "%")],
  },
  {
    id: "auto", title: "自動強調（数字・！？・『』）",
    fields: [toggle("auto.on", "自動で強調"), color("auto.color", "強調の色"), range("auto.scale", "強調の大きさ", 1, 2, 0.05, "倍")],
  },
  { id: "carry", title: "サンプル・マイセット・コピー", custom: "carry" },
];

// ---------- reading and writing the current target ----------
function effective() {
  const r = row(),
    p = project();
  const speaker = r?.speaker || "A";
  if (ui.scope === "speaker" || !r) return p.speakers[speaker];
  return styleOf(r, p.speakers);
}

function isOverridden(path) {
  const r = row();
  return ui.scope === "row" && r && getPath(r.override, path) !== undefined;
}

function charsMark() {
  const r = row();
  return r && ui.range ? r.marks[ui.range.start] || {} : {};
}

function displayValue(path) {
  if (ui.scope === "chars") {
    const mark = charsMark(),
      base = effective();
    if (path === "size") return Math.round(base.size * (mark.scale || 1));
    if (path === "color") return mark.color || base.color;
    if (path === "font") return mark.font || base.font;
  }
  return getPath(effective(), path);
}

const label = (path) => {
  for (const s of SECTIONS) for (const f of s.fields || []) if (f.path === path) return `${s.title}：${f.label}`;
  return path;
};

function write(path, value, name = label(path) + "を変更") {
  const r = row();
  const key = `${ui.scope}:${r?.id}:${r?.speaker}:${ui.range?.start}:${path}`;
  if (ui.scope === "chars") {
    if (!r || !ui.range) return toast("先に入力欄で文字を選んでください。");
    const base = effective();
    const patch = path === "size" ? { scale: Math.round((value / base.size) * 100) / 100 } : { [path]: value };
    change(name, () => applyMark(r, ui.range, patch), key);
  } else if (ui.scope === "row") {
    if (!r) return;
    change(name, () => setPath(r.override, path, value), key);
  } else {
    const speaker = r?.speaker || "A";
    change(name, (p) => setPath(p.speakers[speaker], path, value), key);
  }
}

// ---------- building the form ----------
function fieldHTML(f) {
  const id = "f-" + f.path.replaceAll(".", "-");
  const v = displayValue(f.path);
  const cls = `field${isOverridden(f.path) ? " changed" : ""}`;
  if (f.type === "range")
    return `<div class="${cls}"><label for="${id}">${f.label}</label><div class="slider"><input type="range" id="${id}" data-path="${f.path}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}"><input type="number" aria-label="${f.label}の数値" data-path="${f.path}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}"></div></div>`;
  if (f.type === "color")
    return `<div class="${cls}"><label for="${id}">${f.label}</label><div class="color"><input type="color" id="${id}" data-path="${f.path}" value="${v}"><code>${String(v).toUpperCase()}</code></div></div>`;
  if (f.type === "toggle")
    return `<div class="${cls}"><label for="${id}">${f.label}</label><input type="checkbox" id="${id}" data-path="${f.path}"${v ? " checked" : ""}></div>`;
  if (f.type === "align")
    return `<div class="${cls}"><label>${f.label}</label><div class="segmented" role="group" aria-label="揃え">${[["left", "左"], ["center", "中央"], ["right", "右"]].map(([k, t]) => `<button type="button" data-align="${k}" aria-pressed="${v === k}">${t}</button>`).join("")}</div></div>`;
  return "";
}

function fontHTML() {
  const active = displayValue("font");
  const sample = (row()?.text || "").replace(/\s+/g, "").slice(0, 8) || "テロップ";
  const list = allFonts()
    .map(
      (f) => `<div class="font-item" aria-current="${f.family === active}"><button type="button" data-font="${escapeHTML(f.family)}"><span class="sample" style="font-family:'${escapeHTML(f.family)}',sans-serif;font-weight:${weightOf(f.family)}">${escapeHTML(sample)}</span><small>${escapeHTML(f.label)}${f.source === "file" ? "（追加したファイル）" : f.source === "local" ? "（PCのフォント）" : ""}</small></button>${f.source !== "builtin" ? `<button type="button" data-remove-font="${escapeHTML(f.family)}" aria-label="${escapeHTML(f.family)}を一覧から外す">×</button>` : ""}</div>`,
    )
    .join("");
  return `<div class="font-list">${list}</div>
    <details><summary class="hint">＋ 自分のフォントを追加</summary>
      <div class="fields" style="padding:8px 0 0">
        <button type="button" data-font-pick class="primary">PCのフォントから選ぶ</button>
        <button type="button" data-font-file>フォントファイルを読み込む</button>
        <p class="hint">ファイルは .ttf .otf .woff .woff2 に対応しています。</p>
        <details><summary class="hint">一覧が開かないときは名前で追加</summary>
          <div class="inline" style="margin-top:6px"><input type="text" data-font-name placeholder="フォント名（例：メイリオ）" aria-label="PCのフォント名"><button type="button" data-font-add>追加</button></div>
        </details>
        <p class="hint">追加したフォントはこのブラウザに保存されます。別のPCではもう一度追加してください。</p>
      </div>
    </details>`;
}

function outlineHTML() {
  const s = effective();
  return s.outlines
    .map((o, i) => {
      const base = `outlines.${i}`;
      return `<div class="layer"><div class="layer-head"><span>${["内側", "まん中", "外側"][i]}のフチ</span><input type="checkbox" aria-label="${["内側", "まん中", "外側"][i]}のフチを使う" data-path="${base}.on"${o.on ? " checked" : ""}></div>
        ${fieldHTML(color(`${base}.color`, "色"))}
        ${fieldHTML(range(`${base}.width`, "太さ", 0, 40))}</div>`;
    })
    .join("");
}

function carryHTML() {
  const sets = library.sets
    .map((s) => `<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)}</option>`)
    .join("");
  const checked = project().rows.filter((r) => ui.checked.has(r.id)).length;
  return `<div class="fields" style="padding:0">
    <div class="inline"><select data-sample aria-label="サンプル・マイセット"><optgroup label="サンプル">${Object.entries(SAMPLES).map(([k, v]) => `<option value="sample:${k}">${v}</option>`).join("")}</optgroup>${sets ? `<optgroup label="マイセット">${sets}</optgroup>` : ""}</select><button type="button" data-apply-set class="primary">全話者に当てる</button></div>
    <label class="check"><input type="checkbox" data-keep-font checked>フォントは今のまま</label>
    <p class="hint">配色とフチ・影・座布団だけを入れ替えます。位置と折り返しはそのままです。</p>
    <button type="button" data-save-set>今の5話者をマイセットに保存</button>
    <div class="inline"><button type="button" data-copy-style>このテロップの見た目をコピー</button><button type="button" data-paste-style${styleClipboard ? "" : " disabled"}>貼り付け（${checked ? `チェックした${checked}枚` : "このテロップ"}）</button></div>
  </div>`;
}

function layoutExtraHTML() {
  if (ui.scope !== "row") return "";
  return `<button type="button" data-pos-to-speaker>この位置を${escapeHTML(SPEAKERS[row()?.speaker || "A"])}全体にも使う</button>`;
}

function sectionHTML(s) {
  const disabled = ui.scope === "chars" && !s.chars;
  let body;
  if (s.custom === "font") body = fontHTML();
  else if (s.custom === "outline") body = outlineHTML();
  else if (s.custom === "carry") body = carryHTML();
  else {
    const fields = ui.scope === "chars" ? s.fields.filter((f) => ["size", "color"].includes(f.path)) : s.fields;
    body = fields.map(fieldHTML).join("") + (s.custom === "layout" ? layoutExtraHTML() : "");
  }
  const note = disabled ? "<small>選んだ文字では変えられません</small>" : "";
  return `<details class="section" data-section="${s.id}"${openSections[s.id] && !disabled ? " open" : ""}${disabled ? " disabled" : ""}><summary>${s.title}${note}</summary><fieldset class="fields" style="border:0;margin:0"${disabled ? " disabled" : ""}>${body}</fieldset></details>`;
}

function hintText() {
  const r = row(),
    speaker = SPEAKERS[r?.speaker || "A"];
  if (ui.scope === "speaker") return `${speaker}のすべてのテロップに反映します。`;
  if (ui.scope === "row") return `このテロップだけに反映します。●は${speaker}の設定から変えた項目です。`;
  if (!ui.range) return "中央の入力欄で文字をドラッグして選んでください。";
  return "選んだ文字の色・大きさ・フォントだけを変えます。";
}

function build() {
  for (const b of document.querySelectorAll("[data-scope]")) b.setAttribute("aria-pressed", String(b.dataset.scope === ui.scope));
  const r = row();
  let extra = "";
  if (ui.scope === "row" && r && Object.keys(r.override).length)
    extra = `<button type="button" data-clear-override class="danger">このテロップの個別設定を消す</button>`;
  $("scopeHint").innerHTML = escapeHTML(hintText()) + (extra ? `<br>${extra}` : "");
  $("styleForm").innerHTML = SECTIONS.map(sectionHTML).join("");
}

// Update values in place while the user is dragging a slider (rebuilding would drop the drag).
function refreshValues() {
  const focused = document.activeElement;
  for (const input of $("styleForm").querySelectorAll("[data-path]")) {
    if (input === focused) continue;
    const v = displayValue(input.dataset.path);
    if (input.type === "checkbox") input.checked = Boolean(v);
    else input.value = v;
    if (input.type === "color") input.nextElementSibling.textContent = String(v).toUpperCase();
    input.closest(".field")?.classList.toggle("changed", isOverridden(input.dataset.path));
  }
  // Slider and number pair stay in sync.
  if (focused?.dataset?.path) for (const twin of $("styleForm").querySelectorAll(`[data-path="${focused.dataset.path}"]`)) if (twin !== focused && twin.type !== "checkbox") twin.value = focused.value;
}

// ---------- actions ----------
function applySet(value, keepFont) {
  const speakers = value.startsWith("sample:")
    ? sampleSpeakers(value.slice(7))
    : clone(library.sets.find((s) => s.id === value)?.speakers || null);
  if (!speakers) return;
  change("サンプル・マイセットを当てる", (p) => {
    for (const key of Object.keys(SPEAKERS)) {
      const old = p.speakers[key];
      p.speakers[key] = { ...speakers[key], pos: old.pos, wrap: old.wrap, font: keepFont ? old.font : speakers[key].font };
    }
  });
  emit("all");
  toast("5話者の見た目を入れ替えました。戻すときは ↶ を押してください。");
}

async function onClick(e) {
  const t = e.target;
  const r = row();
  if (t.closest("[data-font]")) {
    write("font", t.closest("[data-font]").dataset.font, "フォントを変更");
    return build();
  }
  if (t.closest("[data-remove-font]")) {
    const family = t.closest("[data-remove-font]").dataset.removeFont;
    if (!confirm(`「${family}」を一覧から外しますか？使っているテロップは代わりのフォントで表示されます。`)) return;
    await removeFont(family);
    fontsChanged();
    emit("all");
    return;
  }
  if (t.closest("[data-font-pick]")) return openLocalFonts();
  if (t.closest("[data-font-file]")) {
    $("fontFile").value = "";
    return $("fontFile").click();
  }
  if (t.closest("[data-font-add]")) {
    const input = $("styleForm").querySelector("[data-font-name]");
    try {
      const family = await addLocalFont(input.value);
      fontsChanged();
      emit("all");
      toast(`「${family}」を追加しました。`);
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  if (t.closest("[data-align]")) return write("align", t.closest("[data-align]").dataset.align, "揃えを変更");
  if (t.closest("[data-apply-set]")) {
    const form = $("styleForm");
    return applySet(form.querySelector("[data-sample]").value, form.querySelector("[data-keep-font]").checked);
  }
  if (t.closest("[data-save-set]")) {
    const name = await askName("マイセットの名前", "マイセット");
    if (!name) return;
    if (library.sets.length >= LIMITS.sets) return toast(`マイセットは${LIMITS.sets}件までです。`, true);
    library.sets.push({ id: uid(), name, speakers: clone(project().speakers) });
    saveSoon();
    build();
    return toast(`「${name}」を保存しました。`);
  }
  if (t.closest("[data-copy-style]")) {
    if (!r) return;
    styleClipboard = clone(r.override);
    styleClipboard.__speaker = r.speaker;
    build();
    return toast("このテロップの個別設定をコピーしました。");
  }
  if (t.closest("[data-paste-style]")) {
    const p = project();
    const targets = ui.checked.size ? p.rows.filter((x) => ui.checked.has(x.id)) : r ? [r] : [];
    const { __speaker, ...patch } = styleClipboard;
    change("見た目を貼り付け", () => targets.forEach((x) => (x.override = clone(patch))));
    emit("all");
    return toast(`${targets.length}枚に貼り付けました。`);
  }
  if (t.closest("[data-pos-to-speaker]")) {
    if (!r) return;
    const pos = styleOf(r, project().speakers).pos;
    change("位置を話者全体に使う", (p) => {
      p.speakers[r.speaker].pos = { ...pos };
      deletePath(r.override, "pos");
    });
    return emit("all");
  }
  if (t.closest("[data-clear-override]")) {
    if (!r) return;
    change("個別設定を消す", () => (r.override = {}));
    return emit("all");
  }
}

// ---------- choose from fonts installed on this PC ----------
let localFamilies = [];

function renderLocalFonts() {
  const q = $("localFontSearch").value.trim().toLowerCase();
  const added = new Set(allFonts().map((f) => f.family));
  const sample = (row()?.text || "").replace(/\s+/g, "").slice(0, 10) || "テロップの見本 Aa123";
  const list = localFamilies.filter((f) => f.toLowerCase().includes(q));
  const shown = list.slice(0, 400);
  $("localFontCount").textContent =
    `${localFamilies.length}書体のうち${list.length}件` + (list.length > shown.length ? `（先頭${shown.length}件を表示。名前で絞り込めます）` : "");
  $("localFontList").innerHTML =
    shown
      .map(
        (f) => `<button type="button" class="local-font" data-local-font="${escapeHTML(f)}"${added.has(f) ? " disabled" : ""}>
          <span class="sample" style="font-family:'${escapeHTML(f)}',sans-serif">${escapeHTML(sample)}</span>
          <small>${escapeHTML(f)}${added.has(f) ? "（追加済み）" : ""}</small></button>`,
      )
      .join("") || '<p class="hint">見つかりません。別の名前で探してください。</p>';
}

async function openLocalFonts() {
  if (!canListLocalFonts())
    return toast("このブラウザではPCのフォント一覧を読めません（Chrome・Edgeで使えます）。「名前で追加」を使ってください。", true);
  try {
    localFamilies = await localFontFamilies();
  } catch {
    return toast("フォント一覧の読み取りが許可されませんでした。アドレスバーの鍵マークから「フォント」を許可するか、「名前で追加」を使ってください。", true);
  }
  if (!localFamilies.length) return toast("PCのフォントが見つかりませんでした。「名前で追加」を使ってください。", true);
  $("localFontSearch").value = "";
  renderLocalFonts();
  $("localFontDialog").showModal();
  $("localFontSearch").focus();
}

function onInput(e) {
  const el = e.target,
    path = el.dataset.path;
  if (!path) return;
  let value;
  if (el.type === "checkbox") value = el.checked;
  else if (el.type === "range" || el.type === "number") {
    if (el.value === "") return;
    value = Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value)));
    if (!Number.isFinite(value)) return;
  } else value = el.value;
  if (el.type === "color") el.nextElementSibling.textContent = value.toUpperCase();
  write(path, value);
}

export function initStylePanel() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY) || "null");
    if (saved && typeof saved === "object") openSections = saved;
  } catch {}
  for (const b of document.querySelectorAll("[data-scope]"))
    b.onclick = () => {
      const scope = b.dataset.scope;
      if (scope === "chars" && !ui.range) return toast("中央の入力欄で文字をドラッグして選んでください。");
      if (scope !== "chars") {
        ui.scopeBeforeChars = scope;
        if (ui.scope === "chars") {
          // Collapse the text selection too, or the editor would switch straight back.
          const el = $("editor");
          el.setSelectionRange(el.selectionEnd, el.selectionEnd);
          ui.range = null;
          emit("selection");
        }
      }
      ui.scope = scope;
      emit("scope");
    };
  $("styleForm").addEventListener("input", onInput);
  $("styleForm").addEventListener("click", onClick);
  $("scopeHint").addEventListener("click", onClick);
  $("styleForm").addEventListener(
    "toggle",
    (e) => {
      const section = e.target.closest?.("[data-section]");
      if (!section || e.target !== section || section.hasAttribute("disabled")) return;
      openSections[section.dataset.section] = section.open;
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(openSections));
      } catch {}
    },
    true,
  );
  $("localFontSearch").addEventListener("input", renderLocalFonts);
  $("localFontList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-local-font]");
    if (!b) return;
    try {
      const family = await addLocalFont(b.dataset.localFont, { fromList: true });
      fontsChanged();
      // Use the new font right away for the current target, then keep the list open for more.
      write("font", family, "フォントを変更");
      emit("all");
      renderLocalFonts();
      toast(`「${family}」を追加して使いました。`);
    } catch (err) {
      toast(err.message, true);
    }
  });
  $("fontFile").onchange = async () => {
    const added = [];
    for (const file of $("fontFile").files)
      try {
        added.push(await addFontFile(file));
      } catch (err) {
        toast(`${file.name}：${err.message}`, true);
      }
    if (added.length) {
      fontsChanged();
      emit("all");
      toast(`${added.join("、")}を追加しました。`);
    }
  };
  on("all", build);
  on("scope", build);
  on("checked", build);
  on("change", refreshValues);
}
