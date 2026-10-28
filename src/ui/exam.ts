import type { Grade } from "ts-fsrs";
import { checkEnglish } from "../answer";
import { speak } from "../audio";
import { isDrawn, termById } from "../content";
import { db, nowIso, type Facet, type ReviewEvent } from "../db";
import { h, until } from "../dom";
import type { EnglishResult } from "../answer";
import {
  annotateRating, areaLabels, checkBlank, clozeRating, directionLabels, EXAM_KINDS, examAreas, examByKey, examFacetsOf, examItemsOf, examProgress,
  essayRating, faceLabels, kindLabels, labelRating, markAnswers, nextExamItems, orientQuestion, perpendicularDirections, plainJa, viewFrom,
  type ClozeItem, type DrawingItem, type DrawingMarkItem, type DrawingView, type EssayItem, type ExamArea, type ExamItem, type ExamKind, type WordItem,
} from "../exam";
import type { Vec3 } from "../landmarks";
import { dueLabel, Rating, recordReview, retrievability } from "../fsrs";
import { facetLabels, pickChoices, practiceQueue, shuffle, typesEnglish, type PracticeCandidate, type QueueItem } from "../study";
import { sceneFor, type AppContext } from "./context";
import { chooseOne, retryButton, showPanel, typeEnglish, type Outcome } from "./quiz";
import { termCard } from "./term-card";

/** 1回に新しく学ぶ数（D は図1枚が重いので少なく）と、苦手を解く数 */
const SET_SIZE: Record<ExamKind, number> = { a: 10, b: 10, c: 10, d: 3 };
const PRACTICE_SIZE = 20;
/** D の番号→名前で、1回に答える番号の数（多い図はこの数だけ選んで出す） */
const LABEL_MAX = 8;

const kindNotes: Record<ExamKind, string> = {
  a: "文の空欄に入る語を、日本語・英語・ラテン語のどれかで書く。答えると3Dで場所を示す。",
  b: "ラテン語を見て日本語を選ぶ。覚えてきたら、日本語を見て英語かラテン語のつづりを書く問題も出る。",
  c: "名称を見て説明を考えてから、要点の一覧で言えたものに印を付けて自分で採点する。",
  d: "骨を試験の向きで出す。番号の部位を日本語と英語で書く。覚えたら、紙に図を写して名前を書き込み、番号付きの図と見比べる。左右と向きを当てる問題も出る。",
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
          done < total ? h("a", { class: "primary", href: `#/exam/${kind}` }, `出る順に${SET_SIZE[kind]}${kind === "d" ? "図" : "問"}`) : "",
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
  const items = nextExamItems(kind, learned, SET_SIZE[kind], area);
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
    if (item.kind === "d") await studyDrawing(ctx, item, `${i + 1} / ${items.length}`);
    results.push([item, await askExam(ctx, { termId: item.key, facet: examFacetsOf(item)[0], isNew: true }, "lesson", `${i + 1} / ${items.length}`)]);
  }
  void navigator.storage?.persist?.().catch(() => false);
  finish(ctx, `${kindLabels[kind]}${area ? `（${areaLabels[area]}）` : ""}`, `${kind}${area ? `-${area}` : ""}`, results,
    kind === "b" ? "学んだ語は復習に入りました。日本語→英語・ラテン語のつづりの問題も復習で出ます。"
      : kind === "d" ? "学んだ図は復習に入りました。左右と向きの問題と、名前を覚えたら図に書き込む問題も復習で出ます。" : "学んだ項目は復習に入りました。");
}

