/**
 * 3Dの上の名前の札（viewer の setTags）を、重ならないように置く（docs/動きの図鑑.md「品質の見直し」）。
 * 札は優先の高い順（呼んだ側が並べた順）に置き、先に置いた札・右上のボタンや向きの目印・下の字幕と重なるときは、
 * 上下左右へずらす。どこへずらしても重なるときは、重なりが一番小さい所に置き、それでも大きく重なるなら隠す。
 * ずらした札は、元の点から引き出し線を引く（呼んだ側）。ずらすときは前のフレームと同じ向きを先に試すので、動いていてもちらつかない
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TagBox {
  /** 札の点（画面の px） */
  x: number;
  y: number;
  /** 札の大きさ */
  w: number;
  h: number;
  /** 前のフレームで選んだずらし方（候補の番号） */
  last?: number;
}

export interface TagPlace {
  /** 札の中心 */
  x: number;
  y: number;
  /** 選んだずらし方（候補の番号） */
  choice: number;
  hidden: boolean;
}

const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** 札のずらし方の候補（札の大きさに対する倍率）。0 はずらさない */
const OFFSETS: [number, number][] = [
  [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -2], [0, 2], [-2, 0], [2, 0],
];

/**
 * tags を順に置く。avoid は札を置かない所（ボタン・字幕など）、width・height は3Dの枠。
 * margin は札どうしのすき間（px）
 */
export function layoutTags(tags: TagBox[], avoid: Rect[], width: number, height: number, margin = 3): TagPlace[] {
  const placed: Rect[] = [];
  return tags.map((tag) => {
    const w = tag.w + margin * 2;
    const h = tag.h + margin * 2;
    let best: { x: number; y: number; choice: number; cost: number } | null = null;
    // まずずらさない所、次に前のフレームでずらした所（動いていてもずらす向きが変わらないように）、そのあとほかの所
    const order = tag.last !== undefined && tag.last > 0 ? [0, tag.last, ...OFFSETS.keys()] : [...OFFSETS.keys()];
    for (const i of order) {
      const [ox, oy] = OFFSETS[i];
      // 枠の中へ入れる
      const cx = Math.min(width - w / 2, Math.max(w / 2, tag.x + ox * (w * 0.5 + 6)));
      const cy = Math.min(height - h / 2, Math.max(h / 2, tag.y + oy * (h + 2)));
      const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
      let cost = 0;
      for (const other of placed) cost += overlap(rect, other);
      for (const other of avoid) cost += overlap(rect, other) * 1.5;
      if (cost === 0) {
        best = { x: cx, y: cy, choice: i, cost };
        break;
      }
      // 少しの重なりなら、ずらさない方を好む
      cost += Math.hypot(cx - tag.x, cy - tag.y) * 0.5;
      if (!best || cost < best.cost) best = { x: cx, y: cy, choice: i, cost };
    }
    const chosen = best!;
    const hidden = chosen.cost > w * h * 0.35;
    if (!hidden) placed.push({ x: chosen.x - w / 2, y: chosen.y - h / 2, w, h });
    return { x: chosen.x, y: chosen.y, choice: chosen.choice, hidden };
  });
}

/** 札の点 (ax, ay) から札（中心 x, y・大きさ w×h）の縁までの線。短ければ null */
export function leaderLine(ax: number, ay: number, place: { x: number; y: number }, w: number, h: number): { x: number; y: number; length: number; angle: number } | null {
  const dx = ax - place.x;
  const dy = ay - place.y;
  // 点が札の中（か縁のすぐ近く）なら線は要らない
  if (Math.abs(dx) <= w / 2 + 4 && Math.abs(dy) <= h / 2 + 4) return null;
  // 札の中心から点へ向かう線が、札の縁を出る所
  const t = Math.min(Math.abs(dx) > 0 ? w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? h / 2 / Math.abs(dy) : Infinity, 1);
  const ex = place.x + dx * t;
  const ey = place.y + dy * t;
  const length = Math.hypot(ax - ex, ay - ey);
  if (length < 6) return null;
  return { x: ax, y: ay, length, angle: Math.atan2(ey - ay, ex - ax) };
}
