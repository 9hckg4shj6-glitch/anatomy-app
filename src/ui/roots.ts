import type { Term } from "../content";
import { db, nowIso, type ReviewEvent } from "../db";
import { h, until } from "../dom";
import { dueLabel, Rating, recordReview } from "../fsrs";
import { examplesOf, exampleFor, rootByKey, rootKey, roots, rootUnitById, rootUnits, type Root } from "../roots";
import { facetLabels, pickChoices, shuffle, type QueueItem } from "../study";
import { LEAVE_LESSON, type AppContext } from "./context";
import { turnPage } from "./lesson";
import { chooseOne, retryButton, showPanel, type Outcome } from "./quiz";
import { markedRoot as marked } from "./term-card";

/** 例の語の3Dを光らせる（部位を持つ語だけ。系統は3つまで読む） */
async function showExamples(ctx: AppContext, list: Term[]): Promise<void> {
  const shown = list.filter((term) => ctx.index.terms[term.id]).slice(0, 8);
  const systems = [...new Set(shown.map((term) => term.system))].slice(0, 3);
  await ctx.viewer.show({ systems: systems.length ? systems : ["skeletal"], body: true });
  ctx.viewer.highlight(shown.filter((term) => systems.includes(term.system)).map((term) => term.id));
  ctx.viewer.overview();
}

/** 語根の中身（意味・由来・覚え方・例の語）。例の語は図鑑へ */
export function rootCard(root: Root, options: { examples?: number } = {}): HTMLElement {
  const list = examplesOf(root).slice(0, options.examples ?? 8);
  return h("article", { class: "term-card root-card" },
    h("div", { class: "term-head" },
      h("span", { class: "root-form", lang: "en" }, root.root),
      h("span", { class: "term-system" }, root.from),
    ),
    h("p", { class: "root-meaning" }, root.meaning),
    h("dl", { class: "term-notes" },
      h("div", {}, h("dt", {}, "例"), h("dd", {}, root.note)),
    ),
    list.length ? h("ul", { class: "root-examples" }, ...list.map((term) =>
      h("li", {}, h("a", { href: `#/explore/${term.id}` }, h("span", {}, term.ja), marked(term.en, root))))) : "",
  );
}

/** 語根の一覧（グループごと）。タップで中身を開く */
export async function rootIndex(ctx: AppContext): Promise<void> {
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.hint("語根をタップすると例の語が光る");
  const learned = new Set((await db.learned.toArray()).map((item) => item.termId));
  const detail = h("div", {});
  const open = (root: Root) => {
    detail.replaceChildren(rootCard(root, { examples: 12 }));
    void showExamples(ctx, examplesOf(root));
    detail.scrollIntoView({ block: "nearest" });
  };
  ctx.panel.replaceChildren(
    h("h2", {}, "語根カード"),
    h("p", { class: "muted" }, "英語・ラテン語の名前は、意味のある部品（語根）の組み合わせでできている。語根を覚えると初めて見る名前も意味が分かる。"),
    detail,
    ...rootUnits.map((unit) => h("section", { class: "system" },
      h("h3", {}, h("a", { href: `#/roots/${unit.id}` }, unit.title), h("span", { class: "unit-count" }, ` ${unit.roots.filter((root) => learned.has(rootKey(root))).length}/${unit.roots.length}`)),
      h("div", { class: "chip-list" }, ...unit.roots.map((root) =>
        h("button", { class: learned.has(rootKey(root)) ? "chip on" : "chip", type: "button", onClick: () => open(root) }, `${root.root} ${root.meaning}`))),
    )),
  );
}

