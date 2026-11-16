import { h } from "../dom";
import { COURSES, courseOf, preferences, setCourse, type Preferences } from "../settings";
import { db } from "../db";
import type { AppContext } from "./context";
import { nextLesson } from "./lessons";

/**
 * はじめに（#/start）: 何のために使うかを1回だけ聞いてコースを決め、3語だけの短いレッスン（#/learn/<ID>/try）を通す。
 * はじめての人に、302レッスン・2,500語を並べて見せないため（docs/普段使い.md）。あとから設定でいつでも変えられる
 */
export async function start(ctx: AppContext): Promise<void> {
  ctx.fold(true);
  ctx.hint("");
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.viewer.spin(!matchMedia("(prefers-reduced-motion: reduce)").matches);
  const learned = await db.learned.count();
  let picked: Exclude<Preferences["course"], ""> = preferences.course || (learned ? courseOf() : "basic");

  const render = () => {
    const cards = COURSES.map((course) => {
      const on = course.id === picked;
      return h("button", {
        class: on ? "course-card on" : "course-card", type: "button", role: "radio", "aria-checked": String(on), "data-key": course.id,
        onClick: () => {
          picked = course.id;
          render();
          ctx.panel.querySelector<HTMLElement>(`[data-key="${course.id}"]`)?.focus({ preventScroll: true });
        },
      },
        h("span", { class: "course-radio", "aria-hidden": "true" }),
        h("span", { class: "course-text" }, h("span", { class: "course-title" }, course.title), h("span", { class: "course-sub" }, course.sub)),
      );
    });
    const go = h("button", { class: "primary", type: "button" }, "このコースで始める");
    go.addEventListener("click", async () => {
      await setCourse(picked);
      const first = nextLesson(await db.learned.toArray());
      // まだ何も学んでいなければ、最初のレッスンの3語だけを通す。学んだ人は今日へ
      location.hash = first && !learned ? `#/learn/${first.id}/try` : "#/";
    });
    ctx.panel.replaceChildren(h("div", { class: "start" },
      h("h2", { class: "start-title" }, "何のために使いますか？"),
      h("p", { class: "muted" }, "あとで「記録 › 設定」からいつでも変えられます。学んだ記録はコースを変えても続きます。"),
      h("div", { class: "course-list", role: "radiogroup", "aria-label": "コース" }, ...cards),
      learned ? "" : h("p", { class: "muted start-note" }, "次に、3語だけの短いレッスンを試します（約1分）。"),
      go,
    ));
  };
  render();
}
