import type { Grade } from "ts-fsrs";
import examJson from "../content/exam.json";
import { checkEnglish, type EnglishResult } from "./answer";
import { termById, type Term } from "./content";
import type { Facet, StoredSchedule } from "./db";
import { Rating } from "./fsrs";
import { termMastery } from "./study";

/**
 * 骨学試験の項目（content/exam.json。計画は docs/骨学試験対策.md）。
 * A 穴埋め（cloze）: 文の中の {語ID} と {=答え|別解} が空欄。語ID の空欄は、その語の日本語名・読み・英語名・ラテン語名のどれでも正解。
 * B 用語（words）: 骨の語（term）か、3Dの部品の無い総論の語（ja・en・la などを直接書く）。ラ→日（read）と 日→英・ラ（spell）。
 * C 短文記述（essays）: 語を見て説明してから、要点の一覧で自分で採点する（explain）。
 * count は過去の試験に出た回数、recent は直近2回の試験に出たか（どちらも並べる順に使う）。
 * 学習の記録は語と同じ表に、語ID の代わりに "exam:a:<ID>" などで入れる（語根カードの "root:" と同じ）。
 */
export type ExamKind = "a" | "b" | "c";
export type ExamArea = "general" | "trunk" | "upper" | "lower" | "skull";

export const EXAM_KINDS: ExamKind[] = ["a", "b", "c"];
export const kindLabels: Record<ExamKind, string> = { a: "A 穴埋め", b: "B 用語", c: "C 短文記述" };
export const areaLabels: Record<ExamArea, string> = { general: "総論", trunk: "体幹", upper: "上肢", lower: "下肢", skull: "頭蓋" };
/** 種類ごとの問い方。B は最初にラ→日（4択）、あとで日→英・ラ（つづり）も出す */
export const examFacets: Record<ExamKind, Facet[]> = { a: ["cloze"], b: ["read", "spell"], c: ["explain"] };

interface Base {
  id: string;
  area: ExamArea;
  count: number;
  recent?: boolean;
}

interface ClozeJson extends Base {
  text: string;
  /** 空欄の語のほかに3Dで示す語 */
  show?: string[];
}

interface WordJson extends Base {
  term?: string;
  ja?: string;
  yomi?: string;
  en?: string;
  enAlt?: string[];
  la?: string;
  note?: string;
  show?: string[];
}

interface EssayJson extends Base {
  term?: string;
  title?: string;
  yomi?: string;
  show?: string[];
  points: string[];
}

interface ExamFile {
  cloze: ClozeJson[];
  words: WordJson[];
  essays: EssayJson[];
}

export interface Blank {
  /** 正解とする答え（日本語・読み・英語・ラテン語） */
  answers: string[];
  /** 答え合わせで見せる答え */
  display: string;
  /** 語の空欄なら語ID（3Dで示す） */
  term?: string;
}

interface ItemBase {
  kind: ExamKind;
  id: string;
  /** 記録に使うID（"exam:a:<ID>"） */
  key: string;
  area: ExamArea;
  count: number;
  recent: boolean;
  /** 一覧・まちがえた問題に出す名前 */
  title: string;
  /** 3Dで示す語 */
  show: string[];
}

export interface ClozeItem extends ItemBase {
  kind: "a";
  /** 文を空欄で切ったもの（文字列と空欄の番号） */
  parts: (string | number)[];
  blanks: Blank[];
}

export interface WordItem extends ItemBase {
  kind: "b";
  term?: string;
  ja: string;
  yomi: string;
  en: string;
  enAlt: string[];
  la?: string;
  note: string;
}

export interface EssayItem extends ItemBase {
  kind: "c";
  term?: string;
  yomi?: string;
  points: string[];
}

export type ExamItem = ClozeItem | WordItem | EssayItem;

const PREFIX = "exam:";
const data = examJson as ExamFile;

export function examKey(kind: ExamKind, id: string): string {
  return `${PREFIX}${kind}:${id}`;
}

export function isExamKey(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** 語の日本語名から、区別のための（）を除く（「耳状面（仙骨）」→「耳状面」） */
export function plainJa(ja: string): string {
  return ja.replace(/（[^）]*）$/, "");
}

function termAnswers(term: Term): string[] {
  return [...new Set([term.ja, plainJa(term.ja), term.yomi, term.en, ...(term.enAlt ?? []), ...(term.la ? [term.la] : [])])];
}

/** 穴埋めの文を、文字列と空欄に分ける。{語ID} は語の空欄、{=答え|別解} は答えを書いた空欄 */
export function parseCloze(text: string): { parts: (string | number)[]; blanks: Blank[] } {
  const parts: (string | number)[] = [];
  const blanks: Blank[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{([^}]+)\}/g)) {
    parts.push(text.slice(last, match.index));
    const token = match[1];
    if (token.startsWith("=")) {
      const answers = token.slice(1).split("|");
      blanks.push({ answers, display: answers[0] });
    } else {
      const term = termById.get(token);
      blanks.push(term ? { answers: termAnswers(term), display: plainJa(term.ja), term: term.id } : { answers: [token], display: token });
    }
    parts.push(blanks.length - 1);
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return { parts: parts.filter((part) => part !== ""), blanks };
}

const unique = (ids: string[]) => [...new Set(ids)];

const clozeItems: ClozeItem[] = data.cloze.map((item) => {
  const { parts, blanks } = parseCloze(item.text);
  const termIds = blanks.flatMap((blank) => (blank.term ? [blank.term] : []));
  return {
    kind: "a", id: item.id, key: examKey("a", item.id), area: item.area, count: item.count, recent: !!item.recent,
    title: blanks.map((blank) => blank.display).join("・"),
    show: unique([...termIds, ...(item.show ?? [])]),
    parts, blanks,
  };
});

