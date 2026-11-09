import type { Grade } from "ts-fsrs";
import { checkEnglish, type EnglishResult } from "../answer";
import { autoSpeak, speak } from "../audio";
import { BODY_DIRECTIONS, DIRECTIONS, figurePrompt, isDrawn, pins, regionPrompt, termById, terms, type Term } from "../content";
import { inCourse, isBeginner } from "../course";
import { db, type Facet, type ReviewEvent } from "../db";
import { h, onKeys, until } from "../dom";
import { dueLabel, Rating, recordReview, type RecordedReview } from "../fsrs";
import { hitsPin, landmarkAt, nearbyLandmarks, nestedLandmarks, type Vec3 } from "../landmarks";
import { facetLabels, pickChoices, typesEnglish, type QueueItem } from "../study";
import { preferences } from "../settings";
import { INSERTION_COLOR, ORIGIN_COLOR } from "../viewer";
import { motionPlayer, sceneFor, type AppContext } from "./context";
import { plateOverlay } from "./plate-view";
import { termCard } from "./term-card";
import { noteText } from "../en-notes";

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

/** 起始・停止・神経・作用・通るものの選択肢が、どの語のものか（まちがえた選択肢に添える） */
const ownerOf = (id: string) => `「${termById.get(id)!.ja}」のもの`;

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

/**
 * 初心者モードでは、選択肢を初心者コースの語から選ぶ（まだ習わない細かい名前を並べない）。
 * コースの語だけでは3つそろわなければ、今までどおりすべての語から
 */
function preferCourse(answerId: string, [near, pool]: [string[], string[]]): [string[], string[]] {
  if (!isBeginner()) return [near, pool];
  const own = pool.filter((id) => id !== answerId && inCourse(id));
  return own.length >= 3 ? [near.filter(inCourse), own] : [near, pool];
}

/** 語の位置（骨の部位はピンの中心、ほかは部品の中心）。右側（x < 0）にそろえる */
function placeOf(ctx: AppContext, id: string): Vec3 {
  const pin = pins[id];
  const c = pin ? ([0, 1, 2].map((k) => pin.at.reduce((sum, p) => sum + p[k], 0) / pin.at.length) as Vec3) : ((ctx.index.terms[id]?.center ?? [0, 0, 0]) as Vec3);
  return [-Math.abs(c[0]), c[1], c[2]];
}

/** 向きの問い方で比べる2つの位置。臓器・血管などは比べた場所 at（その高さの断面の中心など）、骨の部位はピンか部品の中心 */
function relationPlaces(ctx: AppContext, term: Term): [Vec3, Vec3] {
  return term.toward!.at ?? [placeOf(ctx, term.id), placeOf(ctx, term.toward!.than)];
}

/**
 * 向きの問い方の場面。臓器・血管などの組は、2つの語の系統を読み込む（食道と気管、尺骨神経と上腕骨の内側上顆のように系統がまたがる）。
 * 臓器の場面（箱で切る）にはしない
 */
function relationScene(term: Term) {
  const systems = [...new Set([term.system, termById.get(term.toward!.than)!.system])];
  return { systems, context: systems.includes("skeletal") ? [] : ["skeletal"], body: true };
}

/** 向きの問い方で見せる骨（その語と比べる語の骨。橈骨と尺骨のように語が骨そのものなら、その骨）。臓器・血管などはその2つ */
function relationBones(term: Term): string[] {
  const other = termById.get(term.toward!.than)!;
  return [...new Set([term.of ?? term.id, other.of ?? other.id])];
}

/**
 * 向きの答え合わせでカメラを置く向き。答えの向き（上下なら y）と直角に見て、2つの部位の並びが画面の上で見えるようにする。
 * 部位の面の向き（ピン）からその軸の成分を除いた向き。横の成分が残らなければ（真上・真下は見にくい）、前後の答えは右の横から、ほかは前から
 */
function relationFrom(term: Term): Vec3 {
  const { than, dir } = term.toward!;
  const axis = dir === "superior" || dir === "inferior" ? 1 : dir === "anterior" || dir === "posterior" ? 2 : 0;
  const pin = pins[term.id] ?? pins[than];
  const v = [...(pin?.cam ?? pin?.n ?? pin?.v ?? [0, 0, 0])] as Vec3;
  v[axis] = 0;
  if (Math.hypot(v[0], v[2]) < 0.3) return axis === 2 ? [-1, 0.15, 0] : [0, 0.15, 1];
  return [v[0], Math.max(-0.5, Math.min(0.5, v[1])), v[2]];
}

