// Startup order: data -> screens subscribe -> first paint -> user fonts.
import { initStore, emit, ui } from "./store.js";
import { initUserFonts } from "./fonts.js";
import { initMenus, toast } from "./ui/common.js";
import { initTopbar } from "./ui/topbar.js";
import { initList } from "./ui/list.js";
import { initStage } from "./ui/stage.js";
import { initStylePanel } from "./ui/style-panel.js";
import { fontsChanged } from "./ui/fonts-ready.js";

initStore();
initMenus();
initTopbar();
initList();
initStage();
initStylePanel();
emit("all");

if (ui.oversize)
  toast(`${ui.oversize}枚のテロップが2000文字を超えています。文章はそのまま残しているので、「カーソル位置で分ける」で分けてください。`, true);
if (ui.storageError)
  toast("保存データを読み込めませんでした。上書きしないよう自動保存を止めています。JSONで保存してから再読み込みしてください。", true);

// Fonts added in an earlier session are restored after the first paint.
initUserFonts().then((ok) => {
  fontsChanged();
  emit("all");
  if (!ok) toast("追加フォントの保存場所を開けませんでした。追加フォントは今回だけ使えます。", true);
});
