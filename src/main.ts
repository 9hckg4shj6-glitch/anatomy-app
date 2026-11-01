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
import { review, todayCounts } from "./ui/review";
import { rootIndex, rootLesson } from "./ui/roots";
import { settingsScreen } from "./ui/settings-screen";
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

// 3Dの動かし方（3Dの右上の「?」）
const gestureHelp = h("dialog", { class: "key-help", "aria-label": "3Dの動かし方" },
  h("h2", {}, "3Dの動かし方"),
  h("dl", {},
    ...([
      ["回す", "1本指でドラッグ（マウスは左ドラッグ）"], ["拡大・縮小", "2本指でつまむ（マウスはホイール）。指の所へ寄る"],
      ["ずらす", "2本指でドラッグ（マウスは右ドラッグ）"], ["名前を見る", "部位をタップ（図鑑。PC は重ねるだけでも）"],
      ["視点を戻す", "自分で動かしたあと右上に出る。アプリが決めた向きへ戻る"], ["⤢", "説明をたたんで3Dを大きく（もう一度押すと戻る）"],
      ["境目", "3Dと説明の境目をドラッグで大きさを変える（ダブルクリックで元に戻す）"],
    ] as const).map(([key, text]) => h("div", {}, h("dt", {}, key), h("dd", {}, text))),
  ),
  h("form", { method: "dialog" }, h("button", { class: "primary" }, "閉じる")),
);
document.body.append(gestureHelp);
stage.append(h("button", { class: "stage-help", type: "button", "aria-label": "3Dの動かし方", title: "3Dの動かし方", onClick: () => gestureHelp.showModal() }, "?"));
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
    panel.replaceChildren(
      h("h2", {}, "3D表示を始められませんでした"),
      h("p", {}, "このアプリは3D（WebGL）を使います。次を試してください。"),
      h("ul", {},
        h("li", {}, "ほかのアプリやタブを閉じてから、読み直す"),
        h("li", {}, "ブラウザを新しくする（Safari・Chrome・Edge の新しい版）"),
        h("li", {}, "ブラウザの設定で「ハードウェアアクセラレーション」をオンにする（PC）"),
      ),
      h("button", { class: "primary", type: "button", onClick: () => location.reload() }, "読み直す"),
      h("p", { class: "muted" }, String(error)),
    );
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
  /** 同じ画面の中の移動（図鑑で語を選んだあと「戻る」など）を、画面を作り直さずに受ける */
  let stayHandler: ((arg: string) => boolean) | null = null;
  let currentName = "";
  /** "#/exam/a/list" → ["exam", "a/list"]（2段目からは arg にまとめる） */
  const parseHash = (): [string, string] => {
    const [, name = "", ...rest] = location.hash.split("/");
    return [name, decodeURIComponent(rest.join("/"))];
  };

  const route = async () => {
    if (updated && isHome()) {
      location.reload();
      return;
    }
    controller.abort("navigate");
    controller = new AbortController();
    currentHash = location.hash;
    leaveWarning = null;
    stayHandler = null;
    const ctx: AppContext = {
      viewer, index, panel, tools, signal: controller.signal,
      hint: (text) => {
        hintBox.textContent = text;
        hintBox.hidden = !text;
      },
      guard: (message) => (leaveWarning = message),
      stay: (handler) => (stayHandler = handler),
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

    const [name, arg] = parseHash();
    currentName = name;
    for (const tab of document.querySelectorAll<HTMLAnchorElement>("[data-tab]")) {
      const on = tab.dataset.tab === (name || "home") || (["learn", "roots", "drill", "exam"].includes(name) && tab.dataset.tab === "home");
      tab.classList.toggle("on", on);
      if (on) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    try {
      if (name === "learn") await lesson(ctx, arg);
      else if (name === "review") await review(ctx);
      else if (name === "explore") await explore(ctx, arg);
      // "#/roots/<レッスンID>" は語根のレッスン、"#/roots/root/<語根のキー>" は一覧でその語根を開く
      else if (name === "roots") await (arg && !arg.startsWith("root/") ? rootLesson(ctx, arg) : rootIndex(ctx, arg.slice("root/".length)));
      else if (name === "drill") await drill(ctx, arg);
      else if (name === "exam") await exam(ctx, arg);
      else if (name === "progress") await progress(ctx);
      else if (name === "settings") await settingsScreen(ctx);
      else if (name === "credits") credits(ctx);
      else if (name === "admin") await admin(ctx, arg);
      else await home(ctx);
    } catch (error) {
      if (ctx.signal.aborted) return; // 途中で別の画面へ移った
      console.error(error);
      panel.replaceChildren(h("p", {}, "エラーが起きました。"), h("p", { class: "muted" }, String(error)), h("a", { href: "#/" }, "ホームへ"));
    }
  };

  const refreshBadge = async () => {
    const { review: due, fresh } = await todayCounts();
    const count = due + fresh;
    badge.textContent = String(count);
    badge.hidden = count === 0;
    badge.title = `復習 ${due}問・新しい問題 ${fresh}問`;
    badge.setAttribute("aria-label", `今日の問題 ${count}問（${badge.title}）`);
  };

  window.addEventListener("hashchange", () => {
    // やめないときは、アドレスだけ元に戻して今の画面を続ける（replaceState では hashchange は起きない）
    const [name, arg] = parseHash();
    if (name === currentName && stayHandler?.(arg)) {
      currentHash = location.hash;
      return;
    }
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
