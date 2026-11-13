import { describe, expect, it } from "vitest";
import { organById, organOf, pins, plateOfTerm, termById, unitById } from "../src/content";
import { sceneFor } from "../src/ui/context";

// 解剖学総論（循環器系・消化器系）の講義に合わせた2回目の追加（docs/設計.md「解剖学総論の講義に合わせた循環器・消化器 その2」）
describe("解剖学総論の循環器・消化器 その2", () => {
  it("臓器の図のあるレッスンはその臓器の場面、ほかは今までどおり", () => {
    expect(sceneFor("cardiovascular", "cv-heart-skeleton").organ).toBe("heart");
    expect(sceneFor("digestive", "dig-duodenum-more").organ).toBe("stomach");
    expect(sceneFor("digestive", "dig-intestine-more").organ).toBe("intestine");
    expect(sceneFor("digestive", "dig-peritoneal-relations").organ).toBe("peritoneum");
    expect(sceneFor("lymphatic", "lymph-tonsils").organ).toBe("pharynx");
    // 体じゅうにまたがる語（食道の区分・消化管の分け方・腹大動脈の枝・横隔膜の孔）と、立体の無い臓器（血管・発生）は全身の場面
    for (const [system, unit] of [["digestive", "dig-esophagus-parts"], ["digestive", "dig-classification"], ["cardiovascular", "cv-aorta-branch-types"],
      ["muscular", "mus-diaphragm-openings"], ["cardiovascular", "cv-circulation"], ["digestive", "dig-liver-pancreas-development"]]) {
      expect(sceneFor(system, unit).organ, unit).toBeUndefined();
    }
    expect(organById.get("vessels")?.units).toContain("cv-circulation");
    expect(organOf("pharyngeal-tonsil")?.id).toBe("pharynx");
  });

  it("平面図の語は新しい図の上にある", () => {
    const on = (id: string) => plateOfTerm(termById.get(id)!);
    expect(on("systemic-circulation")?.plate.id).toBe("dual-circulation");
    expect(on("pulmonary-circulation")?.organ.id).toBe("vessels");
    expect(on("venous-valve")?.plate.id).toBe("vein-wall");
    expect(on("minor-duodenal-papilla")?.plate.id).toBe("pancreatic-ducts");
    expect(on("circular-folds")?.plate.id).toBe("intestine-folds");
    expect(on("microvilli")?.organ.id).toBe("intestine");
    expect(on("pharyngeal-tonsil")?.plate.id).toBe("tonsils");
    expect(on("hepatorenal-recess")?.plate.id).toBe("peritoneum-transverse");
    expect(on("fibrous-rings-of-heart")?.plate.id).toBe("heart-base");
    expect(on("internal-anal-sphincter")?.plate.id).toBe("rectum-anal");
    expect(on("hepatic-diverticulum")?.plate.art?.license).toBe("自作");
    expect(on("septum-transversum")?.plate.id).toBe("gut-tube");
    for (const id of ["dual-circulation", "vein-wall", "tonsils", "pancreatic-ducts", "intestine-folds"]) {
      const plate = [...organById.values()].flatMap((organ) => organ.plates).find((p) => p.id === id);
      expect(plate?.art?.page, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });

  it("食道は頚部・胸部・腹部の3つの形からなり、3つの生理的狭窄は上から順に並ぶ", () => {
    expect(termById.get("esophagus")?.parts).toEqual(["esophagus", "thoracic part of esophagus", "abdominal part of esophagus"]);
    const y = (id: string) => pins[id].at[0][1];
    expect(y("pharyngoesophageal-constriction")).toBeGreaterThan(y("bronchoaortic-constriction"));
    expect(y("bronchoaortic-constriction")).toBeGreaterThan(y("diaphragmatic-constriction"));
  });

  it("横隔膜の孔は上から大静脈孔（Th8）・食道裂孔（Th10）・大動脈裂孔（Th12）で、通るものがある", () => {
    const y = (id: string) => pins[id].at[0][1];
    expect(y("caval-opening")).toBeGreaterThan(y("esophageal-hiatus"));
    expect(y("esophageal-hiatus")).toBeGreaterThan(y("aortic-hiatus"));
    for (const id of ["caval-opening", "esophageal-hiatus", "aortic-hiatus"]) {
      expect(termById.get(id)?.of).toBe("diaphragm");
      expect(termById.get(id)?.passes, id).toBeTruthy();
    }
  });

  it("腹部の9区分は左右とも見せ、囲みの線で示す。虫垂の圧痛点は線と輪", () => {
    const unit = unitById.get("basic-region-abdomen")!;
    expect(unit.terms).toHaveLength(11);
    for (const term of unit.terms) {
      expect(term.region?.both, term.id).toBe(true);
      expect(term.region?.outline?.length, term.id).toBeGreaterThan(8);
    }
    // 右の区分は x < 0、左の区分は x > 0（本人の左が +x）
    const cx = (id: string) => { const o = termById.get(id)!.region!.outline!; return o.reduce((s, p) => s + p[0], 0) / o.length; };
    expect(cx("right-hypochondriac-region")).toBeLessThan(0);
    expect(cx("left-inguinal-region")).toBeGreaterThan(0);
    expect(Math.abs(cx("umbilical-region"))).toBeLessThan(0.005);
    expect(termById.get("mcburney-point")?.region?.open).toBe(true);
    expect(sceneFor("basics", "basic-region-abdomen").systems).toContain("digestive");
  });
});
