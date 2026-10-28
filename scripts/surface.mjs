// 3Dの見た目のために、形を減らし、頂点ごとの値を求める（scripts/build-models.mjs から使う）。
//  ao     くぼみ・すき間の暗さ（0〜1。1＝周りにさえぎる物が無い）。同じ GLB の形すべてに向けて光線を飛ばして求める
//  fiber  筋線維・神経の走る向き（長さ＝線維の見え方の強さ。0 なら線維を描かない）。アプリのシェーダーが向きにそろった筋を描く
import { BufferAttribute, BufferGeometry, FrontSide, Ray } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { MeshoptSimplifier } from "meshoptimizer";
import { KdTree } from "./za/kdtree.mjs";
import { vertexNormals } from "./za/read.mjs";

/**
 * 形を減らす。error は許すずれ（m）。細かい凹凸のある骨には三角形が多く残り、なめらかな内臓・血管は少なくなる。
 * ratio を書くと、error は形の大きさに対する割合で、三角形を ratio の割合までしか減らさない（皮膚の輪郭用）。
 * 返り値は使う頂点だけに詰めた形
 */
export function simplify(mesh, { ratio, error }) {
  const [indices] = ratio
    ? MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(mesh.indices), mesh.positions, 3, mesh.normals, 3, [0.5, 0.5, 0.5], null,
      Math.floor((mesh.indices.length / 3) * ratio) * 3, error, [])
    : MeshoptSimplifier.simplify(new Uint32Array(mesh.indices), mesh.positions, 3, 0, error, ["ErrorAbsolute"]);
  const [remap, count] = MeshoptSimplifier.compactMesh(indices);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < remap.length; i++) {
    const j = remap[i];
    if (j === 0xffffffff) continue;
    positions.set(mesh.positions.subarray(i * 3, i * 3 + 3), j * 3);
    normals.set(mesh.normals.subarray(i * 3, i * 3 + 3), j * 3);
  }
  return { ...mesh, positions, normals, indices };
}

function normalize(v, i) {
  const l = Math.hypot(v[i], v[i + 1], v[i + 2]) || 1;
  v[i] /= l;
  v[i + 1] /= l;
  v[i + 2] /= l;
}

/** 頂点のとなり（三角形の辺でつながる頂点） */
function neighbors(indices, count) {
  const sets = Array.from({ length: count }, () => new Set());
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      sets[a].add(b);
      sets[b].add(a);
    }
  }
  return sets.map((set) => [...set]);
}

/** 頂点の値を、となりとの平均で rounds 回ならす（size は1頂点の値の数） */
function smooth(values, size, links, rounds) {
  let a = values;
  for (let r = 0; r < rounds; r++) {
    const b = new Float32Array(a.length);
    for (let i = 0; i < links.length; i++) {
      for (let k = 0; k < size; k++) {
        let sum = a[i * size + k] * 2;
        for (const j of links[i]) sum += a[j * size + k];
        b[i * size + k] = sum / (links[i].length + 2);
      }
    }
    a = b;
  }
  return a;
}

/**
 * 形の細かいでこぼこ（元データの粗い三角形の角）をならす（Taubin の方法。広げる・縮めるを交互にするので形が縮みにくい）。
 * 法線は計算し直し、元の法線と逆を向いたものは裏返す（三角形の巻き方向がそろっていない形のため）
 */
export function relax(mesh, rounds = 6) {
  const count = mesh.positions.length / 3;
  const links = neighbors(mesh.indices, count);
  let p = new Float32Array(mesh.positions);
  for (let r = 0; r < rounds * 2; r++) {
    const f = r % 2 ? -0.53 : 0.5;
    const next = new Float32Array(p);
    for (let i = 0; i < count; i++) {
      const n = links[i].length;
      if (!n) continue;
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (const j of links[i]) sum += p[j * 3 + k];
        next[i * 3 + k] += f * (sum / n - p[i * 3 + k]);
      }
    }
    p = next;
  }
  const normals = vertexNormals(p, mesh.indices);
  for (let i = 0; i < count; i++) {
    const d = normals[i * 3] * mesh.normals[i * 3] + normals[i * 3 + 1] * mesh.normals[i * 3 + 1] + normals[i * 3 + 2] * mesh.normals[i * 3 + 2];
    if (d < 0) for (let k = 0; k < 3; k++) normals[i * 3 + k] *= -1;
  }
  return { ...mesh, positions: p, normals };
}