/** 学んだ項目を苦手な順に（一度は解いたものだけ） */
async function practice(ctx: AppContext, kind: ExamKind): Promise<void> {
  const [learned, schedules] = await Promise.all([db.learned.toArray(), db.schedules.toArray()]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  const scheduleOf = new Map(schedules.map((s) => [s.cardId, s]));
  const candidates: PracticeCandidate[] = examItemsOf(kind)
    .filter((item) => learnedIds.has(item.key))
    .flatMap((item) => examFacetsOf(item, true).map((facet) => {
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
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/exam" }, "骨学試験の一覧"), h("a", { class: "primary", href: `#/exam/${kind}` }, "出る順に解く")),
    );
    return;
  }
  const results: [ExamItem, Outcome][] = [];
  for (const [i, item] of queue.entries()) {
    results.push([examByKey.get(item.termId)!, await askExam(ctx, item, "practice", `苦手 ${i + 1} / ${queue.length}`)]);
  }
  finish(ctx, `${kindLabels[kind]}（苦手な順）`, kind, results, "");
}

/** 「続ける」。今と同じアドレスへのリンクでは画面が変わらないので、そのときは読み直す */
function continueLink(next: string): HTMLElement {
  const href = `#/exam/${next}`;
  return h("a", {
    class: "primary", href, onClick: (event: Event) => {
      if (location.hash !== href) return;
      event.preventDefault();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    },
  }, "続ける");
}

/** next は「続ける」の行き先（範囲を選んで学んでいたら同じ範囲） */
function finish(ctx: AppContext, title: string, next: string, results: [ExamItem, Outcome][], note: string): void {
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
    h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/exam" }, "骨学試験の一覧"), continueLink(next)),
  );
}

/** 骨学試験の問題を1問出して記録する（復習・演習からも呼ぶ） */
export function askExam(ctx: AppContext, item: QueueItem, source: ReviewEvent["source"], progress = ""): Promise<Outcome> {
  const exam = examByKey.get(item.termId)!;
  if (exam.kind === "a") return askCloze(ctx, exam, source, progress);
  if (exam.kind === "b") return askWord(ctx, exam, item.facet, source, progress);
  if (exam.kind === "d") {
    if (item.facet === "annotate") return askAnnotate(ctx, exam, source, progress);
    if (item.facet === "orient") return askOrient(ctx, exam, source, progress);
    return askLabel(ctx, exam, source, progress);
  }
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
  viewer.setDrawing(null);
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

/** 図の番号の点（骨の語の中心は models/index.json から） */
function markPoint(ctx: AppContext, mark: DrawingMarkItem): Vec3 {
  return mark.at ?? ctx.index.terms[mark.term!].center;
}

/**
 * D の図を3Dに出す。marks の部位に 1 から番号を付ける（無ければ番号なし）。side・view・roll は「骨と向き」の問題で、
 * 左の骨を見せる・別の面から見せる・画面の上を回すときに使う。
 */
async function showDrawing(ctx: AppContext, item: DrawingItem, options: { marks?: DrawingMarkItem[]; side?: "right" | "left"; view?: DrawingView; roll?: number } = {}): Promise<void> {
  const { viewer } = ctx;
  viewer.setLabel(null);
  viewer.setDrawing(null);
  await viewer.show({ systems: ["skeletal"] });
  viewer.highlight([]);
  const side = options.side ?? "right";
  const from = viewFrom(options.view ?? item.view, side);
  const marks = (options.marks ?? []).map((mark, i) => ({ text: String(i + 1), at: markPoint(ctx, mark), n: mark.n, project: mark.project }));
  viewer.setDrawing({ terms: item.bones, side: item.side === "mid" ? "both" : side, cut: item.cut, marks }, from);
  // 頭蓋の中の眼窩は、番号の点（全部）のまわりを映す
  viewer.frameDrawing(from, options.roll ?? 0, item.fit === "marks" ? item.marks.map((mark) => markPoint(ctx, mark)) : undefined);
}

/** 番号の部位の名前（日本語・英語・ラテン語）。押すとその番号に寄る */
function markRow(ctx: AppContext, mark: DrawingMarkItem, i: number, extra?: Node): HTMLElement {
  return h("li", {},
    h("button", { class: "drawing-name", type: "button", onClick: () => ctx.viewer.focusMark(i) },
      h("span", { class: "cloze-no" }, String(i + 1)),
      h("span", {}, h("ruby", {}, plainJa(mark.ja), h("rt", {}, mark.yomi)), h("span", { class: "drawing-en", lang: "en" }, mark.en),
        mark.la && mark.la.toLowerCase() !== mark.en.toLowerCase() ? h("span", { class: "drawing-la", lang: "la" }, `（ラ）${mark.la}`) : ""),
    ),
    extra ?? "",
  );
}

/** 骨の名前と、左右のある骨なら「右の」（「右の上腕骨（前面）」） */
function drawingName(item: DrawingItem, side: "right" | "left" = "right"): string {
  return item.side === "mid" ? item.title : `${side === "right" ? "右" : "左"}の${item.title}`;
}

/** 図に書く方向の語（左右のある骨は内側・外側、正中の骨は右・左） */
function directionWords(item: DrawingItem): string {
  return perpendicularDirections(item.view)
    .map((direction) => (item.side === "mid" && (direction === "med" || direction === "lat") ? "" : directionLabels[direction]))
    .filter(Boolean)
    .concat(item.side === "mid" && item.view !== "lat" && item.view !== "med" ? ["右", "左"] : [])
    .join("・");
}

/** 新しく学ぶとき: 番号付きの図と名前の一覧を見てから問題へ */
async function studyDrawing(ctx: AppContext, item: DrawingItem, progress: string): Promise<void> {
  await showDrawing(ctx, item, { marks: item.marks });
  ctx.hint("回して・拡大して見られる");
  await until<void>(ctx.signal, (resolve) => {
    const next = h("button", { class: "primary", type: "button", onClick: () => resolve() }, "覚えたら問題へ");
    showPanel(ctx,
      h("div", { class: "quiz-head" }, h("span", { class: "facet" }, `図を見て覚える・${areaLabels[item.area]}`), h("span", { class: "count" }, progress)),
      h("h2", {}, drawingName(item)),
      h("p", { class: "muted" }, `試験では、図に骨の名称・方向（${directionWords(item)}）と、各部の名称を日本語と英語で書き、指示線で示す。名前を押すと3Dでその番号に寄る。`),
      h("ol", { class: "drawing-names" }, ...item.marks.map((mark, i) => markRow(ctx, mark, i))),
      countNote(item),
      next,
    );
  });
  ctx.hint("");
}

/** D 番号→名前: 番号（多い図は LABEL_MAX まで選ぶ）の部位を日本語と英語で書く */
async function askLabel(ctx: AppContext, exam: DrawingItem, source: ReviewEvent["source"], progress: string): Promise<Outcome> {
  const started = performance.now();
  const picked = shuffle(exam.marks.map((_, i) => i)).slice(0, LABEL_MAX).sort((a, b) => a - b).map((i) => exam.marks[i]);
  await showDrawing(ctx, exam, { marks: picked });
  ctx.hint("");
  const head = header(exam, "label", progress);
  const input = (label: string, last: boolean) => h("input", {
    class: "type-en cloze-input", type: "text", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: false,
    enterkeyhint: last ? "done" : "next", "aria-label": label, placeholder: label.endsWith("英語") ? "英語・ラテン語" : "日本語",
  });
  const inputs = picked.map((_, i) => [input(`${i + 1} 日本語`, false), input(`${i + 1} 英語`, i === picked.length - 1)] as const);
  const flat = inputs.flat();
  const typed = await until<[string, string][] | null>(ctx.signal, (resolve) => {
    const submit = () => resolve(inputs.map(([ja, en]) => [ja.value, en.value]));
    flat.forEach((box, i) => box.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (i < flat.length - 1) flat[i + 1].focus();
      else submit();
    }));
    showPanel(ctx, head,
      h("p", { class: "prompt" }, `${drawingName(exam)}。番号の部位の名前は？`),
      h("div", { class: "drawing-inputs" }, ...inputs.map(([ja, en], i) => h("div", { class: "drawing-row" },
        h("button", { class: "cloze-no", type: "button", "aria-label": `${i + 1} に寄る`, onClick: () => ctx.viewer.focusMark(i) }, String(i + 1)), ja, en))),
      h("p", { class: "muted" }, "番号を押すと3Dでその番号に寄る。日本語は漢字が出なければ読み（ひらがな）でもよい。"),
      h("div", { class: "nav-row" },
        h("button", { class: "ghost-button", type: "button", onClick: () => resolve(null) }, "わからない"),
        h("button", { class: "primary", type: "button", onClick: submit }, "答える"),
      ),
    );
  });
  const results: EnglishResult[][] = picked.map((mark, i) => {
    if (!typed) return ["wrong", "wrong"];
    const answers = markAnswers(mark);
    return [checkBlank(typed[i][0], answers.ja), checkBlank(typed[i][1], answers.en)];
  });
  const rating = typed ? labelRating(results.flat()) : Rating.Again;
  const outcome = outcomeOf(rating, !typed);
  const { schedule, undo } = await recordReview(exam.key, "label", rating, { durationMs: Math.round(performance.now() - started), source });
  const mine = (text: string | undefined, result: EnglishResult) => (result !== "correct" && text?.trim() ? h("s", { class: "typed-ja" }, text.trim()) : "");
  const correct = results.flat().filter((result) => result !== "wrong").length;
  const again = await showResult(ctx, outcome, [
    head,
    banner(outcome, outcome === "skip" ? undefined : `${correct} / ${results.length * 2}`),
    h("ol", { class: "drawing-names" }, ...picked.map((mark, i) => markRow(ctx, mark, i, typed
      ? h("span", { class: "drawing-check" },
        h("span", { class: `blank-answer ${results[i][0]}` }, results[i][0] === "wrong" ? "日✗" : "日✓", mine(typed[i][0], results[i][0])),
        h("span", { class: `blank-answer ${results[i][1]}` }, results[i][1] === "wrong" ? "英✗" : results[i][1] === "close" ? "英△" : "英✓", mine(typed[i][1], results[i][1])))
      : undefined))),
    h("p", { class: "muted" }, "名前を押すと、3Dでその番号に寄る。"),
    countNote(exam),
  ], dueLabel(schedule));
  if (!again) return outcome;
  await undo();
  return askLabel(ctx, exam, source, progress);
}

