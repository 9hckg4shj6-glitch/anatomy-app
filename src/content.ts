import attachmentsJson from "../content/attachments.json";
import directionsJson from "../content/directions.json";
import jointsJson from "../content/joints.json";
import organsJson from "../content/organs.json";
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
  /**
   * 3Dでの質感（src/viewer.ts の TISSUES）。無ければ系統から決める。眼と口の形を本物に近く見せるため:
   * clear＝透明（角膜・水晶体・硝子体）、sclera＝白くなめらか、iris＝放射状のすじ、retina＝内側を暗く（瞳孔が黒く見える）、
   * tooth＝エナメル、mucosa＝湿った粘膜、tongue＝乳頭のざらつき、gland＝小葉の凹凸、ligament＝白く光る密な線維
   */
  tissue?: Tissue;
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
  /** 孔・管・溝・裂を通るもの（入るもの）。「通るもの」の問い方の答えと選択肢になる */
  passes?: string;
  /** 出すホルモン（内分泌腺と、ホルモンを出す器官）。「ホルモン」の問い方（このホルモンを出すのは？）の問題と答えになる */
  hormones?: string;
  /** 基本の用語（方向・面・運動）の3Dの図。部品を持たず、骨格の上に矢印・面を描いたり骨を動かしたりして示す */
  figure?: Figure;
  /** 図から名前を答える問題で選択肢に出してよい語（「近位」の図に「上」を出すと、どちらも正しくなるため） */
  foils?: string[];
  /** 筋の作用の動き（content/joints.json の関節ID → 角度°）。「動きを見る」で骨を動かし、起始と停止を結ぶ帯が縮むのを示す */
  motion?: Motion;
  /** 局所解剖の語（大腿三角・膝窩・区画など）。部品を持たず、境界と中を通る語を組み合わせて示す */
  region?: Region;
  /** 語に寄るときにカメラを置く向き（モデル座標。無ければ今の向きのまま）。胸椎のように前からは胸骨・肋骨の陰になる語に書く */
  from?: [number, number, number];
  /** 骨の置き方（解剖学的正位の上下・前後・内外の決め方。左右のある骨では、これで右か左かが決まる）。『解剖学講義』による */
  placing?: string;
  /** 平面図の語（皮膚の層・汗腺など3Dに形の無い語）。臓器の図の平面図（この図ID）の名前で場所を示し、レッスン・問題では3Dの上に図を重ねる */
  plate?: string;
  /** 以下は読み込み時に付ける */
  /** 向きの問い方（content/directions.json）。この語が than の語のどちら側にあるか */
  toward?: Toward;
  system: string;
  unit: string;
}

/** 方向の用語の語ID（基本の用語の上・下・前・後・内側・外側・右・左） */
export type Direction = "superior" | "inferior" | "anterior" | "posterior" | "medial" | "lateral" | "right" | "left";

/**
 * 向きの問い方の答え（content/directions.json の1件）。語 term は、than の語の dir の側にある（解剖学的正位で）。why はそのわけ。
 * 臓器・血管・神経・筋の組は、比べた2つの位置 at（[この語, than の語]。scripts/directions.mjs が box の中の形から求める）を持つ
 */
export interface Toward {
  than: string;
  dir: Direction;
  why: string;
  at?: [Vec3, Vec3];
}

/** 向きの問い方の選択肢の並び（対ごと）。骨の部位どうしは6つ、臓器・血管などは右・左を足した8つ（toward.at があるもの） */
export const DIRECTIONS: Direction[] = ["superior", "inferior", "anterior", "posterior", "medial", "lateral"];
export const BODY_DIRECTIONS: Direction[] = [...DIRECTIONS, "right", "left"];

export type Tissue = "clear" | "sclera" | "iris" | "retina" | "tooth" | "mucosa" | "tongue" | "gland" | "ligament";

