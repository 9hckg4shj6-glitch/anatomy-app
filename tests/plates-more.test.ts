import { describe, expect, it } from "vitest";
import { organById, organOf, plateOfTerm, termById } from "../src/content";
import { sceneFor } from "../src/ui/context";

// 主要な臓器と解剖学で大事な所の平面図を増やす（docs/設計.md「主要な臓器と大事な所の平面図を増やす」）
describe("主要な臓器と大事な所の平面図", () => {
  const plateIds = (organ: string) => organById.get(organ)?.plates.map((plate) => plate.id) ?? [];

  it("新しい臓器の図: 肩・肘・股関節と腕神経叢は立体つき、リンパ系と脾臓は平面図だけ", () => {
    for (const id of ["shoulder", "elbow", "hip", "brachial-plexus"]) {
      expect(organById.get(id)?.box, id).toBeTruthy();
      expect(organById.get(id)?.plates.length, id).toBeGreaterThan(0);
    }
    expect(organById.get("lymph")?.box).toBeUndefined();
    expect(plateIds("lymph")).toEqual(["lymphatic-system", "lymph-node", "spleen-pulp"]);
    expect(plateIds("elbow")).toEqual(["elbow-sagittal", "elbow-lateral", "elbow-medial"]);
    expect(plateIds("hip")).toEqual(["hip-anterior", "hip-posterior"]);
  });

  it("今までの臓器に足した図", () => {
    expect(plateIds("heart")).toContain("coronary-arteries");
    for (const id of ["brain-ventricles", "basal-nuclei", "meninges", "dural-sinuses"]) expect(plateIds("brain")).toContain(id);
    for (const id of ["liver-lobule", "portal-system"]) expect(plateIds("liver")).toContain(id);
    expect(plateIds("kidney")).toContain("bladder");
    expect(plateIds("male")).toContain("testis");
    for (const id of ["thyroid-anterior", "thyroid-posterior", "thyroid-follicles"]) expect(plateIds("larynx")).toContain(id);
    expect(plateIds("renal")).toContain("adrenal-layers");
  });

  it("新しいレッスンは臓器の場面（リンパ系は立体が無いので全身）", () => {
    expect(sceneFor("nervous", "nerv-meninges").organ).toBe("brain");
    expect(sceneFor("nervous", "nerv-brachial-cords").organ).toBe("brachial-plexus");
    expect(sceneFor("joints", "joint-shoulder-inside").organ).toBe("shoulder");
    expect(sceneFor("joints", "joint-elbow-bursae").organ).toBe("elbow");
    expect(sceneFor("joints", "joint-hip-bursae").organ).toBe("hip");
    expect(sceneFor("digestive", "dig-liver-lobule").organ).toBe("liver");
    expect(sceneFor("urogenital", "uro-bladder-inner").organ).toBe("kidney");
    expect(sceneFor("urogenital", "uro-testis-inner").organ).toBe("male");
    expect(sceneFor("endocrine", "endo-thyroid-follicle").organ).toBe("larynx");
    expect(sceneFor("endocrine", "endo-adrenal-layers").organ).toBe("renal");
    expect(sceneFor("lymphatic", "lymph-node-structure").organ).toBeUndefined();
    // 関節の靱帯は図鑑で開くとその関節の場面
    expect(organOf("glenoid-labrum")?.id).toBe("shoulder");
    expect(organOf("annular-ligament-of-radius")?.id).toBe("elbow");
    expect(organOf("iliofemoral-ligament")?.id).toBe("hip");
    expect(organOf("knee-joint")?.id).toBe("knee");
  });

  it("新しい平面図の語はその図の上にある", () => {
    const on = (id: string) => plateOfTerm(termById.get(id)!)?.plate.id;
    expect(on("dura-mater")).toBe("meninges");
    expect(on("subarachnoid-space")).toBe("meninges");
    expect(on("confluence-of-sinuses")).toBe("dural-sinuses");
    expect(on("hepatic-lobule")).toBe("liver-lobule");
    expect(on("trigone-of-bladder")).toBe("bladder");
    expect(on("seminiferous-tubules")).toBe("testis");
    expect(on("parafollicular-cell")).toBe("thyroid-follicles");
    expect(on("zona-fasciculata")).toBe("adrenal-layers");
    expect(on("lymph-node")).toBe("lymph-node");
    expect(on("white-pulp")).toBe("spleen-pulp");
    expect(on("lateral-cord-of-brachial-plexus")).toBe("brachial-plexus");
    expect(on("synovial-membrane")).toBe("shoulder-coronal");
    expect(on("subcutaneous-olecranon-bursa")).toBe("elbow-sagittal");
  });

  it("副腎皮質の3層と甲状腺の細胞にホルモンがある（ホルモンの問い方）", () => {
    for (const id of ["zona-glomerulosa", "zona-fasciculata", "zona-reticularis", "adrenal-medulla", "follicular-cell", "parafollicular-cell"]) {
      expect(termById.get(id)?.hormones, id).toBeTruthy();
    }
  });

  it("元の図は Commons の自由なライセンスの図", () => {
    const ids = ["coronary-arteries", "brain-ventricles", "basal-nuclei", "meninges", "dural-sinuses", "liver-lobule", "portal-system", "bladder", "testis",
      "thyroid-anterior", "adrenal-layers", "shoulder-coronal", "elbow-sagittal", "hip-anterior", "brachial-plexus", "lymphatic-system", "lymph-node", "spleen-pulp"];
    const all = [...organById.values()].flatMap((organ) => organ.plates);
    for (const id of ids) {
      const art = all.find((plate) => plate.id === id)?.art;
      expect(art?.page, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(art?.license, id).toMatch(/^(CC BY(-SA)? \d\.\d|Public domain)$/);
    }
  });
});
