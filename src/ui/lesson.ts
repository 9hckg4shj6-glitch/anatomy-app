import { autoSpeak } from "../audio";
import type { Term, Unit } from "../content";
import { isBeginner, lessonById, studyFacets } from "../course";
import { db, nowIso, type Facet } from "../db";
import { h, onKeys, until } from "../dom";
import { preferences, setPreference } from "../settings";
import { BASIC_FACETS, facetLabels, facetsFor, lessonFacet, shuffle, type QueueItem } from "../study";
import { motionPlayer, sceneFor, type AppContext } from "./context";
import { nextLesson } from "./lessons";
import { ask, showPanel } from "./quiz";
import { termCard } from "./term-card";

/**
 * レッスン：①始めの画面で確認テストの問い方を選ぶ → ②3Dで1語ずつ見る → ③確認テスト（選んだ問い方を順に。初めはタップと名前当てを交互に） → ④復習に入る。
 * 確認テストで答えた語から1つずつ「学んだ」に入れるので、途中でやめても答えた語は復習に入り、次に開くと残りの語から続ける。
 */
export async function lesson(ctx: AppContext, unitId: string): Promise<void> {
  const unit = lessonById.get(unitId);
  if (!unit) {
    ctx.panel.replaceChildren(h("p", {}, "レッスンが見つかりません。"), h("a", { href: "#/lessons" }, "レッスンの一覧へ"));
    return;
  }
  const { viewer, signal } = ctx;
  await viewer.show(sceneFor(unit.system, unit.id));

  // 始めの画面: レッスンの初めの説明（基本の用語の「解剖学的正位」など）、確認テストの問い方、
  // 途中まで学んだレッスン（並べ直しで語が加わったレッスンも）なら残りの語から続けるか
  const learnedIds = new Set((await db.learned.bulkGet(unit.terms.map((term) => term.id))).flatMap((item) => (item ? [item.termId] : [])));
  const rest = unit.terms.filter((term) => !learnedIds.has(term.id));
  const partial = rest.length > 0 && rest.length < unit.terms.length;
  viewer.highlight((partial ? rest : unit.terms).map((term) => term.id), { isolate: !unit.terms.some((term) => term.figure) });
  viewer.overview();
  ctx.hint(unit.title);
  const list = await startScreen(ctx, unit, partial ? rest : null);

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
  // 確認テストは、選んだ問い方を語ごとに順に回す（初めは位置→名前と名前→位置を交互に）
  const chosen = testFacets();
  const items: QueueItem[] = shuffle(list).map((term, i) => ({ termId: term.id, facet: lessonFacet(facetsFor(term, false, studyFacets()), chosen, i), isNew: true }));
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
    h("p", {}, "この語は復習に入りました。復習では ", reviewKinds(unit), " が出ます。"),
    unit.terms.some((term) => term.nerve) && studies("attach") ? h("p", {}, "筋の起始・停止・支配神経・作用は、場所を覚えたころに復習で出ます。") : "",
    unit.terms.some((term) => term.passes) && studies("passage") ? h("p", {}, "孔・溝を通るもの（入るもの）は、場所を覚えたころに復習で出ます。") : "",
    h("p", {}, h("a", { href: "#/review" }, "今日の復習へ")),
    h("div", { class: "nav-row" },
      h("a", { class: next ? "ghost-button" : "primary", href: "#/lessons" }, "レッスンの一覧へ"),
      next ? h("a", { class: "primary", href: `#/learn/${next.id}` }, `次のレッスン「${next.title}」`) : "",
    ),
  );
}

/** 確認テストで出す問い方（レッスンの始めに選んだもの）。設定の「学ぶ問い方」で外したものは除く */
function testFacets(): Facet[] {
  const study = studyFacets().filter((facet) => BASIC_FACETS.includes(facet));
  const chosen = preferences.lessonFacets.filter((facet) => study.includes(facet));
  return chosen.length ? chosen : study.slice(0, 1);
}

const studies = (facet: Facet) => studyFacets().includes(facet);

/** 復習で出る問い方の名前（このレッスンの語に出せて、学ぶ問い方に選んだ基本の問い方） */
function reviewKinds(unit: Unit): string {
  const facets = BASIC_FACETS.filter((facet) => unit.terms.some((term) => facetsFor(term, false, studyFacets()).includes(facet)));
  return facets.map((facet) => `「${facetLabels[facet]}」`).join("");
}

/**
 * レッスンの始めの画面。初めの説明と、確認テストの問い方（場所から覚えるか、英語から覚えるか。選んだものを覚える）を出す。
 * rest（途中まで学んだレッスンのまだの語）があれば「続きから」か「はじめから」を選ぶ。学ぶ語を返す
 */
