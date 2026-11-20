import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { units } from "../src/content";
import { practiceQueue, TERM_KINDS, type PracticeCandidate } from "../src/study";
import { DRILL_COUNTS, kindsLabel, levelsFor, minutesFor, parseCondition, recentUnits } from "../src/ui/drill";

/** 演習の見直し（段階に分ける。docs/普段使い.md） */
describe("演習の見直し", () => {
  const all = TERM_KINDS.map((kind) => kind.key);
  const basic = ["locate", "point", "ja2en", "en2ja"];

  it("問い方の段階: 名前と場所 → ＋英語 → 総仕上げ。英語→日本語は学ぶ問い方に入れている人だけ「＋英語」に", () => {
    const first = levelsFor(all, ["locate", "point", "ja2en"]);
    expect(first.map((level) => level.title)).toEqual(["名前と場所", "＋英語", "総仕上げ"]);
    expect(first[1].kinds).toEqual(["locate", "point", "ja2en"]);
    expect(first[2].kinds).toEqual(all);
    expect(levelsFor(all, all)[1].kinds).toEqual(basic);
  });

  it("初心者モード（基本の4つだけ）では総仕上げを出さない", () => {
    expect(levelsFor(basic, ["locate", "point", "ja2en"]).map((level) => level.title)).toEqual(["名前と場所", "＋英語"]);
    expect(levelsFor(basic, basic).map((level) => level.title)).toEqual(["名前と場所", "＋英語"]);
  });

  it("問い方の一言: 段階と同じなら段階の名前、1つならその名前、ほかは数", () => {
    const levels = levelsFor(all, ["locate", "point", "ja2en"]);
    expect(kindsLabel(new Set(["locate", "point"]), levels)).toBe("名前と場所");
    expect(kindsLabel(new Set(["locate", "point", "ja2en"]), levels)).toBe("＋英語");
    expect(kindsLabel(new Set(all), levels)).toBe("総仕上げ");
    expect(kindsLabel(new Set(["muscle"]), levels)).toBe("筋の起始・停止・神経・作用");
    expect(kindsLabel(new Set(["locate", "muscle"]), levels)).toBe("問い方 2つ");
  });

  it("前回の条件: コースに無い語・出せない問い方を除き、数と出し方は決まった値だけ", () => {
    const termIds = new Set(["femur", "tibia"]);
    const parsed = parseCondition({ ids: ["femur", "gone", 3], kinds: ["locate", "muscle"], count: 40, order: "fresh" }, termIds, basic);
    expect([...parsed!.ids]).toEqual(["femur"]);
    expect([...parsed!.kinds]).toEqual(["locate"]);
    expect(parsed!.count).toBe(40);
    expect(parsed!.order).toBe("fresh");
    expect(parseCondition({ ids: ["femur"], kinds: ["locate"], count: 7, order: "?" }, termIds, basic)).toMatchObject({ count: 20, order: "mix" });
    expect(parseCondition({ ids: ["gone"], kinds: ["locate"] }, termIds, basic)).toBeNull();
    expect(parseCondition(null, termIds, basic)).toBeNull();
    expect(DRILL_COUNTS).toContain(0);
  });

  it("約何分: 1問 約15秒（少なくとも1分）", () => {
    expect(minutesFor(1)).toBe(1);
    expect(minutesFor(20)).toBe(5);
    expect(minutesFor(40)).toBe(10);
  });

  it("最近のレッスン: 学んだ語のあるレッスンを新しく学んだ順に", () => {
    const [a, b, c] = units.filter((unit) => unit.terms.length).slice(0, 3);
    const learnedAt = new Map([[a.terms[0].id, "2026-11-01T00:00:00Z"], [c.terms[0].id, "2026-11-10T00:00:00Z"]]);
    expect(recentUnits([a, b, c], learnedAt).map((unit) => unit.id)).toEqual([c.id, a.id]);
  });

  it("はじめての問題から: まだ解いていない問題を先に、足りなければ解いた問題で埋める", () => {
    const candidate = (termId: string, recall: number | null): PracticeCandidate => ({ termId, facet: "locate", recall, lapses: 0 });
    const queue = practiceQueue([candidate("femur", 0.9), candidate("tibia", null), candidate("fibula", 0.5), candidate("patella", null)], 3, "fresh");
    expect(queue.slice(0, 2).map((item) => item.termId).sort()).toEqual(["patella", "tibia"]);
    expect(queue[2].isNew).toBe(false);
    // 前の形（true・false）も今までどおり
    expect(practiceQueue([candidate("femur", 0.9), candidate("tibia", 0.1)], 2, true).map((item) => item.termId)).toEqual(["tibia", "femur"]);
  });
});
