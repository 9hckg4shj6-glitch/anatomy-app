import { h } from "../dom";
import { PURPOSES, type PurposeInfo } from "../purposes";
import { preferences } from "../settings";
import type { AppContext } from "./context";
import { purposeChips } from "./settings-screen";
import { ICONS } from "./study-hub";
import { resetTabIntros } from "./tab-intro";

/** 4つのタブと、その中にあるもの（使い方のページの地図） */
const TABS: { name: string; href: string; icon: keyof typeof ICONS; lead: string; items: [label: string, href: string, text: string][] }[] = [
  {
    name: "今日", href: "#/", icon: "today", lead: "毎日ここから開く",
    items: [
      ["今日の復習", "#/review/now", "覚えた語のうち、忘れかけた語。押すとすぐ1問目"],
      ["次のレッスン", "#/study", "今日の復習が無い日は、次に学ぶレッスン"],
      ["回る人体", "#/", "系統のボタンで骨格・筋・臓器を切りかえ、部位をタップすると図鑑"],
    ],
  },
  {
    name: "学ぶ", href: "#/study", icon: "lessons", lead: "新しく覚える・解き直す",
    items: [
      ["レッスン", "#/lessons", "3Dで1語ずつ見て、確認テストに答える"],
      ["臓器の図", "#/organs", "臓器の立体を切る・平面図で名前を確かめる。細胞と組織・発生も"],
      ["演習", "#/drill", "範囲を選んで解き直す・苦手な語・★を付けた語"],
      ["骨学試験", "#/exam", "A〜D の形式と、整理して覚える（標準とすべての語）"],
      ["語根カード", "#/roots", "英語名を部品から読む（標準とすべての語）"],
    ],
  },
  {
    name: "調べる", href: "#/look", icon: "explore", lead: "1語をすぐ引く",
    items: [
      ["検索", "#/look", "日本語・読み・英語・ラテン語から"],
      ["図鑑", "#/explore", "3Dをタップして、名前と説明を見る"],
      ["★を付けた語", "#/look", "語のカードの ☆ で印を付けた語"],
    ],
  },
  {
    name: "記録", href: "#/records", icon: "progress", lead: "続けた日・覚え具合・設定",
    items: [
      ["進捗", "#/progress", "覚え具合を人体の色で見る・30日の記録・7日の予定"],
      ["設定", "#/settings", "コースと目的・1日の数・骨学試験の日・記録の書き出し"],
      ["使い方", "#/guide", "このページ"],
    ],
  },
];

/** ことばの意味 */
const WORDS: [term: string, text: string][] = [
  ["レッスン", "3Dで光った所と名前を1語ずつ見て、最後に確認テストに答えます。答えた語から復習に入ります。途中でやめても、答えた語は残ります。"],
  ["今日の復習", "覚えた語を、忘れかけたころにアプリが出します。正解が続くほど次に出るまでの日があき、まちがえると早めに出ます。毎日の分はアプリが決めます。"],
  ["演習", "範囲を自分で選んで解きます（試験の前の総ざらい・苦手な語）。答えは復習と同じく記録され、次に出る日にも反映されます。"],
  ["問い方", "位置→名前（光った所の名前を選ぶ）・名前→位置（3Dでその所をタップ）・日本語→英語の3つから始まります。英語→日本語・筋の起始と停止などは 設定 › 学ぶ問い方 で足せます。"],
  ["覚える量（コース）", "はじめての解剖（まず覚える語）・標準（必修と基礎）・すべての語（発展の語まで）。変えても学んだ記録は続きます。"],
  ["覚えること・くわしく", "語のカードは、まず「覚えること」の1〜2文。くわしい説明・漢字・語源は「くわしく」を開くと出ます。"],
  ["模式", "心臓の中・肺区域・腎臓の中などは、位置と並びを示す模式の立体です。実際の形とは違います。"],
];

/**
 * 使い方（#/guide。記録のタブ・上の帯の「?」・学ぶと今日の案内から）。docs/普段使い.md「はじめての人への案内」。
 * しくみ（レッスン → 今日の復習 → 演習、調べるはいつでも）・目的から選ぶ（選んだ目的を先に開いて）・4つのタブ・ことば・3Dの動かし方
 */