export interface Unit {
  id: string;
  title: string;
  /** 系統の中のまとまり（骨格系は骨学試験の区分と同じ 体幹・上肢・下肢・頭蓋）。ホームと図鑑で入れ子のフォルダーにする */
  group?: string;
  system: string;
  /** レッスンの初めに見せる説明（段落ごと） */
  intro?: string[];
  terms: Term[];
}

interface TermFile {
  system: string;
  units: { id: string; title: string; group?: string; intro?: string[]; terms: Omit<Term, "system" | "unit">[] }[];
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
  motion?: Motion;
  view: View;
}

/**
 * 関節の動き（content/joints.json の関節ID → 角度°）。from の姿勢（無ければ解剖学的正位）から to の姿勢へ動かす。
 * via は筋の動きの帯が通る骨の部位（ピン）。くるぶしの後ろを回る腱のように、滑車で向きを変える筋で使う。
 * view: "back" は筋の動きを後ろから見る（肩甲骨を動かす背中の筋。前からでは胸郭の陰になる）
 */
export interface Motion {
  from?: Record<string, number>;
  to: Record<string, number>;
  via?: string[];
  view?: "back";
}

/** カメラ: 見る中心 target・カメラを置く向き from・映す半分の高さ size（m） */
export interface View {
  target: Vec3;
  from: Vec3;
  size: number;
}

/**
 * 局所解剖の語（モデル座標 m、右側）。bounds は境界の語（オレンジ）、contents は中を通る・中にある語（もとの色）。
 * outline は囲みの線（open なら閉じない＝足弓のアーチ）。右側で示し、見せるときは左側の形を隠す。
 * boundsLabel / contentsLabel は説明の見出し（無ければ「境界」「通るもの」）、prompt は位置→名前の問題文。
 * section は見せるときに体を切る面（区画は水平断で、CT と同じく下から見る。keep: 1 で座標の大きい側を残す）。
 */
export interface Region {
  bounds: string[];
  contents: string[];
  outline?: Vec3[];
  open?: boolean;
  section?: { axis: "x" | "y" | "z"; at: number; keep: 1 | -1 };
  view: View;
  boundsLabel?: string;
  contentsLabel?: string;
  prompt?: string;
}

/**
 * 骨を動かす関節（scripts/joints.mjs が骨の形とピンから作る）。moves は動かす骨の語ID、pivot は回す中心、axis は回す軸
 * （右側。正の角度で plus の運動）。slide の関節は回さずに axis の向きへ動かす（値は mm）。
 * 左右のある骨は右側の部品だけを動かし、mid の関節（環軸関節）は全部を動かす。
 * 並びは体の中心から先へ（先の関節から順に回してから根元の関節で回す）。
 * only は動かす部品を絞る（足の指の骨のうち母趾だけ、など。部品ID）。
 */
export interface Joint {
  ja: string;
  moves: string[];
  pivot: Vec3;
  axis: Vec3;
  mid?: boolean;
  slide?: boolean;
  only?: string[];
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
  /** 寄るときにカメラを置く向き（無ければ n・v。面の向きから寄ると反対側の骨にさえぎられる下顎骨の内面など） */
  cam?: [number, number, number];
  one?: boolean;
  /**
   * 骨の端や突起（骨頭・顆・上顆・果など）を、骨の形にそって示す区域（scripts/pins/regions.mjs が作る）。
   * 球（c・r）の中で、すべての面 cut の表側（nx·x + ny·y + nz·z + w ≥ 0）にある表面。face があればその向きの面だけ。
   * 塗る所とタップの判定は区域で、図の番号・選択肢の近さ・入れ子の判定は at・r のまま
   */
  region?: { c: [number, number, number]; r: number; cut: [number, number, number, number][]; face?: [number, number, number] };
}

