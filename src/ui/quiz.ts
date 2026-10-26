import type { Grade } from "ts-fsrs";
import { checkEnglish, type EnglishResult } from "../answer";
import { speak } from "../audio";
import { pins, termById, terms, type Term } from "../content";
import { db, type Facet, type ReviewEvent } from "../db";
import { h, until } from "../dom";
import { dueLabel, Rating, recordReview } from "../fsrs";
import { hitsPin, landmarkAt, nearbyLandmarks, type Vec3 } from "../landmarks";
import { facetLabels, pickChoices, typesEnglish, type QueueItem } from "../study";
import { INSERTION_COLOR, ORIGIN_COLOR } from "../viewer";
import { sceneFor, type AppContext } from "./context";
import { termCard } from "./term-card";

type Outcome = EnglishResult | "skip";

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
 * 筋の起始・停止・支配神経・作用（needs あり）は系統をまたいで3Dで近い筋から選ぶ（喉頭・咽頭の筋は呼吸器・消化器にある）。
 * 「環椎」の問題に「頚椎」のような、答えを含む語や答えに含まれる語は出さない（どちらも正しくなる）。
 */
function candidates(ctx: AppContext, term: Term, needs?: (other: Term) => boolean): [string[], string[]] {
  if (term.of) {
    return [nearbyLandmarks(term.id), terms.filter((other) => other.of && pins[other.id] && other.system === term.system).map((other) => other.id)];
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

/** 1問出して、答え合わせと記録まで行う。「次へ」を押したら終わる。 */
export async function ask(ctx: AppContext, item: QueueItem, source: ReviewEvent["source"], progress = ""): Promise<Outcome> {
  const term = termById.get(item.termId)!;
  const { viewer, signal } = ctx;
  const started = performance.now();
  await viewer.show(sceneFor(term.system));
  viewer.setLabel(null);
  viewer.highlight([]);

  const choicesOf = (display: (id: string) => string, needs?: (other: Term) => boolean) =>
    pickChoices(term.id, ...candidates(ctx, term, needs), display);
  // 隠れた部位は周りを半透明にして見せる。タップでは答えられないので「名前→位置」は位置当てに替える。
  // 骨・器官の部位も、骨・器官をはっきり見せるため周りを半透明にする。
  const landmark = !!term.of;
  const isolate = !!term.xray || landmark;
  const facet = item.facet === "point" && term.xray ? "locate" : item.facet;
  const header = h("div", { class: "quiz-head" }, h("span", { class: "facet" }, facetLabels[facet]), h("span", { class: "count" }, progress));

  let outcome: Outcome;
  let wrongTerm: string | null = null;
  let tapped: { element: string; point: Vec3 } | null = null;
  let typed = "";

  switch (facet) {
    case "locate": {
      viewer.highlight([term.id], { isolate });
      viewer.focus(term.id, 3.4);
      ctx.hint("オレンジ色の部位の名前は？");
      const picked = await chooseOne(ctx, header, "オレンジ色の部位の名前は？", choicesOf((id) => termById.get(id)!.ja), (id) => termById.get(id)!.ja);
      outcome = picked === term.id ? "correct" : picked ? "wrong" : "skip";
      wrongTerm = picked && picked !== term.id ? picked : null;
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
      void speak(term);
      const reveal = h("button", { class: "ghost-button", type: "button", onClick: () => reveal.replaceWith(h("span", { class: "prompt-en", lang: "en" }, term.en)) }, "英語を表示");
      const prompt = h("div", { class: "listen" },
        h("button", { class: "speak big", type: "button", "aria-label": "もう一度聞く", onClick: () => void speak(term) }, "🔊"),
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
  }

  const schedule = await recordReview(term.id, facet, ratingOf[outcome], { durationMs: Math.round(performance.now() - started), source });
  if (facet === "attach") viewer.highlight([term.id], { isolate: true, marks: attachMarks(term), seeThrough: true });
  else viewer.reveal(term.id, wrongTerm, isolate, tapped);
  viewer.focus(term.id, 3.4, true, tapped?.point);
  viewer.setLabel(term.id, term.ja);
  ctx.hint("");
  if (facet === "ja2en" || facet === "en2ja") void speak(term);

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
  showPanel(ctx, header, banner, wrongNote ?? "", termCard(term), h("p", { class: "next-due" }, `次の出題: ${dueLabel(schedule)}`), next);
  next.focus({ preventScroll: true });
  await until(signal, (resolve) => next.addEventListener("click", () => resolve(undefined), { once: true }));
  return outcome;
}

async function chooseOne(
  ctx: AppContext,
  header: HTMLElement,
  prompt: string | HTMLElement,
  choices: string[],
  display: (id: string) => string,
  lang?: string,
  variant = "",
): Promise<string | null> {
  return until(ctx.signal, (resolve) => {
    const buttons = choices.map((id) => h("button", { class: `choice ${variant}`.trim(), type: "button", lang, onClick: () => resolve(id) }, display(id)));
    showPanel(ctx,
      header,
      typeof prompt === "string" ? h("p", { class: "prompt" }, prompt) : prompt,
      h("div", { class: "choices" }, ...buttons),
      h("button", { class: "ghost-button", type: "button", onClick: () => resolve(null) }, "わからない"),
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
      class: "type-en", type: "text", lang: "en", autocomplete: "off", autocapitalize: "off", spellcheck: false,
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