/** 向きの問い方の答え（「大腿骨頭は大転子の内側」とそのわけ）。色は答え合わせの3Dと同じ（この語が橙、比べた語が青） */
export function relationAnswer(term: Term): HTMLElement {
  const { than, dir, why } = term.toward!;
  return h("div", { class: "relation-answer" },
    h("p", {}, h("b", { class: "relation-this" }, term.ja), "は", h("b", { class: "relation-than" }, termById.get(than)!.ja), "の", h("b", {}, termById.get(dir)!.ja)),
    h("p", { class: "muted" }, noteText(why)),
  );
}

/** 1問出して、答え合わせと記録まで行う。「次へ」を押したら終わる。 */
export async function ask(ctx: AppContext, item: QueueItem, source: ReviewEvent["source"], progress = ""): Promise<Outcome> {
  const term = termById.get(item.termId)!;
  const { viewer } = ctx;
  const started = performance.now();
  await viewer.show(item.facet === "relation" && term.toward?.at ? relationScene(term) : sceneFor(term.system, term.unit));
  viewer.setLabel(null);
  viewer.highlight([]);

  const choicesOf = (display: (id: string) => string, needs?: (other: Term) => boolean, byFigure = false) =>
    pickChoices(term.id, ...preferCourse(term.id, candidates(ctx, term, needs, byFigure)), display);
  // 隠れた部位は周りを半透明にして見せる。タップでは答えられないので「名前→位置」は位置当てに替える（基本の用語の図も同じ）。
  // 骨・器官の部位も、骨・器官をはっきり見せるため周りを半透明にする。
  const landmark = !!term.of;
  const isolate = !!term.xray || landmark;
  const facet = item.facet === "point" && (term.xray || isDrawn(term)) ? "locate" : item.facet;
  const header = h("div", { class: "quiz-head" }, h("span", { class: "facet" }, facetLabels[facet]), h("span", { class: "count" }, progress));
  // 平面図の語は3Dの上に図を重ね、答えるまで名前を隠す（英語→日本語のほかは、その語の番号を光らせる）
  const plates = plateOverlay(ctx);
  if (term.plate) await plates.show(term, { names: false, mark: facet !== "en2ja" });
  else plates.hide();
  // 向きの目印は、基本の用語（矢印の向き・面）と向きの問い方では答えになるので、答えるまで隠す（平面図を重ねている間も隠す）
  viewer.hideCompass(term.system === "basics" || facet === "relation" || !!term.plate);

  let outcome: Outcome;
  let wrongTerm: string | null = null;
  // 4択で答えた問題は、まちがえたときの答え合わせで選択肢を残す（answeredChoices）
  let asked = null as { choices: string[]; display: (id: string) => string; picked: string | null; lang?: string; variant?: string; aside?: (id: string) => string } | null;
  const choose = async (prompt: string | HTMLElement, choices: string[], display: (id: string) => string, lang?: string, variant?: string, aside?: (id: string) => string) => {
    const picked = await chooseOne(ctx, header, prompt, choices, display, lang, variant);
    asked = { choices, display, picked, lang, variant, aside };
    return picked;
  };
  let tapped: { element: string; point: Vec3 } | null = null;
  let typed = "";

  switch (facet) {
    case "locate": {
      viewer.highlight([term.id], { isolate });
      viewer.focus(term.id, 3.4);
      const question = term.figure ? figurePrompt(term.figure) : term.region ? regionPrompt(term.region) : term.plate ? "図のオレンジ色の番号の名前は？" : "オレンジ色の部位の名前は？";
      ctx.hint(question);
      const picked = await choose(question, choicesOf((id) => termById.get(id)!.ja, undefined, true), (id) => termById.get(id)!.ja);
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
        const picked = await choose(prompt, choicesOf((id) => termById.get(id)!.en), (id) => termById.get(id)!.en, "en", "", (id) => termById.get(id)!.ja);
        outcome = picked === term.id ? "correct" : picked ? "wrong" : "skip";
        wrongTerm = picked && picked !== term.id && !isDrawn(term) ? picked : null;
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
      const picked = await choose(prompt, choicesOf((id) => termById.get(id)!.ja), (id) => termById.get(id)!.ja, undefined, "", (id) => termById.get(id)!.en);
      outcome = picked === term.id ? "correct" : picked ? "wrong" : "skip";
      wrongTerm = picked && picked !== term.id && !isDrawn(term) ? picked : null;
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
      const picked = await choose(prompt, choicesOf((id) => text(termById.get(id)!), (other) => !!other.nerve), (id) => text(termById.get(id)!), undefined, "long", ownerOf);
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
      const text = (id: string) => noteText(termById.get(id)!.passes ?? "");
      const picked = await choose(prompt, choicesOf(text, (other) => !!other.passes), text, undefined, "long", ownerOf);
      outcome = picked === term.id ? "correct" : picked ? "wrong" : "skip";
      break;
    }
    case "hormone": {
      // ホルモンから器官を答える。器官を光らせると答えになるので、全体を見せて答えたあとに示す。選択肢はホルモンを出すほかの器官
      viewer.highlight([]);
      viewer.overview();
      ctx.hint("");
      const prompt = h("div", {},
        h("p", { class: "prompt-text" }, term.hormones!),
        h("p", { class: "prompt" }, "を出すのは？"),
      );
      const picked = await choose(prompt, choicesOf((id) => termById.get(id)!.ja, (other) => !!other.hormones), (id) => termById.get(id)!.ja);
      outcome = picked === term.id ? "correct" : picked ? "wrong" : "skip";
      // 選んだ器官は、同じ系統（3Dに読み込んである）なら青で示す
      wrongTerm = picked && picked !== term.id && termById.get(picked)!.system === term.system ? picked : null;
      break;
    }
    case "relation": {
      // 部位（骨）どうしの向き。骨だけを見せ、部位は光らせずに、解剖学的正位での向きを思い出して答える。
      // 臓器・血管・神経・筋の組はその2つだけを見せ、比べる場所に寄る。選択肢に右・左を足す（1つしかない器官は右・左、左右に1つずつあるものは内側・外側）
      const other = termById.get(term.toward!.than)!;
      const body = !!term.toward!.at;
      viewer.only(relationBones(term));
      if (body) viewer.focusPair(...relationPlaces(ctx, term), relationFrom(term));
      else viewer.focusWhole(term.of ?? term.id, 1.3, true, relationFrom(term));
      ctx.hint(body ? "解剖学的正位で、本人から見た右・左で考える" : "解剖学的正位（手のひらが前）で考える");
      const prompt = h("div", {},
        h("ruby", { class: "prompt-ja" }, term.ja, h("rt", {}, term.yomi)),
        h("p", { class: "prompt" }, "は「", other.ja, "」の どちら側？"),
      );
      const picked = await choose(prompt, body ? BODY_DIRECTIONS : DIRECTIONS, (id) => termById.get(id)!.ja, undefined, "direction");
      outcome = picked === term.toward!.dir ? "correct" : picked ? "wrong" : "skip";
      break;
    }
    default:
      // 語根カードの問い方は ui/roots.ts の askRoot で出す
      throw new Error(`語の問題ではない問い方: ${facet}`);
  }

  const recorded = await recordReview(term.id, facet, ratingOf[outcome], { durationMs: Math.round(performance.now() - started), source });
  viewer.hideCompass(!!term.plate);
  if (term.plate) void plates.show(term, { names: true, mark: true });
  if (facet === "attach") viewer.highlight([term.id], { isolate: true, marks: attachMarks(term), seeThrough: true });
  // 向き: この語を橙、比べた語を青で示し、両方が入るように寄る
  else if (facet === "relation") viewer.reveal(term.id, term.toward!.than, true);
  else viewer.reveal(term.id, wrongTerm, isolate, tapped);
  if (facet === "relation") viewer.focusPair(...relationPlaces(ctx, term), relationFrom(term));
  else viewer.focus(term.id, 3.4, true, tapped?.point);
  viewer.setLabel(term.id, term.ja);
  ctx.hint("");
  if (facet === "ja2en" || facet === "en2ja") autoSpeak(term);

  const banner = {
    correct: h("div", { class: "result ok", role: "status" }, "正解"),
    close: h("div", { class: "result close", role: "status" }, "惜しい（1文字ちがい）", h("span", { class: "typed", lang: "en" }, typed)),
    wrong: h("div", { class: "result ng", role: "status" }, "不正解", typed ? h("span", { class: "typed", lang: "en" }, typed) : null),
    skip: h("div", { class: "result ng", role: "status" }, "答えを確認しよう"),
  }[outcome];
  const relationNote = facet === "relation" ? relationAnswer(term) : null;
  // 4択でまちがえたら、選択肢を残して正解と選んだものを並べる（3Dで青く光らせた語には、その色も添える）
  const review = asked && outcome !== "correct"
    ? answeredChoices(asked.choices, asked.display, facet === "relation" ? term.toward!.dir : term.id, asked.picked,
      { lang: asked.lang, variant: asked.variant, aside: asked.aside, colored: !!wrongTerm && wrongTerm === asked.picked })
    : null;
  const wrongNote = review ? null : wrongTerm
    ? h("p", { class: "wrong-note" }, "青い所はあなたが選んだ「", termById.get(wrongTerm)!.ja, "」")
    : tapped
      ? h("p", { class: "wrong-note" }, "青い点はあなたがタップした所")
      : null;
  const next = h("button", { class: "primary", type: "button" }, "次へ");
  // タップや選択肢の押しまちがいは、記録を取り消して同じ問題を解き直せる
  const retry = outcome === "correct" ? null : retryButton();
  // 正解なら語のカードは名前だけにして（「くわしく」で全部）、すぐ次へ進めるようにする
  const card = outcome === "correct" ? moreCard(term, () => termCard(term, { motion: motionPlayer(ctx, term) })) : termCard(term, { motion: motionPlayer(ctx, term) });
  showPanel(ctx, header, banner, review ?? "", relationNote ?? wrongNote ?? "", card,
    h("p", { class: "next-due" }, `次の出題: ${dueLabel(recorded.schedule)}`), retry ?? "", next);
  const again = await waitResult(ctx, next, retry, outcome === "correct", recorded);
  if (!again) return outcome;
  await recorded.undo();
  return ask(ctx, item, source, progress);
}

