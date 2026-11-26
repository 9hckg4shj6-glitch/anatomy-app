import type { PlateLabel, PlateSpec, Term } from "../content";
import { h } from "../dom";
import { noteText } from "../en-notes";
import { labelName, type PlateEntry } from "./plate-view";

/**
 * 印刷する紙（#/print。docs/普段使い.md「印刷する」）。A4 縦で、紙1枚を .pp-page にする。
 * 平面図のプリントは、図の左右の余白に番号を並べて引き出し線で指し、図の下に番号ごとの書き込み欄を置く。
 * 語のテスト・語の一覧は表にして、ページの区切りはブラウザに任せる（表の見出しは各ページにくり返す）。
 * 印刷の画面の「PDFとして保存」で PDF にもなる
 */

/** 平面図のプリントで隠すもの。none は隠さない（見て覚える用の一覧） */
export type PrintHide = "all" | "ja" | "en" | "none";

/** A4 の中の使える大きさ（mm。@page の余白 12mm を除く） */
export const PAGE_W = 186;
export const PAGE_H = 273;

/** 印刷した日（紙の右上） */
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
};

/** 紙の頭（題・英語の題・日付と「からだ見聞録」・点数の欄） */
function pageHead(title: string, sub: string, score: number | null): HTMLElement {
  return h("header", { class: "pp-head" },
    h("div", { class: "pp-head-text" }, h("h1", {}, title), sub ? h("p", { lang: "en" }, sub) : ""),
    h("div", { class: "pp-head-side" },
      h("span", {}, `からだ見聞録・${today()}`),
      score !== null ? h("span", { class: "pp-score" }, `　　　／ ${score}`) : ""));
}

export interface GutterMark {
  /** ラベルの番号（0 から） */
  i: number;
  side: "left" | "right";
  /** 番号の丸の中心（図の座標。左の余白の左端が 0） */
  x: number;
  y: number;
  /** 指す点（図の座標） */
  px: number;
  py: number;
}

/**
 * 図の左右の余白（gutter）に番号の丸を並べる。指す点が図の真ん中より左なら左、片方に寄りすぎたら真ん中に近いものから反対へ。
 * 余白の中は指す点の高さの順に並べ、丸が重ならないよう押し下げ（はみ出したら押し上げ）る（plate-view.ts の drawPlate と同じ考え）。
 * 入りきらないときは間を詰める（step は丸の中心どうしの最小の間）
 */
export function gutterLayout(labels: Pick<PlateLabel, "at">[], w: number, ht: number, gutter: number, step: number): GutterMark[] {
  const points = labels.map((label) => [gutter + label.at[0] * w, label.at[1] * ht] as const);
  const center = gutter + w / 2;
  const sides = points.map((p) => (p[0] < center ? "left" : "right") as "left" | "right");
  for (let guard = 0; guard < labels.length; guard++) {
    const count = (side: string) => sides.filter((item) => item === side).length;
    const heavy = count("left") - count("right") > 2 ? "left" : count("right") - count("left") > 2 ? "right" : null;
    if (!heavy) break;
    const move = sides.map((side, i) => ({ side, i })).filter(({ side }) => side === heavy)
      .sort((a, b) => Math.abs(points[a.i][0] - center) - Math.abs(points[b.i][0] - center))[0];
    sides[move.i] = heavy === "left" ? "right" : "left";
  }
  const marks: GutterMark[] = [];
  for (const side of ["left", "right"] as const) {
    const list = points.map((p, i) => ({ i, y: p[1] })).filter(({ i }) => sides[i] === side).sort((a, b) => a.y - b.y);
    if (!list.length) continue;
    const gap = Math.min(step, ht / list.length);
    const first = gap / 2, last = ht - gap / 2;
    const ys = list.map((item) => Math.min(Math.max(item.y, first), last));
    for (let k = 1; k < ys.length; k++) ys[k] = Math.max(ys[k], ys[k - 1] + gap);
    for (let k = ys.length - 1; k >= 0; k--) ys[k] = Math.min(ys[k], k === ys.length - 1 ? last : ys[k + 1] - gap);
    for (let k = 1; k < ys.length; k++) ys[k] = Math.max(ys[k], ys[k - 1] + gap);
    const x = side === "left" ? gutter * 0.42 : gutter + w + gutter * 0.58;
    for (const [k, { i }] of list.entries()) marks.push({ i, side, x, y: ys[k], px: points[i][0], py: points[i][1] });
  }
  return marks.sort((a, b) => a.i - b.i);
}

