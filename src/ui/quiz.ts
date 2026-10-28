import type { Grade } from "ts-fsrs";
import { checkEnglish, type EnglishResult } from "../answer";
import { autoSpeak, speak } from "../audio";
import { figurePrompt, isDrawn, pins, regionPrompt, termById, terms, type Term } from "../content";
import { db, type Facet, type ReviewEvent } from "../db";
import { h, onKeys, until } from "../dom";
import { dueLabel, Rating, recordReview } from "../fsrs";
import { hitsPin, landmarkAt, nearbyLandmarks, nestedLandmarks, type Vec3 } from "../landmarks";
import { facetLabels, pickChoices, typesEnglish, type QueueItem } from "../study";
import { INSERTION_COLOR, ORIGIN_COLOR } from "../viewer";
import { motionPlayer, sceneFor, type AppContext } from "./context";
import { termCard } from "./term-card";

export type Outcome = EnglishResult | "skip";

const ratingOf: Record<Outcome, Grade> = {
  correct: Rating.Good,
  close: Rating.Hard,
  wrong: Rating.Again,
  skip: Rating.Again,
};

/** 筋の起始・停止・支配神経・作用の問い方で、選択肢に出す文 */
const muscleText: Partial<Record<Facet, (term: Term) => string>> = {
  attach: (term) => `${term.origin} → ${term.insertion}`,
  nerve: (term) => term.nerve ?? "",
  action: (term) => term.action ?? "",
};

const muscleQuestion: Partial<Record<Facet, string>> = {
  attach: "起始 → 停止は？",
  nerve: "支配神経は？",
  action: "おもな作用は？",
};

/** 筋の起始・停止の部位（骨の部位のピンと、Z-Anatomy から作った付着面）を、骨の上に色分けして示す */
export function attachMarks(term: Term): [string, string][] {
  return [
    ...(term.originAt ?? []).map((id) => [id, ORIGIN_COLOR] as [string, string]),
    ...(term.insertionAt ?? []).map((id) => [id, INSERTION_COLOR] as [string, string]),
    [`${term.id}@origin`, ORIGIN_COLOR],
    [`${term.id}@insertion`, INSERTION_COLOR],
  ];
}

/**
 * 4択の候補（3Dで近い語, 全体）。骨・器官の部位は同じ系統の部位どうし、ほかは同じ系統の語どうしで選ぶ。
 * 基本の用語・局所解剖は同じレッスンの語を先に出す。図から名前を答える問題（byFigure）では、図に当てはまらない語（foils）だけを出す
 * （「近位」の矢印は上も向いているので「上」を出さない）。
 * 筋の起始・停止・支配神経・作用（needs あり）は系統をまたいで3Dで近い筋から選ぶ（喉頭・咽頭の筋は呼吸器・消化器にある）。
 * 「環椎」の問題に「頚椎」のような、答えを含む語や答えに含まれる語は出さない（どちらも正しくなる）。
 */
function candidates(ctx: AppContext, term: Term, needs?: (other: Term) => boolean, byFigure = false): [string[], string[]] {
  if (needs && term.passes) {
    // 通るもの: 通るものを書いた語（骨の部位も骨の語も）から、3Dで近い順に
    const pool = terms.filter((other) => other.id !== term.id && needs(other)).map((other) => other.id);
    const center = placeOf(ctx, term.id);
    pool.sort((a, b) => Math.hypot(...placeOf(ctx, a).map((v, k) => v - center[k])) - Math.hypot(...placeOf(ctx, b).map((v, k) => v - center[k])));
    return [pool.slice(0, 8), pool];
  }
  if (isDrawn(term)) {
    if (byFigure && term.foils) return [term.foils, term.foils];
    return [terms.filter((other) => other.unit === term.unit).map((other) => other.id), terms.filter((other) => other.system === term.system).map((other) => other.id)];
  }
  if (term.of) {
    const fits = (other: Term) => !!other.of && !!pins[other.id] && other.system === term.system && !nestedLandmarks(term, other);
    return [nearbyLandmarks(term.id), terms.filter(fits).map((other) => other.id)];
  }
  const own = new Set(ctx.index.terms[term.id].elements);
  const overlaps = (other: Term) => !!ctx.index.terms[other.id]?.elements.some((element) => own.has(element));
  if (needs) {
    const center = ctx.index.terms[term.id].center;
    const distance = (id: string) => Math.hypot(...ctx.index.terms[id].center.map((v, k) => v - center[k]));
    const pool = terms.filter((other) => !other.of && needs(other) && !overlaps(other)).map((other) => other.id);
    pool.sort((a, b) => distance(a) - distance(b));
    return [pool.slice(0, 8), pool];
  }
  const fits = (other: Term) => !other.of && other.system === term.system && !overlaps(other);
  return [
    (ctx.index.neighbors[term.id] ?? []).filter((id) => fits(termById.get(id)!)),
    terms.filter(fits).map((other) => other.id),
  ];
}

