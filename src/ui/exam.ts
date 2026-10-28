import type { Grade } from "ts-fsrs";
import { checkEnglish } from "../answer";
import { speak } from "../audio";
import { isDrawn, termById } from "../content";
import { db, nowIso, type Facet, type ReviewEvent } from "../db";
import { h, until } from "../dom";
import {
  areaLabels, checkBlank, clozeRating, EXAM_KINDS, examAreas, examByKey, examFacets, examItemsOf, examProgress, essayRating, kindLabels,
  nextExamItems, type ClozeItem, type EssayItem, type ExamArea, type ExamItem, type ExamKind, type WordItem,
} from "../exam";
import { dueLabel, Rating, recordReview, retrievability } from "../fsrs";
import { facetLabels, pickChoices, practiceQueue, shuffle, typesEnglish, type PracticeCandidate, type QueueItem } from "../study";
import { sceneFor, type AppContext } from "./context";
import { chooseOne, retryButton, showPanel, typeEnglish, type Outcome } from "./quiz";
import { termCard } from "./term-card";

/** 1回に新しく学ぶ数と、苦手を解く数 */
const SET_SIZE = 10;
const PRACTICE_SIZE = 20;

const kindNotes: Record<ExamKind, string> = {
  a: "文の空欄に入る語を、日本語・英語・ラテン語のどれかで書く。答えると3Dで場所を示す。",
  b: "ラテン語を見て日本語を選ぶ。覚えてきたら、日本語を見て英語かラテン語のつづりを書く問題も出る。",
  c: "名称を見て説明を考えてから、要点の一覧で言えたものに印を付けて自分で採点する。",
};

/**
 * 骨学試験（#/exam）。arg なしで一覧、"a" で出る順に新しく学ぶ、"a-trunk" でその範囲から、"a-weak" で学んだ項目を苦手な順に解く。
 * 答えは語と同じく FSRS で記録し、学んだ項目は毎日の復習にも出る。
 */
export async function exam(ctx: AppContext, arg: string): Promise<void> {
  const [kind, mode] = arg.split("-") as [ExamKind, string | undefined];
  if (!EXAM_KINDS.includes(kind)) return examIndex(ctx);
  if (mode === "weak") return practice(ctx, kind);
  return learn(ctx, kind, mode && mode in areaLabels ? (mode as ExamArea) : undefined);
}

const percent = (value: number | null) => (value === null ? "" : `・覚え ${Math.round(value * 100)}%`);

