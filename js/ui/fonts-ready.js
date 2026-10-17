// Waits for the fonts a project actually uses before anything is drawn,
// and gives each caption a key that changes only when its picture would change.
import { project } from "../store.js";
import { loadFonts } from "../fonts.js";

let epoch = 0,
  requestKey = null,
  request = Promise.resolve();

export function usedFamilies(p = project()) {
  const set = new Set();
  for (const s of Object.values(p.speakers)) set.add(s.font);
  for (const r of p.rows) {
    if (r.override.font) set.add(r.override.font);
    for (const m of r.marks) if (m?.font) set.add(m.font);
  }
  return [...set];
}

export function fontsReady() {
  const p = project();
  const text = [...new Set(p.rows.map((r) => r.text).join(""))].join("");
  const families = usedFamilies(p);
  const key = JSON.stringify([epoch, families, text]);
  if (key !== requestKey) {
    requestKey = key;
    request = loadFonts(families, text);
  }
  return request;
}

// Call after a font is added or removed: every picture may change.
export function fontsChanged() {
  epoch++;
  requestKey = null;
}

export const renderKey = (row, p = project()) =>
  JSON.stringify([epoch, row.text, row.speaker, row.override, row.marks, p.speakers[row.speaker]]);
