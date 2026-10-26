// 点の k-d 木（最近点・半径の中の点）。骨の合わせ込みで何十万回も引くので、配列だけで組む。
export class KdTree {
  /** points: Float32Array/Float64Array（x,y,z の並び） */
  constructor(points) {
    this.points = points;
    const n = points.length / 3;
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    this.axis = new Uint8Array(n);
    this.build(0, n, 0);
  }

  build(lo, hi, depth) {
    if (hi - lo <= 1) return;
    // 広がりの大きい軸で切る
    const { points: p, order } = this;
    let axis = 0, best = -1;
    for (let k = 0; k < 3; k++) {
      let min = Infinity, max = -Infinity;
      for (let i = lo; i < hi; i++) { const v = p[order[i] * 3 + k]; if (v < min) min = v; if (v > max) max = v; }
      if (max - min > best) { best = max - min; axis = k; }
    }
    const mid = (lo + hi) >> 1;
    this.select(lo, hi - 1, mid, axis);
    this.axis[mid] = axis;
    this.build(lo, mid, depth + 1);
    this.build(mid + 1, hi, depth + 1);
  }

  // order[lo..hi] を、mid 番目が axis で mid 番目に小さい値になるよう並べる（クイックセレクト）
  select(lo, hi, k, axis) {
    const { points: p, order } = this;
    while (hi > lo) {
      const pivot = p[order[(lo + hi) >> 1] * 3 + axis];
      let i = lo, j = hi;
      while (i <= j) {
        while (p[order[i] * 3 + axis] < pivot) i++;
        while (p[order[j] * 3 + axis] > pivot) j--;
        if (i <= j) { const t = order[i]; order[i] = order[j]; order[j] = t; i++; j--; }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else return;
    }
  }

  /** 最も近い点の番号と距離の2乗 */
  nearest(x, y, z) {
    let bestI = -1, bestD = Infinity;
    const { points: p, order, axis } = this;
    const visit = (lo, hi) => {
      if (hi <= lo) return;
      const mid = (lo + hi) >> 1;
      const i = order[mid];
      const dx = p[i * 3] - x, dy = p[i * 3 + 1] - y, dz = p[i * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; bestI = i; }
      const a = axis[mid];
      const diff = (a === 0 ? x : a === 1 ? y : z) - p[i * 3 + a];
      if (diff < 0) {
        visit(lo, mid);
        if (diff * diff < bestD) visit(mid + 1, hi);
      } else {
        visit(mid + 1, hi);
        if (diff * diff < bestD) visit(lo, mid);
      }
    };
    visit(0, order.length);
    return [bestI, bestD];
  }

  /** 半径 r の中の点ごとに callback(番号, 距離の2乗) */
  within(x, y, z, r, callback) {
    const r2 = r * r;
    const { points: p, order, axis } = this;
    const visit = (lo, hi) => {
      if (hi <= lo) return;
      const mid = (lo + hi) >> 1;
      const i = order[mid];
      const dx = p[i * 3] - x, dy = p[i * 3 + 1] - y, dz = p[i * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d <= r2) callback(i, d);
      const a = axis[mid];
      const diff = (a === 0 ? x : a === 1 ? y : z) - p[i * 3 + a];
      if (diff < r) visit(lo, mid);
      if (diff > -r) visit(mid + 1, hi);
    };
    visit(0, order.length);
  }
}
