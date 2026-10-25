// 下腿と足の骨の部位のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）
export const RULES = {
  "medial-condyle-of-tibia": { ext: "med", box: { s: [0.9, 1] }, r: 0.012 },
  "lateral-condyle-of-tibia": { ext: "lat", box: { s: [0.9, 1] }, r: 0.012 },
  "intercondylar-eminence": { ext: "sup", r: 0.007 },
  "tibial-tuberosity": { ext: "ant", box: { s: [0.8, 0.92] }, r: 0.009 },
  "anterior-border-of-tibia": { ridge: { dir: "ant+0.2med", along: "s", from: 0.3, to: 0.75, k: 5 }, r: 0.005, n: "ant" },
  "soleal-line": { slices: [{ view: "post", s: 0.85, m: 0.8 }, { view: "post", s: 0.8, m: 0.6 }, { view: "post", s: 0.75, m: 0.4 }, { view: "post", s: 0.7, m: 0.22 }], r: 0.005 },
  "medial-malleolus": { ext: "med", box: { s: [0, 0.1] }, r: 0.009 },
  "head-of-fibula": { ext: "sup", r: 0.01, n: "sup+lat" },
  "neck-of-fibula": { ring: true, slices: [{ view: "ant", s: 0.93 }, { view: "ant+lat", s: 0.93 }, { view: "lat", s: 0.93 }, { view: "post+lat", s: 0.93 }, { view: "post", s: 0.93 }, { view: "post+med", s: 0.93 }, { view: "med", s: 0.93 }, { view: "ant+med", s: 0.93 }], r: 0.005, n: "lat+ant" },
  "lateral-malleolus": { ext: "lat+0.5inf", box: { s: [0, 0.12] }, r: 0.01, n: "lat" },
  "calcaneal-tuberosity": { ext: "post", r: 0.013 },
  "sustentaculum-tali": { ext: "med+0.3sup", box: { a: [0.4, 0.8], s: [0.35, 1] }, r: 0.008, n: "med" },
  "trochlea-of-talus": { ext: "sup", r: 0.012 },
  "head-of-talus": { ext: "ant+0.3med", r: 0.009 },
  "tuberosity-of-navicular": { ext: "med+0.3inf", r: 0.006 },
  "tuberosity-of-fifth-metatarsal": { ext: "lat+0.3post", r: 0.006 },
};
export const CHECKS = [
  { name: "tibia", mesh: "tibia", views: ["ant", "post", "med"], ids: ["medial-condyle-of-tibia", "lateral-condyle-of-tibia", "intercondylar-eminence", "tibial-tuberosity", "anterior-border-of-tibia", "soleal-line", "medial-malleolus"] },
  { name: "tibia-top", mesh: "tibia", views: ["post", "ant"], crop: [0, 0, 1, 0.35], ids: ["medial-condyle-of-tibia", "lateral-condyle-of-tibia", "intercondylar-eminence", "tibial-tuberosity", "soleal-line"] },
  { name: "fibula", mesh: "fibula", views: ["lat"], ids: ["head-of-fibula", "neck-of-fibula", "lateral-malleolus"] },
  { name: "foot", mesh: "tarsal-bones", views: ["med", "lat", "sup"], ids: ["calcaneal-tuberosity", "sustentaculum-tali", "trochlea-of-talus", "head-of-talus", "tuberosity-of-navicular"] },
  { name: "mt5", mesh: "metatarsals", views: ["lat", "sup"], ids: ["tuberosity-of-fifth-metatarsal"] },
];
