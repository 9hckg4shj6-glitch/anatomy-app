import type { Grade } from "ts-fsrs";
import examJson from "../content/exam.json";
import { checkEnglish, type EnglishResult } from "./answer";
import { pins, termById, type Term } from "./content";
import type { Facet, StoredSchedule } from "./db";
import { Rating } from "./fsrs";
import { drawingUp, pinCenter, type Vec3 } from "./landmarks";
import { termMastery } from "./study";
import type { Section } from "./viewer";

/**
 * 骨学試験の項目（content/exam.json。計画は docs/骨学試験対策.md）。
 * A 穴埋め（cloze）: 文の中の {語ID} と {=答え|別解} が空欄。語ID の空欄は、その語の日本語名・読み・英語名・ラテン語名のどれでも正解。
 * B 用語（words）: 骨の語（term）か、3Dの部品の無い総論の語（ja・en・la などを直接書く）。ラ→日（read）と 日→英・ラ（spell）。
 * C 短文記述（essays）: 語を見て説明してから、要点の一覧で自分で採点する（explain）。
 * D 図示（drawings）: 骨を試験の向きで見せ、番号の部位を日本語と英語で答える（label）、図に名前を書き込んで番号付きの図と見比べる（annotate）、
 * 向きを変えた骨の左右・見ている面・画面の上の向きを当てる（orient）。
 * count は過去の試験に出た回数、recent は直近2回の試験に出たか（どちらも並べる順に使う）。
 * 学習の記録は語と同じ表に、語ID の代わりに "exam:a:<ID>" などで入れる（語根カードの "root:" と同じ）。
 */
export type ExamKind = "a" | "b" | "c" | "d";
export type ExamArea = "general" | "trunk" | "upper" | "lower" | "skull";

export const EXAM_KINDS: ExamKind[] = ["a", "b", "c", "d"];
export const kindLabels: Record<ExamKind, string> = { a: "A 穴埋め", b: "B 用語", c: "C 短文記述", d: "D 図示" };
export const areaLabels: Record<ExamArea, string> = { general: "総論", trunk: "体幹", upper: "上肢", lower: "下肢", skull: "頭蓋" };
/** 種類ごとの問い方。B は最初にラ→日（4択）、あとで日→英・ラ（つづり）も出す。D は examFacetsOf で項目ごとに絞る */
export const examFacets: Record<ExamKind, Facet[]> = { a: ["cloze"], b: ["read", "spell"], c: ["explain"], d: ["label", "annotate", "orient"] };

/**
 * 項目に出す問い方。D の「図に書き込む」は「番号→名前」が復習の段階に入ってから（名前を覚えてから）、
 * 「骨と向き」は左右のある骨の、向きを当てる面（orient）を書いた図だけ。
 */
export function examFacetsOf(item: ExamItem, labelLearned = false): Facet[] {
  if (item.kind !== "d") return examFacets[item.kind];
  return examFacets.d.filter((facet) => (facet === "annotate" ? labelLearned : facet === "orient" ? item.orient.length > 0 : true));
}

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

/** 図の向き（カメラを置く向き）。右の骨で lat＝外から・med＝内から。正中の骨の lat は右から */
export type DrawingView = "ant" | "post" | "lat" | "med" | "sup" | "inf";

/** 図の番号: ピンか骨の語のID、点を書いた語、語に無い名前（点と名前を書く） */
type MarkJson = string | { term: string; at: Vec3; n?: Vec3 } | { ja: string; yomi: string; en: string; la?: string; at: Vec3; n?: Vec3 };

interface DrawingJson extends Base {
  title: string;
  /** 見せる骨の語 */
  bones: string[];
  /** right＝右の骨（左右のある骨）、mid＝正中の骨・頭蓋 */
  side: "right" | "mid";
  view: DrawingView;
  cut?: Section;
  /** marks なら番号の点のまわりを映す（頭蓋の中の眼窩） */
  fit?: "marks";
  /** 「骨と向き」で見せる面（無ければその問い方を出さない） */
  orient?: DrawingView[];
  marks: MarkJson[];
}

