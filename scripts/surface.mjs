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