/** 法線を軸に余弦の重みで散らした向き（黄金角で並べる）。[x, y, z]（z が法線の向き） */
function hemisphere(count) {
  const dirs = [];
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.5) / count);
    const phi = i * 2.399963229728653;
    dirs.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - r * r)]);
  }
  return dirs;
}

/**
 * くぼみ・すき間の暗さを頂点ごとに求める。targets の頂点から法線の側へ光線を飛ばし、distance（m）の中で
 * occluders の形の表に当たるほど暗くする（遠い所に当たるほど弱く）。形の中から裏に当たったときは数えない
 * （中に入った形＝心臓の内腔など、ふだん見えない形が真っ黒にならないように）。
 */
export function bakeAo(targets, occluders, { distance, rays = 32 }) {
  const vertexCount = occluders.reduce((sum, m) => sum + m.positions.length / 3, 0);
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(occluders.reduce((sum, m) => sum + m.indices.length, 0));
  let vo = 0, io = 0;
  for (const m of occluders) {
    positions.set(m.positions, vo * 3);
    const p = m.positions, n = m.normals;
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t], b = m.indices[t + 1], c = m.indices[t + 2];
      // 三角形の巻き方向を頂点の法線（外向き）にそろえる。表から当たったときだけ「さえぎられた」とするため
      const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
      const wx = p[c * 3] - p[a * 3], wy = p[c * 3 + 1] - p[a * 3 + 1], wz = p[c * 3 + 2] - p[a * 3 + 2];
      const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
      const nx = n[a * 3] + n[b * 3] + n[c * 3], ny = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], nz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2];
      const flip = fx * nx + fy * ny + fz * nz < 0;
      indices[io++] = a + vo;
      indices[io++] = (flip ? c : b) + vo;
      indices[io++] = (flip ? b : c) + vo;
    }
    vo += m.positions.length / 3;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  const bvh = new MeshBVH(geometry);
  const dirs = hemisphere(rays);
  const ray = new Ray();
  return targets.map((m) => {
    const count = m.positions.length / 3;
    const ao = new Float32Array(count);
    const p = m.positions, n = m.normals;
    for (let i = 0; i < count; i++) {
      const nx = n[i * 3], ny = n[i * 3 + 1], nz = n[i * 3 + 2];
      // 向きの決まらない頂点（面積0の三角形だけに付く頂点など）は、さえぎる物なしとする
      if (nx * nx + ny * ny + nz * nz < 0.25) {
        ao[i] = 1;
        continue;
      }
      // 法線に直交する2本の軸。頂点ごとに回して、光線の並びの縞が出ないようにする
      let tx = Math.abs(nx) < 0.9 ? 1 : 0, ty = tx ? 0 : 1, tz = 0;
      const d = tx * nx + ty * ny;
      tx -= d * nx; ty -= d * ny; tz -= d * nz;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      const angle = (i * 0.618034 % 1) * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      [tx, ty, tz, bx, by, bz] = [tx * cos + bx * sin, ty * cos + by * sin, tz * cos + bz * sin, bx * cos - tx * sin, by * cos - ty * sin, bz * cos - tz * sin];
      ray.origin.set(p[i * 3] + nx * 0.0003, p[i * 3 + 1] + ny * 0.0003, p[i * 3 + 2] + nz * 0.0003);
      let blocked = 0;
      for (const [x, y, z] of dirs) {
        ray.direction.set(tx * x + bx * y + nx * z, ty * x + by * y + ny * z, tz * x + bz * y + nz * z);
        const hit = bvh.raycastFirst(ray, FrontSide, 0, distance);
        if (hit) blocked += 1 - hit.distance / distance;
      }
      ao[i] = 1 - blocked / rays;
    }
    return smooth(ao, 1, neighbors(m.indices, count), 2);
  });
}

