import { describe, expect, it } from "vitest";
import ownAttachmentsJson from "../content/attachments.json";
import { termById } from "../src/content";

// 筋の付着面の残り: 背部・頚部の深い筋（何個もの椎骨・肋骨にまたがる起始・停止）と、四肢の骨に付くのに示せなかった起始・停止
// （docs/設計.md「筋の付着面の残り（背部と頚部の深い筋）」。scripts/pins/rules/attach.mjs の ATTACH → content/attachments.json）
type Spot = [string, number, number, number, number, ...number[]];
const own = ownAttachmentsJson as unknown as Record<string, { origin?: Spot[]; insertion?: Spot[] }>;
const spots = (id: string, kind: "origin" | "insertion") => own[id]?.[kind] ?? [];

describe("筋の付着面の残り（背部と頚部の深い筋）", () => {
  it("背部の深い筋の起始・停止は、椎骨・肋骨・寛骨・仙骨の上の面で示す", () => {
    const cases: [string, "origin" | "insertion", string[], number][] = [
      ["semispinalis-thoracis", "origin", ["thoracic-vertebrae"], 5],
      ["semispinalis-cervicis", "insertion", ["axis", "cervical-vertebrae"], 4],
      ["multifidus", "origin", ["sacrum", "lumbar-vertebrae", "thoracic-vertebrae", "cervical-vertebrae"], 3 + 5 + 12 + 4],
      ["multifidus", "insertion", ["axis", "cervical-vertebrae", "thoracic-vertebrae", "lumbar-vertebrae"], 1 + 5 + 12 + 5],
      ["rotatores", "insertion", ["thoracic-vertebrae"], 11],
      ["spinalis", "origin", ["thoracic-vertebrae", "lumbar-vertebrae"], 4],
      ["iliocostalis-thoracis", "insertion", ["ribs", "cervical-vertebrae"], 7],
      ["serratus-posterior-inferior", "insertion", ["ribs"], 4],
      ["levatores-costarum-breves", "insertion", ["ribs"], 12],
      ["quadratus-lumborum", "insertion", ["ribs", "lumbar-vertebrae"], 3 + 4],
      ["longus-colli", "origin", ["cervical-vertebrae", "thoracic-vertebrae"], 6],
    ];
    for (const [id, kind, bones, count] of cases) {
      const list = spots(id, kind);
      expect(list.length, `${id}@${kind}`).toBe(count);
      expect(new Set(list.map((spot) => spot[0])), `${id}@${kind}`).toEqual(new Set(bones));
      expect(termById.get(id)?.[kind], id).toBeTruthy();
    }
  });

  it("棘突起は正中、横突起・肋骨は右側（アプリが左へ折り返す）", () => {
    for (const [, x] of spots("spinalis", "insertion")) expect(Math.abs(x)).toBeLessThan(0.006);
    for (const [, x] of spots("semispinalis-thoracis", "origin")) expect(x).toBeLessThan(-0.02);
    for (const [, x] of spots("iliocostalis-thoracis", "insertion")) expect(x).toBeLessThan(-0.02);
  });

  it("四肢の骨に付くのに示せなかった起始・停止", () => {
    expect(spots("adductor-brevis", "origin")[0]?.[0]).toBe("hip-bone");
    expect(spots("obturator-externus", "insertion")[0]?.[0]).toBe("femur");
    expect(spots("humeral-head-of-flexor-carpi-ulnaris", "insertion").map((spot) => spot[0])).toEqual(["pisiform", "metacarpals"]);
    expect(spots("quadratus-plantae", "origin").length).toBe(2);
  });
});
