import { speak } from "../audio";
import { systemById, type Term } from "../content";
import { db, markLearned, type ReviewEvent } from "../db";
import { h, onKeys, until } from "../dom";
import {
  buildTiles, etymByKey, etymGroups, etymKey, etymLessonById, etymLessons, etymOfTerm, etymUnitId, etymWords, isBuilt, jaSegments, readChoices,
  relatedWords, wordSegments, type EtymLesson, type EtymWord,
} from "../etym";
import { dueLabel, Rating, recordReview } from "../fsrs";
import { facetLabels, shuffle, type QueueItem } from "../study";
import { LEAVE_LESSON, sceneFor, type AppContext } from "./context";
import { turnPage } from "./lesson";
import { plateOverlay } from "./plate-view";
import { answeredChoices, chooseOne, retryButton, showPanel, waitResult, type Outcome } from "./quiz";

/** 部品の色（styles.css の --etym-0〜3。4つより多ければくり返す） */
const tone = (i: number) => `--p:var(--etym-${i % 4})`;

/** 英語名がラテン語の名前（hypophysis・appendix vermiformis など）か */
function isLatin(word: EtymWord): boolean {
  const text = word.word.toLowerCase();
  const english = [word.term.en, ...(word.term.enAlt ?? [])].some((name) => name.toLowerCase().includes(text));
  return !english && !!word.term.la?.toLowerCase().includes(text);
}

/** 英語名を鳴らす。語の英語名そのままなら録音を、ほかの形（ラテン語・短くした名前）は読み上げで */
function sayWord(word: EtymWord): void {
  void speak(word.word.toLowerCase() === word.term.en.toLowerCase() ? word.term : { id: "", en: word.word });
}

/**
 * 英語名を部品ごとに分けて見せる。色を付け、続いた部品の間には点を打つ（sterno·cleido·mastoid）。
 * mark を渡すと、そのつづりの部品だけを太字にする（同じ部品の語の一覧）
 */
function englishWord(word: EtymWord, options: { colored?: boolean; mark?: Set<string> } = {}): HTMLElement {
  const { colored = true, mark } = options;
  const nodes: (Node | string)[] = [];
  const segments = wordSegments(word);
  segments.forEach((segment, i) => {
    if (segment.part === null) {
      nodes.push(segment.text);
      return;
    }
    if (i > 0 && segments[i - 1].part !== null) nodes.push(h("span", { class: "etym-dot", "aria-hidden": "true" }, "·"));
    const marked = mark?.has(segment.text.toLowerCase());
    nodes.push(mark
      ? (marked ? h("b", {}, segment.text) : segment.text)
      : h("span", { class: colored ? "etym-seg" : "etym-seg plain", style: colored ? tone(segment.part) : null }, segment.text));
  });
  return h("span", { class: "etym-en", lang: isLatin(word) ? "la" : "en" }, ...nodes);
}

/** 日本語名。部品にあたる字に、その部品の色を付ける */
function japaneseName(word: EtymWord, className = "term-ja etym-ja"): HTMLElement {
  return h("span", { class: className }, ...jaSegments(word.term.ja, word.parts).map((segment) => segment.part === null
    ? segment.text
    : h("span", { class: "etym-k", style: tone(segment.part) }, segment.text)));
}

/**
 * 語源で単語の中身: 日本語名（部品の字に色）・英語名（部品ごとに色）・部品の表（つづり・意味・由来・日本語名の字）・覚え方・同じ部品の語。
 * open を渡すと（一覧）、同じ部品の語を押してその語を開ける
 */
