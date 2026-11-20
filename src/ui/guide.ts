import { h } from "../dom";
import { canUseExam } from "../profile";
import { shownPurposes, type PurposeInfo } from "../purposes";
import { preferences } from "../settings";
import { termAt, type AppContext } from "./context";
import {
  askDemos, cardDemo, compassDemo, dayDemo, featureCards, gestureDemos, heroDemo, lessonDemo, memoryChart, outcomeTable,
  isGuideTab, tabsDemo, watchDemos, type GuideTab,
} from "./guide-demos";
import "./guide.css";
import { purposeChips } from "./settings-screen";
import { ICONS } from "./study-hub";
import { resetTabIntros } from "./tab-intro";

/** 5つのタブと、その中にあるもの（使い方のページの地図） */
const TABS: Record<GuideTab, { name: string; href: string; icon: keyof typeof ICONS; lead: string; items: [label: string, href: string, text: string][] }> = {
  today: {
    name: "今日", href: "#/", icon: "today", lead: "毎日ここから開く",
    items: [
      ["今日の復習", "#/review/now", "覚えた語のうち、忘れかけた語。押すとすぐ1問目"],
      ["次のレッスン", "#/study", "今日の復習が無い日は、次に学ぶレッスン"],
      ["回る人体", "#/", "系統のボタンで骨格・筋・臓器を切りかえ、部位をタップすると図鑑"],
    ],
  },
  study: {
    name: "学ぶ", href: "#/study", icon: "lessons", lead: "新しく覚える・解き直す",
    items: [
      ["レッスン", "#/lessons", "3Dで1語ずつ見て、確認テストに答える"],
      ["臓器の図", "#/organs", "臓器の立体を切る・平面図で名前を確かめる。細胞と組織・発生も"],
      ["演習", "#/drill", "範囲を選んで解き直す・苦手な語・★を付けた語"],
      ["骨学試験", "#/exam", "A〜D の形式と、整理して覚える（標準とすべての語）"],
      ["語根カード", "#/roots", "英語名を部品から読む（標準とすべての語）"],
    ],
  },
  look: {
    name: "調べる", href: "#/look", icon: "explore", lead: "1語をすぐ引く",
    items: [
      ["検索", "#/look", "日本語・読み・英語・ラテン語・ローマ字の読みから。覚えることも一緒に出る"],
      ["系統から探す", "#/look", "骨格系・筋系などの語を、レッスンごとに一覧で"],
      ["図鑑", "#/explore", "3Dをタップして、名前と説明を見る"],
      ["★を付けた語", "#/look", "語のカードの ☆ で印を付けた語"],
    ],
  },
  records: {
    name: "記録", href: "#/records", icon: "progress", lead: "続けた日・覚え具合",
    items: [
      ["今週・今日・学んだ語", "#/records", "続けた日の数・今日解いた数・コースのうち学んだ語の数"],
      ["進捗", "#/progress", "覚え具合を人体の色で見る・30日の記録・7日の予定"],
    ],
  },
  settings: {
    name: "設定", href: "#/settings", icon: "settings", lead: "アカウント・コース・表示",
    items: [
      ["アカウントと同期", "#/settings/account", "Google でログインして、スマホ・iPad・PC で同じ記録に"],
      ["コースと使う目的", "#/settings/course", "どこまでの語を覚えるか。1日の数・問い方・骨学試験の日・文字の大きさも"],
      ["記録の書き出し", "#/settings", "ログインしないときの機種変更・オフライン"],
      ["使い方・出典", "#/guide", "このページと、3Dモデル・図・音声のライセンス"],
    ],
  },
};

