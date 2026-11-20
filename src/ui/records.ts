import { courseTerms, isBeginner } from "../course";
import { canUseExam } from "../profile";
import { account, accountAvailable } from "../account";
import { db } from "../db";
import { h } from "../dom";
import type { AppContext } from "./context";
import { backupReminder, examLeft, weekDays } from "./home";
import { itemRow } from "./study-hub";
import { tabIntro } from "./tab-intro";

/**
 * 記録（#/records）: 今週・今日・学んだ語の数、骨学試験の日、使い方・アカウントと同期・進捗・設定・出典。
 * 全部で何語・何レッスンといった大きな数はここにだけ出す（学ぶ・今日では出さない。docs/普段使い.md）
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
    backupReminder(learned),
    h("ul", { class: "home-card home-list" },
      itemRow("#/guide", "guide", "#1f6f78", "使い方", "目的に合わせた使い方・4つのタブ・ことばの意味"),
      accountAvailable() ? itemRow("#/settings/account", "sync", "#3d7a5a", "アカウントと同期", account.status === "signed-in"
        ? `${account.user?.email ?? ""} でログイン中`
        : account.status === "conflict" ? "この端末に別のアカウントの記録があります。確かめてください"
          : "Google でログインして、スマホ・iPad・PC で同じ記録に") : "",
      itemRow("#/progress", "progress", "#4f6d8f", "進捗", "覚え具合を人体の色で見る・30日の記録・7日の予定"),
      itemRow("#/settings", "settings", "#77736a", "設定", canUseExam() ? "コースと目的・1日の数・文字の大きさ・骨学試験の日・記録の書き出し" : "コースと目的・1日の数・文字の大きさ・記録の書き出し"),
      itemRow("#/credits", "credits", "#77736a", "出典・クレジット", "3Dモデル・図・音声のライセンス"),
      new URLSearchParams(location.search).has("admin") ? itemRow("#/admin", "settings", "#77736a", "ピン", "部位のピンを打つ（管理用）") : "",
    ),
  ));
}
