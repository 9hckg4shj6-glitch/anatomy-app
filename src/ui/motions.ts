import { organById, termById } from "../content";
import { h } from "../dom";
import type { Vec3 } from "../landmarks";
import {
  breathWeights, CARDIAC_PHASES, cardiacTimeline, CONDUCTION, CONDUCTION_STEPS, conductionStep, cyclic, ecg, heartDisplace, heartState, inhaling,
  loadMotionData, phaseAt, Polyline, ROUTE_SHARE, routeLine, sampleField,
  type BreathingData, type CardiacCycle, type CardiacTimeline, type CirculationData, type ConductionStep, type HeartData, type HeartPart, type HeartState, type Route,
} from "../motions";
import type { AnatomyViewer, Deformable, StageSpec } from "../viewer";
import { termAt, type AppContext } from "./context";
import { breathQuestion, conductionQuestion, heartQuestion } from "../motion-quiz";
import { breathCaption, heartCaption } from "./motion-caption";
import { motionCheck } from "./motion-check";
import { motionModelScene } from "./motion-models";
import { segmented } from "./settings-kit";

/**
 * 動きの図鑑（#/motions、docs/動きの図鑑.md）。呼吸・心臓の拍動と心周期・刺激伝導系・肺循環と体循環を、
 * アプリの3Dの形を実測のデータとモデルで動かして見せる（計算は src/motions.ts）。
 * 一覧は #/motions、それぞれは #/motions/<ID>
 */
export interface MotionItem {
  id: string;
  ja: string;
  en: string;
  lead: string;
  color: string;
  /** 一覧の絵（24×24 の SVG の中身） */
  icon: string;
}

export const MOTIONS: MotionItem[] = [
  {
    id: "breathing", ja: "呼吸", en: "breathing", color: "#6fa8dc",
    lead: "横隔膜が下がり胸郭が広がって肺がふくらむ様子。実際の人の自由呼吸を撮った 4DMRI の動きで。",
    icon: `<path d="M12 3v7"/><path d="M12 10c-2 0-3 1.5-4.5 1.5C5 11.5 4 14 4 17c0 2 1.5 3 3 3 3 0 5-3 5-6"/><path d="M12 10c2 0 3 1.5 4.5 1.5 2.5 0 3.5 2.5 3.5 5.5 0 2-1.5 3-3 3-3 0-5-3-5-6"/>`,
  },
  {
    id: "heartbeat", ja: "心臓の拍動と心周期", en: "cardiac cycle", color: "#c8323c",
    lead: "4つの部屋が縮み、弁が開いて閉じ、血液が流れる1拍。圧・容積・心電図のグラフと一緒に。",
    icon: `<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/><path d="M5 12h3l1.5-3 2 6 1.5-3h6"/>`,
  },
  {
    id: "conduction", ja: "刺激伝導系と心電図", en: "conduction system", color: "#d9a514",
    lead: "洞房結節から房室結節・ヒス束・右脚と左脚・プルキンエ線維へ興奮が伝わる順と、心電図の波の対応。",
    icon: `<path d="M13 2 5 13h6l-1 9 8-12h-6l1-8Z"/>`,
  },
  {
    id: "circulation", ja: "肺循環と体循環", en: "pulmonary and systemic circulation", color: "#7a4fb5",
    lead: "血液が心臓から全身・肺を回って戻る道。動脈血（赤）と静脈血（青）が入れかわる所に注目。",
    icon: `<path d="M12 4a8 8 0 1 1-7.4 5"/><path d="m4 5 .6 4 4-.6"/><circle cx="12" cy="12" r="2.4"/>`,
  },
];

export const RED = "#d23b3b";
export const BLUE = "#3b64c8";
const VALVE = "#f1ede2";
const CONDUCTION_COLOR = "#e0a800";

/** 速さ（1倍＝実際の速さ） */
const SPEEDS = [{ value: 0.25, label: "¼" }, { value: 0.5, label: "½" }, { value: 1, label: "1倍" }];

export async function motionScreen(ctx: AppContext, arg: string): Promise<void> {
  const [id, mode] = arg.split("/");
  const item = MOTIONS.find((motion) => motion.id === id);
  if (!item) return motionList(ctx);
  ctx.fold(false);
  const player = new Player(ctx);
  ctx.signal.addEventListener("abort", () => player.stop(), { once: true });
  // はじめは「わかりやすい模型」（src/ui/motion-models.ts）、#/motions/<ID>/real は実際の形（アプリの3Dの形を動かす）
  if (mode !== "real") return motionModelScene(ctx, player, item);
  if (item.id === "breathing") await breathingScene(ctx, player);
  else if (item.id === "circulation") await circulationScene(ctx, player);
  else await heartScene(ctx, player, item.id === "conduction");
  ctx.panel.prepend(modeSwitch(item, true));
}

/** 「わかりやすい模型」と「実際の形」の切り替え（欄の頭） */
export function modeSwitch(item: MotionItem, real: boolean): HTMLElement {
  return h("div", { class: "motion-switch motion-mode" }, segmented<boolean>("見せ方", [{ value: false, label: "わかりやすい模型" }, { value: true, label: "実際の形" }], real, (value) => {
    location.hash = `#/motions/${item.id}${value ? "/real" : ""}`;
  }));
}

/** 動きの図鑑の一覧（3Dは使わないので、スマホでは3Dごとたたむ） */
function motionList(ctx: AppContext): void {
  ctx.fold(true);
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  ctx.panel.replaceChildren(
    h("h2", {}, "動きの図鑑"),
    h("p", { class: "muted" }, "体の中の動きを、3Dの模型を動かして見ます。3Dの下の字幕で今の時期が分かり、‹ › で1つずつ止めて見られます。最後に「確かめる」で4択の問題も。"),
    h("ul", { class: "organ-grid motion-grid" }, ...MOTIONS.map((motion) => {
      // 絵はわかりやすい模型を撮ったもの（scripts/motions/thumbs.mjs）。読めないときは記号の絵
      const art = h("img", { class: "organ-thumb motion-photo", src: `${import.meta.env.BASE_URL}motions/thumbs/${motion.id}.webp`, alt: "", loading: "lazy", decoding: "async" });
      art.addEventListener("error", () => {
        const icon = h("span", { class: "organ-thumb motion-thumb", style: `--motion:${motion.color}`, "aria-hidden": "true" });
        icon.innerHTML = `<svg viewBox="0 0 24 24">${motion.icon}</svg>`;
        art.replaceWith(icon);
      }, { once: true });
      return h("li", {}, h("a", { class: "organ-card", href: `#/motions/${motion.id}` },
        art,
        h("span", { class: "organ-name" }, motion.ja),
        h("span", { class: "organ-meta motion-lead" }, motion.lead)));
    })),
    h("p", { class: "home-note" }, "呼吸の動きは 4DMRI moving meshes（CC BY 4.0）、心周期の圧と容積は ModularCirc（MIT）のモデルから。くわしくは「出典・クレジット」に。"),
  );
}

// ---------------------------------------------------------------- 再生

