// 鼻中隔（粘膜をふくむ形）と硬口蓋（口の側の粘膜）を作るための元の形を書き出す（scripts/palate/palate.py が読む）。
// NasalSeg の CT から作った左右の鼻腔（scripts/nasal/。BodyParts3D の頭蓋に合わせたもの）と、BodyParts3D の鋤骨・篩骨・鼻中隔軟骨・大鼻翼軟骨・
// 上顎骨・口蓋骨・上の歯肉・上の歯（3.0 の細かい形を重ねたもの。無ければ 4.0）。
// 座標はモデル座標（m・Y上・前が +z・本人の右が -x）。出力: data-raw/palate/input.json
// 使い方: node scripts/palate/export.mjs（そのあと python3 scripts/palate/palate.py）
import fs from "node:fs";
import path from "node:path";
import { db, loadDb } from "../pins/geometry.mjs";

process.env.HIRES ??= "1";
// 元の上の歯肉を読む（作った形で置きかえない）
process.env.NO_MADE = "1";
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/palate");
await loadDb({ za: false });
const { mesh, elementNames } = db();
const plain = (id) => {
  const m = mesh(id);
  return { id, name: elementNames.get(id), positions: Array.from(m.positions, (v) => +v.toFixed(6)), indices: Array.from(m.indices) };
};
const matching = (re, prefix = "FJ") => {
  const found = [...elementNames].filter(([id, n]) => id.startsWith(prefix) && !id.includes("-") && re.test(n.toLowerCase())).map(([id]) => plain(id));
  if (!found.length) throw new Error(`${re} がありません`);
  return found;
};
const out = {
  airRight: matching(/^right (nasal cavity proper|inferior nasal meatus|middle nasal meatus)$/, "NS_"),
  airLeft: matching(/^left (nasal cavity proper|inferior nasal meatus|middle nasal meatus)$/, "NS_"),
  conchae: matching(/nasal concha \(mucosa\)$/, "NS_"),
  vomer: matching(/^vomer$/), ethmoid: matching(/^ethmoid$/), septalCartilage: matching(/^septal nasal cartilage$/),
  alar: matching(/major alar cartilage$/),
  maxilla: matching(/^(right|left) maxilla$/), palatine: matching(/^(right|left) palatine bone$/),
  gingiva: matching(/^gingiva of upper jaw$/), teeth: matching(/^(right|left) upper .*tooth$/),
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "input.json"), JSON.stringify(out));
console.log(Object.entries(out).map(([k, list]) => `${k}:${list.map((m) => `${m.name}(${m.positions.length / 3})`).join("+")}`).join("\n"));
