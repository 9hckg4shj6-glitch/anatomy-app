import { db, nowIso } from "./db";

/**
 * 語に付ける自分の印（★）と一言メモ。db.settings に語ごとに1つ（キー "mark:<語ID>"）入れるので、
 * 記録の書き出し・読み込み（src/backup.ts）では語ごとに新しい方が残る。起動したときと記録を読み込んだときに読む
 */
export interface Mark {
  starred: boolean;
  memo: string;
}

const PREFIX = "mark:";
const marks = new Map<string, Mark>();

const isMark = (value: unknown): value is Mark =>
  !!value && typeof value === "object" && typeof (value as Mark).starred === "boolean" && typeof (value as Mark).memo === "string";

export async function loadMarks(): Promise<void> {
  const records = await db.settings.where("key").startsWith(PREFIX).toArray();
  marks.clear();
  for (const record of records) if (isMark(record.value)) marks.set(record.key.slice(PREFIX.length), record.value);
}

export function markOf(termId: string): Mark {
  return marks.get(termId) ?? { starred: false, memo: "" };
}

export async function setMark(termId: string, mark: Mark): Promise<void> {
  const value = { starred: mark.starred, memo: mark.memo.trim() };
  marks.set(termId, value);
  // ★もメモも無くなっても消さずに残す（読み込みのときに、消したことが古い記録に負けないように）
  await db.settings.put({ key: `${PREFIX}${termId}`, value, updatedAt: nowIso() });
  window.dispatchEvent(new CustomEvent("anatomy:marks"));
}

/** ★を付けた語（付けた順は覚えていないので、呼んだ側で並べる） */
export function starredIds(): string[] {
  return [...marks].filter(([, mark]) => mark.starred).map(([id]) => id);
}

/** 最近見た語（図鑑。端末ごとの便利さなので localStorage。新しい順に8つまで） */
const RECENT = "anatomy-recent";

export function recentTerms(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecent(termId: string): void {
  try {
    localStorage.setItem(RECENT, JSON.stringify([termId, ...recentTerms().filter((id) => id !== termId)].slice(0, 8)));
  } catch {
    // 保存できない（プライベートブラウズなど）ときは覚えない
  }
}
