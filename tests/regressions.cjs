// Browser regression tests for Telop Studio 2 (development only; the app itself needs no Node.js).
//   node tests/regressions.cjs
// Optional: TELOP_PLAYWRIGHT_PATH=/path/to/node_modules/playwright  TELOP_CHROME_PATH=/path/to/chrome
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.TELOP_PLAYWRIGHT_PATH || "playwright");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(ROOT, url === "/" ? "index.html" : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const assert = (ok, message) => {
  if (!ok) throw Error(message);
};

async function openApp(browser, base, init) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  // Web fonts are not needed for these checks; block the network so results are repeatable.
  await context.route("**/*", (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base);
  await page.waitForSelector("#rows .row-item");
  await page.waitForTimeout(400);
  return { context, page, errors };
}

const project = (page) => page.evaluate(() => import("./js/store.js").then((m) => JSON.parse(JSON.stringify(m.project()))));

async function selectText(page, start, end) {
  await page.locator("#editor").evaluate((el, [s, e]) => {
    el.focus();
    el.setSelectionRange(s, e);
    el.dispatchEvent(new Event("select"));
  }, [start, end]);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("1: 初期表示でサンプル5枚とプレビューが出る", async ({ page, errors }) => {
  assert((await page.locator("#rows .row-item").count()) === 5, "サンプルが5枚ではありません");
  assert(await page.locator("#caption").isVisible(), "プレビューが表示されていません");
  assert(errors.length === 0, errors.join("\n"));
});

test("2: 入力は一覧に反映され、再読み込み後も残る", async ({ page }) => {
  await page.locator("#editor").fill("保存されるテロップ");
  await page.waitForTimeout(600);
  assert((await page.locator(".row-item.active .excerpt").textContent()) === "保存されるテロップ", "一覧に反映されていません");
  await page.reload();
  await page.waitForSelector("#rows .row-item");
  assert((await page.locator("#editor").inputValue()) === "保存されるテロップ", "再読み込みで消えました");
});

test("3: 文字を選ぶと「選んだ文字」に切り替わり、装飾・元に戻す・やり直すが効く", async ({ page }) => {
  await page.locator("#editor").fill("ここが大事");
  await page.waitForTimeout(1200);
  await selectText(page, 2, 4);
  assert((await page.locator("[data-scope=chars]").getAttribute("aria-pressed")) === "true", "範囲が切り替わりません");
  await page.locator("[data-quick=red]").click();
  let p = await project(page);
  let r = p.rows.find((x) => x.id === p.selected);
  assert(r.marks[2]?.color === "#ff4d5e" && r.marks[3]?.color === "#ff4d5e" && !r.marks[1], "選んだ文字だけが赤になっていません");
  await page.locator("#undo").click();
  p = await project(page);
  r = p.rows.find((x) => x.id === p.selected);
  assert(!r.marks[2], "元に戻せません");
  await page.locator("#redo").click();
  p = await project(page);
  r = p.rows.find((x) => x.id === p.selected);
  assert(r.marks[2]?.color === "#ff4d5e", "やり直せません");
});

test("4: 自動折り返しは幅を守り、行頭に句読点を置かない", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { layout } = await import("./js/render.js");
    const { defaultSpeakers } = await import("./js/style.js");
    const speakers = defaultSpeakers();
    const row = { text: "世界遺産に登録された場所は、世界中に千か所以上あります。今日はその中から三つを紹介します。", speaker: "A", override: {}, marks: [] };
    const plan = layout(row, speakers);
    return {
      width: speakers.A.wrap.width,
      lines: plan.lines.map((l) => ({ w: l.width, first: l.glyphs[0]?.char })),
    };
  });
  assert(result.lines.length >= 2, "折り返されていません");
  for (const l of result.lines) {
    assert(l.w <= result.width + 0.5, `幅${Math.round(l.w)}pxが折り返し幅を超えています`);
    assert(!"、。！？」』）".includes(l.first), `行頭に「${l.first}」があります`);
  }
});

test("5: 最大行数を超える長文は自動で縮小される", async ({ page }) => {
  const plan = await page.evaluate(async () => {
    const { layout } = await import("./js/render.js");
    const { defaultSpeakers } = await import("./js/style.js");
    const text = "とても長いテロップの文章です。".repeat(8);
    const p = layout({ text, speaker: "A", override: {}, marks: [] }, defaultSpeakers());
    return { lines: p.lineCount, fit: p.fit };
  });
  assert(plan.fit < 1, "縮小されていません");
  assert(plan.lines <= 3 || plan.fit <= 0.56, `行数が${plan.lines}行のままです`);
});