/** 再生の時計と、3Dの後片付け。time は実際の時間（秒）で、速さを掛けて進む */
export class Player {
  time = 0;
  playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  speed = 0.5;
  private last = 0;
  private readonly frames: ((time: number, dt: number) => void)[] = [];
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly ctx: AppContext) {
    ctx.viewer.onTick = (now) => {
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
      this.last = now;
      const step = this.playing ? dt * this.speed : 0;
      this.time += step;
      for (const frame of this.frames) frame(this.time, step);
    };
  }

  onFrame(frame: (time: number, dt: number) => void): void {
    this.frames.push(frame);
  }

  /** 再生・速さが変わったときに呼ぶ関数 */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  set(playing: boolean): void {
    this.playing = playing;
    for (const listener of this.listeners) listener();
  }

  stop(): void {
    const viewer = this.ctx.viewer;
    viewer.onTick = null;
    viewer.setDots(null);
    viewer.setSchematic(null);
    viewer.setTags(null);
    viewer.restoreDeform();
    viewer.setStage(null);
    viewer.setSection(null);
    viewer.setFrameInset(0);
    viewer.onPick = null;
  }

  /** 再生・止める・速さ・1コマ戻す／進める */
  controls(period: () => number): HTMLElement {
    const play = h("button", { class: "ghost-button motion-play", type: "button", onClick: () => this.set(!this.playing) });
    const show = () => {
      play.textContent = this.playing ? "❚❚ 止める" : "▶ 再生";
      play.classList.toggle("on", !this.playing);
    };
    this.onChange(show);
    show();
    const step = (sign: number) => {
      this.set(false);
      this.time = Math.max(0, this.time + sign * period() / 40);
    };
    return h("div", { class: "motion-controls" },
      play,
      h("button", { class: "ghost-button motion-step", type: "button", "aria-label": "少し戻す", onClick: () => step(-1) }, "‹"),
      h("button", { class: "ghost-button motion-step", type: "button", "aria-label": "少し進める", onClick: () => step(1) }, "›"),
      segmented("速さ", SPEEDS, this.speed, (value) => {
        this.speed = value;
      }),
    );
  }

  /** 周期の中の位置 u（0〜1）へ移って止める（グラフを押したとき） */
  seek(u: number, period: number): void {
    this.time = (Math.floor(this.time / period) + u) * period;
    this.set(false);
  }
}

/**
 * 頂点の動きを「形の重ね合わせ」にする: 点ごとに channels 個の変位の形を先に求めておき、毎フレームは重みを掛けて足すだけ。
 * 心臓の変位も呼吸の変位も、状態（縮み・弁の開き・呼吸の重み）に対して線形なので、これで同じ動きになる
 */
class LinearDeform {
  private readonly items: { item: Deformable; basis: Float32Array[]; active: number[] }[] = [];

  constructor(private readonly viewer: AnatomyViewer, elements: string[], channels: number, evaluate: (p: Vec3, element: string, channel: number, out: Vec3) => void) {
    const p: Vec3 = [0, 0, 0];
    const out: Vec3 = [0, 0, 0];
    for (const item of viewer.deformable(elements)) {
      const n = item.rest.length / 3;
      const basis: Float32Array[] = [];
      const active: number[] = [];
      for (let c = 0; c < channels; c++) {
        const values = new Float32Array(n * 3);
        let max = 0;
        for (let i = 0; i < n; i++) {
          p[0] = item.rest[i * 3];
          p[1] = item.rest[i * 3 + 1];
          p[2] = item.rest[i * 3 + 2];
          evaluate(p, item.element, c, out);
          values[i * 3] = out[0];
          values[i * 3 + 1] = out[1];
          values[i * 3 + 2] = out[2];
          max = Math.max(max, Math.abs(out[0]), Math.abs(out[1]), Math.abs(out[2]));
        }
        basis.push(values);
        if (max > 1e-7) active.push(c);
      }
      this.items.push({ item, basis, active });
    }
  }

  apply(weights: ArrayLike<number>): void {
    for (const { item, basis, active } of this.items) {
      const { rest, position } = item;
      position.set(rest);
      for (const c of active) {
        const w = weights[c];
        if (!w) continue;
        const b = basis[c];
        for (let i = 0; i < b.length; i++) position[i] += b[i] * w;
      }
    }
    this.viewer.deformed();
  }
}

/** 語の部品 */
const elementsOf = (ctx: AppContext, ids: string[]): string[] => [...new Set(ids.flatMap((id) => ctx.index.terms[id]?.elements ?? []))];

/** 部品の色を、語ごとの色から */
const colorsOf = (ctx: AppContext, table: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [id, color] of Object.entries(table)) for (const element of ctx.index.terms[id]?.elements ?? []) out[element] = color;
  return out;
};

export const hex = (color: string): [number, number, number] => {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mix = (a: [number, number, number], b: [number, number, number], t: number, out: Float32Array, o: number) => {
  out[o] = a[0] + (b[0] - a[0]) * t;
  out[o + 1] = a[1] + (b[1] - a[1]) * t;
  out[o + 2] = a[2] + (b[2] - a[2]) * t;
};

/** タップした所の名前（図鑑へのリンクつき）を出す欄 */
function pickBox(ctx: AppContext): HTMLElement {
  const box = h("p", { class: "motion-picked muted" }, "3Dの部位をタップすると、名前が出ます。");
  ctx.viewer.onPick = (element, point) => {
    const term = termAt(ctx, element, point);
    if (!term) return;
    box.replaceChildren("タップした所：", h("b", {}, term.ja), h("span", { class: "muted" }, ` ${term.en} `), h("a", { href: `#/explore/${term.id}` }, "図鑑で見る ›"));
  };
  return box;
}

/** 関係する語（図鑑へ） */
export function relatedTerms(ids: string[]): HTMLElement {
  return h("div", { class: "chip-list motion-terms" }, ...ids.flatMap((id) => {
    const term = termById.get(id);
    return term ? [h("a", { class: "chip", href: `#/explore/${id}` }, term.ja)] : [];
  }));
}

export function toggle(label: string, on: boolean, change: (on: boolean) => void): HTMLElement {
  const input = h("input", { type: "checkbox", checked: on, onChange: () => change(input.checked) }) as HTMLInputElement;
  return h("label", { class: "switch-row" }, input, label);
}

// ---------------------------------------------------------------- グラフ

const SVG = "http://www.w3.org/2000/svg";
export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  element.append(...children);
  return element;
}

export interface Track {
  values: number[];
  color: string;
  min: number;
  max: number;
  top: number;
  height: number;
  dash?: string;
  width?: number;
}

export const CHART_W = 600;
export const CHART_X = 44;

/** 1周期のグラフ。押した所へ移る（seek）。cursor(u) で今の線を動かす */
export function chart(height: number, tracks: Track[], decorate: (svg: SVGSVGElement, x: (u: number) => number) => void, seek: (u: number) => void, label: string): { svg: SVGSVGElement; cursor: (u: number) => void } {
  const svg = el("svg", { viewBox: `0 0 ${CHART_W} ${height}`, class: "motion-chart", role: "img", "aria-label": label });
  const x = (u: number) => CHART_X + u * (CHART_W - CHART_X - 8);
  decorate(svg, x);
  for (const track of tracks) {
    const n = track.values.length;
    const y = (v: number) => track.top + track.height * (1 - (v - track.min) / (track.max - track.min));
    const d = track.values.map((v, i) => `${i ? "L" : "M"}${x(i / n).toFixed(1)} ${y(v).toFixed(1)}`).join(" ") + ` L${x(1).toFixed(1)} ${y(track.values[0]).toFixed(1)}`;
    svg.append(el("path", { d, fill: "none", stroke: track.color, "stroke-width": track.width ?? 2.2, "stroke-linejoin": "round", ...(track.dash ? { "stroke-dasharray": track.dash } : {}) }));
  }
  const line = el("line", { x1: x(0), x2: x(0), y1: 0, y2: height, class: "motion-cursor" });
  svg.append(line);
  svg.addEventListener("click", (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * CHART_W;
    seek(Math.min(0.999, Math.max(0, (px - CHART_X) / (CHART_W - CHART_X - 8))));
  });
  return { svg, cursor: (u) => { const v = x(((u % 1) + 1) % 1).toFixed(1); line.setAttribute("x1", v); line.setAttribute("x2", v); } };
}

/** グラフの左の見出しと目盛り */
export function axisLabel(svg: SVGSVGElement, text: string, y: number, color = "#77736a"): void {
  svg.append(el("text", { x: 4, y, class: "motion-axis", fill: color }, text));
}

