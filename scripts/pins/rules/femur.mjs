// 大腿骨と膝蓋骨の部位のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）
const BOT = [0, 0.8, 1, 1];
export const RULES = {
  "head-of-femur": { ext: "med+0.6sup", box: { s: [0.85, 1] }, r: 0.02 },
  "fovea-of-head-of-femur": { ext: "med+0.1inf", box: { s: [0.88, 1] }, r: 0.005 },
  "neck-of-femur": { ring: true, slices: [{ view: "ant", s: 0.925, m: 0.32 }, { view: "post", s: 0.925, m: 0.32 }, { view: "sup", s: 0.94, m: 0.3 }], r: 0.009, n: "ant+sup" },
  "greater-trochanter": { ext: "sup+0.8lat", box: { m: [0.6, 1], s: [0.8, 1] }, r: 0.013, n: "lat+sup" },
  "lesser-trochanter": { ext: "med+0.6post", box: { s: [0.78, 0.88] }, r: 0.009 },
  "intertrochanteric-crest": { slices: [{ view: "post", s: 0.925, m: 0.8 }, { view: "post", s: 0.89, m: 0.6 }, { view: "post", s: 0.855, m: 0.4 }], r: 0.006 },
  "intertrochanteric-line": { slices: [{ view: "ant", s: 0.92, m: 0.75 }, { view: "ant", s: 0.885, m: 0.5 }, { view: "ant", s: 0.85, m: 0.25 }], r: 0.005 },
  "gluteal-tuberosity": { ext: "post+0.6lat", box: { s: [0.68, 0.78] }, r: 0.01 },
  "linea-aspera": { ridge: { dir: "post", along: "s", from: 0.35, to: 0.65, k: 5 }, r: 0.006 },
  "medial-condyle-of-femur": { ext: "inf+0.3post", box: { m: [0, 0.5], s: [0, 0.12] }, r: 0.013, n: "post+inf+0.5med" },
  "lateral-condyle-of-femur": { ext: "inf+0.3post", box: { m: [0.5, 1], s: [0, 0.12] }, r: 0.013, n: "post+inf+0.5lat" },
  "medial-epicondyle-of-femur": { ext: "med", box: { s: [0, 0.12] }, r: 0.009 },
  "lateral-epicondyle-of-femur": { ext: "lat", box: { s: [0, 0.12] }, r: 0.009 },
  "adductor-tubercle": { ext: "med+0.6sup", box: { s: [0.05, 0.14] }, r: 0.005 },
  "intercondylar-fossa": { ray: ["post", 0.41, 0.8, BOT], r: 0.01, n: "post+inf" },
  "patellar-surface": { slices: [{ view: "ant", s: 0.05 }], r: 0.015 },
  "base-of-patella": { ext: "sup", r: 0.008, n: "sup+ant" },
  "apex-of-patella": { ext: "inf", r: 0.006, n: "inf+ant" },
};
const F = Object.keys(RULES).filter((id) => !id.includes("patella") || id === "patellar-surface");
export const CHECKS = [
  { name: "fem-top", mesh: "femur", views: ["ant", "post", "sup"], crop: [0, 0, 1, 0.3], ids: F },
  { name: "fem-bot", mesh: "femur", views: ["ant", "post", "med", "inf"], crop: [0, 0.8, 1, 1], ids: F },
  { name: "fem", mesh: "femur", views: ["post", "lat"], ids: F },
  { name: "patella", mesh: "patella", views: ["ant", "lat"], ids: ["base-of-patella", "apex-of-patella"] },
];