/**
 * 答え合わせの画面で「次へ」か解き直しを待つ（語・語根・骨学試験で共通）。解き直しなら true。
 * キーボードでは Enter・→ で次へ、Backspace で解き直し（ボタンにフォーカスが無くても）。
 * 正解なら「自信がなかった」（キーは H）で判定を Hard に付け直し、次の出題を早める（recorded を渡したとき）。
 * 設定の「正解したら自動で次へ」がオンなら、正解のとき1.5秒で次へ進む（画面に触れたりキーを押したりしたら止める）。
 */
export function waitResult(ctx: AppContext, next: HTMLButtonElement, retry: HTMLButtonElement | null, correct: boolean, recorded?: RecordedReview): Promise<boolean> {
  next.focus({ preventScroll: true });
  const unsure = correct && recorded ? unsureButton(ctx, recorded) : null;
  if (unsure) next.before(unsure.button);
  return until<boolean>(ctx.signal, (resolve) => {
    let timer = 0;
    const done = (again: boolean) => {
      window.clearTimeout(timer);
      stop();
      resolve(again);
    };
    const stop = onKeys(ctx.signal, (key) => {
      if (key === "Enter" || key === "ArrowRight") done(false);
      else if (key === "Backspace" && retry) done(true);
      else if ((key === "h" || key === "H") && unsure) unsure.toggle();
      else return false;
      return true;
    });
    next.addEventListener("click", () => done(false), { once: true });
    retry?.addEventListener("click", () => done(true), { once: true });
    if (correct && preferences.autoNext) {
      const note = h("p", { class: "auto-next" }, "1.5秒で次へ進みます（画面に触れると止まります）");
      next.before(note);
      const cancel = () => {
        window.clearTimeout(timer);
        note.remove();
      };
      timer = window.setTimeout(() => done(false), 1500);
      // 3Dを回したり説明を読もうとしたりしたら止める
      document.addEventListener("pointerdown", cancel, { once: true, signal: ctx.signal });
      document.addEventListener("keydown", cancel, { once: true, signal: ctx.signal });
    }
  });
}

