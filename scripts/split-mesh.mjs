// 形を平面で2つに分ける（scripts/build-models.mjs の CUTS と scripts/za/index.mjs の ZA_CUTS が使う）。
// 近い目印の形ごとに分ける partitionMesh は build-models.mjs の PARTITIONS が使う。
/** 形を平面で切る。返り値 { above, below }（三角形を切り口で割り、切り口は扇形でふさぐ） */
export function splitMesh(mesh, normal, d) {
  const P = mesh.positions, N = mesh.normals, I = mesh.indices;
  const side = (i) => P[i * 3] * normal[0] + P[i * 3 + 1] * normal[1] + P[i * 3 + 2] * normal[2] - d;
  const pieces = { above: { p: [], n: [], tri: [], map: new Map() }, below: { p: [], n: [], tri: [], map: new Map() } };
  const vertex = (piece, key, pos, nor) => {
    let index = piece.map.get(key);
    if (index === undefined) {
      index = piece.p.length / 3;
      piece.map.set(key, index);
      piece.p.push(...pos);
      piece.n.push(...nor);
    }
    return index;
  };
  const original = (i) => [`v${i}`, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]];
  const crossing = (a, b) => {
    const [i, j] = a < b ? [a, b] : [b, a];
    const t = side(i) / (side(i) - side(j));
    const pos = [0, 1, 2].map((k) => P[i * 3 + k] + t * (P[j * 3 + k] - P[i * 3 + k]));
    const nor = [0, 1, 2].map((k) => N[i * 3 + k] + t * (N[j * 3 + k] - N[i * 3 + k]));
    const length = Math.hypot(...nor) || 1;
    // 同じ位置の頂点が法線ちがいで別の番号のこともあるので、切った点は位置で見分ける（切り口の輪がつながるように）
    return [`e${pos.map((v) => v.toFixed(6)).join(",")}`, pos, nor.map((v) => v / length)];
  };
  const segments = [];
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]];
    const up = v.map((i) => side(i) >= 0);
    const count = up.filter(Boolean).length;
    if (count === 3 || count === 0) {
      const piece = count ? pieces.above : pieces.below;
      piece.tri.push(...v.map((i) => vertex(piece, ...original(i))));
      continue;
    }
    // 1つだけ反対側にある頂点 L から回して (L, V1, V2) にする（向きを保つ）
    const lone = up.findIndex((u) => u === (count === 1));
    const [L, V1, V2] = [v[lone], v[(lone + 1) % 3], v[(lone + 2) % 3]];
    const [lonePiece, otherPiece] = count === 1 ? [pieces.above, pieces.below] : [pieces.below, pieces.above];
    const c1 = crossing(L, V1), c2 = crossing(L, V2);
    lonePiece.tri.push(vertex(lonePiece, ...original(L)), vertex(lonePiece, ...c1), vertex(lonePiece, ...c2));
    const [a, b, c, e] = [vertex(otherPiece, ...c1), vertex(otherPiece, ...original(V1)), vertex(otherPiece, ...original(V2)), vertex(otherPiece, ...c2)];
    otherPiece.tri.push(a, b, c, a, c, e);
    segments.push([c1, c2]);
  }
  // 切り口の輪: 切った点（辺ごとに1つ）を線分でつなぎ、輪ごとに中心から扇形でふさぐ
  const points = new Map(), links = new Map();
  for (const [a, b] of segments) {
    if (a[0] === b[0]) continue;
    for (const [x, y] of [[a, b], [b, a]]) {
      points.set(x[0], x[1]);
      if (!links.has(x[0])) links.set(x[0], []);
      links.get(x[0]).push(y[0]);
    }
  }
  const used = new Set();
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const loop = [start];
    used.add(start);
    for (let next = links.get(start).find((k) => !used.has(k)); next; next = links.get(next).find((k) => !used.has(k))) {
      loop.push(next);
      used.add(next);
    }
    if (loop.length < 3) continue;
    const center = [0, 1, 2].map((k) => loop.reduce((sum, key) => sum + points.get(key)[k], 0) / loop.length);
    for (const [piece, outward] of [[pieces.above, normal.map((v) => -v)], [pieces.below, normal]]) {
      const c = vertex(piece, `center${start}`, center, outward);
      for (let i = 0; i < loop.length; i++) {
        const p = points.get(loop[i]), q = points.get(loop[(i + 1) % loop.length]);
        const a = vertex(piece, `cap${loop[i]}`, p, outward), b = vertex(piece, `cap${loop[(i + 1) % loop.length]}`, q, outward);
        // 面の表（反時計回り）が外を向くように並べる
        const u = p.map((v, k) => v - center[k]), w = q.map((v, k) => v - center[k]);
        const face = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        if (face[0] * outward[0] + face[1] * outward[1] + face[2] * outward[2] >= 0) piece.tri.push(c, a, b);
        else piece.tri.push(c, b, a);
      }
    }
  }
  const finish = (piece) => {
    const positions = new Float32Array(piece.p);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], positions[i]);
    }
    return { positions, normals: new Float32Array(piece.n), indices: new Uint32Array(piece.tri), bounds: [lo, hi] };
  };
  return { above: finish(pieces.above), below: finish(pieces.below) };
}

/** 三角形の上に約 step（m）おきに点を置く（近い形を探す目印） */
function surfaceSamples(mesh, step = 0.0015) {
  const P = mesh.positions, I = mesh.indices, out = [];
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
    const edge = Math.max(...[[a, b], [b, c], [c, a]].map(([i, j]) => Math.hypot(P[i] - P[j], P[i + 1] - P[j + 1], P[i + 2] - P[j + 2])));
    const n = Math.max(1, Math.ceil(edge / step));
    for (let i = 0; i <= n; i++) {
      for (let j = 0; i + j <= n; j++) {
        const [u, v] = [i / n, j / n];
        out.push([0, 1, 2].map((k) => P[a + k] * (1 - u - v) + P[b + k] * u + P[c + k] * v));
      }
    }
  }
  return out;
}

