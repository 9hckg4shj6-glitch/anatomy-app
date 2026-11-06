import { loadPlateIndex, plateOfTerm, termById, type PlateIndex, type PlateLabel, type PlateSpec, type Term } from "../content";
import { h } from "../dom";
import type { AppContext } from "./context";

/** 平面図の名前の出し方: 日本語と英語・日本語だけ・英語だけ・隠す（押すと出る。覚えたかを確かめる） */
export type LabelMode = "both" | "ja" | "en" | "hide";

export type PlateEntry = PlateIndex["plates"][string];

/** ラベルの名前（語があれば語の日本語・英語） */
export function labelName(label: PlateLabel): { ja: string; en: string; term: Term | undefined } {
  const term = label.term ? termById.get(label.term) : undefined;
  return { ja: label.ja ?? term?.ja ?? "", en: label.en ?? term?.en ?? "", term };
}

export interface PlateDrawing {
  entry: PlateEntry;
  spec: PlateSpec;
  labels: PlateLabel[];
  labelMode: LabelMode;
  /** 隠しているときに名前を出したラベル */
  revealed: Set<number>;
  /** 選んだ（光らせる）ラベル */
  chosen: number | null;
  /** 図の上の端（名前の出し方のボタンの下） */
  top: number;
  choose: (i: number) => void;
}

/**
 * 平面図を紙（paper）に描き、名前のラベルを左右に並べて引き出し線で指す。
 * 狭い画面（ラベルを並べる幅が無い）では図に番号だけを置き、名前は欄の一覧で見る
 */
export function drawPlate(layer: HTMLElement, paper: HTMLElement, d: PlateDrawing): void {
  const { entry, spec, labels, labelMode, revealed, chosen, choose } = d;
  const width = layer.clientWidth, height = layer.clientHeight;
  if (!width || !height) return;
  const top = d.top, pad = 10;
  // ラベルを並べる列の幅。狭い画面では列を作らず番号だけにする
  const wide = width >= 560;
  const column = wide ? Math.min(230, Math.max(130, width * 0.24)) : 0;
  const areaW = width - 2 * column - 2 * pad, areaH = height - top - pad;
  const scale = Math.min(areaW / entry.w, areaH / entry.h);
  const imgW = entry.w * scale, imgH = entry.h * scale;
  const left = (width - imgW) / 2, imgTop = top + (areaH - imgH) / 2;
  const img = h("img", { class: "plate-image", src: `${import.meta.env.BASE_URL}${entry.url}`, alt: spec.title, style: `left:${left}px;top:${imgTop}px;width:${imgW}px;height:${imgH}px` });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "plate-lines");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const nodes: Node[] = [img, svg];
  const points = labels.map((label) => [left + label.at[0] * imgW, imgTop + label.at[1] * imgH] as const);
  const line = (x1: number, y1: number, x2: number, y2: number, on: boolean) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", "line");
    for (const [key, value] of Object.entries({ x1, y1, x2, y2 })) element.setAttribute(key, String(value));
    element.setAttribute("class", on ? "on" : "");
    svg.append(element);
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    for (const [key, value] of Object.entries({ cx: x2, cy: y2, r: on ? 4 : 2.6 })) dot.setAttribute(key, String(value));
    dot.setAttribute("class", on ? "on" : "");
    svg.append(dot);
  };
  if (!wide) {
    // 番号だけ（名前は欄の一覧で）
    for (const [i, [x, y]] of points.entries()) {
      nodes.push(h("button", { class: i === chosen ? "plate-num on" : "plate-num", type: "button", style: `left:${x}px;top:${y}px`, onClick: () => choose(i) }, String(i + 1)));
    }
    paper.replaceChildren(...nodes);
    return;
  }
  /** 名前の札の中身（隠すときは番号と「？」） */
  const labelText = (i: number) => {
    const { ja, en } = labelName(labels[i]);
    if (labelMode === "hide" && !revealed.has(i)) return [h("span", { class: "plate-ja" }, `${i + 1}　？`)];
    return [
      labelMode !== "en" ? h("span", { class: "plate-ja" }, ja) : "",
      labelMode !== "ja" ? h("span", { class: "plate-en", lang: "en" }, en) : "",
    ];
  };
  // 左右の列: 指す点が図の真ん中より左なら左の列。片方に寄りすぎたら、真ん中に近いものから反対の列へ移す。
  // 列の中は指す点の高さの順に並べ、重ならないように押し下げ（はみ出したら押し上げ）る。英語は2行まで折り返す
  const center = left + imgW / 2;
  const lines = (i: number) => {
    if (labelMode === "hide" && !revealed.has(i)) return 0;
    return labelMode === "ja" ? 0 : Math.min(2, Math.ceil((labelName(labels[i]).en.length * 6.1) / (column - 14)));
  };
  const rowOf = (i: number) => (labelMode === "en" ? 8 + 14 * Math.max(1, lines(i)) : 21 + 14 * lines(i));
  const sides = points.map((p) => (p[0] < center ? "left" : "right"));
  for (let guard = 0; guard < labels.length; guard++) {
    const count = (side: string) => sides.filter((item) => item === side).length;
    const heavy = count("left") - count("right") > 2 ? "left" : count("right") - count("left") > 2 ? "right" : null;
    if (!heavy) break;
    const move = sides.map((side, i) => ({ side, i })).filter(({ side }) => side === heavy)
      .sort((a, b) => Math.abs(points[a.i][0] - center) - Math.abs(points[b.i][0] - center))[0];
    sides[move.i] = heavy === "left" ? "right" : "left";
  }
  for (const side of ["left", "right"] as const) {
    const list = points.map((p, i) => ({ i, y: p[1] })).filter(({ i }) => sides[i] === side).sort((a, b) => a.y - b.y);
    const hs = list.map(({ i }) => rowOf(i));
    const ys = list.map((item, k) => item.y - hs[k] / 2);
    // 右の列は、右上の ⤢・? のボタンの下から
    const first = side === "right" ? 92 : top;
    for (let k = 0; k < ys.length; k++) ys[k] = Math.max(ys[k], k ? ys[k - 1] + hs[k - 1] + 2 : first);
    for (let k = ys.length - 1; k >= 0; k--) ys[k] = Math.min(ys[k], k === ys.length - 1 ? height - pad - hs[k] : ys[k + 1] - hs[k] - 2);
    for (let k = 0; k < ys.length; k++) ys[k] = Math.max(ys[k], k ? ys[k - 1] + hs[k - 1] + 2 : first);
    for (const [k, { i }] of list.entries()) {
      const y = ys[k];
      const x = side === "left" ? pad : width - pad - column;
      const on = i === chosen;
      nodes.push(h("button", {
        class: `plate-label ${side}${on ? " on" : ""}${labelMode === "hide" && !revealed.has(i) ? " hidden-name" : ""}`, type: "button",
        style: `left:${x}px;top:${y}px;width:${column}px;height:${hs[k]}px`, onClick: () => choose(i),
      }, ...labelText(i)));
      line(side === "left" ? x + column : x, y + hs[k] / 2, points[i][0], points[i][1], on);
    }
  }
  paper.replaceChildren(...nodes);
}