/**
 * 正解したけれど当てずっぽうだった・思い出すのに時間がかかったとき。判定を Hard に付け直し、次の出題を書きかえる。
 * もう一度押すと元（Good）に戻す
 */
function unsureButton(ctx: AppContext, recorded: RecordedReview): { button: HTMLButtonElement; toggle: () => void } {
  const original = recorded.rating;
  let unsure = false;
  let busy = false;
  const button = h("button", { class: "text-button unsure", type: "button", "aria-pressed": "false" }, "自信がなかった（早めにもう一度出す）");
  const toggle = async () => {
    if (busy) return;
    busy = true;
    unsure = !unsure;
    const schedule = await recorded.regrade(unsure ? Rating.Hard : original);
    busy = false;
    button.textContent = unsure ? "自信なしにしました（押すと元に戻す）" : "自信がなかった（早めにもう一度出す）";
    button.setAttribute("aria-pressed", String(unsure));
    const due = ctx.panel.querySelector(".next-due");
    if (due) due.textContent = `次の出題: ${dueLabel(schedule)}`;
  };
  button.addEventListener("click", () => void toggle());
  return { button, toggle: () => void toggle() };
}

/** 正解のときの短い語のカード。「くわしく」で全部のカードに替える */
function moreCard(term: Term, full: () => HTMLElement): HTMLElement {
  const box = h("div", {}, termCard(term, { compact: true }));
  box.append(h("button", { class: "text-button more", type: "button", onClick: () => box.replaceChildren(full()) }, "くわしく（説明・語源を見る）"));
  return box;
}

