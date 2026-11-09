// 腎臓の中のつくりを作るための元の形を書き出す（scripts/kidney/kidney.py が読む）。
// BodyParts3D の腎臓（3.0 の細かい形を重ねたもの。無ければ 4.0）・副腎（脂肪被膜と腎筋膜が一緒に包む）と、骨に合わせて動かした Z-Anatomy の腎盤（腎杯をふくむ）。
// Z-Anatomy の腎臓の中の動脈・静脈は腎杯のすぐまわりをめぐる形で、葉間動脈・弓状動脈の位置（錐体の間・錐体の底）と合わないので使わない。
// 座標はモデル座標（m・Y上・前が +z・本人の右が -x）。出力: data-raw/kidney/input.json
// 使い方: node scripts/kidney/export.mjs（そのあと python3 scripts/kidney/kidney.py）
import fs from "node:fs";
import path from "node:path";
import { db, loadDb } from "../pins/geometry.mjs";

process.env.HIRES ??= "1";
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/kidney");
await loadDb({ za: true });
const { mesh, elementNames } = db();
const plain = (id) => {
  const m = mesh(id);
  return { id, positions: Array.from(m.positions, (v) => +v.toFixed(6)), indices: Array.from(m.indices) };
};
const out = {};
for (const side of ["right", "left"]) {
  out[side] = {
    kidney: plain([...elementNames].find(([id, n]) => id.startsWith("FJ") && n.toLowerCase() === `${side} kidney`)[0]),
    pelvis: plain(`ZA_Renal_pelvis${side[0]}`),
    adrenal: plain([...elementNames].find(([id, n]) => id.startsWith("FJ") && n.toLowerCase() === `${side} adrenal gland`)[0]),
  };
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "input.json"), JSON.stringify(out));
console.log(path.join(OUT, "input.json"));
