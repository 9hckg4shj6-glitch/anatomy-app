// 耳の中のつくり（骨迷路を前庭・半規管・総脚・前庭階・鼓室階に分けたものと、膜迷路・前庭窓・蝸牛窓・鼓室・外耳道・耳管の骨部）の形を、
// Z-Anatomy の部品として使えるようにする（scripts/za/index.mjs の loadZa から使う。部品ID は ZE_…、名前は "right utricle" のように左右を前に書く）。
// 形は scripts/ear/ear.py が data-raw/ear/parts.json に書く（Z-Anatomy の蝸牛・前庭の形をもとにするので CC BY-SA 4.0 として Z-Anatomy の GLB に入れる）。
// 作り直し方:
//   node scripts/ear/export.mjs && python3 scripts/ear/ear.py
// 0.1mm のボクセルから作った面は点が多いので、読むときに 0.02mm のずれまで減らす（膜の管は太さ 0.4mm ほどなので、それより細かく）。
import fs from "node:fs";
import path from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";
import { vertexNormals } from "../za/read.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const EAR_PARTS = path.join(ROOT, "data-raw/ear/parts.json");
const ERROR = 0.00002;
// GLB に書くときの形の減らし方（m）。耳の部品は小さいので、系統の決まり（0.1mm）より細かくする
export const EAR_DETAIL = 0.00003;

/** 返り値: { names: 部品ID → 名前, has(id), mesh(id) }。parts.json が無ければ空（語がこの部品を使っていれば build-models が止まる） */
export async function loadEar() {
  if (!fs.existsSync(EAR_PARTS)) {
    console.warn(`${path.relative(ROOT, EAR_PARTS)} がありません（耳の中のつくり）。node scripts/ear/export.mjs と python3 scripts/ear/ear.py で作ります`);
    return { names: new Map(), has: () => false, mesh: () => null };
  }
  await MeshoptSimplifier.ready;
  const { parts } = JSON.parse(fs.readFileSync(EAR_PARTS, "utf8"));
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