/** ラベルの番号を、左の余白の上から・右の余白の上からの順に付け直す（紙の上で番号を探しやすいように） */
export function readingOrder(marks: GutterMark[]): number[] {
  // 丸の高さは指す点の高さの順のまま並ぶので、指す点の高さで並べる（丸の間を変えても同じ順。答えの紙と番号がそろう）
  return [...marks].sort((a, b) => (a.side !== b.side ? (a.side === "left" ? -1 : 1) : a.py - b.py || a.i - b.i)).map((mark) => mark.i);
}

export interface PlatePrint {
  spec: PlateSpec;
  entry: PlateEntry;
  /** 臓器の名前（紙の題の頭） */
  organ: string;
}

const SVG = "http://www.w3.org/2000/svg";

function svgElement(tag: string, attrs: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

/** 書き込み欄の1行（番号・見せる名前・書く線）。答えの紙では線の代わりに名前 */
function answerRow(n: number, label: PlateLabel, hide: PrintHide, answer: boolean): HTMLElement {
  const { ja, en } = labelName(label);
  const shown = answer || hide === "none";
  const given = hide === "ja" ? h("span", { class: "pp-given", lang: "en" }, en) : hide === "en" ? h("span", { class: "pp-given" }, ja) : "";
  return h("li", { class: "pp-row" },
    h("span", { class: "pp-num" }, String(n)),
    shown
      ? h("span", { class: "pp-name" }, h("span", {}, ja), h("span", { class: "pp-en", lang: "en" }, en))
      : h("span", { class: "pp-blank" }, given, h("span", { class: "pp-line" })));
}

/** 名前の欄の右の列の幅（mm。縦長の図で、図の横に欄を置くとき） */
const SIDE_LIST_W = 84;
/** 要点を同じ紙に載せても、図の高さをこれより小さくしない（小さくなるなら要点は次の紙に） */
const MIN_FIGURE_H = 95;

export interface PlateLayout {
  /** 図の高さ（mm） */
  figureH: number;
  /** 図の横に置く名前の数（0 なら欄はすべて図の下に2列） */
  beside: number;
  /** 要点を同じ紙に載せるか */
  pointsHere: boolean;
}

/**
 * 紙の割り付け。図を全幅で置いて欄を下に2列にするか、図を左に置いて欄の一部を右に（残りを下に2列）にするか、図が大きくなる方。
 * avail は頭・出典などを除いた高さ、rowH は欄の1行の高さ、aspect は図の高さ÷幅（余白を含む）。
 * 要点（pointsMm）を入れると図が MIN_FIGURE_H より小さくなるなら、要点は次の紙に回す
 */
export function plateLayout(count: number, rowH: number, aspect: number, avail: number, pointsMm: number): PlateLayout {
  const fit = (room: number): { figureH: number; beside: number } => {
    const below = Math.min(PAGE_W * aspect, room - Math.ceil(count / 2) * rowH);
    let side = { figureH: 0, beside: 0 };
    for (let figureH = Math.min((PAGE_W - SIDE_LIST_W - 6) * aspect, room); figureH > 40; figureH -= 1) {
      const beside = Math.min(count, Math.floor(figureH / rowH));
      if (figureH + Math.ceil((count - beside) / 2) * rowH <= room) {
        side = { figureH, beside };
        break;
      }
    }
    return side.figureH > below ? side : { figureH: Math.max(40, below), beside: 0 };
  };
  const without = fit(avail);
  if (pointsMm) {
    // 横長の図のように、もともと低い図は、その高さのまま入れば同じ紙に
    const withPoints = fit(avail - pointsMm);
    if (withPoints.figureH >= Math.min(MIN_FIGURE_H, without.figureH)) return { ...withPoints, pointsHere: true };
  }
  return { ...without, pointsHere: false };
}

/** 欄の1行の高さの見積もり（mm）。見せる名前が長くて2行に折り返すものがあれば高く */
function rowHeight(labels: PlateLabel[], hide: PrintHide, columnMm: number): number {
  if (hide === "none") return 9;
  if (hide === "all") return 8;
  const fits = (columnMm * 0.45) / (hide === "ja" ? 1.6 : 3.1);
  const long = labels.filter((label) => {
    const { ja, en } = labelName(label);
    return (hide === "ja" ? en : ja).length > fits;
  }).length;
  return 8 + (3.5 * long) / Math.max(1, labels.length);
}

/** 要点の高さの見積もり（mm。1行 約58字・4.4mm） */
const pointsHeight = (points: string[]) => (points.length ? 9 + points.reduce((sum, point) => sum + Math.ceil(noteText(point).length / 58) * 4.4, 0) : 0);

/**
 * 平面図のプリント（図と書き込み欄。withPoints なら要点も。同じ紙に入らなければ要点だけの紙を続ける）
 */
export function platePages(plate: PlatePrint, hide: PrintHide, withPoints: boolean): HTMLElement[] {
  const { spec, entry } = plate;
  const labels = entry.labels;
  const points = withPoints ? spec.points ?? [] : [];
  const note = hide === "none" && spec.note ? noteText(spec.note) : "";
  // 頭 20mm・出典 14mm・「〜を書く」5mm・添え書きを除いた高さに、図と欄（と要点）を入れる
  const avail = PAGE_H - 20 - 14 - 5 - (note ? 3 + Math.ceil(note.length / 62) * 4.2 : 0);
  const gutter = Math.max(entry.w * 0.1, entry.h * 0.07);
  const totalW = entry.w + 2 * gutter;
  const aspect = entry.h / totalW;
  const rowH = rowHeight(labels, hide, PAGE_W / 2 - 4);
  const layout = plateLayout(labels.length, rowH, aspect, avail, pointsHeight(points));
  const widthMm = Math.min(PAGE_W, layout.figureH / aspect);
  const unit = totalW / widthMm; // 1mm が図の座標でいくつか
  const radius = 2.5 * unit;
  const marks = gutterLayout(labels, entry.w, entry.h, gutter, 2 * radius + 0.8 * unit);
  // 番号は余白の上から読む順（1 が左の一番上）。書き込み欄も同じ番号の順
  const order = readingOrder(marks);
  const numberOf = new Map(order.map((i, k) => [i, k + 1]));

  const svg = svgElement("svg", { class: "pp-lines", viewBox: `0 0 ${totalW} ${entry.h}` });
  for (const mark of marks) {
    const edge = mark.side === "left" ? mark.x + radius : mark.x - radius;
    svg.append(svgElement("line", { x1: edge, y1: mark.y, x2: mark.px, y2: mark.py, "stroke-width": 0.22 * unit }));
    svg.append(svgElement("circle", { cx: mark.px, cy: mark.py, r: 0.55 * unit, class: "pp-dot" }));
    svg.append(svgElement("circle", { cx: mark.x, cy: mark.y, r: radius, "stroke-width": 0.25 * unit, class: "pp-ring" }));
    const text = svgElement("text", { x: mark.x, y: mark.y, "font-size": 2.9 * unit, "text-anchor": "middle", "dominant-baseline": "central" });
    text.textContent = String(numberOf.get(mark.i));
    svg.append(text);
  }
  const figure = h("div", { class: "pp-figure", style: `width:${widthMm}mm;height:${widthMm * aspect}mm` },
    h("img", {
      src: `${import.meta.env.BASE_URL}${entry.url}`, alt: spec.title,
      style: `left:${(gutter / totalW) * 100}%;width:${(entry.w / totalW) * 100}%`,
    }),
    svg);
  const hideNote = hide === "all" ? "番号の名前（日本語・英語）を書く" : hide === "ja" ? "英語を見て日本語を書く" : hide === "en" ? "日本語を見て英語を書く" : "";
  const rowList = (from: number, to: number, columns: number) => h("ol", {
    class: hide === "none" ? "pp-rows is-names" : "pp-rows", style: `--rows:${Math.ceil((to - from) / columns)};--cols:${columns}`,
  }, ...order.slice(from, to).map((i, k) => answerRow(from + k + 1, labels[i], hide, false)));
  const pointsBox = points.length ? h("div", { class: "pp-points" }, h("h2", {}, "この図の要点"), h("ul", {}, ...points.map((point) => h("li", {}, noteText(point))))) : "";
  const title = `${plate.organ} › ${spec.title}`;
  const page = h("section", { class: "pp-page pp-plate" },
    pageHead(title, spec.en, hide === "none" ? null : labels.length),
    note ? h("p", { class: "pp-note" }, note) : "",
    hideNote ? h("p", { class: "pp-hint" }, hideNote) : "",
    layout.beside
      ? h("div", { class: "pp-side" }, figure, rowList(0, layout.beside, 1))
      : figure,
    layout.beside < labels.length ? rowList(layout.beside, labels.length, 2) : "",
    layout.pointsHere ? pointsBox : "",
    creditLine(spec),
  );
  return pointsBox && !layout.pointsHere
    ? [page, h("section", { class: "pp-page" }, pageHead(`${title}（要点）`, spec.en, null), pointsBox)]
    : [page];
}

/** 図の出典（作者・ライセンス。印刷した紙にも付ける） */
function creditLine(spec: PlateSpec): HTMLElement {
  const art = spec.art;
  if (!art || art.license === "自作") return h("p", { class: "pp-credit" }, "図: からだ見聞録で描いた模式図");
  return h("p", { class: "pp-credit" }, `図: ${art.author}（${art.license} ${art.licenseUrl}）${art.page}。${art.changes}`);
}

/** 平面図の答え（図ごとに番号と名前。いくつもの図を続けて） */
export function plateAnswers(plates: PlatePrint[]): HTMLElement {
  return h("section", { class: "pp-page pp-answers" },
    pageHead("答え", "", null),
    ...plates.map((plate) => {
      const { entry } = plate;
      const gutter = Math.max(entry.w * 0.1, entry.h * 0.07);
      const order = readingOrder(gutterLayout(entry.labels, entry.w, entry.h, gutter, 1));
      return h("div", { class: "pp-answer-block" },
        h("h2", {}, `${plate.organ} › ${plate.spec.title}`),
        h("ol", { class: "pp-rows", style: `--rows:${Math.ceil(order.length / 2)}` }, ...order.map((i, k) => answerRow(k + 1, entry.labels[i], "none", true))));
    }));
}

/** 語のテストで書くもの: 英語（日本語を見て）・日本語（英語を見て） */
export type WordAsk = "en" | "ja";

/** 語のテスト（表。answer なら答えを書いた表） */
export function wordTest(title: string, items: Term[], ask: WordAsk, answer: boolean): HTMLElement {
  const head = ask === "en" ? ["日本語", "英語"] : ["英語", "日本語"];
  return h("section", { class: `pp-page pp-words${answer ? " pp-answers" : ""}` },
    pageHead(answer ? `${title}（答え）` : title, ask === "en" ? "日本語を見て英語を書く" : "英語を見て日本語を書く", answer ? null : items.length),
    h("table", { class: "pp-table pp-test" },
      h("thead", {}, h("tr", {}, h("th", { class: "pp-col-n" }, ""), h("th", {}, head[0]), h("th", {}, head[1]))),
      h("tbody", {}, ...items.map((term, k) => {
        const given = ask === "en" ? h("td", {}, term.ja, h("span", { class: "pp-yomi" }, term.yomi)) : h("td", { lang: "en" }, term.en);
        const ans = ask === "en" ? h("td", { lang: "en" }, answer ? term.en : "") : h("td", {}, answer ? term.ja : "");
        return h("tr", {}, h("td", { class: "pp-col-n" }, String(k + 1)), given, ans);
      }))));
}

/** 語の一覧（日本語と読み・英語・メモか説明） */
export function wordList(title: string, items: Term[], options: { memo: (id: string) => string; note: boolean }): HTMLElement {
  const extra = (term: Term) => {
    const memo = options.memo(term.id);
    return [memo ? h("span", { class: "pp-memo" }, `メモ: ${memo}`) : "", options.note && term.note ? h("span", { class: "pp-desc" }, noteText(term.note)) : ""];
  };
  const wide = options.note || items.some((term) => options.memo(term.id));
  return h("section", { class: "pp-page pp-words" },
    pageHead(title, `${items.length}語`, null),
    h("table", { class: `pp-table pp-list${wide ? " wide" : ""}` },
      h("thead", {}, h("tr", {}, h("th", { class: "pp-col-n" }, ""), h("th", {}, "日本語"), h("th", {}, "英語"), wide ? h("th", {}, options.note ? "説明・メモ" : "メモ") : "")),
      h("tbody", {}, ...items.map((term, k) => h("tr", {},
        h("td", { class: "pp-col-n" }, String(k + 1)),
        h("td", {}, term.ja, h("span", { class: "pp-yomi" }, term.yomi)),
        h("td", { lang: "en" }, term.en),
        wide ? h("td", { class: "pp-extra" }, ...extra(term)) : "")))));
}

/**
 * 紙を入れ物（body 直下の .print-root）に入れる。印刷の画面ではこの入れ物だけが出る（styles.css の @media print）。
 * 印刷の画面を閉じても消さない（iPhone の Safari は印刷の画面を出す前に afterprint が来ることがあり、消すと紙が空になる）。
 * 次に入れるときか、印刷の画面を離れるとき（unmountPrint）に消す。入れたままならブラウザのメニューの「印刷」でも同じ紙が出る
 */
export function mountPrint(pages: HTMLElement[]): HTMLElement {
  document.querySelector(".print-root")?.remove();
  const root = h("div", { class: "print-root" }, ...pages);
  document.body.append(root);
  document.body.classList.add("is-printing");
  return root;
}

export function unmountPrint(): void {
  document.querySelector(".print-root")?.remove();
  document.body.classList.remove("is-printing");
}

/** 入れ物の図をすべて読み終えたか */
export const imagesReady = (root: HTMLElement): boolean => [...root.querySelectorAll("img")].every((img) => img.complete);

/** 入れ物の図を読み終えるまで待つ（読めない図や、ms を過ぎたら待たない） */
export function waitImages(root: HTMLElement, ms = 20000): Promise<void> {
  const each = [...root.querySelectorAll("img")].filter((img) => !img.complete)
    .map((img) => new Promise<void>((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    }));
  return Promise.race([Promise.all(each).then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

/**
 * 印刷の画面を開く。押したその場で（await をはさまずに）呼ぶ。待ってから呼ぶと、Safari では押した合図が切れて開かないことがある。
 * 開いたら true。beforeprint が来ないまま 1.5秒たったら false（ホーム画面に追加した iPhone・iPad のアプリなど、印刷の画面を開けないとき）
 */
export function openPrintDialog(): Promise<boolean> {
  let opened = false;
  const mark = () => (opened = true);
  window.addEventListener("beforeprint", mark, { once: true });
  try {
    window.print();
  } catch (error) {
    console.warn("印刷の画面を開けませんでした", error);
  }
  // Chrome などは印刷の画面を閉じるまで print() から戻らない（その間に beforeprint が来ている）
  if (opened) return Promise.resolve(true);
  return new Promise((resolve) => setTimeout(() => {
    window.removeEventListener("beforeprint", mark);
    resolve(opened || document.visibilityState === "hidden");
  }, 1500));
}
