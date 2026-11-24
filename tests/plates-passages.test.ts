import { describe, expect, it } from "vitest";
import organsJson from "../content/organs.json";
import { isPlateUnit, organById, organOfLesson, plateOfTerm, termById, units } from "../src/content";
import { ORGAN_GROUPS } from "../src/ui/organs";
import { sceneFor } from "../src/ui/context";

// 臓器の図の続き: 声帯・肝臓の臓側面・胸管と乳び槽・手根管・鼡径管の平面図（docs/設計.md「臓器の図の続き（声帯・肝臓の臓側面・胸管・手根管・鼡径管）」）
describe("臓器の図の続き（声帯・肝臓の臓側面・胸管・手根管・鼡径管）", () => {
  const plateIds = (organ: string) => organById.get(organ)?.plates.map((plate) => plate.id) ?? [];
  const spec = (id: string) => organsJson.organs.flatMap((organ) => organ.plates as { id: string; art?: { page: string; license: string } }[]).find((plate) => plate.id === id);

  it("今までの臓器に足した図", () => {
    expect(plateIds("larynx").slice(0, 3)).toEqual(["larynx-anterior", "larynx-superior", "larynx-coronal"]);
    expect(plateIds("liver").slice(0, 2)).toEqual(["liver-anterior", "liver-visceral"]);
    expect(plateIds("lymph")).toContain("thoracic-duct");
  });

  it("新しい臓器の図「手根管と鼡径管」は平面図だけで、一覧の局所の通り道のまとまりに入る", () => {
    expect(plateIds("passages")).toEqual(["carpal-tunnel-section", "inguinal-posterior"]);
    expect(organById.get("passages")?.box).toBeUndefined();
    expect(ORGAN_GROUPS.find((group) => group.organs.includes("passages"))?.title).toBe("局所の通り道");
  });

  it("新しいレッスンは図のレッスンで、その臓器の図に入る（場面は立体のある臓器ならその臓器、無ければ全身）", () => {
    const lessons = { "resp-larynx-cavity": "larynx", "lymph-thoracic-duct": "lymph", "reg-inguinal-ring": "passages" };
    for (const [id, organ] of Object.entries(lessons)) {
      const unit = units.find((item) => item.id === id)!;
      expect(unit, id).toBeTruthy();
      expect(isPlateUnit(unit), id).toBe(true);
      expect(organOfLesson(unit)?.id, id).toBe(organ);
      expect(sceneFor(unit.system, id).organ, id).toBe(organById.get(organ)?.box ? organ : undefined);
    }
  });

  it("平面図の語はその図の上にある（声帯ひだ・声門・右リンパ本幹はよく見える図へ移した）", () => {
    const on = (id: string) => plateOfTerm(termById.get(id)!)?.plate.id;
    expect(on("vestibular-fold")).toBe("larynx-coronal");
    expect(on("laryngeal-ventricle")).toBe("larynx-coronal");
    expect(on("vocal-fold")).toBe("larynx-superior");
    expect(on("glottis")).toBe("larynx-superior");
    expect(on("thoracic-duct")).toBe("thoracic-duct");
    expect(on("cisterna-chyli")).toBe("thoracic-duct");
    expect(on("venous-angle")).toBe("thoracic-duct");
    expect(on("right-lymphatic-duct")).toBe("thoracic-duct");
    expect(on("deep-inguinal-ring")).toBe("inguinal-posterior");
    expect(on("inguinal-triangle")).toBe("inguinal-posterior");
    expect(on("femoral-ring")).toBe("inguinal-posterior");
  });

  it("手根管の図には手根管と、通るもの・囲むものが載る", () => {
    const labels = organById.get("passages")!.plates[0].labels.map((label) => (typeof label === "string" ? label : label.term));
    expect(labels).toEqual(expect.arrayContaining(["carpal-tunnel", "flexor-retinaculum-of-wrist", "median-nerve", "flexor-pollicis-longus", "flexor-digitorum-superficialis", "flexor-digitorum-profundus", "ulnar-nerve", "ulnar-artery"]));
  });

  it("肝臓の臓側面は3Dの形から描き、肝門・圧痕・裂を指す", () => {
    expect(spec("liver-visceral")?.art).toBeUndefined();
    const labels = organById.get("liver")!.plates[1].labels.map((label) => (typeof label === "string" ? label : label.term));
    expect(labels).toEqual(expect.arrayContaining(["porta-hepatis", "caudate-lobe", "quadrate-lobe", "gastric-impression", "renal-impression", "fissure-for-ligamentum-venosum", "fissure-for-round-ligament", "bare-area-of-liver"]));
  });

  it("元の図は自由なライセンスの図", () => {
    for (const id of ["larynx-superior", "larynx-coronal", "thoracic-duct", "carpal-tunnel-section", "inguinal-posterior"]) {
      const art = spec(id)?.art;
      expect(art?.page, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(art?.license, id).toMatch(/^CC BY(-SA)? \d\.\d$|^Public domain$/);
    }
  });
});