test("6: 書き出しは1080×1920と切り抜きの両方を作れる", async ({ page }) => {
  const sizes = await page.evaluate(async () => {
    const { renderOutput } = await import("./js/render.js");
    const { project } = await import("./js/store.js");
    const p = project();
    const frame = renderOutput(p.rows[1], p.speakers, "frame");
    const crop = renderOutput(p.rows[1], p.speakers, "crop");
    return { frame: [frame.width, frame.height], crop: [crop.width, crop.height] };
  });
  assert(sizes.frame[0] === 1080 && sizes.frame[1] === 1920, "位置込みが1080×1920ではありません");
  assert(sizes.crop[0] < 1080 && sizes.crop[1] < 600, "切り抜きになっていません");
});

test("7: すべてZIPで5枚のPNGが入ったZIPができる", async ({ page }) => {
  await page.locator("#exportOpen").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#zipAll").click()]);
  const file = await download.path();
  const bytes = fs.readFileSync(file);
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert(end > 0, "ZIPの形式ではありません");
  assert(bytes.readUInt16LE(end + 10) === 5, `ZIPの中身が${bytes.readUInt16LE(end + 10)}件です`);
  const firstPng = bytes.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert(firstPng > 0 && bytes.readUInt32BE(firstPng + 16) === 1080 && bytes.readUInt32BE(firstPng + 20) === 1920, "PNGが1080×1920ではありません");
});

test("8: ドラッグで話者全体、またはこのテロップだけの位置が変わる", async ({ page }) => {
  const before = (await project(page)).speakers["!"].pos.y;
  const box = await page.locator("#caption").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  let p = await project(page);
  assert(p.speakers["!"].pos.y > before + 3, "話者全体の位置が変わっていません");
  await page.locator("[data-scope=row]").click();
  const box2 = await page.locator("#caption").boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2 - 60, { steps: 5 });
  await page.mouse.up();
  p = await project(page);
  const r = p.rows.find((x) => x.id === p.selected);
  assert(r.override.pos && r.override.pos.y < p.speakers["!"].pos.y, "このテロップだけの位置が保存されていません");
});

test("9: カーソル位置で分けて、次とつなげると元に戻る", async ({ page }) => {
  await page.locator("#rows .row-item").nth(1).locator("[data-open]").click();
  const original = await page.locator("#editor").inputValue();
  await page.locator("#editor").evaluate((el) => {
    el.focus();
    el.setSelectionRange(3, 3);
  });
  await page.locator("#splitRow").click();
  assert((await page.locator("#rows .row-item").count()) === 6, "分けられていません");
  await page.locator("#prevRow").click();
  await page.locator("#mergeRow").click();
  assert((await page.locator("#rows .row-item").count()) === 5, "つなげられていません");
  assert((await page.locator("#editor").inputValue()) === original, "つなげた文字が元と違います");
});

test("10: 「このテロップ」で変えた大きさは同じ話者の他のテロップに影響しない", async ({ page }) => {
  await page.locator("#rows .row-item").nth(1).locator("[data-open]").click();
  await page.locator("[data-scope=row]").click();
  await page.locator("#f-size").fill("130");
  await page.locator("#f-size").dispatchEvent("input");
  const p = await project(page);
  assert(p.rows[1].override.size === 130, "個別設定が保存されていません");
  assert(p.speakers.A.size !== 130, "話者全体まで変わっています");
});

test("11: 旧Telop StudioのJSONを読み込める（絵文字の装飾も保つ）", async ({ page }) => {
  await page.locator("#projectMenu summary").click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("[data-project=import]").click()]);
  await chooser.setFiles(path.join(__dirname, "fixtures", "telopstudio-v1.json"));
  await page.waitForTimeout(800);
  const p = await project(page);
  assert(p.rows.length === 5, `読み込んだテロップが${p.rows.length}枚です`);
  const r = p.rows[0];
  assert(r.text.startsWith("👨‍👩‍👧"), "文字が違います");
  assert(r.marks.length === Array.from(new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(r.text)).length, "装飾の数が文字数と合いません");
  assert(r.marks[0]?.color === "#ff545f" && !r.marks[1], "絵文字の装飾が保たれていません");
  assert((await page.locator("#projectSelect option").count()) === 2, "別プロジェクトとして追加されていません");
});

test("12: 300枚を超える追加は断り、何も変えない", async ({ page }) => {
  await page.locator("#scriptOpen").click();
  await page.locator("#scriptText").fill(Array.from({ length: 296 }, (_, i) => `A: ${i + 1}枚目`).join("\n\n"));
  await page.locator("#scriptAdd").click();
  assert((await page.locator("#rows .row-item").count()) === 5, "上限を超えて追加されました");
  assert((await page.locator("#toast").textContent()).includes("300枚"), "理由が表示されていません");
});