/** ことばの意味 */
const WORDS: [term: string, text: string][] = [
  ["レッスン", "3Dで光った所と名前を1語ずつ見て、最後に確認テストに答えます。答えた語から復習に入ります。途中でやめても、答えた語は残ります。"],
  ["今日の復習", "覚えた語を、忘れかけたころにアプリが出します。正解が続くほど次に出るまでの日があき、まちがえると早めに出ます。毎日の分はアプリが決めます。今日のレッスンで学んだ語は、明日から出ます。"],
  ["仕上げ", "今日のレッスンで学んだ語を、その日のうちにほかの問い方でもう一度解く問題です。やらなくてもかまいません（明日から今日の復習に出ます）。「今日」の画面とレッスンの終わりに出ます。"],
  ["演習", "範囲を自分で選んで解きます（試験の前の総ざらい・苦手な語）。答えは復習と同じく記録され、次に出る日にも反映されます。"],
  ["問い方", "位置→名前（光った所の名前を選ぶ）・名前→位置（3Dでその所をタップして選び、もう一度タップで答える）・日本語→英語の3つから始まります。英語→日本語・筋の起始と停止などは 設定 › 学ぶ問い方 で足せます。"],
  ["コース", "どこまでの語を覚えるか。はじめての解剖（まず覚える語）・標準（必修と基礎）・すべての語（発展の語まで）。変えても学んだ記録は続きます。"],
  ["覚えること・くわしく", "語のカードは、まず「覚えること」の1〜2文。くわしい説明・漢字・語源は「くわしく」を開くと出ます。"],
  ["模式", "心臓の中・肺区域・腎臓の中などは、位置と並びを示す模式の立体です。実際の形とは違います。"],
  ["同期", "Google でログインした端末どうしで、覚え具合・解いた記録・★とメモ・設定を同じにすること。学んでいる間は少しずつ、アプリを開いたときと閉じたときにも自動で行います。ログインしなければ、記録はその端末の中だけです。"],
];

/** 困ったとき */
const FAQ: [question: string, answer: string, link?: [href: string, label: string]][] = [
  ["復習がたまってしまった", "期限の来た復習は全部出ますが、1回の区切り（初めは20問）ごとにやめられます。復習を始めるときに範囲・問い方も絞れます。新しいレッスンを数日休むと、たまった分は減っていきます。", ["#/review", "復習の始めの画面"]],
  ["当てずっぽうで正解した・押しまちがえた", "正解の画面の「自信がなかった（早めにもう一度出す）」で、次に出る日を早められます。押しまちがえたときは「押しまちがえた（取り消して解き直す）」を。"],
  ["新しい語が多すぎる・少なすぎる", "設定 の「1日に新しく始める問題」で変えられます。1つの語に、学ぶ問い方の数だけ問題があります（初めは3つ）。", ["#/settings", "設定"]],
  ["コースを変えたい", "設定 の「コースと使う目的」で、いつでも変えられます。学んだ記録はそのまま続きます。", ["#/settings/course", "設定"]],
  ["機種を変える・別の端末で続けたい", "設定の「アカウントと同期」で Google でログインすると、同じアカウントでログインした端末（スマホ・iPad・PC）どうしで記録が自動で同じになります。iOS の Safari とホーム画面のアプリは別の端末として、それぞれでログインします。ログインしないときは、「記録の書き出し・読み込み」でファイルに書き出し、新しい端末で読み込んでください。", ["#/settings/account", "アカウントと同期"]],
  ["通信の無い所で使いたい", "ホーム画面に追加してから、設定の「オフライン」で「すべて保存」を押すと、通信の無い実習室でも使えます。", ["#/settings", "設定"]],
  ["3Dで迷った・見えなくなった", "自分で回したり拡大したりすると、3Dの右上に「視点を戻す」が出ます。押すとアプリが決めた向きへ戻ります。"],
  ["文字が小さい・英語も見たい", "設定の「表示」で、説明の文字の大きさと、説明に英語を併記するかを選べます。語のカードの「英語を併記」でも切りかえられます。", ["#/settings", "設定"]],
  ["3Dが出ない", "ほかのアプリやタブを閉じてから読み直してください。ブラウザを新しくする、PC ならブラウザの設定で「ハードウェアアクセラレーション」をオンにするのも効きます。"],
];