export function etymCard(word: EtymWord, options: { open?: (other: EtymWord) => void } = {}): HTMLElement {
  const term = word.term;
  const latin = isLatin(word);
  const head = h("div", { class: "term-head" },
    h("div", { class: "term-name" },
      h("span", { class: "term-kicker" }, term.yomi, "・", systemById.get(term.system)?.ja ?? ""),
      japaneseName(word)));
  const english = h("div", { class: "term-en etym-word" },
    h("button", { class: "speak", type: "button", "aria-label": "英語の発音を聞く", onClick: () => sayWord(word) }, "🔊"),
    latin ? h("span", { class: "term-la" }, "（ラ）") : "",
    englishWord(word));
  // 部品に分けた名前が語の英語名と違うとき（ラテン語・短くした名前）は、英語名も添える
  const also = word.word.toLowerCase() !== term.en.toLowerCase()
    ? h("p", { class: "etym-also" }, "英語名 ", h("span", { lang: "en" }, term.en))
    : "";
  const parts = h("ol", { class: "etym-parts" }, ...word.parts.map((part, i) => h("li", { class: "etym-part", style: tone(i) },
    h("b", { class: "etym-part-text", lang: latin ? "la" : "en" }, part.text),
    h("span", { class: "etym-part-body" },
      h("span", { class: "etym-part-meaning" }, part.meaning),
      part.from ? h("span", { class: "etym-part-from" }, part.from) : ""),
    part.kanji ? h("span", { class: "etym-part-kanji", title: "日本語名の中の字" }, part.kanji) : "",
  )));
  const others = relatedWords(word).slice(0, 5);
  const mine = new Set(word.parts.map((part) => part.text.toLowerCase()));
  const related = others.length ? h("div", { class: "etym-related" },
    h("p", { class: "etym-related-title" }, "同じ部品の語"),
    h("ul", {}, ...others.map((other) => {
      const body = [h("span", { class: "etym-related-ja" }, other.term.ja), englishWord(other, { mark: mine })];
      return h("li", {}, options.open
        ? h("button", { class: "etym-related-item", type: "button", onClick: () => options.open!(other) }, ...body)
        : h("span", { class: "etym-related-item" }, ...body));
    }))) : "";
  return h("article", { class: "term-card etym-card" },
    head, english, also, parts,
    h("p", { class: "etym-note" }, word.note),
    related);
}

/** 語を3Dで光らせる（平面図の語は3Dの上に図を重ねる）。reveal が false なら光らせず全身だけ（部品から読む問題の間は答えになるので） */
async function showWord(ctx: AppContext, term: Term, reveal = true): Promise<void> {
  const plates = plateOverlay(ctx);
  await ctx.viewer.show(sceneFor(term.system, term.unit));
  if (ctx.signal.aborted) return;
  ctx.viewer.setLabel(null);
  if (!reveal) {
    plates.hide();
    ctx.viewer.highlight([]);
    ctx.viewer.overview();
    return;
  }
  ctx.viewer.highlight([term.id], { isolate: !term.figure });
  ctx.viewer.focus(term.id, 3.2);
  ctx.viewer.setLabel(term.id, term.ja);
  if (term.plate || term.seePlate) void plates.show(term, { names: true, mark: true });
  else plates.hide();
}

/** #/etym の中身: "" は一覧、"word/<語ID>" は一覧でその語を開く、ほかはレッスンID */
export function etymScreen(ctx: AppContext, arg: string): Promise<void> {
  if (!arg) return etymIndex(ctx);
  if (arg.startsWith("word/")) return etymIndex(ctx, etymKey(decodeURIComponent(arg.slice("word/".length))));
  return etymLesson(ctx, arg);
}

/** 学んだ語の数（レッスンの中で） */
const doneIn = (lesson: EtymLesson, learned: Set<string>) => lesson.words.filter((word) => learned.has(word.key)).length;

/** 学んでいない語の残っている最初のレッスン */
function nextEtymLesson(learned: Set<string>): EtymLesson | undefined {
  return etymLessons.find((lesson) => doneIn(lesson, learned) < lesson.words.length);
}

