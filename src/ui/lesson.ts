import { autoSpeak } from "../audio";
import { isDrawn, unitById } from "../content";
import { db, nowIso } from "../db";
import { h, onKeys, until } from "../dom";
import { shuffle, type QueueItem } from "../study";
import { LEAVE_LESSON, motionPlayer, sceneFor, type AppContext } from "./context";
import { ask, showPanel } from "./quiz";
import { termCard } from "./term-card";

/** レッスン：①3Dで1語ずつ見る → ②確認テスト（タップと名前当てを交互に） → ③復習に入る */
export async function lesson(ctx: AppContext, unitId: string): Promise<void> {
  const unit = unitById.get(unitId);
  if (!unit) {
    ctx.panel.replaceChildren(h("p", {}, "レッスンが見つかりません。"), h("a", { href: "#/" }, "ホームへ"));
    return;
  }
  const { viewer, signal } = ctx;
  ctx.guard(LEAVE_LESSON);
  await viewer.show(sceneFor(unit.system, unit.id));

  // レッスンの初めの説明（基本の用語の「解剖学的正位」など）
  if (unit.intro) {
    viewer.overview();
    ctx.hint(unit.title);
    const start = h("button", { class: "primary", type: "button" }, "始める");
    showPanel(ctx,
      h("div", { class: "quiz-head" }, h("span", { class: "facet" }, unit.title), h("span", { class: "count" }, `${unit.terms.length}語`)),
      h("div", { class: "intro" }, ...unit.intro.map((text) => h("p", {}, text))),
      h("div", { class: "nav-row" }, start),
    );
    start.focus({ preventScroll: true });
    await until(signal, (resolve) => start.addEventListener("click", () => resolve(undefined), { once: true }));
  }

  for (let i = 0; i < unit.terms.length; ) {
    const term = unit.terms[i];
    // 学ぶ語を強調し、まわりは半透明にする（基本の用語の図は骨格を手がかりに見るので、まわりも見せる）
    viewer.highlight([term.id], { isolate: !term.figure });
    viewer.focus(term.id, 3.2);
    viewer.setLabel(term.id, term.ja);
    ctx.hint(`${i + 1} / ${unit.terms.length}`);
    autoSpeak(term);
    const back = h("button", { class: "ghost-button", type: "button", disabled: i === 0 }, "前へ");
    const next = h("button", { class: "primary", type: "button" }, i === unit.terms.length - 1 ? "確認テストへ" : "次へ");
    showPanel(ctx,
      h("div", { class: "quiz-head" }, h("span", { class: "facet" }, unit.title), h("span", { class: "count" }, `${i + 1} / ${unit.terms.length}`)),
      termCard(term, { motion: motionPlayer(ctx, term) }),
      h("div", { class: "nav-row" }, back, next),
    );
    next.focus({ preventScroll: true });
    i += await turnPage(signal, back, next);
  }

  viewer.setLabel(null);
  const items: QueueItem[] = shuffle(unit.terms).map((term, i) => ({ termId: term.id, facet: i % 2 || term.xray || isDrawn(term) ? "locate" : "point", isNew: true }));
  let correct = 0;
  for (const [i, item] of items.entries()) {
    if ((await ask(ctx, item, "lesson", `確認 ${i + 1} / ${items.length}`)) === "correct") correct++;
  }
  const learnedAt = nowIso();
  await db.learned.bulkPut(unit.terms.map((term) => ({ termId: term.id, unitId: unit.id, learnedAt })));
  ctx.guard(null);
  // 学習の記録を、端末の空きが減ったときなどにブラウザが消さないようにする（ホーム画面に追加した PWA は多くが自動で認められる）
  void navigator.storage?.persist?.().catch(() => false);

  viewer.setLabel(null);
  viewer.highlight(unit.terms.map((term) => term.id), { isolate: !unit.terms.some((term) => term.figure) });
  viewer.overview();
  ctx.hint("");
  showPanel(ctx,
    h("h2", {}, `「${unit.title}」おわり`),
    h("p", { class: "today-count" }, `確認テスト ${correct} / ${items.length}`),
    h("p", {}, "この語は復習に入りました。英語の問題も復習で出ます。"),
    unit.terms.some((term) => term.nerve) ? h("p", {}, "筋の起始・停止・支配神経・作用は、位置を覚えたころに復習で出ます。") : "",
    h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/" }, "ホームへ"), h("a", { class: "primary", href: "#/review" }, "復習する")),
  );
}

/** 「前へ」「次へ」を待つ（PC では ← → キーでも）。進む数を返す */
export function turnPage(signal: AbortSignal, back: HTMLButtonElement, next: HTMLButtonElement): Promise<number> {
  return until<number>(signal, (resolve) => {
    const stop = onKeys(signal, (key) => {
      if (key === "ArrowRight") next.click();
      else if (key === "ArrowLeft" && !back.disabled) back.click();
      else return false;
      return true;
    });
    back.addEventListener("click", () => { stop(); resolve(-1); }, { once: true });
    next.addEventListener("click", () => { stop(); resolve(1); }, { once: true });
  });
}