/** 章（目次と、#/guide/<id> で開く所） */
const CHAPTERS: [id: string, title: string, sub: string][] = [
  ["day", "毎日の使い方", "1日3〜5分"],
  ["lesson", "レッスンの流れ", "新しい語を覚える"],
  ["ask", "問い方と答え方", "4択とタップ"],
  ["memory", "復習のしくみ", "忘れる前に出る"],
  ["3d", "3Dの動かし方", "回す・拡大・タップ"],
  ["tabs", "5つのタブ", "どこに何があるか"],
  ["card", "語のカード", "どこを読めばいいか"],
  ["more", "そのほかの学び方", "臓器の図・演習など"],
  ["purpose", "目的別の使い方", "授業・骨学・調べる・見直し"],
  ["faq", "困ったとき", "よくある質問"],
  ["words", "ことばの意味", "このアプリの用語"],
];

/** 章ごとの3D（PC・iPad の横では説明の横に見える。スマホではたたんであり、「3Dを出す」で見える） */
type Scene = "spin" | "femur" | "free";
const SCENE_OF: Record<string, Scene> = { lesson: "femur", ask: "femur", card: "femur", "3d": "free" };

/**
 * 使い方（#/guide。入口は上の帯の「? 使い方」と設定のタブの下。3Dの「?」は3Dの動かし方の一覧から 05 へ。各タブの1行の説明は 06 をそのタブで）。
 * docs/普段使い.md「使い方ガイド」「画面の分かりにくさの見直し」。タブの印と「‹」は、開いたときのタブのまま（src/main.ts）。
 * 目次 → 毎日の使い方（動く見本）→ レッスン（段ごとの見本）→ 問い方 → 復習のしくみ（図）→ 3Dの動かし方 → 5つのタブ →
 * 語のカード → そのほかの学び方 → 目的別 → 困ったとき → ことば → キーボード。
 * "#/guide/<章>" でその章を開く（目次から押したときは画面を作り直さずにずらすだけ）
 */
