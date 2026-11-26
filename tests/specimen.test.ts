import "fake-indexeddb/auto";
import indexJson from "../public/models/index.json";
import { termById } from "../src/content";
import { preferences } from "../src/settings";
import { inCourse } from "../src/course";
import type { StoredSchedule } from "../src/db";
import { levelOf, SPECIMEN_PIECES, SPECIMEN_TOTAL, specimenState } from "../src/specimen";

/** わたしの標本（src/specimen.ts）: 206本の数え方と、並べる骨・色のあせ方 */
const index = indexJson as unknown as { terms: Record<string, { system: string; elements: string[] }> };

describe("骨の一覧", () => {
  it("合わせて206本（頭蓋22・耳小骨6・舌骨1・脊柱26・胸骨1・肋骨24・上肢64・下肢62）", () => {
    expect(SPECIMEN_TOTAL).toBe(206);
    const sum = (region: string) => SPECIMEN_PIECES.filter((item) => item.region === region).reduce((n, item) => n + item.count, 0);
    expect(sum("skull")).toBe(23);
    expect(sum("ear")).toBe(6);
    expect(sum("spine")).toBe(26);
    expect(sum("thorax")).toBe(25);
    expect(sum("upper")).toBe(64);
    expect(sum("lower")).toBe(62);
  });

  it("どの骨の語もあり、3Dの部品の数が本数と同じ（胸骨だけ3つの部品で1本）。部品は重ならない", () => {
    const seen = new Set<string>();
    for (const item of SPECIMEN_PIECES) {
      expect(termById.has(item.term), item.term).toBe(true);
      const elements = index.terms[item.term]?.elements ?? [];
      expect(elements.length, item.term).toBe(item.term === "sternum" ? 3 : item.count);
      for (const element of elements) {
        expect(seen.has(element), `${item.term} ${element}`).toBe(false);
        seen.add(element);
      }
      if (item.group) expect(termById.has(item.group), item.group).toBe(true);
    }
  });
});

const schedule = (termId: string, stability: number, daysAgo: number): StoredSchedule => {
  const last = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    cardId: `${termId}:locate`, termId, facet: "locate", due: last, stability, difficulty: 5, elapsedDays: 0, scheduledDays: 1,
    learningSteps: 0, reps: 3, lapses: 0, state: 2, lastReview: last, updatedAt: last,
  };
};

describe("並べる骨", () => {
  it("詳細コースでは骨の語を学んだときだけ並ぶ（「肋骨」を学んでも第1肋骨は並ばない）", () => {
    const before = preferences.mode;
    preferences.mode = "detail";
    try {
      const state = specimenState(new Set(["femur", "ribs"]), () => [], inCourse);
      expect(state.reachable).toBe(206);
      expect(state.placed.map((item) => item.term)).toEqual(["femur"]);
      expect(state.bones).toBe(2);
      expect(state.byRegion.get("lower")).toEqual({ bones: 2, total: 62 });
    } finally {
      preferences.mode = before;
    }
  });

  it("初心者コースでは、コースに無い骨をまとめた語（頚椎・手根骨など）で並べる", () => {
    const before = preferences.mode;
    preferences.mode = "beginner";
    try {
      const state = specimenState(new Set(["cervical-vertebrae", "carpal-bones"]), () => [], inCourse);
      expect(state.reachable).toBeLessThan(206);
      // 環椎・軸椎は初心者コースにもあるので、それぞれの語で（頚椎で並ぶのは第3〜第7頚椎の5本）
      expect(state.byRegion.get("spine")!.bones).toBe(5);
      expect(state.byRegion.get("upper")!.bones).toBe(16);
      expect(state.placed.every((item) => item.by === "cervical-vertebrae" || item.by === "carpal-bones")).toBe(true);
    } finally {
      preferences.mode = before;
    }
  });

  it("忘れかけるほど色があせる（90%以上はきれい、70%未満は手入れ）", () => {
    expect(levelOf(null)).toBe("fresh");
    expect(levelOf(0.95)).toBe("fresh");
    expect(levelOf(0.8)).toBe("dull");
    expect(levelOf(0.5)).toBe("faded");
    const before = preferences.mode;
    preferences.mode = "detail";
    try {
      const schedules: Record<string, StoredSchedule[]> = { femur: [schedule("femur", 30, 1)], tibia: [schedule("tibia", 1, 30)] };
      const state = specimenState(new Set(["femur", "tibia"]), (id) => schedules[id] ?? [], inCourse);
      expect(state.placed.find((item) => item.term === "femur")!.level).toBe("fresh");
      expect(state.placed.find((item) => item.term === "tibia")!.level).toBe("faded");
    } finally {
      preferences.mode = before;
    }
  });
});