/** 語の位置（骨の部位はピンの中心、ほかは部品の中心）。右側（x < 0）にそろえる */
function placeOf(ctx: AppContext, id: string): Vec3 {
  const pin = pins[id];
  const c = pin ? ([0, 1, 2].map((k) => pin.at.reduce((sum, p) => sum + p[k], 0) / pin.at.length) as Vec3) : ((ctx.index.terms[id]?.center ?? [0, 0, 0]) as Vec3);
  return [-Math.abs(c[0]), c[1], c[2]];
}

/** 1問出して、答え合わせと記録まで行う。「次へ」を押したら終わる。 */
export async function ask(ctx: AppContext, item: QueueItem, source: ReviewEvent["source"], progress = ""): Promise<Outcome> {
  const term = termById.get(item.termId)!;
  const { viewer, signal } = ctx;
  const started = performance.now();
  await viewer.show(sceneFor(term.system, term.unit));
  viewer.setLabel(null);
  viewer.highlight([]);

  const choicesOf = (display: (id: string) => string, needs?: (other: Term) => boolean, byFigure = false) =>
    pickChoices(term.id, ...candidates(ctx, term, needs, byFigure), display);
  // 隠れた部位は周りを半透明にして見せる。タップでは答えられないので「名前→位置」は位置当てに替える（基本の用語の図も同じ）。
  // 骨・器官の部位も、骨・器官をはっきり見せるため周りを半透明にする。
  const landmark = !!term.of;
  const isolate = !!term.xray || landmark;
  const facet = item.facet === "point" && (term.xray || isDrawn(term)) ? "locate" : item.facet;
  const header = h("div", { class: "quiz-head" }, h("span", { class: "facet" }, facetLabels[facet]), h("span", { class: "count" }, progress));

  let outcome: Outcome;
  let wrongTerm: string | null = null;
  let tapped: { element: string; point: Vec3 } | null = null;
  let typed = "";

  switch (facet) {
    case "locate": {
      viewer.highlight([term.id], { isolate });
      viewer.focus(term.id, 3.4);
      const question = term.figure ? figurePrompt(term.figure) : term.region ? regionPrompt(term.region) : "オレンジ色の部位の名前は？";
      ctx.hint(question);
      const picked = await chooseOne(ctx, header, question, choicesOf((id) => termById.get(id)!.ja, undefined, true), (id) => termById.get(id)!.ja);
      outcome = picked === term.id ? "correct" : picked ? "wrong" : "skip";
      // 基本の用語の図・局所解剖は1つずつしか描かないので、選んだ語を青で示さない
      wrongTerm = picked && picked !== term.id && !isDrawn(term) ? picked : null;
      break;
    }
    case "point": {
      if (landmark) {
        // 骨・器官の部位は、その骨・器官だけを見せて全体が入る距離から探させる
        viewer.only([term.id]);
        // 前の問題の向きが残ると見にくいので、いつも正面やや右上から
        viewer.focusWhole(term.id, 1.3, true, [-0.35, 0.15, 1]);
        ctx.hint(`${termById.get(term.of!)?.ja ?? "骨"}の上でタップして答える`);
      } else {
        viewer.focus(term.id, 7);
        ctx.hint("3Dの上でタップして答える");
      }
      const tap = await tapElement(ctx, header, term);
      const own = ctx.index.terms[term.id].elements;
      if (landmark) {
        const hit = tap !== null && own.includes(tap.element) && hitsPin(tap.point, pins[term.id]);
        outcome = hit ? "correct" : tap ? "wrong" : "skip";
        if (!hit && tap) {
          // ほかの部位に当たっていればその部位を、どこでもなければタップした点を青で示す
          const others = terms.filter((other) => other.of && other.id !== term.id && ctx.index.terms[other.id]?.elements.includes(tap.element));
          wrongTerm = landmarkAt(tap.point, others)?.id ?? null;
          if (!wrongTerm) tapped = tap;
        }
      } else {
        // 「脳」を問われて小脳をタップしたときのように、より細かい語の部品でも正解にする
        const hit = tap !== null && own.includes(tap.element);
        outcome = hit ? "correct" : tap ? "wrong" : "skip";
        wrongTerm = !hit && tap ? (viewer.termsOf(tap.element)[0] ?? null) : null;
      }
      break;
    }
    case "ja2en": {
      viewer.highlight([term.id], { isolate });
      viewer.focus(term.id, 3.4);
      ctx.hint("");
      const prompt = h("ruby", { class: "prompt-ja" }, term.ja, h("rt", {}, term.yomi));
      if (typesEnglish(await db.schedules.get(`${term.id}:ja2en`))) {
        typed = await typeEnglish(ctx, header, prompt);
        outcome = typed ? checkEnglish(typed, [term.en, ...(term.enAlt ?? [])]) : "skip";
      } else {
        const picked = await chooseOne(ctx, header, prompt, choicesOf((id) => termById.get(id)!.en), (id) => termById.get(id)!.en, "en");
        outcome = picked === term.id ? "correct" : picked ? "wrong" : "skip";
      }
      break;
    }
    case "en2ja": {
      viewer.overview();
      ctx.hint("");
      autoSpeak(term);
      const reveal = h("button", { class: "ghost-button", type: "button", onClick: () => reveal.replaceWith(h("span", { class: "prompt-en", lang: "en" }, term.en)) }, "英語を表示");
      const prompt = h("div", { class: "listen" },
        h("button", { class: "speak big", type: "button", "aria-label": "英語を聞く", onClick: () => void speak(term) }, "🔊"),
        reveal,
      );
      const picked = await chooseOne(ctx, header, prompt, choicesOf((id) => termById.get(id)!.ja), (id) => termById.get(id)!.ja);
      outcome = picked === term.id ? "correct" : picked ? "wrong" : "skip";
      break;
    }
    case "attach":
    case "nerve":
    case "action": {
      // 筋を光らせて、名前と一緒に問う。選択肢は近くの筋の起始・停止（支配神経・作用）
      viewer.highlight([term.id], { isolate });
      viewer.focus(term.id, 3.4);
      ctx.hint("");
      const text = muscleText[facet]!;
      const prompt = h("div", {},
        h("ruby", { class: "prompt-ja" }, term.ja, h("rt", {}, term.yomi)),
        h("p", { class: "prompt" }, muscleQuestion[facet]),
      );
      const picked = await chooseOne(ctx, header, prompt, choicesOf((id) => text(termById.get(id)!), (other) => !!other.nerve), (id) => text(termById.get(id)!), undefined, "long");
      outcome = picked === term.id ? "correct" : picked ? "wrong" : "skip";
      break;
    }
    case "passage": {
      // 孔・溝を光らせて、名前と一緒に問う。選択肢は近くの孔・溝を通るもの
      viewer.highlight([term.id], { isolate });
      viewer.focus(term.id, 3.4);
      ctx.hint("");
      const prompt = h("div", {},
        h("ruby", { class: "prompt-ja" }, term.ja, h("rt", {}, term.yomi)),
        h("p", { class: "prompt" }, "ここを通る（入る）ものは？"),
      );
      const text = (id: string) => termById.get(id)!.passes ?? "";
      const picked = await chooseOne(ctx, header, prompt, choicesOf(text, (other) => !!other.passes), text, undefined, "long");
      outcome = picked === term.id ? "correct" : picked ? "wrong" : "skip";
      break;
    }
    default:
      // 語根カードの問い方は ui/roots.ts の askRoot で出す
      throw new Error(`語の問題ではない問い方: ${facet}`);
  }

  const { schedule, undo } = await recordReview(term.id, facet, ratingOf[outcome], { durationMs: Math.round(performance.now() - started), source });
  if (facet === "attach") viewer.highlight([term.id], { isolate: true, marks: attachMarks(term), seeThrough: true });
  else viewer.reveal(term.id, wrongTerm, isolate, tapped);
  viewer.focus(term.id, 3.4, true, tapped?.point);
  viewer.setLabel(term.id, term.ja);
  ctx.hint("");
  if (facet === "ja2en" || facet === "en2ja") autoSpeak(term);

  const banner = {
    correct: h("div", { class: "result ok" }, "正解"),
    close: h("div", { class: "result close" }, "惜しい（1文字ちがい）", h("span", { class: "typed", lang: "en" }, typed)),
    wrong: h("div", { class: "result ng" }, "不正解", typed ? h("span", { class: "typed", lang: "en" }, typed) : null),
    skip: h("div", { class: "result ng" }, "答えを確認しよう"),
  }[outcome];
  const wrongNote = wrongTerm
    ? h("p", { class: "wrong-note" }, "青い所はあなたが選んだ「", termById.get(wrongTerm)!.ja, "」")
    : tapped
      ? h("p", { class: "wrong-note" }, "青い点はあなたがタップした所")
      : null;
  const next = h("button", { class: "primary", type: "button" }, "次へ");
  // タップや選択肢の押しまちがいは、記録を取り消して同じ問題を解き直せる
  const retry = outcome === "correct" ? null : retryButton();
  showPanel(ctx, header, banner, wrongNote ?? "", termCard(term, { motion: motionPlayer(ctx, term) }),
    h("p", { class: "next-due" }, `次の出題: ${dueLabel(schedule)}`), retry ?? "", next);
  next.focus({ preventScroll: true });
  const again = await until<boolean>(signal, (resolve) => {
    next.addEventListener("click", () => resolve(false), { once: true });
    retry?.addEventListener("click", () => resolve(true), { once: true });
  });
  if (!again) return outcome;
  await undo();
  return ask(ctx, item, source, progress);
}

