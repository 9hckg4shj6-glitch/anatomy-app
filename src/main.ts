import "./styles.css";
import { isPlateUnit, loadModelIndex, organOfLesson, systemById } from "./content";
import { courseLesson } from "./course";
import { loadPreferences } from "./settings";
import { canUseExam, loadProfile, profileOnLaunch } from "./profile";
import { initAccount, takeAuthReturn } from "./account";
import { h } from "./dom";
import { watchInstallPrompt } from "./install";
import { admin } from "./ui/admin";
import { credits } from "./ui/credits";
import { guide } from "./ui/guide";
import type { AppContext } from "./ui/context";
import { drill } from "./ui/drill";
import { exam } from "./ui/exam";
import { explore } from "./ui/explore";
import { home } from "./ui/home";
import { lesson } from "./ui/lesson";
import { lessons } from "./ui/lessons";
import { modelScreen } from "./ui/model";
import { look } from "./ui/look";
import { records } from "./ui/records";
import { start } from "./ui/start";
import { studyHub } from "./ui/study-hub";
import { loadMarks } from "./marks";
import { organScreen } from "./ui/organs";
import { progress } from "./ui/progress";
import { review } from "./ui/review";
import { rootIndex, rootLesson } from "./ui/roots";
import { settingsScreen } from "./ui/settings-screen";
import { setupSplitter } from "./ui/splitter";
import { stageTip } from "./ui/stage-tip";
import { AnatomyViewer } from "./viewer";

const stage = document.getElementById("stage")!;
const panel = document.getElementById("panel")!;
const hintBox = document.getElementById("stage-hint")!;
const tools = document.getElementById("stage-tools")!;
const crumbs = document.getElementById("crumbs")!;
const layout = document.querySelector<HTMLElement>(".layout")!;

/** ページの名前と、その一覧のアドレス（上の帯に「‹ 学ぶ ／ レッスン」と出す）。ここに無い名前は今日（ホーム） */
/** アプリの名前（暫定。2026-11-17 に「解剖学 3D単語帳」から変えた）。index.html・vite.config.ts の manifest もそろえる */
const APP_NAME = "からだ見聞録";

const PAGES: Record<string, [title: string, href: string]> = {
  study: ["学ぶ", "#/study"], look: ["調べる", "#/look"], model: ["3D模型", "#/model"], records: ["記録", "#/records"], settings: ["設定", "#/settings"], start: ["はじめに", "#/start"],
  lessons: ["レッスン", "#/lessons"], learn: ["レッスン", "#/lessons"], review: ["復習", "#/review"], drill: ["演習", "#/drill"],
  exam: ["骨学試験", "#/exam"], explore: ["図鑑", "#/explore"], organs: ["臓器の図", "#/organs"], roots: ["語根カード", "#/roots"],
  progress: ["進捗", "#/progress"], guide: ["使い方", "#/guide"], credits: ["出典・クレジット", "#/credits"], admin: ["ピン", "#/admin"],
};

/** 下のタブ（今日・学ぶ・調べる・3D模型・記録・設定）と、ページがどのタブの中にあるか。2026-11-20 に記録から設定を分け、3D模型を足した */
const TABS: Record<string, [label: string, href: string]> = {
  today: ["今日", "#/"], study: ["学ぶ", "#/study"], look: ["調べる", "#/look"], model: ["3D模型", "#/model"], records: ["記録", "#/records"], settings: ["設定", "#/settings"],
};
const TAB_OF: Record<string, string> = {
  study: "study", lessons: "study", learn: "study", drill: "study", exam: "study", roots: "study", organs: "study",
  look: "look", explore: "look",
  model: "model",
  records: "records", progress: "records",
  settings: "settings", guide: "settings", credits: "settings", admin: "settings",
};
/**
 * 使い方（#/guide）は、どのタブからも上の帯の「使い方」で開くので、開いたときのタブのまま（タブの印と「‹」の戻り先）。
 * アドレスから直に開いたときは設定（設定の下に「使い方」がある）
 */
let guideTab = "settings";
/** タブの一番上の画面（上の帯は名前だけ） */
const TAB_ROOTS = new Set(["", "study", "look", "model", "records", "settings", "start"]);
/** タブを隠す画面（解いている間・はじめに。上の帯の「‹」で戻る） */
const NO_TABS = new Set(["learn", "review", "start"]);