/** 位置が同じ頂点（法線の違いで分かれた頂点）を1つにまとめた番号。返り値 { weld（頂点 → まとめた番号）, count } */
function weldByPosition(positions) {
  const ids = new Map();
  const weld = new Int32Array(positions.length / 3);
  for (let i = 0; i < weld.length; i++) {
    const key = `${positions[i * 3].toFixed(6)},${positions[i * 3 + 1].toFixed(6)},${positions[i * 3 + 2].toFixed(6)}`;
    if (!ids.has(key)) ids.set(key, ids.size);
    weld[i] = ids.get(key);
  }
  return { weld, count: ids.size };
}

/**
 * 本体から離れた小さなかけら（つながった三角形の集まり）を除く。BodyParts3D には、右の角膜・強膜・脈絡膜の中に
 * 左眼の位置の三角形が数枚入っているような部品がある。見た目には映らないが、語の中心と大きさ（カメラを寄せる先・ラベル・近さ）を狂わせる。
 * 除くのは、三角形が maxTriangles 以下・いちばん大きい集まりの2%未満で、その外接箱から gap（m）より離れたもの。
 */
export function dropStrays(mesh, { maxTriangles = 40, gap = 0.01 } = {}) {
  const { weld, count } = weldByPosition(mesh.positions);
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(weld[idx[t]]);
    parent[find(weld[idx[t + 1]])] = a;
    parent[find(weld[idx[t + 2]])] = a;
  }
  const groups = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const root = find(weld[idx[t]]);
    if (!groups.has(root)) groups.set(root, { triangles: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] });
    const g = groups.get(root);
    g.triangles++;
    for (let e = 0; e < 3; e++) {
      for (let k = 0; k < 3; k++) {
        const v = mesh.positions[idx[t + e] * 3 + k];
        g.lo[k] = Math.min(g.lo[k], v);
        g.hi[k] = Math.max(g.hi[k], v);
      }
    }
  }
  if (groups.size < 2) return mesh;
  const main = [...groups.values()].reduce((a, b) => (b.triangles > a.triangles ? b : a));
  const apart = (g) => Math.max(...[0, 1, 2].map((k) => Math.max(main.lo[k] - g.hi[k], g.lo[k] - main.hi[k]))) > gap;
  const drop = new Set([...groups].filter(([, g]) => g.triangles <= maxTriangles && g.triangles < main.triangles * 0.02 && apart(g)).map(([root]) => root));
  if (!drop.size) return mesh;
  const kept = [];
  for (let t = 0; t < idx.length; t += 3) if (!drop.has(find(weld[idx[t]]))) kept.push(idx[t], idx[t + 1], idx[t + 2]);
  // 使う頂点だけに詰める
  const remap = new Int32Array(mesh.positions.length / 3).fill(-1);
  let n = 0;
  for (const i of kept) if (remap[i] < 0) remap[i] = n++;
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3);
  for (let i = 0; i < remap.length; i++) {
    if (remap[i] < 0) continue;
    positions.set(mesh.positions.subarray(i * 3, i * 3 + 3), remap[i] * 3);
    normals.set(mesh.normals.subarray(i * 3, i * 3 + 3), remap[i] * 3);
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], positions[i]);
  }
  return { ...mesh, positions, normals, indices: new Uint32Array(kept.map((i) => remap[i])), bounds: [lo, hi] };
}

/**
 * 粗い形を細かく、なめらかにする（Loop の細分。1回で三角形が4倍）。BodyParts3D 4.0 の舌・唇・唾液腺のように、
 * 99%減らした版で角張った形の見た目に使う。辺の真ん中に点を足し、元の点はとなりとの平均へ寄せる。
 * 縁の辺（三角形1つだけの辺）と3つ以上の三角形が付く辺は真ん中に点を足すだけで、その端の点は動かさない（縁が縮んで穴が広がらないように。
 * 使う形はどれも閉じているので、縁は折れ線のままでよい）。
 * Loop の細分は元の点を内側へ寄せるので粗い形ほど縮む。最後に元の点を元の位置へ戻し、そのずれを間の点へなめらかに配る
 * （細分した形が元の点を通る）。法線は計算し直し、元の法線と逆を向いたものは裏返す（relax と同じ）
 */
