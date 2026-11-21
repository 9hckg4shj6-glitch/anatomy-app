import type { Vec3 } from "../landmarks";
import { Polyline } from "../motions";

/**
 * 模型の血液の粒の流れ（docs/動きの図鑑.md「わかりやすい模型」）。
 * 血管（道）の粒は、その道を流れる血液の量（mL/秒）に比例して進む。部屋（たまり）は粒をためておき、
 * 出口の弁を流れた量が粒1つ分（perDot mL）になるたびに、古い粒から1つずつ出す。
 * 1拍で入る量と出る量は同じなので、部屋の粒の数は部屋の容積に合わせて増えたり減ったりする
 */

export type RGB = [number, number, number];

/** 行き先: たまり（部屋）か、道を重みで選ぶ */
export type Target = { pool: string } | { paths: [string, number][] };

export interface FlowPath {
  points: Vec3[];
  /** 今この道を流れる量（mL/秒）。u は1拍の中の位置 */
  rate: (u: number) => number;
  /** 道の太さの目安（太いほどゆっくり進み、粒が詰まって見える。毛細血管は太く） */
  width?: number;
  to: Target;
  /** 粒の色（道の初め → 終わり） */
  color: [RGB, RGB];
}

export interface FlowPool {
  /** 粒を置く所（動かす前の点） */
  slots: Vec3[];
  /** 今出口から出る量（mL/秒） */
  rate: (u: number) => number;
  to: Target;
  color: RGB;
  /** 今の形で点を動かす（部屋が縮むと粒も寄る） */
  move?: (p: Vec3, out: Vec3) => void;
  /** はじめにためておく量（mL） */
  start: number;
}

interface Dot {
  path: string | null;
  pool: string | null;
  s: number;
  slot: number;
  /** たまりに入ってから・道に出てからの時間（秒）。入った所から寄っていく間 */
  age: number;
  from: Vec3;
  /** 道へ出たときの初めの位置からなめらかにつなぐ長さ */
  blend: number;
}

export class FlowNet {
  readonly count: number;
  /** 道とたまり（Tracer も読む） */
  readonly paths = new Map<string, { spec: FlowPath; line: Polyline; width: number }>();
  readonly pools = new Map<string, { spec: FlowPool; queue: Dot[]; debt: number }>();
  private readonly dots: Dot[] = [];
  private seed = 12345;
  /** 道の上で粒どうしの間（cm）。perDot mL が進む長さ */
  private readonly gap: number;

  /**
   * perDot: 粒1つの血液の量（mL）。cmPerMl: 太さ1の道を 1 mL が進む長さ（cm）
   */
  constructor(paths: Record<string, FlowPath>, pools: Record<string, FlowPool>, private readonly perDot: number, private readonly cmPerMl: number) {
    this.gap = perDot * cmPerMl;
    for (const [id, spec] of Object.entries(paths)) this.paths.set(id, { spec, line: Polyline.of(spec.points), width: spec.width ?? 1 });
    for (const [id, spec] of Object.entries(pools)) this.pools.set(id, { spec, queue: [], debt: 0 });
    // はじめの粒: 道には同じ間で、たまりには量に合わせて
    for (const [id, { line, width }] of this.paths) {
      const gap = this.gap / width;
      for (let s = this.random() * gap; s < line.length; s += gap) this.dots.push({ path: id, pool: null, s, slot: 0, age: 9, from: [0, 0, 0], blend: 0 });
    }
    for (const [id, pool] of this.pools) {
      const n = Math.round(pool.spec.start / perDot);
      for (let i = 0; i < n; i++) {
        const dot: Dot = { path: null, pool: id, s: 0, slot: Math.floor(this.random() * pool.spec.slots.length), age: 9, from: [0, 0, 0], blend: 0 };
        pool.queue.push(dot);
        this.dots.push(dot);
      }
    }
    // 流れてきた粒はどこかの粒が出て行った分だけ入るので、数は変わらない（余裕を見て少し多く取る）
    this.count = this.dots.length;
  }

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private choose(target: Target): Target & { path?: string } {
    if ("pool" in target) return target;
    let r = this.random() * target.paths.reduce((sum, [, w]) => sum + w, 0);
    for (const [id, w] of target.paths) {
      r -= w;
      if (r <= 0) return { ...target, path: id };
    }
    return { ...target, path: target.paths[target.paths.length - 1][0] };
  }

