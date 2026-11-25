// 耳の中のつくりを作るための元の形を書き出す（scripts/ear/ear.py が読む）。
// 骨に合わせて動かした Z-Anatomy の蝸牛・前庭・耳小骨・鼓膜・耳管・内耳神経と、BodyParts3D の側頭骨・外耳（3.0 の細かい形を重ねたもの）。
// 座標はモデル座標（m・Y上・前が +z・本人の右が -x）。出力: data-raw/ear/input.json
// 使い方: node scripts/ear/export.mjs（そのあと python3 scripts/ear/ear.py）
import fs from "node:fs";
import path from "node:path";
import { db, loadDb } from "../pins/geometry.mjs";

process.env.HIRES ??= "1";
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/ear");
await loadDb({ za: true });
const { mesh, elementNames } = db();
const plain = (id) => {
  const m = mesh(id);
  return { id, name: elementNames.get(id), positions: Array.from(m.positions, (v) => +v.toFixed(6)), indices: Array.from(m.indices) };
};
const find = (name, prefix) => {
  const found = [...elementNames].filter(([id, n]) => id.startsWith(prefix) && n.toLowerCase() === name);
  if (found.length !== 1) throw new Error(`「${name}」が ${found.length} 個あります`);
  return plain(found[0][0]);
};
const ZA = ["cochlea", "vestibule", "malleus", "incus", "stapes", "tympanic membrane", "auditory tube", "vestibular nerve", "vestibulocochlear nerve (viii)", "chorda tympani", "facial nerve (vii)"];
const out = {};
for (const side of ["right", "left"]) {
  out[side] = {};
  for (const n of ZA) {
    try { out[side][n] = find(`${side} ${n}`, "ZA_"); } catch (e) { console.warn(e.message); }
  }
  out[side]["temporal bone"] = find(`${side} temporal bone`, "FJ");
}
out.right["cochlear nerve"] = find("cochlear nerve", "ZA_");
out.left["cochlear nerve"] = find("cochlear nervel", "ZA_");
out.both = { "external ear": find("external ear", "FJ") };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "input.json"), JSON.stringify(out));
for (const [k, v] of Object.entries(out)) console.log(k, Object.entries(v).map(([n, m]) => `${n}:${m.positions.length / 3}`).join(", "));
