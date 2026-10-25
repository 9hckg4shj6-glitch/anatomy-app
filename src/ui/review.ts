import { termById } from "../content";
import { db } from "../db";
import { State } from "../fsrs";
import { h } from "../dom";
import { buildQueue, facetsFor, type QueueItem } from "../study";
import type { AppContext } from "./context";
import { ask } from "./quiz";

/** 1日に新しく始める問い方の数（4つの問い方を別々に数える） */
const NEW_PER_DAY = 20;

async function todayQueue(now = new Date()): Promise<QueueItem[]> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const [learned, schedules, today] = await Promise.all([
    db.learned.toArray(),
    db.schedules.toArray(),
    db.reviewEvents.where("reviewedAt").aboveOrEqual(startOfDay.toISOString()).toArray(),
  ]);
  const newToday = today.filter((event) => event.isNew && event.source === "review").length;
  // 内容の更新で消えた語の記録は出さない
  const known = learned.filter((item) => termById.has(item.termId));
  const locateLearned = new Set(schedules.filter((s) => s.facet === "locate" && s.state === State.Review).map((s) => s.termId));
  return buildQueue(known, schedules, now, NEW_PER_DAY - newToday, (id) => facetsFor(termById.get(id), locateLearned.has(id)));
}

export async function dueCount(): Promise<number> {
  return (await todayQueue()).length;
}

export async function review(ctx: AppContext): Promise<void> {
  let answered = 0;
  let correct = 0;
  // 1問ごとに作り直す。間違えた問い方は10分後に再び期限が来るので、同じ回の中でもう一度出る。
  for (let queue = await todayQueue(); queue.length; queue = await todayQueue()) {
    const outcome = await ask(ctx, queue[0], "review", `残り ${queue.length}`);
    answered++;
    if (outcome === "correct") correct++;
  }
  ctx.viewer.setLabel(null);
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.hint("");
  const learned = await db.learned.count();
  ctx.panel.replaceChildren(
    h("h2", {}, answered ? "今日の復習おわり" : "今日の復習はありません"),
    answered ? h("p", { class: "today-count" }, `${correct} / ${answered} 正解`) : "",
    h("p", {}, learned ? "間違えた問題は10分後、正解した問題は日をあけて出ます。" : "まずホームからレッスンを始めましょう。"),
    h("div", { class: "nav-row" }, h("a", { class: "primary", href: "#/" }, "ホームへ")),
  );
}
