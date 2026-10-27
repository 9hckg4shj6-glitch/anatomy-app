import { db, type LearnedTerm, type ReviewEvent, type SettingRecord, type StoredSchedule } from "./db";

/**
 * 学習の記録の書き出し・読み込み。記録は端末ごと（IndexedDB）なので、機種変更や
 * iOS の Safari とホーム画面のアプリの間で移すときに使う（端末をまたぐ同期の代わり）。
 */
export interface Backup {
  app: "anatomy-study";
  version: 1;
  exportedAt: string;
  schedules: StoredSchedule[];
  reviewEvents: ReviewEvent[];
  learned: LearnedTerm[];
  settings: SettingRecord[];
}

export async function exportBackup(): Promise<Backup> {
  const [schedules, reviewEvents, learned, settings] = await Promise.all([
    db.schedules.toArray(), db.reviewEvents.toArray(), db.learned.toArray(), db.settings.toArray(),
  ]);
  return { app: "anatomy-study", version: 1, exportedAt: new Date().toISOString(), schedules, reviewEvents, learned, settings };
}

export function isBackup(data: unknown): data is Backup {
  const b = data as Partial<Backup> | null;
  return !!b && b.app === "anatomy-study" && b.version === 1
    && [b.schedules, b.reviewEvents, b.learned, b.settings].every(Array.isArray);
}

/** 同じカードは、最後に解いたのが新しい方を残す（同じなら更新の新しい方） */
export function newerSchedule(a: StoredSchedule, b: StoredSchedule): StoredSchedule {
  const last = (s: StoredSchedule) => s.lastReview ?? "";
  if (last(a) !== last(b)) return last(a) > last(b) ? a : b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

/**
 * 読み込んだ記録を今の記録に合わせる（上書きではなく足し合わせる）。
 * 解いた履歴は ID で重ねずに足し、レッスンで見た語は早い方の日時、設定は新しい方を残す。
 */
export async function importBackup(backup: Backup): Promise<{ schedules: number; reviewEvents: number; learned: number }> {
  return db.transaction("rw", [db.schedules, db.reviewEvents, db.learned, db.settings], async () => {
    const schedules = new Map((await db.schedules.toArray()).map((s) => [s.cardId, s]));
    const changed = backup.schedules.filter((incoming) => {
      const local = schedules.get(incoming.cardId);
      return !local || newerSchedule(local, incoming) === incoming;
    });
    await db.schedules.bulkPut(changed);

    const eventIds = new Set(await db.reviewEvents.toCollection().primaryKeys());
    const events = backup.reviewEvents.filter((event) => !eventIds.has(event.id));
    await db.reviewEvents.bulkAdd(events);

    const learned = new Map((await db.learned.toArray()).map((item) => [item.termId, item]));
    const earlier = backup.learned.filter((item) => !learned.has(item.termId) || item.learnedAt < learned.get(item.termId)!.learnedAt);
    await db.learned.bulkPut(earlier);

    const settings = new Map((await db.settings.toArray()).map((item) => [item.key, item]));
    await db.settings.bulkPut(backup.settings.filter((item) => !settings.has(item.key) || item.updatedAt > settings.get(item.key)!.updatedAt));

    return { schedules: changed.length, reviewEvents: events.length, learned: earlier.length };
  });
}
