// BodyParts3D 3.0 の細かい形を、4.0 の形に重ねて表示に使う（scripts/build-models.mjs から使う）。
// 4.0 はポリゴンを99%減らした版しか配られていない。3.0 には95%減らした版（約5倍細かい）がある。
// ただし 4.0 では骨格が手直しされ（頭蓋は約5.6%大きく、大腿骨・脛骨は長く）、位置も動いているので、
// 相似変換（scripts/za/warp.mjs の icp）のあと、なめらかな変形で 4.0 の形に重ねる。
// 重ねたあとも 4.0 の形とのずれが大きいもの（筋の多く＝形が作り直された部品）は使わない（4.0 のまま）。
// ピン・付着面・Z-Anatomy の合わせ込みは今までどおり 4.0 の形で計算する。ここは見た目だけを細かくする。
//
// 元データ: https://dbarchive.biosciencedbc.jp/data/bodyparts3d/20110915/BodyParts3D_3.0_obj_95.zip（CC BY-SA 2.1 JP と書かれているが、
// 公式のライセンスページは BodyParts3D 全体を CC BY 4.0 としている）。ファイル名は FMA の概念ID（4.0 の OBJ の "Concept ID"）。
// 結果は data-raw/bp3d-v3/aligned/ に覚える。合わせ方を変えたら VERSION を上げる。
import fs from "node:fs";
import path from "node:path";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { KdTree } from "./za/kdtree.mjs";
import { apply, icp } from "./za/warp.mjs";
import { vertexNormals } from "./za/read.mjs";

const VERSION = 1;
const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "data-raw/bp3d-v3");
const CACHE = path.join(DIR, "aligned");
/** なめらかな変形の広がり（m）。広い所から順に（大腿骨が長くなって伸びた筋なども合うように） */
const SIGMAS = [0.04, 0.02, 0.01, 0.005, 0.0025];
/**
 * 使う条件（m）。back は 4.0 の頂点から重ねた 3.0 の面までの距離（4.0 の形が 3.0 で覆われているか）、
 * there は 3.0 の頂点から 4.0 の面まで（3.0 にだけある出っ張りが無いか。4.0 は粗く角が削れているので緩める）
 */
const LIMIT = { back: { p95: 0.0014, max: 0.0035 }, there: { p95: 0.0016, max: 0.005 } };

function bvhOf(mesh) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  return new MeshBVH(geometry);
}

/** 点の並び → 面までの距離（m）を昇順に */
function distances(points, bvh, step = 1) {
  const p = new Vector3();
  const hit = {};
  const out = [];
  for (let i = 0; i < points.length; i += 3 * step) {
    p.set(points[i], points[i + 1], points[i + 2]);
    bvh.closestPointToPoint(p, hit);
    out.push(hit.distance);
  }
  return out.sort((a, b) => a - b);
}

/**
 * positions（3.0、相似変換で重ねたもの）を、4.0 の形 target の面へ寄せる。
 * 間引いた点（制御点）で「最も近い面の点へのずれ」と「4.0 の頂点から見て最も近い点のずれ」を集め、
 * sigma の広がりでならしてから、すべての頂点に混ぜて動かす。細かい凹凸（3.0 の細かさ）は残り、大きな形だけが 4.0 に合う。
 */