/**
 * 臓器を詳しく見る画面（#/organs/<ID>。content/organs.json）。units のレッスンの語と with の語（大血管など）が臓器の場面で、
 * 3Dではそれだけを box の中に切って見せる（SceneSpec の organ）。around は場面に添えるだけの語（食道・結腸のように箱の外へ長く続き、
 * 図鑑でその語を選んでもこの臓器だけの見せ方にはしない）。colors は部屋・葉の色分け（colorLabel はその切りかえの名前、colorNote は凡例の下の説明）、views は向き、cuts は切って中を見る面
 * （normal・point で、normal の向きの側を残す。hide は切るときに隠す語）。seamless は平面図で境に線を引かない語（心房・心室の壁）。
 * plates は平面図（scripts/plates.mjs が art の元の図から作るか、view・cut から描く。diagram があれば手で描いた模式図）
 */
export interface Organ {
  id: string;
  ja: string;
  yomi: string;
  en: string;
  about: string;
  units: string[];
  with: string[];
  around?: string[];
  /** 3Dで見せる箱。無い臓器（皮膚）は平面図だけ */
  box?: [Vec3, Vec3];
  seamless?: string[];
  colors: Record<string, string>;
  colorLabel?: string;
  colorNote?: string;
  views: { label: string; from: Vec3 }[];
  cuts: OrganCut[];
  plates: PlateSpec[];
}

export interface OrganCut {
  label: string;
  normal: Vec3;
  point: Vec3;
  from: Vec3;
  hide?: string[];
}

/**
 * 平面図の指定（content/organs.json）。ラベルは語ID か { term, pin } か、語の無い所の { ja, en, uv }。
 * art は元の図（イラスト）の出典で、ラベルは元の図のピクセル { term, px }。note は図の向きなどの添え書き、points はこの図で押さえる要点
 */
export interface PlateSpec {
  id: string;
  title: string;
  en: string;
  diagram?: string;
  art?: PlateArt;
  note?: string;
  points?: string[];
  labels: (string | { term?: string; ja?: string; en?: string })[];
}

/** 元の図の出典（画面に、作者・ライセンス・変えた所を出す） */
export interface PlateArt {
  page: string;
  author: string;
  license: string;
  licenseUrl: string;
  changes: string;
}

/** scripts/plates.mjs が書き出す public/plates/index.json。ラベルの at は画像の幅・高さに対する 0〜1 */
export interface PlateIndex {
  plates: Record<string, { url: string; w: number; h: number; labels: PlateLabel[] }>;
}

export interface PlateLabel {
  at: [number, number];
  term?: string;
  ja?: string;
  en?: string;
  note?: string;
}

/** scripts/build-models.mjs が書き出す public/models/index.json */
export interface ModelIndex {
  version: number;
  /** za は Z-Anatomy 由来の形（CC BY-SA 4.0）だけを入れた別の GLB。同じ系統として一緒に読む */
  systems: Record<string, { url: string; bytes: number; elements: number; za?: { url: string; bytes: number; elements: number } }>;
  terms: Record<string, { system: string; elements: string[]; center: [number, number, number]; radius: number }>;
  neighbors: Record<string, string[]>;
  /** 付着面・付着のピンが乗っている、まとめた骨の語（肋骨など）の中の1本ずつの骨（"筋の語ID@origin" → 骨の語ID）。scripts/attach-bones.mjs */
  attachedBones?: Record<string, string[]>;
  bounds: [[number, number, number], [number, number, number]];
}

export const systems: SystemInfo[] = systemsJson;

const files = import.meta.glob<TermFile>("../content/terms/*.json", { eager: true, import: "default" });

export const units: Unit[] = systems.flatMap((system) => {
  const file = Object.values(files).find((data) => data.system === system.id);
  return (file?.units ?? []).map((unit) => ({
    id: unit.id,
    title: unit.title,
    group: unit.group,
    system: system.id,
    intro: unit.intro,
    terms: unit.terms.map((term) => ({ ...term, system: system.id, unit: unit.id })),
  }));
});

export const terms: Term[] = units.flatMap((unit) => unit.terms);
for (const { term, than, dir, why, at } of (directionsJson as { facts: (Toward & { term: string })[] }).facts) {
  const found = terms.find((other) => other.id === term);
  if (found) found.toward = { than, dir, why, ...(at ? { at } : {}) };
}
export const termById = new Map(terms.map((term) => [term.id, term]));
export const unitById = new Map(units.map((unit) => [unit.id, unit]));
export const systemById = new Map(systems.map((system) => [system.id, system]));