/** 見本: 胸鎖乳突筋 ＝ sterno＋cleido＋mastoid（一覧のいちばん上） */
function sample(): HTMLElement {
  const word = etymOfTerm("sternocleidomastoid") ?? etymWords[0];
  return h("div", { class: "etym-sample", "aria-label": `${word.term.ja}は ${word.parts.map((part) => `${part.text}（${part.meaning}）`).join("・")}` },
    japaneseName(word, "etym-sample-ja"),
    h("span", { class: "etym-sample-eq", "aria-hidden": "true" }, "＝"),
    h("span", { class: "etym-sample-parts", "aria-hidden": "true" }, ...word.parts.map((part, i) => h("span", { class: "etym-sample-part", style: tone(i) },
      h("b", { lang: "en" }, part.text), h("small", {}, part.meaning)))));
}

/**
 * 語源で単語の一覧（#/etym）。見本・学んだ数・次のレッスン、3つの部（読み方の型・筋と関節・臓器と血管と神経）ごとのレッスン。
 * focus（語の記録のキー）があれば、その語を開いておく（復習でまちがえた語・語のカードから。#/etym/word/<語ID>）
 */
export async function etymIndex(ctx: AppContext, focus = ""): Promise<void> {
  // 一覧が主なので、スマホでは3Dをたたんで帯だけ残す（語を開くと3Dでその語が光る）
  ctx.fold("3Dで見る：開いた語");
  ctx.viewer.setLabel(null);
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.hint("");
  const learned = new Set((await db.learned.toArray()).map((item) => item.termId));
  const words = etymWords.filter((word) => learned.has(word.key)).length;
  const lessonsDone = etymLessons.filter((lesson) => doneIn(lesson, learned) === lesson.words.length).length;
  const next = nextEtymLesson(learned);
  const detail = h("div", { class: "etym-detail", hidden: true });
  const open = (word: EtymWord) => {
    detail.hidden = false;
    const lesson = etymLessonById.get(word.lesson)!;
    detail.replaceChildren(
      etymCard(word, { open }),
      h("div", { class: "nav-row" },
        h("a", { class: "ghost-button", href: `#/explore/${word.term.id}` }, "図鑑で見る"),
        h("a", { class: "ghost-button", href: `#/etym/${lesson.id}` }, `「${lesson.title}」へ`)),
      h("button", { class: "text-button", type: "button", onClick: () => { detail.hidden = true; ctx.viewer.highlight([]); ctx.viewer.setLabel(null); ctx.viewer.overview(); } }, "閉じる"),
    );
    void showWord(ctx, word.term);
    detail.scrollIntoView({ block: "nearest" });
  };
  let n = 0;
  ctx.panel.replaceChildren(h("div", { class: "home etym-home" },
    h("div", { class: "tab-head" }, h("h2", {}, "語源で単語")),
    h("section", { class: "home-card etym-hero" },
      h("p", { class: "home-kicker" }, "名前を部品に分けて読む"),
      sample(),
      h("p", { class: "home-note" }, "英語・ラテン語の名前は意味のある部品の組み合わせで、部品の意味は日本語名の字とほとんど対応しています。部品が分かると、初めて見る名前も読めます。"),
      h("p", { class: "etym-count" }, `学んだ語 ${words} / ${etymWords.length}・終えたレッスン ${lessonsDone} / ${etymLessons.length}`),
      next ? h("a", { class: "home-primary", href: `#/etym/${next.id}` },
        h("span", { class: "home-primary-text" },
          h("span", { class: "home-primary-title" }, doneIn(next, learned) ? `続ける：${next.title}` : words ? `次に学ぶ：${next.title}` : `始める：${next.title}`),
          h("span", { class: "home-primary-sub" }, `${next.words.length}語・部品から読む確認テストつき`))) : h("p", { class: "home-note" }, "すべてのレッスンを終えました。部品から読む・部品で組み立てる問題が、毎日の復習に出ます。"),
    ),
    detail,
    ...etymGroups.flatMap((group) => [
      h("h3", { class: "list-title" }, group.title),
      h("ul", { class: "home-card home-list etym-lessons" }, ...group.lessons.map((lesson) => {
        n++;
        const done = doneIn(lesson, learned);
        const mark = h("span", { class: done === lesson.words.length ? "home-item-icon etym-number done" : "home-item-icon etym-number", "aria-hidden": "true" },
          done === lesson.words.length ? "✓" : String(n));
        return h("li", {}, h("a", { class: "home-item", href: `#/etym/${lesson.id}` },
          mark,
          h("span", { class: "home-item-text" },
            h("span", { class: "home-item-title" }, lesson.title),
            h("span", { class: "home-item-sub" }, lesson.words.slice(0, 4).map((word) => word.term.ja).join("・"), lesson.words.length > 4 ? " ほか" : "")),
          h("span", { class: "home-item-meta" }, `${done} / ${lesson.words.length}`)));
      })),
    ]),
    h("p", { class: "etym-roots-link" }, "部品そのもの（brachi-「腕」など）を1つずつ覚えるなら ", h("a", { href: "#/roots" }, "語根カード"), "。"),
  ));
  const focused = etymByKey.get(focus);
  if (focused) open(focused);
}

