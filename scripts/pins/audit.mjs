// 骨・器官の部位のピン（content/pins.json）の点検。表面には乗っていても「反対の面」に落ちた点や、稜の列から外れた点を見つける。
// 形はピンを決めた形（BodyParts3D 4.0。Z-Anatomy の形の語はそれ）。左右に折り返さないピン（one）は見ない。
// 使い方: node scripts/pins/audit.mjs [語ID,語ID]
//   far      点からいちばん近い表面までが 半径＋1mm より遠い（球が表面にかからない）
//   against  いちばん近い表面の向きが n と逆（n の面だけを塗るので、その点はほとんど塗られない）
//   zig      点の列（3点以上）で、内側の点が両隣の中点から 6mm 以上ずれる（稜・線の列から外れた点）。
//            骨を一周する部位（v）と、広い範囲を球で埋める部位（半径 12mm 以上）は見ない
import fs from "node:fs";
import path from "node:path";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { loadDb, db, termMeshes, usesZa } from "./geometry.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "content/pins.json"), "utf8"));
const only = process.argv[2]?.split(",");
const ids = Object.keys(pins).filter((id) => !pins[id].one && (!only || only.includes(id)));
await loadDb({ za: usesZa(ids) });
const byId = new Map(db().terms.map((t) => [t.id, t]));

function surfaces(id) {
  return termMeshes(id, "right").map((m) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(m.positions, 3));
    geometry.setIndex(new BufferAttribute(m.indices, 1));
    return { bvh: new MeshBVH(geometry), positions: m.positions, indices: m.indices };
  });
}

/** 表面でいちばん近い点までの距離と、その三角形の向き */
function closest(list, c) {
  const p = new Vector3(...c);
  let best = null;
  for (const { bvh, positions: q, indices } of list) {
    const hit = {};
    bvh.closestPointToPoint(p, hit);
    if (best && hit.distance >= best.distance) continue;
    const [a, b, d] = [0, 1, 2].map((k) => new Vector3(q[indices[hit.faceIndex * 3 + k] * 3], q[indices[hit.faceIndex * 3 + k] * 3 + 1], q[indices[hit.faceIndex * 3 + k] * 3 + 2]));
    best = { distance: hit.distance, normal: new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a)).normalize() };
  }
  return best;
}

const mm = (v) => (v * 1000).toFixed(1);
let count = 0;
for (const id of ids) {
  if (!byId.has(id)) {
    console.log(`${id}: 語がありません`);
    count++;
    continue;
  }
  const pin = pins[id];
  const list = surfaces(id);
  const near = pin.at.map((c) => closest(list, c));
  const flags = [];
  const far = near.map((h) => h.distance).filter((d) => d > pin.r + 0.001);
  if (far.length) flags.push(`far ${far.map(mm).join("/")}mm`);
  if (pin.n) {
    const dots = near.map((h) => h.normal.x * pin.n[0] + h.normal.y * pin.n[1] + h.normal.z * pin.n[2]);
    if (dots.some((d) => d < -0.2)) flags.push(`against ${dots.map((d) => d.toFixed(1)).join("/")}`);
  }
  if (!pin.v && pin.r < 0.012 && pin.at.length >= 3) {
    const zig = [];
    for (let i = 1; i + 1 < pin.at.length; i++) zig.push(Math.hypot(...pin.at[i].map((v, k) => v - (pin.at[i - 1][k] + pin.at[i + 1][k]) / 2)));
    if (zig.some((z) => z > 0.006)) flags.push(`zig ${zig.map(mm).join("/")}mm`);
  }
  if (flags.length) {
    console.log(`${id}（${byId.get(id).of ?? ""}）: ${flags.join("  ")}`);
    count++;
  }
}
console.log(`${ids.length} 部位のうち ${count} 部位に印`);
