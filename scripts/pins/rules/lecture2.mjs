// 解剖学総論（循環器系・消化器系）の講義に合わせて足した2回目のピンの規則（scripts/pins/compute.mjs）。
// 大動脈洞・動脈円錐、食道の3つの生理的狭窄、十二指腸提筋、回腸口、肝臓の冠状間膜と三角間膜、横隔膜の3つの孔。
// どれも左右の無い器官なので side: "all"・one。near の座標は scratchpad で形どうしの近さを測って決めた
// （食道・下大静脈・大動脈が横隔膜に接する所、回腸が盲腸の部品に入る所、肝臓が後ろで横隔膜に接する範囲＝無漿膜野の縁）。
const one = { side: "all", one: true };
export const RULES = {
  // 上行大動脈の根もと（大動脈弁のすぐ上のふくらみ）
  "aortic-sinus": { ...one, ext: "inf", r: 0.011, n: "ant+lat" },
  // 右心室が肺動脈幹へ続く所（肺動脈幹のいちばん下の接する所）
  "conus-arteriosus": { ...one, near: [0.022, 1.262, 0.146], r: 0.011, n: "ant+med" },
  // 食道の狭窄: 起始部の上端・大動脈弓と左主気管支が押す高さ・食道裂孔を通る所
  "pharyngoesophageal-constriction": { ...one, ext: "sup", r: 0.009, n: "ant" },
  "bronchoaortic-constriction": { ...one, near: [0.012, 1.29, 0.079], r: 0.01, n: "med+ant" },
  "diaphragmatic-constriction": { ...one, near: [0.008, 1.152, 0.098], r: 0.009, n: "ant+med" },
  // 十二指腸空腸曲の上の、提筋が付く所
  "suspensory-muscle-of-duodenum": { ...one, ext: "sup", box: { x: [0.005, 0.04], y: [1.02, 1.075] }, r: 0.008, n: "sup+ant" },
  // 回腸が盲腸の部品（ileocecal junction）に入る所の上の端（上行結腸との境）
  "ileal-orifice": { ...one, near: [-0.0663, 0.9166, 0.1233], r: 0.007, n: "ant+med" },
  // 冠状間膜: 無漿膜野の上の縁（前葉）と下の縁（後葉）を右の端でつないだ列
  "coronary-ligament-of-liver": { ...one, near: [
    [-0.0348, 1.1634, 0.0738], [-0.0445, 1.1766, 0.0847], [-0.055, 1.1803, 0.0894], [-0.0665, 1.1794, 0.0857], [-0.0751, 1.1698, 0.0687],
    [-0.0751, 1.146, 0.0497], [-0.066, 1.1315, 0.0447], [-0.0555, 1.1153, 0.0449], [-0.0469, 1.0982, 0.0519],
  ], r: 0.005, n: "post+sup", ring: true },
  "right-triangular-ligament": { ...one, near: [-0.088, 1.16, 0.058], r: 0.008, n: "post+lat" },
  "left-triangular-ligament": { ...one, ext: "med", box: { y: [1.09, 1.2] }, r: 0.008, n: "sup+post" },
  // 横隔膜の孔: 下大静脈が腱中心を通る所（いちばん高い）・食道が通る形の孔（右脚の間）・左右の脚の間のアーチの頂（大動脈が通る。いちばん低い）
  "caval-opening": { ...one, near: [-0.012, 1.18, 0.11], r: 0.009, n: "sup+ant" },
  "esophageal-hiatus": { ...one, near: [0.009, 1.147, 0.102], r: 0.008, n: "post+sup" },
  "aortic-hiatus": { ...one, near: [0.002, 1.1, 0.108], r: 0.008, n: "post+inf" },
};
export const CHECKS = [
  { name: "lec2-aorta-heart", mesh: ["ascending-aorta", "right-ventricle", "pulmonary-trunk"], views: ["ant", "lat"], ids: ["aortic-sinus", "conus-arteriosus"], side: "all" },
  { name: "lec2-esophagus", mesh: "esophagus", views: ["ant", "med"], ids: ["pharyngoesophageal-constriction", "bronchoaortic-constriction", "diaphragmatic-constriction"], side: "all" },
  { name: "lec2-gut", mesh: ["duodenum", "cecum"], views: ["ant"], ids: ["suspensory-muscle-of-duodenum", "duodenojejunal-flexure", "ileal-orifice"], side: "all" },
  { name: "lec2-liver", mesh: "liver", views: ["post", "sup", "ant"], ids: ["coronary-ligament-of-liver", "right-triangular-ligament", "left-triangular-ligament", "bare-area-of-liver", "falciform-ligament"], side: "all" },
  { name: "lec2-diaphragm", mesh: "diaphragm", views: ["ant", "sup", "post"], ids: ["caval-opening", "esophageal-hiatus", "aortic-hiatus"], side: "all" },
];
