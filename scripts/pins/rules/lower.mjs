// 下肢の骨の部位（Phase 3 その4 で追加）のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）
// 腸骨・坐骨・恥骨は寛骨の上の広い範囲なので、数点の大きな球を並べて示す（ring: 面の向きで塗り分けず内面も塗る）
const TOP = [0, 0, 1, 0.3];
export const RULES = {
  ilium: { rays: [["lat", 0.3, 0.17], ["lat", 0.5, 0.15], ["lat", 0.7, 0.2], ["lat", 0.15, 0.29], ["lat", 0.35, 0.29], ["lat", 0.55, 0.28], ["lat", 0.75, 0.3], ["lat", 0.86, 0.3], ["lat", 0.25, 0.4], ["lat", 0.45, 0.4], ["lat", 0.65, 0.41], ["lat", 0.82, 0.38], ["lat", 0.5, 0.5], ["lat", 0.66, 0.5], ["lat", 0.42, 0.1], ["lat", 0.42, 0.22], ["med", 0.5, 0.48], ["med", 0.4, 0.55], ["med", 0.6, 0.4]], ring: true, r: 0.026, n: "lat" },
  ischium: { rays: [["lat", 0.34, 0.65], ["lat", 0.31, 0.75], ["lat", 0.36, 0.85], ["lat", 0.46, 0.88], ["med", 0.64, 0.66], ["med", 0.68, 0.8]], ring: true, r: 0.02, n: "lat" },
  pubis: { rays: [["lat", 0.86, 0.73], ["lat", 0.75, 0.66], ["lat", 0.73, 0.81], ["lat", 0.66, 0.85], ["med", 0.15, 0.72], ["med", 0.27, 0.68]], ring: true, r: 0.018, n: "lat+ant" },
  "superior-pubic-ramus": { rays: [["lat", 0.68, 0.655], ["lat", 0.74, 0.665], ["lat", 0.8, 0.69]], ring: true, r: 0.012, n: "lat", inset: 0.007 },
  "inferior-pubic-ramus": { rays: [["lat", 0.74, 0.81], ["lat", 0.66, 0.85]], ring: true, r: 0.011, n: "lat", inset: 0.006 },
  "ramus-of-ischium": { rays: [["lat", 0.56, 0.88], ["lat", 0.48, 0.89]], ring: true, r: 0.011, n: "lat", inset: 0.006 },
  "trochanteric-fossa": { ray: ["post", 0.7, 0.27, TOP], r: 0.007, n: "post+med+sup" },
  "pectineal-line-of-femur": { rays: [["post", 0.56, 0.7, TOP], ["post", 0.6, 0.8, TOP], ["post", 0.63, 0.9, TOP]], r: 0.005 },
  "popliteal-surface": { slices: [{ view: "post", s: 0.13, m: 0.5 }, { view: "post", s: 0.19, m: 0.5 }], r: 0.015 },
  "medial-surface-of-tibia": { rays: [["antmed", 0.5, 0.3], ["antmed", 0.5, 0.45], ["antmed", 0.5, 0.6], ["antmed", 0.5, 0.72]], r: 0.016, n: "med+ant" },
  "pes-anserinus": { slices: [{ view: "med+0.4ant", s: 0.86 }], r: 0.011, n: "med+0.4ant" },
  "fibular-notch": { slices: [{ view: "lat", s: 0.06 }], r: 0.008, n: "lat" },
  "neck-of-talus": { between: ["head-of-talus", "trochlea-of-talus"], r: 0.006, n: "sup+ant" },
  "posterior-process-of-talus": { ext: "post", r: 0.006 },
  "fibular-trochlea": { ext: "lat", box: { a: [0.45, 0.75], s: [0.2, 0.6] }, r: 0.006 },
  "tarsal-sinus": { ray: ["lat", 0.6, 0.3], r: 0.008, n: "lat+sup" },
  "groove-for-fibularis-longus": { ray: ["inf", 0.5, 0.5], r: 0.006, n: "inf+lat" },
  "tuberosity-of-first-metatarsal": { ext: "inf+0.5lat", box: { a: [0, 0.12] }, r: 0.006 },
  "malleolar-groove-of-tibia": { ext: "post+0.3med", box: { s: [0.02, 0.1], m: [0, 0.22] }, r: 0.006 },
  "malleolar-groove-of-fibula": { ext: "post", box: { s: [0.05, 0.1] }, r: 0.006 },
  "head-of-metatarsal": {
    union: ["first", "second", "third", "fourth", "fifth"].map((n) => ({ ext: "ant", part: `${n} metatarsal bone` })),
    ring: true, r: 0.009, n: "ant",
  },
};
const HIP = ["ilium", "ischium", "pubis", "superior-pubic-ramus", "inferior-pubic-ramus", "ramus-of-ischium"];
export const CHECKS = [
  { name: "lo-hip3", mesh: "hip-bone", views: ["lat", "med", "ant"], ids: ["ilium", "ischium", "pubis"] },
  { name: "lo-rami", mesh: "hip-bone", views: ["lat", "med", "inf"], ids: HIP.slice(3) },
  { name: "lo-fem-top", mesh: "femur", views: ["post", "med"], crop: TOP, ids: ["trochanteric-fossa", "pectineal-line-of-femur"] },
  { name: "lo-fem", mesh: "femur", views: ["post"], ids: ["popliteal-surface", "pectineal-line-of-femur"] },
  { name: "lo-tibia", mesh: "tibia", views: ["ant", "med", "lat"], ids: ["medial-surface-of-tibia", "pes-anserinus", "fibular-notch"] },
  { name: "lo-ankle", mesh: ["tibia", "fibula"], views: ["post", "med", "lat"], crop: [0, 0.82, 1, 1], ids: ["malleolar-groove-of-tibia", "malleolar-groove-of-fibula", "medial-malleolus", "lateral-malleolus"] },
  { name: "lo-talus", mesh: "talus", views: ["sup", "lat", "post"], ids: ["neck-of-talus", "posterior-process-of-talus"] },
  { name: "lo-calc", mesh: "calcaneus", views: ["lat", "latsup", "sup"], ids: ["fibular-trochlea", "tarsal-sinus"] },
  { name: "lo-cuboid", mesh: "cuboid", views: ["inf", "lat"], ids: ["groove-for-fibularis-longus"] },
  { name: "lo-mt", mesh: "metatarsals", views: ["sup", "inf", "med"], ids: ["tuberosity-of-first-metatarsal", "head-of-metatarsal"] },
];