const brand = document.querySelector<HTMLAnchorElement>(".brand")!;
const brandBack = brand.querySelector<HTMLElement>(".brand-back")!;
const tabbar = document.getElementById("tabbar")!;

/**
 * 上の帯と下のタブ: タブの一番上の画面では名前だけ、ほかのページでは「‹ タブの名前」とページの名前
 * （一覧より奥にいれば、名前を押すと一覧へ戻る）。今いるタブに印を付ける
 */
function showCrumbs(name: string): void {
  const page = PAGES[name];
  const tab = name === "guide" ? guideTab : TAB_OF[name] ?? "today";
  // 調べるの「系統から探す」（#/look/<系統ID>）は、上の帯を「‹ 調べる」と系統の名前に
  const lookSystem = name === "look" ? systemById.get(location.hash.split("/")[2] ?? "") : undefined;
  const root = (TAB_ROOTS.has(name) && !lookSystem) || !page;
  document.body.classList.toggle("at-home", root);
  document.body.classList.toggle("no-tabs", NO_TABS.has(name));
  // はじめにの3語（#/learn/<ID>/try）は、上の帯を「‹ はじめに」と「3語を試す」にする（学ぶから来ていないので）。検索も出さない
  const trial = name === "learn" && location.hash.endsWith("/try");
  document.body.classList.toggle("is-trial", trial);
  if (trial) {
    brand.href = "#/start";
    brandBack.textContent = "はじめに";
    brand.setAttribute("aria-label", "はじめにへ");
    for (const link of tabbar.querySelectorAll<HTMLAnchorElement>(".tab")) link.removeAttribute("aria-current");
    crumbs.replaceChildren(h("span", { class: "crumb", "aria-current": "page" }, "3語を試す"));
    document.title = `3語を試す - ${APP_NAME}`;
    return;
  }
  for (const link of tabbar.querySelectorAll<HTMLAnchorElement>(".tab")) {
    if (link.dataset.tab === tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const [tabLabel, tabHref] = TABS[tab];
  brand.href = tabHref;
  brandBack.textContent = tabLabel;
  brand.setAttribute("aria-label", `${tabLabel}へ`);
  if (root) {
    crumbs.replaceChildren();
    document.title = page ? `${page[0]} - ${APP_NAME}` : APP_NAME;
    return;
  }
  if (lookSystem) {
    crumbs.replaceChildren(h("span", { class: "crumb", "aria-current": "page" }, lookSystem.ja));
    document.title = `${lookSystem.ja} - ${APP_NAME}`;
    return;
  }
  const [title, href] = plateLesson(name) ?? page;
  const atIndex = location.hash === href || location.hash === `${href}/`;
  crumbs.replaceChildren(atIndex
    ? h("span", { class: "crumb", "aria-current": "page" }, title)
    : h("a", { class: "crumb", href }, title));
  document.title = `${title} - ${APP_NAME}`;
}

/** 図のレッスン（#/learn/<ID>）なら、上の帯は「臓器の名前の図」へ戻る（図のレッスンは臓器の図で学ぶので） */
function plateLesson(name: string): [string, string] | undefined {
  if (name !== "learn") return undefined;
  const unit = courseLesson(location.hash.split("/")[2] ?? "");
  const organ = unit && isPlateUnit(unit) ? organOfLesson(unit) : undefined;
  return organ ? [`${organ.ja}の図`, `#/organs/${organ.id}`] : undefined;
}

// Google から戻ってきたときのアドレス（?code=…）を受け取り、ログインに出る前の画面に戻す（画面を作る前に。src/account.ts）
takeAuthReturn();
watchInstallPrompt();
const splitter = setupSplitter(document.querySelector<HTMLElement>(".layout")!, stage, panel);

// キーボードで答えたら（iPad のキーボードなど、マウスの無い端末でも）、選択肢に数字キーの番号を添える。
// ? でキーの一覧、/ で検索欄へ（レッスンの一覧と図鑑）
const keyHelp = h("dialog", { class: "key-help", "aria-label": "キーボードの操作" },
  h("h2", {}, "キーボードの操作"),
  h("dl", {},
    ...([
      ["1〜4", "選択肢を選ぶ"], ["0", "わからない"], ["Enter ・ →", "答えたあと次へ"], ["Backspace", "押しまちがえた（取り消して解き直す）"], ["H", "正解したけれど自信がなかった（早めにもう一度出す）"],
      ["← →", "レッスンで前・次の語"], ["Esc", "復習をここでやめる"], ["/", "検索欄へ（無ければ「調べる」へ）"], ["?", "この一覧"],
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
      ["向きの目印", "右上の小さな人。今どちら側から見ているか（「前から見ている」など）。オレンジの「右」は本人の右なので、前から見ると画面の左に来る（設定で消せる）"],
      ["境目", "3Dと説明の境目をドラッグで大きさを変える（ダブルクリックで元に戻す）"],
    ] as const).map(([key, text]) => h("div", {}, h("dt", {}, key), h("dd", {}, text))),
  ),
  h("p", {}, h("a", { href: "#/guide/3d", onClick: () => gestureHelp.close() }, "動く見本で見る（使い方）›")),
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
    event.preventDefault();
    if (search) search.focus();
    else location.hash = "#/look";
  }
});

