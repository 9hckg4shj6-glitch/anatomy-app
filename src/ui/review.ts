import { systems, termById } from "../content";
import { db, type ReviewEvent } from "../db";
import { dueLabel, State } from "../fsrs";
import { h, onKeys, until } from "../dom";
import { examByKey, examFacetsOf, FIRST_FACETS, isExamKey } from "../exam";
import { isRootKey, rootByKey } from "../roots";
import { preferences, REVIEW_SIZE_OPTIONS, setPreference } from "../settings";
import { buildQueue, facetLabels, facetsFor, ROOT_FACETS, TERM_KINDS, unlockedTerms, type QueueItem } from "../study";
import type { AppContext } from "./context";
import { nextLesson } from "./lessons";
import { ask, showPanel, type Outcome } from "./quiz";
import { askExam, itemHref } from "./exam";
import { askRoot } from "./roots";

/** まちがえて覚え直している途中の問題を、期限の何分前から出すか（復習の回の終わりに、待たずにもう一度解く） */
const AHEAD_MS = 20 * 60_000;

/**
 * 今日の出題（期限の来た復習と、1日の上限までの新しい問題）。keep で範囲・問い方を絞る（新しい問題の上限は絞る前に数える）。
 * 設定の「学ぶ問い方」で外した語の問い方は、新しく始めず、期限が来ていても出さない。
 */
async function todayQueue(now = new Date(), keep: (item: QueueItem) => boolean = () => true, aheadUntil?: Date): Promise<QueueItem[]> {
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
  const study = preferences.studyFacets;
  const unlocked = unlockedTerms(schedules, study);
  // 骨学試験 D の「図に書き込む」は番号→名前が、数と並びの「3Dで押す」は並べる・選ぶが、復習の段階に入ってから
  const firstLearned = new Set(schedules.filter((s) => FIRST_FACETS.includes(s.facet) && s.state === State.Review).map((s) => s.termId));
  const facetsOf = (id: string) => {
    if (isRootKey(id)) return ROOT_FACETS;
    if (isExamKey(id)) return examFacetsOf(examByKey.get(id)!, firstLearned.has(id));
    return facetsFor(termById.get(id), unlocked.has(id), study);
  };
  return buildQueue(known, schedules, now, preferences.newPerDay - newToday, facetsOf, aheadUntil)
    .filter((item) => (isRootKey(item.termId) || isExamKey(item.termId) || study.includes(item.facet)) && keep(item));
}

/** 語の問題か語根の問題か骨学試験の問題かで出し分ける */
export function askItem(ctx: AppContext, item: QueueItem, source: ReviewEvent["source"], progress: string): Promise<Outcome> {
  if (isRootKey(item.termId)) return askRoot(ctx, item, source, progress);
  if (isExamKey(item.termId)) return askExam(ctx, item, source, progress);
  return ask(ctx, item, source, progress);
}

/** 今日解く数を、期限の来た復習と新しく始める問題に分けて（ホームと上の印） */
export async function todayCounts(): Promise<{ review: number; fresh: number }> {
  const queue = await todayQueue();
  const fresh = queue.filter((item) => item.isNew).length;
  return { review: queue.length - fresh, fresh };
}

/** 復習の範囲: 語は系統ごと、ほかは語根カードと骨学試験 */
function rangeOf(termId: string): string {
  if (isRootKey(termId)) return "roots";
  if (isExamKey(termId)) return "exam";
  return termById.get(termId)?.system ?? "";
}

function rangeLabel(key: string): string {
  if (key === "roots") return "語根カード";
  if (key === "exam") return "骨学試験";
  return systems.find((system) => system.id === key)?.ja ?? key;
}

/** 語の問い方の区分（TERM_KINDS の key）。語根・骨学試験は範囲で選ぶので null */
function kindOf(item: QueueItem): string | null {
  if (isRootKey(item.termId) || isExamKey(item.termId)) return null;
  return TERM_KINDS.find((kind) => kind.facets.includes(item.facet))?.key ?? null;
}

/**
 * 復習の始めに選んだもの。keep で絞り、limit 問で区切る（0 は全部）。
 * pending はこの復習でまちがえて、まだ正解していない問題（`語ID:問い方`）。「続ける」でも引きつぐ
 */
interface Setup {
  keep: (item: QueueItem) => boolean;
  limit: number;
  pending: Set<string>;
}

const cardOf = (item: QueueItem) => `${item.termId}:${item.facet}`;

export async function review(ctx: AppContext): Promise<void> {
  const today = await todayQueue();
  if (!today.length) {
    await nothingToday(ctx);
    return;
  }
  await session(ctx, await chooseReview(ctx, today));
}