function deform(positions, target, targetBvh) {
  const n = positions.length / 3;
  const out = new Float32Array(positions);
  for (const sigma of SIGMAS) {
    // 制御点: sigma/2 の格子ごとに1点
    const cell = sigma / 2;
    const seen = new Set();
    const control = [];
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(out[i * 3] / cell)},${Math.floor(out[i * 3 + 1] / cell)},${Math.floor(out[i * 3 + 2] / cell)}`;
      if (!seen.has(key)) {
        seen.add(key);
        control.push(i);
      }
    }
    const points = new Float64Array(control.length * 3);
    for (const [k, i] of control.entries()) points.set(out.subarray(i * 3, i * 3 + 3), k * 3);
    const tree = new KdTree(points);
    const sum = new Float64Array(control.length * 3);
    const weight = new Float64Array(control.length);
    const p = new Vector3();
    const hit = {};
    for (let k = 0; k < control.length; k++) {
      p.set(points[k * 3], points[k * 3 + 1], points[k * 3 + 2]);
      targetBvh.closestPointToPoint(p, hit);
      sum[k * 3] += hit.point.x - p.x;
      sum[k * 3 + 1] += hit.point.y - p.y;
      sum[k * 3 + 2] += hit.point.z - p.z;
      weight[k] += 1;
    }
    // 4.0 の頂点から引く（3.0 が届いていない所を広げる）。ずれは最も近い 3.0 の頂点から測り、その頂点に近い制御点に足す
    const t = target.positions;
    const all = new KdTree(out);
    for (let j = 0; j < t.length; j += 3) {
      const [i] = all.nearest(t[j], t[j + 1], t[j + 2]);
      const [k] = tree.nearest(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
      sum[k * 3] += t[j] - out[i * 3];
      sum[k * 3 + 1] += t[j + 1] - out[i * 3 + 1];
      sum[k * 3 + 2] += t[j + 2] - out[i * 3 + 2];
      weight[k] += 1;
    }
    // 制御点のずれを sigma でならす
    const shift = new Float64Array(control.length * 3);
    for (let k = 0; k < control.length; k++) {
      let sx = 0, sy = 0, sz = 0, sw = 0;
      tree.within(points[k * 3], points[k * 3 + 1], points[k * 3 + 2], sigma * 2, (m, d2) => {
        const w = Math.exp(-d2 / (2 * sigma * sigma));
        sx += sum[m * 3] * w; sy += sum[m * 3 + 1] * w; sz += sum[m * 3 + 2] * w; sw += weight[m] * w;
      });
      if (sw) shift.set([sx / sw, sy / sw, sz / sw], k * 3);
    }
    // すべての頂点へ混ぜる
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sz = 0, sw = 0;
      tree.within(out[i * 3], out[i * 3 + 1], out[i * 3 + 2], sigma * 2, (m, d2) => {
        const w = Math.exp(-d2 / (2 * sigma * sigma));
        sx += shift[m * 3] * w; sy += shift[m * 3 + 1] * w; sz += shift[m * 3 + 2] * w; sw += w;
      });
      if (sw) {
        out[i * 3] += sx / sw;
        out[i * 3 + 1] += sy / sw;
        out[i * 3 + 2] += sz / sw;
      }
    }
  }
  return out;
}

/** 三角形の巻き方向を OBJ の法線（外向き）にそろえる（頂点の法線を面の向きから計算し直すため） */
function orient(positions, normals, indices) {
  const out = new Uint32Array(indices);
  const p = positions, n = normals;
  for (let t = 0; t < out.length; t += 3) {
    const a = out[t], b = out[t + 1], c = out[t + 2];
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const wx = p[c * 3] - p[a * 3], wy = p[c * 3 + 1] - p[a * 3 + 1], wz = p[c * 3 + 2] - p[a * 3 + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const nx = n[a * 3] + n[b * 3] + n[c * 3], ny = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], nz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz < 0) [out[t + 1], out[t + 2]] = [c, b];
  }
  return out;
}

/** 3.0 の形を 4.0 の形 target に重ねる。返り値 { positions, indices, back, there }（ずれの95%点と最大） */
function align(source, target) {
  const { T } = icp(source.positions, target.positions);
  const moved = new Float32Array(source.positions.length);
  for (let i = 0; i < moved.length; i += 3) moved.set(apply(T, source.positions[i], source.positions[i + 1], source.positions[i + 2]), i);
  const positions = deform(moved, target, bvhOf(target));
  const there = distances(positions, bvhOf(target), Math.max(1, Math.floor(positions.length / 3 / 20000)));
  const back = distances(target.positions, bvhOf({ positions, indices: source.indices }));
  const q = (list, f) => list[Math.min(list.length - 1, Math.floor(list.length * f))];
  return {
    positions,
    indices: orient(moved, source.normals, source.indices),
    back: { p95: q(back, 0.95), max: back[back.length - 1] },
    there: { p95: q(there, 0.95), max: there[there.length - 1] },
  };
}

/**
 * 3.0 の細かい形を返す関数を作る。hires(部品ID) → { positions, normals, indices, bounds } か null（使えない・3.0 に無い）。
 * parseObj は build-models.mjs の OBJ 読み込み、objDir は 4.0 の OBJ、readWhole(部品ID) は 4.0 の形（切る前）。
 */
export function loadHires({ parseObj, objDir, readWhole }) {
  if (!fs.existsSync(path.join(DIR, "obj"))) {
    console.warn("data-raw/bp3d-v3/obj が無いので、BodyParts3D 4.0 の形をそのまま使います（npm run fetch:sources で取れます）");
    return () => null;
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const indexFile = path.join(CACHE, "index.json");
  const saved = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : null;
  const index = saved?.version === VERSION ? saved.parts : {};
  const memo = new Map();
  const save = () => fs.writeFileSync(indexFile, `${JSON.stringify({ version: VERSION, parts: index }, null, 1)}\n`);
  return (id) => {
    if (memo.has(id)) return memo.get(id);
    let result = null;
    const file = path.join(objDir, `${id}.obj`);
    const concept = fs.existsSync(file) && !id.endsWith("M") ? fs.readFileSync(file, "utf8").slice(0, 1000).match(/# Concept ID : (FMA\d+)/)?.[1] : null;
    const source = concept && path.join(DIR, "obj", `${concept}.obj`);
    if (source && fs.existsSync(source)) {
      const bin = path.join(CACHE, `${id}.bin`);
      // ずれ（mm）は覚えておき、使うかどうかは今の LIMIT で決める。使う形だけをファイルに置く
      const ok = (entry) => ["back", "there"].every((k) => entry[k][0] <= LIMIT[k].p95 * 1000 && entry[k][1] <= LIMIT[k].max * 1000);
      if (!index[id] || (ok(index[id]) && !fs.existsSync(bin))) {
        const fit = align(parseObj(source), readWhole(id));
        const mm = (v) => +(v * 1000).toFixed(2);
        index[id] = { concept, back: [mm(fit.back.p95), mm(fit.back.max)], there: [mm(fit.there.p95), mm(fit.there.max)] };
        if (ok(index[id])) {
          const head = new Uint32Array([fit.positions.length, fit.indices.length]);
          fs.writeFileSync(bin, Buffer.concat([Buffer.from(head.buffer), Buffer.from(fit.positions.buffer), Buffer.from(new Uint32Array(fit.indices).buffer)]));
        }
        save();
      }
      if (ok(index[id]) && fs.existsSync(bin)) {
        const bytes = fs.readFileSync(bin);
        const [np, ni] = new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + 8));
        const positions = new Float32Array(bytes.buffer.slice(bytes.byteOffset + 8, bytes.byteOffset + 8 + np * 4));
        const indices = new Uint32Array(bytes.buffer.slice(bytes.byteOffset + 8 + np * 4, bytes.byteOffset + 8 + np * 4 + ni * 4));
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < positions.length; i++) {
          lo[i % 3] = Math.min(lo[i % 3], positions[i]);
          hi[i % 3] = Math.max(hi[i % 3], positions[i]);
        }
        result = { positions, normals: vertexNormals(positions, indices), indices, bounds: [lo, hi] };
      }
    }
    memo.set(id, result);
    return result;
  };
}