/** 骨・器官の部位のピン。ピン打ちツール（#/admin）で書きかえる */
export const pins = pinsJson as unknown as Record<string, Pin>;

export const joints = jointsJson as unknown as Record<string, Joint>;

export const organs = (organsJson as unknown as { organs: Organ[] }).organs;
export const organById = new Map(organs.map((organ) => [organ.id, organ]));

/** 臓器の語（レッスンの語・器官の部位と、添える大血管など） */
function ownTerms(organ: Organ): string[] {
  return [...organ.units.flatMap((id) => unitById.get(id)?.terms.map((term) => term.id) ?? []), ...organ.with];
}

/** 臓器の場面の語（臓器の語と、場面に添えるだけの語） */
export function organTerms(organ: Organ): string[] {
  return [...ownTerms(organ), ...(organ.around ?? [])];
}

/** 語が入る臓器の場面（無ければ undefined。添えるだけの語は入れない。3Dの無い臓器＝皮膚は場面にならない） */
export function organOf(termId: string): Organ | undefined {
  return organs.find((organ) => organ.box && ownTerms(organ).includes(termId));
}

/** レッスンが臓器の場面のものなら、その臓器 */
export function organOfUnit(unitId: string | undefined): Organ | undefined {
  return unitId ? organs.find((organ) => organ.box && organ.units.includes(unitId)) : undefined;
}

/** 平面図の語（term.plate）の図と、その図のある臓器 */
export function plateOfTerm(term: Pick<Term, "plate">): { organ: Organ; plate: PlateSpec } | undefined {
  for (const organ of organs) for (const plate of organ.plates) if (plate.id === term.plate) return { organ, plate };
  return undefined;
}

/** 基本の用語の図から名前を答える問題の文 */
export function figurePrompt(figure: Figure): string {
  if (figure.motion) return "この動きの名前は？";
  if (figure.plane) return "オレンジ色の面の名前は？";
  return "オレンジ色の矢印の向きは？";
}

/** 局所解剖の語の、位置→名前の問題の文 */
export function regionPrompt(region: Region): string {
  return region.prompt ?? "オレンジ色が囲む場所の名前は？";
}

/** 局所解剖の語を示すのに要る系統（境界と中を通る語の系統。骨・骨の部位は添える骨格で示す） */
export function regionSystems(region: Region): string[] {
  return [...new Set([...region.bounds, ...region.contents].map((id) => termById.get(id)?.system ?? "").filter((id) => id && id !== "skeletal"))];
}

/** 部品を持たない語（基本の用語の図・局所解剖・平面図の語）。タップでは答えられない */
export function isDrawn(term: Pick<Term, "figure" | "region" | "plate"> | undefined): boolean {
  return !!(term?.figure || term?.region || term?.plate);
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

let plateIndex: Promise<PlateIndex> | null = null;

export function loadPlateIndex(): Promise<PlateIndex> {
  plateIndex ??= fetch(`${import.meta.env.BASE_URL}plates/index.json`).then((response) => {
    if (!response.ok) throw new Error(`plates/index.json: ${response.status}`);
    return response.json() as Promise<PlateIndex>;
  });
  return plateIndex;
}

/** 語が出てくる平面図（臓器の図の画面で開く）。図のIDと臓器 */
export async function platesOf(termId: string): Promise<{ organ: Organ; plate: PlateSpec }[]> {
  const index = await loadPlateIndex().catch(() => null);
  return organs.flatMap((organ) => organ.plates
    .filter((plate) => (index?.plates[plate.id]?.labels ?? []).some((label) => label.term === termId) || plate.labels.some((label) => (typeof label === "string" ? label : label.term) === termId))
    .map((plate) => ({ organ, plate })));
}
