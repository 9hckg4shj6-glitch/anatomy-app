// 腎臓・膀胱・尿道の部位のピンの規則（scripts/pins/compute.mjs）。
// どれも one（左右に折り返さない）。腎門は左右の腎臓それぞれに打つ。
// 尿道の部分の点は、尿道の中心線（前立腺の中・前立腺と尿道海綿体の間・尿道海綿体の中）に近い表面の点。
export const RULES = {
  // 腎臓の内側の縁で、最も外へ引っこんだ所。左の腎臓は右より高いので、折り返さずに左右それぞれに打つ（前から見る）
  "renal-hilum": {
    union: [{ notch: { dir: "med", along: "s", from: 0.35, to: 0.65 } }, { side: "left", notch: { dir: "lat", along: "s", from: 0.35, to: 0.65 } }],
    r: 0.015, n: "ant", ring: true, one: true,
  },
  // 膀胱（横から見て、前上へとがり、後ろ下が広い）
  "apex-of-bladder": { ext: "ant+0.3sup", r: 0.01, one: true },
  "fundus-of-bladder": { ext: "post", box: { s: [0.2, 0.7] }, r: 0.016, one: true },
  "neck-of-bladder": { ext: "inf", r: 0.01, one: true },
  "prostatic-urethra": { near: [[-0.0005, 0.7904, 0.0812], [-0.0008, 0.7797, 0.0842]], r: 0.007, n: "lat", ring: true, one: true },
  "membranous-urethra": { near: [[-0.0006, 0.7709, 0.1007], [-0.0007, 0.7699, 0.1055]], r: 0.006, n: "lat", ring: true, one: true },
  "spongy-urethra": { near: [[0.0003, 0.7705, 0.1212], [-0.0005, 0.7735, 0.1408], [-0.0006, 0.7695, 0.16], [-0.0005, 0.7407, 0.1782], [-0.0007, 0.7191, 0.1827]], r: 0.008, n: "lat", ring: true, one: true },
};
export const CHECKS = [
  { name: "kidney", mesh: "kidney", side: "all", views: ["ant", "med"], ids: ["renal-hilum"] },
  { name: "bladder", mesh: "urinary-bladder", views: ["lat", "ant"], ids: ["apex-of-bladder", "fundus-of-bladder", "neck-of-bladder"] },
  { name: "urethra", mesh: ["urethra", "prostate"], side: "all", views: ["lat"], ids: ["prostatic-urethra", "membranous-urethra", "spongy-urethra"] },
];