/** 解き直しを出すときの共通の文言（語根の問題でも使う） */
export function retryButton(): HTMLButtonElement {
  return h("button", { class: "text-button", type: "button" }, "押しまちがえた（取り消して解き直す）");
}

/**
 * まちがえたとき（「わからない」も）の答え合わせで、4択を残して正解に ✓、選んだものに ✕ を付ける。何とまちがえたかが分かるように。
 * aside は選んだ選択肢に添える一言（英語の選択肢なら日本語名など）。colored なら3Dの色（正解＝橙、選んだ語＝青）を添える
 */
export function answeredChoices(
  choices: string[],
  display: (id: string) => string,
  answer: string,
  picked: string | null,
  { lang, variant = "", aside, colored = false }: { lang?: string; variant?: string; aside?: (id: string) => string; colored?: boolean } = {},
): HTMLElement {
  return h("ul", { class: "answered" }, ...choices.map((id) => {
    const state = id === answer ? "is-answer" : id === picked ? "is-picked" : "";
    return h("li", { class: `answered-choice ${variant} ${state}`.trim() },
      h("span", { class: "answered-mark", "aria-hidden": "true" }, state === "is-answer" ? "✓" : state === "is-picked" ? "✕" : ""),
      h("span", { class: "answered-text", lang }, display(id)),
      state === "is-answer" ? h("span", { class: "answered-tag" }, colored ? "正解・3Dの橙" : "正解") : "",
      state === "is-picked" ? h("span", { class: "answered-tag" }, colored ? "あなたの答え・3Dの青" : "あなたの答え") : "",
      state === "is-picked" && aside ? h("span", { class: "answered-aside" }, aside(id)) : "",
    );
  }));
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
  let stopKeys = () => {};
  try {
    return await until<{ element: string; point: Vec3 } | null>(ctx.signal, (resolve) => {
      // キーボードでは 0 で「わからない」（ほかの問題の数字キーと同じ）
      stopKeys = onKeys(ctx.signal, (key) => {
        if (key !== "0") return false;
        resolve(null);
        return true;
      });
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
    stopKeys();
  }
}

/** つづりを入力させる（骨学試験の用語では英語かラテン語） */
export async function typeEnglish(ctx: AppContext, header: HTMLElement, prompt: HTMLElement, question = "英語で書くと？", placeholder = "英語でつづりを入力"): Promise<string> {
  return until(ctx.signal, (resolve) => {
    const input = h("input", {
      // iOS の自動修正（解剖の英語名を普通の単語に直してしまう）も切る
      class: "type-en", type: "text", lang: "en", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: false, enterkeyhint: "done",
      placeholder, "aria-label": "英語のつづり",
    });
    // 日本語入力の変換を決める Enter（Safari では isComposing が false で keyCode 229 になる）では答えにしない
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.isComposing || event.keyCode === 229)) event.preventDefault();
    });
    const form = h("form", { class: "type-form", onSubmit: (event: Event) => { event.preventDefault(); resolve(input.value); } },
      input, h("button", { class: "primary", type: "submit" }, "答える"));
    showPanel(ctx,
      header,
      h("p", { class: "prompt" }, question),
      prompt,
      form,
      h("button", { class: "ghost-button", type: "button", onClick: () => resolve("") }, "わからない"),
    );
    input.focus({ preventScroll: true });
  });
}

/** 問題を差し替えたら先頭から見せる（スマホでは画面全体、PCでは右の欄がスクロールする） */
export function showPanel(ctx: AppContext, ...nodes: (Node | string)[]): void {
  // 最後の主ボタン（「次へ」「始める」など）は、下に留める帯に入れる。帯は不透明なので、スクロールした説明が透けて重ならない。
  // 「自信がなかった」「1.5秒で次へ」（waitResult）もボタンの前に足すので、帯の中に入る
  while (nodes.at(-1) === "") nodes.pop();
  const last = nodes.at(-1);
  if (last instanceof HTMLElement && last.classList.contains("primary")) nodes[nodes.length - 1] = h("div", { class: "panel-foot" }, last);
  ctx.panel.replaceChildren(...nodes);
  ctx.panel.scrollTop = 0;
  window.scrollTo({ top: 0 });
}
