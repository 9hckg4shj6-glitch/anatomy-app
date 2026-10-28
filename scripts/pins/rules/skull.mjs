// 頭蓋の部位のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）
const TEMP = [0.3, 0.4, 0.7, 0.8];
export const RULES = {
  "coronal-suture": { seam: { a: "frontal", b: "parietal", k: 6, axis: 0, range: [-0.08, 0.002] }, r: 0.006, n: "sup+ant" },
  "sagittal-suture": { side: "all", seam: { a: "right parietal", b: "left parietal", k: 6, axis: 2 }, r: 0.006, n: "sup" },
  "lambdoid-suture": { seam: { a: "occipital", b: "parietal", k: 6, axis: 1, range: [1.5, 1.7] }, r: 0.006, n: "post+0.5sup" },
  "squamous-suture": { seam: { a: "temporal", b: "parietal", k: 5, axis: 2 }, r: 0.005, n: "lat" },
  "external-occipital-protuberance": { ext: "post+0.7inf", box: { m: [0.45, 0.55] }, r: 0.008, n: "post" },
  "foramen-magnum": { rays: [["inf", 0.5, 0.22], ["inf", 0.5, 0.55], ["inf", 0.355, 0.36], ["inf", 0.645, 0.36]], center: true, r: 0.019, n: "inf" },
  "occipital-condyle": { ext: "inf", box: { m: [0.55, 0.85] }, r: 0.008, n: "inf+lat" },
  "mastoid-process": { ext: "inf+0.5post+0.3lat", box: { a: [0, 0.5] }, r: 0.009 },
  "styloid-process-of-temporal-bone": { ext: "inf+0.3ant+0.3med", r: 0.005 },
  "external-acoustic-opening": { ray: ["lat", 0.5, 0.58, TEMP], r: 0.008, inset: -0.005 },
  "zygomatic-arch": { ridge: { dir: "lat", along: "a", from: 0.55, to: 0.8, k: 4 }, box: { s: [0.3, 0.45] }, r: 0.006, n: "lat" },
  "supra-orbital-foramen": { ray: ["ant", 0.32, 0.81], r: 0.005 },
  "infra-orbital-foramen": { ray: ["ant", 0.42, 0.6], r: 0.005 },
  "orbit": { rays: [["ant", 0.31, 0.52], ["ant", 0.31, 0.76], ["ant", 0.16, 0.63], ["ant", 0.43, 0.63]], center: true, inset: 0.016, r: 0.022, n: "ant" },
  "alveolar-process": { ridge: { dir: "inf", along: "a", from: 0.15, to: 0.85, k: 4 }, r: 0.006, n: "inf+lat" },
  "bony-palate": { side: "all", ray: ["inf", 0.45, 0.4], r: 0.014, n: "inf" },
  "sella-turcica": { near: [0, 1.5215, 0.105], r: 0.008, n: "sup" },
  "greater-wing-of-sphenoid": { ext: "lat+0.5sup", r: 0.012 },
  "pterygoid-process": { ext: "inf", box: { m: [0.5, 1] }, r: 0.008, n: "inf+lat" },
  "crista-galli": { ext: "sup", r: 0.005 },
  "cribriform-plate": { side: "all", ray: ["sup", 0.44, 0.45], r: 0.007 },
  "head-of-mandible": { ext: "sup", box: { m: [0.5, 1], a: [0, 0.4] }, r: 0.008, n: "sup+lat" },
  "coronoid-process-of-mandible": { ext: "sup", box: { m: [0.5, 1], a: [0.35, 0.8] }, r: 0.007, n: "lat+sup" },
  "angle-of-mandible": { ext: "inf+post", box: { m: [0.6, 1] }, r: 0.01, n: "lat+inf" },
  "mental-protuberance": { ext: "ant+0.3inf", box: { m: [0.45, 0.55] }, r: 0.009 },
  "mental-foramen": { ray: ["lat", 0.765, 0.77], r: 0.004 },
};
export const RULES2 = {
  "mandibular-fossa": { nearestTo: "head-of-mandible", r: 0.009, n: "inf" },
  "mandibular-notch": { ray: ["lat", 0.4, 0.31], r: 0.006, n: "lat+sup" },
  "ramus-of-mandible": { ray: ["lat", 0.3, 0.45], r: 0.012 },
  "body-of-mandible": { ray: ["lat", 0.62, 0.74], r: 0.013 },
  "mandibular-foramen": { fromMid: { s: 0.55, a: 0.25 }, r: 0.006, cam: "0.55med+0.55inf+0.6post" },
};
const SK = [...Object.keys(RULES), ...Object.keys(RULES2)];
export const CHECKS = [
  { name: "skull", mesh: "skull-all", views: ["ant", "lat", "post", "inf", "sup"], ids: SK },
  { name: "base", mesh: "sphenoid-bone", side: "all", views: ["sup", "lat"], ids: ["sella-turcica", "greater-wing-of-sphenoid", "pterygoid-process"] },
  { name: "eth", mesh: "ethmoid-bone", side: "all", views: ["sup", "lat"], ids: ["crista-galli", "cribriform-plate"] },
  { name: "pal", mesh: "bony-palate", side: "all", views: ["inf"], ids: ["bony-palate", "alveolar-process"] },
  { name: "mandmed", mesh: "mandible", half: true, views: ["med"], ids: ["mandibular-foramen", "head-of-mandible", "coronoid-process-of-mandible", "angle-of-mandible"] },
  { name: "mand", mesh: "mandible", views: ["lat"], ids: ["head-of-mandible", "coronoid-process-of-mandible", "mandibular-notch", "angle-of-mandible", "ramus-of-mandible", "body-of-mandible", "mental-protuberance", "mental-foramen", "mandibular-foramen"] },
];