/** D 図に書き込む: 番号なしの図を紙に写して名前を書き込み、番号付きの図と見比べて書けた所に印を付ける */
async function askAnnotate(ctx: AppContext, exam: DrawingItem, source: ReviewEvent["source"], progress: string): Promise<Outcome> {
  const started = performance.now();
  await showDrawing(ctx, exam);
  ctx.hint("");
  const head = header(exam, "annotate", progress);
  const ready = await until<boolean>(ctx.signal, (resolve) => {
    const open = h("button", { class: "primary", type: "button", onClick: () => resolve(true) }, "答えを見る");
    showPanel(ctx, head,
      // 骨の名称と左右も書く所なので、ここでは名前を出さない
      h("p", { class: "prompt" }, "紙にこの図を写し、名前を書き込もう"),
      h("p", {}, `骨の名称と左右、方向（${directionWords(exam)}）、各部の名称を日本語と英語で書き、指示線で示す。`),
      h("p", { class: "muted" }, `この図の部位は${exam.marks.length}か所。8割書ければ十分。`),
      h("div", { class: "nav-row" }, h("button", { class: "ghost-button", type: "button", onClick: () => resolve(false) }, "わからない"), open),
    );
    open.focus({ preventScroll: true });
  });
  await showDrawing(ctx, exam, { marks: exam.marks });
  const checks = [`骨の名称と左右・面（${drawingName(exam)}）`, `方向（${directionWords(exam)}）`];
  const boxes = [...checks, ...exam.marks].map(() => h("input", { type: "checkbox" }));
  if (ready) {
    await until<void>(ctx.signal, (resolve) => showPanel(ctx, head,
      h("p", { class: "prompt" }, "書けたもの（日本語と英語の両方）に印を付ける"),
      h("ul", { class: "points" }, ...checks.map((text, i) => h("li", {}, h("label", {}, boxes[i], h("span", {}, text))))),
      h("ol", { class: "drawing-names" }, ...exam.marks.map((mark, i) => markRow(ctx, mark, i, h("label", { class: "drawing-tick" }, boxes[checks.length + i], "書けた")))),
      h("button", { class: "primary", type: "button", onClick: () => resolve() }, "採点する"),
    ));
  }
  const checked = boxes.filter((box) => box.checked).length;
  const rating = ready ? annotateRating(checked, boxes.length) : Rating.Again;
  const outcome = outcomeOf(rating, !ready);
  const { schedule, undo } = await recordReview(exam.key, "annotate", rating, { durationMs: Math.round(performance.now() - started), source });
  const said = (i: number) => (boxes[i].checked ? h("span", { class: "blank-answer correct" }, "✓") : h("span", { class: "blank-answer wrong" }, "書けなかった"));
  const again = await showResult(ctx, outcome, [
    head,
    banner(outcome, `書けた ${checked} / ${boxes.length}`),
    h("ul", { class: "points done" }, ...checks.map((text, i) => h("li", { class: boxes[i].checked ? "said" : "" }, text))),
    h("ol", { class: "drawing-names" }, ...exam.marks.map((mark, i) => markRow(ctx, mark, i, said(checks.length + i)))),
    countNote(exam),
  ], dueLabel(schedule));
  if (!again) return outcome;
  await undo();
  return askAnnotate(ctx, exam, source, progress);
}

