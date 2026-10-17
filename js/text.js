// Text handling: visible characters, script import, emphasis and line breaks.
// Marks are stored per visible character (grapheme), so emoji and combining
// marks are always selected, decorated and measured as one character.
import { uid, mergeStyle } from "./style.js";

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter("ja", { granularity: "word" });

export const graphemes = (text) =>
  Array.from(graphemeSegmenter.segment(text), (s) => s.segment);

// Convert a textarea UTF-16 offset to a grapheme index (rounding to a boundary).
export function graphemeIndex(text, offset) {
  let index = 0,
    pos = 0;
  for (const g of graphemeSegmenter.segment(text)) {
    if (pos >= offset) return index;
    pos += g.segment.length;
    index++;
  }
  return index;
}

export function utf16Offset(text, index) {
  return graphemes(text).slice(0, index).join("").length;
}

export function newRow(text = "", speaker = "A") {
  return { id: uid(), text, speaker, override: {}, marks: graphemes(text).map(() => null) };
}

const PREFIX = /^([ABNＡＢＮ])\s*[:：]\s*/i;

// Blank lines separate captions. A leading "A:", "B:", "N:", "※" or "!" picks the speaker.
export function parseScript(source) {
  return source
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let text = block,
        speaker = "A";
      const prefix = text.match(PREFIX);
      if (prefix) {
        speaker = prefix[1].normalize("NFKC").toUpperCase();
        text = text.slice(prefix[0].length);
      } else if (text.startsWith("※")) speaker = "※";
      else if (/^[!！]/.test(text)) {
        speaker = "!";
        text = text.slice(1).trimStart();
      }
      return newRow(text, speaker);
    });
}

// Keep decorations attached to unchanged characters when the text is edited.
export function updateText(row, text) {
  const a = graphemes(row.text),
    b = graphemes(text);
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  row.marks = [
    ...row.marks.slice(0, start),
    ...Array(b.length - start - end).fill(null),
    ...row.marks.slice(a.length - end),
  ];
  row.text = text;
}

export function applyMark(row, range, patch) {
  for (let i = range.start; i < range.end; i++) {
    if (patch === null) row.marks[i] = null;
    else row.marks[i] = { ...(row.marks[i] || {}), ...patch };
  }
}

const AUTO =
  /[0-9０-９]+(?:[.,．，][0-9０-９]+)*(?:万円|億円|万|億|円|[%％]|つ|個|人|回|秒|分|時間|年|日|倍|本|歳|点|位|か国|km|cm|mm|kg|m|g)?|[!！?？]+|『[^』\n]*』|【[^】\n]*】/gu;

// Characters with their resolved style (speaker -> card override -> auto -> mark).
export function tokens(row, style) {
  const chars = graphemes(row.text);
  const auto = new Set();
  if (style.auto.on) {
    let offset = 0;
    const starts = chars.map((c) => {
      const s = offset;
      offset += c.length;
      return s;
    });
    for (const m of row.text.matchAll(AUTO)) {
      if (/^[0-9０-９]+$/.test(m[0]) && m[0].length < 2) continue;
      starts.forEach((s, i) => {
        if (s >= m.index && s < m.index + m[0].length) auto.add(i);
      });
    }
  }
  return chars.map((char, i) => {
    const mark = row.marks[i] || {};
    let s = style;
    if (auto.has(i) && !mark.noAuto)
      s = mergeStyle(s, { size: s.size * s.auto.scale, color: s.auto.color, gradient: false });
    const patch = {};
    if (mark.color) Object.assign(patch, { color: mark.color, gradient: false });
    if (mark.font) patch.font = mark.font;
    if (mark.scale) patch.size = s.size * mark.scale;
    return { char, index: i, auto: auto.has(i) && !mark.noAuto, style: mergeStyle(s, patch) };
  });
}

// ---------- line breaking ----------

const NO_START = new Set(
  Array.from("、。，．,.・：；:;？！?!ー～」』）)】〕〉》〙〗ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々ゝゞヽヾ…‥"),
);
const NO_END = new Set(Array.from("「『（(【〔〈《〘〖"));

// Indices where a new line may begin: word starts, minus kinsoku violations.
export function breakOpportunities(text) {
  const chars = graphemes(text);
  const allowed = new Set();
  let offset = 0;
  const indexAt = new Map();
  chars.forEach((c, i) => {
    indexAt.set(offset, i);
    offset += c.length;
  });
  for (const seg of wordSegmenter.segment(text)) {
    const i = indexAt.get(seg.index);
    if (i > 0) allowed.add(i);
  }
  for (const i of [...allowed]) {
    if (NO_START.has(chars[i]) || NO_END.has(chars[i - 1]) || chars[i] === "\n" || chars[i - 1] === "\n")
      allowed.delete(i);
  }
  return allowed;
}
