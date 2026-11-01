import "./styles.css";
import { loadModelIndex } from "./content";
import { loadPreferences } from "./settings";
import { h } from "./dom";
import { watchInstallPrompt } from "./install";
import { admin } from "./ui/admin";
import { credits } from "./ui/credits";
import type { AppContext } from "./ui/context";
import { drill } from "./ui/drill";
import { exam } from "./ui/exam";
import { explore } from "./ui/explore";
import { home } from "./ui/home";
import { lesson } from "./ui/lesson";
import { progress } from "./ui/progress";
import { dueCount, review } from "./ui/review";
import { rootIndex, rootLesson } from "./ui/roots";
import { setupSplitter } from "./ui/splitter";
import { AnatomyViewer } from "./viewer";

const stage = document.getElementById("stage")!;
const panel = document.getElementById("panel")!;
const hintBox = document.getElementById("stage-hint")!;
const tools = document.getElementById("stage-tools")!;
const badge = document.getElementById("due-badge")!;

watchInstallPrompt();
const splitter = setupSplitter(document.querySelector<HTMLElement>(".layout")!, stage, panel);

// キーボードで答えたら（iPad のキーボードなど、マウスの無い端末でも）、選択肢に数字キーの番号を添える。
// ? でキーの一覧、/ で検索欄へ（ホームと図鑑）
const keyHelp = h("dialog", { class: "key-help", "aria-label": "キーボードの操作" },
  h("h2", {}, "キーボードの操作"),
  h("dl", {},
    ...([
      ["1〜4", "選択肢を選ぶ"], ["0", "わからない"], ["Enter ・ →", "答えたあと次へ"], ["Backspace", "押しまちがえた（取り消して解き直す）"],
      ["← →", "レッスンで前・次の語"], ["Esc", "復習をここでやめる"], ["/", "検索欄へ（ホーム・図鑑）"], ["?", "この一覧"],
    ] as const).map(([key, text]) => h("div", {}, h("dt", {}, h("kbd", {}, key)), h("dd", {}, text))),
  ),
  h("form", { method: "dialog" }, h("button", { class: "primary" }, "閉じる")),
);
document.body.append(keyHelp);
document.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^[0-9]$|^Arrow|^Enter$/.test(event.key)) document.documentElement.classList.add("keys");
  if (event.key === "?") {
    event.preventDefault();
    if (keyHelp.open) keyHelp.close();
    else keyHelp.showModal();
  } else if (event.key === "/") {
    const search = document.querySelector<HTMLInputElement>("#panel .search");
    if (!search) return;
    event.preventDefault();
    search.focus();
  }
});

// 新しい版が届いたら（Service Worker が入れかわったら）、ホームにいるときに読み直して切りかえる。
// レッスンや復習の途中では読み直さない（レッスンの進み具合は終わるまで保存しないため）。
let updated = false;
const isHome = () => !location.hash.split("/")[1];
const serviceWorker = navigator.serviceWorker as ServiceWorkerContainer | undefined; // http の LAN では無い
// 初めて開いたとき（前の版が無いとき）の入れかわりは数えない
if (serviceWorker?.controller) {
  serviceWorker.addEventListener("controllerchange", () => {
    updated = true;
    if (isHome()) location.reload();
  });
}
// ホーム画面のアプリは開き直しても読み込み直さないことが多いので、画面に戻ってきたときに新しい版を確かめる
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void serviceWorker?.getRegistration().then((registration) => registration?.update()).catch(() => {});
});

async function start(): Promise<void> {
  let viewer: AnatomyViewer;
  try {
    viewer = new AnatomyViewer(stage);
    await viewer.ready;
  } catch (error) {
    panel.replaceChildren(h("p", {}, "3D表示を始められませんでした。"), h("p", { class: "muted" }, String(error)));
    return;
  }
  const [index] = await Promise.all([loadModelIndex(), loadPreferences()]);
  // ピン打ちツールは ?admin=1 で開いたときだけタブを出す
  if (new URLSearchParams(location.search).has("admin")) {
    document.querySelector(".tabs")?.append(h("a", { href: "#/admin", "data-tab": "admin" }, "ピン"));
  }
  if (import.meta.env.DEV) Object.assign(window, { viewer }); // 開発時の確認用
  let controller = new AbortController();
  /** 今の画面のアドレスと、離れるときに確かめる文（レッスンの途中） */
  let currentHash = location.hash;
  let leaveWarning: string | null = null;

  const route = async () => {
    if (updated && isHome()) {
      location.reload();
      return;
    }
    controller.abort("navigate");
    controller = new AbortController();
    currentHash = location.hash;
    leaveWarning = null;
    const ctx: AppContext = {
      viewer, index, panel, tools, signal: controller.signal,
      hint: (text) => {
        hintBox.textContent = text;
        hintBox.hidden = !text;
      },
      guard: (message) => (leaveWarning = message),
    };
    viewer.onPick = null;
    viewer.onHover = null;
    viewer.setPeel([], []);
    viewer.setDrawing(null);
    viewer.setSection(null);
    viewer.setLabel(null);
    viewer.colorTerms(null);
    viewer.highlight([]);
    tools.replaceChildren();
    // 3Dの読み込みを待つ画面（レッスンなど）でも、欄が空のままにならないように
    panel.replaceChildren(h("p", { class: "muted" }, "読み込み中…"));
    panel.scrollTop = 0;
    splitter.restore();

    const [, name = "", arg = ""] = location.hash.split("/");
    for (const tab of document.querySelectorAll<HTMLAnchorElement>("[data-tab]")) {
      tab.classList.toggle("on", tab.dataset.tab === (name || "home") || (["learn", "roots", "drill", "exam"].includes(name) && tab.dataset.tab === "home"));
    }
    try {
      if (name === "learn") await lesson(ctx, decodeURIComponent(arg));
      else if (name === "review") await review(ctx);
      else if (name === "explore") await explore(ctx, decodeURIComponent(arg));
      else if (name === "roots") await (arg ? rootLesson(ctx, decodeURIComponent(arg)) : rootIndex(ctx));
      else if (name === "drill") await drill(ctx, arg);
      else if (name === "exam") await exam(ctx, decodeURIComponent(arg));
      else if (name === "progress") await progress(ctx);
      else if (name === "credits") credits(ctx);
      else if (name === "admin") await admin(ctx, decodeURIComponent(arg));
      else await home(ctx);
    } catch (error) {
      if (ctx.signal.aborted) return; // 途中で別の画面へ移った
      console.error(error);
      panel.replaceChildren(h("p", {}, "エラーが起きました。"), h("p", { class: "muted" }, String(error)), h("a", { href: "#/" }, "ホームへ"));
    }
  };

  const refreshBadge = async () => {
    const count = await dueCount();
    badge.textContent = String(count);
    badge.hidden = count === 0;
  };

  window.addEventListener("hashchange", () => {
    // やめないときは、アドレスだけ元に戻して今の画面を続ける（replaceState では hashchange は起きない）
    if (leaveWarning && !confirm(leaveWarning)) {
      history.replaceState(null, "", currentHash || "#/");
      return;
    }
    void route();
  });
  window.addEventListener("anatomy:reviewed", () => void refreshBadge());
  await Promise.all([route(), refreshBadge()]);
}

void start();
