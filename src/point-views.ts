import viewsJson from "../content/point-views.json";
import type { Term } from "./content";
import type { Vec3 } from "./landmarks";

/**
 * 出題で語を映す向き（docs/普段使い.md「押しにくさの見直し」）。名前→位置で、ふつうの向き（語は正面、骨・器官の部位は正面やや右上）
 * からだと隠れたり小さかったりする語は、scripts/point-views.mjs で10の向きから出題と同じ近さで映して、タップで正解になる面が
 * いちばん広い向きを測り、content/point-views.json に書いておく。位置→名前（オレンジに光らせた語）も同じ向きから映す。
 *
 * 向きはカメラを置く側（体の右は x がマイナス、前は z がプラス）。上下は真上・真下だと回しにくいので前へ傾ける
 */
export const VIEW_DIRECTIONS = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [-1, 0, 0],
  left: [1, 0, 0],
  frontRight: [-0.7, 0, 0.7],
  frontLeft: [0.7, 0, 0.7],
  backRight: [-0.7, 0, -0.7],
  backLeft: [0.7, 0, -0.7],
  above: [0, 0.8, 0.6],
  below: [0, -0.8, 0.6],
} as const satisfies Record<string, Readonly<Vec3>>;

export type ViewName = keyof typeof VIEW_DIRECTIONS;

/** 名前→位置で、ふつう映す向き。語は正面から */
export const TERM_DEFAULT: Vec3 = [0, 0, 1];
/** 骨・器官の部位は、その骨・器官だけを見せて正面やや右上から（前の問題の向きが残ると見にくいので、いつも同じ向き） */
export const LANDMARK_DEFAULT: Vec3 = [-0.35, 0.15, 1];

const views = (viewsJson as { views: Record<string, ViewName> }).views;

/** 測って向きを決めた語か（point-views.json にある語） */
export function hasMeasuredView(termId: string): boolean {
  return Object.hasOwn(views, termId);
}

/** 出題でその語を映す向き（point-views.json に無ければ、語に書いた from か、ふつうの向き） */
export function questionView(term: Pick<Term, "id" | "of" | "from">): Vec3 {
  const name = views[term.id];
  if (name) return [...VIEW_DIRECTIONS[name]];
  if (term.of) return [...LANDMARK_DEFAULT];
  return term.from ? [...term.from] : [...TERM_DEFAULT];
}
