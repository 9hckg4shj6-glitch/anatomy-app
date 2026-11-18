import "fake-indexeddb/auto";
import { isPlateUnit, onPlateShelf, organById, organOfLesson, plateOfTerm, termById, terms, units } from "../src/content";
import { beginnerUnits, organLessons } from "../src/course";
import { preferences } from "../src/settings";
import { facetsFor, TERM_FACETS } from "../src/study";
import { nextLesson, pathUnits } from "../src/ui/lessons";
import { termCard } from "../src/ui/term-card";

const withMode = async (mode: "beginner" | "detail", run: () => void | Promise<void>) => {
  const before = preferences.mode;
  preferences.mode = mode;
  try {
    await run();
  } finally {
    preferences.mode = before;
  }
};

describe("語の棚（docs/学びやすさ.md の案1）", () => {
  it("平面図の語と3Dの小さい語は図の棚、ふつうの3Dの語は立体の棚", () => {
    expect(onPlateShelf(termById.get("epidermis")!)).toBe(true);
    expect(onPlateShelf(termById.get("atrioventricular-node")!)).toBe(true);
    expect(termById.get("atrioventricular-node")!.small).toBe(true);
    expect(onPlateShelf(termById.get("humerus")!)).toBe(false);
    expect(onPlateShelf(termById.get("greater-tubercle")!)).toBe(false);
    // 図の棚は全体の2割ほど
    const share = terms.filter(onPlateShelf).length / terms.length;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.25);
  });

  it("組織・発生・皮膚のレッスンは図のレッスンで、学ぶの道すじには出ない", async () => {
    for (const id of ["tis-levels", "tis-cell", "cv-heart-tube", "dig-gut-development", "integ-skin", "uro-nephron", "nerv-brainstem-nuclei"]) {
      expect(isPlateUnit(units.find((unit) => unit.id === id)!)).toBe(true);
    }
    for (const id of ["cv-heart", "resp-lobes"]) expect(isPlateUnit(units.find((unit) => unit.id === id)!)).toBe(false);
    await withMode("detail", () => {
      const path = pathUnits();
      expect(path.some((unit) => unit.id === "tis-levels")).toBe(false);
      expect(path.some((unit) => unit.system === "tissues" || unit.system === "integumentary")).toBe(false);
      expect(path.length).toBeGreaterThan(200);
      // 次のレッスンも道すじから（最後に学んだのが図のレッスンでも）
      const tissue = units.find((unit) => unit.id === "tis-levels")!;
      const learned = tissue.terms.map((term) => ({ termId: term.id, unitId: tissue.id, learnedAt: "2026-11-01T00:00:00.000Z" }));
      expect(isPlateUnit(nextLesson(learned)!)).toBe(false);
    });
  });

  it("図のレッスンは、どれも臓器の図の「図で学ぶレッスン」に入る（初心者コースも）", async () => {
    await withMode("detail", () => {
      const plateUnits = units.filter(isPlateUnit);
      expect(plateUnits.length).toBeGreaterThan(50);
      for (const unit of plateUnits) expect(organOfLesson(unit), unit.id).toBeTruthy();
      expect(organLessons(organById.get("tissues")!).map((unit) => unit.id)).toContain("tis-levels");
      expect(organLessons(organById.get("development")!).map((unit) => unit.id)).toEqual(["cv-heart-tube", "cv-heart-septation", "dig-gut-development", "dig-liver-pancreas-development"]);
    });
    await withMode("beginner", () => {
      for (const unit of beginnerUnits.filter(isPlateUnit)) expect(organOfLesson(unit), unit.id).toBeTruthy();
      expect(organLessons(organById.get("tissues")!).every((unit) => unit.id.startsWith("b-"))).toBe(true);
      expect(organLessons(organById.get("tissues")!).length).toBeGreaterThan(0);
    });
  });
});

describe("3Dで無理な語の問い方（docs/学びやすさ.md の案3）", () => {
  it("小さい語には名前→位置（タップ）を出さない", () => {
    const small = termById.get("anterior-communicating-artery")!;
    expect(small.small).toBe(true);
    expect(facetsFor(small, false, TERM_FACETS)).not.toContain("point");
    expect(facetsFor(small, false, TERM_FACETS)).toContain("locate");
    expect(facetsFor(termById.get("humerus"), false, TERM_FACETS)).toContain("point");
  });

  it("平面図に載っている小さい語は、その図で問う", () => {
    const withPlate = terms.filter((term) => term.seePlate);
    expect(withPlate.length).toBeGreaterThan(10);
    for (const term of withPlate) expect(plateOfTerm(term)?.plate.id).toBe(term.seePlate);
  });

  it("模式の立体の語のカードには「模式」の札を出す", () => {
    const pyramid = termById.get("renal-pyramid")!;
    expect(pyramid.schematic).toBe(true);
    expect(termCard(pyramid).querySelector(".term-schematic")?.textContent).toContain("模式");
    expect(termCard(termById.get("humerus")!).querySelector(".term-schematic")).toBeNull();
    // 肺区域・胸膜・心臓の刺激伝導系も
    for (const id of ["apical-segment-of-lung", "costodiaphragmatic-recess", "sinuatrial-node"]) expect(termById.get(id)!.schematic).toBe(true);
  });
});
