// 解剖学総論（循環器系・消化器系）の講義に合わせて足した、心臓の面と縁・肝臓の圧痕と肝鎌状間膜のピンの規則（scripts/pins/compute.mjs）。
// 心臓・肝臓は左右の無い器官なので side: "all"・one。ray の座標は確認画像の枠の中の割合（左上が 0,0）。
// 前から見た画像（ant）は本人の右が画像の左。lat は本人の右（-x）から、med は本人の左（+x）から見た画像。
// 肝臓の圧痕の near は、隣の臓器（胃・十二指腸・右結腸曲・右の腎臓・右の副腎・食道）にいちばん近い肝臓の点のかたまりの中心
// （scratchpad で隣の臓器の形との距離を測ったもの。腎臓は Z-Anatomy で分けた形なので za で読んで測った）。
const heart = { side: "all", one: true };
const liver = { one: true };
export const RULES = {
  // 心臓の5つの面（講義: 前面・左肺面・右肺面・横隔面・心底）
  "sternocostal-surface-of-heart": { ...heart, ray: ["ant", 0.55, 0.55], r: 0.025, n: "ant" },
  "diaphragmatic-surface-of-heart": { ...heart, ray: ["inf", 0.5, 0.5], r: 0.022, n: "inf" },
  "right-pulmonary-surface-of-heart": { ...heart, ray: ["lat", 0.6, 0.58], r: 0.018, n: "lat" },
  "left-pulmonary-surface-of-heart": { ...heart, ray: ["med", 0.45, 0.55], r: 0.022, n: "med" },
  "base-of-heart": { ...heart, ray: ["post", 0.5, 0.4], r: 0.022, n: "post" },
  // 縁: 鋭縁（右縁）は胸肋面と横隔面の境（右心室の下の縁）、鈍縁は胸肋面と左肺面の境（左心室）
  "acute-margin": { ...heart, rays: [["ant", 0.25, 0.78], ["ant", 0.4, 0.84], ["ant", 0.55, 0.87], ["ant", 0.7, 0.86]], r: 0.006, n: "inf+ant", ring: true },
  "obtuse-margin": { ...heart, rays: [["ant", 0.82, 0.42], ["ant", 0.87, 0.55], ["ant", 0.9, 0.68], ["ant", 0.9, 0.8]], r: 0.006, n: "med+ant", ring: true },
  // 肝臓の圧痕
  "gastric-impression": { ...liver, near: [0.051, 1.142, 0.14], r: 0.024, n: "inf+med" },
  "esophageal-impression": { ...liver, near: [0.0051, 1.1315, 0.1171], r: 0.007, n: "post" },
  "duodenal-impression": { ...liver, near: [-0.0525, 1.075, 0.1254], r: 0.009, n: "inf" },
  "colic-impression": { ...liver, near: [-0.096, 1.0362, 0.1252], r: 0.014, n: "inf" },
  "renal-impression": { ...liver, near: [-0.0723, 1.063, 0.0807], r: 0.016, n: "inf+post" },
  "suprarenal-impression": { ...liver, near: [-0.0533, 1.077, 0.0859], r: 0.008, n: "post" },
  // 肝鎌状間膜: 横隔面の前で、左葉（S2・S3）と内側区域（S4）の境の線（付着する所）
  "falciform-ligament": { ...liver, union: [
    { seam: { a: "segment iii", b: "segment iv", gap: 0.003, k: 3, axis: 1, center: [0, 1.05, 0.05] } },
    { seam: { a: "segment ii", b: "segment iv", gap: 0.003, k: 3, axis: 2, center: [0, 1.0, 0.1] } },
  ], r: 0.004, n: "sup+ant", ring: true },
};
export const CHECKS = [
  { name: "lec-heart", mesh: "heart", views: ["ant", "inf", "lat", "med", "post"], ids: ["sternocostal-surface-of-heart", "diaphragmatic-surface-of-heart", "right-pulmonary-surface-of-heart", "left-pulmonary-surface-of-heart", "base-of-heart", "acute-margin", "obtuse-margin", "apex-of-heart"], side: "all" },
  { name: "lec-liver", mesh: "liver", views: ["inf", "post", "sup", "ant"], ids: ["gastric-impression", "esophageal-impression", "duodenal-impression", "colic-impression", "renal-impression", "suprarenal-impression", "falciform-ligament", "fissure-for-round-ligament"], side: "all" },
];