  private send(dot: Dot, target: Target, at: Vec3, overshoot: number): void {
    const chosen = this.choose(target);
    dot.age = 0;
    dot.from = [...at];
    if ("pool" in chosen) {
      const pool = this.pools.get(chosen.pool)!;
      dot.path = null;
      dot.pool = chosen.pool;
      dot.slot = Math.floor(this.random() * pool.spec.slots.length);
      pool.queue.push(dot);
      return;
    }
    dot.pool = null;
    dot.path = chosen.path!;
    dot.s = overshoot;
    // 近くの道へ移るときは、なめらかにつなぐ（離れた所へ戻すとき＝心臓だけの模型で動脈の端から静脈の初めへは、つながない）
    const start = this.paths.get(dot.path)!.spec.points[0];
    dot.blend = Math.hypot(start[0] - at[0], start[1] - at[1], start[2] - at[2]) < 2.5 ? 1.6 : 0;
  }

  /** dt 秒進める（u は1拍の中の位置） */
  step(u: number, dt: number): void {
    if (dt <= 0) return;
    const at: Vec3 = [0, 0, 0];
    const tmp = new Float32Array(3);
    for (const dot of this.dots) {
      dot.age += dt;
      if (!dot.path) continue;
      const path = this.paths.get(dot.path)!;
      dot.s += (Math.max(0, path.spec.rate(u)) * dt * this.cmPerMl) / path.width;
      if (dot.s >= path.line.length) {
        path.line.at(path.line.length, tmp);
        this.send(dot, path.spec.to, [tmp[0], tmp[1], tmp[2]], 0);
      }
    }
    for (const pool of this.pools.values()) {
      pool.debt += Math.max(0, pool.spec.rate(u)) * dt;
      while (pool.debt >= this.perDot && pool.queue.length) {
        pool.debt -= this.perDot;
        const dot = pool.queue.shift()!;
        this.slotPosition(pool.spec, dot, at);
        this.send(dot, pool.spec.to, at, 0);
        dot.blend = 2.2;
      }
      // 空のときに借りがたまり、あとでまとめて出ないように
      if (!pool.queue.length) pool.debt = Math.min(pool.debt, this.perDot);
    }
  }

  private slotPosition(pool: FlowPool, dot: Dot, out: Vec3): void {
    const slot = pool.slots[dot.slot];
    if (pool.move) pool.move(slot, out);
    else {
      out[0] = slot[0];
      out[1] = slot[1];
      out[2] = slot[2];
    }
  }

  /** 粒の位置（scale 倍）と色を書く。visible で道・たまりごとに隠せる */
  write(position: Float32Array, color: Float32Array, size: Float32Array, scale: number, visible?: (id: string) => boolean): void {
    const tmp = new Float32Array(3);
    const at: Vec3 = [0, 0, 0];
    this.dots.forEach((dot, i) => {
      let c: RGB;
      if (dot.path) {
        const path = this.paths.get(dot.path)!;
        path.line.at(dot.s, tmp);
        // たまりから出た粒は、元の位置から道へなめらかに
        if (dot.blend > 0 && dot.s < dot.blend) {
          const t = dot.s / dot.blend;
          const e = t * t * (3 - 2 * t);
          for (let k = 0; k < 3; k++) tmp[k] = dot.from[k] + (tmp[k] - dot.from[k]) * e;
        }
        const f = path.line.length ? dot.s / path.line.length : 0;
        const [a, b] = path.spec.color;
        c = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
        size[i] = !visible || visible(dot.path) ? 1 : 0;
      } else {
        const pool = this.pools.get(dot.pool!)!;
        this.slotPosition(pool.spec, dot, at);
        // 入ってきた粒は、入口から置き場所へ 0.25 秒で寄る
        const t = Math.min(1, dot.age / 0.25);
        const e = t * t * (3 - 2 * t);
        for (let k = 0; k < 3; k++) tmp[k] = dot.from[k] + (at[k] - dot.from[k]) * (dot.age > 5 ? 1 : e);
        c = pool.spec.color;
        size[i] = !visible || visible(dot.pool!) ? 1 : 0;
      }
      position[i * 3] = tmp[0] * scale;
      position[i * 3 + 1] = tmp[1] * scale;
      position[i * 3 + 2] = tmp[2] * scale;
      color[i * 3] = c[0];
      color[i * 3 + 1] = c[1];
      color[i * 3 + 2] = c[2];
    });
  }

  /** 道・たまりの行き先の ID（1滴を追う道順を作る） */
  next(id: string): string[] {
    const target = this.paths.get(id)?.spec.to ?? this.pools.get(id)?.spec.to;
    if (!target) return [];
    return "pool" in target ? [target.pool] : target.paths.filter(([, w]) => w > 0).map(([to]) => to);
  }

  /** 太さ1の道を 1 mL が進む長さ（cm） */
  get cmPerMlValue(): number {
    return this.cmPerMl;
  }

