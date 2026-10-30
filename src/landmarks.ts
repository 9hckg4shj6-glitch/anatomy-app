import { pins, terms, type Pin, type Term } from "./content";

export type Vec3 = [number, number, number];
/** 区域を切る面 [nx, ny, nz, w]（nx·x + ny·y + nz·z + w ≥ 0 の側が区域） */
export type Cut = [number, number, number, number];

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

/**
 * 点が区域（region）からどれだけ外にあるか（中なら 0 以下）。囲む球と、切る面のはみ出しの大きいほう。左右は折り返して近いほう。
 * 面の向き（face）は見ない（タップした点は表面の上なので）
 */
export function regionGap(point: Vec3, pin: Pin): number {
  const region = pin.region;
  if (!region) return Infinity;
  const sides: Vec3[] = pin.one ? [point] : [point, [-point[0], point[1], point[2]]];
  return Math.min(...sides.map((q) => Math.max(
    Math.hypot(q[0] - region.c[0], q[1] - region.c[1], q[2] - region.c[2]) - region.r,
    ...region.cut.map(([x, y, z, w]) => -(x * q[0] + y * q[1] + z * q[2] + w)),
  )));
}

export function hitsPin(point: Vec3, pin: Pin, tolerance = TAP_TOLERANCE): boolean {
  if (pin.region) return regionGap(point, pin) <= tolerance;
  return distanceToPin(point, pin) <= pin.r + tolerance;
}

/** タップした点に当たる部位（いちばん近いもの）。candidates はその骨・器官の部位 */
export function landmarkAt(point: Vec3, candidates: Term[], tolerance = TAP_TOLERANCE): Term | null {
  let best: Term | null = null;
  let bestScore = Infinity;
  for (const term of candidates) {
    const pin = pins[term.id];
    if (!pin) continue;
    // 範囲の半径に対する近さで比べる。広い部位（窩）の端より、狭い部位（結節・突起）の中心近くを選ぶ。
    // 区域（骨頭など）の中はどこでも 0.9（中にある小さな部位＝大腿骨頭窩の中心近くはそちらを選ぶ）
    let score: number;
    if (pin.region) {
      const gap = regionGap(point, pin);
      if (gap > tolerance) continue;
      score = gap <= 0 ? 0.9 : 1 + gap / pin.r;
    } else {
      const distance = distanceToPin(point, pin);
      if (distance > pin.r + tolerance) continue;
      score = distance / pin.r;
    }
    if (score < bestScore) {
      best = term;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 一方のピンの点がすべて（または点の中心が深く）、もう一方の範囲に入る。
 */
export function nestedPins(a: Pin, b: Pin): boolean {
  const inside = (inner: Pin, outer: Pin) =>
    inner.at.every((p) => distanceToPin(p as Vec3, outer) <= outer.r) || distanceToPin(pinCenter(inner), outer) <= outer.r * 0.8;
  return inside(a, b) || inside(b, a);
}

/** 部位がのる骨・器官の部品の名前（parts が無ければ親の parts） */
function hostParts(term: Term): string[] {
  return term.parts ?? terms.find((other) => other.id === term.of)?.parts ?? [];
}

/**
 * 同じ骨の上で範囲が入れ子の部位（椎弓と椎弓根、寛骨臼と月状面、頬骨弓と側頭骨の頬骨突起）。4択に並べるとどちらも正しくなるので出さない。
 * 関節で向かい合う別の骨の部位（大腿骨頭と寛骨臼、肋骨頭と肋骨窩）は、位置が重なっても紛らわしい選択肢として残す。
 */
export function nestedLandmarks(a: Term, b: Term): boolean {
  const pa = pins[a.id], pb = pins[b.id];
  if (!pa || !pb || !nestedPins(pa, pb)) return false;
  // 薄い骨の表と裏（棘下窩と肩甲下窩、肘頭窩と鈎突窩）は別の部位
  if (pa.n && pb.n && pa.n[0] * pb.n[0] + pa.n[1] * pb.n[1] + pa.n[2] * pb.n[2] < 0) return false;
  const host = new Set(hostParts(a));
  return hostParts(b).some((part) => host.has(part));
}

/** 4択の選択肢に使う、ピンが近い部位（近い順）。骨の部位は骨の部位どうし、器官の部位は同じ系統の部位どうし */
export function nearbyLandmarks(termId: string, count = 8): string[] {
  const pin = pins[termId];
  const self = terms.find((term) => term.id === termId);
  if (!pin || !self) return [];
  const c = pinCenter(pin);
  return terms
    .filter((term) => term.of && term.id !== termId && pins[term.id] && term.system === self.system && !nestedLandmarks(self, term))
    .map((term) => [term.id, distanceToPin(c, pins[term.id])] as const)
    .sort((a, b) => a[1] - b[1])
    .slice(0, count)
    .map(([id]) => id);
}

/**
 * 骨学試験 D の図で画面の上になる向き。世界の上を見る向き（from＝カメラを置く向き）に垂直にしたもの
 * （真上・真下から見るときは前か後ろ）を、見る向きのまわりに roll 度回す。3D表示（viewer.frameDrawing）と答え合わせで同じものを使う。
 */
export function drawingUp(from: Vec3, roll = 0): Vec3 {
  const len = Math.hypot(...from);
  const t = from.map((v) => v / len) as Vec3;
  let up: Vec3 = [-t[0] * t[1], 1 - t[1] * t[1], -t[2] * t[1]];
  const upLen = Math.hypot(...up);
  up = upLen < 1e-6 ? [0, 0, 1] : (up.map((v) => v / upLen) as Vec3);
  // 見る向き（-from）を軸に右ねじの向きに回す（Rodrigues の式）
  const k: Vec3 = [-t[0], -t[1], -t[2]];
  const a = (roll * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const cross: Vec3 = [k[1] * up[2] - k[2] * up[1], k[2] * up[0] - k[0] * up[2], k[0] * up[1] - k[1] * up[0]];
  const dot = k[0] * up[0] + k[1] * up[1] + k[2] * up[2];
  return [0, 1, 2].map((i) => up[i] * cos + cross[i] * sin + k[i] * dot * (1 - cos)) as Vec3;
}
