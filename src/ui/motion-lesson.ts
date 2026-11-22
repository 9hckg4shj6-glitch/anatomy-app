import { h } from "../dom";
import { LESSONS, stepLesson, type MotionId } from "../motion-lessons";
import type { MotionCaption } from "./motion-caption";

/**
 * 動きの図鑑の学ぶ流れの欄（docs/動きの図鑑.md「学ぶ目当てと1つずつ」）。
 * - goalsBox: この動きで学ぶこと（欄の頭）
 * - LessonSteps: 学ぶ流れ（区分の一覧。今の区分を目立たせ、押すとそこへ）と、今の区分の「ここを見る」「なぜ」。3Dの札も光らせる
 * - pointsBox: 覚えること（欄の終わり、確かめるの前）
 * 内容は src/motion-lessons.ts
 */

export function goalsBox(id: MotionId): HTMLElement {
  return h("section", { class: "motion-goals", "aria-label": "この動きで学ぶこと" },
    h("h3", {}, "この動きで学ぶこと"),
    h("ol", {}, ...LESSONS[id].goals.map((goal) => h("li", {}, goal))));
}

export function pointsBox(id: MotionId): HTMLElement[] {
  return [
    h("h3", { class: "list-title" }, "覚えること"),
    h("ul", { class: "motion-points" }, ...LESSONS[id].points.map((point) => h("li", {}, point))),
  ];
}

export interface StepItem {
  key: string;
  title: string;
}

/** 札（文字 → 札の要素）のうち、focus の文字の札を光らせる */
export function focusTags(tags: Iterable<[{ text: string }, HTMLElement]>, focus: string[] | undefined): void {
  for (const [tag, element] of tags) element.classList.toggle("focus", !!focus?.includes(tag.text));
}

export class LessonSteps {
  /** 今の区分の「ここを見る」「なぜ」（今の時期の欄の中に置く） */
  readonly detail = h("div", { class: "motion-lesson" });
  /** 学ぶ流れ（区分の一覧） */
  readonly list = h("ol", { class: "motion-steps motion-flow" });
  private items: StepItem[] = [];
  private current = -1;
  private readonly look = h("p", { class: "motion-look" });
  private readonly why = h("p", { class: "motion-why" });

  constructor(private readonly id: MotionId, caption: MotionCaption, private readonly go: (index: number) => void, items: StepItem[], private readonly tags?: Iterable<[{ text: string }, HTMLElement]>) {
    this.detail.append(this.look, this.why);
    this.setItems(items);
    caption.onStep((index) => this.show(index));
  }

  setItems(items: StepItem[]): void {
    this.items = items;
    this.list.replaceChildren(...items.map((item, i) => h("li", { "data-key": item.key },
      h("button", { type: "button", class: "motion-flow-item", onClick: () => this.go(i) }, item.title))));
    const index = this.current;
    this.current = -1;
    if (index >= 0 && index < items.length) this.show(index);
  }

  show(index: number): void {
    if (index === this.current || !this.items[index]) return;
    this.current = index;
    for (const [i, li] of [...this.list.children].entries()) {
      li.classList.toggle("on", i === index);
      li.classList.toggle("done", i < index);
    }
    const lesson = stepLesson(this.id, this.items[index].key);
    this.look.replaceChildren(...(lesson?.look ? [h("b", {}, "ここを見る"), lesson.look] : []));
    this.why.replaceChildren(...(lesson?.why ? [h("b", {}, "なぜ"), lesson.why] : []));
    if (this.tags) focusTags(this.tags, lesson?.focus);
  }
}