// 新しい版が届いたら（Service Worker が入れかわったら）、見るだけの画面（ホーム・臓器の図・図鑑・レッスン一覧など）にいるときか、
// そこへ移るときに読み直して切りかえる。ホームだけにすると、臓器の図の中を行き来している間は古い版のまま（新しい平面図が出ない）だった。
// レッスン・復習・演習・骨学試験の途中では読み直さない（レッスンの進み具合は終わるまで保存しないため）。
let updated = false;
const RELOADABLE = new Set(["", "study", "look", "records", "organs", "explore", "lessons", "progress", "settings", "credits", "guide"]);
const canReload = () => RELOADABLE.has(location.hash.split("/")[1] ?? "");
const serviceWorker = navigator.serviceWorker as ServiceWorkerContainer | undefined; // http の LAN では無い
// 初めて開いたとき（前の版が無いとき）の入れかわりは数えない
if (serviceWorker?.controller) {
  serviceWorker.addEventListener("controllerchange", () => {
    updated = true;
    if (canReload()) location.reload();
  });
}
// ホーム画面のアプリは開き直しても読み込み直さないことが多いので、画面に戻ってきたときに新しい版を確かめる
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void serviceWorker?.getRegistration().then((registration) => registration?.update()).catch(() => {});
});

async function boot(): Promise<void> {
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
  const [index] = await Promise.all([loadModelIndex(), loadPreferences(), loadMarks(), loadProfile()]);
  // 名前と所属をまだ送れていなければ送り、その日にはじめて開いたことを管理者に残す（src/profile.ts。待たない）
  void profileOnLaunch();
  window.addEventListener("online", () => void profileOnLaunch());
  // 前に Google でログインしていれば、ログインを確かめて同期を始める（待たない。src/account.ts）
  void initAccount();
  // ピン打ちツールは ?admin=1 で開いたときだけホームに項目を出す（src/ui/home.ts）
  if (import.meta.env.DEV) Object.assign(window, { viewer }); // 開発時の確認用
  let controller = new AbortController();
  /** 今の画面のアドレスと、離れるときに確かめる文（レッスンの途中） */
  let currentHash = location.hash;
  let leaveWarning: string | null = null;
  /** 同じ画面の中の移動（図鑑で語を選んだあと「戻る」など）を、画面を作り直さずに受ける */
  let stayHandler: ((arg: string) => boolean) | null = null;
  let currentName = "";
  /** 1回でも画面を開いたか（使い方を直に開いたときと、今日から開いたときを分ける） */
  let routed = false;
  /** "#/exam/a/list" → ["exam", "a/list"]（2段目からは arg にまとめる） */
  const parseHash = (): [string, string] => {
    const [, name = "", ...rest] = location.hash.split("/");
    return [name, decodeURIComponent(rest.join("/"))];
  };

  const route = async () => {
    if (updated && canReload()) {
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
      fold: (on) => splitter.fold(on),
      guard: (message) => (leaveWarning = message),
      stay: (handler) => (stayHandler = handler),
    };
    // 3D模型で動かした部品を元の位置へ戻す（ほかの画面は組み立てた体で）
    void viewer.setModel(null);
    viewer.onPick = null;
    viewer.onHover = null;
    viewer.spin(false);
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
    // 骨学試験は一旦、名前に「シマエナガ」を含む人だけ（src/profile.ts の canUseExam）。ほかの人は学ぶへ
    if (name === "exam" && !canUseExam()) {
      history.replaceState(null, "", "#/study");
      await route();
      return;
    }
    // 使い方は、開いたときのタブのまま（同じ使い方の中で章を移るときは変えない。アドレスから直に開いたときは設定）
    if (name === "guide" && (currentName !== "guide" || !routed)) guideTab = routed ? TAB_OF[currentName] ?? "today" : "settings";
    routed = true;
    currentName = name;
    // 今日（ホーム）は3Dの人体を大きく、境目のつまみは出さない。回る人体が主役なので向きの目印も出さない。
    // はじめに（名前・所属など）も3Dは飾りなので、向きの目印と「3Dを大きく」は出さない
    layout.classList.toggle("is-home", !PAGES[name]);
    layout.classList.toggle("is-start", name === "start");
    layout.classList.toggle("is-model", name === "model");
    viewer.hideCompass(!PAGES[name] || name === "start");
    showCrumbs(name);
    // 3Dを動かして見る画面（レッスン・図鑑・臓器の図）を初めて開いたときに、右上の ⤢・?・向きの目印の説明を出す（src/ui/stage-tip.ts）
    if (name === "learn" || name === "explore" || name === "model" || (name === "organs" && arg)) void stageTip(stage, ctx.signal);
    window.scrollTo(0, 0);
    try {
      if (name === "learn") await lesson(ctx, arg);
      else if (name === "lessons") await lessons(ctx, arg);
      else if (name === "study") await studyHub(ctx);
      else if (name === "look") await look(ctx, arg);
      else if (name === "model") await modelScreen(ctx, arg);
      else if (name === "records") await records(ctx);
      else if (name === "start") await start(ctx, arg);
      else if (name === "review") await review(ctx, arg);
      else if (name === "explore") await explore(ctx, arg);
      // "#/roots/<レッスンID>" は語根のレッスン、"#/roots/root/<語根のキー>" は一覧でその語根を開く
      else if (name === "roots") await (arg && !arg.startsWith("root/") ? rootLesson(ctx, arg) : rootIndex(ctx, arg.slice("root/".length)));
      else if (name === "drill") await drill(ctx, arg);
      else if (name === "organs") await organScreen(ctx, arg);
      else if (name === "exam") await exam(ctx, arg);
      else if (name === "progress") await progress(ctx);
      else if (name === "settings") await settingsScreen(ctx, arg);
      else if (name === "guide") guide(ctx, arg);
      else if (name === "credits") credits(ctx);
      else if (name === "admin") await admin(ctx, arg);
      else await home(ctx);
    } catch (error) {
      if (ctx.signal.aborted) return; // 途中で別の画面へ移った
      console.error(error);
      panel.replaceChildren(h("p", {}, "エラーが起きました。"), h("p", { class: "muted" }, String(error)), h("a", { href: "#/" }, "ホームへ"));
    }
  };

  // ほかの端末の記録を受けたら、見るだけの画面（今日・学ぶ・記録・進捗）は描き直す（今日の復習の数など）。
  // はじめに・設定はそれぞれの画面で受ける。レッスンや復習の途中は描き直さない
  window.addEventListener("anatomy:synced", () => {
    if (["", "study", "records", "progress"].includes(currentName) && !leaveWarning) void route();
  });

  window.addEventListener("hashchange", () => {
    // やめないときは、アドレスだけ元に戻して今の画面を続ける（replaceState では hashchange は起きない）
    const [name, arg] = parseHash();
    if (name === currentName && stayHandler?.(arg)) {
      currentHash = location.hash;
      showCrumbs(name);
      return;
    }
    if (leaveWarning && !confirm(leaveWarning)) {
      history.replaceState(null, "", currentHash || "#/");
      return;
    }
    void route();
  });
  await route();
}

void boot();