test("13: 台本欄でのCtrl+Zはプロジェクトを戻さない", async ({ page }) => {
  await page.locator("#editor").fill("消えないテロップ");
  await page.waitForTimeout(1200);
  await page.locator("#scriptOpen").click();
  await page.locator("#scriptText").fill("下書き");
  await page.locator("#scriptText").press("Control+z");
  await page.keyboard.press("Escape");
  assert((await page.locator("#editor").inputValue()) === "消えないテロップ", "台本欄のCtrl+Zでテロップが戻りました");
});

test("14: 300枚あっても1枚の編集で他のサムネイルは作り直さない", async ({ page }) => {
  await page.evaluate(async () => {
    const store = await import("./js/store.js");
    const { newRow } = await import("./js/text.js");
    store.change("大量追加", (p) => {
      p.rows = Array.from({ length: 300 }, (_, i) => newRow(`${i + 1}枚目のテロップ`, "A"));
      p.selected = p.rows[0].id;
    });
    store.emit("all");
  });
  await page.waitForFunction(() => document.querySelectorAll("#rows .thumb img").length === 300, null, { timeout: 60000 });
  await page.evaluate(() => document.querySelectorAll("#rows .thumb img").forEach((img) => (img.dataset.old = "1")));
  const started = Date.now();
  await page.locator("#editor").fill("1枚目だけ変更");
  await page.waitForFunction(() => !document.querySelector("#rows .row-item.active .thumb img")?.dataset.old, null, { timeout: 10000 });
  const kept = await page.evaluate(() => document.querySelectorAll("#rows .thumb img[data-old]").length);
  assert(kept === 299, `作り直さずに残ったサムネイルが${kept}枚です`);
  console.log(`  300枚中1枚の更新：${Date.now() - started}ms`);
});

test("15: 「選んだ文字」から「話者全体」に戻すと、そのまま話者全体になる", async ({ page }) => {
  await selectText(page, 1, 3);
  assert((await page.locator("[data-scope=chars]").getAttribute("aria-pressed")) === "true", "選んだ文字になっていません");
  await page.locator("[data-scope=speaker]").click();
  await page.waitForTimeout(300);
  assert((await page.locator("[data-scope=speaker]").getAttribute("aria-pressed")) === "true", "話者全体に戻りません");
  assert((await page.locator("#selectionLabel").textContent()) === "", "選択表示が残っています");
});

test("16: プレビューを拡大でき、拡大中もドラッグ位置が正しい", async ({ page }) => {
  const fit = await page.locator("#stage").evaluate((el) => el.clientHeight);
  await page.locator("#zoomIn").click();
  await page.locator("#zoomIn").click();
  const zoomed = await page.locator("#stage").evaluate((el) => el.clientHeight);
  assert(Math.abs(zoomed / fit - 2.25) < 0.05, `拡大率が${(zoomed / fit).toFixed(2)}倍です`);
  assert((await page.locator("#zoomFit").textContent()) === "225%", "倍率の表示が違います");
  const scrollable = await page.locator("#stageArea").evaluate((el) => el.scrollHeight > el.clientHeight);
  assert(scrollable, "拡大中にスクロールできません");
  // Moving by 1% of the frame height must still be 1% while zoomed.
  const before = (await project(page)).speakers["!"].pos.y;
  const box = await page.locator("#caption").boundingBox();
  const step = zoomed / 100;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + step * 5, { steps: 4 });
  await page.mouse.up();
  const after = (await project(page)).speakers["!"].pos.y;
  assert(Math.abs(after - before - 5) < 0.3, `ドラッグ量がずれています（${(after - before).toFixed(2)}%）`);
  await page.locator("#zoomFit").click();
  assert((await page.locator("#stage").evaluate((el) => el.clientHeight)) === fit, "全体表示に戻りません");
});