/**
 * 語源で単語のレッスン（#/etym/<レッスンID>）: 始めの画面（読み方の型と語の一覧）→ 1語ずつ見る → 確認テスト（部品から読む）→ 復習に入る。
 * 記録は learned に "etym:<語ID>"（unitId は etym-<レッスンID>）
 */
export async function etymLesson(ctx: AppContext, lessonId: string): Promise<void> {
  const lesson = etymLessonById.get(lessonId);
  if (!lesson) {
    ctx.panel.replaceChildren(h("p", {}, "レッスンが見つかりません。"), h("a", { href: "#/etym" }, "語源で単語の一覧へ"));
    return;
  }
  const group = etymGroups.find((item) => item.id === lesson.group)!;
  const learned = new Set((await db.learned.bulkGet(lesson.words.map((word) => word.key))).flatMap((item) => (item ? [item.termId] : [])));
  ctx.viewer.setLabel(null);
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.hint(lesson.title);

  // 始めの画面: 読み方の型（lead）と、このレッスンの語
  const start = h("button", { class: "primary", type: "button" }, learned.size === lesson.words.length ? "もう一度見る" : "始める");
  showPanel(ctx,
    h("div", { class: "quiz-head" }, h("span", { class: "facet" }, group.title), h("span", { class: "count" }, `${lesson.words.length}語`)),
    h("h2", {}, lesson.title),
    h("p", { class: "etym-lead" }, lesson.lead),
    h("ol", { class: "etym-word-list" }, ...lesson.words.map((word) => h("li", { class: learned.has(word.key) ? "done" : "" },
      h("span", { class: "etym-word-list-ja" }, word.term.ja), englishWord(word, { colored: false })))),
    h("p", { class: "muted" }, "1語ずつ、部品・意味・日本語名の字の対応を見てから、英語名から日本語名を選ぶ確認テストに答えます。"),
    start,
  );
  start.focus({ preventScroll: true });
  await until<void>(ctx.signal, (resolve) => start.addEventListener("click", () => resolve(), { once: true }));

  ctx.guard(LEAVE_LESSON);
  for (let i = 0; i < lesson.words.length; ) {
    const word = lesson.words[i];
    void showWord(ctx, word.term);
    ctx.hint("");
    const back = h("button", { class: "ghost-button", type: "button", disabled: i === 0 }, "前へ");
    const next = h("button", { class: "primary", type: "button" }, i === lesson.words.length - 1 ? "確認テストへ" : "次へ");
    const skip = i < lesson.words.length - 1
      ? h("button", { class: "head-skip", type: "button", title: "残りの語を飛ばして確認テストへ" }, "確認テストへ ›")
      : null;
    showPanel(ctx,
      h("div", { class: "quiz-head" }, h("span", { class: "facet" }, lesson.title), h("span", { class: "count" }, skip ?? "", `${i + 1} / ${lesson.words.length}`)),
      etymCard(word),
      h("div", { class: "nav-row" }, back, next),
    );
    next.focus({ preventScroll: true });
    const step = await turnPage(ctx.signal, back, next, skip);
    if (step === 0) break;
    i += step;
  }

  let correct = 0;
  const items = shuffle(lesson.words).map((word) => ({ termId: word.key, facet: "etymRead" as const, isNew: true }));
  for (const [i, item] of items.entries()) {
    if ((await askEtym(ctx, item, "lesson", `確認 ${i + 1} / ${items.length}`)) === "correct") correct++;
  }
  await markLearned(lesson.words.map((word) => ({ termId: word.key, unitId: etymUnitId(lesson) })));
  ctx.guard(null);
  void navigator.storage?.persist?.().catch(() => false);
  ctx.hint("");
  plateOverlay(ctx).hide();
  ctx.viewer.setLabel(null);
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  const following = etymLessons[etymLessons.indexOf(lesson) + 1];
  showPanel(ctx,
    h("h2", {}, `「${lesson.title}」おわり`),
    h("p", { class: "today-count" }, `確認テスト ${correct} / ${items.length}`),
    h("p", {}, "語は復習に入りました。部品が2つ以上の語は、日本語名から部品を順に選ぶ「部品で組み立てる」問題も復習で出ます。"),
    h("div", { class: "nav-row" },
      h("a", { class: "ghost-button", href: "#/etym" }, "語源で単語の一覧"),
      following ? h("a", { class: "primary", href: `#/etym/${following.id}` }, "次のレッスンへ") : h("a", { class: "primary", href: "#/review" }, "復習する")),
  );
}

