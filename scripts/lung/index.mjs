// 肺区域（S1〜S10）の形を、Z-Anatomy の部品として使えるようにする
// （scripts/za/index.mjs の loadZa から使う。部品ID は ZL_…、名前は "right apical segment of lung (s1)" のように左右を前に書く）。
// 形は scripts/lung/lung.py が data-raw/lung/parts.json に書く（Z-Anatomy の肺葉の中を、区域気管支・区域動脈にいちばん近いかで分けたもの。
// 肺葉の形をもとにするので CC BY-SA 4.0 として Z-Anatomy の GLB に入れる）。作り直し方:
//   node scripts/lung/export.mjs && python3 scripts/lung/lung.py
// 壁側胸膜と胸膜洞も同じく scripts/lung/pleura.py が data-raw/lung/pleura.json に書く（python3 scripts/lung/pleura.py）。
// ボクセルから作った面は点が多いので、読むときに 0.2mm のずれまで減らす。
import fs from "node:fs";
import path from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";
import { vertexNormals } from "../za/read.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const LUNG_PARTS = path.join(ROOT, "data-raw/lung/parts.json");
export const PLEURA_PARTS = path.join(ROOT, "data-raw/lung/pleura.json");
const ERROR = 0.0002;

/** 返り値: { names: 部品ID → 名前, has(id), mesh(id) }。parts.json が無ければ空（語がこの部品を使っていれば build-models が止まる） */
export async function loadLung() {
  if (!fs.existsSync(LUNG_PARTS)) {
    console.warn(`${path.relative(ROOT, LUNG_PARTS)} がありません（肺区域）。node scripts/lung/export.mjs と python3 scripts/lung/lung.py で作ります`);
    return { names: new Map(), has: () => false, mesh: () => null };
  }
  await MeshoptSimplifier.ready;
  const { parts } = JSON.parse(fs.readFileSync(LUNG_PARTS, "utf8"));
  // 壁側胸膜と胸膜洞（scripts/lung/pleura.py。部品ID は ZP_…）
  if (fs.existsSync(PLEURA_PARTS)) parts.push(...JSON.parse(fs.readFileSync(PLEURA_PARTS, "utf8")).parts);
  else console.warn(`${path.relative(ROOT, PLEURA_PARTS)} がありません（胸膜）。python3 scripts/lung/pleura.py で作ります`);
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