  /** たまりの粒の数（確かめ用） */
  poolCount(id: string): number {
    return this.pools.get(id)?.queue.length ?? 0;
  }
}

/** 1拍の流れの列を、1拍で流れる量が total（mL）になるようにそろえる（粒の数が拍ごとにずれないように） */
export function normalizeFlow(series: number[], period: number, total: number): number[] {
  const positive = series.map((v) => Math.max(0, v));
  const sum = (positive.reduce((a, b) => a + b, 0) / positive.length) * period;
  return positive.map((v) => (v * total) / (sum || 1));
}

/**
 * 1滴を追う（docs/動きの図鑑.md「品質の見直し」）。決めた道順（route）を、ほかの粒と同じ速さで進む1つの粒。
 * 道ではその道を流れる量に比例して進み、たまり（部屋）では出口から leaveAt mL 出たら次の道へ出る
 * （部屋に入ってから、次に弁が開いて流れ出る間に出る）
 */
export class Tracer {
  /** 道順の中の今の番号 */
  index = 0;
  /** 道の上の位置（cm） */
  s = 0;
  /** たまりに入ってから出口を流れた量（mL） */
  volume = 0;
  private age = 9;
  private from: Vec3 = [0, 0, 0];
  private readonly at = new Float32Array(3);
  /** 道順を1周したとき（右心房に戻ったとき）に呼ぶ */
  onLoop: (() => void) | null = null;

  constructor(private readonly net: FlowNet, public route: string[], private readonly leaveAt: number, private readonly slot = 37) {}

  /** 今いる道・たまりの中の進み具合（0〜1） */
  get progress(): number {
    const id = this.route[this.index];
    const path = this.net.paths.get(id);
    if (path) return path.line.length ? Math.min(1, this.s / path.line.length) : 1;
    return Math.min(1, this.volume / this.leaveAt);
  }

  /** 道順の index 番目へ移る（frac はその道・たまりの中の位置 0〜1） */
  place(index: number, frac = 0): void {
    this.index = ((index % this.route.length) + this.route.length) % this.route.length;
    const id = this.route[this.index];
    const path = this.net.paths.get(id);
    this.s = path ? path.line.length * frac : 0;
    this.volume = path ? 0 : this.leaveAt * frac;
    this.age = 9;
  }

  step(u: number, dt: number): void {
    if (dt <= 0) return;
    this.age += dt;
    const id = this.route[this.index];
    const path = this.net.paths.get(id);
    if (path) {
      this.s += (Math.max(0, path.spec.rate(u)) * dt * this.net.cmPerMlValue) / path.width;
      if (this.s >= path.line.length) this.advance();
      return;
    }
    const pool = this.net.pools.get(id);
    if (!pool) return this.advance();
    this.volume += Math.max(0, pool.spec.rate(u)) * dt;
    if (this.volume >= this.leaveAt) this.advance();
  }

  private advance(): void {
    const from: Vec3 = [0, 0, 0];
    this.position(from);
    this.from = from;
    this.index = (this.index + 1) % this.route.length;
    this.s = 0;
    this.volume = 0;
    this.age = 0;
    if (this.index === 0) this.onLoop?.();
  }

  /** 今の道・たまりの上の位置（なめらかにつなぐ前） */
  private raw(out: Vec3): void {
    const id = this.route[this.index];
    const path = this.net.paths.get(id);
    if (path) {
      path.line.at(Math.min(this.s, path.line.length), this.at);
      out[0] = this.at[0];
      out[1] = this.at[1];
      out[2] = this.at[2];
      return;
    }
    const pool = this.net.pools.get(id)!;
    const slot = pool.spec.slots[this.slot % pool.spec.slots.length];
    if (pool.spec.move) pool.spec.move(slot, out);
    else {
      out[0] = slot[0];
      out[1] = slot[1];
      out[2] = slot[2];
    }
  }

  /** 今の位置（cm。たまりへ入るとき・道へ出るときは、前の位置から 0.3 秒でなめらかに） */
  position(out: Vec3): Vec3 {
    this.raw(out);
    if (this.age >= 0.3) return out;
    const t = this.age / 0.3;
    const e = t * t * (3 - 2 * t);
    for (let k = 0; k < 3; k++) out[k] = this.from[k] + (out[k] - this.from[k]) * e;
    return out;
  }

  /** 今の色 */
  color(): RGB {
    const id = this.route[this.index];
    const path = this.net.paths.get(id);
    if (!path) return this.net.pools.get(id)!.spec.color;
    const [a, b] = path.spec.color;
    const f = this.progress;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
}
