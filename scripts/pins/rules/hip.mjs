// 寛骨の部位のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）
export const RULES = {
  "iliac-crest": { ridge: { dir: "sup", along: "a", from: 0.12, to: 0.88, k: 6 }, box: { s: [0.55, 1] }, r: 0.007, n: "sup+0.3lat" },
  "anterior-superior-iliac-spine": { ext: "ant+0.5sup", box: { s: [0.6, 1] }, r: 0.008 },
  "anterior-inferior-iliac-spine": { ext: "ant", box: { s: [0.45, 0.62] }, r: 0.007 },
  "posterior-superior-iliac-spine": { ext: "post+0.3sup", box: { s: [0.5, 0.9] }, r: 0.008 },
  "posterior-inferior-iliac-spine": { ext: "post", box: { s: [0.45, 0.62] }, r: 0.007 },
  "iliac-fossa": { ray: ["med", 0.35, 0.3], r: 0.03 },
  "auricular-surface-of-ilium": { ray: ["med", 0.72, 0.38], r: 0.016 },
  "arcuate-line-of-ilium": { rays: [["med", 0.62, 0.52], ["med", 0.5, 0.6], ["med", 0.4, 0.66]], r: 0.006 },
  "ischial-tuberosity": { ext: "inf+0.6post", r: 0.013 },
  "ischial-spine": { ext: "post+0.6med", box: { s: [0.25, 0.42] }, r: 0.006 },
  "greater-sciatic-notch": { ray: ["lat", 0.405, 0.49], r: 0.012, n: "post+lat" },
  "lesser-sciatic-notch": { ray: ["lat", 0.27, 0.76], r: 0.007, n: "post+lat" },
  "obturator-foramen": { rays: [["lat", 0.61, 0.705], ["lat", 0.52, 0.855], ["lat", 0.44, 0.8], ["lat", 0.71, 0.76]], center: true, r: 0.024, n: "lat" },
  "acetabulum": { ray: ["lat", 0.59, 0.66], r: 0.027 },
  "symphysial-surface": { ext: "med", box: { s: [0.05, 0.4] }, r: 0.012 },
  "pubic-tubercle": { ext: "ant+0.5sup+0.3med", box: { m: [0, 0.3] }, r: 0.006 },
  "pecten-pubis": { ridge: { dir: "sup", along: "m", from: 0.12, to: 0.38, k: 4 }, box: { s: [0.15, 0.5] }, r: 0.005, n: "sup+ant" },
};
const H = Object.keys(RULES);
export const CHECKS = [
  { name: "hip", mesh: "hip-bone", views: ["lat", "med", "ant", "post", "sup"], ids: H },
];
