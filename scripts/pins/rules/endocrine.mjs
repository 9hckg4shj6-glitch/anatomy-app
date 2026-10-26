// 甲状腺の部位のピンの規則（scripts/pins/compute.mjs）。前から見た画像（ant）は本人の右が画像の左。
// 甲状腺は1つの形なので、左右の葉も one（折り返さない）で本当の側に打つ。
export const RULES = {
  "right-lobe-of-thyroid": { ray: ["ant", 0.15, 0.55], r: 0.012, one: true },
  "left-lobe-of-thyroid": { ray: ["ant", 0.85, 0.55], r: 0.012, one: true },
  "isthmus-of-thyroid": { ray: ["ant", 0.5, 0.78], r: 0.008, one: true },
  "pyramidal-lobe": { ray: ["ant", 0.5, 0.25], r: 0.008, one: true },
};
export const CHECKS = [
  { name: "thyroid", mesh: "thyroid-gland", views: ["ant", "lat"], ids: ["right-lobe-of-thyroid", "left-lobe-of-thyroid", "isthmus-of-thyroid", "pyramidal-lobe"] },
];