// ---------------------------------------------------------------- 心臓

/** 心臓の場面の語（部屋の壁・弁・出入りする血管・冠状血管・刺激伝導系） */
const HEART_WALLS = ["right-atrium", "right-ventricle", "left-atrium", "left-ventricle", "papillary-muscles", "fibrous-rings-of-heart"];
const HEART_VALVES: [string, HeartPart][] = [["mitral-valve", "av-valve-l"], ["tricuspid-valve", "av-valve-r"], ["aortic-valve", "sl-valve-l"], ["pulmonary-valve", "sl-valve-r"]];
const HEART_VESSELS = ["superior-vena-cava", "inferior-vena-cava", "pulmonary-trunk", "right-pulmonary-artery", "left-pulmonary-artery", "pulmonary-veins", "ascending-aorta", "aortic-arch"];
const CORONARY = ["right-coronary-artery", "left-coronary-artery", "anterior-interventricular-branch", "circumflex-branch", "posterior-interventricular-branch", "great-cardiac-vein", "middle-cardiac-vein", "coronary-sinus"];
const CONDUCTION_TERMS = ["sinuatrial-node", "atrioventricular-node", "atrioventricular-bundle", "right-bundle-branch", "left-bundle-branch", "purkinje-fibers"];

/** 心臓の変形の重みの並び: 定数・左右の心室の縮み・左右の心房の縮み・4つの弁の開き */
const HEART_CHANNELS = 9;
function heartWeights(state: HeartState, out: Float32Array): Float32Array {
  out[0] = 1;
  out[1] = state.cvL;
  out[2] = state.cvR;
  out[3] = state.caL;
  out[4] = state.caR;
  out[5] = state.open.mi;
  out[6] = state.open.ti;
  out[7] = state.open.ao;
  out[8] = state.open.po;
  return out;
}

/** 心臓の部品を変形できるようにする（parts は部品ID → 動き方） */
function heartDeform(viewer: AnatomyViewer, heart: HeartData, parts: Map<string, HeartPart>): LinearDeform {
  const zero: HeartState = { cvL: 0, cvR: 0, caL: 0, caR: 0, open: { mi: 0, ti: 0, ao: 0, po: 0 } };
  const unit = (c: number): HeartState => ({
    cvL: c === 1 ? 1 : 0, cvR: c === 2 ? 1 : 0, caL: c === 3 ? 1 : 0, caR: c === 4 ? 1 : 0,
    open: { mi: c === 5 ? 1 : 0, ti: c === 6 ? 1 : 0, ao: c === 7 ? 1 : 0, po: c === 8 ? 1 : 0 },
  });
  const base: Vec3 = [0, 0, 0];
  return new LinearDeform(viewer, [...parts.keys()], HEART_CHANNELS, (p, element, c, out) => {
    const part = parts.get(element)!;
    heartDisplace(heart, zero, p, part, base);
    if (c === 0) {
      out[0] = base[0];
      out[1] = base[1];
      out[2] = base[2];
      return;
    }
    heartDisplace(heart, unit(c), p, part, out);
    out[0] -= base[0];
    out[1] -= base[1];
    out[2] -= base[2];
  });
}

/** 心臓の場面の部品と動き方。大血管は心臓に近い部品だけ（下大静脈の腹の部分などは除く） */
function heartParts(ctx: AppContext, heart: HeartData, conduction: boolean): { parts: Map<string, HeartPart>; walls: string[]; valves: string[]; vessels: string[]; coronary: string[]; nodes: string[] } {
  const near = (element: string) => {
    const c = ctx.viewer.partCenter([element]);
    return !!c && Math.hypot(c[0] - heart.base[0], c[1] - heart.base[1], c[2] - heart.base[2]) < 0.11;
  };
  const walls = elementsOf(ctx, HEART_WALLS);
  const valves: string[] = [];
  const parts = new Map<string, HeartPart>();
  for (const element of walls) parts.set(element, "wall");
  for (const [id, part] of HEART_VALVES) for (const element of elementsOf(ctx, [id])) {
    // 腱索は弁尖と乳頭筋をつなぐひもなので、弁の開き方ではなく心室の壁と一緒に動かす
    parts.set(element, element.includes("chordae") ? "wall" : part);
    valves.push(element);
  }
  const vessels = elementsOf(ctx, HEART_VESSELS).filter(near);
  for (const element of vessels) parts.set(element, "vessel");
  const coronary = elementsOf(ctx, CORONARY).filter(near);
  for (const element of coronary) parts.set(element, "wall");
  const nodes = conduction ? elementsOf(ctx, CONDUCTION_TERMS) : [];
  for (const element of nodes) parts.set(element, "wall");
  return { parts, walls, valves, vessels, coronary, nodes };
}

