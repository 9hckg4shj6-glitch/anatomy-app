import { h } from "../dom";
import { shownPurposes, type PurposeInfo } from "../purposes";
import { preferences } from "../settings";

// 使い方（src/ui/guide.ts）は開いたときに読む別のファイルなので、はじめに・レッスンでも使う所はここに置く

/** 番号つきの手順（押すとその画面へ行くリンクつき）。使い方と「あなたの使い方」で使う */
export function stepList(steps: PurposeInfo["steps"]): HTMLElement {
  return h("ol", { class: "guide-steps" }, ...steps.map((step) => h("li", {},
    h("span", {}, step.text),
    step.link ? h("a", { class: "guide-go", href: step.link.href }, `${step.link.label} ›`) : "",
  )));
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
