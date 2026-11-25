// 喉頭の中のつくり（声帯ひだ・前庭ひだ・声門裂・喉頭室・声門下腔など）を作るための元の形を書き出す（scripts/larynx/larynx.py が読む）。
// BodyParts3D の喉頭の軟骨・靱帯・膜・筋と気管・舌骨（3.0 の細かい形を重ねたもの。無ければ 4.0）。
// 座標はモデル座標（m・Y上・前が +z・本人の右が -x）。出力: data-raw/larynx/input.json
// 使い方: node scripts/larynx/export.mjs（そのあと python3 scripts/larynx/larynx.py）
import fs from "node:fs";
import path from "node:path";
import { db, loadDb } from "../pins/geometry.mjs";

process.env.HIRES ??= "1";
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/larynx");
await loadDb({ za: false });
const { mesh, elementNames } = db();
const plain = (id) => {
  const m = mesh(id);
  return { id, name: elementNames.get(id), positions: Array.from(m.positions, (v) => +v.toFixed(6)), indices: Array.from(m.indices) };
};
const all = (name) => {
  const found = [...elementNames].filter(([id, n]) => id.startsWith("FJ") && n.toLowerCase() === name).map(([id]) => plain(id));
  if (!found.length) throw new Error(`「${name}」がありません`);
  return found;
};
const BOTH = { thyroid: "thyroid cartilage", cricoid: "cricoid cartilage", epiglottis: "epiglottis", trachea: "trachea", thyroEpi: "thyro-epiglottic ligament", hyoEpi: "hyo-epiglottic ligament", transverse: "transverse arytenoid", hyoid: "hyoid bone", cricothyroidLig: "median cricothyroid ligament" };
const SIDED = {
  arytenoid: "{side} arytenoid cartilage", corniculate: "{side} corniculate cartilage", cuneiform: "{side} cuneiform cartilage",
  conus: "{side} conus elasticus", vocalLig: "{side} vocal ligament", vocalis: "{side} vocalis", thyroAry: "{side} thyro-arytenoid",
  lca: "{side} lateral crico-arytenoid", pca: "{side} posterior crico-arytenoid", oblique: "{side} oblique arytenoid",
  aryepi: "{side} aryepiglotticus", thyrohyoidMembrane: "{side} thyrohyoid membrane",
};
const out = {};
for (const [k, n] of Object.entries(BOTH)) { try { out[k] = all(n); } catch (e) { console.warn(e.message); } }
for (const side of ["right", "left"]) for (const [k, n] of Object.entries(SIDED)) out[`${k}_${side[0]}`] = all(n.replace("{side}", side));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "input.json"), JSON.stringify(out));
console.log(Object.entries(out).map(([k, list]) => `${k}:${list.map((m) => `${m.id}(${m.positions.length / 3})`).join("+")}`).join(" "));
