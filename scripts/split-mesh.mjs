// 形を平面で2つに分ける（scripts/build-models.mjs の CUTS と scripts/za/index.mjs の ZA_CUTS が使う）。
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
