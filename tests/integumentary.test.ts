import { describe, expect, it } from "vitest";
import { isDrawn, plateOfTerm, termById, terms } from "../src/content";
import { facetsFor } from "../src/study";

describe("外皮（平面図の語）", () => {
  const skin = terms.filter((term) => term.system === "integumentary");

  it("外皮の語はみな平面図の語で、皮膚の図の上にある", () => {
    expect(skin.length).toBeGreaterThanOrEqual(30);
    for (const term of skin) {
      expect(term.plate).toBeTruthy();
      expect(plateOfTerm(term)?.organ.id).toBe("skin");
      expect(isDrawn(term)).toBe(true);
    }
  });

  it("平面図の語には名前→位置（3Dでタップ）を出さない", () => {
    const facets = facetsFor(termById.get("epidermis"), true);
    expect(facets).toContain("locate");
    expect(facets).not.toContain("point");
  });
});

describe("ホルモン", () => {
  it("内分泌腺とホルモンを出す器官にホルモンがあり、場所を覚えてから出す", () => {
    for (const id of ["adenohypophysis", "neurohypophysis", "thyroid-gland", "parathyroid-gland", "adrenal-gland", "pancreas", "testis", "kidney"]) {
      expect(termById.get(id)?.hormones).toBeTruthy();
    }
    expect(facetsFor(termById.get("adrenal-gland"), true)).toContain("hormone");
    expect(facetsFor(termById.get("adrenal-gland"), false)).not.toContain("hormone");
  });

  it("前葉・後葉と重なる下垂体そのものにはホルモンを書かない（どちらとも答えられてしまう）", () => {
    expect(termById.get("pituitary-gland")?.hormones).toBeUndefined();
  });
});
