// 心臓の中のつくり（scripts/heart/heart.py が data-raw/heart/parts.json に書く形）を、BodyParts3D の部品として使えるようにする
// （scripts/build-models.mjs の readElements から使う。部品ID は HT_…、名前は BodyParts3D と同じ書き方）。
// BodyParts3D の心臓の形だけから作るので CC BY 4.0 のまま、BodyParts3D の GLB に入れる。作り直し方:
//   node scripts/heart/export.mjs && python3 scripts/heart/heart.py
// parts.json があるときは、元の BodyParts3D の心室の壁（左右に分けたもの）・心房の壁・房室弁の尖を、作り直した形に置きかえる（REPLACES）。
// 0.5mm のボクセルから作った面は点が多いので、読むときに ERROR（薄い殻は SHELL_ERROR）のずれまで減らす。
import fs from "node:fs";
import path from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";
import { vertexNormals } from "../za/read.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const HEART_PARTS = path.join(ROOT, "data-raw/heart/parts.json");
const ERROR = 0.00012;
const SHELL_ERROR = 0.00025;
const SHELLS = /^(epicardium|endocardium|pericardial cavity|fibrous pericardium|parietal layer of serous pericardium)$/i;
// 置きかえる BodyParts3D の部品の名前（小文字）。心室の壁は build-models の PARTITIONS で左右に分けたもの
export const REPLACES = [
  "wall of left ventricle", "wall of right ventricle", "wall of left atrium", "wall of right atrium",
  "anterior leaflet of mitral valve", "posterior leaflet of mitral valve",
  "anterior leaflet of tricuspid valve", "posterior leaflet of tricuspid valve", "septal leaflet of tricuspid valve",
];

let ready = false;
MeshoptSimplifier.ready.then(() => { ready = true; });
let parts = null;
function read() {
  if (parts === null) parts = fs.existsSync(HEART_PARTS) ? JSON.parse(fs.readFileSync(HEART_PARTS, "utf8")).parts : [];
  return parts;
}

/** 部品ID → 名前（parts.json が無ければ空。そのときは BodyParts3D の形のまま） */
export function heartNames() {
  return new Map(read().map((p) => [p.id, p.name]));
}

/** 部品ID → 形（{ name, positions, normals, indices, bounds }。m） */
export function loadHeart() {
  const byId = new Map(read().map((p) => [p.id, p]));
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const part = byId.get(id);
    if (!part) throw new Error(`心臓の部品 ${id} がありません`);
    const full = new Float32Array(part.positions);
    let positions = full;
    let indices = new Uint32Array(part.indices);
    if (ready) {
      const error = SHELLS.test(part.name) ? SHELL_ERROR : ERROR;
      const [simple] = MeshoptSimplifier.simplify(indices, full, 3, 0, error, ["ErrorAbsolute"]);
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
