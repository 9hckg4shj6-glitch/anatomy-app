import { db, nowIso } from "./db";

/** 設定の画面（#/settings）で変えられる設定。db.settings に1つずつ保存し、起動したときに読む */
export interface Preferences {
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
}

export const NEW_PER_DAY_OPTIONS = [10, 20, 30, 40];
export const REVIEW_SIZE_OPTIONS = [10, 20, 0];
export const TEXT_SIZES: Record<Preferences["textSize"], { label: string; zoom: number }> = {
  small: { label: "小", zoom: 0.9 },
  medium: { label: "中", zoom: 1 },
  large: { label: "大", zoom: 1.15 },
};

export const preferences: Preferences = { autoSpeak: true, newPerDay: 20, autoNext: false, reviewSize: 20, textSize: "medium", examDate: "", lastBackupAt: "" };

const valid: { [K in keyof Preferences]: (value: unknown) => value is Preferences[K] } = {
  autoSpeak: (value): value is boolean => typeof value === "boolean",
  newPerDay: (value): value is number => typeof value === "number" && NEW_PER_DAY_OPTIONS.includes(value),
  autoNext: (value): value is boolean => typeof value === "boolean",
  reviewSize: (value): value is number => typeof value === "number" && REVIEW_SIZE_OPTIONS.includes(value),
  textSize: (value): value is Preferences["textSize"] => typeof value === "string" && value in TEXT_SIZES,
  examDate: (value): value is string => typeof value === "string" && (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)),
  lastBackupAt: (value): value is string => typeof value === "string",
};

/** 起動したときと、記録を読み込んだときに呼ぶ */
export async function loadPreferences(): Promise<void> {
  const keys = Object.keys(valid) as (keyof Preferences)[];
  const records = await db.settings.bulkGet(keys);
  keys.forEach((key, i) => {
    const value = records[i]?.value;
    if (valid[key](value)) (preferences as unknown as Record<string, unknown>)[key] = value;
  });
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
