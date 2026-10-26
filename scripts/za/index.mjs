// Z-Anatomy の形を、BodyParts3D の骨に合わせた位置で使えるようにする（scripts/build-models.mjs から使う）。
// 骨の組ごとの合わせ込み（ICP）は時間がかかるので data-raw/z-anatomy/anchors.json に覚えておく。
// 合わせ方を変えたら VERSION を上げる。
import fs from "node:fs";
import path from "node:path";
import { readZaFile, vertexNormals, ZA_DIR, ZA_FILES } from "./read.mjs";
import { anchorPairs, icp, makeWarp } from "./warp.mjs";

const VERSION = 1;
const CACHE = path.join(ZA_DIR, "anchors.json");

function concat(meshes) {
  const out = new Float32Array(meshes.reduce((sum, m) => sum + m.positions.length, 0));
  let offset = 0;
  for (const m of meshes) {
    out.set(m.positions, offset);
    offset += m.positions.length;
  }
  return out;
}

// 面の向きをそろえる（中身の体積が負なら裏返しなので、三角形の順を入れかえる）
function orient(positions, indices) {
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    volume += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  if (volume >= 0) return indices;
  const flipped = new Uint32Array(indices);
  for (let t = 0; t < flipped.length; t += 3) [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]];
  return flipped;
}

// Z-Anatomy の内腹斜筋・腹横筋は腱膜まで1つの形で、腹直筋の前をおおってしまう（アプリで腹直筋が見えず、タップもできない）。
// 前から見て腹直筋（同じ側）と重なる所＝腹直筋鞘になる腱膜を切り取る。
const CLIP = [{ mesh: /^(internal abdominal oblique|transversus abdominis) muscle$/, by: "rectus abdominis muscle" }];
const CELL = 0.004;

function clip(positions, indices, by) {
  const covered = new Set();
  for (let i = 0; i < by.length; i += 3) {
    const cx = Math.floor(by[i] / CELL), cy = Math.floor(by[i + 1] / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) covered.add(`${cx + dx},${cy + dy}`);
  }
  const kept = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const x = (positions[a] + positions[b] + positions[c]) / 3, y = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    if (!covered.has(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`)) kept.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  // 使わなくなった頂点を詰める
  const remap = new Map();
  const out = [];
  const tri = kept.map((i) => {
    if (!remap.has(i)) {
      remap.set(i, remap.size);
      out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    return remap.get(i);
  });
  return { positions: new Float32Array(out), indices: new Uint32Array(tri) };
}

/**
 * bpNames: BodyParts3D の部品ID → 名前、bpMesh: 部品ID → { positions }。
 * 返り値: { names: 部品ID → 名前, mesh(id): 骨に合わせた形, all: 読んだ形すべて（合わせ込み前）, pairs: 合わせた骨の組 }
 */
export async function loadZa(bpNames, bpMesh) {
  const all = [];
  const ids = new Set();
  for (const file of ZA_FILES) all.push(...(await readZaFile(file, ids)));
  const pairs = anchorPairs(all, bpNames);
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : null;
  const known = cache?.version === VERSION ? cache.pairs : {};
  const saved = {};
  for (const pair of pairs) {
    const key = `${pair.za.id}>${pair.bp.join("+")}`;
    if (!known[key]) {
      const { T, rms } = icp(pair.za.positions, concat(pair.bp.map(bpMesh)));
      known[key] = { T, rms };
    }
    pair.T = known[key].T;
    saved[key] = known[key];
  }
  fs.writeFileSync(CACHE, `${JSON.stringify({ version: VERSION, pairs: saved })}\n`);
  const warp = makeWarp(pairs);

  const byId = new Map(all.map((m) => [m.id, m]));
  const names = new Map(all.map((m) => [m.id, m.name]));
  const warped = new Map();
  const mesh = (id) => {
    if (warped.has(id)) return warped.get(id);
    const source = byId.get(id);
    if (!source) throw new Error(`Z-Anatomy に ${id} がありません`);
    let positions = new Float32Array(source.positions.length);
    for (let i = 0; i < positions.length; i += 3) positions.set(warp(source.positions[i], source.positions[i + 1], source.positions[i + 2]), i);
    let indices = source.indices;
    const rule = CLIP.find((c) => c.mesh.test(source.name.replace(/^(right|left) /, "")));
    if (rule) {
      const by = all.find((m) => m.name === (source.side ? `${source.side} ${rule.by}` : rule.by));
      ({ positions, indices } = clip(positions, indices, mesh(by.id).positions));
    }
    indices = orient(positions, indices);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], positions[i]);
    }
    const result = { name: source.name, positions, normals: vertexNormals(positions, indices), indices, bounds: [lo, hi] };
    warped.set(id, result);
    return result;
  };
  return { names, mesh, all, pairs };
}
