import { Rating, State, createEmptyCard, fsrs, type Card as FsrsCard, type Grade } from "ts-fsrs";
import { db, nowIso, type Facet, type ReviewEvent, type StoredSchedule } from "./db";

// 基礎医学演習アプリ（src/fsrs.ts）と同じ設定
const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

export { Rating, State };

export function storedToCard(card: StoredSchedule): FsrsCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
  };
}

export function cardToStored(termId: string, facet: Facet, card: FsrsCard): StoredSchedule {
  return {
    cardId: `${termId}:${facet}`,
    termId,
    facet,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.toISOString() ?? null,
    updatedAt: nowIso(),
  };
}

export function nextSchedule(
  previous: StoredSchedule | undefined,
  termId: string,
  facet: Facet,
  rating: Grade,
  at = new Date(),
): StoredSchedule {
  const card = previous ? storedToCard(previous) : createEmptyCard(at);
  // 端末の時計ずれで最終復習が未来だと next() が例外を投げるので、その場合は今を最終復習とみなす
  if (card.last_review && card.last_review.getTime() > at.getTime()) card.last_review = at;
  return cardToStored(termId, facet, scheduler.next(card, at, rating).card);
}

export async function recordReview(
  termId: string,
  facet: Facet,
  rating: Grade,
  options: { durationMs: number | null; source: ReviewEvent["source"] },
  at = new Date(),
): Promise<StoredSchedule> {
  const cardId = `${termId}:${facet}`;
  const previous = await db.schedules.get(cardId);
  const schedule = nextSchedule(previous, termId, facet, rating, at);
  const event: ReviewEvent = {
    id: crypto.randomUUID(),
    cardId,
    termId,
    facet,
    rating,
    reviewedAt: at.toISOString(),
    durationMs: options.durationMs,
    isNew: !previous || previous.state === State.New,
    source: options.source,
  };
  await db.transaction("rw", db.schedules, db.reviewEvents, async () => {
    await db.reviewEvents.add(event);
    await db.schedules.put(schedule);
  });
  window.dispatchEvent(new CustomEvent("anatomy:reviewed"));
  return schedule;
}

/** 今この時点で思い出せる確率（0〜1）。一度も解いていなければ null。 */
export function retrievability(schedule: StoredSchedule | undefined, at = new Date()): number | null {
  if (!schedule || schedule.state === State.New || !schedule.lastReview) return null;
  return scheduler.get_retrievability(storedToCard(schedule), at, false) as number;
}

/** 次の復習までを「10分後」「3日後」のように */
export function dueLabel(schedule: StoredSchedule, from = new Date()): string {
  const minutes = Math.round((new Date(schedule.due).getTime() - from.getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}分後`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}時間後`;
  const days = Math.round(minutes / 60 / 24);
  return days < 31 ? `${days}日後` : `${Math.round(days / 30)}か月後`;
}
