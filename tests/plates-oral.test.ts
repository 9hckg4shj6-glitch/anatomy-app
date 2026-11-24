import { describe, expect, it } from "vitest";
import { isPlateUnit, organById, organOfLesson, plateOfTerm, termById, units } from "../src/content";
import { ORGAN_GROUPS } from "../src/ui/organs";
import { sceneFor } from "../src/ui/context";
import { fullPlate } from "../src/organ-details";

// 口腔・歯・唾液腺、横隔膜と骨盤底・会陰の臓器の図と、下垂体・小脳・食道の平面図（docs/設計.md「口腔・横隔膜と骨盤底の臓器の図と平面図を足す」）
describe("口腔・横隔膜と骨盤底の臓器の図と平面図", () => {
  const plateIds = (organ: string) => organById.get(organ)?.plates.map((plate) => plate.id) ?? [];

  it("新しい臓器の図は平面図だけ（3Dの場面にならない）で、一覧の消化器のまとまりに入る", () => {
    expect(plateIds("mouth")).toEqual(["teeth", "tooth-structure", "tongue-dorsum", "taste-bud", "salivary-glands"]);
    expect(plateIds("diaphragms")).toEqual(["diaphragm-inferior", "pelvic-floor", "perineum-muscles"]);
    for (const id of ["mouth", "diaphragms"]) {
      expect(organById.get(id)?.box, id).toBeUndefined();
      expect(ORGAN_GROUPS.some((group) => group.organs.includes(id)), id).toBe(true);
    }
  });

  it("今までの臓器に足した図", () => {
    expect(plateIds("brain")).toEqual(expect.arrayContaining(["pituitary", "cerebellum-lateral"]));
    expect(plateIds("mediastinum")).toContain("esophagus-course");
  });

  it("新しいレッスンは図のレッスンで、その臓器の図に入る（場面は全身のまま）", () => {
    const lessons = { "dig-tooth-structure": "mouth", "sens-taste": "mouth", "mus-diaphragm-parts": "diaphragms", "uro-perineal-muscles": "diaphragms" };
    for (const [id, organ] of Object.entries(lessons)) {
      const unit = units.find((item) => item.id === id)!;
      expect(unit, id).toBeTruthy();
      expect(isPlateUnit(unit), id).toBe(true);
      expect(organOfLesson(unit)?.id, id).toBe(organ);
      expect(sceneFor(unit.system, id).organ, id).toBeUndefined();
    }
  });

  it("平面図の語はその図の上にある", () => {
    const on = (id: string) => plateOfTerm(termById.get(id)!)?.plate.id;
    expect(on("enamel")).toBe("tooth-structure");
    expect(on("periodontal-ligament")).toBe("tooth-structure");
    expect(on("third-molar")).toBe("teeth");
    expect(on("deciduous-teeth")).toBe("teeth");
    expect(on("vallate-papillae")).toBe("tongue-dorsum");
    expect(on("gustatory-cell")).toBe("taste-bud");
    expect(on("central-tendon-of-diaphragm")).toBe("diaphragm-inferior");
    expect(on("right-crus-of-diaphragm")).toBe("diaphragm-inferior");
    expect(on("perineal-body")).toBe("perineum-muscles");
    expect(on("bulbospongiosus")).toBe("perineum-muscles");
  });

  it("横隔膜の脚は心臓の刺激伝導系の右脚・左脚と別の語", () => {
    expect(termById.get("right-crus-of-diaphragm")?.ja).toBe("右脚（横隔膜）");
    expect(termById.get("right-bundle-branch")?.ja).toBe("右脚");
  });

  it("元の図は Commons の自由なライセンスの図", () => {
    const ids = ["teeth", "tooth-structure", "tongue-dorsum", "taste-bud", "salivary-glands", "diaphragm-inferior", "pelvic-floor", "perineum-muscles", "pituitary", "cerebellum-lateral", "esophagus-course"];
        for (const id of ids) {
      const art = fullPlate(id)?.art;
      expect(art?.page, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(art?.license, id).toMatch(/^CC BY(-SA)? \d\.\d$/);
    }
  });
});
