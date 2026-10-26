// 肺・気管・喉頭の部位のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）。
// 肺尖・肺底は右肺に打ち、アプリで左肺へ折り返す。右肺だけ・左肺だけの部位と、正中の気管・喉頭は one（折り返さない）。
// 右肺の外側から見た画像（lat）は前が画像の右。左肺（side: "left"）の外側は med で見て、前が画像の左。
export const RULES = {
  "apex-of-lung": { ext: "sup", r: 0.02 },
  "base-of-lung": { ray: ["inf", 0.5, 0.5], r: 0.03, n: "inf" },
  // 肺門は右肺で示す（語の parts が右肺だけ。左肺は半透明になり、内側から右肺の内側面を見られる）
  "hilum-of-lung": { ray: ["med", 0.6, 0.42], r: 0.02, n: "med", one: true },
  // 斜裂は左右の肺で高さが違う（左が1cmほど高い）ので、折り返さずに両側に打つ。面の向きでは塗り分けない（ring）
  "oblique-fissure": {
    union: [
      { rays: [["lat", 0.14, 0.42], ["lat", 0.3, 0.508], ["lat", 0.45, 0.59], ["lat", 0.6, 0.673], ["lat", 0.75, 0.755]] },
      { side: "left", rays: [["med", 0.8, 0.407], ["med", 0.65, 0.462], ["med", 0.5, 0.53], ["med", 0.35, 0.607], ["med", 0.2, 0.673]] },
    ],
    r: 0.009, ring: true, one: true,
  },
  "horizontal-fissure": { rays: [["lat", 0.3, 0.475], ["lat", 0.45, 0.485], ["lat", 0.6, 0.492], ["lat", 0.75, 0.497], ["lat", 0.84, 0.5]], r: 0.009, n: "lat", one: true },
  // 左肺の前の縁: 前の部分（a）で、内側（-x）へ最も引っこんだ高さが心切痕、下の端で最も前内側へ出た所が小舌
  "cardiac-notch": { side: "left", notch: { dir: "lat", along: "s", from: 0.3, to: 0.7 }, box: { a: [0.6, 1] }, r: 0.016, n: "ant+lat", one: true },
  "lingula": { side: "left", ext: "lat+ant", box: { s: [0.05, 0.3] }, r: 0.016, one: true },
  "tracheal-bifurcation": { ext: "inf", box: { m: [0.3, 0.7] }, r: 0.012, n: "ant", one: true },
  "laryngeal-prominence": { ext: "ant", box: { m: [0.46, 0.54], s: [0.4, 0.9] }, r: 0.008, one: true },
};
export const CHECKS = [
  { name: "lungs", mesh: "lung", side: "all", views: ["ant", "post", "lat", "med"], ids: ["apex-of-lung", "base-of-lung", "hilum-of-lung", "oblique-fissure", "horizontal-fissure", "cardiac-notch", "lingula"] },
  { name: "right-lung", mesh: "right-lung", views: ["lat", "med"], ids: ["apex-of-lung", "hilum-of-lung", "oblique-fissure", "horizontal-fissure"] },
  { name: "left-lung", mesh: "left-lung", side: "left", views: ["med", "lat", "ant"], ids: ["cardiac-notch", "lingula", "oblique-fissure"] },
  { name: "trachea", mesh: ["trachea", "main-bronchus"], side: "all", views: ["ant"], ids: ["tracheal-bifurcation"] },
  { name: "thyroid-cartilage", mesh: "thyroid-cartilage", side: "all", views: ["ant", "lat"], ids: ["laryngeal-prominence"] },
];
