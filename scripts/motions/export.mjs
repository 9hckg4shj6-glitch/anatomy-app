// 動きの図鑑（docs/動きの図鑑.md）の元になる、アプリの3Dの部品の点を書き出す（scripts/motions/*.py が読む）。
// public/models の GLB（アプリが読む形そのもの）を読み、語の部品の頂点を体の座標（m・Y上・前が +z・本人の左が +x）で書く。
// 出力: data-raw/motions/app.json { elements: { 部品ID: [x, y, z, ...] }, terms: { 語ID: [部品ID] } }
// 使い方: node scripts/motions/export.mjs
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const ROOT = path.resolve(import.meta.dirname, "../..");
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "public/models/index.json"), "utf8"));

/** 書き出す語（呼吸・心臓・血液の流れで動かす部品と、流れの道すじを作る血管） */
const TERMS = [
  // 呼吸
  "lung", "trachea", "main-bronchus", "segmental-bronchi", "right-superior-lobar-bronchus", "middle-lobar-bronchus", "right-inferior-lobar-bronchus",
  "left-superior-lobar-bronchus", "left-inferior-lobar-bronchus", "ribs", "costal-cartilages", "costal-arch", "sternum", "diaphragm",
  "external-intercostal", "internal-intercostal", "innermost-intercostal", "parietal-pleura", "thoracic-vertebrae",
  // 心臓
  "heart", "mitral-valve", "tricuspid-valve", "aortic-valve", "pulmonary-valve", "papillary-muscles", "chordae-tendineae",
  "sinuatrial-node", "atrioventricular-node", "atrioventricular-bundle", "right-bundle-branch", "left-bundle-branch", "purkinje-fibers",
  "fibrous-rings-of-heart", "epicardium", "endocardium", "fibrous-pericardium", "parietal-layer-of-serous-pericardium", "pericardial-cavity",
  "right-coronary-artery", "left-coronary-artery", "anterior-interventricular-branch", "circumflex-branch", "posterior-interventricular-branch",
  "great-cardiac-vein", "middle-cardiac-vein", "coronary-sinus", "small-cardiac-vein",
  // 大血管と全身の血管
  "ascending-aorta", "aortic-arch", "thoracic-aorta", "abdominal-aorta", "brachiocephalic-trunk", "common-carotid-artery", "internal-carotid-artery",
  "subclavian-artery", "axillary-artery", "brachial-artery", "radial-artery", "ulnar-artery", "celiac-trunk", "superior-mesenteric-artery", "renal-artery",
  "common-iliac-artery", "external-iliac-artery", "femoral-artery", "popliteal-artery", "anterior-tibial-artery", "posterior-tibial-artery",
  "pulmonary-trunk", "right-pulmonary-artery", "left-pulmonary-artery", "superior-pulmonary-vein", "inferior-pulmonary-vein", "pulmonary-veins",
  "superior-vena-cava", "inferior-vena-cava", "brachiocephalic-vein", "internal-jugular-vein", "subclavian-vein", "axillary-vein", "brachial-veins",
  "basilic-vein", "radial-veins", "ulnar-veins", "renal-vein", "common-iliac-vein", "external-iliac-vein", "femoral-vein", "popliteal-vein", "posterior-tibial-veins",
  "hepatic-portal-vein", "hepatic-veins", "superior-mesenteric-vein", "splenic-vein",
  "lateral-basal-segmental-artery", "anterior-segmental-artery", "superior-basal-vein", "anterior-vein-of-lung",
];

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const wanted = new Set(TERMS.flatMap((id) => {
  const term = index.terms[id];
  if (!term) throw new Error(`index.json に語 ${id} がありません`);
  return term.elements;
}));
const elements = {};
for (const system of Object.values(index.systems)) {
  for (const file of [system.url, system.za?.url].filter(Boolean)) {
    const doc = await io.read(path.join(ROOT, "public", file));
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh || !wanted.has(node.getName())) continue;
      const matrix = node.getWorldMatrix();
      const out = [];
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute("POSITION");
        const v = [0, 0, 0];
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, v);
          const [x, y, z] = v;
          out.push(
            +(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]).toFixed(5),
            +(matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]).toFixed(5),
            +(matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]).toFixed(5),
          );
        }
      }
      elements[node.getName()] = out;
    }
  }
}
const missing = [...wanted].filter((id) => !elements[id]);
if (missing.length) console.warn("GLB に無い部品:", missing.join(" "));
const terms = Object.fromEntries(TERMS.map((id) => [id, index.terms[id].elements]));
fs.mkdirSync(path.join(ROOT, "data-raw/motions"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data-raw/motions/app.json"), JSON.stringify({ elements, terms }));
console.log("部品", Object.keys(elements).length, "頂点", Object.values(elements).reduce((sum, list) => sum + list.length / 3, 0));
