// Left pane: choose, check, reorder and add captions.
import { SPEAKERS, clone, uid } from "../style.js";
import { project, ui, change, select, emit, on, LIMITS, charCount, clearSelection } from "../store.js";
import { newRow, parseScript } from "../text.js";
import { renderCaption, crop } from "../render.js";
import { $, escapeHTML, toast } from "./common.js";
import { fontsReady, renderKey } from "./fonts-ready.js";

const items = new Map(); // row id -> { li, key }
let projectId = null,
  thumbJob = 0;

function speakerOptions(selected) {
  return Object.entries(SPEAKERS)
    .map(([k, v]) => `<option value="${escapeHTML(k)}"${k === selected ? " selected" : ""}>${escapeHTML(v)}</option>`)
    .join("");
}

function createItem(r) {
  const li = document.createElement("li");
  li.className = "row-item";
  li.dataset.id = r.id;
  li.innerHTML = `
    <div class="row-left"><input type="checkbox" data-check aria-label="書き出し用に選ぶ"><span class="num"></span></div>
    <select class="who" data-speaker aria-label="話者"></select>
    <details class="menu"><summary aria-label="テロップの操作">…</summary><div class="menu-body">
      <button type="button" data-act="duplicate">複製</button>
      <button type="button" data-act="up">上へ移動</button>
      <button type="button" data-act="down">下へ移動</button>
      <button type="button" data-act="delete" class="danger">削除</button>
    </div></details>
    <button type="button" class="open" data-open><span class="thumb"></span><span class="excerpt"></span></button>`;
  return { li, key: null };
}

function syncList() {
  const p = project();
  if (projectId !== p.id) {
    items.clear();
    projectId = p.id;
  }
  const ids = new Set(p.rows.map((r) => r.id));
  for (const id of items.keys()) if (!ids.has(id)) items.delete(id);
  const fragment = document.createDocumentFragment();
  p.rows.forEach((r, i) => {
    if (!items.has(r.id)) items.set(r.id, createItem(r));
    const { li } = items.get(r.id);
    li.classList.toggle("active", r.id === p.selected);
    li.querySelector(".num").textContent = String(i + 1).padStart(2, "0");
    li.querySelector("[data-check]").checked = ui.checked.has(r.id);
    const sel = li.querySelector("[data-speaker]");
    if (sel.dataset.value !== r.speaker) {
      sel.innerHTML = speakerOptions(r.speaker);
      sel.dataset.value = r.speaker;
    }
    li.querySelector(".excerpt").textContent = r.text.replace(/\n/g, " ") || "（空のテロップ）";
    li.querySelector("[data-act=up]").disabled = i === 0;
    li.querySelector("[data-act=down]").disabled = i === p.rows.length - 1;
    fragment.append(li);
  });
  $("rows").replaceChildren(fragment);
  $("rowCount").textContent = `${p.rows.length}枚`;
  syncChecks();
  drawThumbnails();
}

function syncChecks() {
  const p = project();
  const n = p.rows.filter((r) => ui.checked.has(r.id)).length;
  $("checkAll").checked = n > 0 && n === p.rows.length;
  $("checkAll").indeterminate = n > 0 && n < p.rows.length;
}

// Thumbnails are made one at a time so typing stays responsive with many captions.
async function drawThumbnails() {
  const job = ++thumbJob;
  await fontsReady();
  const p = project();
  for (const r of p.rows) {
    if (job !== thumbJob) return;
    const entry = items.get(r.id),
      key = renderKey(r, p);
    if (!entry || entry.key === key) continue;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (job !== thumbJob) return;
    const thumb = entry.li.querySelector(".thumb");
    try {
      const c = crop(renderCaption(r, p.speakers).canvas);
      const scale = Math.min(1, 250 / c.width, 54 / c.height);
      const small = document.createElement("canvas");
      small.width = Math.max(1, Math.round(c.width * scale));
      small.height = Math.max(1, Math.round(c.height * scale));
      small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
      const img = new Image();
      img.alt = "";
      img.src = small.toDataURL();
      thumb.replaceChildren(img);
    } catch (e) {
      thumb.textContent = "描画できません";
    }
    entry.key = key;
  }
}

function addRows(rows) {
  const p = project();
  if (p.rows.length + rows.length > LIMITS.rows) {
    toast(`1プロジェクトは${LIMITS.rows}枚までです。`, true);
    return false;
  }
  change("テロップを追加", () => {
    const at = p.rows.findIndex((r) => r.id === p.selected);
    p.rows.splice(at + 1, 0, ...rows);
    p.selected = rows[0].id;
  });
  clearSelection();
  emit("all");
  return true;
}
export { addRows };

function act(action, id) {
  const p = project(),
    index = p.rows.findIndex((r) => r.id === id);
  if (index < 0) return;
  if (action === "duplicate") {
    if (p.rows.length >= LIMITS.rows) return toast(`1プロジェクトは${LIMITS.rows}枚までです。`, true);
    change("テロップを複製", () => {
      const copy = { ...clone(p.rows[index]), id: uid() };
      p.rows.splice(index + 1, 0, copy);
      p.selected = copy.id;
    });
  } else if (action === "delete") {
    change("テロップを削除", () => {
      p.rows.splice(index, 1);
      ui.checked.delete(id);
      if (!p.rows.length) p.rows.push(newRow(""));
      if (p.selected === id) p.selected = p.rows[Math.min(index, p.rows.length - 1)].id;
    });
  } else {
    const to = index + (action === "up" ? -1 : 1);
    if (to < 0 || to >= p.rows.length) return;
    change("テロップを移動", () => ([p.rows[index], p.rows[to]] = [p.rows[to], p.rows[index]]));
  }
  clearSelection();
  emit("all");
}

export function initList() {
  $("rows").addEventListener("click", (e) => {
    const li = e.target.closest(".row-item");
    if (!li) return;
    const button = e.target.closest("[data-act]");
    if (button) {
      button.closest("details").open = false;
      return act(button.dataset.act, li.dataset.id);
    }
    if (e.target.closest("[data-open]")) select(li.dataset.id);
  });
  $("rows").addEventListener("change", (e) => {
    const li = e.target.closest(".row-item");
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.matches("[data-check]")) {
      e.target.checked ? ui.checked.add(id) : ui.checked.delete(id);
      syncChecks();
      emit("checked");
    } else if (e.target.matches("[data-speaker]")) {
      const r = project().rows.find((x) => x.id === id);
      change("話者を変更", () => (r.speaker = e.target.value));
      emit("all");
    }
  });
  $("checkAll").onchange = () => {
    const p = project();
    if ($("checkAll").checked) p.rows.forEach((r) => ui.checked.add(r.id));
    else ui.checked.clear();
    syncList();
    emit("checked");
  };
  $("addRow").onclick = () => {
    const current = project().rows.find((r) => r.id === project().selected);
    if (addRows([newRow("", current?.speaker || "A")])) $("editor").focus();
  };
  $("scriptOpen").onclick = () => {
    $("scriptText").value = "";
    $("scriptDialog").showModal();
  };
  $("scriptAdd").onclick = () => {
    const rows = parseScript($("scriptText").value);
    if (!rows.length) return toast("台本を入力してください。");
    if (rows.some((r) => charCount(r.text) > LIMITS.chars)) return toast(`1枚${LIMITS.chars}文字以内にしてください。`, true);
    if (addRows(rows)) {
      $("scriptDialog").close();
      toast(`${rows.length}枚を追加しました。`);
    }
  };
  on("all", syncList);
  on("change", syncList);
}
