// Built-in web fonts plus fonts the user adds (a font file, or a font installed on the PC).
import { BUILTIN_FONTS } from "./style.js";

const DB = "telopstudio2-fonts";
let userFonts = [];

function store(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("fonts", { keyPath: "family" });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction("fonts", mode),
        req = action(tx.objectStore("fonts"));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

export function weightOf(family) {
  return BUILTIN_FONTS.find((f) => f.family === family)?.weight ?? 400;
}

export const fontString = (family, size) =>
  `${weightOf(family)} ${size}px "${family}", "Noto Sans JP", sans-serif`;

export function allFonts() {
  return [
    ...BUILTIN_FONTS.map((f) => ({ ...f, source: "builtin" })),
    ...userFonts.map((f) => ({ ...f, label: f.family, weight: 400 })),
  ];
}

async function register(family, data) {
  const face = new FontFace(family, data);
  await face.load();
  document.fonts.add(face);
}

export async function initUserFonts() {
  if (!window.indexedDB) return false;
  try {
    const items = (await store("readonly", (s) => s.getAll())) || [];
    for (const item of items) {
      if (item.source === "file") {
        try {
          await register(item.family, item.data);
        } catch {
          continue;
        }
      }
      userFonts.push({ family: item.family, source: item.source });
    }
    return true;
  } catch {
    return false;
  }
}

const cleanName = (name) => {
  const family = String(name || "").trim().replace(/\.(ttf|otf|woff2?)$/i, "");
  if (!/^[^"'\\<>;{}]{1,100}$/.test(family)) throw Error("フォント名に使えない文字があります。");
  if (allFonts().some((f) => f.family === family)) throw Error(`「${family}」はすでに一覧にあります。`);
  return family;
};

export async function addFontFile(file) {
  if (file.size > 40 * 1024 * 1024) throw Error("40MB以下のフォントファイルを選んでください。");
  const family = cleanName(file.name);
  const data = await file.arrayBuffer();
  try {
    await register(family, data);
  } catch {
    throw Error("フォントとして読み込めませんでした。");
  }
  userFonts.push({ family, source: "file" });
  await store("readwrite", (s) => s.put({ family, source: "file", data })).catch(() => {});
  return family;
}

// A font installed on this PC, referenced by name only.
export async function addLocalFont(name) {
  const family = cleanName(name);
  const probe = document.createElement("canvas").getContext("2d");
  const width = (font) => {
    probe.font = `64px ${font}`;
    return probe.measureText("テロップAa123").width;
  };
  if (width(`"${family}", monospace`) === width("monospace") && width(`"${family}", serif`) === width("serif"))
    throw Error(`「${family}」がこのPCで見つかりません。正確な名前を入力してください。`);
  userFonts.push({ family, source: "local" });
  await store("readwrite", (s) => s.put({ family, source: "local" })).catch(() => {});
  return family;
}

export async function removeFont(family) {
  userFonts = userFonts.filter((f) => f.family !== family);
  await store("readwrite", (s) => s.delete(family)).catch(() => {});
}

export function loadFonts(families, text) {
  const sample = text || "テロップあア亜Aa1";
  return Promise.allSettled(
    [...new Set(families)].map((f) => document.fonts.load(fontString(f, 40), sample)),
  );
}
