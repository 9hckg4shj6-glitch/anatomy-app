import { preferences } from "../src/settings";
import { fold, lookup, romajiToKana, searchTerms, suggest } from "../src/search";

/** docs/普段使い.md「調べるの見直し」: 並べ方・表記ゆれ・ローマ字・もしかして・コースの外の語 */
const withMode = (mode: "beginner" | "standard" | "detail", run: () => void) => {
  const before = preferences.mode;
  preferences.mode = mode;
  try {
    run();
  } finally {
    preferences.mode = before;
  }
};
const ids = (query: string, all = true) => lookup(query, { all }).map((hit) => hit.term.id);

describe("調べるの検索", () => {
  it("名前がそのまま同じ語・頭から当たる語・途中に当たる語の順", () => {
    withMode("detail", () => {
      expect(ids("じょうわん")[0]).toBe("arm");
      expect(ids("上腕骨")[0]).toBe("humerus");
      expect(ids("humerus")[0]).toBe("humerus");
      // 頭から当たる語（大腿骨）は、途中に当たる語（～大腿骨～）より先
      const list = ids("大腿骨");
      expect(list[0]).toBe("femur");
      expect(list.indexOf("femur")).toBeLessThan(list.findIndex((id) => !id.startsWith("femur") && id !== "femur"));
    });
  });

  it("字の違い（頸と頚）・区切り（sacro iliac）・大文字とカタカナをそろえる", () => {
    expect(fold("頸動脈")).toBe(fold("頚動脈"));
    expect(fold("Sacro-Iliac")).toBe("sacroiliac");
    expect(fold("ジョウワン")).toBe("じょうわん");
    withMode("detail", () => {
      expect(ids("頸動脈")).toContain("common-carotid-artery");
      expect(ids("sacro iliac")).toContain("sacro-iliac-joint");
      expect(ids("sacroiliac")).toContain("sacro-iliac-joint");
    });
  });

  it("ローマ字の読みでも探せる（jouwan → じょうわん）。英語として読めない並びはローマ字にしない", () => {
    expect(romajiToKana("jouwan")).toBe("じょうわん");
    expect(romajiToKana("kyoukotsu")).toBe("きょうこつ");
    expect(romajiToKana("sakkotsu")).toBe("さっこつ");
    expect(romajiToKana("shinzou")).toBe("しんぞう");
    expect(romajiToKana("daitaik")).toBe("だいたい");
    expect(romajiToKana("ulna")).toBeNull();
    withMode("detail", () => {
      expect(ids("jouwankotsu")[0]).toBe("humerus");
      expect(ids("shinzou")).toContain("heart");
      // 英語で当たる語はローマ字の読みより先
      expect(ids("femur")[0]).toBe("femur");
    });
  });

  it("見つからないときは「もしかして」で1〜2字ちがいの語", () => {
    withMode("detail", () => {
      expect(ids("上椀骨")).toHaveLength(0);
      expect(suggest("上椀骨").map((term) => term.id)).toContain("humerus");
      expect(suggest("humerous").map((term) => term.id)).toContain("humerus");
      expect(suggest("あ")).toHaveLength(0);
    });
  });

  it("調べるではコースの外の語も引け、コースの語の後に出る（同じ名前の語だけは先頭）", () => {
    withMode("beginner", () => {
      // 演習・図鑑の検索（searchTerms）はコースの語だけ
      expect(searchTerms("きょくこう")).toHaveLength(0);
      const hits = lookup("頚動脈", { all: true });
      expect(hits.some((hit) => !hit.inCourse)).toBe(true);
      const firstOutside = hits.findIndex((hit) => !hit.inCourse);
      expect(hits.slice(firstOutside).every((hit) => !hit.inCourse)).toBe(true);
      expect(lookup("棘孔", { all: true })[0]?.term.id).toBe("foramen-spinosum");
    });
  });

  it("自分のメモでも探せる", () => {
    withMode("detail", () => {
      const hits = lookup("先生が出す", { all: true, memo: (id) => (id === "radius" ? "先生が出すと言った" : "") });
      expect(hits.map((hit) => [hit.term.id, hit.via])).toEqual([["radius", "memo"]]);
    });
  });
});
