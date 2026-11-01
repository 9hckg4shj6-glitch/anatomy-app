import { autoSpeak } from "../audio";
import { isDrawn, unitById } from "../content";
import { db, nowIso } from "../db";
import { h, onKeys, until } from "../dom";
import { shuffle, type QueueItem } from "../study";
import { motionPlayer, sceneFor, type AppContext } from "./context";
import { nextLesson } from "./home";
import { ask, showPanel } from "./quiz";
import { termCard } from "./term-card";

/**
 * レッスン：①3Dで1語ずつ見る → ②確認テスト（タップと名前当てを交互に） → ③復習に入る。
 * 確認テストで答えた語から1つずつ「学んだ」に入れるので、途中でやめても答えた語は復習に入り、次に開くと残りの語から続ける。
 */
export async function lesson(ctx: AppContext, unitId: string): Promise<void> {
  const unit = unitById.get(unitId);
  if (!unit) {
    ctx.panel.replaceChildren(h("p", {}, "レッスンが見つかりません。"), h("a", { href: "#/" }, "ホームへ"));
    return;
  }
  const { viewer, signal } = ctx;
  await viewer.show(sceneFor(unit.system, unit.id));

  // 途中まで学んだレッスン（並べ直しで語が加わったレッスンも）は、残りの語から続けるか選ぶ
  const learnedIds = new Set((await db.learned.bulkGet(unit.terms.map((term) => term.id))).flatMap((item) => (item ? [item.termId] : [])));
  const rest = unit.terms.filter((term) => !learnedIds.has(term.id));
  let list = unit.terms;
  if (rest.length && rest.length < unit.terms.length) {
    viewer.highlight(rest.map((term) => term.id), { isolate: !rest.some((term) => term.figure) });
    viewer.overview();
    ctx.hint("");
    const resume = h("button", { class: "primary", type: "button" }, `続きから（残り ${rest.length}語）`);
    const restart = h("button", { class: "ghost-button", type: "button" }, `はじめから（${unit.terms.length}語）`);
    showPanel(ctx,
      h("div", { class: "quiz-head" }, h("span", { class: "facet" }, unit.title), h("span", { class: "count" }, `${unit.terms.length - rest.length} / ${unit.terms.length}語 学んだ`)),
      h("p", {}, "このレッスンは途中です。まだの語: ", rest.map((term) => term.ja).join("・")),
      h("div", { class: "nav-row" }, restart, resume),
    );
    resume.focus({ preventScroll: true });
    if (await until<boolean>(signal, (resolve) => {
      resume.addEventListener("click", () => resolve(true), { once: true });
      restart.addEventListener("click", () => resolve(false), { once: true });
    })) list = rest;
  }

  // レッスンの初めの説明（基本の用語の「解剖学的正位」など）
  if (unit.intro && list === unit.terms) {
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

  for (let i = 0; i < list.length; ) {
    const term = list[i];
    // 学ぶ語を強調し、まわりは半透明にする（基本の用語の図は骨格を手がかりに見るので、まわりも見せる）
    viewer.highlight([term.id], { isolate: !term.figure });
    viewer.focus(term.id, 3.2);
    viewer.setLabel(term.id, term.ja);
    ctx.hint("");
    autoSpeak(term);
    const back = h("button", { class: "ghost-button", type: "button", disabled: i === 0 }, "前へ");
    const next = h("button", { class: "primary", type: "button" }, i === list.length - 1 ? "確認テストへ" : "次へ");
    // 知っている語ばかりなら、残りをめくらずに確認テストへ
    const skip = i < list.length - 1 ? h("button", { class: "text-button skip-test", type: "button" }, "残りを飛ばして確認テストへ") : null;
    showPanel(ctx,
      h("div", { class: "quiz-head" }, h("span", { class: "facet" }, unit.title), h("span", { class: "count" }, `${i + 1} / ${list.length}`)),
      termCard(term, { motion: motionPlayer(ctx, term) }),
      skip ?? "",
      h("div", { class: "nav-row" }, back, next),
    );
    next.focus({ preventScroll: true });
    const step = await turnPage(signal, back, next, skip);
    if (step === 0) break;
    i += step;
  }

  viewer.setLabel(null);
  const items: QueueItem[] = shuffle(list).map((term, i) => ({ termId: term.id, facet: i % 2 || term.xray || isDrawn(term) ? "locate" : "point", isNew: true }));
  let correct = 0;
  for (const [i, item] of items.entries()) {
    const outcome = await ask(ctx, item, "lesson", `確認 ${i + 1} / ${items.length}`);
    if (outcome === "correct") correct++;
    // 答えた語から「学んだ」に入れる（途中でやめても、答えた語は復習に出る）
    await db.learned.put({ termId: item.termId, unitId: unit.id, learnedAt: nowIso() });
  }
  // 学習の記録を、端末の空きが減ったときなどにブラウザが消さないようにする（ホーム画面に追加した PWA は多くが自動で認められる）
  void navigator.storage?.persist?.().catch(() => false);

  viewer.setLabel(null);
  viewer.highlight(unit.terms.map((term) => term.id), { isolate: !unit.terms.some((term) => term.figure) });
  viewer.overview();
  ctx.hint("");
  const next = nextLesson(await db.learned.toArray());
  showPanel(ctx,
    h("h2", {}, `「${unit.title}」おわり`),
    h("p", { class: "today-count" }, `確認テスト ${correct} / ${items.length}`),
    h("p", {}, "この語は復習に入りました。英語の問題も復習で出ます。"),
    unit.terms.some((term) => term.nerve) ? h("p", {}, "筋の起始・停止・支配神経・作用は、位置を覚えたころに復習で出ます。") : "",
    unit.terms.some((term) => term.passes) ? h("p", {}, "孔・溝を通るもの（入るもの）は、位置を覚えたころに復習で出ます。") : "",
    h("p", {}, h("a", { href: "#/review" }, "今日の復習へ")),
    h("div", { class: "nav-row" },
      h("a", { class: next ? "ghost-button" : "primary", href: "#/" }, "ホームへ"),
      next ? h("a", { class: "primary", href: `#/learn/${next.id}` }, `次のレッスン「${next.title}」`) : "",
    ),
  );
}

/** 「前へ」「次へ」を待つ（PC では ← → キーでも）。進む数を返す。skip（確認テストへ飛ぶ）なら 0 */
export function turnPage(signal: AbortSignal, back: HTMLButtonElement, next: HTMLButtonElement, skip?: HTMLButtonElement | null): Promise<number> {
  return until<number>(signal, (resolve) => {
    const stop = onKeys(signal, (key) => {
      if (key === "ArrowRight") next.click();
      else if (key === "ArrowLeft" && !back.disabled) back.click();
      else return false;
      return true;
    });
    back.addEventListener("click", () => { stop(); resolve(-1); }, { once: true });
    next.addEventListener("click", () => { stop(); resolve(1); }, { once: true });
    skip?.addEventListener("click", () => { stop(); resolve(0); }, { once: true });
  });
}