export function guide(ctx: AppContext): void {
  ctx.fold(true);
  ctx.hint("");
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  const purposeBox = h("div", { class: "guide-purposes" });
  const renderPurposes = () => {
    const chosen = PURPOSES.filter((purpose) => preferences.purposes.includes(purpose.id));
    const others = PURPOSES.filter((purpose) => !preferences.purposes.includes(purpose.id));
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

  ctx.panel.replaceChildren(h("div", { class: "home guide" },
    h("div", { class: "tab-head" }, h("h2", {}, "使い方")),
    h("p", { class: "guide-lead" }, "からだ見聞録は、3Dの人体を回して見ながら、解剖の名前と場所をいっしょに覚えるアプリです。"),

    h("h3", { class: "list-title" }, "しくみ"),
    h("section", { class: "home-card guide-flow" },
      flowStep("1", "レッスン", "新しい語を3Dで覚える", "#/study"),
      h("span", { class: "guide-arrow", "aria-hidden": "true" }),
      flowStep("2", "今日の復習", "忘れかけたころに出る", "#/"),
      h("span", { class: "guide-arrow", "aria-hidden": "true" }),
      flowStep("3", "演習", "試験の前に解き直す", "#/drill"),
      h("p", { class: "guide-flow-note" }, "毎日は「今日」を開いて、今日の復習（3〜5分）を解くだけ。わからない語は、いつでも「調べる」で引けます。"),
    ),

    h("h3", { class: "list-title" }, "目的から選ぶ"),
    purposeBox,

    h("h3", { class: "list-title" }, "4つのタブ"),
    h("div", { class: "guide-tabs" }, ...TABS.map(tabCard)),

    h("h3", { class: "list-title" }, "ことばの意味"),
    h("dl", { class: "home-card guide-words" }, ...WORDS.map(([term, text]) => h("div", {}, h("dt", {}, term), h("dd", {}, text)))),

    h("h3", { class: "list-title" }, "3Dとキーボード"),
    h("section", { class: "home-card guide-more" },
      h("p", {}, "3Dは1本指で回し、2本指でつまんで拡大、2本指でずらします。部位をタップすると名前が出ます。3Dの右上の ? にもまとめてあります。"),
      h("p", {}, "キーボードでは 1〜4 で選択肢、Enter で次へ、/ で検索、? でキーの一覧。"),
      h("div", { class: "nav-row" },
        h("button", { class: "ghost-button", type: "button", onClick: () => document.querySelector<HTMLButtonElement>(".stage-help")?.click() }, "3Dの動かし方"),
        reset),
    ),
  ));
}

function flowStep(n: string, title: string, sub: string, href: string): HTMLElement {
  return h("a", { class: "guide-step", href },
    h("span", { class: "guide-step-n", "aria-hidden": "true" }, n),
    h("b", {}, title), h("span", {}, sub));
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

function tabCard(tab: (typeof TABS)[number]): HTMLElement {
  const mark = h("span", { class: "home-item-icon", style: "--item:#1f6f78", "aria-hidden": "true" });
  mark.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[tab.icon]}</svg>`;
  return h("section", { class: "home-card guide-tab" },
    h("a", { class: "guide-tab-head", href: tab.href }, mark, h("span", {}, h("b", {}, tab.name), h("small", {}, tab.lead))),
    h("ul", {}, ...tab.items.map(([label, href, text]) => h("li", {}, h("a", { href }, label), h("span", {}, text)))),
  );
}

/**
 * 3語のレッスンのあとに1回だけ出す「あなたの使い方」。選んだ目的ごとに初めの2つの手順（目的を選んでいなければ授業の予習・復習）。
 * 全部は使い方のページで
 */
export function planCard(): HTMLElement {
  const chosen = PURPOSES.filter((purpose) => preferences.purposes.includes(purpose.id));
  const list = chosen.length ? chosen : PURPOSES.slice(0, 1);
  return h("section", { class: "plan" },
    h("h3", {}, "あなたの使い方"),
    ...list.map((purpose) => h("div", { class: "plan-purpose" },
      h("p", { class: "plan-title" }, purpose.title),
      stepList(purpose.steps.slice(0, 2)))),
    h("a", { class: "home-guide-link", href: "#/guide" }, "使い方をすべて見る（4つのタブ・ことばの意味）›"),
  );
}