/** 解き直しを出すときの共通の文言（語根の問題でも使う） */
export function retryButton(): HTMLButtonElement {
  return h("button", { class: "text-button", type: "button" }, "押しまちがえた（取り消して解き直す）");
}

/** 4択を出して、選んだもの（「わからない」なら null）を返す */
export async function chooseOne(
  ctx: AppContext,
  header: HTMLElement,
  prompt: string | HTMLElement,
  choices: string[],
  display: (id: string) => string,
  lang?: string,
  variant = "",
): Promise<string | null> {
  return until(ctx.signal, (resolve) => {
    // PC では数字キー（1〜4）でも選べる。0 は「わからない」
    const stop = onKeys(ctx.signal, (key) => {
      const i = key === "0" ? -1 : Number(key) - 1;
      if (!(i === -1 || (i >= 0 && i < choices.length))) return false;
      done(i === -1 ? null : choices[i]);
      return true;
    });
    const done = (id: string | null) => {
      stop();
      resolve(id);
    };
    const buttons = choices.map((id) => h("button", { class: `choice ${variant}`.trim(), type: "button", lang, onClick: () => done(id) }, display(id)));
    showPanel(ctx,
      header,
      typeof prompt === "string" ? h("p", { class: "prompt" }, prompt) : prompt,
      h("div", { class: "choices" }, ...buttons),
      h("button", { class: "ghost-button", type: "button", onClick: () => done(null) }, "わからない"),
    );
  });
}