/** D 骨と向き: 左右をランダムに、面と画面の上の向きを変えて骨を見せ、左右・見ている面・画面の上の向きを当てる */
async function askOrient(ctx: AppContext, exam: DrawingItem, source: ReviewEvent["source"], progress: string): Promise<Outcome> {
  const started = performance.now();
  const question = orientQuestion(exam);
  await showDrawing(ctx, exam, { side: question.side, view: question.view, roll: question.roll });
  ctx.hint("回さずに見て答える（拡大はできる）");
  const head = header(exam, "orient", progress);
  const bone = plainJa(exam.title);
  const groups: { label: string; options: [string, string][] }[] = [
    { label: "左右", options: [["right", "右"], ["left", "左"]] },
    { label: "見ている面", options: exam.orient.map((view) => [view, faceLabels[view]]) },
    { label: "画面の上は", options: perpendicularDirections(question.view).map((direction) => [direction, directionLabels[direction]]) },
  ];
  const answers = [question.side, question.view, question.up];
  const chosen: (string | null)[] = groups.map(() => null);
  const typed = await until<boolean>(ctx.signal, (resolve) => {
    const submit = h("button", { class: "primary", type: "button", disabled: true, onClick: () => resolve(true) }, "答える");
    showPanel(ctx, head,
      h("p", { class: "prompt" }, `この${bone}は？`),
      ...groups.map((group, g) => {
        const buttons = group.options.map(([value, text]) => h("button", {
          class: "chip", type: "button", onClick: () => {
            chosen[g] = value;
            buttons.forEach((button, k) => button.classList.toggle("on", group.options[k][0] === value));
            submit.disabled = chosen.includes(null);
          },
        }, text));
        return h("div", { class: "orient-group" }, h("span", { class: "orient-label" }, group.label), h("div", { class: "chip-list" }, ...buttons));
      }),
      h("div", { class: "nav-row" }, h("button", { class: "ghost-button", type: "button", onClick: () => resolve(false) }, "わからない"), submit),
    );
  });
  ctx.hint("");
  const results: EnglishResult[] = answers.map((answer, i) => (typed && chosen[i] === answer ? "correct" : "wrong"));
  const rating = typed ? clozeRating(results) : Rating.Again;
  const outcome = outcomeOf(rating, !typed);
  const { schedule, undo } = await recordReview(exam.key, "orient", rating, { durationMs: Math.round(performance.now() - started), source });
  const text = (g: number, value: string) => groups[g].options.find(([v]) => v === value)?.[1] ?? value;
  const again = await showResult(ctx, outcome, [
    head,
    banner(outcome, outcome === "skip" ? undefined : `${results.filter((result) => result === "correct").length} / 3`),
    h("ul", { class: "points done" }, ...groups.map((group, g) => h("li", { class: results[g] === "correct" ? "said" : "" },
      `${group.label}: ${text(g, answers[g])}`, typed && results[g] !== "correct" && chosen[g] ? h("s", { class: "typed-ja" }, text(g, chosen[g]!)) : ""))),
    h("p", { class: "muted" }, `${question.side === "right" ? "右" : "左"}の${bone}を${faceLabels[question.view]}から見ていた。「向きを戻す」で上を上にして見られる。`),
    h("div", { class: "nav-row" }, h("button", { class: "ghost-button", type: "button", onClick: () => ctx.viewer.frameDrawing(viewFrom(question.view, question.side)) }, "向きを戻す")),
    countNote(exam),
  ], dueLabel(schedule));
  if (!again) return outcome;
  await undo();
  return askOrient(ctx, exam, source, progress);
}
