// Z-Anatomy の形を、BodyParts3D の骨に合わせた位置で使えるようにする（scripts/build-models.mjs から使う）。
// 骨の組ごとの合わせ込み（ICP）は時間がかかるので data-raw/z-anatomy/anchors.json に覚えておく。
// 合わせ方を変えたら VERSION を上げる。
import fs from "node:fs";
import path from "node:path";
import { splitMesh } from "../split-mesh.mjs";
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
// 前から見て腹直筋（同じ側）と重なる所＝腹直筋鞘になる腱膜を切り取る（by）。
// BodyParts3D の総頚動脈・内頚静脈は頚の下の方で終わっているので、Z-Anatomy の同じ血管の、BodyParts3D の上端より上だけを足す（above）。
const CLIP = [
  { mesh: /^(internal abdominal oblique|transversus abdominis) muscle$/, by: "rectus abdominis muscle" },
  { mesh: /^(common carotid artery|internal jugular vein)$/, above: true },
];
// Z-Anatomy で1つの形になっているものを平面で分ける（書き方は build-models.mjs の CUTS と同じ。mesh は Z-Anatomy の名前）。
// 平面の下側（normal・p < d）が "<ID>-<slug>"（名前は name）になり、上側は元のIDのまま。骨に合わせて動かしたあとの形を切る。
const ZA_CUTS = [
  // 咽頭口部は口腔（舌と口蓋の間の空間）まで1つの形。口峡（口蓋舌弓）のあたりで前後に分け、前を口腔とする
  { mesh: "oropharynx", slug: "oral", name: "oral cavity", normal: [0, 0, -1], d: -0.12 },
];
// BodyParts3D の肋軟骨は第1〜第7だけで、第8〜第10肋骨の前端が宙に浮く（肋骨弓が無い）。Z-Anatomy の第8〜第10肋軟骨を使うが、
// 骨に合わせて動かしても第9・第10肋骨の前端と 8〜13mm ずれて離れる。肋骨ごとに「Z-Anatomy の肋骨の前端 → BodyParts3D の肋骨の前端」の
// ずれを求め、BodyParts3D の第7肋軟骨（ずれ 0。第8肋軟骨が付く）との間で距離の重みでなめらかに配って寄せる（軟骨どうしのつながりも保つ）
const ARCH = { mesh: /^costal cartilage of (eighth|ninth|tenth) rib$/, ribs: ["seventh", "eighth", "ninth", "tenth"], fixed: "seventh costal cartilage" };
const CELL = 0.004;

/** 肋骨の前端: 最も前（z 最大）の点の周り 8mm の平均 */
function ribTip(positions) {
  let best = 0;
  for (let i = 0; i < positions.length; i += 3) if (positions[i + 2] > positions[best + 2]) best = i;
  const c = [0, 0, 0];
  let k = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.hypot(positions[i] - positions[best], positions[i + 1] - positions[best + 1], positions[i + 2] - positions[best + 2]) > 0.008) continue;
    for (let j = 0; j < 3; j++) c[j] += positions[i + j];
    k++;
  }
  return c.map((v) => v / k);
}
const OVERLAP = 0.004; // above: BodyParts3D の上端より少し下から残してつなげる

