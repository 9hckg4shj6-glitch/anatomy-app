import { systems, termById, units } from "../src/content";
import { areaLabels } from "../src/exam";
import type { LearnedTerm } from "../src/db";
import { normalize, searchTerms, searchUnits } from "../src/search";
import { nextLesson } from "../src/ui/home";

const learnedAll = (unitId: string, at: string): LearnedTerm[] =>
  units.find((unit) => unit.id === unitId)!.terms.map((term) => ({ termId: term.id, unitId, learnedAt: at }));

describe("レッスンのまとまり", () => {
  it("骨格系はすべてのレッスンが骨学試験の区分（総論を除く）のどれかにあり、まとまりごとに続けて並ぶ", () => {
    const skeletal = units.filter((unit) => unit.system === "skeletal");
    const areas = Object.values(areaLabels).filter((label) => label !== "総論");
    expect(new Set(skeletal.map((unit) => unit.group))).toEqual(new Set(areas));
    const order = skeletal.map((unit) => unit.group).filter((group, i, list) => group !== list[i - 1]);
    expect(order).toEqual(areas);
  });

  it("題に「（追加）」が残っていない", () => {
    expect(units.filter((unit) => unit.title.includes("（追加）")).map((unit) => unit.id)).toEqual([]);
  });

  it("まとまりのある系統では、どのレッスンにもまとまりがある", () => {
    for (const system of systems) {
      const list = units.filter((unit) => unit.system === system.id);
      const withGroup = list.filter((unit) => unit.group).length;
      expect([0, list.length]).toContain(withGroup);
    }
  });
});

describe("次のレッスン", () => {
  it("何も学んでいなければ最初のレッスン", () => {
    expect(nextLesson([])?.id).toBe(units[0].id);
  });

  it("最後に学んだレッスンの、同じまとまりの次のレッスンを出す（内容の最初からではない）", () => {
    const learned = [...learnedAll(units[0].id, "2026-10-01T00:00:00.000Z"), ...learnedAll("mus-shoulder", "2026-10-30T00:00:00.000Z")];
    const next = nextLesson(learned)!;
    expect(next.system).toBe("muscular");
    expect(next.group).toBe("上肢");
    expect(next.id).not.toBe("mus-shoulder");
  });

  it("最後に学んだレッスンが途中なら、そのレッスン", () => {
    const [first] = learnedAll("skel-pt-skull-base", "2026-10-30T00:00:00.000Z");
    expect(nextLesson([first])?.id).toBe("skel-pt-skull-base");
  });

  it("記録のレッスンID が古くても（並べ直す前）、語から今のレッスンを引く", () => {
    const termId = "foramen-ovale";
    const now = termById.get(termId)?.unit;
    expect(now).toBeTruthy();
    expect(nextLesson([{ termId, unitId: "skel-pt-cranial-foramina-old", learnedAt: "2026-10-30T00:00:00.000Z" }])?.id).toBe(now);
  });
});

describe("検索", () => {
  it("カタカナ・ひらがな・全角をそろえ、レッスンの題とまとまり、語を探す", () => {
    expect(normalize("ＡＢＣ　カタカナ")).toBe("abc かたかな");
    expect(searchUnits(normalize("頭蓋")).some((unit) => unit.id === "skel-pt-cranial-foramina")).toBe(true);
    expect(searchTerms(normalize("ラン円孔")).length).toBe(0);
    expect(searchTerms(normalize("らんえんこう")).map((term) => term.ja)).toContain("卵円孔");
  });
});
