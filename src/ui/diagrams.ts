import { termById, type PlateLabel } from "../content";

/** 平面図の名前の出し方（organs.ts と同じ） */
type LabelMode = "both" | "ja" | "en" | "hide";

const SVG = "http://www.w3.org/2000/svg";
const BLUE = "#3b64b8";
const RED = "#c8323c";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  element.append(...children);
  return element;
}

/**
 * 模式図の名前。box は部屋・肺・全身の箱（x, y, 幅, 高さ）、そうでなければ (x, y) に文字を置く（anchor は文字の寄せ方）。
 * term があれば押したときにその語の説明を出す
 */
interface Item {
  label: PlateLabel;
  x: number;
  y: number;
  box?: [number, number, string];
  anchor?: "start" | "middle" | "end";
  color: string;
}

/**
 * 血液の流れの模式図（心臓）。右の心臓（静脈血・青）を左に、左の心臓（動脈血・赤）を右に置き（前から見た向き）、
 * 心房を上・心室を下にして、全身→大静脈→右心房→三尖弁→右心室→肺動脈弁→肺動脈幹→肺→肺静脈→左心房→僧帽弁→左心室→大動脈弁→大動脈→全身と回す
 */
export function flowDiagram(): { labels: PlateLabel[]; svg: (choose: (i: number) => void, mode: LabelMode, revealed: Set<number>, chosen: number | null) => SVGSVGElement } {
  const term = (id: string): PlateLabel => ({ at: [0, 0], term: id });
  const items: Item[] = [
    { label: term("right-atrium"), x: 80, y: 250, box: [240, 100, "#dfe8f8"], color: BLUE },
    { label: term("right-ventricle"), x: 80, y: 480, box: [240, 110, "#cddbf3"], color: BLUE },
    { label: term("left-atrium"), x: 480, y: 250, box: [240, 100, "#f8e0e2"], color: RED },
    { label: term("left-ventricle"), x: 480, y: 480, box: [240, 110, "#f3cfd3"], color: RED },
    { label: term("lung"), x: 220, y: 30, box: [360, 80, "#ece6f4"], color: "#6b5a8e" },
    { label: { at: [0, 0], ja: "全身の組織", en: "body tissues", note: "全身の毛細血管で酸素を渡し、二酸化炭素を受け取る。血液は静脈血になって大静脈から右心房へ戻る（体循環・大循環）。" }, x: 220, y: 780, box: [360, 80, "#efe9dc"], color: "#7a6a4f" },
    { label: term("tricuspid-valve"), x: 214, y: 420, anchor: "start", color: BLUE },
    { label: term("pulmonary-valve"), x: 388, y: 520, anchor: "start", color: BLUE },
    { label: term("pulmonary-trunk"), x: 388, y: 215, anchor: "start", color: BLUE },
    { label: term("pulmonary-veins"), x: 534, y: 185, anchor: "start", color: RED },
    { label: term("mitral-valve"), x: 614, y: 420, anchor: "start", color: RED },
    { label: term("aortic-valve"), x: 752, y: 655, anchor: "end", color: RED },
    { label: { at: [0, 0], ja: "大動脈", en: "aorta", note: "左心室から出る体でいちばん太い動脈。上行大動脈・大動脈弓・下行大動脈（胸大動脈・腹大動脈）と続き、全身へ動脈血を配る。" }, x: 752, y: 720, anchor: "end", color: RED },
    { label: term("superior-vena-cava"), x: 48, y: 700, anchor: "start", color: BLUE },
    { label: term("inferior-vena-cava"), x: 48, y: 760, anchor: "start", color: BLUE },
  ];
  // 流れの線（矢印つき）。色は運ぶ血液（青＝静脈血・赤＝動脈血）
  const paths: [string, string][] = [
    ["M220 820 H36 V300 H76", BLUE],
    ["M200 350 V476", BLUE],
    ["M320 535 H372 V114", BLUE],
    ["M520 110 V246", RED],
    ["M600 350 V476", RED],
    ["M720 535 H764 V820 H584", RED],
  ];
  const labels = items.map((item) => item.label);

  return {
    labels,
    svg: (choose, mode, revealed, chosen) => {
      const svg = el("svg", { viewBox: "0 0 800 890", class: "flow-diagram", role: "img", "aria-label": "血液の流れの模式図" });
      svg.append(el("defs", {}, ...[["blue", BLUE], ["red", RED]].map(([id, color]) =>
        el("marker", { id: `arrow-${id}`, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" },
          el("path", { d: "M0 0 L10 5 L0 10 z", fill: color })))));
      for (const [d, color] of paths) svg.append(el("path", { d, fill: "none", stroke: color, "stroke-width": 7, "stroke-linejoin": "round", "marker-end": `url(#arrow-${color === BLUE ? "blue" : "red"})` }));
      svg.append(
        el("text", { x: 200, y: 175, "text-anchor": "middle", class: "flow-caption" }, "肺循環（小循環）"),
        el("text", { x: 200, y: 197, "text-anchor": "middle", class: "flow-caption en" }, "pulmonary circulation"),
        el("text", { x: 400, y: 728, "text-anchor": "middle", class: "flow-caption" }, "体循環（大循環）"),
        el("text", { x: 400, y: 750, "text-anchor": "middle", class: "flow-caption en" }, "systemic circulation"),
      );
      for (const [i, item] of items.entries()) {
        const named = item.label.term ? termById.get(item.label.term) : undefined;
        const ja = item.label.ja ?? named?.ja ?? "";
        const en = item.label.en ?? named?.en ?? "";
        const hidden = mode === "hide" && !revealed.has(i);
        const group = el("g", { class: i === chosen ? "flow-item on" : "flow-item", tabindex: 0, role: "button" });
        group.addEventListener("click", () => choose(i));
        group.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            choose(i);
          }
        });
        const lines = hidden ? [`${i + 1}　？`] : mode === "ja" ? [ja] : mode === "en" ? [en] : [ja, en];
        if (item.box) {
          const [w, hgt, fill] = item.box;
          group.append(el("rect", { x: item.x, y: item.y, width: w, height: hgt, rx: 16, fill, stroke: item.color, "stroke-width": i === chosen ? 5 : 2.5 }));
          const cx = item.x + w / 2, cy = item.y + hgt / 2;
          lines.forEach((text, k) => group.append(el("text", {
            x: cx, y: cy + (k - (lines.length - 1) / 2) * 30 + 9, "text-anchor": "middle", class: k && mode === "both" && !hidden ? "flow-en" : "flow-ja", fill: item.color,
          }, text)));
        } else {
          const anchor = item.anchor ?? "start";
          lines.forEach((text, k) => group.append(el("text", {
            x: item.x, y: item.y + k * 22, "text-anchor": anchor, class: k && mode === "both" && !hidden ? "flow-en small" : "flow-ja small", fill: item.color,
            stroke: "#fbf8f1", "stroke-width": 6, "paint-order": "stroke",
          }, text)));
        }
        svg.append(group);
      }
      return svg;
    },
  };
}
