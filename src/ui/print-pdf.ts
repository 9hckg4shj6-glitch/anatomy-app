import { h } from "../dom";

/**
 * 印刷する紙を、アプリの中で PDF ファイルにする（#/print の「PDFファイルを作る」）。
 * ホーム画面に追加した iPhone・iPad のアプリは印刷の画面を開けないので、紙を1枚ずつ画像（html2canvas-pro）にして
 * A4 の PDF に並べ、共有シート（「ファイルに保存」「プリント」）に渡す。字は画像になる（PDF の中で選んでコピーはできない）
 */

/** A4（pt） */
const A4_W = 595.28;
const A4_H = 841.89;
/** 紙1枚の画像の倍率（210mm ≒ 794px → 約 1,980px。約 240dpi） */
const SCALE = 2.5;

export const mmToPx = (mm: number) => (mm * 96) / 25.4;

/**
 * 紙を A4 の高さで分ける。語の表は行ごとに分けて、2枚目からも表の見出しを付ける。平面図の答えは図ごとのまとまりで分ける。
 * 平面図の紙はもともと1枚に収まるように作ってある（はみ出た分は切れる）。見本のページ（#/print/preview）も同じ分け方で紙を並べる
 */
export function paginate(page: HTMLElement, host: HTMLElement, limit: number): HTMLElement[] {
  host.append(page);
  if (page.offsetHeight <= limit) return [page];
  const out = [page];
  let current = page;
  const table = page.querySelector<HTMLTableElement>("table.pp-table");
  if (table?.tBodies[0]) {
    let body = table.tBodies[0];
    const rows = [...body.rows];
    body.replaceChildren();
    for (const row of rows) {
      body.append(row);
      if (current.offsetHeight > limit && body.rows.length > 1) {
        row.remove();
        current = page.cloneNode(false) as HTMLElement;
        const next = table.cloneNode(false) as HTMLTableElement;
        body = document.createElement("tbody");
        if (table.tHead) next.append(table.tHead.cloneNode(true));
        next.append(body);
        current.append(next);
        host.append(current);
        out.push(current);
        body.append(row);
      }
    }
    return out;
  }
  const blocks = [...page.querySelectorAll<HTMLElement>(":scope > .pp-answer-block")];
  if (blocks.length) {
    for (const block of blocks) block.remove();
    for (const block of blocks) {
      current.append(block);
      if (current.offsetHeight > limit && current.querySelector(".pp-answer-block") !== block) {
        block.remove();
        current = page.cloneNode(false) as HTMLElement;
        host.append(current);
        out.push(current);
        current.append(block);
      }
    }
  }
  return out;
}

interface PageImage {
  bytes: Uint8Array;
  w: number;
  h: number;
}

/** JPEG の画像を1枚ずつ A4 の紙いっぱいに置いた PDF */
export function buildPdf(images: PageImage[]): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };
  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  // 1 目録・2 紙の一覧・紙ごとに（紙・描き方・画像）の3つ
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${images.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] /Count ${images.length} >>`);
  images.forEach((image, i) => {
    const page = 3 + 3 * i;
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    const draw = `q ${A4_W} 0 0 ${A4_H} 0 0 cm /Im0 Do Q`;
    object(page + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    offsets[page + 2] = length;
    push(`${page + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`);
    push(image.bytes);
    push("\nendstream\nendobj\n");
  });
  const count = 3 + 3 * images.length;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  push(`${table}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

/** 紙を PDF にする。onProgress は（できた枚数, 全部の枚数） */
export async function makePdf(pages: HTMLElement[], onProgress: (done: number, total: number) => void): Promise<{ blob: Blob; count: number }> {
  const { default: html2canvas } = await import("html2canvas-pro");
  const host = h("div", { class: "pp-render", "aria-hidden": "true" });
  document.body.append(host);
  try {
    const sheets = pages.flatMap((page) => paginate(page, host, mmToPx(297)));
    for (const sheet of sheets) sheet.style.height = "297mm";
    await Promise.all([...host.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined)));
    await document.fonts?.ready;
    const images: PageImage[] = [];
    for (const [i, sheet] of sheets.entries()) {
      onProgress(i, sheets.length);
      const canvas = await html2canvas(sheet, {
        scale: SCALE, backgroundColor: "#ffffff", logging: false,
        // アプリの画面（3D など）は写さない。複製が軽くなる
        ignoreElements: (element) => element.id === "app",
      });
      const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!jpeg) throw new Error("紙を画像にできませんでした");
      images.push({ bytes: new Uint8Array(await jpeg.arrayBuffer()), w: canvas.width, h: canvas.height });
      // iPhone は画像の大きさの合計に上限があるので、すぐ手放す
      canvas.width = 0;
      canvas.height = 0;
    }
    onProgress(sheets.length, sheets.length);
    return { blob: buildPdf(images), count: images.length };
  } finally {
    host.remove();
  }
}

/** PDF の名前（紙の題から。ファイル名に使えない字は _ に） */
export function pdfName(pages: HTMLElement[]): string {
  const title = pages[0]?.querySelector("h1")?.textContent ?? "印刷";
  return `からだ見聞録_${title.replace(/[\\/:*?"<>|›\s]+/g, "_").replace(/^_+|_+$/g, "")}.pdf`;
}

/**
 * PDF を渡す。共有シートが使えれば共有シート（iPhone は「ファイルに保存」「プリント」）、使えなければダウンロード。
 * 押したその場で呼ぶ（共有シートは押した合図が要る）。閉じただけなら true
 */
export async function sharePdf(blob: Blob, name: string): Promise<boolean> {
  const file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return true;
      console.warn("共有シートを開けませんでした", error);
    }
  }
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