export function subdivide(mesh, levels = 1) {
  const { weld, count } = weldByPosition(mesh.positions);
  // まとめた番号で作り直す（法線で分かれた頂点のすき間が開かないように）
  let positions = new Float32Array(count * 3);
  let reference = new Float32Array(count * 3);
  for (let i = 0; i < weld.length; i++) {
    positions.set(mesh.positions.subarray(i * 3, i * 3 + 3), weld[i] * 3);
    for (let k = 0; k < 3; k++) reference[weld[i] * 3 + k] += mesh.normals[i * 3 + k];
  }
  let indices = Uint32Array.from(mesh.indices, (i) => weld[i]);
  for (let level = 0; level < levels; level++) {
    const n = positions.length / 3;
    const edges = new Map(); // "a,b" → { id（新しい点）, a, b, opposite: [] }
    const edgeOf = (a, b, c) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let e = edges.get(key);
      if (!e) edges.set(key, (e = { id: n + edges.size, a, b, opposite: [] }));
      e.opposite.push(c);
      return e.id;
    };
    const faces = [];
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
      const ab = edgeOf(a, b, c), bc = edgeOf(b, c, a), ca = edgeOf(c, a, b);
      faces.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    const next = new Float32Array((n + edges.size) * 3);
    const p = (i, k) => positions[i * 3 + k];
    // 新しい点: ふつうの辺は 3/8・3/8・1/8・1/8、縁の辺は真ん中
    const sharp = new Set(); // 縁の辺の端の点
    const ring = Array.from({ length: n }, () => new Set());
    for (const e of edges.values()) {
      ring[e.a].add(e.b);
      ring[e.b].add(e.a);
      const smooth = e.opposite.length === 2;
      for (let k = 0; k < 3; k++) {
        next[e.id * 3 + k] = smooth
          ? (3 * (p(e.a, k) + p(e.b, k)) + p(e.opposite[0], k) + p(e.opposite[1], k)) / 8
          : (p(e.a, k) + p(e.b, k)) / 2;
      }
      if (!smooth) sharp.add(e.a).add(e.b);
    }
    // 元の点: となり n 個の平均へ β で寄せる。縁の点は動かさない
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        if (sharp.has(i)) {
          next[i * 3 + k] = p(i, k);
          continue;
        }
        const m = ring[i].size;
        const beta = m === 3 ? 3 / 16 : 3 / (8 * m);
        let sum = 0;
        for (const j of ring[i]) sum += p(j, k);
        next[i * 3 + k] = (1 - m * beta) * p(i, k) + beta * sum;
      }
    }
    // 元の法線は、新しい点には辺の両端の和を引き継ぐ（向きをそろえるためだけに使う）
    const ref = new Float32Array(next.length);
    ref.set(reference);
    for (const e of edges.values()) for (let k = 0; k < 3; k++) ref[e.id * 3 + k] = reference[e.a * 3 + k] + reference[e.b * 3 + k];
    positions = next;
    reference = ref;
    indices = new Uint32Array(faces);
  }
  // 元の点（番号は細分しても 0〜count-1 のまま）のずれを、となりとの平均をくり返して間の点へ配る。
  // 縁の点は縁でとなる点だけから（縁が外へはみ出さないように）
  const total = positions.length / 3;
  const shift = new Float32Array(total * 3);
  for (const [i, j] of weld.entries()) for (let k = 0; k < 3; k++) shift[j * 3 + k] = mesh.positions[i * 3 + k] - positions[j * 3 + k];
  const links = neighbors(indices, total);
  const faceCount = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + ((e + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      faceCount.set(key, (faceCount.get(key) ?? 0) + 1);
    }
  }
  for (let i = count; i < total; i++) {
    const edge = links[i].filter((j) => faceCount.get(i < j ? `${i},${j}` : `${j},${i}`) !== 2);
    if (edge.length) links[i] = edge;
  }
  for (let round = 0; round < 6 * 2 ** levels; round++) {
    for (let i = count; i < total; i++) {
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (const j of links[i]) sum += shift[j * 3 + k];
        shift[i * 3 + k] = sum / links[i].length;
      }
    }
  }
  for (let i = 0; i < positions.length; i++) positions[i] += shift[i];
  const normals = vertexNormals(positions, indices);
  for (let i = 0; i < normals.length; i += 3) {
    if (normals[i] * reference[i] + normals[i + 1] * reference[i + 1] + normals[i + 2] * reference[i + 2] < 0) {
      for (let k = 0; k < 3; k++) normals[i + k] *= -1;
    }
  }
  return { ...mesh, positions, normals, indices };
}