/**
 * 復習の始めの画面: 今日の問題の内訳を出し、範囲（系統・語根カード・骨学試験）、問い方、新しい問題を出すか、1回に解く数を選ぶ。
 * 1回に解く数は前に選んだものを覚える。範囲と問い方は毎回すべてから始める（ホームの数と食いちがわないように）
 */
function chooseReview(ctx: AppContext, today: QueueItem[]): Promise<Setup> {
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.hint("");
  const order = [...systems.map((system) => system.id), "roots", "exam"];
  const rangeKeys = order.filter((key) => today.some((item) => rangeOf(item.termId) === key));
  const kindKeys = TERM_KINDS.map((kind) => kind.key).filter((key) => today.some((item) => kindOf(item) === key));
  const hasNew = today.some((item) => item.isNew);
  const ranges = new Set(rangeKeys);
  const kinds = new Set(kindKeys);
  let fresh = true;
  let limit = REVIEW_SIZE_OPTIONS.includes(preferences.reviewSize) ? preferences.reviewSize : 0;
  let moreOpen = false;
  let note = "";

  const rangeOk = (item: QueueItem) => ranges.has(rangeOf(item.termId));
  const kindOk = (item: QueueItem) => {
    const kind = kindOf(item);
    return kind === null || kinds.has(kind);
  };
  const freshOk = (item: QueueItem) => fresh || !item.isNew;
  const keep = (item: QueueItem) => rangeOk(item) && kindOk(item) && freshOk(item);

  return until<Setup>(ctx.signal, (resolve) => {
    // 最後の1つは外せない（何も出せなくなるので）。押したら理由を出す
    const toggle = (set: Set<string>, key: string) => {
      note = "";
      if (set.has(key) && set.size === 1) note = "少なくとも1つは選んでおきます。ほかを選んでから外してください。";
      else if (set.has(key)) set.delete(key);
      else set.add(key);
    };
    const chip = (key: string, label: string, on: boolean, count: number | null, onClick: () => void) =>
      h("button", {
        class: on ? "chip on" : "chip", type: "button", "data-key": key, "aria-pressed": String(on),
        onClick: () => { onClick(); render(key); },
      }, label, count === null ? "" : h("span", { class: "chip-count" }, String(count)));
    const all = (keys: string[], set: Set<string>) => keys.length > 1 && set.size < keys.length
      ? h("button", { class: "text-button chips-reset", type: "button", onClick: () => { keys.forEach((key) => set.add(key)); note = ""; render(); } }, "すべてに戻す")
      : "";

    const render = (focusKey?: string) => {
      const picked = today.filter(keep);
      const freshCount = picked.filter((item) => item.isNew).length;
      const count = limit ? Math.min(limit, picked.length) : picked.length;
      const start = h("button", { class: "primary review-start", type: "button", disabled: !picked.length, "data-key": "start" },
        picked.length ? `始める（${count}問）` : "始める");
      start.addEventListener("click", () => {
        void setPreference("reviewSize", limit);
        resolve({ keep, limit, pending: new Set() });
      });
      const more = h("details", { class: "review-more", open: moreOpen, ontoggle: (event: Event) => (moreOpen = (event.currentTarget as HTMLDetailsElement).open) },
        h("summary", {}, "問い方・新しい問題で絞る",
          kinds.size < kindKeys.length || !fresh ? h("span", { class: "muted" }, "（絞っています）") : ""),
        kindKeys.length ? h("h3", {}, "問い方") : "",
        kindKeys.length ? h("div", { class: "chip-list" }, ...kindKeys.map((key) => chip(key, TERM_KINDS.find((kind) => kind.key === key)!.label, kinds.has(key),
          today.filter((item) => kindOf(item) === key && rangeOk(item) && freshOk(item)).length, () => toggle(kinds, key)))) : "",
        all(kindKeys, kinds),
        hasNew ? h("h3", {}, "新しい問題") : "",
        hasNew ? h("div", { class: "chip-list" },
          chip("fresh-on", "出す", fresh, today.filter((item) => item.isNew && rangeOk(item) && kindOk(item)).length, () => (fresh = true)),
          chip("fresh-off", "復習だけ", !fresh, null, () => (fresh = false))) : "",
        hasNew ? h("p", { class: "muted" }, `新しい問題は、レッスンで学んだ語のまだ解いていない問い方です（1日 ${preferences.newPerDay}問まで。設定で変えられます）。`) : "",
      );
      showPanel(ctx,
        h("div", { class: "quiz-head" }, h("a", { href: "#/" }, "← ホーム"), ""),
        h("h2", {}, "今日の復習"),
        h("p", { class: "today-count" }, `${picked.length}問`,
          h("span", { class: "today-split" }, `復習 ${picked.length - freshCount}・新しい ${freshCount}`),
          picked.length < today.length ? h("span", { class: "today-split" }, `（今日の ${today.length}問のうち）`) : ""),
        rangeKeys.length > 1 ? h("h3", {}, "範囲") : "",
        rangeKeys.length > 1 ? h("div", { class: "chip-list" }, ...rangeKeys.map((key) => chip(key, rangeLabel(key), ranges.has(key),
          today.filter((item) => rangeOf(item.termId) === key && kindOk(item) && freshOk(item)).length, () => toggle(ranges, key)))) : "",
        all(rangeKeys, ranges),
        kindKeys.length || hasNew ? more : "",
        h("h3", {}, "1回に解く数"),
        h("div", { class: "chip-list" }, ...REVIEW_SIZE_OPTIONS.map((size) =>
          chip(`size-${size}`, size ? `${size}問` : "全部", size === limit, null, () => (limit = size)))),
        h("p", { class: "muted" }, "途中で「ここでやめる」（Esc）もできます。まちがえた問題は、その回の終わりにもう一度出ます。"),
        note ? h("p", { class: "drill-note" }, note) : "",
        picked.length ? "" : h("p", { class: "drill-note" }, "選んだ範囲・問い方に、今日の問題がありません。"),
        start,
      );
      // 選び直しても、押したチップ（初めは「始める」）にフォーカスを残す（キーボードで続けて選べるように）
      ctx.panel.querySelector<HTMLElement>(`[data-key="${focusKey ?? "start"}"]`)?.focus({ preventScroll: true });
    };
    render();
  });
}

