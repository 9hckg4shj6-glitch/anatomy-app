import { courseTerms, isBeginner } from "../course";
import { db } from "../db";
import { h } from "../dom";
import type { AppContext } from "./context";
import { backupReminder, examLeft, weekDays } from "./home";
import { currentSpecimen } from "./specimen";
import { itemRow } from "./study-hub";
import { tabIntro } from "./tab-intro";

/**
 * 記録（#/records）: 今週・今日・学んだ語の数、骨学試験の日、進捗。自分の学んだ記録を見るだけのタブ。
 * 設定・アカウントと同期・使い方・出典は設定のタブ（2026-11-20 に分けた。docs/普段使い.md「記録と設定を分ける」）。
 * 全部で何語・何レッスンといった大きな数はここにだけ出す（学ぶ・今日では出さない）
 */
export async function records(ctx: AppContext): Promise<void> {
  ctx.fold(true);
  ctx.hint("");
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since = new Date(startOfDay.getTime() - 7 * 86_400_000).toISOString();
  const [learned, events, schedules, intro] = await Promise.all([
    db.learned.toArray(), db.reviewEvents.where("reviewedAt").aboveOrEqual(since).toArray(), db.schedules.toArray(), tabIntro("records"),
  ]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  const course = courseTerms();
  const learnedInCourse = course.filter((term) => learnedIds.has(term.id)).length;
  const today = events.filter((event) => event.reviewedAt >= startOfDay.toISOString()).length;
  const stat = (label: string, value: string, unit: string) =>
    h("div", { class: "rec-stat" }, h("span", { class: "rec-label" }, label), h("span", { class: "rec-value" }, value, h("small", {}, ` ${unit}`)));
  const exam = isBeginner() ? null : examLeft(learnedIds, schedules);
  const specimen = currentSpecimen(learnedIds, schedules);
  const worn = specimen.placed.filter((item) => item.level === "faded").reduce((sum, item) => sum + item.count, 0);
  const specimenRate = specimen.reachable ? Math.round((specimen.bones / specimen.reachable) * 100) : 0;

  ctx.panel.replaceChildren(h("div", { class: "home" },
    h("div", { class: "tab-head" }, h("h2", {}, "記録")),
    intro,
    h("section", { class: "home-card rec-stats" },
      stat("今週", String(Math.min(weekDays(events), 7)), "/ 5日"),
      stat("今日", String(today), "問"),
      stat("学んだ語", learnedInCourse.toLocaleString(), `/ ${course.length.toLocaleString()}語`),
    ),
    exam ? h("a", { class: "home-card rec-exam", href: exam.href },
      h("span", { class: "home-kicker" }, "骨学試験"),
      h("b", {}, exam.days ? `試験まであと ${exam.days}日` : "試験は今日"),
      h("span", { class: "muted" }, exam.rest ? `まだの項目 ${exam.rest}・1日 ${exam.perDay}項目で間に合います` : "すべての項目を学びました。苦手な順に仕上げましょう")) : "",
    // わたしの標本（覚えた骨が並ぶ。src/ui/specimen.ts）
    h("a", { class: "home-card rec-specimen", href: "#/specimen" },
      h("span", { class: "home-kicker" }, "わたしの標本"),
      h("b", {}, specimen.bones ? `骨 ${specimen.bones} / ${specimen.reachable}本` : "まだ骨がありません"),
      h("div", { class: "home-meter", "aria-hidden": "true" }, h("span", { style: `width:${specimenRate}%` })),
      h("span", { class: "muted" }, worn ? `手入れが必要な骨 ${worn}本` : specimen.bones ? "覚えた骨が標本台に並んでいます" : "骨を覚えると、標本台に1本ずつ立っていきます")),
    backupReminder(learned),
    h("ul", { class: "home-card home-list" },
      itemRow("#/progress", "progress", "#4f6d8f", "進捗", "覚え具合を人体の色で見る・30日の記録・7日の予定"),
    ),
  ));
}
