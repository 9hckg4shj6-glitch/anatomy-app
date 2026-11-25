import { loadPlateIndex } from "../content";
import { h } from "../dom";
import { figureHref, figuresWith, figureThumb, type Figure } from "../organ-figures";

/**
 * 平面図の絵つきの札（docs/普段使い.md「平面図の探しやすさの見直し」）。臓器の画面の図の帯、すべての図、図鑑・立体・平面図の
 * 「この語が載っている図」で同じ見た目にする。絵は plates/index.json を読んでから入れる（読めなければ題だけ）
 */
export interface FigureCard {
  href: string;
  title: string;
  /** 平面図の ID（絵を出す）。無ければ kind の札 */
  plate?: string;
  /** 立体（3D）の札か、絵の無い模式図の札 */
  kind?: "3d" | "diagram";
  /** 札の下の小さな字（ほかの臓器の図なら臓器の名前） */
  sub?: string;
  /** 今開いている図 */
  current?: boolean;
}

/** 平面図を札に（sub に臓器の名前を出すかどうか） */
export function figureCard(figure: Figure, options: { term?: string; showOrgan?: boolean; current?: boolean } = {}): FigureCard {
  return {
    href: figureHref(figure, options.term), title: figure.plate.title, plate: figure.plate.id,
    sub: options.showOrgan ? figure.organ.ja : undefined, current: options.current,
  };
}

/** 区切り（図の帯の中の「ほかの臓器の図」） */
export interface FigureDivider {
  divider: string;
}

/** 札の絵（平面図の小さな絵・立体の札・模式図の札）。絵は plates/index.json を読んでから入れる（読めなければ「模式図」の札のまま） */
export function figureThumbElement(plate: string | undefined, kind?: "3d" | "diagram"): HTMLElement {
  if (kind === "3d") return h("span", { class: "fig-thumb fig-thumb-3d", "aria-hidden": "true" }, "3D");
  if (!plate || kind === "diagram") return h("span", { class: "fig-thumb fig-thumb-text", "aria-hidden": "true" }, "模式図");
  const img = h("img", { alt: "", loading: "lazy", decoding: "async", width: "240", height: "160" }) as HTMLImageElement;
  const box = h("span", { class: "fig-thumb" }, img);
  void loadPlateIndex().then((index) => {
    const src = figureThumb(index, plate);
    if (src) img.src = src;
    else box.replaceWith(figureThumbElement(undefined));
  }).catch(() => undefined);
  return box;
}

/**
 * 札の並び。strip は横に送る帯（臓器の画面・語の図）、grid は折り返す格子（すべての図）。
 * 今の図の札は帯の真ん中へ送る
 */
export function figureCards(items: (FigureCard | FigureDivider)[], options: { layout?: "strip" | "grid"; label?: string } = {}): HTMLElement {
  const list = h("ul", { class: options.layout === "grid" ? "fig-grid" : "fig-strip", "aria-label": options.label ?? "図" }, ...items.map((item) => {
    if ("divider" in item) return h("li", { class: "fig-divider", "aria-hidden": "true" }, h("span", {}, item.divider));
    return h("li", {}, h("a", { class: item.current ? "fig-card on" : "fig-card", href: item.href, ...(item.current ? { "aria-current": "page" } : {}) },
      figureThumbElement(item.plate, item.kind),
      h("span", { class: "fig-title" }, item.title),
      item.sub ? h("span", { class: "fig-sub" }, item.sub) : ""));
  }));
  // 今の図を帯の真ん中へ（画面に入ってから。縦には動かさない。.fig-strip は position: relative なので offsetLeft は帯の中の位置）
  if (options.layout !== "grid") {
    requestAnimationFrame(() => {
      const current = list.querySelector<HTMLElement>(".fig-card.on")?.parentElement;
      if (current) list.scrollLeft = Math.max(0, current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2);
    });
  }
  return list;
}

/**
 * 「この語が載っている図」の欄（図鑑・臓器の立体・平面図の、選んだ語の下）。押すとその図を、その語の名前を選んだ形で開く。
 * prefer の臓器の図を先に、ほかの臓器の図には臓器の名前を添える。except は今見ている図（平面図の中では「ほかの図」になる）
 */
export function termFigures(termId: string, options: { prefer?: string; except?: string; title?: string } = {}): HTMLElement | "" {
  const list = figuresWith(termId, options.prefer).filter((figure) => figure.plate.id !== options.except);
  if (!list.length) return "";
  const title = options.title ?? "この語が載っている図";
  return h("div", { class: "term-figures" },
    h("p", { class: "fig-head" }, title, h("span", { class: "muted" }, `（${list.length}枚）`)),
    figureCards(list.map((figure) => figureCard(figure, { term: termId, showOrgan: figure.organ.id !== options.prefer })), { label: title }));
}
