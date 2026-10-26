import { pins, terms, type Pin, type Term } from "./content";

export type Vec3 = [number, number, number];

/** タップの判定で、示す範囲（r）の外にどれだけはみ出しても正解にするか（m） */
export const TAP_TOLERANCE = 0.006;

export function pinCenter(pin: Pin): Vec3 {
  const sum = pin.at.reduce<Vec3>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return sum.map((v) => v / pin.at.length) as Vec3;
}

/** 点の列の広がり（中心から一番遠い点まで） */
export function pinSpread(pin: Pin): number {
  const c = pinCenter(pin);
  return Math.max(0, ...pin.at.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
}

/**
 * 点からピンまでの距離。ピンは本人の右側に打つので、左側（x > 0）の骨は左右を折り返して比べる。
 * 正中の骨では折り返しても同じ形なので、両方を比べて近いほうをとればよい。
 * 左右の無い器官の部位（one）は折り返さない（胃の幽門の反対側は胃体なので）。
 */
export function distanceToPin(point: Vec3, pin: Pin): number {
  const sides: Vec3[] = pin.one ? [point] : [point, [-point[0], point[1], point[2]]];
  return Math.min(...pin.at.flatMap((p) => sides.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))));
}

export function hitsPin(point: Vec3, pin: Pin, tolerance = TAP_TOLERANCE): boolean {
  return distanceToPin(point, pin) <= pin.r + tolerance;
}

/** タップした点に当たる部位（いちばん近いもの）。candidates はその骨・器官の部位 */
export function landmarkAt(point: Vec3, candidates: Term[], tolerance = TAP_TOLERANCE): Term | null {
  let best: Term | null = null;
  let bestScore = Infinity;
  for (const term of candidates) {
    const pin = pins[term.id];
    if (!pin) continue;
    // 範囲の半径に対する近さで比べる。広い部位（窩）の端より、狭い部位（結節・突起）の中心近くを選ぶ
    const distance = distanceToPin(point, pin);
    const score = distance / pin.r;
    if (distance <= pin.r + tolerance && score < bestScore) {
      best = term;
      bestScore = score;
    }
  }
  return best;
}

/** 4択の選択肢に使う、ピンが近い部位（近い順）。骨の部位は骨の部位どうし、器官の部位は同じ系統の部位どうし */
export function nearbyLandmarks(termId: string, count = 8): string[] {
  const pin = pins[termId];
  const system = terms.find((term) => term.id === termId)?.system;
  if (!pin) return [];
  const c = pinCenter(pin);
  return terms
    .filter((term) => term.of && term.id !== termId && pins[term.id] && term.system === system)
    .map((term) => [term.id, distanceToPin(c, pins[term.id])] as const)
    .sort((a, b) => a[1] - b[1])
    .slice(0, count)
    .map(([id]) => id);
}
