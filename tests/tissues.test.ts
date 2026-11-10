import { describe, expect, it } from "vitest";
import { isDrawn, organById, plateOfTerm, termById, terms, unitById } from "../src/content";
import { sceneFor } from "../src/ui/context";
import { facetsFor } from "../src/study";

describe("細胞と組織（解剖学総論 I）", () => {
  const tissues = terms.filter((term) => term.system === "tissues");

  it("細胞と組織の語はみな平面図の語で、臓器の図「細胞と組織」の自作の模式図の上にある", () => {
    expect(tissues.length).toBeGreaterThanOrEqual(70);
    for (const term of tissues) {
      const found = plateOfTerm(term);
      expect(found?.organ.id, term.id).toBe("tissues");
      expect(found?.plate.art?.license, term.id).toBe("自作");
      expect(isDrawn(term)).toBe(true);
    }
  });

  it("4つの組織・上皮の種類・筋の種類・神経膠細胞がそろっている", () => {
    for (const id of ["epithelial-tissue", "connective-tissue", "muscle-tissue", "nervous-tissue",
      "simple-squamous-epithelium", "simple-cuboidal-epithelium", "simple-columnar-epithelium", "stratified-squamous-epithelium", "pseudostratified-ciliated-epithelium", "transitional-epithelium",
      "skeletal-muscle", "cardiac-muscle", "smooth-muscle", "astrocyte", "oligodendrocyte", "microglia", "ependymal-cell", "schwann-cell", "satellite-cell",
      "intradermal-injection", "subcutaneous-injection", "intramuscular-injection", "intravenous-injection"]) {
      expect(termById.get(id)?.system, id).toBe("tissues");
    }
  });

  it("平面図の語には名前→位置（3Dでタップ）を出さない", () => {
    const facets = facetsFor(termById.get("mitochondrion"), true);
    expect(facets).toContain("locate");
    expect(facets).not.toContain("point");
  });

  it("3Dの無い臓器で、臓器の場面にはならない", () => {
    expect(organById.get("tissues")?.box).toBeUndefined();
    expect(sceneFor("tissues", "tis-cell").organ).toBeUndefined();
  });
});

describe("体の部位（解剖学総論 II）", () => {
  it("体幹と四肢の部位は、目安の骨（region）で示す", () => {
    for (const id of ["trunk", "limbs", "head", "neck", "thorax", "abdomen", "back", "gluteal-region", "perineum", "upper-limb", "arm", "forearm", "hand", "lower-limb", "thigh", "leg", "foot"]) {
      const term = termById.get(id);
      expect(term?.system, id).toBe("basics");
      expect(term?.region?.bounds.length, id).toBeGreaterThan(0);
    }
    expect(termById.get("arm")?.region?.bounds).toEqual(["humerus"]);
    expect(termById.get("leg")?.region?.bounds).toEqual(["tibia", "fibula"]);
  });

  it("正中にまたがる体幹の部位は左右の両側を見せ、手足は右側だけ", () => {
    expect(termById.get("thorax")?.region?.both).toBe(true);
    expect(termById.get("perineum")?.region?.both).toBe(true);
    expect(termById.get("forearm")?.region?.both).toBeUndefined();
  });

  it("体の部位のレッスンは、中の器官の系統を読み込み、骨格を薄く添える", () => {
    const trunk = sceneFor("basics", "basic-region-trunk");
    expect(trunk.systems).toEqual(expect.arrayContaining(["cardiovascular", "respiratory", "digestive", "nervous"]));
    expect(trunk.context).toEqual(["skeletal"]);
    expect(sceneFor("basics", "basic-region-limb").systems).toEqual(["skeletal"]);
    // 図の語のレッスンは今までどおり
    expect(sceneFor("basics", "basic-direction")).toEqual({ systems: ["skeletal"], body: true });
  });

  it("運動の用語に前進・後退・対立・復位・側屈がある", () => {
    const motion = unitById.get("basic-motion-3")!;
    expect(motion.terms.map((term) => term.id)).toEqual(["protraction", "retraction", "opposition", "reposition", "lateral-flexion"]);
    for (const term of motion.terms) expect(term.figure?.motion, term.id).toBeTruthy();
  });
});