/** 心臓の拍動の場面・刺激伝導系の場面 */
async function heartScene(ctx: AppContext, player: Player, conduction: boolean): Promise<void> {
  const { viewer, panel } = ctx;
  ctx.hint("読み込み中…");
  const [cycle, heart] = await Promise.all([loadMotionData<CardiacCycle>("cardiac-cycle"), loadMotionData<HeartData>("heart"), viewer.show({ systems: ["cardiovascular"] })]);
  if (ctx.signal.aborted) return;
  ctx.hint("");
  const timeline = cardiacTimeline(cycle);
  const organ = organById.get("heart");
  const { parts, walls, valves, vessels, coronary, nodes } = heartParts(ctx, heart, conduction);
  const chamberColors = colorsOf(ctx, organ?.colors ?? {});
  const vesselColors = colorsOf(ctx, Object.fromEntries(HEART_VESSELS.map((id) => [id, termById.get(id)?.color ?? RED])));
  let see = true; // 壁を透かして中の流れを見る
  let cut = false;
  const stage = (): StageSpec => {
    const colors = { ...chamberColors, ...vesselColors, ...Object.fromEntries(valves.map((e) => [e, VALVE])), ...Object.fromEntries(nodes.map((e) => [e, CONDUCTION_COLOR])) };
    const glassy = conduction || see;
    return {
      // 刺激伝導系の場面は、弁と腱索を隠して伝導系を見やすく
      solid: [...(conduction ? [] : valves), ...(glassy ? [] : [...walls, ...vessels, ...coronary])],
      glow: nodes,
      glass: glassy ? [...walls, ...vessels] : [],
      colors, glassStrength: conduction ? 0.55 : 0.7,
    };
  };
  viewer.setStage(stage());
  const deform = heartDeform(viewer, heart, parts);
  const weights = new Float32Array(HEART_CHANNELS);
  const views: [string, Vec3][] = [["前", [0, 0.05, 1]], ["左前", [0.7, 0.15, 0.75]], ["下", [0.15, -1, 0.5]], ["後ろ", [0, 0.1, -1]]];
  const { caption, update: captionAt, phaseSpans, stepSpans } = heartCaption(ctx, player, cycle, timeline, conduction);
  viewer.frameStage(views[0][1], [...walls, ...valves], 0.8);

  // 血液の粒（心臓の中の流れ。弁の流れの速さで進む）
  const flows = heart.flows.map((flow) => {
    const lines = flow.segments.map((segment) => Polyline.of(segment.points));
    const ends: number[] = [];
    let total = 0;
    for (const line of lines) {
      total += line.length;
      ends.push(total);
    }
    return { flow, lines, ends, total, color: hex(flow.blood === "venous" ? BLUE : RED) };
  });
  const perFlow = conduction ? 0 : 22;
  const sparks = conduction ? 4 + heart.conduction.lbb.length + heart.conduction.purkinje.length : 0;
  const dots = viewer.setDots(flows.length * perFlow + sparks, conduction ? 0.0016 : 0.0021)!;
  const blood = flows.flatMap((flow, f) => Array.from({ length: perFlow }, (_, i) => ({
    f, s: (flow.total * (i + Math.random() * 0.6)) / perFlow,
    jitter: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5].map((v) => v * 0.006),
  })));
  const peak = Object.fromEntries(Object.entries(cycle.flow).map(([key, list]) => [key, Math.max(...list)]));
  const lbbLines = heart.conduction.lbb.map((line) => Polyline.of([heart.conduction.his, ...line]));
  const rbbLine = Polyline.of([heart.conduction.his, ...heart.conduction.rbb]);
  const saToAv = Polyline.of([heart.conduction.san, heart.conduction.avn]);
  const saToLa = Polyline.of([heart.conduction.san, heart.chambers.la]);

  const tmp = new Float32Array(3);
  const place = (i: number, line: Polyline, s: number, color: [number, number, number], size: number) => {
    line.at(s, dots.position, i * 3);
    dots.color.set(color, i * 3);
    dots.size[i] = size;
  };
  const yellow = hex("#fff2a8");
  const hot = hex("#ffb300");
  const red = hex("#ff5a1f");
  const sparkFrame = (u: number) => {
    const c = CONDUCTION;
    const t = u < 0.5 ? u + 1 : u; // プルキンエ線維は1拍の終わりから次の初めにかかる
    let i = blood.length;
    const along = (from: number, to: number, line: Polyline) => {
      if (t < from || t > to) {
        dots.size[i++] = 0;
        return;
      }
      place(i++, line, ((t - from) / (to - from)) * line.length, yellow, 2.4);
    };
    along(c.san, c.avn, saToAv);
    along(c.san, c.avn + 0.02, saToLa);
    // 房室結節で待つ間は、結節で明滅する
    if (t >= c.avn && t < c.his) {
      tmp.set(heart.conduction.avn);
      dots.position.set(tmp, i * 3);
      dots.color.set(hot, i * 3);
      dots.size[i++] = 2 + Math.sin(t * 400) * 0.6;
    } else dots.size[i++] = 0;
    for (const line of [rbbLine, ...lbbLines]) along(c.his, c.bundleEnd, line);
    const n = heart.conduction.purkinje.length;
    heart.conduction.purkinje.forEach((point, k) => {
      const at = c.bundleEnd + ((c.purkinjeEnd - c.bundleEnd) * k) / n;
      const age = t - at;
      if (age < 0 || age > 0.08) {
        dots.size[i++] = 0;
        return;
      }
      dots.position.set(point, i * 3);
      mix(hot, red, age / 0.08, dots.color, i * 3);
      dots.size[i++] = 1.1 * (1 - age / 0.08) + 0.3;
    });
  };
  const bloodFrame = (u: number, dt: number) => {
    for (const [i, particle] of blood.entries()) {
      const flow = flows[particle.f];
      let k = flow.ends.findIndex((end) => particle.s < end);
      if (k < 0) k = flow.ends.length - 1;
      const key = flow.flow.segments[k].flow;
      const q = Math.max(0, cyclic(cycle.flow[key], u));
      // 弁を通る流れは弁の流れの速さで、静脈の流れはゆっくり一定に近く
      particle.s += dt * q * (key === "svn" || key === "pvn" ? 0.0007 : 0.0006) * (peak[key] > 0 ? 1 : 0);
      if (particle.s >= flow.total) particle.s -= flow.total;
      const start = k ? flow.ends[k - 1] : 0;
      flow.lines[k].at(particle.s - start, dots.position, i * 3);
      // 部屋の中（2つめの区間と、1つめの区間の終わり）では、粒を部屋の中に広げる（弁が閉じている間たまる様子）
      const inChamber = k === 1 || (k === 0 && flow.ends[0] - particle.s < 0.012);
      const spread = inChamber ? 2.6 : 0.5;
      dots.position[i * 3] += particle.jitter[0] * spread;
      dots.position[i * 3 + 1] += particle.jitter[1] * spread;
      dots.position[i * 3 + 2] += particle.jitter[2] * spread;
      dots.color.set(flow.color, i * 3);
      dots.size[i] = see ? 1 : 0;
    }
  };

  // 欄
  const phaseName = h("strong", { class: "motion-now-name" });
  const phaseNote = h("p", { class: "motion-now-note" });
  const valveRow = h("div", { class: "motion-valves" });
  const valveNames: [keyof HeartState["open"], string][] = [["ti", "三尖弁"], ["po", "肺動脈弁"], ["mi", "僧帽弁"], ["ao", "大動脈弁"]];
  const valvePills = valveNames.map(([key, name]) => {
    const pill = h("span", { class: "motion-valve" }, name, h("b", {}));
    valveRow.append(pill);
    return [key, pill] as const;
  });
  const stepList = conduction ? h("ol", { class: "motion-steps" }, ...(Object.keys(CONDUCTION_STEPS) as ConductionStep[]).map((key) =>
    h("li", { "data-key": key }, h("b", {}, CONDUCTION_STEPS[key].ja), h("span", {}, CONDUCTION_STEPS[key].note)))) : null;
  const sound = new HeartSound();
  let lastU = 0;

  const graph = conduction ? ecgChart((u) => player.seek(u, cycle.period)) : wiggers(cycle, timeline, (u) => player.seek(u, cycle.period));
  player.onFrame((time, dt) => {
    const u = (time / cycle.period) % 1;
    const state = heartState(cycle, u);
    deform.apply(heartWeights(state, weights));
    if (conduction) sparkFrame(u);
    else bloodFrame(u, dt);
    viewer.dotsChanged(dots.capacity);
    graph.cursor(u);
    captionAt(u);
    const phase = phaseAt(timeline, u);
    if (conduction) {
      const step = conductionStep(u);
      if (phaseName.dataset.key !== step) {
        phaseName.dataset.key = step;
        phaseName.textContent = CONDUCTION_STEPS[step].ja;
        phaseNote.textContent = `${CARDIAC_PHASES[phase].ja}のころ。${CONDUCTION_STEPS[step].note}`;
        for (const li of stepList!.children) li.classList.toggle("on", (li as HTMLElement).dataset.key === step);
      }
    } else if (phaseName.dataset.key !== phase) {
      phaseName.dataset.key = phase;
      phaseName.textContent = `${CARDIAC_PHASES[phase].ja}（${CARDIAC_PHASES[phase].systole ? "収縮期" : "拡張期"}）`;
      phaseNote.textContent = CARDIAC_PHASES[phase].note;
    }
    for (const [key, pill] of valvePills) {
      const open = state.open[key] > 0.05;
      if (pill.classList.contains("open") !== open) {
        pill.classList.toggle("open", open);
        pill.lastElementChild!.textContent = open ? "開" : "閉";
      }
    }
    if (dt > 0) sound.cross(lastU, u, timeline);
    lastU = u;
  });

  const lv = cycle.volume.lv;
  const sv = timeline.edv - timeline.esv;
  const sas = cycle.pressure.sas;
  const viewChips = h("div", { class: "chip-list" }, ...views.map(([label, from]) => h("button", {
    class: "chip", type: "button", onClick: () => viewer.frameStage(from, [...walls, ...valves], 0.8),
  }, label)));
  const cutToggle = toggle("前から切って4つの部屋を見る（前頭断）", cut, (on) => {
    cut = on;
    viewer.setSection(on ? { axis: "z", at: heart.chambers.lv[2] + 0.004, keep: -1 } : null);
    if (on) viewer.frameStage([0, 0.05, 1], [...walls, ...valves], 0.8);
  });
  panel.replaceChildren(
    h("div", { class: "motion-head" }, h("h2", {}, conduction ? "刺激伝導系と心電図" : "心臓の拍動と心周期"), h("span", { class: "muted", lang: "en" }, conduction ? "cardiac conduction system" : "cardiac cycle")),
    h("p", { class: "motion-lead" }, conduction
      ? "黄色の光が興奮の伝わり。洞房結節 → 心房 → 房室結節（ここで少し待つ）→ ヒス束 → 右脚・左脚 → プルキンエ線維と進み、そのあと心室が縮みます。下の心電図の今の位置と見比べてください。"
      : "青の粒は静脈血、赤の粒は動脈血。弁の開いている間だけ血液が流れ、閉じている間は心房にたまります。グラフを押すと、その時点で止まります。"),
    player.controls(() => cycle.period),
    h("div", { class: "motion-now" }, phaseName, phaseNote, valveRow),
    graph.svg,
    stepList ?? "",
    h("h3", { class: "list-title" }, "確かめる"),
    motionCheck(ctx, {
      make: (rng) => (conduction ? conductionQuestion(rng, stepSpans) : heartQuestion(rng, phaseSpans)),
      show: (q) => player.seek(q.u ?? 0, cycle.period),
      mask: (on) => caption.mask(on),
    }),
    h("h3", { class: "list-title" }, "見方"),
    viewChips,
    conduction ? "" : toggle("壁を透かして血液の流れを見る", see, (on) => {
      see = on;
      viewer.setStage(stage());
    }),
    cutToggle,
    conduction ? "" : toggle("心音を鳴らす（Ⅰ音・Ⅱ音）", false, (on) => sound.enable(on)),
    pickBox(ctx),
    h("h3", { class: "list-title" }, "この1拍の数値（モデルの値）"),
    h("dl", { class: "motion-facts" },
      h("dt", {}, "心拍数"), h("dd", {}, `${Math.round(60 / cycle.period)} 回/分`),
      h("dt", {}, "左心室の容積"), h("dd", {}, `拡張末期 ${Math.round(timeline.edv)} mL → 収縮末期 ${Math.round(timeline.esv)} mL`),
      h("dt", {}, "1回拍出量・駆出率"), h("dd", {}, `${Math.round(sv)} mL・${Math.round((sv / Math.max(...lv)) * 100)}%`),
      h("dt", {}, "大動脈圧"), h("dd", {}, `${Math.round(Math.max(...sas))} / ${Math.round(Math.min(...sas))} mmHg`),
      h("dt", {}, "肺動脈圧"), h("dd", {}, `${Math.round(Math.max(...cycle.pressure.pas))} / ${Math.round(Math.min(...cycle.pressure.pas))} mmHg`),
    ),
    h("h3", { class: "list-title" }, "関係する語"),
    relatedTerms(conduction
      ? ["sinuatrial-node", "atrioventricular-node", "atrioventricular-bundle", "right-bundle-branch", "left-bundle-branch", "purkinje-fibers", "interventricular-septum", "crista-terminalis"]
      : ["right-atrium", "right-ventricle", "left-atrium", "left-ventricle", "tricuspid-valve", "pulmonary-valve", "mitral-valve", "aortic-valve", "chordae-tendineae", "papillary-muscles"]),
    h("p", { class: "plate-credit muted" },
      "圧・容積・弁の流れは ModularCirc（Alan Turing Institute, MIT License）の Korakianitis & Shi (2006) の4つの部屋のモデルを解いた値（心房の受動的な硬さだけ、健康な成人の充満に近づけるよう変えた）。心臓の形は BodyParts3D、動かし方（壁の縮み・心底の下がり・弁の開き）はこのアプリの模式。心電図は模式です。"),
  );
  if (!player.playing) ctx.hint("▶ 再生 で動きます");
}