/** 語根のレッスン: 1つずつ見る → 確認テスト（語根→意味） → 復習に入る */
export async function rootLesson(ctx: AppContext, unitId: string): Promise<void> {
  const unit = rootUnitById.get(unitId);
  if (!unit) {
    ctx.panel.replaceChildren(h("p", {}, "レッスンが見つかりません。"), h("a", { href: "#/" }, "ホームへ"));
    return;
  }
  ctx.guard(LEAVE_LESSON);
  for (let i = 0; i < unit.roots.length; ) {
    const root = unit.roots[i];
    void showExamples(ctx, examplesOf(root));
    ctx.hint(`${i + 1} / ${unit.roots.length}　光っているのは例の語`);
    const back = h("button", { class: "ghost-button", type: "button", disabled: i === 0 }, "前へ");
    const next = h("button", { class: "primary", type: "button" }, i === unit.roots.length - 1 ? "確認テストへ" : "次へ");
    showPanel(ctx,
      h("div", { class: "quiz-head" }, h("span", { class: "facet" }, unit.title), h("span", { class: "count" }, `${i + 1} / ${unit.roots.length}`)),
      rootCard(root),
      h("div", { class: "nav-row" }, back, next),
    );
    next.focus({ preventScroll: true });
    i += await turnPage(ctx.signal, back, next);
  }
  let correct = 0;
  const items = shuffle(unit.roots).map((root) => ({ termId: rootKey(root), facet: "rootMeaning" as const, isNew: true }));
  for (const [i, item] of items.entries()) {
    if ((await askRoot(ctx, item, "lesson", `確認 ${i + 1} / ${items.length}`)) === "correct") correct++;
  }
  const learnedAt = nowIso();
  await db.learned.bulkPut(unit.roots.map((root) => ({ termId: rootKey(root), unitId: unit.id, learnedAt })));
  ctx.guard(null);
  void navigator.storage?.persist?.().catch(() => false);
  ctx.hint("");
  showPanel(ctx,
    h("h2", {}, `「${unit.title}」おわり`),
    h("p", { class: "today-count" }, `確認テスト ${correct} / ${items.length}`),
    h("p", {}, "語根は復習に入りました。「意味→語根」の問題も復習で出ます。"),
    h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/roots" }, "語根の一覧"), h("a", { class: "primary", href: "#/review" }, "復習する")),
  );
}

/** 語根の問題を1問出して記録する。rootMeaning＝語根を見て意味、rootForm＝意味を見て語根 */
export async function askRoot(ctx: AppContext, item: QueueItem, source: ReviewEvent["source"], progress = ""): Promise<Outcome> {
  const root = rootByKey.get(item.termId)!;
  const started = performance.now();
  const example = exampleFor(root);
  void showExamples(ctx, example ? [example] : []);
  ctx.viewer.setLabel(null);
  ctx.hint("");
  const header = h("div", { class: "quiz-head" }, h("span", { class: "facet" }, facetLabels[item.facet]), h("span", { class: "count" }, progress));
  // 選択肢は同じグループの語根を先に。意味が同じ語根（thorac- と pector-）は出さない
  const sameGroup = shuffle(roots.filter((other) => other.group === root.group && other.id !== root.id)).map(rootKey);
  const all = roots.map(rootKey);
  const meaningOf = (key: string) => rootByKey.get(key)!.meaning;
  const formOf = (key: string) => rootByKey.get(key)!.root;
  const byMeaning = item.facet === "rootMeaning";
  const display = byMeaning ? meaningOf : formOf;
  const choices = pickChoices(item.termId, sameGroup, all.filter((key) => meaningOf(key) !== root.meaning || key === item.termId), display);
  const prompt = byMeaning
    ? h("div", {}, h("p", { class: "prompt" }, "この語根の意味は？"), h("p", { class: "root-form big", lang: "en" }, root.root),
      example ? h("p", { class: "muted" }, "例: ", marked(example.en, root)) : "")
    : h("div", {}, h("p", { class: "prompt" }, "この意味の語根は？"), h("p", { class: "prompt-ja" }, root.meaning),
      example ? h("p", { class: "muted" }, `例: ${example.ja}`) : "");
  const picked = await chooseOne(ctx, header, prompt, choices, display, byMeaning ? undefined : "en");
  const outcome: Outcome = picked === item.termId ? "correct" : picked ? "wrong" : "skip";
  const { schedule, undo } = await recordReview(item.termId, item.facet, outcome === "correct" ? Rating.Good : Rating.Again,
    { durationMs: Math.round(performance.now() - started), source });
  void showExamples(ctx, examplesOf(root));
  const wrong = picked && picked !== item.termId ? rootByKey.get(picked)! : null;
  const next = h("button", { class: "primary", type: "button" }, "次へ");
  const retry = outcome === "correct" ? null : retryButton();
  showPanel(ctx, header,
    outcome === "correct" ? h("div", { class: "result ok" }, "正解") : h("div", { class: "result ng" }, outcome === "skip" ? "答えを確認しよう" : "不正解"),
    wrong ? h("p", { class: "wrong-note" }, `あなたが選んだのは ${wrong.root}「${wrong.meaning}」`) : "",
    rootCard(root, { examples: 6 }),
    h("p", { class: "next-due" }, `次の出題: ${dueLabel(schedule)}`),
    retry ?? "",
    next,
  );
  next.focus({ preventScroll: true });
  const again = await until<boolean>(ctx.signal, (resolve) => {
    next.addEventListener("click", () => resolve(false), { once: true });
    retry?.addEventListener("click", () => resolve(true), { once: true });
  });
  if (!again) return outcome;
  await undo();
  return askRoot(ctx, item, source, progress);
}