async function tapElement(ctx: AppContext, header: HTMLElement, term: Term): Promise<{ element: string; point: Vec3 } | null> {
  const status = h("p", { class: "tap-status" }, "部位をタップしてください（回転・拡大もできます）");
  try {
    return await until<{ element: string; point: Vec3 } | null>(ctx.signal, (resolve) => {
      ctx.viewer.onPick = (element, point) => {
        if (!element || !point) {
          status.textContent = term.of ? `${termById.get(term.of)?.ja ?? "骨"}の上をタップしてください` : "部位の上をタップしてください";
          return;
        }
        resolve({ element, point });
      };
      showPanel(ctx,
        header,
        h("p", { class: "prompt" }, "どこ？"),
        h("ruby", { class: "prompt-ja" }, term.ja, h("rt", {}, term.yomi)),
        status,
        h("button", { class: "ghost-button", type: "button", onClick: () => resolve(null) }, "わからない"),
      );
    });
  } finally {
    ctx.viewer.onPick = null;
  }
}

async function typeEnglish(ctx: AppContext, header: HTMLElement, prompt: HTMLElement): Promise<string> {
  return until(ctx.signal, (resolve) => {
    const input = h("input", {
      // iOS の自動修正（解剖の英語名を普通の単語に直してしまう）も切る
      class: "type-en", type: "text", lang: "en", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: false, enterkeyhint: "done",
      placeholder: "英語でつづりを入力", "aria-label": "英語のつづり",
    });
    const form = h("form", { class: "type-form", onSubmit: (event: Event) => { event.preventDefault(); resolve(input.value); } },
      input, h("button", { class: "primary", type: "submit" }, "答える"));
    showPanel(ctx,
      header,
      h("p", { class: "prompt" }, "英語で書くと？"),
      prompt,
      form,
      h("button", { class: "ghost-button", type: "button", onClick: () => resolve("") }, "わからない"),
    );
    input.focus({ preventScroll: true });
  });
}

/** 問題を差し替えたら先頭から見せる（スマホでは画面全体、PCでは右の欄がスクロールする） */
export function showPanel(ctx: AppContext, ...nodes: (Node | string)[]): void {
  ctx.panel.replaceChildren(...nodes);
  ctx.panel.scrollTop = 0;
  window.scrollTo({ top: 0 });
}
