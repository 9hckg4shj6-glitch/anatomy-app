import { describe, expect, it } from "vitest";
import { PURPOSES, recommendCourse } from "../src/purposes";

describe("使う目的（docs/普段使い.md「はじめての人への案内」）", () => {
  it("1年生には「はじめての解剖」、2年生から上とその他には「標準」をすすめる", () => {
    expect(recommendCourse("1年", [])).toBe("basic");
    expect(recommendCourse("1年", ["class", "lookup"])).toBe("basic");
    expect(recommendCourse("2年", [])).toBe("standard");
    expect(recommendCourse("6年", ["class"])).toBe("standard");
    expect(recommendCourse("その他", [])).toBe("standard");
    expect(recommendCourse(undefined, [])).toBe("standard");
  });

  it("骨学試験・見直しを選んだ人には、1年生でも「標準」（はじめての解剖では骨学試験を使えない）", () => {
    expect(recommendCourse("1年", ["bone"])).toBe("standard");
    expect(recommendCourse("1年", ["review"])).toBe("standard");
  });

  it("「すべての語」はすすめない（自分で選ぶ人のため）", () => {
    for (const grade of ["1年", "2年", "3年", "4年", "5年", "6年", "その他"]) {
      for (const purpose of PURPOSES) expect(recommendCourse(grade, [purpose.id])).not.toBe("free");
    }
  });

  it("どの目的にも、使い方の手順が2つ以上あり、リンクはアプリの中の画面", () => {
    for (const purpose of PURPOSES) {
      expect(purpose.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of purpose.steps) if (step.link) expect(step.link.href).toMatch(/^#\//);
    }
  });
});
