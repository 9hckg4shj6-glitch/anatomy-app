import Dexie, { type EntityTable } from "dexie";

/**
 * 語に付く問い方。locate＝位置→名前, point＝名前→位置, ja2en＝日→英, en2ja＝英→日（聞き取り）。
 * 筋にはさらに attach＝起始・停止, nerve＝支配神経, action＝作用 が付く。
 * 語根カード（termId が "root:…"）は rootMeaning＝語根→意味, rootForm＝意味→語根。
 */
export type Facet = "locate" | "point" | "ja2en" | "en2ja" | "attach" | "nerve" | "action" | "rootMeaning" | "rootForm";

export interface StoredSchedule {
  /** `${termId}:${facet}` */
  cardId: string;
  termId: string;
  facet: Facet;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  updatedAt: string;
}

export interface ReviewEvent {
  id: string;
  cardId: string;
  termId: string;
  facet: Facet;
  rating: number;
  reviewedAt: string;
  durationMs: number | null;
  /** その問い方を初めて解いた回か（1日の新規上限を数えるのに使う） */
  isNew: boolean;
  /** レッスンの確認テストか、復習か、範囲を選んだ演習か。新規上限は復習の分だけを数える。 */
  source: "lesson" | "review" | "practice";
}

/** レッスンで一度見た語。復習（演習）にはここにある語だけが出る。 */
export interface LearnedTerm {
  termId: string;
  unitId: string;
  learnedAt: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class AnatomyDatabase extends Dexie {
  schedules!: EntityTable<StoredSchedule, "cardId">;
  reviewEvents!: EntityTable<ReviewEvent, "id">;
  learned!: EntityTable<LearnedTerm, "termId">;
  settings!: EntityTable<SettingRecord, "key">;

  constructor() {
    super("anatomy-study-v1");
    this.version(1).stores({
      schedules: "&cardId, termId, due, state",
      reviewEvents: "&id, cardId, termId, reviewedAt",
      learned: "&termId, unitId, learnedAt",
      settings: "&key",
    });
  }
}

export const db = new AnatomyDatabase();

export function nowIso(): string {
  return new Date().toISOString();
}
