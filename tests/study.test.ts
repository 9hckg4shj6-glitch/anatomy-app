import "fake-indexeddb/auto";
import { Rating, State, nextSchedule } from "../src/fsrs";
import { buildQueue, pickChoices, termMastery, typesEnglish } from "../src/study";
import type { LearnedTerm, StoredSchedule } from "../src/db";

const now = new Date("2026-11-01T09:00:00Z");
const learned = (termId: string, at = "2026-10-30T00:00:00Z"): LearnedTerm => ({ termId, unitId: "u", learnedAt: at });

function reviewed(termId: string, facet: StoredSchedule["facet"], rating: Rating, at: Date): StoredSchedule {
  return nextSchedule(undefined, termId, facet, rating as never, at);
}

describe("出題の順番", () => {
  it("期限の来た復習を先に、新しい問い方を上限まで後に出す", () => {
    const due = { ...reviewed("femur", "point", Rating.Good, new Date("2026-10-20T00:00:00Z")), due: "2026-10-31T00:00:00Z" };
    const queue = buildQueue([learned("femur"), learned("tibia")], [due], now, 3);
    expect(queue[0]).toEqual({ termId: "femur", facet: "point", isNew: false });
    expect(queue.slice(1).every((item) => item.isNew)).toBe(true);
    expect(queue).toHaveLength(4);
  });

  it("新しい問い方は、同じ語が続かないよう問い方ごとに並べる", () => {
    const queue = buildQueue([learned("femur"), learned("tibia")], [], now, 8);
    expect(queue.map((item) => item.facet).slice(0, 4)).toEqual(["locate", "locate", "point", "point"]);
  });

  it("レッスンで見ていない語は出さない。期限前の復習も出さない", () => {
    const future = reviewed("femur", "point", Rating.Good, now);
    expect(buildQueue([], [future], now, 10)).toEqual([]);
    const queue = buildQueue([learned("femur")], [future], now, 10);
    expect(queue.some((item) => item.facet === "point")).toBe(false);
  });

  it("先に学んだレッスンの問い方を先に出す（レッスンの中では問い方ごと）", () => {
    const queue = buildQueue([learned("femur", "2026-10-29T00:00:00Z"), learned("tibia", "2026-10-30T00:00:00Z")], [], now, 8);
    expect(queue.slice(0, 4).every((item) => item.termId === "femur")).toBe(true);
    expect(queue.slice(4).every((item) => item.termId === "tibia")).toBe(true);
  });

  it("上限が0以下なら新しい問い方は出さない", () => {
    expect(buildQueue([learned("femur")], [], now, -2)).toEqual([]);
  });
});

describe("選択肢", () => {
  it("正解を含み、表示が重複せず、指定の数になる", () => {
    const names: Record<string, string> = { a: "上腕骨", b: "橈骨", c: "尺骨", d: "尺骨", e: "鎖骨", f: "肩甲骨" };
    const choices = pickChoices("a", ["d", "c", "b"], Object.keys(names), (id) => names[id], 4, () => 0.3);
    expect(choices).toContain("a");
    expect(choices).toHaveLength(4);
    expect(new Set(choices.map((id) => names[id])).size).toBe(4);
  });
});

describe("覚え具合と入力への切り替え", () => {
  it("一度も解いていなければ null、解いたら 0〜1", () => {
    expect(termMastery([])).toBeNull();
    const value = termMastery([reviewed("femur", "locate", Rating.Good, now)], new Date(now.getTime() + 86_400_000));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("日→英は復習の段階に入って2回以上解いたら入力式", () => {
    let schedule = reviewed("femur", "ja2en", Rating.Good, now);
    expect(typesEnglish(schedule)).toBe(false);
    for (let day = 1; day <= 4; day++) schedule = nextSchedule(schedule, "femur", "ja2en", Rating.Good as never, new Date(now.getTime() + day * 3 * 86_400_000));
    expect(schedule.state).toBe(State.Review);
    expect(typesEnglish(schedule)).toBe(true);
  });
});

describe("筋の起始・停止・支配神経・作用", () => {
  it("筋だけに付き、位置→名前を覚えてから（復習の段階に入ってから）出す", async () => {
    const { facetsFor } = await import("../src/study");
    expect(facetsFor({ nerve: "腋窩神経" }, false)).toEqual(["locate", "point", "ja2en", "en2ja"]);
    expect(facetsFor({ nerve: "腋窩神経" }, true)).toEqual(["locate", "point", "ja2en", "en2ja", "attach", "nerve", "action"]);
    expect(facetsFor({}, true)).toEqual(["locate", "point", "ja2en", "en2ja"]);
  });
});

describe("隠れた部位", () => {
  it("xray の語には「名前→位置」を出さない", async () => {
    const { facetsFor } = await import("../src/study");
    expect(facetsFor({ xray: true })).not.toContain("point");
    expect(facetsFor({})).toContain("point");
    const queue = buildQueue([learned("thalamus")], [], now, 10, () => facetsFor({ xray: true }));
    expect(queue.map((item) => item.facet)).toEqual(["locate", "ja2en", "en2ja"]);
  });
});
