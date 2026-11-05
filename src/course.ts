import beginnerJson from "../content/beginner.json";
import { organOf, termById, terms, units, unitById, type Organ, type Term, type Unit } from "./content";
import type { Facet } from "./db";
import { preferences } from "./settings";
import { BASIC_FACETS } from "./study";

/**
 * 初心者モードと詳細モード（設定の mode）。
 * 初心者モードは、初学者が最低限覚える語だけを並べ直した初心者コース（content/beginner.json）で学ぶ。
 * レッスン・復習・演習・図鑑の一覧・ホームの数はコースの語だけ、語の説明は短い「覚えること」（point）、
 * 問い方は基本の4つだけ（筋の起始・停止などと通るものは詳細モードで）。学んだ記録は語ID なので、モードを替えても続く
 */
interface BeginnerFile {
  units: { id: string; title: string; system: string; intro?: string[]; terms: { id: string; point: string }[] }[];
}

const beginner = beginnerJson as BeginnerFile;

/** 初心者コースのレッスン（語は詳細モードと同じ語。term.unit は詳細モードのレッスンのまま） */
export const beginnerUnits: Unit[] = beginner.units.map((unit) => ({
  id: unit.id,
  title: unit.title,
  system: unit.system,
  intro: unit.intro,
  terms: unit.terms.flatMap((item) => termById.get(item.id) ?? []),
}));

/** 初心者コースの語の「覚えること」（初学者が最低限覚える1〜2文） */
export const beginnerPoints = new Map(beginner.units.flatMap((unit) => unit.terms.map((item) => [item.id, item.point] as const)));

const beginnerTerms: Term[] = beginnerUnits.flatMap((unit) => unit.terms);
const beginnerIds = new Set(beginnerTerms.map((term) => term.id));

/** 初心者コースの語の数（ホームのモードの切りかえに出す） */
export const beginnerTermCount = beginnerTerms.length;

/** 詳細モードと初心者コースのレッスン（#/learn/<ID> はどちらのレッスンも開ける） */
export const lessonById = new Map<string, Unit>([...unitById, ...beginnerUnits.map((unit) => [unit.id, unit] as const)]);

export const isBeginner = (): boolean => preferences.mode === "beginner";

/** 今のモードのレッスン */
export const courseUnits = (): Unit[] => (isBeginner() ? beginnerUnits : units);

/** 今のモードの語 */
export const courseTerms = (): Term[] => (isBeginner() ? beginnerTerms : terms);

/** 今のモードで学ぶ語か（詳細モードではすべて） */
export const inCourse = (termId: string): boolean => !isBeginner() || beginnerIds.has(termId);

/** 今のモードで、その語の入るレッスン（初心者コースの外の語は undefined） */
export function courseUnitOf(termId: string): Unit | undefined {
  if (!isBeginner()) return unitById.get(termById.get(termId)?.unit ?? "");
  return beginnerUnits.find((unit) => unit.terms.some((term) => term.id === termId));
}

/** 学ぶ問い方（設定の「学ぶ問い方」。初心者モードでは基本の4つのうち選んだものだけ） */
export function studyFacets(): Facet[] {
  return isBeginner() ? preferences.studyFacets.filter((facet) => BASIC_FACETS.includes(facet)) : preferences.studyFacets;
}

/** 初心者コースのレッスンが1つの臓器の語だけなら、その臓器（心臓のレッスンは心臓と大血管だけを見せる） */
export function beginnerOrgan(unitId: string | undefined): Organ | undefined {
  const unit = beginnerUnits.find((item) => item.id === unitId);
  const organ = unit?.terms[0] ? organOf(unit.terms[0].id) : undefined;
  return organ && unit!.terms.every((term) => organOf(term.id) === organ) ? organ : undefined;
}
