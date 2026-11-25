import { organs, plateOfTerm, termById, type OrganCore, type PlateIndex, type PlateRef } from "./content";
import { fold, lookup } from "./search";

/**
 * 臓器の図の平面図を探す・並べる（docs/普段使い.md「平面図の探しやすさの見直し」）。
 * 臓器の図の一覧（すべての図・図を探す）、臓器の画面の図の帯、図鑑・立体・平面図の「この語が載っている図」、調べるの結果で同じものを使う。
 * はじめの JS に入る所（臓器の名前と平面図の ID・題・ラベル）だけを使う
 */

/**
 * 臓器の図の一覧の見出し（系統のまとまり）と、その臓器。どの臓器も1つのまとまりに入る（tests/clarity.test.ts が確かめる）。
 * color は見出しの印（content/systems.json の系統の色）
 */
export const ORGAN_GROUPS: { title: string; color: string; organs: string[] }[] = [
  { title: "心臓と血管・リンパ", color: "#c8323c", organs: ["heart", "vessels", "lymph"] },
  { title: "呼吸器と胸の中", color: "#6fa8dc", organs: ["nose", "pharynx", "larynx", "lung", "lung-segments", "pleura", "mediastinum"] },
  { title: "消化器と腹膜", color: "#d9965b", organs: ["mouth", "stomach", "liver", "intestine", "peritoneum", "diaphragms"] },
  { title: "泌尿器と生殖器", color: "#d4a514", organs: ["kidney", "renal", "male", "female"] },
  { title: "神経と感覚器", color: "#e9c46a", organs: ["brain", "brain-base", "spinal-cord", "brachial-plexus", "plexuses", "eye", "ear"] },
  { title: "関節", color: "#b7c7cc", organs: ["shoulder", "elbow", "hip", "knee"] },
  { title: "局所の通り道", color: "#8f9aa6", organs: ["passages"] },
  { title: "皮膚・組織・発生", color: "#c48bb4", organs: ["skin", "tissues", "development"] },
];

/** 臓器の一覧の絵（scripts/organ-thumbs.mjs が最初の平面図から作る）。平面図の無い臓器は無し */
export function organThumb(organ: OrganCore): string | null {
  return organ.plates.length ? `${import.meta.env.BASE_URL}organs/${organ.id}.webp` : null;
}

/** 一覧の順（ORGAN_GROUPS の順。まとまりに入っていない臓器は後ろ） */
const ORDER = new Map(ORGAN_GROUPS.flatMap((group) => group.organs).map((id, i) => [id, i]));
export const orderedOrgans: OrganCore[] = [...organs].sort((a, b) => (ORDER.get(a.id) ?? 999) - (ORDER.get(b.id) ?? 999));

export interface Figure {
  organ: OrganCore;
  plate: PlateRef;
}

/** 平面図の ID → その図と臓器 */
const FIGURES = new Map<string, Figure>(orderedOrgans.flatMap((organ) => organ.plates.map((plate) => [plate.id, { organ, plate }] as const)));
export const figureById = (plateId: string): Figure | undefined => FIGURES.get(plateId);

/** すべての平面図（一覧の順） */
export const allFigures: Figure[] = [...FIGURES.values()];

/** 図のラベルの語 ID */
export function plateTermIds(plate: PlateRef): string[] {
  return plate.labels.flatMap((label) => {
    const id = typeof label === "string" ? label : label.term;
    return id ? [id] : [];
  });
}

/** 語 ID → その語が載っている平面図 */
let byTerm: Map<string, Figure[]> | null = null;
function figuresOfTerm(termId: string): Figure[] {
  if (!byTerm) {
    byTerm = new Map();
    for (const figure of allFigures) for (const id of new Set(plateTermIds(figure.plate))) {
      const list = byTerm.get(id) ?? [];
      list.push(figure);
      byTerm.set(id, list);
    }
  }
  return byTerm.get(termId) ?? [];
}

/**
 * 語が載っている平面図。その語の平面図（平面図の語・小さくて図で示す語）→ prefer の臓器の図 → ほかの臓器の図（一覧の順）
 */
export function figuresWith(termId: string, prefer?: string): Figure[] {
  const term = termById.get(termId);
  const own = term ? plateOfTerm(term)?.plate.id : undefined;
  const rank = (figure: Figure) => (figure.plate.id === own ? 0 : figure.organ.id === prefer ? 1 : 2);
  // sort は安定なので、同じ組の中は一覧の順のまま
  return [...figuresOfTerm(termId)].sort((a, b) => rank(a) - rank(b));
}