export interface PlateOverlay {
  /**
   * 平面図の語の図を3Dの上に重ねる。names が false なら名前を隠して番号だけ（押すと出る）、mark ならその語のラベルを光らせる。
   * 図の上の題は図の名前
   */
  show(term: Term, options: { names: boolean; mark: boolean }): Promise<void>;
  hide(): void;
}

const overlays = new WeakMap<AbortSignal, PlateOverlay>();

/** 画面（ctx.signal）ごとの、3Dの上に重ねる平面図（レッスン・問題・図鑑で平面図の語を示す）。画面を離れたら外す */
export function plateOverlay(ctx: AppContext): PlateOverlay {
  const found = overlays.get(ctx.signal);
  if (found) return found;
  const stage = document.getElementById("stage")!;
  const layer = h("div", { class: "plate-layer", hidden: true });
  const paper = h("div", { class: "plate-paper" });
  const caption = h("p", { class: "plate-caption" });
  layer.append(paper, caption);
  stage.insertBefore(layer, stage.querySelector("canvas")?.nextSibling ?? null);
  let drawing: PlateDrawing | null = null;
  const draw = () => {
    if (drawing && !layer.hidden) drawPlate(layer, paper, drawing);
  };
  const observer = new ResizeObserver(draw);
  observer.observe(layer);
  ctx.signal.addEventListener("abort", () => {
    observer.disconnect();
    layer.remove();
  }, { once: true });

  const overlay: PlateOverlay = {
    async show(term, { names, mark }) {
      const found = plateOfTerm(term);
      const entry = found && (await loadPlateIndex().catch(() => null))?.plates[found.plate.id];
      if (!found || !entry || ctx.signal.aborted) return overlay.hide();
      const index = entry.labels.findIndex((label) => label.term === term.id);
      drawing = {
        entry, spec: found.plate, labels: entry.labels, labelMode: names ? "both" : "hide", revealed: new Set(),
        chosen: mark && index >= 0 ? index : null, top: 44,
        // 押したラベルを光らせる。名前を隠しているとき（問題の間）は何もしない（押して名前が出ると答えになる）
        choose: (i) => {
          if (!names || !drawing) return;
          drawing.chosen = i;
          draw();
        },
      };
      caption.textContent = `${found.organ.ja}・${found.plate.title}`;
      // 3Dの向きの目印は図のラベルに重なり、図には意味が無いので隠す
      ctx.viewer.hideCompass(true);
      layer.hidden = false;
      draw();
    },
    hide() {
      if (layer.hidden) return;
      drawing = null;
      layer.hidden = true;
      ctx.viewer.hideCompass(false);
    },
  };
  overlays.set(ctx.signal, overlay);
  return overlay;
}