/**
 * 選んだ範囲を解く。1問ごとに出題を作り直す。まちがえた問題は新しい語なら1分後・覚えた語なら10分後に期限が来るので、
 * 回の中でもう一度出る。ほかに出す問題が無くなったら、まちがえてまだ正解していない問題を、期限を待たずに（20分先までのものを）出す。
 */
async function session(ctx: AppContext, setup: Setup): Promise<void> {
  const { limit, pending } = setup;
  const nextQueue = () => remaining(setup);
  let answered = 0;
  let correct = 0;
  /** まちがえた語・語根・項目と、その問い方（終わりの画面で、図鑑や語根の一覧へ） */
  const missed = new Map<string, Set<string>>();
  // 「ここでやめる」（と Esc）: 今の問題をやめて、そこまでのまとめを出す
  const stop = new AbortController();
  ctx.signal.addEventListener("abort", () => stop.abort(ctx.signal.reason), { once: true });
  const quit = h("button", { class: "chip", type: "button", onClick: () => stop.abort("stop") }, "ここでやめる");
  ctx.tools.replaceChildren(quit);
  onKeys(stop.signal, (key) => {
    if (key !== "Escape") return false;
    stop.abort("stop");
    return true;
  });
  const inner = { ...ctx, signal: stop.signal };
  try {
    for (let next = await nextQueue(); next.queue.length && (!limit || answered < limit); next = await nextQueue()) {
      const { queue, again } = next;
      const item = queue[0];
      const total = limit ? Math.min(limit, answered + queue.length) : answered + queue.length;
      const outcome = await askItem(inner, item, "review", `${again ? "もう一度 " : ""}${answered + 1} / ${total}`);
      answered++;
      if (outcome === "correct") {
        correct++;
        pending.delete(cardOf(item));
      } else {
        pending.add(cardOf(item));
        missed.set(item.termId, (missed.get(item.termId) ?? new Set()).add(facetLabels[item.facet]));
      }
    }
  } catch (error) {
    if (stop.signal.reason !== "stop") throw error;
  }
  stop.abort("done");
  await finish(ctx, setup, answered, correct, missed);
}

/** 次に出す問題。期限の来たものが無ければ、まちがえてまだ正解していない問題を期限の前に（again） */
async function remaining(setup: Setup): Promise<{ queue: QueueItem[]; again: boolean }> {
  const queue = await todayQueue(new Date(), setup.keep);
  if (queue.length || !setup.pending.size) return { queue, again: false };
  const ahead = await todayQueue(new Date(), (item) => setup.keep(item) && setup.pending.has(cardOf(item)), new Date(Date.now() + AHEAD_MS));
  return { queue: ahead, again: true };
}