async function examIndex(ctx: AppContext): Promise<void> {
  await showTerms(ctx, []);
  ctx.hint("");
  const [learned, schedules] = await Promise.all([db.learned.toArray(), db.schedules.toArray()]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  showPanel(ctx,
    h("h2", {}, "骨学試験"),
    h("p", { class: "muted" }, "過去の骨学の筆記試験に出た点を、出た回数の多い順に解く。文と要点はこのアプリで作り直したもの。答えは毎日の復習にも入る。"),
    ...EXAM_KINDS.map((kind) => {
      const { done, total, mastery } = examProgress(kind, learnedIds, schedules);
      const items = examItemsOf(kind);
      return h("section", { class: "exam-kind" },
        h("h3", {}, kindLabels[kind], h("span", { class: "unit-count" }, ` ${done}/${total}${percent(mastery)}`)),
        h("p", { class: "muted" }, kindNotes[kind]),
        h("div", { class: "nav-row" },
          done < total ? h("a", { class: "primary", href: `#/exam/${kind}` }, `出る順に${SET_SIZE}問`) : "",
          done ? h("a", { class: "ghost-button", href: `#/exam/${kind}-weak` }, "苦手な順に解く") : "",
        ),
        h("div", { class: "chip-list" }, ...examAreas(kind).map((area) => {
          const list = items.filter((item) => item.area === area);
          const count = list.filter((item) => learnedIds.has(item.key)).length;
          return h("a", { class: count === list.length ? "chip on" : "chip", href: `#/exam/${kind}-${area}` }, `${areaLabels[area]} ${count}/${list.length}`);
        })),
      );
    }),
    h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/" }, "ホームへ")),
  );
}

/** まだ学んでいない項目を出る順に解く。解く前に「学んだ」に入れる（途中でやめても、出した項目は復習に出る） */
async function learn(ctx: AppContext, kind: ExamKind, area?: ExamArea): Promise<void> {
  const learned = new Set((await db.learned.toArray()).map((item) => item.termId));
  const items = nextExamItems(kind, learned, SET_SIZE, area);
  if (!items.length) {
    await showTerms(ctx, []);
    showPanel(ctx,
      h("h2", {}, kindLabels[kind]),
      h("p", {}, `${area ? `${areaLabels[area]}の` : ""}項目はすべて学びました。`),
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/exam" }, "骨学試験の一覧"), h("a", { class: "primary", href: `#/exam/${kind}-weak` }, "苦手な順に解く")),
    );
    return;
  }
  const learnedAt = nowIso();
  const results: [ExamItem, Outcome][] = [];
  for (const [i, item] of items.entries()) {
    await db.learned.put({ termId: item.key, unitId: `exam-${kind}`, learnedAt });
    results.push([item, await askExam(ctx, { termId: item.key, facet: examFacets[kind][0], isNew: true }, "lesson", `${i + 1} / ${items.length}`)]);
  }
  void navigator.storage?.persist?.().catch(() => false);
  finish(ctx, kind, `${kindLabels[kind]}${area ? `（${areaLabels[area]}）` : ""}`, results,
    kind === "b" ? "学んだ語は復習に入りました。日本語→英語・ラテン語のつづりの問題も復習で出ます。" : "学んだ項目は復習に入りました。");
}

/** 学んだ項目を苦手な順に（一度は解いたものだけ） */
async function practice(ctx: AppContext, kind: ExamKind): Promise<void> {
  const [learned, schedules] = await Promise.all([db.learned.toArray(), db.schedules.toArray()]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  const scheduleOf = new Map(schedules.map((s) => [s.cardId, s]));
  const candidates: PracticeCandidate[] = examItemsOf(kind)
    .filter((item) => learnedIds.has(item.key))
    .flatMap((item) => examFacets[kind].map((facet) => {
      const schedule = scheduleOf.get(`${item.key}:${facet}`);
      return { termId: item.key, facet, recall: retrievability(schedule), lapses: schedule?.lapses ?? 0 };
    }))
    .filter((c) => c.recall !== null);
  const queue = practiceQueue(candidates, PRACTICE_SIZE, true);
  if (!queue.length) {
    await showTerms(ctx, []);
    showPanel(ctx,
      h("h2", {}, kindLabels[kind]),
      h("p", {}, "まだ解いた項目がありません。"),
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/exam" }, "骨学試験の一覧"), h("a", { class: "primary", href: `#/exam/${kind}` }, `出る順に${SET_SIZE}問`)),
    );
    return;
  }
  const results: [ExamItem, Outcome][] = [];
  for (const [i, item] of queue.entries()) {
    results.push([examByKey.get(item.termId)!, await askExam(ctx, item, "practice", `苦手 ${i + 1} / ${queue.length}`)]);
  }
  finish(ctx, kind, `${kindLabels[kind]}（苦手な順）`, results, "");
}

function finish(ctx: AppContext, kind: ExamKind, title: string, results: [ExamItem, Outcome][], note: string): void {
  const missed = [...new Set(results.filter(([, outcome]) => outcome !== "correct").map(([item]) => item))];
  void showTerms(ctx, missed.flatMap((item) => item.show));
  ctx.viewer.setLabel(null);
  ctx.hint("");
  showPanel(ctx,
    h("h2", {}, `${title} おわり`),
    h("p", { class: "today-count" }, `${results.filter(([, outcome]) => outcome === "correct").length} / ${results.length} 正解`),
    note ? h("p", {}, note) : "",
    missed.length ? h("h3", {}, "まちがえた項目") : "",
    missed.length ? h("ul", { class: "exam-missed" }, ...missed.map((item) => h("li", {}, item.title))) : "",
    h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/exam" }, "骨学試験の一覧"), h("a", { class: "primary", href: `#/exam/${kind}` }, "続ける")),
  );
}

/** 骨学試験の問題を1問出して記録する（復習・演習からも呼ぶ） */
export function askExam(ctx: AppContext, item: QueueItem, source: ReviewEvent["source"], progress = ""): Promise<Outcome> {
  const exam = examByKey.get(item.termId)!;
  if (exam.kind === "a") return askCloze(ctx, exam, source, progress);
  if (exam.kind === "b") return askWord(ctx, exam, item.facet, source, progress);
  return askEssay(ctx, exam, source, progress);
}

function header(exam: ExamItem, facet: Facet, progress: string): HTMLElement {
  return h("div", { class: "quiz-head" },
    h("span", { class: "facet" }, `${facetLabels[facet]}・${areaLabels[exam.area]}`),
    h("span", { class: "count" }, progress),
  );
}

/** 試験に出た回数の一言 */
function countNote(exam: ExamItem): HTMLElement {
  return h("p", { class: "muted exam-count" }, exam.count ? `過去の試験に ${exam.count}回${exam.recent ? "（最近も出た）" : ""}` : "まだ出ていないが、出題の形から出そうな項目");
}

/**
 * 3Dで語を示す。focus の語（無ければ最初の語）だけを光らせて寄り、名前を出す。腸骨・坐骨・恥骨と寛骨臼のように
 * 重なる語を一度に光らせると見分けられないので、1つずつ（ほかは答えの語を押して切り替える）。語が無ければ骨格の全身。
 * 系統は ids の語の分を読んでおく（切り替えのたびに読み直さない）。
 */
async function showTerms(ctx: AppContext, ids: string[], focus?: string): Promise<void> {
  const { viewer } = ctx;
  const known = ids.filter((id) => ctx.index.terms[id] || isDrawn(termById.get(id)));
  const target = termById.get(focus && known.includes(focus) ? focus : known[0]);
  viewer.setLabel(null);
  if (!target) {
    await viewer.show(sceneFor("skeletal"));
    viewer.highlight([]);
    viewer.overview();
    return;
  }
  if (isDrawn(target)) {
    await viewer.show(sceneFor(target.system, target.unit));
    viewer.highlight([target.id]);
  } else {
    const parts = known.filter((id) => !isDrawn(termById.get(id)));
    const systems = [...new Set(["skeletal", ...parts.map((id) => termById.get(id)!.system)])].filter((id) => ctx.index.systems[id]);
    await viewer.show({ systems, body: true });
    viewer.highlight([target.id], { isolate: true });
  }
  viewer.focus(target.id, 3.4);
  viewer.setLabel(target.id, target.ja);
}

/** 答え合わせの画面（正解でなければ解き直し）。「次へ」なら false、解き直しなら true */
async function showResult(ctx: AppContext, outcome: Outcome, nodes: (Node | string)[], due: string): Promise<boolean> {
  const next = h("button", { class: "primary", type: "button" }, "次へ");
  const retry = outcome === "correct" ? null : retryButton();
  showPanel(ctx, ...nodes, h("p", { class: "next-due" }, `次の出題: ${due}`), retry ?? "", next);
  next.focus({ preventScroll: true });
  return until<boolean>(ctx.signal, (resolve) => {
    next.addEventListener("click", () => resolve(false), { once: true });
    retry?.addEventListener("click", () => resolve(true), { once: true });
  });
}

const ratingOf: Record<Outcome, Grade> = { correct: Rating.Good, close: Rating.Hard, wrong: Rating.Again, skip: Rating.Again };

const outcomeOf = (rating: number, skipped: boolean): Outcome =>
  skipped ? "skip" : rating === Rating.Good ? "correct" : rating === Rating.Hard ? "close" : "wrong";

function banner(outcome: Outcome, text?: string): HTMLElement {
  return {
    correct: h("div", { class: "result ok" }, text ?? "正解"),
    close: h("div", { class: "result close" }, text ?? "おおむね正解"),
    wrong: h("div", { class: "result ng" }, text ?? "不正解"),
    skip: h("div", { class: "result ng" }, "答えを確認しよう"),
  }[outcome];
}

/** 穴埋めの文。blank で空欄の所に置くものを作る */
function clozeText(exam: ClozeItem, blank: (i: number) => Node): (Node | string)[] {
  return exam.parts.map((part) => (typeof part === "number" ? blank(part) : part));
}

/** A 穴埋め: 空欄ごとに入力。答えると空欄の語を3Dで示し、答えを押すとその語へ寄る */
async function askCloze(ctx: AppContext, exam: ClozeItem, source: ReviewEvent["source"], progress: string): Promise<Outcome> {
  const started = performance.now();
  await showTerms(ctx, []);
  ctx.hint("");
  const head = header(exam, "cloze", progress);
  const inputs = exam.blanks.map((_, i) => h("input", {
    class: "type-en cloze-input", type: "text", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: false,
    enterkeyhint: i === exam.blanks.length - 1 ? "done" : "next", "aria-label": `空欄 ${i + 1}`,
  }));
  const typed = await until<string[] | null>(ctx.signal, (resolve) => {
    const submit = () => resolve(inputs.map((input) => input.value));
    inputs.forEach((input, i) => input.addEventListener("keydown", (event) => {
      // 日本語入力の変換を決める Enter（Safari では isComposing が false で keyCode 229 になる）では進まない
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (i < inputs.length - 1) inputs[i + 1].focus();
      else submit();
    }));
    showPanel(ctx, head,
      h("p", { class: "prompt" }, "空欄に入る語は？"),
      h("p", { class: "cloze" }, ...clozeText(exam, (i) => h("span", { class: "blank" }, `（${i + 1}）`))),
      h("div", { class: "cloze-inputs" }, ...inputs.map((input, i) => h("label", { class: "cloze-row" }, h("span", { class: "cloze-no" }, String(i + 1)), input))),
      h("p", { class: "muted" }, "日本語・英語・ラテン語のどれでもよい。漢字が出なければ読み（ひらがな）でも正解にする。"),
      h("div", { class: "nav-row" },
        h("button", { class: "ghost-button", type: "button", onClick: () => resolve(null) }, "わからない"),
        h("button", { class: "primary", type: "button", onClick: submit }, "答える"),
      ),
    );
    inputs[0].focus({ preventScroll: true });
  });
  const results = exam.blanks.map((blank, i) => (typed ? checkBlank(typed[i], blank.answers) : "wrong"));
  const rating = typed ? clozeRating(results) : Rating.Again;
  const outcome = outcomeOf(rating, !typed);
  const { schedule, undo } = await recordReview(exam.key, "cloze", rating, { durationMs: Math.round(performance.now() - started), source });
  await showTerms(ctx, exam.show);
  const correct = results.filter((result) => result !== "wrong").length;
  const answer = (i: number) => {
    const blank = exam.blanks[i];
    const mine = typed?.[i].trim();
    return h("span", { class: `blank-answer ${results[i]}` },
      blank.term
        ? h("button", { class: "gloss", type: "button", onClick: () => void showTerms(ctx, exam.show, blank.term) }, blank.display)
        : blank.display,
      results[i] !== "correct" && mine ? h("s", { class: "typed-ja" }, mine) : "",
    );
  };
  const again = await showResult(ctx, outcome, [
    head,
    banner(outcome, outcome === "skip" ? undefined : `${correct} / ${exam.blanks.length}`),
    h("p", { class: "cloze" }, ...clozeText(exam, answer)),
    exam.blanks.some((blank) => blank.term) ? h("p", { class: "muted" }, "下線の語を押すと、3Dでその場所を示す。") : "",
    countNote(exam),
  ], dueLabel(schedule));
  if (!again) return outcome;
  await undo();
  return askCloze(ctx, exam, source, progress);
}

/** B の語の中身（骨の語なら語のカード、総論の語ならその説明） */
function wordCard(exam: WordItem): HTMLElement {
  const term = exam.term ? termById.get(exam.term) : undefined;
  if (term) return termCard(term);
  return h("article", { class: "term-card" },
    h("div", { class: "term-head" },
      h("ruby", { class: "term-ja" }, exam.ja, h("rt", {}, exam.yomi)),
      h("span", { class: "term-system" }, areaLabels[exam.area]),
    ),
    h("div", { class: "term-en" },
      h("button", { class: "speak", type: "button", "aria-label": "英語の発音を聞く", onClick: () => void speak({ id: exam.key, en: exam.en }) }, "🔊"),
      h("span", { lang: "en" }, exam.en),
      exam.la && exam.la.toLowerCase() !== exam.en.toLowerCase() ? h("span", { class: "term-la", lang: "la" }, `（ラ）${exam.la}`) : null,
    ),
    h("dl", { class: "term-notes" }, h("div", {}, h("dt", {}, "説明"), h("dd", {}, exam.note))),
  );
}

/** B 用語: read＝ラテン語（無ければ英語）を見て日本語の4択、spell＝日本語を見て英語・ラテン語（覚えてきたらつづりの入力） */
async function askWord(ctx: AppContext, exam: WordItem, facet: Facet, source: ReviewEvent["source"], progress: string): Promise<Outcome> {
  const started = performance.now();
  await showTerms(ctx, []);
  ctx.hint("");
  const head = header(exam, facet, progress);
  const words = examItemsOf("b") as WordItem[];
  const word = (key: string) => examByKey.get(key) as WordItem;
  const near = shuffle(words.filter((other) => other.area === exam.area && other.key !== exam.key)).map((other) => other.key);
  const pool = words.map((other) => other.key);
  const foreign = (key: string) => {
    const { en, la } = word(key);
    return la && la.toLowerCase() !== en.toLowerCase() ? `${en} / ${la}` : en;
  };
  let picked: string | null = null;
  let typed = "";
  let outcome: Outcome;
  if (facet === "read") {
    const prompt = h("div", {}, h("p", { class: "prompt" }, "日本語では？"), h("p", { class: "prompt-en exam-foreign", lang: "la" }, exam.la ?? exam.en));
    picked = await chooseOne(ctx, head, prompt, pickChoices(exam.key, near, pool, (key) => word(key).ja), (key) => word(key).ja);
    outcome = picked === exam.key ? "correct" : picked ? "wrong" : "skip";
  } else {
    const prompt = h("ruby", { class: "prompt-ja" }, exam.ja, h("rt", {}, exam.yomi));
    if (typesEnglish(await db.schedules.get(`${exam.key}:spell`))) {
      typed = await typeEnglish(ctx, head, prompt, "英語かラテン語で書くと？", "英語かラテン語でつづりを入力");
      outcome = typed ? checkEnglish(typed, [exam.en, ...exam.enAlt, ...(exam.la ? [exam.la] : [])]) : "skip";
    } else {
      picked = await chooseOne(ctx, head, prompt, pickChoices(exam.key, near, pool, foreign), foreign, "en");
      outcome = picked === exam.key ? "correct" : picked ? "wrong" : "skip";
    }
  }
  const rating = ratingOf[outcome];
  const { schedule, undo } = await recordReview(exam.key, facet, rating, { durationMs: Math.round(performance.now() - started), source });
  void showTerms(ctx, exam.show);
  const wrong = picked && picked !== exam.key ? word(picked) : null;
  const again = await showResult(ctx, outcome, [
    head,
    outcome === "close"
      ? h("div", { class: "result close" }, "惜しい（1文字ちがい）", h("span", { class: "typed", lang: "en" }, typed))
      : outcome === "wrong" && typed ? h("div", { class: "result ng" }, "不正解", h("span", { class: "typed", lang: "en" }, typed)) : banner(outcome),
    wrong ? h("p", { class: "wrong-note" }, `あなたが選んだのは「${wrong.ja}」（${foreign(wrong.key)}）`) : "",
    wordCard(exam),
    countNote(exam),
  ], dueLabel(schedule));
  if (!again) return outcome;
  await undo();
  return askWord(ctx, exam, facet, source, progress);
}

/** C 短文記述: 説明を考えてから要点を開き、言えた要点に印を付けて自分で採点する */
async function askEssay(ctx: AppContext, exam: EssayItem, source: ReviewEvent["source"], progress: string): Promise<Outcome> {
  const started = performance.now();
  await showTerms(ctx, []);
  ctx.hint("");
  const head = header(exam, "explain", progress);
  const title = () => (exam.yomi ? h("ruby", { class: "prompt-ja" }, exam.title, h("rt", {}, exam.yomi)) : h("p", { class: "prompt-ja" }, exam.title));
  const ready = await until<boolean>(ctx.signal, (resolve) => {
    const open = h("button", { class: "primary", type: "button", onClick: () => resolve(true) }, "要点を見る");
    showPanel(ctx, head,
      h("p", { class: "prompt" }, "この名称について説明しよう"),
      title(),
      h("p", { class: "muted" }, `要点は${exam.points.length}つ。頭の中か紙に2〜3文で書いてから開く。`),
      h("div", { class: "nav-row" }, h("button", { class: "ghost-button", type: "button", onClick: () => resolve(false) }, "わからない"), open),
    );
    open.focus({ preventScroll: true });
  });
  void showTerms(ctx, exam.show);
  const boxes = exam.points.map(() => h("input", { type: "checkbox" }));
  if (ready) {
    await until<void>(ctx.signal, (resolve) => showPanel(ctx, head,
      title(),
      h("p", { class: "prompt" }, "言えた要点に印を付ける"),
      h("ul", { class: "points" }, ...exam.points.map((point, i) => h("li", {}, h("label", {}, boxes[i], h("span", {}, point))))),
      h("button", { class: "primary", type: "button", onClick: () => resolve() }, "採点する"),
    ));
  }
  const checked = boxes.filter((box) => box.checked).length;
  const rating = ready ? essayRating(checked, exam.points.length) : Rating.Again;
  const outcome = outcomeOf(rating, !ready);
  const { schedule, undo } = await recordReview(exam.key, "explain", rating, { durationMs: Math.round(performance.now() - started), source });
  const term = exam.term ? termById.get(exam.term) : undefined;
  const again = await showResult(ctx, outcome, [
    head,
    banner(outcome, `要点 ${checked} / ${exam.points.length}`),
    term ? "" : title(),
    h("ul", { class: "points done" }, ...exam.points.map((point, i) => h("li", { class: boxes[i].checked ? "said" : "" }, point))),
    term ? termCard(term, { compact: true }) : "",
    countNote(exam),
  ], dueLabel(schedule));
  if (!again) return outcome;
  await undo();
  return askEssay(ctx, exam, source, progress);
}
