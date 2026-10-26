// 胃・十二指腸・結腸・肝臓・膵臓・舌の部位のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）。
// どれも左右の無い器官なので one（左右に折り返さない）。前から見た画像（ant）は本人の右が画像の左。
export const RULES = {
  // 胃（前から見て、食道の残りが左上、幽門が左下の先、大弯が右へふくらむ）
  "cardia": { ray: ["ant", 0.4, 0.31], r: 0.012, one: true },
  "fundus-of-stomach": { ray: ["ant", 0.56, 0.14], r: 0.02, n: "ant+sup", one: true },
  "body-of-stomach": { ray: ["ant", 0.62, 0.52], r: 0.024, one: true },
  "pyloric-part": { ray: ["ant", 0.27, 0.8], r: 0.016, one: true },
  "pylorus": { ext: "lat", r: 0.01, one: true },
  "lesser-curvature": { rays: [["ant", 0.44, 0.4], ["ant", 0.43, 0.54], ["ant", 0.35, 0.64], ["ant", 0.22, 0.68]], r: 0.008, one: true },
  "greater-curvature": { rays: [["ant", 0.74, 0.18], ["ant", 0.88, 0.36], ["ant", 0.88, 0.55], ["ant", 0.79, 0.75], ["ant", 0.6, 0.88], ["ant", 0.38, 0.89], ["ant", 0.2, 0.84]], r: 0.009, one: true },
  "angular-incisure": { ray: ["ant", 0.41, 0.6], r: 0.009, one: true },
  // 十二指腸（前から見て C字。上部が上、下行部が左、水平部が下、上行部が右下から右上へ）
  "superior-part-of-duodenum": { ray: ["ant", 0.3, 0.15], r: 0.014, one: true },
  "descending-part-of-duodenum": { ray: ["ant", 0.12, 0.52], r: 0.016, one: true },
  "horizontal-part-of-duodenum": { ray: ["ant", 0.32, 0.88], r: 0.014, one: true },
  "ascending-part-of-duodenum": { ray: ["ant", 0.62, 0.7], r: 0.013, one: true },
  "duodenojejunal-flexure": { ray: ["ant", 0.82, 0.52], r: 0.011, one: true },
  // 結腸（前から見て額縁形。右結腸曲が左上、左結腸曲が右上）
  "right-colic-flexure": { ray: ["ant", 0.16, 0.2], r: 0.025, one: true },
  "left-colic-flexure": { ray: ["ant", 0.8, 0.13], r: 0.02, one: true },
  // 肝臓（下から見た画像 inf は前が上、本人の右が画像の左）。肝門は下面の中央の血管の出入口
  "porta-hepatis": { ray: ["inf", 0.46, 0.38], r: 0.015, n: "inf", one: true },
  // 膵臓（前から見て、膵頭が左、膵尾が右上）
  "head-of-pancreas": { ray: ["ant", 0.14, 0.55], r: 0.018, one: true },
  "uncinate-process": { ray: ["ant", 0.34, 0.76], r: 0.009, one: true },
  "body-of-pancreas": { ray: ["ant", 0.55, 0.36], r: 0.018, one: true },
  "tail-of-pancreas": { ray: ["ant", 0.86, 0.2], r: 0.016, one: true },
  // 舌（上から見た画像 sup は前が下）
  "apex-of-tongue": { ext: "ant", r: 0.01, one: true },
  "body-of-tongue": { ray: ["sup", 0.5, 0.62], r: 0.014, n: "sup", one: true },
  "root-of-tongue": { ray: ["sup", 0.5, 0.14], r: 0.012, n: "sup+post", one: true },
};
export const CHECKS = [
  { name: "stomach", mesh: "stomach", views: ["ant", "post"], ids: ["cardia", "fundus-of-stomach", "body-of-stomach", "pyloric-part", "pylorus", "lesser-curvature", "greater-curvature", "angular-incisure"] },
  { name: "duodenum", mesh: "duodenum", views: ["ant"], ids: ["superior-part-of-duodenum", "descending-part-of-duodenum", "horizontal-part-of-duodenum", "ascending-part-of-duodenum", "duodenojejunal-flexure"] },
  { name: "colon", mesh: "colon", views: ["ant"], ids: ["right-colic-flexure", "left-colic-flexure"] },
  { name: "liver", mesh: "liver", views: ["inf", "ant"], ids: ["porta-hepatis"] },
  { name: "pancreas", mesh: "pancreas", views: ["ant", "post"], ids: ["head-of-pancreas", "uncinate-process", "body-of-pancreas", "tail-of-pancreas"] },
  { name: "tongue", mesh: "tongue", views: ["sup", "lat"], ids: ["apex-of-tongue", "body-of-tongue", "root-of-tongue"] },
];
