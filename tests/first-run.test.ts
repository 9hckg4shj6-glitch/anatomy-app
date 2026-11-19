import "fake-indexeddb/auto";
import { db, markLearned, type StoredSchedule } from "../src/db";
import { State } from "../src/fsrs";
import { needsStart, TRIAL_LESSON } from "../src/profile";
import { lessonById } from "../src/course";
import { facetsFor } from "../src/study";
import { preferences } from "../src/settings";
import { todayCounts } from "../src/ui/review";

/** docs/普段使い.md「はじめての人の使いにくさの見直し」 */
describe("はじめての人の使いにくさの見直し", () => {
  const before = { mode: preferences.mode, newPerDay: preferences.newPerDay };
  afterEach(async () => {
    preferences.mode = before.mode;
    preferences.newPerDay = before.newPerDay;
    await Promise.all([db.learned.clear(), db.schedules.clear(), db.reviewEvents.clear(), db.settings.clear()]);
  });

  const profile = { name: "テスト", university: "その他", faculty: "その他", grade: "1年" };

  it("スタート画面は、名前と所属がまだか、はじめての人（3語だけの人も）がコースを選ぶまで出す", () => {
    expect(needsStart(null, 0, false, "")).toBe(true);
    // 3語を試したあと、名前を入れる前
    expect(needsStart(null, 3, true, "")).toBe(true);
    // 名前と所属を入れて、コースを選ぶ前に閉じた
    expect(needsStart(profile, 3, true, "")).toBe(true);
    expect(needsStart(profile, 3, true, "basic")).toBe(false);
    // 今まで使っていた人（3語のレッスンを通っていない）はコースを聞かない
    expect(needsStart(profile, 40, false, "")).toBe(false);
    expect(needsStart({ ...profile, grade: "" }, 40, false, "")).toBe(true);
  });

  it("はじめにの3語は、正面から見えて3Dをタップして答えられる骨", () => {
    const unit = lessonById.get(TRIAL_LESSON)!;
    const trial = unit.terms.slice(0, 3);
    expect(trial.map((term) => term.id)).toEqual(["femur", "patella", "tibia"]);
    for (const term of trial) expect(facetsFor(term)).toContain("point");
  });

  it("学び直した語は、初めに学んだ日時のまま（仕上げに移さない）", async () => {
    await markLearned([{ termId: "femur", unitId: "a" }], "2026-11-01T00:00:00.000Z");
    await markLearned([{ termId: "femur", unitId: "b" }, { termId: "tibia", unitId: "b" }], "2026-11-19T00:00:00.000Z");
    expect(await db.learned.get("femur")).toEqual({ termId: "femur", unitId: "b", learnedAt: "2026-11-01T00:00:00.000Z" });
    expect((await db.learned.get("tibia"))?.learnedAt).toBe("2026-11-19T00:00:00.000Z");
  });

  it("今日学んだ語は今日の復習に入れず仕上げに。新しい問題の上限は別々に数える", async () => {
    preferences.mode = "detail";
    preferences.newPerDay = 1;
    const now = new Date(2026, 10, 19, 15);
    const yesterday = new Date(2026, 10, 18, 20).toISOString();
    const today = new Date(2026, 10, 19, 14).toISOString();
    await db.learned.bulkPut([
      { termId: "femur", unitId: "x", learnedAt: yesterday },
      { termId: "humerus", unitId: "y", learnedAt: today },
    ]);
    // 今日のレッスンの確認テストで解いた（10分後に期限が来る）
    const learning: StoredSchedule = {
      cardId: "humerus:locate", termId: "humerus", facet: "locate", due: new Date(2026, 10, 19, 14, 10).toISOString(),
      stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 0, learningSteps: 1, reps: 1, lapses: 0,
      state: State.Learning, lastReview: today, updatedAt: today,
    };
    await db.schedules.put(learning);
    // 仕上げで新しい問題を1つ解いた（今日の復習の新しい問題の上限は減らさない）
    await db.reviewEvents.put({
      id: "e1", cardId: "humerus:point", termId: "humerus", facet: "point", rating: 3, reviewedAt: today, durationMs: 1000, isNew: true, source: "review",
    });
    expect(await todayCounts(now)).toEqual({ review: 0, fresh: 1, finish: 1 });
    // 次の日には、きのう学んだ語として今日の復習に入る
    expect(await todayCounts(new Date(2026, 10, 20, 9))).toMatchObject({ finish: 0 });
  });
});
