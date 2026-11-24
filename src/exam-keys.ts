import type { Facet } from "./db";

/**
 * 骨学試験の軽い所（記録のキーと種類の名前）。今日・記録・復習でも使うので、はじめの JS に入れる。
 * 項目のデータ（content/exam.json）と画面（src/exam.ts・src/ui/exam.ts）は、使える人のときだけ読む（src/exam-lazy.ts）
 */
export type ExamKind = "a" | "b" | "c" | "d" | "p" | "s" | "l";

export const EXAM_KINDS: ExamKind[] = ["a", "b", "c", "d", "p", "s", "l"];
/** 試験の形式の種類（A〜D）と、整理して覚える種類 */
export const SECTION_KINDS: ExamKind[] = ["a", "b", "c", "d"];
export const SORT_KINDS: ExamKind[] = ["p", "s", "l"];
export const kindLabels: Record<ExamKind, string> = { a: "A 穴埋め", b: "B 用語", c: "C 短文記述", d: "D 図示", p: "対で覚える", s: "数と並び", l: "体表の目安" };

/** 先に覚える問い方（これが復習の段階に入ると、あとの問い方が出る） */
export const FIRST_FACETS: Facet[] = ["label", "order"];

const PREFIX = "exam:";

export function examKey(kind: ExamKind, id: string): string {
  return `${PREFIX}${kind}:${id}`;
}

export function isExamKey(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** 項目の1問を解く画面 */
export function itemHref(item: { kind: ExamKind; id: string }): string {
  return `#/exam/${item.kind}/${encodeURIComponent(item.id)}`;
}
