import { describe, expect, it } from "vitest";
import { termById } from "../src/content";
import indexJson from "../public/models/index.json";

// 心臓の中のつくり（docs/緻密なモデル.md「その1」、scripts/heart/）
const index = indexJson as unknown as { terms: Record<string, { system: string; elements: string[] }> };
const elements = (id: string) => index.terms[id]?.elements ?? [];

describe("心臓の中のつくり", () => {
  const made = ["chordae-tendineae", "interventricular-septum", "interatrial-septum", "fibrous-pericardium", "parietal-layer-of-serous-pericardium",
    "pericardial-cavity", "epicardium", "myocardium", "endocardium", "sinuatrial-node", "atrioventricular-node", "atrioventricular-bundle",
    "right-bundle-branch", "left-bundle-branch", "purkinje-fibers", "fossa-ovalis", "trabeculae-carneae", "septomarginal-trabecula",
    "fibrous-rings-of-heart", "conus-arteriosus", "pectinate-muscles", "crista-terminalis"];

  it("平面図だけだった語に、作り直した心臓の部品（HT_）がある", () => {
    for (const id of made) {
      expect(termById.get(id)?.plate, id).toBeUndefined();
      expect(elements(id).length, id).toBeGreaterThan(0);
      expect(elements(id).every((e) => e.startsWith("HT_")), id).toBe(true);
    }
  });

  it("部屋の語は自由壁と中のつくりを持ち、元の BodyParts3D の壁は使わない", () => {
    expect(elements("left-ventricle").sort()).toEqual(["HT_ivs", "HT_lv", "HT_trab_lv"]);
    expect(elements("right-ventricle").sort()).toEqual(["HT_conus", "HT_moderator", "HT_rv", "HT_trab_rv"]);
    expect(elements("right-atrium").sort()).toEqual(["HT_crista", "HT_fossa", "HT_ias", "HT_pectinate", "HT_ra"]);
    expect(elements("left-atrium")).toEqual(["HT_la"]);
    expect(elements("heart").some((e) => e.startsWith("FJ"))).toBe(false);
  });

  it("弁尖と腱索は分かれ、僧帽弁・三尖弁は腱索をふくむ", () => {
    expect(elements("anterior-cusp-of-mitral-valve")).toEqual(["HT_mitral_a"]);
    expect(elements("septal-cusp-of-tricuspid-valve")).toEqual(["HT_tric_s"]);
    expect(elements("chordae-tendineae")).toHaveLength(5);
    expect(elements("mitral-valve").sort()).toEqual(["HT_chordae_mitral_a", "HT_chordae_mitral_p", "HT_mitral_a", "HT_mitral_p"]);
  });

  it("心膜と心内膜は強調したときだけ描く（veil と tuck）、中に隠れる語は xray", () => {
    for (const id of ["fibrous-pericardium", "parietal-layer-of-serous-pericardium", "pericardial-cavity", "epicardium", "endocardium"]) {
      expect(termById.get(id)?.veil, id).toBe(true);
      expect(termById.get(id)?.tuck, id).toBe(true);
      expect(termById.get(id)?.xray, id).toBe(true);
    }
    for (const id of ["sinuatrial-node", "atrioventricular-bundle", "purkinje-fibers", "chordae-tendineae", "interventricular-septum"]) {
      expect(termById.get(id)?.xray, id).toBe(true);
    }
  });
});
