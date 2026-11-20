import viewsJson from "../content/point-views.json";
import { isDrawn, termById } from "../src/content";
import { hasMeasuredView, LANDMARK_DEFAULT, questionView, TERM_DEFAULT, VIEW_DIRECTIONS } from "../src/point-views";
import { facetsFor } from "../src/study";

/** docs/普段使い.md「押しにくさの見直し」: 出題で語を映す向き（content/point-views.json は scripts/point-views.mjs が測って書く） */
describe("出題で語を映す向き", () => {
  const views = (viewsJson as { views: Record<string, string> }).views;

  it("測っていない語は、語は正面（語に from があればその向き）、骨の部位は正面やや右上から", () => {
    expect(hasMeasuredView("femur")).toBe(false);
    expect(questionView(termById.get("femur")!)).toEqual(TERM_DEFAULT);
    const withFrom = [...termById.values()].find((term) => term.from && !term.of && !hasMeasuredView(term.id));
    if (withFrom) expect(questionView(withFrom)).toEqual(withFrom.from);
    const landmark = [...termById.values()].find((term) => term.of && !hasMeasuredView(term.id))!;
    expect(questionView(landmark)).toEqual(LANDMARK_DEFAULT);
  });

  it("背中側の語は、測った後ろ寄りの向きから", () => {
    for (const id of ["infraspinatus", "occipital-lobe", "median-sacral-crest", "atlas"]) {
      expect(hasMeasuredView(id)).toBe(true);
      expect(questionView(termById.get(id)!)[2]).toBeLessThan(0);
    }
  });

  it("向きは決めた10の向きのどれかで、名前→位置を出す語だけに書く", () => {
    for (const [id, name] of Object.entries(views)) {
      expect(Object.keys(VIEW_DIRECTIONS)).toContain(name);
      const term = termById.get(id)!;
      expect(term).toBeDefined();
      expect(facetsFor(term)).toContain("point");
      expect(term.xray || term.small || isDrawn(term)).toBeFalsy();
    }
  });
});
