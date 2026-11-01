import { termById } from "../content";
import { db, type ReviewEvent } from "../db";
import { State } from "../fsrs";
import { h, onKeys, until } from "../dom";
import { examByKey, examFacetsOf, FIRST_FACETS, isExamKey } from "../exam";
import { isRootKey, rootByKey } from "../roots";
import { preferences, REVIEW_SIZE_OPTIONS, setPreference } from "../settings";
import { buildQueue, facetsFor, ROOT_FACETS, type QueueItem } from "../study";
import type { AppContext } from "./context";
import { nextLesson } from "./home";
import { ask, showPanel, type Outcome } from "./quiz";
import { askExam } from "./exam";
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
  // 内容の更新で消えた語の記録は出さない。語根カード（"root:…"）と骨学試験（"exam:…"）も一緒に出す
  const known = learned.filter((item) => termById.has(item.termId) || rootByKey.has(item.termId) || examByKey.has(item.termId));
  const locateLearned = new Set(schedules.filter((s) => s.facet === "locate" && s.state === State.Review).map((s) => s.termId));
  // 骨学試験 D の「図に書き込む」は番号→名前が、数と並びの「3Dで押す」は並べる・選ぶが、復習の段階に入ってから
  const firstLearned = new Set(schedules.filter((s) => FIRST_FACETS.includes(s.facet) && s.state === State.Review).map((s) => s.termId));
  const facetsOf = (id: string) => {
    if (isRootKey(id)) return ROOT_FACETS;
    if (isExamKey(id)) return examFacetsOf(examByKey.get(id)!, firstLearned.has(id));
    return facetsFor(termById.get(id), locateLearned.has(id));
  };
  return buildQueue(known, schedules, now, preferences.newPerDay - newToday, facetsOf);
}

/** 語の問題か語根の問題か骨学試験の問題かで出し分ける */
export function askItem(ctx: AppContext, item: QueueItem, source: ReviewEvent["source"], progress: string): Promise<Outcome> {
  if (isRootKey(item.termId)) return askRoot(ctx, item, source, progress);
  if (isExamKey(item.termId)) return askExam(ctx, item, source, progress);
  return ask(ctx, item, source, progress);
}

export async function dueCount(): Promise<number> {
  return (await todayQueue()).length;
}

export async function review(ctx: AppContext): Promise<void> {
  let queue = await todayQueue();
  // 多いときは、1回に解く数（10問・20問・全部）を選ぶ。前に選んだものを覚えておく
  let limit = preferences.reviewSize;
  if (queue.length > REVIEW_SIZE_OPTIONS[0]) {
    ctx.viewer.overview();
    ctx.hint("");
    const sizes = REVIEW_SIZE_OPTIONS.filter((size) => size < queue.length);
    const chosen = sizes.includes(limit) ? limit : 0;
    const buttons = sizes.map((size) =>
      h("button", { class: size === chosen ? "primary" : "ghost-button", type: "button" }, size ? `${size}問` : `全部（${queue.length}問）`));
    showPanel(ctx,
      h("h2", {}, "今日の復習"),
      h("p", { class: "today-count" }, `${queue.length}問`),
      h("p", {}, "1回に解く数は？ あとで続きから解けます。"),
      h("div", { class: "nav-row review-size" }, ...buttons),
    );
    buttons[sizes.indexOf(chosen)].focus({ preventScroll: true });
    limit = await until<number>(ctx.signal, (resolve) => buttons.forEach((button, i) => button.addEventListener("click", () => resolve(sizes[i]), { once: true })));
    void setPreference("reviewSize", limit);
  }

  let answered = 0;
  let correct = 0;
  /** まちがえた語・語根（終わりの画面で、図鑑や語根の一覧へ） */
  const missed = new Set<string>();
  // 「ここでやめる」（と Esc）: 今の問題をやめて、そこまでのまとめを出す
  const session = new AbortController();
  ctx.signal.addEventListener("abort", () => session.abort(ctx.signal.reason), { once: true });
  const quit = h("button", { class: "chip", type: "button", onClick: () => session.abort("stop") }, "ここでやめる");
  ctx.tools.replaceChildren(quit);
  onKeys(session.signal, (key) => {
    if (key !== "Escape") return false;
    session.abort("stop");
    return true;
  });
  const inner = { ...ctx, signal: session.signal };
  // 1問ごとに作り直す。間違えた問い方は、新しい語なら1分後・覚えた語なら10分後に再び期限が来るので、同じ回の中でもう一度出る。
  try {
    for (; queue.length && (!limit || answered < limit); queue = await todayQueue()) {
      const total = limit ? Math.min(limit, answered + queue.length) : answered + queue.length;
      const outcome = await askItem(inner, queue[0], "review", `${answered + 1} / ${total}`);
      answered++;
      if (outcome === "correct") correct++;
      else missed.add(queue[0].termId);
    }
  } catch (error) {
    if (session.signal.reason !== "stop") throw error;
    queue = await todayQueue();
  }
  ctx.tools.replaceChildren();
  ctx.viewer.onPick = null;
  ctx.viewer.setLabel(null);
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.hint("");
  const learned = await db.learned.toArray();
  const next = nextLesson(learned);
  // 「続ける」: 今と同じアドレスなので、画面を作り直す
  const again = h("a", {
    class: "primary", href: "#/review", onClick: (event: Event) => {
      event.preventDefault();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    },
  }, `続ける（残り ${queue.length}問）`);
  ctx.panel.replaceChildren(
    h("h2", {}, queue.length ? "ここまでの復習" : answered ? "今日の復習おわり" : "今日の復習はありません"),
    answered ? h("p", { class: "today-count" }, `${correct} / ${answered} 正解`) : "",
    h("p", {}, learned.length ? "まちがえた問題は、新しい語なら1分後、覚えた語なら10分後にもう一度出ます。正解した問題は日をあけて出ます。" : "まずホームからレッスンを始めましょう。"),
    missed.size ? h("h3", {}, "まちがえた語（タップで図鑑）") : "",
    missed.size ? h("div", { class: "chip-list" }, ...[...missed].map((id) => {
      const root = rootByKey.get(id);
      const exam = examByKey.get(id);
      if (root) return h("a", { class: "chip", href: "#/roots", lang: "en" }, root.root);
      if (exam) return h("a", { class: "chip", href: "#/exam" }, exam.title);
      return h("a", { class: "chip", href: `#/explore/${id}` }, termById.get(id)?.ja ?? id);
    })) : "",
    h("div", { class: "nav-row" },
      ...(queue.length
        ? [h("a", { class: "ghost-button", href: "#/" }, "ホームへ"), again]
        : next && learned.length
          ? [h("a", { class: "ghost-button", href: "#/" }, "ホームへ"), h("a", { class: "primary", href: `#/learn/${next.id}` }, "次のレッスンへ")]
          : [h("a", { class: "primary", href: "#/" }, "ホームへ")]),
    ),
  );
}
