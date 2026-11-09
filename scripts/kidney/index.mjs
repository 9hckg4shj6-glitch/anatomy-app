// 腎臓の中のつくり（腎皮質・腎柱・腎錐体・腎乳頭・腎洞・腎盤・大腎杯・小腎杯）の形を、Z-Anatomy の部品として使えるようにする
// （scripts/za/index.mjs の loadZa から使う。部品ID は ZK_…、名前は "right renal cortex" のように左右を前に書く）。
// 形は scripts/kidney/kidney.py が data-raw/kidney/parts.json に書く（BodyParts3D の腎臓の中を、Z-Anatomy の腎盤・腎杯の形をもとに分けたもの。
// 腎盤の形をもとにするので CC BY-SA 4.0 として Z-Anatomy の GLB に入れる）。作り直し方:
//   node scripts/kidney/export.mjs && python3 scripts/kidney/kidney.py
// 0.5mm のボクセルから作った面は点が多い（1つの腎臓で約33万点）ので、読むときに 0.15mm のずれまで減らす（なめらかな面なので見た目は変わらない）。
import fs from "node:fs";
import path from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";
import { vertexNormals } from "../za/read.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const KIDNEY_PARTS = path.join(ROOT, "data-raw/kidney/parts.json");
const ERROR = 0.00015;

/** 返り値: { names: 部品ID → 名前, has(id), mesh(id) }。parts.json が無ければ空（語がこの部品を使っていれば build-models が止まる） */
export async function loadKidney() {
  if (!fs.existsSync(KIDNEY_PARTS)) {
    console.warn(`${path.relative(ROOT, KIDNEY_PARTS)} がありません（腎臓の中のつくり）。node scripts/kidney/export.mjs と python3 scripts/kidney/kidney.py で作ります`);
    return { names: new Map(), has: () => false, mesh: () => null };
  }
  await MeshoptSimplifier.ready;
  const { parts } = JSON.parse(fs.readFileSync(KIDNEY_PARTS, "utf8"));
  const byId = new Map(parts.map((p) => [p.id, p]));
  const cache = new Map();
  const mesh = (id) => {
    if (cache.has(id)) return cache.get(id);
    const part = byId.get(id);
    const full = new Float32Array(part.positions);
    const [simple] = MeshoptSimplifier.simplify(new Uint32Array(part.indices), full, 3, 0, ERROR, ["ErrorAbsolute"]);
    const [remap, count] = MeshoptSimplifier.compactMesh(simple);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) positions.set(full.subarray(i * 3, i * 3 + 3), remap[i] * 3);
    const indices = new Uint32Array(simple);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], positions[i]);
    }
    const result = { name: part.name, positions, normals: vertexNormals(positions, indices), indices, bounds: [lo, hi] };
    cache.set(id, result);
    return result;
  };
  return { names: new Map(parts.map((p) => [p.id, p.name])), has: (id) => byId.has(id), mesh };
}
