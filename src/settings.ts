import { db, nowIso } from "./db";

/** 進捗の画面で変えられる設定。db.settings に1つずつ保存し、起動したときに読む */
export interface Preferences {
  /** レッスン・図鑑・答え合わせで英語の発音を自動で鳴らす（🔊を押せばいつでも鳴る） */
  autoSpeak: boolean;
  /** 1日に新しく始める問い方の数（4つの問い方を別々に数える） */
  newPerDay: number;
}

export const NEW_PER_DAY_OPTIONS = [10, 20, 30, 40];

export const preferences: Preferences = { autoSpeak: true, newPerDay: 20 };

const valid: { [K in keyof Preferences]: (value: unknown) => value is Preferences[K] } = {
  autoSpeak: (value): value is boolean => typeof value === "boolean",
  newPerDay: (value): value is number => typeof value === "number" && NEW_PER_DAY_OPTIONS.includes(value),
};

/** 起動したときと、記録を読み込んだときに呼ぶ */
export async function loadPreferences(): Promise<void> {
  const keys = Object.keys(valid) as (keyof Preferences)[];
  const records = await db.settings.bulkGet(keys);
  keys.forEach((key, i) => {
    const value = records[i]?.value;
    if (valid[key](value)) (preferences as unknown as Record<string, unknown>)[key] = value;
  });
}

export async function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
  preferences[key] = value;
  await db.settings.put({ key, value, updatedAt: nowIso() });
}
