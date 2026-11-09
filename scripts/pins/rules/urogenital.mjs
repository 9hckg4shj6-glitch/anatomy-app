// 腎臓・膀胱・尿道の部位のピンの規則（scripts/pins/compute.mjs）。
// どれも one（左右に折り返さない）。腎門・腎臓の端と面と縁は左右の腎臓それぞれに打つ。
// 尿道の部分の点は、尿道の中心線（前立腺の中・前立腺と尿道海綿体の間・尿道海綿体の中）に近い表面の点。
export const RULES = {
  // 腎臓の内側の縁で、最も外へ引っこんだ所。左の腎臓は右より高いので、折り返さずに左右それぞれに打つ（前から見る）
  "renal-hilum": {
    union: [{ notch: { dir: "med", along: "s", from: 0.35, to: 0.65 } }, { side: "left", notch: { dir: "lat", along: "s", from: 0.35, to: 0.65 } }],
    r: 0.015, n: "ant", ring: true, one: true,
  },
  // 腎臓の端・面・縁（左右それぞれに打つ。左の腎臓の外側は +x なので、右側の向きの言葉では med になる）
  "superior-pole-of-kidney": { union: [{ ext: "sup" }, { side: "left", ext: "sup" }], r: 0.012, one: true },
  "inferior-pole-of-kidney": { union: [{ ext: "inf" }, { side: "left", ext: "inf" }], r: 0.012, one: true },
  "anterior-surface-of-kidney": { union: [{ ext: "ant+0.3lat", box: { s: [0.4, 0.6] } }, { side: "left", ext: "ant+0.3med", box: { s: [0.4, 0.6] } }], r: 0.02, one: true },
  "posterior-surface-of-kidney": { union: [{ ext: "post", box: { s: [0.4, 0.6] } }, { side: "left", ext: "post", box: { s: [0.4, 0.6] } }], r: 0.02, one: true },
  "lateral-border-of-kidney": {
    union: [{ ridge: { dir: "lat", along: "s", from: 0.25, to: 0.75, k: 3 } }, { side: "left", ridge: { dir: "med", along: "s", from: 0.25, to: 0.75, k: 3 } }],
    r: 0.009, one: true,
  },
  // 内側縁は腎門の上と下（腎門そのものは別の語）
  "medial-border-of-kidney": {
    union: [{ ext: "med", box: { s: [0.7, 0.8] } }, { ext: "med", box: { s: [0.2, 0.3] } }, { side: "left", ext: "lat", box: { s: [0.7, 0.8] } }, { side: "left", ext: "lat", box: { s: [0.2, 0.3] } }],
    r: 0.009, one: true,
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
  { name: "kidney-parts", mesh: "kidney", side: "all", views: ["ant", "post"], ids: ["superior-pole-of-kidney", "inferior-pole-of-kidney", "anterior-surface-of-kidney", "posterior-surface-of-kidney", "lateral-border-of-kidney", "medial-border-of-kidney"] },
  { name: "bladder", mesh: "urinary-bladder", views: ["lat", "ant"], ids: ["apex-of-bladder", "fundus-of-bladder", "neck-of-bladder"] },
  { name: "urethra", mesh: ["urethra", "prostate"], side: "all", views: ["lat"], ids: ["prostatic-urethra", "membranous-urethra", "spongy-urethra"] },
];