async function startScreen(ctx: AppContext, unit: Unit, rest: Term[] | null): Promise<Term[]> {
  const study = BASIC_FACETS.filter((facet) => studies(facet));
  // このレッスンの語のどれにも出せない問い方（基本の用語の図の「名前→位置」など）は並べない
  const usable = study.filter((facet) => unit.terms.some((term) => facetsFor(term, false, studyFacets()).includes(facet)));
  const beginner = isBeginner();
  let note = "";
  return until<Term[]>(ctx.signal, (resolve) => {
    const render = (focusKey?: string) => {
      // このレッスンで出せるものだけを見せる（名前→位置を選んでいても、基本の用語の図のレッスンでは出ない）
      const chosen = testFacets().filter((facet) => usable.includes(facet));
      const chip = (facet: Facet) => h("button", {
        class: chosen.includes(facet) ? "chip on" : "chip", type: "button", "data-key": facet, "aria-pressed": String(chosen.includes(facet)),
        onClick: async () => {
          note = "";
          const saved = testFacets();
          const next = saved.includes(facet) ? saved.filter((f) => f !== facet) : BASIC_FACETS.filter((f) => f === facet || saved.includes(f));
          if (!next.some((f) => usable.includes(f))) note = "少なくとも1つは選んでおきます。ほかを選んでから外してください。";
          else await setPreference("lessonFacets", next);
          render(facet);
        },
      }, facetLabels[facet]);
      const preset = (label: string, facets: Facet[]) => {
        const picked = facets.filter((facet) => usable.includes(facet));
        if (!picked.length) return "";
        const on = picked.length === chosen.length && picked.every((facet) => chosen.includes(facet));
        return h("button", {
          class: on ? "chip on" : "chip", type: "button", "data-key": label, "aria-pressed": String(on),
          onClick: async () => {
            note = "";
            await setPreference("lessonFacets", picked);
            render(label);
          },
        }, label);
      };
      const start = h("button", { class: "primary", type: "button", "data-key": "start" }, rest ? `続きから（残り ${rest.length}語）` : "始める");
      const restart = rest ? h("button", { class: "ghost-button", type: "button" }, `はじめから（${unit.terms.length}語）`) : null;
      start.addEventListener("click", () => resolve(rest ?? unit.terms), { once: true });
      restart?.addEventListener("click", () => resolve(unit.terms), { once: true });
      const skipped = study.filter((facet) => !chosen.includes(facet));
      showPanel(ctx,
        h("div", { class: "quiz-head" }, h("span", { class: "facet" }, unit.title),
          h("span", { class: "count" }, rest ? `${unit.terms.length - rest.length} / ${unit.terms.length}語 学んだ` : `${unit.terms.length}語`)),
        unit.intro && !rest ? h("div", { class: "intro" }, ...unit.intro.map((text) => h("p", {}, text))) : "",
        rest ? h("p", {}, "このレッスンは途中です。まだの語: ", rest.map((term) => term.ja).join("・"))
          : h("p", { class: "muted lesson-terms" }, unit.terms.map((term) => term.ja).join("・")),
        h("h3", {}, "確認テストで覚えること"),
        usable.length > 1 ? h("div", { class: "chip-list lesson-presets" },
          preset("場所から", ["locate", "point"]), preset("日本語→英語", ["ja2en"]), preset("英語→日本語", ["en2ja"]), preset("ぜんぶ", usable)) : "",
        // 初心者モードでは、問い方を1つずつ選ぶ欄と設定への案内は出さない（まとめた選び方だけ）
        usable.length > 1 && !beginner ? h("p", { class: "setting-label" }, "問い方を1つずつ選ぶ") : "",
        beginner && usable.length > 1 ? "" : h("div", { class: "chip-list" }, ...usable.map(chip)),
        beginner
          ? h("p", { class: "muted" }, "語を3Dで1つずつ見たあと、1語に1問ずつ確認します。")
          : h("p", { class: "muted" },
            "語を3Dで1つずつ見たあと、選んだ問い方を順に回して1語に1問ずつ出します。",
            skipped.length ? `選ばなかった${skipped.map((facet) => `「${facetLabels[facet]}」`).join("")}は、あとで復習に新しい問題として出ます。` : "",
            h("br"), "問い方そのものを外すときは ", h("a", { href: "#/settings" }, "設定の「学ぶ問い方」"), "で。"),
        note ? h("p", { class: "drill-note" }, note) : "",
        h("div", { class: "nav-row" }, restart ?? "", start),
      );
      ctx.panel.querySelector<HTMLElement>(`[data-key="${focusKey ?? "start"}"]`)?.focus({ preventScroll: true });
    };
    render();
  });
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
