import pinsJson from "../content/pins.json";
import systemsJson from "../content/systems.json";

export interface SystemInfo {
  id: string;
  ja: string;
  color: string;
}

export interface Term {
  id: string;
  ja: string;
  yomi: string;
  en: string;
  enAlt?: string[];
  la?: string;
  /** 3Dの部品の指定。骨の部位（of がある語）では省略でき、親の骨の parts を使う（scripts/build-models.mjs） */
  parts?: string[];
  /** 骨の部位（大結節など）なら、その骨の語ID。位置は content/pins.json のピンで示す */
  of?: string;
  fma?: string;
  level: 1 | 2 | 3;
  kanji?: string;
  etym?: string;
  note: string;
  /** 3Dでの色（静脈の青など）。無ければ系統の色 */
  color?: string;
  /** ほかの構造に隠れる部位。強調するとき周りを半透明にし、タップで答える問題は出さない */
  xray?: boolean;
  /** 表記などを教科書で確かめてほしい語（docs/要確認用語.md に出る） */
  check?: boolean;
  /** 筋の起始・停止・支配神経・作用。起始・停止の骨の部位は originAt / insertionAt に語IDで（3Dでピンを示す） */
  origin?: string;
  insertion?: string;
  originAt?: string[];
  insertionAt?: string[];
  nerve?: string;
  action?: string;
  /** 以下は読み込み時に付ける */
  system: string;
  unit: string;
}

export interface Unit {
  id: string;
  title: string;
  system: string;
  terms: Term[];
}

interface TermFile {
  system: string;
  units: { id: string; title: string; terms: Omit<Term, "system" | "unit">[] }[];
}

/**
 * 骨の部位の位置（モデル座標 m・Y上、本人の右側）。at は点の列（稜・線は数点）、r は示す範囲の半径。
 * n は表面の外向き（その向きの面だけを塗り、カメラもその向きから見る）。
 * v はカメラの向きだけ（外科頚のように骨を一周する部位は、面の向きで塗り分けない）。
 */
export interface Pin {
  at: [number, number, number][];
  r: number;
  n?: [number, number, number];
  v?: [number, number, number];
}

/** scripts/build-models.mjs が書き出す public/models/index.json */
export interface ModelIndex {
  version: number;
  /** za は Z-Anatomy 由来の形（CC BY-SA 4.0）だけを入れた別の GLB。同じ系統として一緒に読む */
  systems: Record<string, { url: string; bytes: number; elements: number; za?: { url: string; bytes: number; elements: number } }>;
  terms: Record<string, { system: string; elements: string[]; center: [number, number, number]; radius: number }>;
  neighbors: Record<string, string[]>;
  bounds: [[number, number, number], [number, number, number]];
}

export const systems: SystemInfo[] = systemsJson;

const files = import.meta.glob<TermFile>("../content/terms/*.json", { eager: true, import: "default" });

export const units: Unit[] = systems.flatMap((system) => {
  const file = Object.values(files).find((data) => data.system === system.id);
  return (file?.units ?? []).map((unit) => ({
    id: unit.id,
    title: unit.title,
    system: system.id,
    terms: unit.terms.map((term) => ({ ...term, system: system.id, unit: unit.id })),
  }));
});

export const terms: Term[] = units.flatMap((unit) => unit.terms);
export const termById = new Map(terms.map((term) => [term.id, term]));
export const unitById = new Map(units.map((unit) => [unit.id, unit]));
export const systemById = new Map(systems.map((system) => [system.id, system]));

/** 骨の部位のピン。ピン打ちツール（#/admin）で書きかえる */
export const pins = pinsJson as unknown as Record<string, Pin>;

export function isLandmark(term: Pick<Term, "of"> | undefined): boolean {
  return !!term?.of;
}

/** 骨の部位の一覧（骨ごと） */
export function landmarksOf(boneId: string): Term[] {
  return terms.filter((term) => term.of === boneId);
}

/**
 * 筋の付着面（public/models/attachments-za.json、scripts/za/attachments.mjs が Z-Anatomy から作る）。
 * 起始・停止ごとに、骨の上の球の並び [骨の語ID, x, y, z, 半径, 面の向き nx, ny, nz（無いこともある）]。本人の右側だけ。
 */
export type AttachmentSpot = [string, number, number, number, number, ...number[]];
export type Attachments = Record<string, { origin?: AttachmentSpot[]; insertion?: AttachmentSpot[] }>;

let attachments: Promise<Attachments> | null = null;

export function loadAttachments(): Promise<Attachments> {
  // 無くても3Dは動くので、読めなければ空にする（起始・停止は骨の部位のピンだけで示す）
  attachments ??= fetch(`${import.meta.env.BASE_URL}models/attachments-za.json`)
    .then((response) => (response.ok ? (response.json() as Promise<Attachments>) : {}))
    .catch(() => ({}));
  return attachments;
}

let modelIndex: Promise<ModelIndex> | null = null;

export function loadModelIndex(): Promise<ModelIndex> {
  modelIndex ??= fetch(`${import.meta.env.BASE_URL}models/index.json`).then((response) => {
    if (!response.ok) throw new Error(`models/index.json: ${response.status}`);
    return response.json() as Promise<ModelIndex>;
  });
  return modelIndex;
}
