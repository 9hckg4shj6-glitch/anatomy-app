import { describe, expect, it } from "vitest";
import { termById } from "../src/content";
import { fullOrganById } from "../src/organ-details";
import indexJson from "../public/models/index.json";

// 眼球の中・喉頭の中・鼻中隔と硬口蓋（docs/緻密なモデル.md「その3」、scripts/eye/・scripts/larynx/・scripts/palate/ → scripts/made/）
const index = indexJson as unknown as { terms: Record<string, { system: string; elements: string[] }> };
const elements = (id: string) => (index.terms[id]?.elements ?? []).slice().sort();

describe("緻密なモデル その3", () => {
  it("平面図だけだった語に、作った部品がある", () => {
    const made: Record<string, string> = {
      pupil: "EY_", "posterior-chamber": "EY_", macula: "EY_", "fovea-centralis": "EY_", "optic-disc": "EY_",
      "vocal-fold": "LX_", glottis: "LX_", "vestibular-fold": "LX_", "laryngeal-ventricle": "LX_", "infraglottic-cavity": "LX_",
      "nasal-septum": "PL_", "hard-palate": "PL_",
    };
    for (const [id, prefix] of Object.entries(made)) {
      expect(termById.get(id)?.plate, id).toBeUndefined();
      expect(elements(id).length, id).toBeGreaterThan(0);
      expect(elements(id).every((e) => e.startsWith(prefix)), id).toBe(true);
    }
  });

  it("左右のある形は左右とも持つ。黄斑は中心窩をふくみ、声門は声帯ひだと声門裂", () => {
    expect(elements("pupil")).toEqual(["EY_pupil_l", "EY_pupil_r"]);
    expect(elements("macula")).toEqual(["EY_fovea_l", "EY_fovea_r", "EY_macula_l", "EY_macula_r"]);
    expect(elements("vocal-fold")).toEqual(["LX_vocal_fold_l", "LX_vocal_fold_r"]);
    expect(elements("glottis")).toEqual(["LX_rima_glottidis", "LX_vocal_fold_l", "LX_vocal_fold_r"]);
    expect(elements("rima-glottidis")).toEqual(["LX_rima_glottidis"]);
  });

  it("上の歯肉は硬口蓋の粘膜を分けた形に、視神経は眼球の中で切りそろえた形に置きかわる", () => {
    expect(elements("gingiva").filter((e) => e.startsWith("PL_"))).toEqual(["PL_gingiva_upper"]);
    expect(elements("gingiva").some((e) => e === "FJ1252")).toBe(false);
    expect(elements("optic-nerve")).toEqual(["EY_optic_nerve_l", "EY_optic_nerve_r"]);
  });

  it("空所と鼻中隔はふだん薄く透かし、瞳孔は強調したときだけ描く", () => {
    for (const id of ["rima-glottidis", "laryngeal-ventricle", "infraglottic-cavity", "nasal-septum"]) {
      expect(termById.get(id)?.veil, id).toBe(true);
      expect(termById.get(id)?.xray, id).toBe(true);
    }
    expect(termById.get("pupil")?.tuck).toBe(true);
    for (const id of ["macula", "fovea-centralis", "optic-disc", "vocal-fold", "vestibular-fold"]) expect(termById.get(id)?.schematic, id).toBe(true);
  });

  it("臓器の図に切り口「眼底」と「上から（喉頭鏡）」がある", () => {
    expect(fullOrganById("eye")?.cuts.map((cut) => cut.label)).toContain("眼底（眼球の後ろ半分を前から見る）");
    expect(fullOrganById("larynx")?.cuts.some((cut) => cut.label.startsWith("上から（喉頭鏡"))).toBe(true);
    expect(fullOrganById("nose")?.cuts.find((cut) => cut.label.startsWith("鼻中隔を外して"))?.hide).toContain("nasal-septum");
  });
});
