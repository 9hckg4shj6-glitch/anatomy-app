import { canUseExam } from "./profile";

/**
 * 使う目的（はじめに #/start の3枚目と、使い方 #/guide。docs/普段使い.md「はじめての人への案内」）。
 * 目的はいくつでも選べ、覚える量の段（コース）のおすすめ・3語のレッスンのあとの「あなたの使い方」・使い方のページの並びに使う。
 * 機能を出す・隠すことには使わない（どの目的でも全部の学び方を使える）
 */
export type Purpose = "class" | "bone" | "lookup" | "review";
export type CourseId = "basic" | "standard" | "free";

/** 使い方の1つの手順（文と、押すとその画面へ行くリンク） */
export interface GuideStep {
  text: string;
  link?: { href: string; label: string };
}

export interface PurposeInfo {
  id: Purpose;
  /** はじめにと使い方の題 */
  title: string;
  /** はじめにの一言 */
  sub: string;
  /** 使い方の手順（3語のレッスンのあとの「あなたの使い方」は初めの2つ） */
  steps: GuideStep[];
}

export const PURPOSES: PurposeInfo[] = [
  {
    id: "class",
    title: "授業の予習・復習",
    sub: "授業の系統をレッスンで覚え、毎日の復習で忘れない",
    steps: [
      { text: "「学ぶ › レッスン」で授業の系統を選ぶ。3Dで1語ずつ見て、最後に確認テストに答える。", link: { href: "#/lessons", label: "レッスンの一覧" } },
      { text: "覚えた語は、忘れかけたころに「今日」の復習に出る。1日3〜5分、今日の復習を解くだけで続く。", link: { href: "#/", label: "今日" } },
      { text: "心臓・肺・脳などは「臓器の図」で、立体を切ったり平面図で名前を確かめたりする。細胞と組織・発生もここ。", link: { href: "#/organs", label: "臓器の図" } },
      { text: "試験の前は「演習」で、終えたレッスンを選んで解き直す。", link: { href: "#/drill", label: "演習" } },
    ],
  },
  {
    id: "bone",
    title: "骨学試験の対策",
    sub: "骨学実習の試験を A〜D の形式で練習する",
    steps: [
      { text: "「設定」で骨学試験の日を入れると、今日の画面に「試験まで○日・1日○項目」が出る。", link: { href: "#/settings", label: "設定" } },
      { text: "「学ぶ › 骨学試験」で、A 空欄・B 読みと書き・C 説明・D 図示の形式で解く。", link: { href: "#/exam", label: "骨学試験" } },
      { text: "骨学試験の「整理して覚える」で、対で覚える語・数と並び・体表の目安をまとめて覚える。" },
      { text: "骨の名前と場所そのものは、骨格系のレッスンで3Dと一緒に覚える。", link: { href: "#/lessons/skeletal", label: "骨格系のレッスン" } },
    ],
  },
  {
    id: "lookup",
    title: "実習・講義の合間に調べる",
    sub: "名前や場所をすぐ1語引く。3Dをタップして調べる",
    steps: [
      { text: "「調べる」（右上の虫めがね）で、日本語・読み・英語・ラテン語から引く。", link: { href: "#/look", label: "調べる" } },
      { text: "「図鑑」で3Dを回し、部位をタップすると名前と説明が出る。今日の画面の人体をタップしても開く。", link: { href: "#/explore", label: "図鑑" } },
      { text: "先生が「ここは出す」と言った語には ☆ を。★を付けた語は「調べる」に集まり、「演習」でまとめて解ける。" },
      { text: "ホーム画面に追加しておくと、実習中でもすぐ開ける。" },
    ],
  },
  {
    id: "review",
    title: "CBT・国試の前に見直す",
    sub: "全身をざっと見直し、苦手な語を解き直す",
    steps: [
      { text: "コースは「標準」（必修と基礎）がおすすめ。発展の語まで見るなら「すべての語」。", link: { href: "#/settings", label: "設定でコースを変える" } },
      { text: "「演習」で系統やレッスンを選んで解く。「苦手な語」は、まちがえた語・忘れかけた語から出る。", link: { href: "#/drill", label: "演習" } },
      { text: "「臓器の図」で、臓器どうしの位置と切り口を見直す。", link: { href: "#/organs", label: "臓器の図" } },
      { text: "「記録」の「進捗」で覚え具合を人体の色で見て、薄い系統から手を付ける。", link: { href: "#/progress", label: "進捗" } },
    ],
  },
];

/** 画面に出す目的（骨学試験の対策は、骨学試験を使える名前の人だけ。src/profile.ts の canUseExam） */
export const shownPurposes = (): PurposeInfo[] => (canUseExam() ? PURPOSES : PURPOSES.filter((purpose) => purpose.id !== "bone"));

export const purposeById = new Map(PURPOSES.map((purpose) => [purpose.id, purpose]));

export const isPurpose = (value: unknown): value is Purpose => typeof value === "string" && purposeById.has(value as Purpose);

/**
 * 覚える量の段（コース）のおすすめ。1年生で骨学試験・見直しを選んでいなければ「はじめての解剖」、ほかは「標準」。
 * 骨学試験と語根カードは「はじめての解剖」では使えないので、骨学試験を選んだ人には標準。
 * 「すべての語」は自分で選ぶ人のためのもので、すすめない
 */
export function recommendCourse(grade: string | undefined, purposes: readonly Purpose[]): CourseId {
  if (purposes.includes("bone") || purposes.includes("review")) return "standard";
  return grade === "1年" ? "basic" : "standard";
}