/** 平面図の画面のアドレス。term を付けると、開いたときにその語の名前を選んでおく */
export function figureHref(figure: Figure, termId?: string): string {
  return `#/organs/${figure.organ.id}/${figure.plate.id}${termId ? `/${termId}` : ""}`;
}

/** 平面図の小さな絵（scripts/organ-thumbs.mjs が plates/thumbs/ に、平面図と同じファイル名で作る）。模式図（plates/index.json に無い図）は null */
export function figureThumb(index: PlateIndex | null, plateId: string): string | null {
  const url = index?.plates[plateId]?.url;
  return url ? `${import.meta.env.BASE_URL}${url.replace(/^plates\//, "plates/thumbs/")}` : null;
}

/** 1つの表記への当たり方（search.ts の語と同じ: 同じ 100・頭から 80・途中 40） */
function scoreText(value: string, query: string): number {
  if (!value || !query) return 0;
  if (value === query) return 100;
  if (value.startsWith(query)) return 80;
  return value.includes(query) ? 40 : 0;
}

export interface FigureHit extends Figure {
  score: number;
  /** 図に載っている語で当たったとき、その語 ID（開くとその名前を選んでおく） */
  term?: string;
  /** 当たった名前（語の日本語名か、語の無いラベルの名前） */
  label?: string;
  /** 臓器の名前だけで当たった */
  byOrgan?: boolean;
}

let foldedTitles: Map<string, string> | null = null;
const foldedTitle = (plate: PlateRef) => {
  foldedTitles ??= new Map(allFigures.map((figure) => [figure.plate.id, fold(figure.plate.title)]));
  return foldedTitles.get(plate.id) ?? fold(plate.title);
};

/** 臓器の名前（日本語・読み・英語）への当たり方 */
function organScore(organ: OrganCore, query: string): number {
  return Math.max(scoreText(fold(organ.ja), query), scoreText(fold(organ.yomi), query), scoreText(fold(organ.en), query) - 1);
}

/**
 * 平面図を探す。図の題（いちばん上）→ labels のときは図に載っている語の名前（日本語・読み・英語・ラテン語。調べると同じ当て方）→ 臓器の名前。
 * 同じ当たり方なら一覧の順
 */
export function findFigures(query: string, options: { labels?: boolean } = {}): FigureHit[] {
  const q = fold(query);
  if (!q) return [];
  const termScores = new Map<string, number>();
  if (options.labels) for (const hit of lookup(query, { all: true })) termScores.set(hit.term.id, hit.score);
  const hits: FigureHit[] = [];
  for (const figure of allFigures) {
    const title = scoreText(foldedTitle(figure.plate), q);
    let best: FigureHit = { ...figure, score: title };
    if (options.labels) {
      for (const label of figure.plate.labels) {
        const id = typeof label === "string" ? label : label.term;
        // 語のラベルは語の当たり方、語の無いラベル（文字だけ）は名前の当たり方。題で当たるより少し下に
        const score = id ? termScores.get(id) ?? 0 : typeof label !== "string" && label.ja ? scoreText(fold(label.ja), q) : 0;
        // 題で当たった図は題のまま（「膵管と十二指腸乳頭」に「膵管が載っている」と添えない）。題で当たらない図だけ、当たった語を添える
        if (score * 0.9 > best.score && !title) best = { ...figure, score: score * 0.9, term: id, label: id ? termById.get(id)?.ja : (label as { ja?: string }).ja };
      }
    }
    // 臓器の名前で当たったときは、題や語で当たった図より下に
    const organ = organScore(figure.organ, q);
    if (organ && best.score < 30) best = { ...figure, score: organ >= 80 ? 30 : 20, byOrgan: true };
    if (best.score > 0) hits.push(best);
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** 名前（日本語・読み・英語）に当たる臓器の図（当たり方のよい順） */
export function findOrgans(query: string): OrganCore[] {
  const q = fold(query);
  if (!q) return [];
  return orderedOrgans
    .map((organ) => ({ organ, score: organScore(organ, q) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.organ);
}

/** 臓器の also（ほかの臓器の図で、この臓器にも関わる図）を図に */
export function alsoFigures(also: string[] | undefined): Figure[] {
  return (also ?? []).flatMap((id) => FIGURES.get(id) ?? []);
}

