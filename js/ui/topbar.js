// Top bar: projects, undo/redo, save state and everything that leaves the app (export).
import { SPEAKERS } from "../style.js";
import {
  library, project, row, ui, on, emit, undo, redo, historyInfo, switchProject, addProject, deleteProject,
  change, saveState, exportProjectJSON, importLibrary,
} from "../store.js";
import { renderOutput } from "../render.js";
import { createZip } from "../zip.js";
import { $, escapeHTML, toast, askName, download, toBlob } from "./common.js";
import { fontsReady } from "./fonts-ready.js";

const MODE_KEY = "telopstudio2-export";
let busy = false;

const exportMode = () => document.querySelector("input[name=exportMode]:checked")?.value || "frame";

function fileName(r, index) {
  const text = r.text.replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 16) || "telop";
  return `${String(index + 1).padStart(2, "0")}_${SPEAKERS[r.speaker]}_${text}.png`;
}

function syncProjects() {
  $("projectSelect").innerHTML = library.projects
    .map((p) => `<option value="${escapeHTML(p.id)}"${p.id === library.active ? " selected" : ""}>${escapeHTML(p.name)}</option>`)
    .join("");
}

function syncHistory() {
  const h = historyInfo();
  $("undo").disabled = !h.canUndo;
  $("redo").disabled = !h.canRedo;
  $("undo").title = h.canUndo ? `元に戻す：${h.items[h.cursor].name}（Ctrl+Z）` : "元に戻す（Ctrl+Z）";
}

function syncSave() {
  const el = $("saveState");
  el.textContent = ui.storageError
    ? "保存データを読めないため自動保存を止めています"
    : { saved: "保存済み", saving: "保存中…", failed: "保存できません（容量不足）" }[saveState];
  el.classList.toggle("failed", ui.storageError || saveState === "failed");
}

function syncExport() {
  const n = project().rows.filter((r) => ui.checked.has(r.id)).length;
  $("zipChecked").textContent = n ? `チェックした${n}枚をZIP` : "チェックしたテロップをZIP";
  $("zipChecked").disabled = !n || busy;
  $("zipAll").disabled = busy;
  $("copyPng").disabled = $("savePng").disabled = !row();
}

async function outputCanvas(r) {
  await fontsReady();
  return renderOutput(r, project().speakers, exportMode());
}

async function copyCurrent() {
  const r = row();
  if (!r) return;
  try {
    // Safari needs the ClipboardItem to be created synchronously with a promise.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": outputCanvas(r).then(toBlob) })]);
    toast("画像をコピーしました。編集ソフトに貼り付けられます。");
  } catch {
    toast("このブラウザでは画像をコピーできません。「PNGで保存」を使ってください。", true);
  }
}

async function saveCurrent() {
  const r = row();
  if (!r) return;
  download(await toBlob(await outputCanvas(r)), fileName(r, project().rows.indexOf(r)));
}

async function saveZip(onlyChecked) {
  if (busy) return;
  const p = project();
  const rows = p.rows.filter((r) => !onlyChecked || ui.checked.has(r.id));
  if (!rows.length) return;
  busy = true;
  syncExport();
  const mode = exportMode(),
    files = [];
  try {
    await fontsReady();
    for (const [i, r] of rows.entries()) {
      $("zipProgress").textContent = `${i + 1} / ${rows.length} 枚を作成中…`;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const blob = await toBlob(renderOutput(r, p.speakers, mode));
      files.push({ name: fileName(r, p.rows.indexOf(r)), data: new Uint8Array(await blob.arrayBuffer()) });
    }
    download(createZip(files), `${p.name.replace(/[\\/:*?"<>|]+/g, "_") || "telop"}.zip`);
    $("zipProgress").textContent = `${rows.length}枚をZIPにしました。`;
  } catch (e) {
    $("zipProgress").textContent = "";
    toast("ZIPを作れませんでした：" + e.message, true);
  } finally {
    busy = false;
    syncExport();
  }
}

async function projectAction(action) {
  $("projectMenu").open = false;
  try {
    if (action === "new") {
      const name = await askName("新しいプロジェクト", "新しいショート");
      if (name) addProject(name);
    } else if (action === "rename") {
      const name = await askName("プロジェクト名", project().name);
      if (name) {
        change("プロジェクト名を変更", (p) => (p.name = name));
        syncProjects();
      }
    } else if (action === "delete") {
      if (confirm(`「${project().name}」を削除しますか？ 先にJSONで保存しておくと元に戻せます。`)) deleteProject();
    } else if (action === "export") {
      download(new Blob([exportProjectJSON()], { type: "application/json" }), `${project().name || "telop"}.json`);
    } else if (action === "import") {
      $("jsonFile").value = "";
      $("jsonFile").click();
    }
  } catch (e) {
    toast(e.message, true);
  }
}

export function initTopbar() {
  $("projectSelect").onchange = () => switchProject($("projectSelect").value);
  $("projectMenu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-project]");
    if (b) projectAction(b.dataset.project);
  });
  $("jsonFile").onchange = async () => {
    const file = $("jsonFile").files[0];
    if (!file) return;
    if (file.size > 200 * 1024 * 1024 && !confirm("200MBを超える大きなJSONです。読み込みに時間がかかります。続けますか？")) return;
    try {
      const result = importLibrary(JSON.parse(await file.text()));
      toast(
        result.legacy
          ? "旧Telop StudioのJSONを読み込みました。自動折り返しと位置はTelop Studio 2の標準になっています。"
          : "JSONを読み込みました。",
      );
    } catch (e) {
      toast("読み込めません：" + e.message, true);
    }
  };
  $("undo").onclick = undo;
  $("redo").onclick = redo;
  $("exportOpen").onclick = () => {
    syncExport();
    $("zipProgress").textContent = "";
    $("exportDialog").showModal();
  };
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "crop" || saved === "frame") document.querySelector(`input[name=exportMode][value=${saved}]`).checked = true;
  } catch {}
  for (const radio of document.querySelectorAll("input[name=exportMode]"))
    radio.onchange = () => {
      try {
        localStorage.setItem(MODE_KEY, exportMode());
      } catch {}
    };
  $("copyPng").onclick = copyCurrent;
  $("savePng").onclick = saveCurrent;
  $("zipChecked").onclick = () => saveZip(true);
  $("zipAll").onclick = () => saveZip(false);

  on("all", () => {
    syncProjects();
    syncHistory();
    syncSave();
    syncExport();
  });
  on("change", syncHistory);
  on("save", syncSave);
  on("checked", syncExport);
}
