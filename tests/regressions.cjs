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
