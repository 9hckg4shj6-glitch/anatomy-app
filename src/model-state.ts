import type { Vec3 } from "./landmarks";
import type { ModelSpec, Section } from "./viewer";

/**
 * 3D模型（#/model。src/ui/model.ts）の状態。docs/普段使い.md「3D模型」。
 * 3Dに頼らない部分（部品のまとまり・組み合わせの見本・元に戻す）をここに置き、テストする（tests/model.test.ts）
 */

/** 部品のまとまり（語と、その語の部品のうち押した側のもの）。key は語ID と側（右 -1・左 1・両側 0） */
export interface Part {
  key: string;
  term: string | null;
  elements: string[];
}

export type ModelSide = ModelSpec["side"];

export interface ModelState {
  /** 系統ID（皮膚は "body"）ごとの濃さ 0〜1 */
  opacity: Record<string, number>;
  /** 濃さを 0 にする前の濃さ（系統の名前を押して出し入れするとき、元の濃さに戻す） */
  lastOpacity: Record<string, number>;
  hidden: Part[];
  faded: Part[];
  solo: boolean;
  side: ModelSide;
  explode: number;
  offsets: Record<string, Vec3>;
  section: Section | null;
}

/** 皮膚の系統ID（content/systems.json には無く、3Dの index.json にだけある） */
export const SKIN = "body";

/** 組み合わせの見本。押すと系統の濃さをこの組み合わせにする（隠した部品・動かした部品はそのまま） */
export const PRESETS: { id: string; label: string; opacity: Record<string, number> }[] = [
  { id: "organs", label: "骨と内臓", opacity: { skeletal: 1, respiratory: 1, digestive: 1, urogenital: 1, endocrine: 1, cardiovascular: 1, body: 0.25 } },
  { id: "muscles", label: "筋と骨", opacity: { skeletal: 1, muscular: 1, body: 0 } },
  { id: "bones", label: "骨格", opacity: { skeletal: 1, joints: 1 } },
  { id: "vessels", label: "血管と神経", opacity: { skeletal: 0.35, cardiovascular: 1, nervous: 1, body: 0.15 } },
  { id: "all", label: "全部（人体模型）", opacity: { skeletal: 1, joints: 1, muscular: 1, cardiovascular: 1, lymphatic: 1, respiratory: 1, digestive: 1, urogenital: 1, endocrine: 1, nervous: 1, sensory: 1, body: 0.2 } },
];

/** はじめて開いたときの模型（骨と内臓。皮膚をうっすら） */
export function initialState(): ModelState {
  return {
    opacity: { ...PRESETS[0].opacity }, lastOpacity: {}, hidden: [], faded: [], solo: false, side: "both", explode: 0, offsets: {}, section: null,
  };
}

/** 元に戻すための写し */
export function cloneState(state: ModelState): ModelState {
  return structuredClone(state);
}

/**
 * 押した部品から、その語のまとまり（level 0 が一番細かい語。大きくするほど大きなまとまり）の部品を集める。
 * 左右のある語は押した側だけ（右の腎臓だけを外す、など）。正中の部品はどちらの側でも入れる。
 * terms は部品を含む語（細かい順）、elementsOf は語の部品、sideOf は部品の側（-1 右・1 左・0 正中。読み込んでいなければ null）
 */
export function partAt(
  element: string, level: number, terms: string[],
  elementsOf: (term: string) => string[], sideOf: (element: string) => -1 | 0 | 1 | null,
): Part {
  if (!terms.length) return { key: `@${element}`, term: null, elements: [element] };
  const term = terms[Math.min(Math.max(level, 0), terms.length - 1)];
  const side = sideOf(element) ?? 0;
  const all = elementsOf(term);
  const elements = all.filter((id) => {
    const at = sideOf(id);
    return at === null ? false : side === 0 || at === 0 || at === side;
  });
  // 押した側の部品が無い（押した部品が正中など）ときは、その語の部品をすべて
  const picked = elements.length ? elements : [...all];
  if (!picked.includes(element)) picked.push(element);
  const sides = new Set(all.map(sideOf).filter((at) => at !== null && at !== 0));
  return { key: `${term}${sides.size > 1 && side !== 0 ? (side < 0 ? "@R" : "@L") : ""}`, term, elements: picked };
}

/** 部品のまとまりの名前（左右のあるものは「右の」「左の」を付ける） */
export function partName(part: Part, name: (term: string) => string): string {
  const base = part.term ? name(part.term) : "名前の無い部品";
  if (part.key.endsWith("@R")) return `右の${base}`;
  if (part.key.endsWith("@L")) return `左の${base}`;
  return base;
}

