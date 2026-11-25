import { h } from "../dom";
import { canUseExam } from "../profile";
import { shownPurposes, type PurposeInfo } from "../purposes";
import { preferences } from "../settings";
import { termAt, type AppContext } from "./context";
import {
  askDemos, cardDemo, compassDemo, dayDemo, drillDemo, featureCards, gestureDemos, heroDemo, lessonDemo, lookDemo, memoryChart, modelDemo,
  motionDemo, organDemo, outcomeTable, isGuideTab, tabsDemo, watchDemos, type GuideTab,
} from "./guide-demos";
import "./guide.css";
import { installGuide } from "./install-guide";
import { isStandalone } from "../install";
import { stepList } from "./plan-card";
import { purposeChips } from "./settings-screen";
import { ICONS } from "./study-hub";
import { resetTabIntros } from "./tab-intro";

/** 6つのタブと、その中にあるもの（使い方のページの地図） */
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
      ["演習", "#/drill", "最近のレッスン・苦手な語をすぐ解く。範囲→問い方→数の3段階で選んで解き直す"],
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
      ["動きの図鑑", "#/motions", "呼吸・心臓の拍動・刺激伝導系・肺循環と体循環を、模型を動かして1時期ずつ"],
      ["★を付けた語", "#/look", "語のカードの ☆ で印を付けた語"],
    ],
  },
  model: {
    name: "3D模型", href: "#/model", icon: "model", lead: "見る・自由に操作の2つ",
    items: [
      ["見る", "#/model/look", "系統を選んで回し、部位をタップすると、その場に図鑑の説明が出る。寄って見る・図鑑で開く"],
      ["自由に操作（上級）", "#/model/free", "部品をタップで選び、隠す・薄くする・これだけ見る・外へ出す。まとまりを大きく・細かく"],
      ["部品を動かす", "#/model/free", "3Dはふだん回すだけ。選んだ部品の「ドラッグで動かす」を押したときだけ、その部品を動かせる。「元に戻す」で1つずつ戻せる"],
      ["系統と濃さ・分解・断面", "#/model/free", "系統ごとに透かす・部品を外へ離す・水平断などで切る・片側だけ見る"],
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
  ["演習", "学んだ範囲を解き直します。最近のレッスン・苦手な語はすぐ始められ、自分で選ぶときは ①範囲 → ②問い方（名前と場所 → ＋英語 → 総仕上げの段階）→ ③数と出し方 の順に選びます。答えは復習と同じく記録され、次に出る日にも反映されます。"],
  ["問い方", "位置→名前（光った所の名前を選ぶ）・名前→位置（3Dでその所をタップして選び、もう一度タップで答える）・日本語→英語の3つから始まります。英語→日本語・筋の起始と停止などは 設定 › 学ぶ問い方 で足せます。"],
  ["コース", "どこまでの語を覚えるか。はじめての解剖（まず覚える語）・標準（必修と基礎）・すべての語（発展の語まで）。変えても学んだ記録は続きます。"],
  ["覚えること・くわしく", "語のカードは、まず「覚えること」の1〜2文。くわしい説明・漢字・語源は「くわしく」を開くと出ます。"],
  ["模式", "心臓の中・肺区域・腎臓の中などは、位置と並びを示す模式の立体です。実際の形とは違います。"],
  ["平面図", "臓器の図の、教科書のような図。名前の出し方を 日本語と英語・日本語・英語・隠して確かめる から選べます（隠して確かめるは、番号を押すと名前が出る）。"],
  ["3D模型の見る・自由に操作", "3D模型のタブの2つの使い方。見るは、部位をタップするとその場に図鑑の説明が出ます。自由に操作（上級）は、部品を隠す・外へ出す・透かす・切って見る。タブは前に選んだほうで開きます。"],
  ["動きの図鑑", "呼吸・心臓の拍動と心周期・刺激伝導系と心電図・肺循環と体循環を、模型を動かして学ぶ所。調べる › 3Dで調べる と、臓器の図の「動きで見る」から開きます。"],
  ["1つずつ（解説つき）", "動きの図鑑の見せ方。時期ごとに止まり、▶ で次の時期までゆっくり見せます（短い時期も4秒以上かけて）。「続けて見る」は止まらずに流します。"],
  ["わかりやすい模型・実際の形", "動きの図鑑の見せ方。わかりやすい模型は教科書の模式図を立体にしたもの、実際の形は人の体の形（3D）をそのまま動かしたものです。"],
  ["同期", "Google でログインした端末どうしで、覚え具合・解いた記録・★とメモ・設定を同じにすること。学んでいる間は少しずつ、アプリを開いたときと閉じたときにも自動で行います。ログインしなければ、記録はその端末の中だけです。"],
];

/** 困ったとき */
const FAQ: [question: string, answer: string, link?: [href: string, label: string]][] = [
  ["復習がたまってしまった", "期限の来た復習は全部出ますが、1回の区切り（初めは20問）ごとにやめられます。復習を始めるときに範囲・問い方も絞れます。新しいレッスンを数日休むと、たまった分は減っていきます。", ["#/review", "復習の始めの画面"]],
  ["当てずっぽうで正解した・押しまちがえた", "正解の画面の「自信がなかった（早めにもう一度出す）」で、次に出る日を早められます。押しまちがえたときは「押しまちがえた（取り消して解き直す）」を。"],
  ["新しい語が多すぎる・少なすぎる", "設定 の「1日に新しく始める問題」で変えられます。1つの語に、学ぶ問い方の数だけ問題があります（初めは3つ）。", ["#/settings", "設定"]],
  ["コースを変えたい", "設定 の「コースと使う目的」で、いつでも変えられます。学んだ記録はそのまま続きます。", ["#/settings/course", "設定"]],
  ["機種を変える・別の端末で続けたい", "設定の「アカウントと同期」で Google でログインすると、同じアカウントでログインした端末（スマホ・iPad・PC）どうしで記録が自動で同じになります。iOS の Safari とホーム画面のアプリは別の端末として、それぞれでログインします。ログインしないときは、「記録の書き出し・読み込み」でファイルに書き出し、新しい端末で読み込んでください。", ["#/settings/account", "アカウントと同期"]],
  ["ホーム画面に追加したら、記録が最初からになった", "ブラウザとホーム画面のアプリでは、記録が別々に保存されます（消えてはいません）。ブラウザで Google でログインしてから、アプリでも同じアカウントでログインすると、記録が同じになります。ログインしないときは、ブラウザの設定で「記録の書き出し」をして、アプリの設定で読み込みます。", ["#/guide/install", "ホーム画面に追加"]],
  ["通信の無い所で使いたい", "ホーム画面に追加してから、設定の「オフライン」で「すべて保存」を押すと、通信の無い実習室でも使えます。", ["#/settings", "設定"]],
  ["演習で何を選べばいいかわからない", "迷ったら「すぐ始める」の「最近のレッスン」か「苦手な語」を。試験の前は「自分で選ぶ」で範囲を選び、問い方を「総仕上げ」にします。", ["#/guide/drill", "演習の使い方"]],
  ["見たい平面図がどの臓器にあるか分からない", "臓器の図の一覧の上の欄で、図の名前（四腔断・ネフロンなど）か、図に載っている部位の名前（膵管・左心室など）を打つと、その図が絵つきで並びます。「すべての図」では全部の平面図を臓器ごとに見られます。図鑑で語を選んだときの「この語が載っている図」からも開けます。", ["#/organs/all", "すべての図"]],
  ["平面図の名前を隠して覚えたい", "臓器の図の平面図で、名前の出し方を「隠して確かめる」にします。図の名前が番号になり、押すと名前が出ます。", ["#/guide/organs", "臓器の図の使い方"]],
  ["3D模型で部品を外したまま戻せない", "「↶ 元に戻す」で1つずつ、「組み立て直す」で隠した・動かした・分解・断面・片側をまとめて戻せます（系統の濃さはそのまま）。隠した部品は、一覧のチップを押すとそれだけ戻ります。", ["#/model/free", "3D模型"]],
  ["動きの図鑑が速い・どこを見ればいいかわからない", "見せ方を「1つずつ（解説つき）」にすると、時期ごとに止まり、「ここを見る」「なぜ」が出ます。見る所の札は黄色の縁で光ります。速さは ⅛ まで遅くできます。", ["#/guide/motions", "動きの図鑑の使い方"]],
  ["3Dで迷った・見えなくなった", "自分で回したり拡大したりすると、3Dの右上に「視点を戻す」が出ます。押すとアプリが決めた向きへ戻ります。"],
  ["文字が小さい・英語も見たい", "設定の「表示」で、説明の文字の大きさと、説明に英語を併記するかを選べます。語のカードの「英語を併記」でも切りかえられます。", ["#/settings", "設定"]],
  ["3Dが出ない", "ほかのアプリやタブを閉じてから読み直してください。ブラウザを新しくする、PC ならブラウザの設定で「ハードウェアアクセラレーション」をオンにするのも効きます。"],
];

/** 章（目次と、#/guide/<id> で開く所）。部ごとに分ける。番号は部をまたいで続く */
const PARTS: [title: string, chapters: [id: string, title: string, sub: string][]][] = [
  ["基本の使い方", [
    ["install", "ホーム画面に追加", "はじめに1回"],
    ["day", "毎日の使い方", "1日3〜5分"],
    ["lesson", "レッスンの流れ", "新しい語を覚える"],
    ["ask", "問い方と答え方", "4択とタップ"],
    ["memory", "復習のしくみ", "忘れる前に出る"],
    ["3d", "3Dの動かし方", "回す・拡大・タップ"],
    ["tabs", "6つのタブ", "どこに何があるか"],
    ["card", "語のカード", "どこを読めばいいか"],
  ]],
  ["学び方ごとのガイド", [
    ["more", "学び方の一覧", "どれを使うか"],
    ["drill", "演習", "すぐ始める・3段階で選ぶ"],
    ["look", "調べる", "1語をすぐ引く"],
    ["model", "3D模型", "見る・自由に操作"],
    ["organs", "臓器の図", "立体と平面図"],
    ["motions", "動きの図鑑", "1時期ずつ止めて見る"],
  ]],
  ["目的別・困ったとき", [
    ["purpose", "目的別の使い方", "授業・骨学・調べる・見直し"],
    ["faq", "困ったとき", "よくある質問"],
    ["words", "ことばの意味", "このアプリの用語"],
  ]],
];
const CHAPTERS = PARTS.flatMap(([, chapters]) => chapters);

/** 章ごとの3D（PC・iPad の横では説明の横に見える。スマホではたたんであり、「3Dを出す」で見える） */
type Scene = "spin" | "femur" | "free";
const SCENE_OF: Record<string, Scene> = { lesson: "femur", ask: "femur", card: "femur", "3d": "free", look: "femur", model: "free" };

/**
 * 使い方（#/guide。入口は上の帯の「? 使い方」と設定のタブの下。3Dの「?」は3Dの動かし方の一覧から 05 へ。各タブの1行の説明は 06 をそのタブで）。
 * docs/普段使い.md「使い方ガイド」「画面の分かりにくさの見直し」。タブの印と「‹」は、開いたときのタブのまま（src/main.ts）。
 * 目次 → 第1部 基本の使い方（ホーム画面に追加・毎日の使い方・レッスン・問い方・復習のしくみ・3Dの動かし方・6つのタブ・語のカード）→
 * 第2部 学び方ごとのガイド（学び方の一覧・演習・調べる・3D模型・臓器の図・動きの図鑑。段ごとの見本）→
 * 第3部 目的別・困ったとき（目的別・困ったとき・ことば）→ キーボード。
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
  // スマホの縦と iPad の縦では3Dごとたたんであるので、回し続けない（見えない3Dを描き続けると電池を使う。「3Dで試してみる」で出したときは回さない場面）
  const layout = document.querySelector<HTMLElement>(".layout");
  const stage = document.getElementById("stage");
  const stageHidden = () => !stage?.clientWidth || (!!layout?.classList.contains("stage-folded") && getComputedStyle(layout).flexDirection !== "row");
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

  // "#/guide/tabs/<タブ>" は、6つのタブの章をそのタブにして開く（各タブの1行の説明から）
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
      ...PARTS.flatMap(([part, chapters]) => [
        h("p", { class: "guide-toc-part" }, part),
        h("ol", {}, ...chapters.map(([id, title, sub]) => h("li", {}, h("a", { href: `#/guide/${id}` }, h("b", {}, title), h("span", {}, canUseExam() ? sub : sub.replace("・骨学", "")))))),
      ]),
    ),

    partHead(0),
    chapter("install", "ホーム画面に追加", isStandalone()
      ? "今はホーム画面のアイコンから開いています。ほかの端末で使うときも、はじめに1回、ホーム画面に追加してください。"
      : "からだ見聞録は App Store からではなく、ブラウザからホーム画面に追加して使うアプリです。はじめに1回だけ、次の手順で追加してください。",
      installGuide({ inGuide: true }),
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

    chapter("tabs", "6つのタブ", "画面の下（iPad・PC は左）の6つのタブで行き来します。レッスンや復習を解いている間はタブが隠れ、上の「‹」で戻ります。",
      tabs,
    ),

    chapter("card", "語のカード", "レッスン・図鑑・答えたあとに出るカードです。まずは「覚えること」だけ読めば十分です。",
      cardDemo(),
    ),

    partHead(1),
    chapter("more", "学び方の一覧", "レッスンと今日の復習のほかに、目的に合わせて使える学び方です。押すとその画面へ。くわしい使い方は、次の章から1つずつ。",
      featureCards(),
      h("ul", { class: "guide-points" },
        h("li", {}, h("b", {}, "覚える："), "レッスン → 今日の復習。試験の前は演習で解き直す。"),
        h("li", {}, h("b", {}, "引く："), "調べる・図鑑で1語。3D模型の「見る」で、回しながら部位をタップ。"),
        h("li", {}, h("b", {}, "つながりを見る："), "臓器の図で切り口と平面図、動きの図鑑で体の中の動き、3D模型の自由に操作で重なり。"),
      ),
    ),

    chapter("drill", "演習", "学んだ範囲を解き直す所です（学ぶ › 演習）。答えは今日の復習の記録にも入ります。",
      drillDemo(signal),
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/drill" }, "演習を開く ›")),
    ),

    chapter("look", "調べる", "授業や実習の合間に、1語をすぐ引く所です（下のタブの「調べる」、上の帯の虫めがね、PC は / キー）。",
      lookDemo(signal),
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/look" }, "調べるを開く ›")),
    ),

    chapter("model", "3D模型", "人体模型のように、3Dを手でいじって位置と重なりを見る所です（下のタブの「3D模型」）。使い方は「見る」と「自由に操作（上級）」の2つ。",
      modelDemo(signal),
      h("p", { class: "guide-note" }, "模型の状態（隠した・外へ出した部品など）は、アプリを開いている間はほかのタブへ行っても残ります。キーボードでは Delete で隠す・Esc で選ぶのをやめる・⌘Z（Ctrl+Z）で元に戻す。"),
      h("div", { class: "nav-row" },
        h("a", { class: "ghost-button", href: "#/model/look" }, "見るを開く ›"),
        h("a", { class: "ghost-button", href: "#/model/free" }, "自由に操作を開く ›")),
    ),

    chapter("organs", "臓器の図", "心臓・肺・腎臓・脳・関節など33の臓器を、立体（3D）と教科書のような平面図で見る所です（学ぶ › 臓器の図、調べる › 3Dで調べる）。",
      organDemo(signal),
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/organs" }, "臓器の図を開く ›")),
    ),

    chapter("motions", "動きの図鑑", "体の中の動きを、模型を動かして学ぶ所です。はじめに学ぶことを読み、1時期ずつ止めながら見て、最後に覚えることと確かめるで仕上げます。",
      motionDemo(signal),
      h("ul", { class: "guide-points" },
        h("li", {}, h("b", {}, "呼吸："), "横隔膜が下がり、肋骨が上がって胸郭が広がる。肺胞内圧・胸腔内圧のグラフと一緒に。"),
        h("li", {}, h("b", {}, "心臓の拍動と心周期："), "7つの時期と弁の開き閉じ。圧・容積・心電図のグラフ、心音（Ⅰ音・Ⅱ音）。"),
        h("li", {}, h("b", {}, "刺激伝導系と心電図："), "洞房結節からプルキンエ線維へ興奮が伝わる順と、心電図の波。"),
        h("li", {}, h("b", {}, "肺循環と体循環："), "1滴の血液を追い、どこで動脈血と静脈血が入れかわるかを見る。行き先（脳・腕・腸と肝臓・腎臓・脚）も選べる。"),
      ),
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/motions" }, "動きの図鑑を開く ›")),
    ),

    partHead(2),
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

/** 部の見出し（基本の使い方・学び方ごとのガイド・目的別と困ったとき） */
function partHead(i: number): HTMLElement {
  return h("p", { class: "guide-part" }, h("span", {}, `第${i + 1}部`), PARTS[i][0]);
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

function tabCard(tab: (typeof TABS)[GuideTab]): HTMLElement {
  const mark = h("span", { class: "home-item-icon", style: "--item:#1f6f78", "aria-hidden": "true" });
  mark.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[tab.icon]}</svg>`;
  return h("section", { class: "home-card guide-tab" },
    h("a", { class: "guide-tab-head", href: tab.href }, mark, h("span", {}, h("b", {}, tab.name), h("small", {}, tab.lead))),
    // 骨学試験は一旦、名前に「シマエナガ」を含む人だけ（src/profile.ts）
    h("ul", {}, ...tab.items.filter(([, href]) => canUseExam() || href !== "#/exam").map(([label, href, text]) => h("li", {}, h("a", { href }, label), h("span", {}, canUseExam() ? text : text.replace("・骨学試験の日", ""))))),
  );
}
