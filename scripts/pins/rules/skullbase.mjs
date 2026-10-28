// 頭蓋底と舌骨の部位（Phase 3 その6 で追加）のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）
// sup は上から見て前が画像の下、本人の右が画像の左
export const RULES = {
  clivus: { rays: [["sup", 0.5, 0.84], ["sup", 0.5, 0.9]], r: 0.009, n: "sup+post", one: true },
  "internal-occipital-protuberance": { ray: ["ant", 0.5, 0.6], r: 0.008, n: "ant", one: true },
  "petrous-part-of-temporal-bone": { rays: [["sup", 0.55, 0.46], ["sup", 0.7, 0.5], ["sup", 0.85, 0.55]], r: 0.01, n: "sup" },
  "body-of-hyoid-bone": { ext: "ant", r: 0.008, n: "ant", one: true },
  "greater-horn-of-hyoid-bone": { rays: [["sup", 0.1, 0.1], ["sup", 0.14, 0.42]], r: 0.007, n: "sup+lat" },
  "lesser-horn-of-hyoid-bone": { ray: ["sup", 0.21, 0.79], r: 0.005, n: "sup" },
};
export const CHECKS = [
  { name: "sb-occ", mesh: "occipital-bone", views: ["sup", "ant", "med"], ids: ["clivus", "internal-occipital-protuberance"] },
  { name: "sb-temp", mesh: "temporal-bone", views: ["sup", "post"], ids: ["petrous-part-of-temporal-bone"] },
  { name: "sb-hyoid", mesh: "hyoid-bone", views: ["sup", "ant", "lat"], ids: ["body-of-hyoid-bone", "greater-horn-of-hyoid-bone", "lesser-horn-of-hyoid-bone"] },
];
