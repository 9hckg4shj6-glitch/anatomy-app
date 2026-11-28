import { describe, expect, it } from "vitest";
import index from "../public/plates/index.json";
import organsJson from "../content/organs.json";
import { gutterLayout, plateLayout, readingOrder } from "../src/ui/print-sheet";

/** 印刷する（#/print）の平面図のプリント: 図の左右の余白に番号の丸を並べる */
describe("平面図のプリントの番号", () => {
  const plates = Object.entries((index as unknown as { plates: Record<string, { w: number; h: number; labels: { at: [number, number] }[] }> }).plates);

  it("すべての図で、番号の丸が重ならず、図の高さの中に入る", () => {
    for (const [id, plate] of plates) {
      const gutter = Math.max(plate.w * 0.1, plate.h * 0.07);
      const step = plate.h * 0.04;
      const marks = gutterLayout(plate.labels, plate.w, plate.h, gutter, step);
      expect(marks.length, id).toBe(plate.labels.length);
      for (const side of ["left", "right"] as const) {
        const ys = marks.filter((mark) => mark.side === side).map((mark) => mark.y).sort((a, b) => a - b);
        const gap = Math.min(step, plate.h / Math.max(1, ys.length));
        for (let k = 1; k < ys.length; k++) expect(ys[k] - ys[k - 1], `${id} ${side}`).toBeGreaterThanOrEqual(gap - 1e-6);
        for (const y of ys) {
          expect(y, id).toBeGreaterThanOrEqual(0);
          expect(y, id).toBeLessThanOrEqual(plate.h);
        }
      }
      // 左右どちらかに寄りすぎない
      const left = marks.filter((mark) => mark.side === "left").length;
      expect(Math.abs(left - (marks.length - left)), id).toBeLessThanOrEqual(2);
    }
  });

  it("番号の順は丸の間を変えても同じ（問題の紙と答えの紙で番号がそろう）", () => {
    for (const [id, plate] of plates) {
      const gutter = Math.max(plate.w * 0.1, plate.h * 0.07);
      expect(readingOrder(gutterLayout(plate.labels, plate.w, plate.h, gutter, plate.h * 0.05)), id)
        .toEqual(readingOrder(gutterLayout(plate.labels, plate.w, plate.h, gutter, 1)));
    }
  });

  it("番号は左の余白の上から、次に右の余白の上から", () => {
    const marks = gutterLayout([{ at: [0.9, 0.2] }, { at: [0.1, 0.8] }, { at: [0.1, 0.1] }], 100, 100, 10, 5);
    expect(readingOrder(marks)).toEqual([2, 1, 0]);
  });

  it("割り付け: 図と名前の欄が紙に収まり、図が小さくなりすぎない", () => {
    for (const [id, plate] of plates) {
      const gutter = Math.max(plate.w * 0.1, plate.h * 0.07);
      const aspect = plate.h / (plate.w + 2 * gutter);
      for (const rowH of [8, 9.5]) {
        const avail = 230;
        const layout = plateLayout(plate.labels.length, rowH, aspect, avail, 0);
        const used = layout.figureH + Math.ceil((plate.labels.length - layout.beside) / 2) * rowH;
        expect(used, id).toBeLessThanOrEqual(avail + 1e-6);
        expect(layout.beside * rowH, id).toBeLessThanOrEqual(layout.figureH + 1e-6);
        expect(layout.figureH / aspect, id).toBeLessThanOrEqual(186 + 1e-6);
        expect(layout.figureH, id).toBeGreaterThanOrEqual(Math.min(90, 186 * aspect));
      }
    }
  });

  it("印刷できる図はどれも「この図の要点」を持つ（無いと「要点も載せる」を選んでも何も変わらない）", () => {
    const printable = new Set(plates.map(([id]) => id));
    const missing = (organsJson as unknown as { organs: { plates: { id: string; points?: string[] }[] }[] }).organs
      .flatMap((organ) => organ.plates).filter((plate) => printable.has(plate.id) && !plate.points?.length).map((plate) => plate.id);
    expect(missing).toEqual([]);
  });

  it("要点を入れると図が小さくなりすぎるなら、要点は次の紙に", () => {
    expect(plateLayout(34, 8.5, 1.57, 230, 80).pointsHere).toBe(false);
    expect(plateLayout(10, 8, 0.3, 230, 30).pointsHere).toBe(true);
  });
});