export function guide(ctx: AppContext, arg = ""): void {
  const { viewer, signal } = ctx;
  ctx.fold(true);
  ctx.hint("");
  void viewer.show({ systems: ["skeletal"], body: true }).then(() => {
    if (!signal.aborted) setScene("spin", true);
  });

  let scene: Scene | null = null;
  // スマホの縦では3Dごとたたんであるので、回し続けない（見えない3Dを描き続けると電池を使う。「3Dで試してみる」で出したときは回さない場面）
  const layout = document.querySelector<HTMLElement>(".layout");
  const stageHidden = () => !!layout?.classList.contains("stage-folded") && getComputedStyle(layout).flexDirection !== "row";
  const setScene = (next: Scene, force = false) => {
    if (next === scene && !force) return;
    scene = next;
    viewer.spin(next === "spin" && !stageHidden());
    if (next === "femur") {
      viewer.highlight(["femur"], { isolate: true });
      viewer.focus("femur", 1.6);
      viewer.setLabel("femur", "大腿骨");
      ctx.hint("レッスンでは、光った所の名前を1語ずつ覚えます");
    } else {
      viewer.setLabel(null);
      viewer.highlight([]);
      viewer.overview();
      const touch = window.matchMedia?.("(pointer: coarse)").matches ?? true;
      ctx.hint(next === "free" ? (touch ? "1本指で回す・2本指でつまんで拡大。部位をタップ" : "ドラッグで回す・ホイールで拡大。部位をクリック") : "");
    }
  };
  // 3Dを試すときは、部位をタップすると光らせて名前を出す（図鑑へは移らない。PC は重ねるだけで名前）
  viewer.onPick = (elementId, point) => {
    if (scene !== "free") return;
    const term = termAt(ctx, elementId, point);
    viewer.highlight(term ? [term.id] : []);
    viewer.setLabel(term?.id ?? null, term?.ja ?? "");
  };
  viewer.onHover = (elementId, point) => termAt(ctx, elementId, point)?.ja ?? null;

  const purposeBox = h("div", { class: "guide-purposes" });
  const renderPurposes = () => {
    const chosen = shownPurposes().filter((purpose) => preferences.purposes.includes(purpose.id));
    const others = shownPurposes().filter((purpose) => !preferences.purposes.includes(purpose.id));
    purposeBox.replaceChildren(
      h("p", { class: "setting-label" }, "あなたの目的（押すと足し外し）"),
      purposeChips(renderPurposes),
      ...[...chosen, ...others].map((purpose) => purposeSection(purpose, chosen.includes(purpose))),
    );
  };
  renderPurposes();

  const reset = h("button", {
    class: "ghost-button", type: "button",
    onClick: async () => {
      await resetTabIntros();
      reset.textContent = "各タブの一番上に、もう一度説明を出します";
      reset.setAttribute("disabled", "");
    },
  }, "タブの説明をもう一度出す");

  const tryIt = h("button", {
    class: "primary", type: "button",
    onClick: () => {
      setScene("free", true);
      ctx.fold(false);
      // スマホでは3Dが上に出るので、そこまで戻る
      if (window.matchMedia("(max-width: 899px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
    },
  }, "3Dで試してみる");

  // "#/guide/tabs/<タブ>" は、5つのタブの章をそのタブにして開く（各タブの1行の説明から）
  const tabOf = (value: string) => {
    const [chapterId, tab = ""] = value.split("/");
    return chapterId === "tabs" && isGuideTab(tab) ? tab : undefined;
  };
  const tabs = tabsDemo(signal, (tab) => tabCard(TABS[tab]), tabOf(arg));

  const page = h("div", { class: "home guide" },
    h("div", { class: "tab-head" }, h("h2", {}, "使い方")),
    h("p", { class: "guide-lead" }, "からだ見聞録は、3Dの人体を回して見ながら、解剖の名前と場所をいっしょに覚えるアプリです。"),
    heroDemo(),

    h("nav", { class: "home-card guide-toc", "aria-label": "目次" },
      h("p", { class: "guide-toc-title" }, "目次"),
      h("ol", {}, ...CHAPTERS.map(([id, title, sub]) => h("li", {}, h("a", { href: `#/guide/${id}` }, h("b", {}, title), h("span", {}, canUseExam() ? sub : sub.replace("・骨学", "")))))),
    ),

    chapter("day", "毎日の使い方", "毎日は「今日」を開いて、今日の復習を解くだけ。1日3〜5分で続きます。",
      dayDemo(),
      h("p", { class: "guide-note" }, "今日の復習が無い日は、「今日」に次のレッスンが出ます。わからない語は、いつでも「調べる」で引けます。"),
    ),

    chapter("lesson", "レッスンの流れ", "新しい語は、学ぶ › レッスン で覚えます。1つのレッスンは5〜10語、5分ほど。",
      lessonDemo(signal),
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/lessons" }, "レッスンの一覧 ›")),
    ),

    chapter("ask", "問い方と答え方", "確認テストと復習は、初めは次の3つの問い方で出ます。",
      askDemos(),
      h("h4", { class: "guide-sub" }, "答えたあと"),
      outcomeTable(),
      h("p", { class: "guide-note" }, "英語→日本語・筋の起始と停止・支配神経・作用・孔を通るもの・向き・ホルモンも、設定 › 学ぶ問い方 で足せます。筋の問い方などは、場所を覚えたころに出ます。"),
    ),

    chapter("memory", "復習のしくみ", "人は覚えたことを少しずつ忘れます。このアプリは、思い出せる見込みが90%に下がるころに復習を出し、思い出すたびに次までの日を長くします。",
      memoryChart(),
      h("ul", { class: "guide-points" },
        h("li", {}, h("b", {}, "毎日の分はアプリが決める。"), "期限の来た語だけが「今日の復習」に出ます。"),
        h("li", {}, h("b", {}, "正解が続くほど、出るのはまれに。"), "よく覚えた語に時間を使わず、忘れかけた語に時間を使えます。"),
        h("li", {}, h("b", {}, "問い方ごとに別々に。"), "大腿骨の 位置→名前 は覚えていても、英語は忘れかけ、ということもあるからです。"),
      ),
    ),

    chapter("3d", "3Dの動かし方", "3Dは指（マウス）で自由に動かせます。",
      gestureDemos(),
      compassDemo(),
      h("div", { class: "nav-row" },
        tryIt,
        h("button", { class: "ghost-button", type: "button", onClick: () => document.querySelector<HTMLButtonElement>(".stage-help")?.click() }, "操作の一覧")),
      h("p", { class: "guide-note" }, "⤢ を押すと説明をたたんで3Dを大きく。3Dと説明の境目は、ドラッグで大きさを変えられます。"),
    ),

    chapter("tabs", "5つのタブ", "画面の下（iPad・PC は左）の5つのタブで行き来します。レッスンや復習を解いている間はタブが隠れ、上の「‹」で戻ります。",
      tabs,
    ),

    chapter("card", "語のカード", "レッスン・図鑑・答えたあとに出るカードです。まずは「覚えること」だけ読めば十分です。",
      cardDemo(),
    ),

    chapter("more", "そのほかの学び方", "レッスンと今日の復習のほかに、目的に合わせて使える学び方です。押すとその画面へ。",
      featureCards(),
    ),

    chapter("purpose", "目的別の使い方", "選んだ目的は、ここと「あなたの使い方」の並びに使います。どの目的でも、全部の学び方を使えます。",
      purposeBox,
    ),

    chapter("faq", "困ったとき", "",
      h("div", { class: "guide-faq" }, ...FAQ.map(([question, answer, link]) => h("details", { class: "home-card guide-q" },
        h("summary", {}, question),
        h("p", {}, answer, link ? h("a", { class: "guide-go", href: link[0] }, ` ${link[1]} ›`) : ""),
      ))),
    ),

    chapter("words", "ことばの意味", "",
      h("dl", { class: "home-card guide-words" }, ...WORDS.map(([term, text]) => h("div", {}, h("dt", {}, term), h("dd", {}, text)))),
    ),

    h("section", { class: "guide-chapter", id: "guide-keys", "data-chapter": "keys" },
      h("h3", { class: "list-title" }, "キーボード"),
      h("section", { class: "home-card guide-more" },
        h("dl", { class: "guide-keys" }, ...([
          ["1〜4", "選択肢を選ぶ"], ["0", "わからない"], ["Enter ・ →", "答えたあと次へ"], ["H", "自信がなかった"],
          ["Backspace", "押しまちがえた"], ["← →", "レッスンで前・次の語"], ["Esc", "復習をここでやめる"], ["/", "検索"], ["?", "キーの一覧"],
        ] as const).map(([key, text]) => h("div", {}, h("dt", {}, h("kbd", {}, key)), h("dd", {}, text)))),
        h("div", { class: "nav-row" }, reset),
      ),
    ),
  );
  ctx.panel.replaceChildren(page);
  watchDemos(page, signal);

  // 章が画面のまん中に来たら、その章の3Dにする（スマホではたたんであるので、3Dを出したときに見える）
  const watcher = new IntersectionObserver((entries) => {
    const entry = entries.filter((item) => item.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!entry) return;
    const id = (entry.target as HTMLElement).dataset.chapter ?? "";
    setScene(SCENE_OF[id] ?? "spin");
  }, { rootMargin: "-45% 0px -45% 0px" });
  for (const section of page.querySelectorAll(".guide-chapter")) watcher.observe(section);
  signal.addEventListener("abort", () => watcher.disconnect(), { once: true });

  // 目次から押したときは作り直さずにその章へ
  const jump = (value: string, smooth: boolean) => {
    const id = value.split("/")[0];
    const tab = tabOf(value);
    if (tab) tabs.select(tab);
    const target = id ? page.querySelector(`#guide-${CSS.escape(id)}`) : null;
    target?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  };
  ctx.stay((next) => {
    jump(next, true);
    return true;
  });
  if (arg) requestAnimationFrame(() => jump(arg, false));
}

/** 章（題・一言・中身）。目次から "#/guide/<id>" で開く */
function chapter(id: string, title: string, lead: string, ...body: (HTMLElement | string)[]): HTMLElement {
  const n = CHAPTERS.findIndex(([chapterId]) => chapterId === id) + 1;
  return h("section", { class: "guide-chapter", id: `guide-${id}`, "data-chapter": id },
    h("h3", { class: "guide-h" }, h("span", { class: "guide-h-n", "aria-hidden": "true" }, String(n).padStart(2, "0")), title),
    lead ? h("p", { class: "guide-chapter-lead" }, lead) : "",
    ...body,
  );
}

/** 目的ごとの使い方（選んだ目的は開いておく） */
function purposeSection(purpose: PurposeInfo, mine: boolean): HTMLElement {
  return h("details", { class: mine ? "home-card guide-purpose mine" : "home-card guide-purpose", open: mine },
    h("summary", {},
      h("span", { class: "guide-purpose-title" }, purpose.title, mine ? h("span", { class: "course-badge" }, "あなたの目的") : ""),
      h("span", { class: "guide-purpose-sub" }, purpose.sub)),
    stepList(purpose.steps),
  );
}

/** 番号つきの手順（押すとその画面へ行くリンクつき）。使い方と「あなたの使い方」で使う */
export function stepList(steps: PurposeInfo["steps"]): HTMLElement {
  return h("ol", { class: "guide-steps" }, ...steps.map((step) => h("li", {},
    h("span", {}, step.text),
    step.link ? h("a", { class: "guide-go", href: step.link.href }, `${step.link.label} ›`) : "",
  )));
}

function tabCard(tab: (typeof TABS)[GuideTab]): HTMLElement {
  const mark = h("span", { class: "home-item-icon", style: "--item:#1f6f78", "aria-hidden": "true" });
  mark.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[tab.icon]}</svg>`;
  return h("section", { class: "home-card guide-tab" },
    h("a", { class: "guide-tab-head", href: tab.href }, mark, h("span", {}, h("b", {}, tab.name), h("small", {}, tab.lead))),
    // 骨学試験は一旦、名前に「シマエナガ」を含む人だけ（src/profile.ts）
    h("ul", {}, ...tab.items.filter(([, href]) => canUseExam() || href !== "#/exam").map(([label, href, text]) => h("li", {}, h("a", { href }, label), h("span", {}, canUseExam() ? text : text.replace("・骨学試験の日", ""))))),
  );
}

/**
 * 3語のレッスンのあとに1回だけ出す「あなたの使い方」。選んだ目的ごとに初めの2つの手順（目的を選んでいなければ授業の予習・復習）。
 * 全部は使い方のページで
 */
export function planCard(): HTMLElement {
  const chosen = shownPurposes().filter((purpose) => preferences.purposes.includes(purpose.id));
  const list = chosen.length ? chosen : shownPurposes().slice(0, 1);
  return h("section", { class: "plan" },
    h("h3", {}, "あなたの使い方"),
    ...list.map((purpose) => h("div", { class: "plan-purpose" },
      h("p", { class: "plan-title" }, purpose.title),
      stepList(purpose.steps.slice(0, 2)))),
    h("a", { class: "home-guide-link", href: "#/guide" }, "使い方をすべて見る（動く見本つき）›"),
  );
}
