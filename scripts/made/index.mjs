// BodyParts3D（と NasalSeg）の形だけから作った部品（緻密なモデル その3）を、BodyParts3D の部品として使えるようにする
// （scripts/build-models.mjs の readElements から使う。CC BY 4.0 のまま BodyParts3D の GLB に入る）。
// - 眼球の中（EY_…、scripts/eye/）: 瞳孔・後眼房・黄斑・中心窩・視神経円板
// - 喉頭の中（LX_…、scripts/larynx/）: 声帯ひだ・前庭ひだ・声門裂・喉頭室・声門下腔
// - 鼻中隔と硬口蓋（PL_…、scripts/palate/）: 鼻中隔・硬口蓋の粘膜と、それを除いた上の歯肉
// BodyParts3D の部品と同じ名前の部品（上の歯肉・眼球の中で切りそろえた視神経）は、その名前の BodyParts3D の部品をすべて置きかえる（readElements）。
// 作り直し方: node scripts/<eye|larynx|palate>/export.mjs && python3 scripts/<eye|larynx|palate>/<eye|larynx|palate>.py
// ボクセルから作った面は点が多いので、読むときに ERROR（m）のずれまで減らす。
import fs from "node:fs";
import path from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";
import { vertexNormals } from "../za/read.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SETS = [
  { file: "data-raw/eye/parts.json", error: 0.00002, nerve: 0.00006 },
  { file: "data-raw/larynx/parts.json", error: 0.00004 },
  { file: "data-raw/palate/parts.json", error: 0.00008 },
];
/** GLB に書くときの形の減らし方（m）。眼の板と喉頭の粘膜は薄いので、系統の決まり（0.1mm）より細かくする。ほかは null */
export function madeDetail(id) {
  if (id.startsWith("EY_optic_nerve")) return null;
  if (id.startsWith("EY_")) return 0.00002;
  if (id.startsWith("LX_")) return 0.00003;
  return null;
}

let ready = false;
MeshoptSimplifier.ready.then(() => { ready = true; });
let parts = null;
function read() {
  if (parts !== null) return parts;
  parts = [];
  for (const set of SETS) {
    const file = path.join(ROOT, set.file);
    if (!fs.existsSync(file)) {
      console.warn(`${set.file} がありません（緻密なモデル その3）。scripts/made/index.mjs の作り直し方で作ります`);
      continue;
    }
    for (const p of JSON.parse(fs.readFileSync(file, "utf8")).parts) parts.push({ ...p, error: p.id.startsWith("EY_optic_nerve") ? set.nerve : set.error });
  }
  return parts;
}

/** 部品ID → 名前（parts.json が無ければその分は空） */
export function madeNames() {
  return new Map(read().map((p) => [p.id, p.name]));
}

/** 部品ID → 形（{ name, positions, normals, indices, bounds }。m） */
export function loadMade() {
  const byId = new Map(read().map((p) => [p.id, p]));
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const part = byId.get(id);
    if (!part) throw new Error(`部品 ${id} がありません`);
    const full = new Float32Array(part.positions);
    let positions = full;
    let indices = new Uint32Array(part.indices);
    if (ready) {
      const [simple] = MeshoptSimplifier.simplify(indices, full, 3, 0, part.error, ["ErrorAbsolute"]);
      const [remap, count] = MeshoptSimplifier.compactMesh(simple);
      positions = new Float32Array(count * 3);
      for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) positions.set(full.subarray(i * 3, i * 3 + 3), remap[i] * 3);
      indices = new Uint32Array(simple);
    }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], positions[i]);
    }
    const result = { name: part.name, positions, normals: vertexNormals(positions, indices), indices, bounds: [lo, hi] };
    cache.set(id, result);
    return result;
  };
}