/** 語源で単語の問題を1問出して記録する。etymRead＝英語名（部品に分けて）を見て日本語名、etymBuild＝日本語名を見て部品を順に選ぶ */
export async function askEtym(ctx: AppContext, item: QueueItem, source: ReviewEvent["source"], progress = ""): Promise<Outcome> {
  const word = etymByKey.get(item.termId)!;
  const started = performance.now();
  const build = item.facet === "etymBuild";
  ctx.hint("");
  const header = h("div", { class: "quiz-head" }, h("span", { class: "facet" }, facetLabels[item.facet]), h("span", { class: "count" }, progress));
  // 部品から読む問題の間は3Dで光らせない（場所で答えが分かるので）。組み立てる問題は日本語名を見せるので光らせてよい
  void showWord(ctx, word.term, build);

  let outcome: Outcome;
  let answer: HTMLElement | string = "";
  if (build) {
    const picked = await buildWord(ctx, header, word);
    outcome = picked === null ? "skip" : isBuilt(word, picked) ? "correct" : "wrong";
    if (outcome !== "correct") {
      answer = h("dl", { class: "etym-built" },
        picked?.length ? h("div", { class: "is-picked" }, h("dt", {}, "あなたの答え"), h("dd", { lang: "en" }, picked.join(" · "))) : "",
        h("div", { class: "is-answer" }, h("dt", {}, "正解"), h("dd", {}, englishWord(word))));
    }
  } else {
    const choices = readChoices(word);
    const display = (key: string) => etymByKey.get(key)?.term.ja ?? key;
    const prompt = h("div", {},
      h("p", { class: "prompt" }, "部品の意味から読むと、日本語名は？"),
      h("p", { class: "etym-prompt-word" }, isLatin(word) ? h("span", { class: "term-la" }, "（ラ）") : "", englishWord(word, { colored: false })));
    const picked = await chooseOne(ctx, header, prompt, choices, display);
    outcome = picked === item.termId ? "correct" : picked ? "wrong" : "skip";
    if (outcome !== "correct") answer = answeredChoices(choices, display, item.termId, picked, { aside: (key) => etymByKey.get(key)?.word ?? "" });
  }
  const recorded = await recordReview(item.termId, item.facet, outcome === "correct" ? Rating.Good : Rating.Again,
    { durationMs: Math.round(performance.now() - started), source });
  void showWord(ctx, word.term);
  const next = h("button", { class: "primary", type: "button" }, "次へ");
  const retry = outcome === "correct" ? null : retryButton();
  showPanel(ctx, header,
    outcome === "correct" ? h("div", { class: "result ok", role: "status" }, "正解") : h("div", { class: "result ng", role: "status" }, outcome === "skip" ? "答えを確認しよう" : "不正解"),
    answer,
    etymCard(word),
    h("p", { class: "next-due" }, `次の出題: ${dueLabel(recorded.schedule)}`),
    retry ?? "",
    next,
  );
  const again = await waitResult(ctx, next, retry, outcome === "correct", recorded);
  if (!again) return outcome;
  await recorded.undo();
  return askEtym(ctx, item, source, progress);
}

