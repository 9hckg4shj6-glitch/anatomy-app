import { checkEnglish, editDistance, normalizeEnglish } from "../src/answer";

describe("英語の答え合わせ", () => {
  it("大文字小文字・ハイフン・余分な空白は区別しない", () => {
    expect(normalizeEnglish("  Hip-Bone ")).toBe("hip bone");
    expect(checkEnglish("HIP BONE", ["hip bone"])).toBe("correct");
    expect(checkEnglish("hip-bone", ["hip bone"])).toBe("correct");
  });

  it("別名も正解にする", () => {
    expect(checkEnglish("os coxae", ["hip bone", "coxal bone", "os coxae"])).toBe("correct");
  });

  it("5文字以上の語の1文字違い（入れ替えを含む）は惜しい", () => {
    expect(editDistance("humreus", "humerus")).toBe(1);
    expect(checkEnglish("humreus", ["humerus"])).toBe("close");
    expect(checkEnglish("clavical", ["clavicle"])).toBe("wrong");
    expect(checkEnglish("fmur", ["femur"])).toBe("close");
  });

  it("短い語は1文字違いでも不正解、空欄も不正解", () => {
    expect(checkEnglish("ulnu", ["ulna"])).toBe("wrong");
    expect(checkEnglish("   ", ["ulna"])).toBe("wrong");
  });
});