/**
 * 形を、2つの目印の形（guides）の近い方で分ける（build-models.mjs の PARTITIONS）。頂点ごとに「目印0までの距離 − 目印1までの距離」を求め、
 * となりとの平均で数回ならしてから、その値が 0 になる所で三角形を切る（境目がぎざぎざにならず、なめらかな線になる）。
 * 切り口はふさがない（殻の形を2つの面に分けるため）。bias（m）だけ境目を目印0の側へ寄せる。返り値は guides と同じ順の形の配列
 */
export function partitionMesh(mesh, guides, bias = 0) {
  if (guides.length !== 2) throw new Error("partitionMesh の目印は2つ");
  const P = mesh.positions, I = mesh.indices, N = mesh.normals;
  const CELL = 0.006;
  const key = (x, y, z) => `${x},${y},${z}`;
  const grids = guides.map((guide) => {
    const grid = new Map();
    for (const p of surfaceSamples(guide)) {
      const k = key(...p.map((v) => Math.floor(v / CELL)));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
    }
    return grid;
  });
  const distance = (grid, q) => {
    const c = q.map((v) => Math.floor(v / CELL));
    let best = Infinity;
    for (let r = 0; r < 60 && (r - 1) * CELL < best; r++) {
      for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
        if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue;
        for (const p of grid.get(key(c[0] + x, c[1] + y, c[2] + z)) ?? []) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      }
    }
    return best;
  };
  const count = P.length / 3;
  let value = Float64Array.from({ length: count }, (_, i) => {
    const q = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    return distance(grids[0], q) - distance(grids[1], q) + bias;
  });
  // となり（同じ位置の頂点も同じ点として数える）との平均でならす
  const position = new Map();
  const same = Array.from({ length: count }, (_, i) => {
    const k = `${P[i * 3].toFixed(6)},${P[i * 3 + 1].toFixed(6)},${P[i * 3 + 2].toFixed(6)}`;
    if (!position.has(k)) position.set(k, position.size);
    return position.get(k);
  });
  const links = Array.from({ length: position.size }, () => new Set());
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { links[same[I[t + e]]].add(same[I[t + (e + 1) % 3]]); links[same[I[t + (e + 1) % 3]]].add(same[I[t + e]]); }
  let merged = new Float64Array(position.size);
  for (let i = 0; i < count; i++) merged[same[i]] = value[i];
  for (let round = 0; round < 12; round++) {
    merged = merged.map((own, i) => {
      let sum = 0;
      for (const j of links[i]) sum += merged[j];
      return links[i].size ? 0.5 * own + 0.5 * (sum / links[i].size) : own;
    });
  }
  value = Float64Array.from({ length: count }, (_, i) => merged[same[i]]);
  // 値が負（目印0に近い）を pieces[0]、正を pieces[1] へ。符号のまたがる三角形は 0 の所で切る
  const pieces = [0, 1].map(() => ({ p: [], n: [], tri: [], map: new Map() }));
  const vertex = (piece, k, pos, nor) => {
    let index = piece.map.get(k);
    if (index === undefined) {
      index = piece.p.length / 3;
      piece.map.set(k, index);
      piece.p.push(...pos);
      piece.n.push(...nor);
    }
    return index;
  };
  const original = (i) => [`v${i}`, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]];
  const crossing = (a, b) => {
    const [i, j] = a < b ? [a, b] : [b, a];
    const t = value[i] / (value[i] - value[j]);
    const pos = [0, 1, 2].map((k) => P[i * 3 + k] + t * (P[j * 3 + k] - P[i * 3 + k]));
    const nor = [0, 1, 2].map((k) => N[i * 3 + k] + t * (N[j * 3 + k] - N[i * 3 + k]));
    const length = Math.hypot(...nor) || 1;
    return [`e${i},${j}`, pos, nor.map((v) => v / length)];
  };
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]];
    const side = v.map((i) => (value[i] >= 0 ? 1 : 0));
    const ones = side[0] + side[1] + side[2];
    if (ones === 0 || ones === 3) {
      const piece = pieces[side[0]];
      piece.tri.push(...v.map((i) => vertex(piece, ...original(i))));
      continue;
    }
    // 1つだけ反対側にある頂点 L から回して (L, V1, V2) にする（向きを保つ）
    const lone = side.findIndex((s) => s === (ones === 1 ? 1 : 0));
    const [L, V1, V2] = [v[lone], v[(lone + 1) % 3], v[(lone + 2) % 3]];
    const [lonePiece, otherPiece] = ones === 1 ? [pieces[1], pieces[0]] : [pieces[0], pieces[1]];
    const c1 = crossing(L, V1), c2 = crossing(L, V2);
    lonePiece.tri.push(vertex(lonePiece, ...original(L)), vertex(lonePiece, ...c1), vertex(lonePiece, ...c2));
    const [a, b, c, e] = [vertex(otherPiece, ...c1), vertex(otherPiece, ...original(V1)), vertex(otherPiece, ...original(V2)), vertex(otherPiece, ...c2)];
    otherPiece.tri.push(a, b, c, a, c, e);
  }
  return pieces.map((piece) => {
    const positions = new Float32Array(piece.p);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], positions[i]);
    }
    return { positions, normals: new Float32Array(piece.n), indices: new Uint32Array(piece.tri), bounds: [lo, hi] };
  });
}