/**
 * 組み立てる問題: 日本語名を見て、部品を英語名の順に押す。部品の数だけ選ぶと答え合わせ（「わからない」なら null）。
 * 選んだ部品を押すと外せる。PC では数字キーで部品を選び、Backspace で1つ戻す、0 で「わからない」
 */
function buildWord(ctx: AppContext, header: HTMLElement, word: EtymWord): Promise<string[] | null> {
  const tiles = buildTiles(word);
  const picked: number[] = [];
  return until(ctx.signal, (resolve) => {
    const slots = h("div", { class: "etym-slots", "aria-live": "polite" });
    const bank = h("div", { class: "etym-tiles" });
    const undo = h("button", { class: "ghost-button", type: "button", disabled: true }, "1つ戻す");
    const done = (value: string[] | null) => {
      stop();
      resolve(value);
    };
    const render = () => {
      slots.replaceChildren(...word.parts.map((_, i) => {
        const tile = picked[i];
        return tile === undefined
          ? h("span", { class: i === picked.length ? "etym-slot next" : "etym-slot" }, String(i + 1))
          : h("button", { class: "etym-slot filled", type: "button", lang: "en", "aria-label": `${tiles[tile]}（押すと外す）`, onClick: () => { picked.splice(i); render(); } }, tiles[tile]);
      }));
      bank.replaceChildren(...tiles.map((text, i) => h("button", {
        class: "etym-tile", type: "button", lang: "en", disabled: picked.includes(i),
        onClick: () => choose(i),
      }, h("span", { class: "etym-tile-key", "aria-hidden": "true" }, String(i + 1)), text)));
      undo.disabled = !picked.length;
    };
    const choose = (i: number) => {
      if (picked.includes(i) || i < 0 || i >= tiles.length) return;
      picked.push(i);
      if (picked.length === word.parts.length) done(picked.map((index) => tiles[index]));
      else render();
    };
    undo.addEventListener("click", () => { picked.pop(); render(); });
    const stop = onKeys(ctx.signal, (key) => {
      if (key === "0") done(null);
      else if (key === "Backspace" && picked.length) { picked.pop(); render(); }
      else if (/^[1-9]$/.test(key) && Number(key) <= tiles.length) choose(Number(key) - 1);
      else return false;
      return true;
    });
    render();
    showPanel(ctx,
      header,
      h("p", { class: "prompt" }, "部品を英語名の順に選ぶと？"),
      h("p", { class: "prompt-ja etym-prompt-ja" }, word.term.ja),
      h("p", { class: "muted" }, `部品 ${word.parts.length}つ。日本語名の字から、部品の意味を思い出す`),
      slots,
      bank,
      h("div", { class: "nav-row" }, undo, h("button", { class: "ghost-button", type: "button", onClick: () => done(null) }, "わからない")),
    );
  });
}