/** 心周期のグラフ（Wiggers の図）: 圧（左心室・大動脈・左心房）・左心室の容積・心電図と、区分の帯 */
export function wiggers(cycle: CardiacCycle, timeline: CardiacTimeline, seek: (u: number) => void) {
  return chart(330, [
    { values: cycle.pressure.sas, color: "#8b1e2b", min: 0, max: 130, top: 30, height: 140, dash: "6 4" },
    { values: cycle.pressure.la, color: "#e58a9a", min: 0, max: 130, top: 30, height: 140 },
    { values: cycle.pressure.lv, color: RED, min: 0, max: 130, top: 30, height: 140, width: 2.6 },
    { values: cycle.volume.lv, color: "#2f6f9f", min: 40, max: 150, top: 190, height: 70, width: 2.4 },
    { values: cycle.t.map((t) => ecg(t / cycle.period)), color: "#2b2a27", min: -0.35, max: 1.05, top: 272, height: 52, width: 1.6 },
  ], (svg, x) => {
    timeline.spans.forEach((span, i) => {
      svg.append(el("rect", { x: x(span.from), y: 0, width: Math.max(0, x(span.to) - x(span.from)), height: 330, fill: CARDIAC_PHASES[span.key].systole ? "#fbe9e6" : i % 2 ? "#f3f0e8" : "#faf8f2" }));
      if (x(span.to) - x(span.from) > 34) svg.append(el("text", { x: (x(span.from) + x(span.to)) / 2, y: 14, class: "motion-band", "text-anchor": "middle" }, CARDIAC_PHASES[span.key].short));
    });
    for (const [u, label] of [[timeline.s1, "Ⅰ音"], [timeline.s2, "Ⅱ音"]] as const) {
      svg.append(el("line", { x1: x(u), x2: x(u), y1: 18, y2: 328, class: "motion-sound" }), el("text", { x: x(u) + 3, y: 186, class: "motion-axis" }, label));
    }
    axisLabel(svg, "圧", 44);
    axisLabel(svg, "mmHg", 58);
    axisLabel(svg, "容積", 214, "#2f6f9f");
    axisLabel(svg, "心電図", 300);
    svg.append(
      el("text", { x: CHART_W - 10, y: 44, class: "motion-legend", "text-anchor": "end", fill: RED }, "左心室圧"),
      el("text", { x: CHART_W - 10, y: 58, class: "motion-legend", "text-anchor": "end", fill: "#8b1e2b" }, "大動脈圧（点線）"),
      el("text", { x: CHART_W - 10, y: 72, class: "motion-legend", "text-anchor": "end", fill: "#e58a9a" }, "左心房圧"),
      el("text", { x: CHART_W - 10, y: 204, class: "motion-legend", "text-anchor": "end", fill: "#2f6f9f" }, "左心室の容積"),
    );
  }, seek, "心周期の左心室圧・大動脈圧・左心房圧・左心室の容積・心電図のグラフ");
}

/** 心電図（模式）と、刺激伝導の段階の帯。P 波の前から T 波のあとまで（1拍の 6 割）を広げて描く */
export function ecgChart(seek: (u: number) => void) {
  const from = 0.82;
  const span = 0.62;
  const n = 200;
  const values = Array.from({ length: n }, (_, i) => ecg(from + (i / n) * span));
  const local = (u: number) => ((((u - from) % 1) + 1) % 1) / span;
  const result = chart(160, [{ values, color: "#2b2a27", min: -0.35, max: 1.1, top: 34, height: 100, width: 2 }], (svg, x) => {
    const c = CONDUCTION;
    const at = (u: number) => x(Math.min(1, local(u)));
    for (const [a, b, fill, label] of [[c.san, c.avn, "#fff3c4", "心房"], [c.avn, c.his, "#fde7c8", "房室結節"], [c.his, c.purkinjeEnd, "#fbe0d8", "心室へ"]] as const) {
      svg.append(el("rect", { x: at(a), y: 0, width: Math.max(0, at(b) - at(a)), height: 160, fill }), el("text", { x: (at(a) + at(b)) / 2, y: 14, class: "motion-band", "text-anchor": "middle" }, label));
    }
    for (const [u, label] of [[0.875, "P"], [0.976, "QRS"], [0.25, "T"]] as const) svg.append(el("text", { x: at(u), y: 154, class: "motion-legend", "text-anchor": "middle" }, label));
    axisLabel(svg, "心電図", 86);
    svg.append(el("text", { x: CHART_W - 10, y: 154, class: "motion-legend", "text-anchor": "end" }, "（このあと次の P 波まで休む）"));
  }, (w) => seek((from + w * span) % 1), "心電図（模式）と刺激伝導の段階");
  // 描いている区間の外（休み）は、右の端に線を置く
  return { svg: result.svg, cursor: (u: number) => result.cursor(Math.min(0.999, local(u))) };
}