function clip(positions, indices, keep) {
  const kept = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const x = (positions[a] + positions[b] + positions[c]) / 3, y = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    if (keep(x, y)) kept.push(indices[t], indices[t + 1], indices[t + 2]);
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
 * bpNames: BodyParts3D の部品ID → 名前、bpMesh: 部品ID → { positions }（骨の合わせ込みに使う。切る前の形＝readWhole）。
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
  const cutOf = new Map(); // 部品ID → [切り方, "above" | "below", 元の部品ID]
  for (const cut of ZA_CUTS) {
    const source = all.find((m) => m.name === cut.mesh);
    if (!source) throw new Error(`Z-Anatomy に切る形「${cut.mesh}」がありません`);
    cutOf.set(source.id, [cut, "above", source.id]);
    cutOf.set(`${source.id}-${cut.slug}`, [cut, "below", source.id]);
    names.set(`${source.id}-${cut.slug}`, cut.name);
  }
  const warped = new Map();
  const mesh = (id) => {
    const [cut, half, sourceId] = cutOf.get(id) ?? [];
    if (!cut) return whole(id);
    if (!warped.has(id)) warped.set(id, { name: names.get(id), ...splitMesh(whole(sourceId), cut.normal, cut.d)[half] });
    return warped.get(id);
  };
  const whole = (id) => {
    const key = `whole:${id}`;
    if (warped.has(key)) return warped.get(key);
    const source = byId.get(id);
    if (!source) throw new Error(`Z-Anatomy に ${id} がありません`);
    let positions = new Float32Array(source.positions.length);
    for (let i = 0; i < positions.length; i += 3) positions.set(warp(source.positions[i], source.positions[i + 1], source.positions[i + 2]), i);
    let indices = source.indices;
    if (ARCH.mesh.test(source.name.replace(/^(right|left) /, ""))) positions = snapToArch(source.side, positions);
    const rule = CLIP.find((c) => c.mesh.test(source.name.replace(/^(right|left) /, "")));
    if (rule?.by) {
      const by = mesh(all.find((m) => m.name === (source.side ? `${source.side} ${rule.by}` : rule.by)).id).positions;
      const covered = new Set();
      for (let i = 0; i < by.length; i += 3) {
        const cx = Math.floor(by[i] / CELL), cy = Math.floor(by[i + 1] / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) covered.add(`${cx + dx},${cy + dy}`);
      }
      ({ positions, indices } = clip(positions, indices, (x, y) => !covered.has(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`)));
    }
    if (rule?.above) {
      // 同じ側・同じ名前の BodyParts3D の部品（左の総頚動脈は Z-Anatomy では名前の頭に left が付く）
      const target = source.name.toLowerCase();
      const [bpId] = [...bpNames].find(([, name]) => name.toLowerCase() === target) ?? [];
      if (!bpId) throw new Error(`BodyParts3D に ${source.name} がありません`);
      const top = bpMesh(bpId).bounds[1][1] - OVERLAP;
      ({ positions, indices } = clip(positions, indices, (x, y) => y > top));
    }
    indices = orient(positions, indices);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], positions[i]);
    }
    const result = { name: source.name, positions, normals: vertexNormals(positions, indices), indices, bounds: [lo, hi] };
    warped.set(key, result);
    return result;
  };
  // ARCH: 肋骨の前端のずれ（と第7肋軟骨のずれ 0）を、距離の2乗の逆数の重みで混ぜて軟骨の点を動かす
  const archAnchors = new Map();
  const bpByName = new Map([...bpNames].map(([id, name]) => [name.toLowerCase(), id]));
  const snapToArch = (side, positions) => {
    if (!archAnchors.has(side)) {
      const anchors = [];
      for (const n of ARCH.ribs) {
        const za = all.find((m) => m.name === `${side} ${n} rib`);
        const bp = bpByName.get(`${side} ${n} rib`);
        if (!za || !bp) throw new Error(`肋骨弓: ${side} ${n} rib がありません`);
        const from = ribTip(whole(za.id).positions), to = ribTip(bpMesh(bp).positions);
        anchors.push([from, to.map((v, k) => v - from[k])]);
      }
      archAnchors.set(side, { anchors, fixed: bpMesh(bpByName.get(`${side} ${ARCH.fixed}`)).positions });
    }
    const { anchors, fixed } = archAnchors.get(side);
    const out = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const shift = [0, 0, 0];
      // 第7肋軟骨は、いちばん近い点を1つの「ずれ 0」として数える（点の数で重みが増えないように）
      let near = Infinity;
      for (let j = 0; j < fixed.length; j += 3) near = Math.min(near, Math.hypot(positions[i] - fixed[j], positions[i + 1] - fixed[j + 1], positions[i + 2] - fixed[j + 2]));
      let sw = 1 / (near ** 2 + 1e-6);
      for (const [p, d] of anchors) {
        const w = 1 / (Math.hypot(positions[i] - p[0], positions[i + 1] - p[1], positions[i + 2] - p[2]) ** 2 + 1e-6);
        for (let k = 0; k < 3; k++) shift[k] += d[k] * w;
        sw += w;
      }
      for (let k = 0; k < 3; k++) out[i + k] = positions[i + k] + shift[k] / sw;
    }
    return out;
  };
  return { names, mesh, all, pairs };
}