/** 点の並びの主軸（いちばん広がる向き）。共分散行列のべき乗法 */
function principalAxis(points, count, weightOf = () => 1) {
  let cx = 0, cy = 0, cz = 0, w = 0;
  for (let i = 0; i < count; i++) {
    const k = weightOf(i);
    cx += points[i * 3] * k; cy += points[i * 3 + 1] * k; cz += points[i * 3 + 2] * k; w += k;
  }
  cx /= w; cy /= w; cz /= w;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < count; i++) {
    const k = weightOf(i);
    const x = points[i * 3] - cx, y = points[i * 3 + 1] - cy, z = points[i * 3 + 2] - cz;
    xx += x * x * k; xy += x * y * k; xz += x * z * k; yy += y * y * k; yz += y * z * k; zz += z * z * k;
  }
  let v = [0.57, 0.58, 0.57];
  for (let it = 0; it < 30; it++) {
    const next = [xx * v[0] + xy * v[1] + xz * v[2], xy * v[0] + yy * v[1] + yz * v[2], xz * v[0] + yz * v[1] + zz * v[2]];
    const l = Math.hypot(...next) || 1;
    v = next.map((c) => c / l);
  }
  const l1 = xx * v[0] * v[0] + yy * v[1] * v[1] + zz * v[2] * v[2] + 2 * (xy * v[0] * v[1] + xz * v[0] * v[2] + yz * v[1] * v[2]);
  return { axis: v, l1: l1 / w, trace: (xx + yy + zz) / w };
}

/** 向きの場を面に沿わせ（法線の成分を除く）、となりとならして長さ strength にそろえる */
function settle(field, mesh, strength, rounds = 3) {
  const count = mesh.positions.length / 3;
  const n = mesh.normals;
  const tangent = () => {
    for (let i = 0; i < count; i++) {
      const d = field[i * 3] * n[i * 3] + field[i * 3 + 1] * n[i * 3 + 1] + field[i * 3 + 2] * n[i * 3 + 2];
      for (let k = 0; k < 3; k++) field[i * 3 + k] -= d * n[i * 3 + k];
      normalize(field, i * 3);
    }
  };
  tangent();
  // 向きの正負は線維の見え方に関係しないが、ならすときに打ち消し合わないよう、となりの向きにそろえてから平均する
  const links = neighbors(mesh.indices, count);
  for (let r = 0; r < rounds; r++) {
    const next = new Float32Array(field.length);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) next[i * 3 + k] = field[i * 3 + k] * 2;
      for (const j of links[i]) {
        const s = Math.sign(field[i * 3] * field[j * 3] + field[i * 3 + 1] * field[j * 3 + 1] + field[i * 3 + 2] * field[j * 3 + 2]) || 1;
        for (let k = 0; k < 3; k++) next[i * 3 + k] += field[j * 3 + k] * s;
      }
    }
    field.set(next);
    tangent();
  }
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) field[i * 3 + k] *= strength[i];
  return field;
}