/** 心音（Ⅰ音・Ⅱ音）を Web Audio の短い低い音で鳴らす（押して有効にしたときだけ） */
export class HeartSound {
  private audio: AudioContext | null = null;

  enable(on: boolean): void {
    if (on && !this.audio) this.audio = new AudioContext();
    else if (!on && this.audio) {
      void this.audio.close();
      this.audio = null;
    }
  }

  cross(from: number, to: number, timeline: CardiacTimeline): void {
    if (!this.audio) return;
    const passed = (u: number) => (from <= to ? from < u && u <= to : from < u || u <= to);
    if (passed(timeline.s1)) this.beat(48, 0.12, 0.5);
    if (passed(timeline.s2)) this.beat(70, 0.08, 0.4);
  }

  private beat(frequency: number, length: number, volume: number): void {
    const audio = this.audio!;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + length);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + length);
  }
}

// ---------------------------------------------------------------- 呼吸

const LUNG_COLOR = "#e79aa2";
const AIRWAYS = ["trachea", "main-bronchus", "right-superior-lobar-bronchus", "middle-lobar-bronchus", "right-inferior-lobar-bronchus", "left-superior-lobar-bronchus", "left-inferior-lobar-bronchus", "segmental-bronchi"];
const CHEST_BONES = ["ribs", "costal-cartilages", "sternum", "thoracic-vertebrae"];
const INTERCOSTALS = ["external-intercostal", "internal-intercostal"];
const BREATH_HEART = ["right-atrium", "right-ventricle", "left-atrium", "left-ventricle", "ascending-aorta", "aortic-arch", "pulmonary-trunk", "superior-vena-cava"];
/** 深呼吸は安静呼吸の動きを何倍にするか・周期を何倍にするか（目安） */
export const DEEP = { amplitude: 2.4, period: 1.7 };

