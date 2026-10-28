import "fake-indexeddb/auto";
import { db } from "../src/db";
import { Rating, recordReview, State } from "../src/fsrs";

describe("押しまちがいの取り消し", () => {
  beforeEach(async () => {
    await Promise.all([db.schedules.clear(), db.reviewEvents.clear()]);
  });

  it("初めて解いた問題を取り消すと、覚え具合も解いた記録も残らない", async () => {
    const { undo } = await recordReview("femur", "point", Rating.Again, { durationMs: 1000, source: "review" });
    expect(await db.schedules.count()).toBe(1);
    await undo();
    expect(await db.schedules.count()).toBe(0);
    expect(await db.reviewEvents.count()).toBe(0);
  });

  it("前に解いたことのある問題は、解く前の覚え具合に戻る", async () => {
    const first = await recordReview("femur", "point", Rating.Good, { durationMs: 1000, source: "review" }, new Date("2026-10-01T00:00:00Z"));
    const second = await recordReview("femur", "point", Rating.Again, { durationMs: 1000, source: "review" }, new Date("2026-10-10T00:00:00Z"));
    expect(second.schedule.lapses + second.schedule.reps).toBeGreaterThan(first.schedule.reps);
    await second.undo();
    expect(await db.schedules.get("femur:point")).toEqual(first.schedule);
    expect(await db.reviewEvents.count()).toBe(1);
    expect((await db.schedules.get("femur:point"))?.state).not.toBe(State.New);
  });
});
