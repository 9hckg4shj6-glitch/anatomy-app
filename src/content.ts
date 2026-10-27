import attachmentsJson from "../content/attachments.json";
import jointsJson from "../content/joints.json";
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
  /** 3Dの部品の指定。骨・器官の部位（of がある語）では省略でき、親の parts を使う（scripts/build-models.mjs） */
  parts?: string[];
  /** 骨・器官の部位（大結節・噴門など）なら、その骨・器官の語ID。位置は content/pins.json のピンで示す */
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
  /** ほかの構造をおおったりふさいだりする形（大網・口腔・鼻腔など）。ふだんはごく薄く見せてタップでは選べず、強調したときだけ不透明にする（xray と一緒に使う） */
  veil?: boolean;
  /** 表記などを教科書で確かめてほしい語（docs/要確認用語.md に出る） */
  check?: boolean;
  /** 筋の起始・停止・支配神経・作用。起始・停止の骨の部位は originAt / insertionAt に語IDで（3Dでピンを示す） */
  origin?: string;
  insertion?: string;
  originAt?: string[];
  insertionAt?: string[];
  nerve?: string;
  action?: string;
  /** 基本の用語（方向・面・運動）の3Dの図。部品を持たず、骨格の上に矢印・面を描いたり骨を動かしたりして示す */
  figure?: Figure;
  /** 図から名前を答える問題で選択肢に出してよい語（「近位」の図に「上」を出すと、どちらも正しくなるため） */
  foils?: string[];
  /** 以下は読み込み時に付ける */
  system: string;
  unit: string;
}

export interface Unit {
  id: string;
  title: string;
  system: string;
  /** レッスンの初めに見せる説明（段落ごと） */
  intro?: string[];
  terms: Term[];
}

interface TermFile {
  system: string;
  units: { id: string; title: string; intro?: string[]; terms: Omit<Term, "system" | "unit">[] }[];
}

type Vec3 = [number, number, number];

/** 体の面。axis に垂直で、その座標が at の面（x＝正中矢状面・矢状面、z＝前頭面、y＝水平面） */
export interface FigurePlane {
  axis: "x" | "y" | "z";
  at: number;
}

/**
 * 基本の用語の図（モデル座標 m・Y上・前が +z、本人の右が -x）。
 * arrows は矢印 [始点, 終点]、plane は答えの面、guide は目安に薄く出す面（内側・外側の正中面など）。
 * motion は関節の動き（content/joints.json の関節ID → 角度°）。from の姿勢から to の姿勢へ動かすのをくり返す。
 * view はカメラ: 見る中心 target・カメラを置く向き from・映す半分の高さ size（m）。
 */
export interface Figure {
  arrows?: [Vec3, Vec3][];
  plane?: FigurePlane;
  guide?: FigurePlane;
  motion?: { from?: Record<string, number>; to: Record<string, number> };
  view: { target: Vec3; from: Vec3; size: number };
}

/**
 * 骨を動かす関節（scripts/joints.mjs が骨の形とピンから作る）。moves は動かす骨の語ID、pivot は回す中心、axis は回す軸
 * （右側。正の角度で plus の運動）。slide の関節は回さずに axis の向きへ動かす（値は mm）。
 * 左右のある骨は右側の部品だけを動かし、mid の関節（環軸関節）は全部を動かす。
 * 並びは体の中心から先へ（先の関節から順に回してから根元の関節で回す）。
 */
export interface Joint {
  ja: string;
  moves: string[];
  pivot: Vec3;
  axis: Vec3;
  mid?: boolean;
  slide?: boolean;
  plus: string;
}

/**
 * 骨・器官の部位の位置（モデル座標 m・Y上、本人の右側）。at は点の列（稜・線は数点）、r は示す範囲の半径。
 * n は表面の外向き（その向きの面だけを塗り、カメラもその向きから見る）。
 * v はカメラの向きだけ（外科頚のように骨を一周する部位は、面の向きで塗り分けない）。
 * one は左右に折り返さない（胃・肝臓のように左右の無い器官や、左肺だけの部位。位置は本当の側に置く）。
 */
export interface Pin {
  at: [number, number, number][];
  r: number;
  n?: [number, number, number];
  v?: [number, number, number];
  one?: boolean;
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
    intro: unit.intro,
    terms: unit.terms.map((term) => ({ ...term, system: system.id, unit: unit.id })),
  }));
});

export const terms: Term[] = units.flatMap((unit) => unit.terms);
export const termById = new Map(terms.map((term) => [term.id, term]));
export const unitById = new Map(units.map((unit) => [unit.id, unit]));
export const systemById = new Map(systems.map((system) => [system.id, system]));

/** 骨・器官の部位のピン。ピン打ちツール（#/admin）で書きかえる */
export const pins = pinsJson as unknown as Record<string, Pin>;

export const joints = jointsJson as unknown as Record<string, Joint>;

/** 基本の用語の図から名前を答える問題の文 */
export function figurePrompt(figure: Figure): string {
  if (figure.motion) return "この動きの名前は？";
  if (figure.plane) return "オレンジ色の面の名前は？";
  return "オレンジ色の矢印の向きは？";
}

export function isLandmark(term: Pick<Term, "of"> | undefined): boolean {
  return !!term?.of;
}

/** 骨・器官の部位の一覧（骨・器官ごと） */
export function landmarksOf(parentId: string): Term[] {
  return terms.filter((term) => term.of === parentId);
}

/**
 * 筋の付着面（public/models/attachments-za.json、scripts/za/attachments.mjs が Z-Anatomy から作る）。
 * 起始・停止ごとに、骨の上の球の並び [骨の語ID, x, y, z, 半径, 面の向き nx, ny, nz（無いこともある）]。本人の右側だけ。
 * Z-Anatomy に付着面の無いもの（烏口腕筋の停止など）は content/attachments.json（scripts/pins/rules/attach.mjs の規則で作る）。
 */
export type AttachmentSpot = [string, number, number, number, number, ...number[]];
export type Attachments = Record<string, { origin?: AttachmentSpot[]; insertion?: AttachmentSpot[] }>;

const ownAttachments = attachmentsJson as unknown as Attachments;
let attachments: Promise<Attachments> | null = null;

export function loadAttachments(): Promise<Attachments> {
  // 無くても3Dは動くので、読めなければ content/attachments.json の分だけにする（あとは骨の部位のピンで示す）
  attachments ??= fetch(`${import.meta.env.BASE_URL}models/attachments-za.json`)
    .then((response) => (response.ok ? (response.json() as Promise<Attachments>) : {}))
    .catch((): Attachments => ({}))
    .then((za: Attachments) => {
      const merged: Attachments = { ...za };
      for (const [id, entry] of Object.entries(ownAttachments)) {
        merged[id] = {
          origin: [...(za[id]?.origin ?? []), ...(entry.origin ?? [])],
          insertion: [...(za[id]?.insertion ?? []), ...(entry.insertion ?? [])],
        };
      }
      return merged;
    });
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
