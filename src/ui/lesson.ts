import { autoSpeak } from "../audio";
import { systemById, type Term, type Unit } from "../content";
import { isBeginner, lessonById, studyFacets } from "../course";
import { db, nowIso, type Facet } from "../db";
import { h, onKeys, until } from "../dom";
import { preferences, setPreference } from "../settings";
import { BASIC_FACETS, facetLabels, facetsFor, lessonFacet, shuffle, type QueueItem } from "../study";
import { motionPlayer, sceneFor, type AppContext } from "./context";
import { lessonMinutes } from "./home";
import { nextLesson } from "./lessons";
import { plateOverlay } from "./plate-view";
import { ask, showPanel } from "./quiz";
import { termCard } from "./term-card";
import { noteText } from "../en-notes";

/**
 * レッスン：①始めの画面で確認テストの問い方を選ぶ → ②3Dで1語ずつ見る → ③確認テスト（選んだ問い方を順に。初めはタップと名前当てを交互に） → ④復習に入る。
 * 確認テストで答えた語から1つずつ「学んだ」に入れるので、途中でやめても答えた語は復習に入り、次に開くと残りの語から続ける。
 */
export async function lesson(ctx: AppContext, arg: string): Promise<void> {
  // "<ID>/try" ははじめにの3語だけの短いレッスン（始めの画面を出さず、位置→名前と名前→位置で）
  const [unitId, mode] = arg.split("/");
  const trial = mode === "try";
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
  // 平面図の語（皮膚の層など）は3Dの上に図を重ねて示す
  const plates = plateOverlay(ctx);
  const firstOnPlate = unit.terms.find((term) => term.plate);
  if (firstOnPlate) void plates.show(firstOnPlate, { names: true, mark: false });
  const { list, browse } = trial
    ? { list: unit.terms.filter((term) => !learnedIds.has(term.id)).slice(0, TRIAL_TERMS), browse: true }
    : await startScreen(ctx, unit, partial ? rest : null);

  for (let i = 0; browse && i < list.length; ) {
    const term = list[i];
    // 学ぶ語を強調し、まわりは半透明にする（基本の用語の図は骨格を手がかりに見るので、まわりも見せる）
    viewer.highlight([term.id], { isolate: !term.figure });
    viewer.focus(term.id, 3.2);
    viewer.setLabel(term.id, term.ja);
    if (term.plate) void plates.show(term, { names: true, mark: true });
    else plates.hide();
    ctx.hint("");
    autoSpeak(term);
    const back = h("button", { class: "ghost-button", type: "button", disabled: i === 0 }, "前へ");
    const next = h("button", { class: "primary", type: "button" }, i === list.length - 1 ? "確認テストへ" : "次へ");
    // 知っている語ばかりなら、残りをめくらずに確認テストへ。下の「次へ」の帯に隠れないよう、見出しの行に置く
    const skip = i < list.length - 1
      ? h("button", { class: "head-skip", type: "button", title: "残りの語を飛ばして確認テストへ" }, "確認テストへ ›")
      : null;
    showPanel(ctx,
      trial && i === 0 ? h("p", { class: "trial-note" }, "3Dで光った所と名前を見て、「次へ」。3語見たら、確認の問題に答えます。") : "",
      h("div", { class: "quiz-head" }, h("span", { class: "facet" }, unit.title), h("span", { class: "count" }, skip ?? "", `${i + 1} / ${list.length}`)),
      termCard(term, { motion: motionPlayer(ctx, term) }),
      h("div", { class: "nav-row" }, back, next),
    );
    next.focus({ preventScroll: true });
    const step = await turnPage(signal, back, next, skip);
    if (step === 0) break;
    i += step;
  }

  viewer.setLabel(null);
  // 確認テストは、選んだ問い方を語ごとに順に回す（初めは位置→名前と名前→位置を交互に）
  const chosen = trial ? (["locate", "point"] as Facet[]).filter((facet) => studies(facet)) : testFacets();
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
  plates.hide();
  ctx.hint("");
  const next = nextLesson(await db.learned.toArray());
  const left = unit.terms.filter((term) => !list.includes(term) && !learnedIds.has(term.id)).length;
  if (trial) {
    showPanel(ctx,
      h("h2", {}, "これで3語を覚え始めました"),
      h("p", { class: "today-count" }, `確認 ${correct} / ${items.length}`),
      h("p", {}, "答えた語は、忘れかけたころに「今日」の復習に出ます。毎日、今日の復習を解くだけで続きます。"),
      h("p", { class: "muted" }, "レッスンは「学ぶ」から。3Dは1本指で回し、2本指でつまんで拡大。部位をタップすると図鑑で開きます。"),
      h("div", { class: "nav-row" },
        h("a", { class: "ghost-button", href: "#/study" }, "学ぶへ"),
        left ? h("a", { class: "primary", href: `#/learn/${unit.id}` }, `続きの${left}語も学ぶ`) : h("a", { class: "primary", href: "#/" }, "今日へ"),
      ),
    );
    return;
  }
  showPanel(ctx,
    h("h2", {}, `「${unit.title}」おわり`),
    h("p", { class: "today-count" }, `確認テスト ${correct} / ${items.length}`),
    h("p", {}, "この語は復習に入りました。復習では ", reviewKinds(unit), " が出ます。"),
    unit.terms.some((term) => term.nerve) && studies("attach") ? h("p", {}, "筋の起始・停止・支配神経・作用は、場所を覚えたころに復習で出ます。") : "",
    unit.terms.some((term) => term.passes) && studies("passage") ? h("p", {}, "孔・溝を通るもの（入るもの）は、場所を覚えたころに復習で出ます。") : "",
    unit.terms.some((term) => term.toward) && studies("relation") ? h("p", {}, "部位どうしの向き（前後・左右・上下）は、場所を覚えたころに復習で出ます。") : "",
    h("p", {}, h("a", { href: "#/review/now" }, "今日の復習へ")),
    h("div", { class: "nav-row" },
      h("a", { class: next ? "ghost-button" : "primary", href: "#/study" }, "学ぶへ"),
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

/** はじめにの短いレッスンの語の数 */
const TRIAL_TERMS = 3;

/**
 * レッスンの始めの画面（1画面で始められる）。系統とまとまり・題・語の数と目安の分、語の一覧、初めの説明の1段落（続きは開く）、
 * 確認テストで覚えること（場所から・日→英・英→日・ぜんぶ。詳細モードでは1つずつも）、「始める」と「確認テストだけ」。
 * rest（途中まで学んだレッスンのまだの語）があれば「続きから」か「はじめから」を選ぶ。学ぶ語と、3Dで1語ずつ見るかを返す
 */
async function startScreen(ctx: AppContext, unit: Unit, rest: Term[] | null): Promise<{ list: Term[]; browse: boolean }> {
  const study = BASIC_FACETS.filter((facet) => studies(facet));
  // このレッスンの語のどれにも出せない問い方（基本の用語の図の「名前→位置」など）は並べない
  const usable = study.filter((facet) => unit.terms.some((term) => facetsFor(term, false, studyFacets()).includes(facet)));
  const beginner = isBeginner();
  const learning = new Set((rest ?? unit.terms).map((term) => term.id));
  let note = "";
  let moreOpen = false;
  return until<{ list: Term[]; browse: boolean }>(ctx.signal, (resolve) => {
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
          class: on ? "segment on" : "segment", type: "button", "data-key": label, "aria-pressed": String(on),
          onClick: async () => {
            note = "";
            await setPreference("lessonFacets", picked);
            render(label);
          },
        }, label);
      };
      const list = rest ?? unit.terms;
      const start = h("button", { class: "primary", type: "button", "data-key": "start" }, rest ? `続きから（残り ${rest.length}語）` : "始める");
      const restart = rest ? h("button", { class: "ghost-button", type: "button" }, `はじめから（${unit.terms.length}語）`) : null;
      const testOnly = h("button", { class: "text-button test-only", type: "button" }, "知っている語なので、確認テストだけ");
      start.addEventListener("click", () => resolve({ list, browse: true }), { once: true });
      restart?.addEventListener("click", () => resolve({ list: unit.terms, browse: true }), { once: true });
      testOnly.addEventListener("click", () => resolve({ list, browse: false }), { once: true });
      const skipped = study.filter((facet) => !chosen.includes(facet));
      const system = systemById.get(unit.system)?.ja ?? "";
      const [firstIntro, ...moreIntro] = unit.intro ?? [];
      const intro = firstIntro && !rest ? h("div", { class: "intro" },
        h("p", {}, noteText(firstIntro)),
        moreIntro.length ? h("details", { class: "intro-more", open: moreOpen, ontoggle: (event: Event) => (moreOpen = (event.currentTarget as HTMLDetailsElement).open) },
          h("summary", {}, "続きを読む"), ...moreIntro.map((text) => h("p", {}, noteText(text)))) : "",
      ) : "";
      showPanel(ctx,
        h("div", { class: "lesson-start" },
          h("p", { class: "lesson-where" }, unit.group ? `${system} › ${unit.group}` : system),
          h("div", { class: "lesson-title" }, h("h2", {}, unit.title),
            h("span", { class: "muted" }, rest ? `${unit.terms.length - rest.length} / ${unit.terms.length}語 学んだ・残り約${lessonMinutes(rest.length)}分` : `${unit.terms.length}語・約${lessonMinutes(unit.terms.length)}分`)),
          h("div", { class: "word-chips" }, ...unit.terms.map((term) => h("span", { class: learning.has(term.id) ? "word-chip" : "word-chip learned" }, term.ja))),
          rest ? h("p", { class: "muted" }, "このレッスンは途中です。✓ の語は学んだ語です。") : "",
          intro,
          h("p", { class: "setting-label" }, "確認テストで覚えること"),
          usable.length > 1 ? h("div", { class: "segments", role: "group", "aria-label": "確認テストで覚えること" },
            preset("場所から", ["locate", "point"]), preset("日→英", ["ja2en"]), preset("英→日", ["en2ja"]), preset("ぜんぶ", usable)) : "",
          // 詳細モードでは、問い方を1つずつ選ぶ欄を開いて使う
          !beginner && usable.length > 1 ? h("details", { class: "facet-more" },
            h("summary", {}, "問い方を1つずつ選ぶ"),
            h("div", { class: "chip-list" }, ...usable.map(chip)),
            h("p", { class: "muted" },
              skipped.length ? `選ばなかった${skipped.map((facet) => `「${facetLabels[facet]}」`).join("")}は、あとで復習に新しい問題として出ます。` : "",
              "問い方そのものを外すときは ", h("a", { href: "#/settings" }, "設定の「学ぶ問い方」"), "で。")) : "",
          usable.length === 1 ? h("p", { class: "muted" }, `${facetLabels[usable[0]]}で確認します。`) : "",
          note ? h("p", { class: "drill-note" }, note) : "",
          testOnly,
        ),
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
