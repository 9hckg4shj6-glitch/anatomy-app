import beginnerJson from "../content/beginner.json";
import pointsJson from "../content/points.json";
import standardLessonsJson from "../content/standard-lessons.json";
import { isPlateUnit, organOf, organOfLesson, termById, terms, units, unitById, type OrganCore, type Term, type Unit } from "./content";
import type { Facet } from "./db";
import { preferences } from "./settings";
import { BASIC_FACETS } from "./study";

/**
 * 初心者モード・標準モード・詳細モード（設定の mode）。標準モードは必修と基礎の語（level 1・2）だけで学ぶ（docs/学びやすさ.md の案2）。
 * 以下は初心者モードと詳細モードの説明。
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

/** 標準の語（必修と基礎）のうち初心者コースに無い語の「覚えること」（content/points.json。docs/学びやすさ.md の案4） */
const standardPoints = new Map(Object.entries(pointsJson as Record<string, string>));

/** 語の「覚えること」（初心者コースの語は beginner.json、ほかの標準の語は points.json。発展の語には無い） */
export function pointOf(termId: string): string | undefined {
  return beginnerPoints.get(termId) ?? standardPoints.get(termId);
}

const beginnerTerms: Term[] = beginnerUnits.flatMap((unit) => unit.terms);
const beginnerIds = new Set(beginnerTerms.map((term) => term.id));

/** 初心者コースの語の数（ホームのモードの切りかえに出す） */
export const beginnerTermCount = beginnerTerms.length;

/** 詳細モードと初心者コースのレッスン（#/learn/<ID> はどちらのレッスンも開ける。標準モードで開くときは courseLesson） */
export const lessonById = new Map<string, Unit>([...unitById, ...beginnerUnits.map((unit) => [unit.id, unit] as const)]);

interface StandardLessonsFile {
  merge: { units: string[]; title?: string }[];
}

/** 標準コースでまとめるレッスン（content/standard-lessons.json。docs/学びやすさ.md の案6）。レッスンID → まとめた先のレッスンID */
const standardMerge = (standardLessonsJson as StandardLessonsFile).merge;
const mergedInto = new Map(standardMerge.flatMap((group) => group.units.map((id) => [id, group.units[0]] as const)));

/** 標準コースで、そのレッスンの語の入るレッスンのID（まとめたレッスンは、まとめた先のID） */
export const standardLessonId = (unitId: string): string => mergedInto.get(unitId) ?? unitId;

const withoutAdvanced = (unit: Unit): Unit => ({ ...unit, terms: unit.terms.filter((term) => term.level <= 2) });

/**
 * 標準コースのレッスン（詳細モードのレッスンから発展の語＝level 3 を除いたもの。レッスンID は同じ。語の残らないレッスンは出さない）。
 * 語が3つ以下になるレッスンは、standard-lessons.json で近いレッスンとまとめる（最初のレッスンのID・位置で、語は書いた順）
 */
export const standardUnits: Unit[] = units
  .flatMap((unit): Unit[] => {
    const group = standardMerge.find((item) => item.units.includes(unit.id));
    if (!group) return [withoutAdvanced(unit)];
    if (group.units[0] !== unit.id) return [];
    const members = group.units.flatMap((id) => unitById.get(id) ?? []);
    const intro = members.flatMap((member) => member.intro ?? []);
    return [{ ...unit, title: group.title ?? unit.title, intro: intro.length ? intro : undefined, terms: members.flatMap((member) => withoutAdvanced(member).terms) }];
  })
  .filter((unit) => unit.terms.length > 0);
const standardById = new Map(standardUnits.map((unit) => [unit.id, unit]));
const standardTerms: Term[] = standardUnits.flatMap((unit) => unit.terms);
const standardIds = new Set(standardTerms.map((term) => term.id));

/** 標準コースの語の数（設定のコースの説明に出す） */
export const standardTermCount = standardTerms.length;

export const isBeginner = (): boolean => preferences.mode === "beginner";
export const isStandard = (): boolean => preferences.mode === "standard";
/** 詳細モード（すべての語。初心者・標準のようにコースで絞らない） */
export const isDetail = (): boolean => !isBeginner() && !isStandard();

/** 今のモードのレッスン */
export const courseUnits = (): Unit[] => (isBeginner() ? beginnerUnits : isStandard() ? standardUnits : units);

/** 今のモードの語 */
export const courseTerms = (): Term[] => (isBeginner() ? beginnerTerms : isStandard() ? standardTerms : terms);

/** 今のモードで学ぶ語か（詳細モードではすべて） */
export const inCourse = (termId: string): boolean => (isBeginner() ? beginnerIds.has(termId) : isStandard() ? standardIds.has(termId) : true);

/** 今のモードで、その語の入るレッスン（コースの外の語は undefined） */
export function courseUnitOf(termId: string): Unit | undefined {
  if (isBeginner()) return beginnerUnits.find((unit) => unit.terms.some((term) => term.id === termId));
  const unitId = termById.get(termId)?.unit ?? "";
  if (isStandard()) return standardIds.has(termId) ? standardById.get(standardLessonId(unitId)) : undefined;
  return unitById.get(unitId);
}

/**
 * #/learn/<ID> で開くレッスン（標準モードでは発展の語を除いたもの。まとめたレッスンのIDなら、まとめた先のレッスン。
 * 標準に語の無いレッスンは詳細モードのまま）
 */
export function courseLesson(unitId: string): Unit | undefined {
  return (isStandard() ? standardById.get(standardLessonId(unitId)) : undefined) ?? lessonById.get(unitId);
}

/** 学ぶ問い方（設定の「学ぶ問い方」。初心者モードでは基本の4つのうち選んだものだけ） */
export function studyFacets(): Facet[] {
  return isBeginner() ? preferences.studyFacets.filter((facet) => BASIC_FACETS.includes(facet)) : preferences.studyFacets;
}

/** 初心者コースのレッスンが1つの臓器の語だけなら、その臓器（心臓のレッスンは心臓と大血管だけを見せる） */
export function beginnerOrgan(unitId: string | undefined): OrganCore | undefined {
  const unit = beginnerUnits.find((item) => item.id === unitId);
  const organ = unit?.terms[0] ? organOf(unit.terms[0].id) : undefined;
  return organ && unit!.terms.every((term) => organOf(term.id) === organ) ? organ : undefined;
}

/**
 * 臓器の図で学ぶレッスン（今のコースの図のレッスンのうち、この臓器に入るもの。docs/学びやすさ.md の案1）。
 * 組織・発生・皮膚・臓器の内部のように平面図で覚えるレッスンは、学ぶのレッスンの道すじではなくここで学ぶ
 */
export function organLessons(organ: OrganCore): Unit[] {
  // 臓器の図の画面の臓器は、残りの所を合わせた別のもの（src/organ-details.ts）なので ID でくらべる
  return courseUnits().filter((unit) => isPlateUnit(unit) && organOfLesson(unit)?.id === organ.id);
}