async function breathingScene(ctx: AppContext, player: Player): Promise<void> {
  const { viewer, panel } = ctx;
  ctx.hint("読み込み中…");
  const [data, heart] = await Promise.all([
    loadMotionData<BreathingData>("breathing"), loadMotionData<HeartData>("heart"),
    viewer.show({ systems: ["respiratory", "skeletal", "muscular", "cardiovascular"] }),
  ]);
  if (ctx.signal.aborted) return;
  ctx.hint("");
  const lungs = elementsOf(ctx, ["lung"]);
  const airways = elementsOf(ctx, AIRWAYS);
  const bones = elementsOf(ctx, CHEST_BONES);
  const diaphragm = elementsOf(ctx, ["diaphragm"]);
  const intercostals = elementsOf(ctx, INTERCOSTALS);
  const breathHeart = elementsOf(ctx, BREATH_HEART);
  let deep = false;
  let showHeart = true;
  let showIntercostals = false;
  let glassLungs = true;
  const organ = organById.get("heart");
  const stage = (): StageSpec => ({
    solid: [...airways, ...bones, ...diaphragm, ...(showHeart ? breathHeart : []), ...(showIntercostals ? intercostals : []), ...(glassLungs ? [] : lungs)],
    glass: glassLungs ? lungs : [],
    colors: { ...Object.fromEntries(lungs.map((e) => [e, LUNG_COLOR])), ...colorsOf(ctx, organ?.colors ?? {}) },
    glassStrength: 0.75,
  });
  viewer.setStage(stage());

  // 横隔膜は、ドームの上（肺の底に接する所）は肺の場、縁（肋骨・腰椎に付く所）は胸郭の場で動かす
  const lungField = new Set([...lungs, ...airways, ...breathHeart]);
  const yRange: [number, number] = [Infinity, -Infinity];
  for (const item of viewer.deformable(diaphragm)) {
    for (let i = 1; i < item.rest.length; i += 3) {
      yRange[0] = Math.min(yRange[0], item.rest[i]);
      yRange[1] = Math.max(yRange[1], item.rest[i]);
    }
  }
  const tmp: Vec3 = [0, 0, 0];
  const deform = new LinearDeform(viewer, [...lungField, ...bones, ...diaphragm, ...intercostals], 4, (p, element, c, out) => {
    let b = lungField.has(element) ? 1 : 0;
    if (diaphragm.includes(element)) {
      const t = Math.min(1, Math.max(0, (p[1] - yRange[0]) / (yRange[1] - yRange[0] || 1)));
      b = t * t * (3 - 2 * t);
    }
    const field = c < 2 ? "lung" : "chest";
    const weight = c < 2 ? b : 1 - b;
    if (!weight) {
      out[0] = out[1] = out[2] = 0;
      return;
    }
    sampleField(data, field, c % 2, p[0], p[1], p[2], tmp);
    out[0] = tmp[0] * weight;
    out[1] = tmp[1] * weight;
    out[2] = tmp[2] * weight;
  });
  const weights = new Float32Array(4);
  const views: [string, Vec3][] = [["前", [0, 0.05, 1]], ["右", [-1, 0.05, 0.15]], ["左前", [0.7, 0.1, 0.75]]];
  const period = () => data.period * (deep ? DEEP.period : 1);
  const { caption, update: captionAt, spans: breathParts } = breathCaption(ctx, player, data, period);
  viewer.frameStage(views[0][1], [...lungs, ...diaphragm], 1.05);

  // 空気の粒（吸うと気管から気管支へ、吐くと戻る）
  const airLines = heart.airways.map((line) => Polyline.of(line));
  const perLine = 14;
  const dots = viewer.setDots(airLines.length * perLine, 0.0022)!;
  const air = airLines.flatMap((line, k) => Array.from({ length: perLine }, (_, i) => ({ k, s: (line.length * (i + Math.random())) / perLine })));
  const fresh = hex("#4fc3f7");
  const stale = hex("#9aa3ad");

  const phaseName = h("strong", { class: "motion-now-name" });
  const phaseNote = h("p", { class: "motion-now-note" });
  const volumeText = h("span", { class: "motion-volume" });
  const graph = chart(170, [{ values: data.volume, color: "#c2493a", min: 0, max: Math.max(...data.volume) * 1.1, top: 26, height: 120, width: 2.6 }], (svg, x) => {
    const n = data.volume.length;
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const rising = i < n && data.volume[(i + 1) % n] > data.volume[i];
      if (rising && start < 0) start = i;
      if ((!rising || i === n) && start >= 0) {
        svg.append(el("rect", { x: x(start / n), y: 0, width: x(i / n) - x(start / n), height: 170, fill: "#e6f3fb" }),
          el("text", { x: (x(start / n) + x(i / n)) / 2, y: 14, class: "motion-band", "text-anchor": "middle" }, "吸気"));
        start = -1;
      }
    }
    svg.append(el("text", { x: x(0.72), y: 14, class: "motion-band", "text-anchor": "middle" }, "呼気"));
    axisLabel(svg, "肺の", 60);
    axisLabel(svg, "容積", 74);
    axisLabel(svg, "の増え", 88);
    svg.append(el("text", { x: CHART_W - 10, y: 164, class: "motion-legend", "text-anchor": "end" }, "→ 時間（1呼吸）"));
  }, (u) => player.seek(u, period()), "1呼吸の肺の容積の変化");

  player.onFrame((time, dt) => {
    const u = (time / period()) % 1;
    const amp = deep ? DEEP.amplitude : 1;
    const [l0, l1] = breathWeights(data, "lung", u);
    const [c0, c1] = breathWeights(data, "chest", u);
    weights[0] = l0 * amp;
    weights[1] = l1 * amp;
    weights[2] = c0 * amp;
    weights[3] = c1 * amp;
    deform.apply(weights);
    const flow = (cyclic(data.volume, u + 0.01) - cyclic(data.volume, u - 0.01)) / 0.02; // mL / 位相
    const speed = (flow / Math.max(...data.volume)) * 0.08 * amp;
    const color = flow >= 0 ? fresh : stale;
    for (const [i, particle] of air.entries()) {
      const line = airLines[particle.k];
      particle.s += (dt / period()) * speed * 10;
      if (particle.s > line.length) particle.s -= line.length;
      if (particle.s < 0) particle.s += line.length;
      line.at(particle.s, dots.position, i * 3);
      dots.color.set(color, i * 3);
      dots.size[i] = Math.abs(flow) > 30 ? 1 : 0.55;
    }
    viewer.dotsChanged(dots.capacity);
    graph.cursor(u);
    captionAt(u, deep);
    const inhale = inhaling(data, u);
    const key = `${inhale}:${deep}`;
    if (phaseName.dataset.key !== key) {
      phaseName.dataset.key = key;
      phaseName.textContent = inhale ? "吸気（息を吸う）" : "呼気（息を吐く）";
      phaseNote.textContent = inhale
        ? deep
          ? "横隔膜が強く縮んで大きく下がり、外肋間筋に加えて胸鎖乳突筋・斜角筋なども肋骨と胸骨を引き上げる。胸腔が広がって内圧が下がり、肺がふくらむ。"
          : "横隔膜が縮んでドームが下がり（主な吸気筋）、外肋間筋が肋骨を引き上げて胸郭が前と横へ広がる。胸腔の内圧が下がり、肺がふくらんで空気が入る（水色の粒）。"
        : deep
          ? "強く吐くときは、内肋間筋が肋骨を引き下げ、腹筋が腹圧を上げて横隔膜を押し上げる。"
          : "安静の呼気は受け身: 横隔膜と外肋間筋がゆるみ、肺と胸郭が自らの弾性で縮んで空気が出る（灰色の粒）。"
      ;
    }
    volumeText.textContent = `肺の容積 ＋${Math.round(cyclic(data.volume, u) * amp)} mL`;
  });

  const viewChips = h("div", { class: "chip-list" }, ...views.map(([label, from]) => h("button", {
    class: "chip", type: "button", onClick: () => viewer.frameStage(from, [...lungs, ...diaphragm], 1.05),
  }, label)));
  const tidal = Math.round(Math.max(...data.volume));
  panel.replaceChildren(
    h("div", { class: "motion-head" }, h("h2", {}, "呼吸"), h("span", { class: "muted", lang: "en" }, "breathing")),
    h("p", { class: "motion-lead" }, "実際の人の自由呼吸（4DMRI で撮った 47 回の平均）の肺と胸郭の動きを、このアプリの肺・肋骨・横隔膜に重ねて動かしています。横から見ると、横隔膜の下がり方と胸骨が前へ出る動きがよく分かります。"),
    player.controls(period),
    h("div", { class: "motion-now" }, phaseName, phaseNote, volumeText),
    graph.svg,
    h("div", { class: "motion-switch" }, segmented<boolean>("呼吸の深さ", [{ value: false, label: "安静呼吸" }, { value: true, label: "深呼吸（目安）" }], deep, (value) => {
      deep = value;
      phaseName.dataset.key = "";
    })),
    h("h3", { class: "list-title" }, "確かめる"),
    motionCheck(ctx, {
      make: (rng) => breathQuestion(rng, breathParts),
      show: (q) => player.seek(q.u ?? 0, period()),
      mask: (on) => caption.mask(on),
    }),
    h("h3", { class: "list-title" }, "見方"),
    viewChips,
    toggle("肺を透かす（気管支と空気の流れを見る）", glassLungs, (on) => {
      glassLungs = on;
      viewer.setStage(stage());
    }),
    toggle("心臓を出す", showHeart, (on) => {
      showHeart = on;
      viewer.setStage(stage());
    }),
    toggle("肋間筋を出す", showIntercostals, (on) => {
      showIntercostals = on;
      viewer.setStage(stage());
    }),
    pickBox(ctx),
    h("h3", { class: "list-title" }, "この呼吸の数値（被験者の実測）"),
    h("dl", { class: "motion-facts" },
      h("dt", {}, "1回換気量"), h("dd", {}, `約 ${tidal} mL（安静呼吸。成人の目安は約 500 mL）`),
      h("dt", {}, "1呼吸の長さ"), h("dd", {}, `約 ${data.period.toFixed(1)} 秒（毎分 約 ${Math.round(60 / data.period)} 回）`),
      h("dt", {}, "吸気と呼気"), h("dd", {}, "吸気の方が短い（呼気は受け身でゆっくり）"),
    ),
    h("p", { class: "home-note" }, `深呼吸は、安静呼吸の動きを ${DEEP.amplitude} 倍・周期を ${DEEP.period} 倍にした目安です（実測ではありません）。`),
    h("h3", { class: "list-title" }, "関係する語"),
    relatedTerms(["diaphragm", "external-intercostal", "internal-intercostal", "lung", "trachea", "main-bronchus", "costodiaphragmatic-recess", "sternocleidomastoid", "anterior-scalene"]),
    h("p", { class: "plate-credit muted" },
      "動きのデータ: 4DMRI moving meshes（A. Duetschler, T. Jenny, D. C. Weber, A. J. Lomax, Y. Zhang. Zenodo 2022, doi:10.5281/zenodo.7052607, CC BY 4.0）の MRI1。肺と胸郭の点の動きを1呼吸の位相ごとに平均し、このアプリの肺の大きさに合わせて変位の場にしました（肺と胸郭は別の場。肺は胸壁の内側をすべるため）。"),
  );
  if (!player.playing) ctx.hint("▶ 再生 で動きます");
}

// ---------------------------------------------------------------- 肺循環と体循環

const CIRCULATION_VESSELS = [
  "ascending-aorta", "aortic-arch", "thoracic-aorta", "abdominal-aorta", "brachiocephalic-trunk", "common-carotid-artery", "internal-carotid-artery",
  "subclavian-artery", "axillary-artery", "brachial-artery", "radial-artery", "ulnar-artery", "superior-mesenteric-artery", "renal-artery",
  "common-iliac-artery", "external-iliac-artery", "femoral-artery", "popliteal-artery", "anterior-tibial-artery", "posterior-tibial-artery",
  "pulmonary-trunk", "right-pulmonary-artery", "left-pulmonary-artery", "superior-pulmonary-vein", "inferior-pulmonary-vein",
  "superior-vena-cava", "inferior-vena-cava", "brachiocephalic-vein", "internal-jugular-vein", "subclavian-vein", "axillary-vein", "brachial-veins",
  "radial-veins", "ulnar-veins", "renal-vein", "common-iliac-vein", "external-iliac-vein", "femoral-vein", "popliteal-vein", "posterior-tibial-veins",
  "hepatic-portal-vein", "hepatic-veins", "superior-mesenteric-vein",
];

