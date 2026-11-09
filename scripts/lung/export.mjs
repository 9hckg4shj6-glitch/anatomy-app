// 肺区域を作るための元の形を書き出す（scripts/lung/lung.py が読む）。
// - 肺葉: 骨に合わせて動かした Z-Anatomy の肺葉5つ（閉じた形）。
// - 区域の種: 区域ごとの BodyParts3D の区域気管支の木（概念 FMA682xx）と、Z-Anatomy の区域動脈。
//   区域気管支と区域動脈は区域の中央をそろって走る（『解剖学講義』図5-37）ので、両方を種にする。区域静脈は区域の間を走るので使わない。
// - 胸膜を作るための胸壁（肋骨・肋軟骨・胸骨・胸椎・肋間筋・胸横筋）・横隔膜・縦隔の器官（心臓・大血管・気管・食道）。scripts/lung/pleura.py が読む。
// 座標はモデル座標（m・Y上・前が +z・本人の右が -x）。出力: data-raw/lung/input.json
// 使い方: node scripts/lung/export.mjs（そのあと python3 scripts/lung/lung.py）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, loadDb } from "../pins/geometry.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/lung");

// 区域: [左右, 葉, 区域の名前（部品名に使う）, BodyParts3D の区域気管支の木の概念, Z-Anatomy の区域動脈]
export const SEGMENTS = [
  ["right", "superior", "s1", ["FMA68211"], ["apical segmental artery of right lung"]],
  ["right", "superior", "s2", ["FMA68213"], ["posterior segmental artery of right lung"]],
  ["right", "superior", "s3", ["FMA68212"], ["anterior segmental artery of right lung"]],
  ["right", "middle", "s4", ["FMA68215"], ["lateral segmental artery of right lung"]],
  ["right", "middle", "s5", ["FMA68214"], ["medial segmental artery of right lung"]],
  ["right", "inferior", "s6", ["FMA68216"], ["superior segmental artery of right lung"]],
  ["right", "inferior", "s7", ["FMA68218"], ["medial basal segmental artery of right lung"]],
  ["right", "inferior", "s8", ["FMA68321"], ["anterior basal segmental artery of right lung"]],
  ["right", "inferior", "s9", ["FMA68220"], ["lateral basal segmental artery of right lung"]],
  ["right", "inferior", "s10", ["FMA68221"], ["posterior basal segmental artery of right lung"]],
  ["left", "superior", "s1+2", ["FMA68223", "FMA68225"], ["apical segmental artery of left lung", "posterior segmental artery of left lung"]],
  ["left", "superior", "s3", ["FMA68222"], ["anterior segmental artery of left lung"]],
  ["left", "superior", "s4", ["FMA68226"], ["superior lingular artery of left lung"]],
  ["left", "superior", "s5", ["FMA68227"], ["inferior lingular artery of left lung"]],
  ["left", "inferior", "s6", ["FMA68228"], ["superior segmental artery of left lung"]],
  ["left", "inferior", "s7", ["FMA68230"], ["medial basal segmental artery of left lung"]],
  ["left", "inferior", "s8", ["FMA68231"], ["anterior basal segmental artery of left lung"]],
  ["left", "inferior", "s9", ["FMA68232"], ["lateral basal segmental artery of left lung"]],
  ["left", "inferior", "s10", ["FMA68233"], ["posterior basal segmental artery of left lung"]],
];

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await loadDb({ za: true });
  const { elementNames, conceptElements, mesh } = db();
  const zaId = (name) => {
    const hit = [...elementNames].find(([id, n]) => id.startsWith("ZA") && n === name);
    if (!hit) throw new Error(`Z-Anatomy に「${name}」がありません`);
    return hit[0];
  };
  const plain = (m) => ({ positions: Array.from(m.positions, (v) => +v.toFixed(6)), indices: Array.from(m.indices) });
  const points = (ids) => ids.flatMap((id) => Array.from(mesh(id).positions, (v) => +v.toFixed(5)));
  const out = { lobes: {}, segments: [] };
  for (const [side, lobe] of [["right", "superior"], ["right", "middle"], ["right", "inferior"], ["left", "superior"], ["left", "inferior"]]) {
    out.lobes[`${side} ${lobe}`] = plain(mesh(zaId(`${lobe} lobe of ${side} lung`)));
  }
  for (const [side, lobe, slug, concepts, arteries] of SEGMENTS) {
    const bronchi = concepts.flatMap((c) => [...(conceptElements.get(c) ?? [])]).filter((id) => elementNames.has(id));
    out.segments.push({ side, lobe, slug, bronchi: points(bronchi), arteries: points(arteries.map(zaId)) });
    console.log(side, slug, "気管支", bronchi.length, "動脈", arteries.length);
  }
  // 胸膜を作るための形（語の部品をまとめて書く）
  const { resolved } = db();
  const THORAX = {
    wall: ["ribs", "costal-cartilages", "sternum", "thoracic-vertebrae", "innermost-intercostal", "internal-intercostal", "transversus-thoracis"],
    diaphragm: ["diaphragm"],
    mediastinum: ["heart", "esophagus", "aortic-arch", "thoracic-aorta", "superior-vena-cava", "trachea", "pulmonary-trunk", "main-bronchus"],
  };
  out.thorax = {};
  for (const [group, terms] of Object.entries(THORAX)) {
    out.thorax[group] = terms.flatMap((t) => {
      const ids = resolved.get(t);
      if (!ids) throw new Error(`語 ${t} がありません`);
      return ids;
    }).map((id) => plain(mesh(id)));
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "input.json"), JSON.stringify(out));
  console.log(path.join(OUT, "input.json"));
}
