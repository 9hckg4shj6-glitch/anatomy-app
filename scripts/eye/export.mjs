// 眼球の中のつくり（瞳孔・後眼房・黄斑・中心窩・視神経円板）を作るための元の形を書き出す（scripts/eye/eye.py が読む）。
// BodyParts3D の眼球の部品と視神経（3.0 の細かい形を重ねたもの。無ければ 4.0）。左右とも書く。
// 座標はモデル座標（m・Y上・前が +z・本人の右が -x）。出力: data-raw/eye/input.json
// 使い方: node scripts/eye/export.mjs（そのあと python3 scripts/eye/eye.py）
import fs from "node:fs";
import path from "node:path";
import { db, loadDb } from "../pins/geometry.mjs";

process.env.HIRES ??= "1";
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/eye");
await loadDb({ za: false });
const { mesh, elementNames } = db();
const plain = (id) => {
  const m = mesh(id);
  return { id, name: elementNames.get(id), positions: Array.from(m.positions, (v) => +v.toFixed(6)), indices: Array.from(m.indices) };
};
/** 名前（小文字）に合う BodyParts3D の部品を全部（同じ名前の形が2つある脈絡膜・視神経は両方） */
const all = (name) => {
  const found = [...elementNames].filter(([id, n]) => id.startsWith("FJ") && n.toLowerCase() === name).map(([id]) => plain(id));
  if (!found.length) throw new Error(`「${name}」がありません`);
  return found;
};
const NAMES = {
  cornea: "{side} cornea", sclera: "{side} sclera", iris: "{side} iris", lens: "{side} lens", vitreous: "{side} vitreous body",
  choroid: "{side} choroid", ciliary: "{side} corona ciliaris", zonule: "suspensory ligament of {side} lens",
  retina: "optic part of {side} retina", anterior: "anterior chamber of {side} eyeball", optic: "{side} optic nerve",
};
const out = {};
for (const side of ["right", "left"]) {
  out[side] = {};
  for (const [key, name] of Object.entries(NAMES)) out[side][key] = all(name.replace("{side}", side));
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "input.json"), JSON.stringify(out));
for (const [side, v] of Object.entries(out)) console.log(side, Object.entries(v).map(([k, list]) => `${k}:${list.map((m) => `${m.id}(${m.positions.length / 3})`).join("+")}`).join(" "));