async function circulationScene(ctx: AppContext, player: Player): Promise<void> {
  const { viewer, panel } = ctx;
  ctx.hint("読み込み中…");
  const [data, cycle, heart] = await Promise.all([
    loadMotionData<CirculationData>("circulation"), loadMotionData<CardiacCycle>("cardiac-cycle"), loadMotionData<HeartData>("heart"),
    viewer.show({ systems: ["cardiovascular", "respiratory"], body: true }),
  ]);
  if (ctx.signal.aborted) return;
  ctx.hint("");
  const vessels = elementsOf(ctx, CIRCULATION_VESSELS);
  const { parts, walls, valves } = heartParts(ctx, heart, false);
  const lungs = elementsOf(ctx, ["lung"]);
  const organ = organById.get("heart");
  viewer.setStage({
    solid: valves,
    glass: [...vessels, ...walls],
    ghost: lungs,
    body: true,
    colors: { ...colorsOf(ctx, Object.fromEntries(CIRCULATION_VESSELS.map((id) => [id, termById.get(id)?.color ?? RED]))), ...colorsOf(ctx, organ?.colors ?? {}), ...Object.fromEntries(lungs.map((e) => [e, LUNG_COLOR])) },
    glassStrength: 0.65,
  });
  const deform = heartDeform(viewer, heart, parts);
  const weights = new Float32Array(HEART_CHANNELS);
  viewer.overview();

  const lines = data.routes.map((route) => ({ route, line: routeLine(route), cap: capillaryRange(route) }));
  const systemic = lines.filter((item) => item.route.kind === "systemic");
  const pulmonary = lines.filter((item) => item.route.kind === "pulmonary");
  const pick = (list: typeof lines) => {
    if (list[0].route.kind === "pulmonary") return list[Math.random() < 0.55 ? 0 : 1];
    let r = Math.random() * 100;
    for (const item of list) {
      r -= ROUTE_SHARE[item.route.id] ?? 0;
      if (r <= 0) return item;
    }
    return list[list.length - 1];
  };
  const count = 420;
  const dots = viewer.setDots(count, 0.005)!;
  // はじめは、道の長さに比べてむらなく置く
  const particles = Array.from({ length: count }, (_, i) => {
    const item = i % 3 === 0 ? pick(pulmonary) : pick(systemic);
    return { item, s: Math.random() * item.line.length };
  });
  const red = hex(RED);
  const blue = hex(BLUE);
  let filter = "both" as "both" | "systemic" | "pulmonary";
  const peakAo = Math.max(...cycle.flow.ao);
  const peakPo = Math.max(...cycle.flow.po);

  const legend = h("p", { class: "motion-now-note" });
  player.onFrame((time, dt) => {
    const u = (time / cycle.period) % 1;
    deform.apply(heartWeights(heartState(cycle, u), weights));
    const pulseS = 0.5 + 1.6 * (cyclic(cycle.flow.ao, u) / peakAo);
    const pulseP = 0.5 + 1.6 * (cyclic(cycle.flow.po, u) / peakPo);
    for (const [i, particle] of particles.entries()) {
      const { route, line, cap } = particle.item;
      const systemicRoute = route.kind === "systemic";
      // 動脈は拍動につれて速く、毛細血管はゆっくり、静脈はなめらかに
      const factor = particle.s < cap[0] ? (systemicRoute ? pulseS : pulseP) : particle.s < cap[1] ? 0.25 : 0.75;
      particle.s += dt * 0.14 * factor;
      if (particle.s >= line.length) {
        particle.item = pick(systemicRoute ? pulmonary : systemic);
        particle.s = 0;
      }
      const now = particle.item;
      now.line.at(particle.s, dots.position, i * 3);
      const t = Math.min(1, Math.max(0, (particle.s - now.cap[0]) / Math.max(0.001, now.cap[1] - now.cap[0])));
      if (now.route.kind === "systemic") mix(red, blue, t, dots.color, i * 3);
      else mix(blue, red, t, dots.color, i * 3);
      dots.size[i] = filter === "both" || filter === now.route.kind ? 1 : 0;
    }
    viewer.dotsChanged(count);
  });

  const describe = () => {
    legend.textContent = filter === "pulmonary"
      ? "肺循環（小循環）: 右心室 → 肺動脈幹 → 肺動脈 → 肺の毛細血管（ここで二酸化炭素を出し酸素を受け取る）→ 肺静脈 → 左心房。肺動脈は静脈血（青）、肺静脈は動脈血（赤）を運ぶ。"
      : filter === "systemic"
        ? "体循環（大循環）: 左心室 → 大動脈 → 全身の動脈 → 毛細血管（酸素を渡し二酸化炭素を受け取る）→ 静脈 → 上大静脈・下大静脈 → 右心房。腸からの血液は門脈を通って肝臓へ入ってから戻る。"
        : "赤＝動脈血（酸素の多い血液）、青＝静脈血。粒の色が変わる所が毛細血管。体循環から右心房へ戻った粒は肺循環へ、肺循環から左心室へ戻った粒は体循環へ進む。";
  };
  describe();
  const shares = systemic.map((item) => [item.route.label, ROUTE_SHARE[item.route.id] ?? 0] as const);
  const views: [string, () => void][] = [
    ["全身", () => viewer.overview()],
    ["胸", () => viewer.frameStage([0, 0.05, 1], [...walls, ...elementsOf(ctx, ["pulmonary-trunk", "aortic-arch", "superior-vena-cava"]), ...lungs], 1)],
    ["心臓", () => viewer.frameStage([0, 0.05, 1], [...walls, ...valves], 1.1)],
  ];
  panel.replaceChildren(
    h("div", { class: "motion-head" }, h("h2", {}, "肺循環と体循環"), h("span", { class: "muted", lang: "en" }, "pulmonary and systemic circulation")),
    h("p", { class: "motion-lead" }, "粒が血液。心臓の拍動につれて動脈の中で速くなり、毛細血管でゆっくりになります。実際は全身を1周するのに約1分かかりますが、ここでは道ごとに分かるよう速さを変えて見せています。"),
    player.controls(() => cycle.period),
    h("div", { class: "motion-switch" }, segmented<typeof filter>("見せる流れ", [{ value: "both", label: "両方" }, { value: "pulmonary", label: "肺循環" }, { value: "systemic", label: "体循環" }], filter, (value) => {
      filter = value;
      describe();
    })),
    h("div", { class: "motion-now" }, legend),
    h("h3", { class: "list-title" }, "見る所"),
    h("div", { class: "chip-list" }, ...views.map(([label, go]) => h("button", { class: "chip", type: "button", onClick: go }, label))),
    pickBox(ctx),
    h("h3", { class: "list-title" }, "心拍出量の分かれ方（安静時の目安）"),
    h("p", { class: "home-note" }, "体循環の粒は、この割合で行き先を選んでいます（脳 約15%・腎臓 約20%・腹部の内臓と肝臓 約25%・筋と皮膚など 約40%）。"),
    h("dl", { class: "motion-facts" }, ...shares.flatMap(([label, share]) => [h("dt", {}, label), h("dd", {}, `${share}%`)])),
    h("h3", { class: "list-title" }, "関係する語"),
    relatedTerms(["left-ventricle", "ascending-aorta", "aortic-arch", "pulmonary-trunk", "pulmonary-veins", "superior-vena-cava", "inferior-vena-cava", "hepatic-portal-vein", "right-atrium", "left-atrium"]),
    h("p", { class: "plate-credit muted" }, "血管の形は BodyParts3D と Z-Anatomy、流れの道すじはその形の中心線から作りました（scripts/motions/paths.py）。拍動は ModularCirc（MIT）のモデルの大動脈・肺動脈の流れに合わせています。"),
  );
  if (!player.playing) ctx.hint("▶ 再生 で動きます");
}

/** 道の毛細血管の初めと終わり（長さ） */
function capillaryRange(route: Route): [number, number] {
  const line = routeLine(route);
  return [line.cumulative[route.capillary[0]] ?? 0, line.cumulative[Math.min(route.capillary[1], line.cumulative.length - 1)] ?? line.length];
}
