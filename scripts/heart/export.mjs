// 心臓の中のつくりを作るための元の形を書き出す（scripts/heart/heart.py が読む）。
// BodyParts3D の心臓（壁・内腔・弁・乳頭筋）と、心臓に出入りする大血管・冠状静脈洞（3.0 の細かい形を重ねたもの。無ければ 4.0）。
// 座標はモデル座標（m・Y上・前が +z・本人の右が -x）。出力: data-raw/heart/input.json
// 使い方: node scripts/heart/export.mjs（そのあと python3 scripts/heart/heart.py）
import fs from "node:fs";
import path from "node:path";
import { db, loadDb } from "../pins/geometry.mjs";

process.env.HIRES ??= "1";
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/heart");
await loadDb({ za: false });
const { mesh, elementNames } = db();
/** 名前（小文字）→ 部品ID。BodyParts3D の部品だけから探す */
const byName = (name) => {
  const found = [...elementNames].filter(([id, n]) => id.startsWith("FJ") && n.toLowerCase() === name);
  if (found.length !== 1) throw new Error(`「${name}」が ${found.length} 個あります`);
  return found[0][0];
};
const plain = (id) => {
  const m = mesh(id);
  return { id, name: elementNames.get(id), positions: Array.from(m.positions, (v) => +v.toFixed(6)), indices: Array.from(m.indices) };
};
const NAMES = {
  wallRV: "wall of right ventricle", wallLV: "wall of left ventricle", wallRA: "wall of right atrium", wallLA: "wall of left atrium",
  cavRV: "cavity of right ventricle", cavLV: "cavity of left ventricle", cavRA: "cavity of right atrium", cavLA: "cavity of left atrium",
  papRVant: "anterior papillary muscle of right ventricle", papRVpost: "posterior papillary muscle of right ventricle", papRVsep: "septal papillary muscle of right ventricle",
  papLVant: "anterolateral head of lateral papillary muscle of left ventricle", papLVpost: "lateral papillary muscle of left ventricle",
  mitralA: "anterior leaflet of mitral valve", mitralP: "posterior leaflet of mitral valve",
  tricA: "anterior leaflet of tricuspid valve", tricP: "posterior leaflet of tricuspid valve", tricS: "septal leaflet of tricuspid valve",
  aorta: "ascending aorta", coronarySinus: "coronary sinus",
};
const out = {};
for (const [key, name] of Object.entries(NAMES)) out[key] = plain(byName(name));
// 名前が1つに決まらない形（大静脈・肺動脈幹・肺静脈）は名前の一部で探して全部入れる
const extra = (pattern) => [...elementNames].filter(([id, n]) => id.startsWith("FJ") && pattern.test(n.toLowerCase())).map(([id]) => plain(id));
out.vessels = [
  ...extra(/^superior vena cava$/), ...extra(/^inferior vena cava$/), ...extra(/^pulmonary trunk$/),
  ...extra(/pulmonary vein$/), ...extra(/cusp of (aortic|pulmonary) valve$/),
];
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "input.json"), JSON.stringify(out));
console.log(path.join(OUT, "input.json"), Object.keys(out).length, "vessels", out.vessels.map((v) => v.name).join(", "));