/** 復習の回の終わり: 正解の数、まちがえた語、続き（同じ範囲）・ほかの範囲・次のレッスン */
async function finish(ctx: AppContext, setup: Setup, answered: number, correct: number, missed: Map<string, Set<string>>): Promise<void> {
  ctx.tools.replaceChildren();
  ctx.viewer.onPick = null;
  ctx.viewer.setLabel(null);
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.hint("");
  const [{ queue: rest }, others, learned] = await Promise.all([
    remaining(setup),
    todayQueue(new Date(), (item) => !setup.keep(item)),
    db.learned.toArray(),
  ]);
  const next = nextLesson(learned);
  // 「続ける」: 同じ範囲・問い方・区切りで続きから
  const again = h("button", {
    class: "primary", type: "button", onClick: () => void session(ctx, setup).catch((error) => {
      if (!ctx.signal.aborted) throw error;
    }),
  }, `続ける（残り ${rest.length}問）`);
  // ほかの範囲: 始めの画面からやり直す（今と同じアドレスなので、画面を作り直す）
  const otherLink = (className: string) => h("a", {
    class: className, href: "#/review", onClick: (event: Event) => {
      event.preventDefault();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    },
  }, `ほかの範囲を復習する（${others.length}問）`);
  const home = (className: string) => h("a", { class: className, href: "#/" }, "ホームへ");
  const missedLink = (id: string, facets: Set<string>) => {
    const title = [...facets].join("・");
    const root = rootByKey.get(id);
    const exam = examByKey.get(id);
    if (root) return h("a", { class: "chip", href: `#/roots/root/${encodeURIComponent(id)}`, lang: "en", title }, root.root);
    if (exam) return h("a", { class: "chip", href: itemHref(exam), title }, exam.title);
    return h("a", { class: "chip", href: `#/explore/${id}`, title }, termById.get(id)?.ja ?? id, h("span", { class: "chip-count" }, title));
  };
  showPanel(ctx,
    h("h2", {}, rest.length ? "ここまでの復習" : answered ? "今日の復習おわり" : "今日の復習はありません"),
    answered ? h("p", { class: "today-count" }, `${correct} / ${answered} 正解`) : "",
    answered ? h("p", {}, "正解した問題は日をあけて出ます。まちがえた問題は、新しい語なら1分後・覚えた語なら10分後に期限が来て、その回の終わりにもう一度出ます。") : "",
    missed.size ? h("h3", {}, "まちがえた語（タップでその語へ）") : "",
    missed.size ? h("div", { class: "chip-list" }, ...[...missed].map(([id, facets]) => missedLink(id, facets))) : "",
    rest.length && others.length ? h("p", {}, otherLink("text-button")) : "",
    h("div", { class: "nav-row" },
      ...(rest.length
        ? [home("ghost-button"), again]
        : others.length
          ? [home("ghost-button"), otherLink("primary")]
          : next && learned.length
            ? [home("ghost-button"), h("a", { class: "primary", href: `#/learn/${next.id}` }, "次のレッスンへ")]
            : [home("primary")]),
    ),
  );
}

/** 今日の問題が無いとき: 次の復習がいつ来るか、新しい問題の上限に届いたか、次の一手 */
async function nothingToday(ctx: AppContext): Promise<void> {
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.hint("");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [learned, schedules, newToday] = await Promise.all([
    db.learned.toArray(),
    db.schedules.toArray(),
    db.reviewEvents.where("reviewedAt").aboveOrEqual(startOfDay.toISOString()).filter((event) => event.isNew && event.source === "review").count(),
  ]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  const study = preferences.studyFacets;
  const upcoming = schedules
    .filter((s) => learnedIds.has(s.termId) && s.state !== State.New && (isRootKey(s.termId) || isExamKey(s.termId) || study.includes(s.facet)))
    .sort((a, b) => a.due.localeCompare(b.due));
  const tomorrow = Date.now() + 86_400_000;
  const soon = upcoming.filter((s) => new Date(s.due).getTime() <= tomorrow).length;
  const next = nextLesson(learned);
  showPanel(ctx,
    h("h2", {}, "今日の復習はありません"),
    !learned.length ? h("p", {}, "まずホームからレッスンを始めましょう。確認テストに答えた語が、毎日の復習に入ります。") : "",
    upcoming.length ? h("p", {}, `次の復習は ${dueLabel(upcoming[0])}${soon ? `（24時間のうちに ${soon}問）` : ""}。`) : "",
    learned.length && newToday >= preferences.newPerDay
      ? h("p", { class: "muted" }, `今日の新しい問題（${preferences.newPerDay}問）は解き終えました。もっと解くときは、設定で1日の数を増やすか、ホームの「範囲を選ぶ」で演習できます。`)
      : "",
    h("div", { class: "nav-row" },
      h("a", { class: next ? "ghost-button" : "primary", href: "#/" }, "ホームへ"),
      next ? h("a", { class: "primary", href: `#/learn/${next.id}` }, `次のレッスン「${next.title}」`) : "",
    ),
  );
}