/**
 * 筋線維の向き。attach（{ origin: [[x,y,z],…], insertion: […] }、形と同じ側の座標）があれば、
 * 頂点ごとに近い起始の点から近い停止の点への向き（扇形の筋では停止へ集まる向きになる）。無ければ形の主軸の向き。
 */
export function muscleFibers(mesh, attach) {
  const count = mesh.positions.length / 3;
  const p = mesh.positions;
  const field = new Float32Array(count * 3);
  if (attach?.origin.length && attach.insertion.length) {
    // いちばん近い点だけだと、点の境で向きが跳ぶ。近い点ほど重くして混ぜる（1cm で重さが約 1/e）
    const blend = (points, x, y, z) => {
      const d = points.map(([px, py, pz]) => Math.hypot(px - x, py - y, pz - z));
      const min = Math.min(...d);
      let sx = 0, sy = 0, sz = 0, sw = 0;
      for (const [i, [px, py, pz]] of points.entries()) {
        const w = Math.exp(-(((d[i] - min) / 0.01) ** 2));
        sx += px * w; sy += py * w; sz += pz * w; sw += w;
      }
      return [sx / sw, sy / sw, sz / sw];
    };
    for (let i = 0; i < count; i++) {
      const [ox, oy, oz] = blend(attach.origin, p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      const [ix, iy, iz] = blend(attach.insertion, p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      field.set([ix - ox, iy - oy, iz - oz], i * 3);
      normalize(field, i * 3);
    }
  } else {
    const { axis } = principalAxis(p, count);
    for (let i = 0; i < count; i++) field.set(axis, i * 3);
  }
  return settle(field, mesh, new Float32Array(count).fill(1));
}

/**
 * 虹彩のすじ（瞳孔から放射状に走るひだ）の向き。形の中心から外への向きを面に沿わせる。
 * 瞳孔の縁の近く（中心から半径の35%まで）は弱くして、瞳孔のまわりが筋で荒れないようにする
 */
export function radialFibers(mesh) {
  const count = mesh.positions.length / 3;
  const p = mesh.positions;
  const center = [0, 0, 0];
  for (let i = 0; i < p.length; i++) center[i % 3] += p[i] / count;
  const field = new Float32Array(count * 3);
  const strength = new Float32Array(count);
  let reach = 0;
  for (let i = 0; i < count; i++) reach = Math.max(reach, Math.hypot(p[i * 3] - center[0], p[i * 3 + 1] - center[1], p[i * 3 + 2] - center[2]));
  for (let i = 0; i < count; i++) {
    field.set([p[i * 3] - center[0], p[i * 3 + 1] - center[1], p[i * 3 + 2] - center[2]], i * 3);
    const r = Math.hypot(field[i * 3], field[i * 3 + 1], field[i * 3 + 2]);
    normalize(field, i * 3);
    strength[i] = Math.min(1, Math.max(0, (r / reach - 0.35) / 0.2));
  }
  return settle(field, mesh, strength, 1);
}

/**
 * 神経の線維の向き。頂点の周り（radius m）の頂点の並びの主軸を、その場所の神経の走る向きとする。
 * 管のように一方向へ長い所ほど強く、面のように広がる所（神経節のふくらみなど）は弱く描く。
 */
export function nerveFibers(mesh, radius = 0.005) {
  const count = mesh.positions.length / 3;
  const p = mesh.positions;
  const tree = new KdTree(p);
  const field = new Float32Array(count * 3);
  const strength = new Float32Array(count);
  const local = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let m = 0;
    tree.within(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], radius, (j) => {
      if (m < count) local.set(p.subarray(j * 3, j * 3 + 3), (m++) * 3);
    });
    if (m < 6) continue;
    const { axis, l1, trace } = principalAxis(local, m);
    field.set(axis, i * 3);
    // 1本の向きにそろうほど l1 が全体（trace）に近づく
    const t = (l1 / trace - 0.5) / 0.25;
    strength[i] = Math.min(1, Math.max(0, t));
  }
  return settle(field, mesh, smooth(strength, 1, neighbors(mesh.indices, count), 3), 2);
}