const wordItems: WordItem[] = data.words.map((item) => {
  const term = item.term ? termById.get(item.term) : undefined;
  const ja = item.ja ?? (term ? plainJa(term.ja) : item.id);
  return {
    kind: "b", id: item.id, key: examKey("b", item.id), area: item.area, count: item.count, recent: !!item.recent,
    title: ja, show: unique([...(term ? [term.id] : []), ...(item.show ?? [])]),
    term: term?.id, ja, yomi: item.yomi ?? term?.yomi ?? "", en: item.en ?? term?.en ?? "", enAlt: item.enAlt ?? term?.enAlt ?? [],
    la: item.la ?? term?.la, note: item.note ?? term?.note ?? "",
  };
});

const essayItems: EssayItem[] = data.essays.map((item) => {
  const term = item.term ? termById.get(item.term) : undefined;
  return {
    kind: "c", id: item.id, key: examKey("c", item.id), area: item.area, count: item.count, recent: !!item.recent,
    title: item.title ?? (term ? plainJa(term.ja) : item.id), yomi: item.yomi ?? (item.title ? undefined : term?.yomi),
    show: unique([...(term ? [term.id] : []), ...(item.show ?? [])]),
    term: term?.id, points: item.points,
  };
});

export const examItems: ExamItem[] = [...clozeItems, ...wordItems, ...essayItems];
export const examByKey = new Map(examItems.map((item) => [item.key, item]));

/** 出る順（試験に出た回数の多い順、同じなら直近2回に出たもの、同じならファイルの順） */
export function examItemsOf(kind: ExamKind, area?: ExamArea): ExamItem[] {
  return examItems
    .filter((item) => item.kind === kind && (!area || item.area === area))
    .map((item, i) => ({ item, i }))
    .sort((a, b) => b.item.count - a.item.count || Number(b.item.recent) - Number(a.item.recent) || a.i - b.i)
    .map(({ item }) => item);
}

export function examAreas(kind: ExamKind): ExamArea[] {
  return (Object.keys(areaLabels) as ExamArea[]).filter((area) => examItems.some((item) => item.kind === kind && item.area === area));
}

/** まだ学んでいない項目を出る順に count 個 */
export function nextExamItems(kind: ExamKind, learned: Set<string>, count: number, area?: ExamArea): ExamItem[] {
  return examItemsOf(kind, area).filter((item) => !learned.has(item.key)).slice(0, count);
}

/** 種類ごとの進み具合（学んだ数と、学んだ項目の覚え具合の平均。一度も解いていなければ null） */
export function examProgress(kind: ExamKind, learned: Set<string>, schedules: StoredSchedule[], at = new Date()): { done: number; total: number; mastery: number | null } {
  const items = examItems.filter((item) => item.kind === kind);
  const done = items.filter((item) => learned.has(item.key));
  const byKey = new Map<string, StoredSchedule[]>();
  for (const schedule of schedules) if (isExamKey(schedule.termId)) byKey.set(schedule.termId, [...(byKey.get(schedule.termId) ?? []), schedule]);
  const values = done.map((item) => termMastery(byKey.get(item.key) ?? [], at)).filter((value): value is number => value !== null);
  return { done: done.length, total: items.length, mastery: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null };
}

const countByTerm = new Map<string, number>();
for (const item of examItems) {
  const ids = item.kind === "a" ? unique(item.blanks.flatMap((blank) => (blank.term ? [blank.term] : []))) : item.term ? [item.term] : [];
  for (const id of ids) countByTerm.set(id, (countByTerm.get(id) ?? 0) + item.count);
}

/** その語が骨学試験に出た回数（A の空欄・B・C を合わせて。0 なら出ていない） */
export function examCountOf(termId: string): number {
  return countByTerm.get(termId) ?? 0;
}

/**
 * 日本語の答えをそろえる。全角・半角、空白、カタカナとひらがな、異体字（頸・鉤・靭・彎）、「（腸骨）」のような区別の括弧を区別しない。
 */
export function normalizeJapanese(text: string): string {
  // NFKC で全角の（）は半角になる
  return text.normalize("NFKC").replace(/\s+/g, "").replace(/\([^)]*\)$/, "")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/頸/g, "頚").replace(/鉤/g, "鈎").replace(/靭/g, "靱").replace(/彎/g, "弯");
}

const latin = /[a-z]/i;

/** 空欄1つの答え合わせ。英字なら英語・ラテン語のつづりとして（1文字違いは惜しい）、ほかは日本語として比べる */
export function checkBlank(input: string, answers: string[]): EnglishResult {
  const typed = input.trim();
  if (!typed) return "wrong";
  if (latin.test(typed)) return checkEnglish(typed, answers.filter((answer) => latin.test(answer)));
  const answer = normalizeJapanese(typed);
  return answers.some((target) => !latin.test(target) && normalizeJapanese(target) === answer) ? "correct" : "wrong";
}

/**
 * 穴埋めの文の判定。全部正解なら Good。惜しい（1文字違い）があるか、空欄が3つ以上で1つだけまちがえたなら Hard、それ以外は Again。
 */
export function clozeRating(results: EnglishResult[]): Grade {
  const wrong = results.filter((result) => result === "wrong").length;
  if (!wrong) return results.includes("close") ? Rating.Hard : Rating.Good;
  return wrong === 1 && results.length >= 3 ? Rating.Hard : Rating.Again;
}

/** 短文記述の自己採点。要点を全部言えたら Good、半分以上なら Hard、それ未満は Again */
export function essayRating(checked: number, total: number): Grade {
  if (checked >= total) return Rating.Good;
  return checked * 2 >= total ? Rating.Hard : Rating.Again;
}
