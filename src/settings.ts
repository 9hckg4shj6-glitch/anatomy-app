import { db, nowIso, type Facet } from "./db";
import { BASIC_FACETS, TERM_FACETS } from "./study";

/** 設定の画面（#/settings）で変えられる設定。db.settings に1つずつ保存し、起動したときに読む */
export interface Preferences {
  /**
   * 初心者モード（beginner）は初心者コース（content/beginner.json の約370語）と短い「覚えること」だけ、
   * 詳細モード（detail）は全部の語と詳しい説明（src/course.ts）。保存が無ければ、まだ何も学んでいない人は初心者モード
   */
  mode: "beginner" | "detail";
  /** レッスン・図鑑・答え合わせで英語の発音を自動で鳴らす（🔊を押せばいつでも鳴る） */
  autoSpeak: boolean;
  /** 1日に新しく始める問い方の数（4つの問い方を別々に数える） */
  newPerDay: number;
  /** 正解したら1.5秒で次の問題へ進む（まちがえたときは自分で「次へ」） */
  autoNext: boolean;
  /** 復習の1回の区切り（0 は全部）。復習を始めるときに選んだものを覚える */
  reviewSize: number;
  /** 説明の欄の文字の大きさ（3Dはそのまま） */
  textSize: "small" | "medium" | "large";
  /** 骨学試験の日（"2027-02-04" の形。空なら決めていない）。ホームに残りの日数と1日の目安を出す */
  examDate: string;
  /** 最後に記録を書き出した日時（空ならまだ）。しばらく書き出していなければホームで知らせる */
  lastBackupAt: string;
  /** 学ぶ問い方（語の問い方。study.ts の TERM_FACETS から）。外した問い方は新しく始めず、復習にも出さない（記録は残る） */
  studyFacets: Facet[];
  /** レッスンの確認テストで出す問い方（基本の4つから。レッスンの始めに選んだものを覚える） */
  lessonFacets: Facet[];
  /** 3Dの右上に向きの目印（小さな人と上・下・前・後・右・左）を出す。骨や臓器だけを見るときに前後左右が分かるように */
  compass: boolean;
}

export const NEW_PER_DAY_OPTIONS = [10, 20, 30, 40];
export const REVIEW_SIZE_OPTIONS = [10, 20, 0];
export const TEXT_SIZES: Record<Preferences["textSize"], { label: string; zoom: number }> = {
  small: { label: "小", zoom: 0.9 },
  medium: { label: "中", zoom: 1 },
  large: { label: "大", zoom: 1.15 },
};

export const preferences: Preferences = {
  mode: "detail", autoSpeak: true, newPerDay: 20, autoNext: false, reviewSize: 20, textSize: "medium", examDate: "", lastBackupAt: "",
  studyFacets: [...TERM_FACETS], lessonFacets: ["locate", "point"], compass: true,
};

/** 学ぶ問い方を保存したときにあった問い方を覚えておく設定のキー。あとから増えた問い方（向き・ホルモン）を学ぶ側に入れるため */
const SEEN_FACETS = "seenFacets";
/** SEEN_FACETS を覚え始める前からあった問い方 */
const OLD_FACETS: Facet[] = TERM_FACETS.filter((facet) => facet !== "relation" && facet !== "hormone");

/** 問い方の並び。基本の問い方を1つは含む（どれも外すと何も学べないので） */
const facetList = (allowed: Facet[]) => (value: unknown): value is Facet[] =>
  Array.isArray(value) && value.every((facet) => allowed.includes(facet)) && value.some((facet) => BASIC_FACETS.includes(facet));

const valid: { [K in keyof Preferences]: (value: unknown) => value is Preferences[K] } = {
  mode: (value): value is Preferences["mode"] => value === "beginner" || value === "detail",
  autoSpeak: (value): value is boolean => typeof value === "boolean",
  newPerDay: (value): value is number => typeof value === "number" && NEW_PER_DAY_OPTIONS.includes(value),
  autoNext: (value): value is boolean => typeof value === "boolean",
  reviewSize: (value): value is number => typeof value === "number" && REVIEW_SIZE_OPTIONS.includes(value),
  textSize: (value): value is Preferences["textSize"] => typeof value === "string" && value in TEXT_SIZES,
  examDate: (value): value is string => typeof value === "string" && (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)),
  lastBackupAt: (value): value is string => typeof value === "string",
  studyFacets: facetList(TERM_FACETS),
  lessonFacets: facetList(BASIC_FACETS),
  compass: (value): value is boolean => typeof value === "boolean",
};

/** 起動したときと、記録を読み込んだときに呼ぶ */
export async function loadPreferences(): Promise<void> {
  const keys = Object.keys(valid) as (keyof Preferences)[];
  const records = await db.settings.bulkGet(keys);
  keys.forEach((key, i) => {
    const value = records[i]?.value;
    if (valid[key](value)) (preferences as unknown as Record<string, unknown>)[key] = value;
  });
  // モードを一度も選んでいなければ、今までに学んだ人は詳細モード（これまでどおり）、はじめての人は初心者モードにして覚える
  if (!valid.mode(records[keys.indexOf("mode")]?.value)) await setPreference("mode", (await db.learned.count()) ? "detail" : "beginner");
  // 学ぶ問い方を選んで保存したあとに増えた問い方は、学ぶ側に入れる（外したければ設定で外す）
  const seen = (await db.settings.get(SEEN_FACETS))?.value;
  const added = TERM_FACETS.filter((facet) => !(Array.isArray(seen) ? seen : OLD_FACETS).includes(facet));
  if (added.length) {
    if (valid.studyFacets(records[keys.indexOf("studyFacets")]?.value)) await setPreference("studyFacets", [...new Set([...preferences.studyFacets, ...added])]);
    await db.settings.put({ key: SEEN_FACETS, value: TERM_FACETS, updatedAt: nowIso() });
  }
  applyTextSize();
}

export async function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
  preferences[key] = value;
  if (key === "textSize") applyTextSize();
  await db.settings.put({ key, value, updatedAt: nowIso() });
}

/** 説明の欄の文字の大きさ（CSS の --panel-zoom） */
export function applyTextSize(): void {
  document.documentElement.style.setProperty("--panel-zoom", String(TEXT_SIZES[preferences.textSize].zoom));
}

/** 試験の日まであと何日か（今日なら 0、決めていないか過ぎていれば null） */
export function daysUntilExam(now = new Date()): number | null {
  if (!preferences.examDate) return null;
  const [y, m, d] = preferences.examDate.split("-").map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}
