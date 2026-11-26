import { describe, expect, it } from "vitest";
import { buildPdf } from "../src/ui/print-pdf";

/** 印刷する（#/print）の「PDFファイルを作る」: 紙の画像を並べた PDF の組み立て */
describe("buildPdf", () => {
  it("紙ごとに画像を1つ置き、相互参照表の位置が各オブジェクトの頭を指す", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const blob = buildPdf([{ bytes: jpeg, w: 10, h: 14 }, { bytes: jpeg, w: 10, h: 14 }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    expect(blob.type).toBe("application/pdf");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text.match(/\/DCTDecode/g)).toHaveLength(2);
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(8);
    entries.forEach((offset, i) => expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});