test("17: 実機プレビュー（Pixel 8 Pro）で、横幅合わせと画面埋めが正しく映る", async ({ page }) => {
  await page.locator("#devicePreset").selectOption("pixel8pro");
  const ratio = await page.locator("#device").evaluate((el) => el.clientWidth / el.clientHeight);
  assert(Math.abs(ratio - 1344 / 2992) < 0.01, `画面の縦横比が${ratio.toFixed(3)}です`);
  const fitWidth = await page.evaluate(() => [document.getElementById("stage").clientWidth, document.getElementById("device").clientWidth]);
  assert(Math.abs(fitWidth[0] - fitWidth[1]) <= 1, "横幅合わせで動画が画面幅と一致しません");
  await page.locator("#deviceFit").selectOption("fill");
  const fill = await page.evaluate(() => {
    const s = document.getElementById("stage"), d = document.getElementById("device");
    return { visible: d.clientWidth / s.clientWidth, sameHeight: Math.abs(s.clientHeight - d.clientHeight) <= 1 };
  });
  assert(fill.sameHeight, "画面埋めで動画の高さが画面と一致しません");
  assert(Math.abs(fill.visible - (1344 / 2992) / (9 / 16)) < 0.02, `見えている幅が${fill.visible.toFixed(3)}です`);
  // A caption reaching the frame edges must warn that the sides are cut off on this phone.
  await page.evaluate(async () => {
    const store = await import("./js/store.js");
    store.change("幅を広げる", (p) => {
      const r = p.rows.find((x) => x.id === p.selected);
      // About 980px wide: inside the 1080px frame, wider than the ~860px visible on this phone.
      r.text = "ショート動画テロップ";
      r.override = { size: 92, wrap: { on: false } };
    });
    store.emit("all");
  });
  await page.waitForFunction(() => document.getElementById("stageInfo").textContent.includes("左右が切れて"), null, { timeout: 5000 });
  await page.reload();
  await page.waitForSelector("#rows .row-item");
  assert((await page.locator("#devicePreset").inputValue()) === "pixel8pro" && (await page.locator("#deviceFit").inputValue()) === "fill", "機種の選択が保存されていません");
});

test("18: ガイド判定は見た目の文字で行い、全角記号の余白や影では警告しない", async ({ page }) => {
  // Place the caption so its painted right edge sits just inside / just outside the YouTube guide.
  const place = (gap) =>
    page.evaluate(async (gap) => {
      const store = await import("./js/store.js");
      const { layout } = await import("./js/render.js");
      const p = store.project(),
        r = p.rows.find((x) => x.id === p.selected);
      const plan = layout(r, p.speakers);
      const guideRight = 1080 * (1 - 0.15);
      const centerX = guideRight - gap - plan.ink.right + plan.blockWidth / 2;
      store.change("位置", (proj) => (proj.speakers[r.speaker].pos.x = (centerX / 1080) * 100));
      store.emit("all");
      return { sideBearing: plan.blockWidth - plan.ink.right };
    }, gap);
  await page.locator("#editor").fill("世界遺産クイズ！");
  await page.waitForTimeout(400);
  await place(6);
  await page.waitForTimeout(500);
  let info = await page.locator("#stageInfo").textContent();
  assert(!info.includes("ガイドの外"), `内側なのに警告が出ています：${info}`);
  await place(-12);
  await page.waitForTimeout(500);
  info = await page.locator("#stageInfo").textContent();
  assert(info.includes("ガイドの外"), "はみ出しているのに警告が出ません");
});

test("19: PCのフォントを一覧から選ぶと、追加されてすぐ使われる", async ({ page }) => {
  // The real list needs a permission prompt; stand in for it with fonts this machine has.
  await page.evaluate(() => {
    window.queryLocalFonts = async () =>
      ["Liberation Serif", "DejaVu Sans", "Liberation Sans", "DejaVu Sans"].map((family) => ({ family }));
  });
  await page.locator('[data-section="font"] details summary').first().click();
  await page.locator("[data-font-pick]").click();
  assert(await page.locator("#localFontDialog").isVisible(), "一覧が開きません");
  assert((await page.locator("#localFontList [data-local-font]").count()) === 3, "重複を除いた3書体が並んでいません");
  await page.locator("#localFontSearch").fill("dejavu");
  assert((await page.locator("#localFontList [data-local-font]").count()) === 1, "名前で絞り込めません");
  await page.locator('[data-local-font="DejaVu Sans"]').click();
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("DejaVu Sans"));
  const p = await project(page);
  const speaker = p.rows.find((r) => r.id === p.selected).speaker;
  assert(p.speakers[speaker].font === "DejaVu Sans", `選んだフォントが使われていません（${p.speakers[speaker].font} / ${await page.locator("#toast").textContent()}）`);
  assert(await page.locator('[data-local-font="DejaVu Sans"]').isDisabled(), "追加済みになっていません");
  await page.keyboard.press("Escape");
  assert((await page.locator('#styleForm [data-font="DejaVu Sans"]').count()) === 1, "フォント一覧に追加されていません");
});

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.TELOP_CHROME_PATH ? { executablePath: process.env.TELOP_CHROME_PATH } : {});
  const filter = process.env.TELOP_TEST_FILTER ? new RegExp(process.env.TELOP_TEST_FILTER) : null;
  let failed = 0;
  for (const t of tests) {
    if (filter && !filter.test(t.name)) continue;
    const app = await openApp(browser, base);
    try {
      await t.fn(app);
      console.log("PASS", t.name);
    } catch (e) {
      failed++;
      console.log("FAIL", t.name, "\n  ", e.message);
    } finally {
      await app.context.close();
    }
  }
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})();
