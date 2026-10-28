import { termById } from "../content";
import { db, type ReviewEvent } from "../db";
import { State } from "../fsrs";
import { h } from "../dom";
import { isRootKey, rootByKey } from "../roots";
import { preferences } from "../settings";
import { buildQueue, facetsFor, ROOT_FACETS, type QueueItem } from "../study";
import type { AppContext } from "./context";
import { nextLesson } from "./home";
import { ask, type Outcome } from "./quiz";
import { askRoot } from "./roots";

async function todayQueue(now = new Date()): Promise<QueueItem[]> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const [learned, schedules, today] = await Promise.all([
    db.learned.toArray(),
    db.schedules.toArray(),
    db.reviewEvents.where("reviewedAt").aboveOrEqual(startOfDay.toISOString()).toArray(),
  ]);
  const newToday = today.filter((event) => event.isNew && event.source === "review").length;
  // 内容の更新で消えた語の記録は出さない。語根カード（"root:…"）も一緒に出す
  const known = learned.filter((item) => termById.has(item.termId) || rootByKey.has(item.termId));
  const locateLearned = new Set(schedules.filter((s) => s.facet === "locate" && s.state === State.Review).map((s) => s.termId));
  return buildQueue(known, schedules, now, preferences.newPerDay - newToday, (id) => (isRootKey(id) ? ROOT_FACETS : facetsFor(termById.get(id), locateLearned.has(id))));
}

/** 語の問題か語根の問題かで出し分ける */
export function askItem(ctx: AppContext, item: QueueItem, source: ReviewEvent["source"], progress: string): Promise<Outcome> {
  return isRootKey(item.termId) ? askRoot(ctx, item, source, progress) : ask(ctx, item, source, progress);
}

export async function dueCount(): Promise<number> {
  return (await todayQueue()).length;
}

export async function review(ctx: AppContext): Promise<void> {
  let answered = 0;
  let correct = 0;
  /** まちがえた語・語根（終わりの画面で、図鑑や語根の一覧へ） */
  const missed = new Set<string>();
  // 1問ごとに作り直す。間違えた問い方は10分後に再び期限が来るので、同じ回の中でもう一度出る。
  for (let queue = await todayQueue(); queue.length; queue = await todayQueue()) {
    const outcome = await askItem(ctx, queue[0], "review", `残り ${queue.length}`);
    answered++;
    if (outcome === "correct") correct++;
    else missed.add(queue[0].termId);
  }
  ctx.viewer.setLabel(null);
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.hint("");
  const learned = await db.learned.toArray();
  const next = nextLesson(new Set(learned.map((item) => item.termId)));
  ctx.panel.replaceChildren(
    h("h2", {}, answered ? "今日の復習おわり" : "今日の復習はありません"),
    answered ? h("p", { class: "today-count" }, `${correct} / ${answered} 正解`) : "",
    h("p", {}, learned.length ? "間違えた問題は10分後、正解した問題は日をあけて出ます。" : "まずホームからレッスンを始めましょう。"),
    missed.size ? h("h3", {}, "まちがえた語（タップで図鑑）") : "",
    missed.size ? h("div", { class: "chip-list" }, ...[...missed].map((id) => {
      const root = rootByKey.get(id);
      return root
        ? h("a", { class: "chip", href: "#/roots", lang: "en" }, root.root)
        : h("a", { class: "chip", href: `#/explore/${id}` }, termById.get(id)?.ja ?? id);
    })) : "",
    h("div", { class: "nav-row" },
      ...(next && learned.length
        ? [h("a", { class: "ghost-button", href: "#/" }, "ホームへ"), h("a", { class: "primary", href: `#/learn/${next.id}` }, "次のレッスンへ")]
        : [h("a", { class: "primary", href: "#/" }, "ホームへ")]),
    ),
  );
}