/** 隠す・薄くするの一覧に入れる（同じまとまりは入れかえる。隠すと薄くするは片方だけ） */
export function withPart(state: ModelState, part: Part, kind: "hidden" | "faded"): ModelState {
  const next = cloneState(state);
  next.hidden = next.hidden.filter((item) => item.key !== part.key);
  next.faded = next.faded.filter((item) => item.key !== part.key);
  next[kind].push(part);
  return next;
}

/** 隠した・薄くしたまとまりを戻す（key が無ければ全部） */
export function withoutPart(state: ModelState, key?: string): ModelState {
  const next = cloneState(state);
  next.hidden = key ? next.hidden.filter((item) => item.key !== key) : [];
  next.faded = key ? next.faded.filter((item) => item.key !== key) : [];
  return next;
}

/** 部品を動かす（体の座標 m）。動かした量は足していく */
export function withOffset(state: ModelState, elements: string[], delta: Vec3): ModelState {
  const next = cloneState(state);
  for (const id of elements) {
    const [x, y, z] = next.offsets[id] ?? [0, 0, 0];
    next.offsets[id] = [x + delta[0], y + delta[1], z + delta[2]];
  }
  return next;
}

/** 部品を元の位置へ（elements が無ければ全部） */
export function withoutOffset(state: ModelState, elements?: string[]): ModelState {
  const next = cloneState(state);
  if (!elements) next.offsets = {};
  else for (const id of elements) delete next.offsets[id];
  return next;
}

/** 系統を出し入れする（出すときは前の濃さ、無ければ 1） */
export function toggleSystem(state: ModelState, system: string): ModelState {
  const next = cloneState(state);
  const now = next.opacity[system] ?? 0;
  if (now > 0) {
    next.lastOpacity[system] = now;
    next.opacity[system] = 0;
  } else {
    next.opacity[system] = next.lastOpacity[system] || (system === SKIN ? 0.25 : 1);
  }
  return next;
}

/** 組み合わせの見本にする（見本に無い系統は出さない） */
export function withPreset(state: ModelState, presetId: string): ModelState {
  const preset = PRESETS.find((item) => item.id === presetId);
  if (!preset) return state;
  const next = cloneState(state);
  for (const [id, value] of Object.entries(next.opacity)) if (value > 0) next.lastOpacity[id] = value;
  next.opacity = { ...preset.opacity };
  return next;
}

/** 今の組み合わせがどの見本か（無ければ null） */
export function presetOf(state: ModelState): string | null {
  const shown = (opacity: Record<string, number>) => Object.entries(opacity).filter(([, value]) => value > 0).sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => `${id}:${value}`).join(",");
  return PRESETS.find((preset) => shown(preset.opacity) === shown(state.opacity))?.id ?? null;
}

/** 動かした部品の数・隠した数など、元に戻せる変更があるか */
export function isChanged(state: ModelState): boolean {
  return !!(state.hidden.length || state.faded.length || Object.keys(state.offsets).length || state.explode || state.section || state.side !== "both" || state.solo);
}

/** 3Dに渡す見せ方 */
export function toSpec(state: ModelState, selected: Part | null): ModelSpec {
  return {
    opacity: { ...state.opacity },
    hidden: state.hidden.flatMap((part) => part.elements),
    faded: state.faded.flatMap((part) => part.elements),
    selected: selected?.elements ?? [],
    solo: state.solo,
    side: state.side,
    explode: state.explode,
    offsets: structuredClone(state.offsets),
  };
}

/** 元に戻す（やり直しの写しを新しい順に残す。多すぎたら古いものから捨てる） */
export class History {
  private readonly stack: ModelState[] = [];
  constructor(private readonly limit = 60) {}
  push(state: ModelState): void {
    this.stack.push(cloneState(state));
    if (this.stack.length > this.limit) this.stack.shift();
  }
  pop(): ModelState | undefined {
    return this.stack.pop();
  }
  get size(): number {
    return this.stack.length;
  }
  clear(): void {
    this.stack.length = 0;
  }
}

/**
 * 3D模型の2つの使い方（docs/普段使い.md「3D模型の2つの使い方」）。look＝見る（部位をタップすると図鑑の説明。はじめての人向け）、
 * free＝自由に操作（部品を隠す・取り外す・透かす・切る。上級者向け）
 */
export type ModelMode = "look" | "free";

/** アドレス（#/model/look・#/model/free）で選んでいればそれ、無ければ前に選んだもの、それも無ければ見る */
export function modelModeOf(arg: string, saved: unknown): ModelMode {
  if (arg === "look" || arg === "free") return arg;
  return saved === "free" ? "free" : "look";
}