interface ExamFile {
  cloze: ClozeJson[];
  words: WordJson[];
  essays: EssayJson[];
  drawings: DrawingJson[];
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

export interface DrawingMarkItem {
  term?: string;
  ja: string;
  yomi: string;
  en: string;
  enAlt: string[];
  la?: string;
  /** 点（骨の語の中心は models/index.json にあるので、無ければ 3D 表示のときに決める） */
  at?: Vec3;
  n?: Vec3;
  /** 点の手前にあるこの語の骨の面へ番号を移す（点を書いた印では移さない） */
  project?: string;
}

export interface DrawingItem extends ItemBase {
  kind: "d";
  bones: string[];
  side: "right" | "mid";
  view: DrawingView;
  cut?: Section;
  fit?: "marks";
  orient: DrawingView[];
  marks: DrawingMarkItem[];
}

export type ExamItem = ClozeItem | WordItem | EssayItem | DrawingItem;

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

function drawingMark(mark: MarkJson): DrawingMarkItem {
  if (typeof mark !== "string" && "ja" in mark) {
    return { ja: mark.ja, yomi: mark.yomi, en: mark.en, enAlt: [], la: mark.la, at: mark.at, n: mark.n };
  }
  const id = typeof mark === "string" ? mark : mark.term;
  const term = termById.get(id);
  const pin = pins[id];
  const named = { term: id, ja: term?.ja ?? id, yomi: term?.yomi ?? "", en: term?.en ?? "", enAlt: term?.enAlt ?? [], la: term?.la };
  if (typeof mark !== "string") return { ...named, at: mark.at, n: mark.n };
  return { ...named, at: pin && pinCenter(pin), n: pin?.n, project: id };
}

const drawingItems: DrawingItem[] = (data.drawings ?? []).map((item) => ({
  kind: "d", id: item.id, key: examKey("d", item.id), area: item.area, count: item.count, recent: !!item.recent,
  title: item.title, show: item.bones,
  bones: item.bones, side: item.side, view: item.view, cut: item.cut, fit: item.fit, orient: item.orient ?? [],
  marks: item.marks.map(drawingMark),
}));

export const examItems: ExamItem[] = [...clozeItems, ...wordItems, ...essayItems, ...drawingItems];
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
// D の図の番号は、骨を描かせる回数なので数えない
for (const item of examItems) {
  if (item.kind === "d") continue;
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

/** 図の向き（カメラを置く向き。右の骨。左の骨は左右を折り返す）。真上・真下からは前が画面の上に来るよう少し傾ける */
const VIEW_FROM: Record<DrawingView, Vec3> = { ant: [0, 0, 1], post: [0, 0, -1], lat: [-1, 0, 0], med: [1, 0, 0], sup: [0, 1, -0.12], inf: [0, -1, 0.12] };

export function viewFrom(view: DrawingView, side: "right" | "left" = "right"): Vec3 {
  const [x, y, z] = VIEW_FROM[view];
  return [side === "left" ? -x : x, y, z];
}

export const faceLabels: Record<DrawingView, string> = { ant: "前面", post: "後面", lat: "外側面", med: "内側面", sup: "上面", inf: "下面" };
export const directionLabels: Record<DrawingView, string> = { ant: "前", post: "後", lat: "外側", med: "内側", sup: "上", inf: "下" };

/** 向き（ベクトル）が骨のどちら向きか（いちばん近い方向）。内側・外側は左右の骨で x の向きが逆 */
export function directionOf(v: Vec3, side: "right" | "left"): DrawingView {
  const k = [0, 1, 2].reduce((best, i) => (Math.abs(v[i]) > Math.abs(v[best]) ? i : best), 0);
  if (k === 1) return v[1] > 0 ? "sup" : "inf";
  if (k === 2) return v[2] > 0 ? "ant" : "post";
  // 右の骨では内側が +x（本人の右が -x）
  return (v[0] > 0) === (side === "right") ? "med" : "lat";
}

/** 図を見ている向きに垂直な4つの向き（画面の上の向きの選択肢） */
export function perpendicularDirections(view: DrawingView): DrawingView[] {
  if (view === "ant" || view === "post") return ["sup", "inf", "med", "lat"];
  if (view === "lat" || view === "med") return ["sup", "inf", "ant", "post"];
  return ["ant", "post", "med", "lat"];
}

/** 「骨と向き」の問題: 左右・見ている面・画面の上を回す角度と、その正解（画面の上がどの向きか） */
export interface OrientQuestion {
  side: "right" | "left";
  view: DrawingView;
  roll: number;
  up: DrawingView;
}

export function orientQuestion(item: DrawingItem, random: () => number = Math.random): OrientQuestion {
  const side = random() < 0.5 ? "right" : "left";
  const view = item.orient[Math.floor(random() * item.orient.length)];
  const roll = [0, 90, 180, 270][Math.floor(random() * 4)];
  return { side, view, roll, up: directionOf(drawingUp(viewFrom(view, side), roll), side) };
}

/** 図の番号の答え: 日本語（区別の（）を除いたもの・読み）と、英語・ラテン語 */
export function markAnswers(mark: DrawingMarkItem): { ja: string[]; en: string[] } {
  return { ja: [...new Set([mark.ja, plainJa(mark.ja), mark.yomi].filter(Boolean))], en: [mark.en, ...mark.enAlt, ...(mark.la ? [mark.la] : [])].filter(Boolean) };
}

/** 番号→名前の判定。全部正解なら Good（惜しいがあれば Hard）、4分の3以上なら Hard、それ未満は Again */
export function labelRating(results: EnglishResult[]): Grade {
  const wrong = results.filter((result) => result === "wrong").length;
  if (!wrong) return results.includes("close") ? Rating.Hard : Rating.Good;
  return (results.length - wrong) / results.length >= 0.75 ? Rating.Hard : Rating.Again;
}

/** 図に書き込んだ数の自己採点。8割以上書けたら Good、半分以上なら Hard、それ未満は Again（全部は書かなくてよい） */
export function annotateRating(checked: number, total: number): Grade {
  if (checked >= total * 0.8) return Rating.Good;
  return checked * 2 >= total ? Rating.Hard : Rating.Again;
}
