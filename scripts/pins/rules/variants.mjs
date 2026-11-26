// 骨学実習の手引きにあって語の無かった骨（変異の骨・発生のときの骨）のピンの規則（scripts/pins/compute.mjs）。
// どれも BodyParts3D の頭蓋・椎骨には形が無いので、現れる場所（縫合・プテリオン・後頭鱗の上部・頬骨の外面・口蓋の前の端・横突起）を示す。
// 同じ所の部位（ラムダ縫合・プテリオン・鱗状縫合など）より半径を少し小さくし、3Dをタップしたときはふつうの部位の方を選ぶようにする
// （src/landmarks.ts の landmarkAt は「近さ÷半径」で比べる）。範囲が重なる部位は4択に並ばない（nestedLandmarks）。
export const RULES = {
  // 頭蓋（座標は頭蓋全体を描いた確認画像と、ラムダ縫合・プテリオン・鱗状縫合・ブレグマ・ラムダのピンから）
  "sutural-bones": {
    near: [[-0.0568, 1.5267, 0.0151], [-0.0525, 1.5396, 0.0036], [-0.0466, 1.5507, -0.004], [-0.0337, 1.5621, -0.0135], [-0.0153, 1.5735, -0.0128]],
    r: 0.0055, n: "post+0.5sup",
  },
  "fontanelle-bones": { one: true, near: [[0, 1.6299, 0.1123], [0, 1.5933, -0.0063]], r: 0.0055, n: "sup+0.4post" },
  "interparietal-bone": { one: true, near: [[0, 1.586, -0.0115], [0, 1.578, -0.0145]], r: 0.0075, n: "post+0.3sup" },
  // 後頭鱗は薄いので、外から近い点をとる（骨の中の点から近づけると内面に落ちる）
  "inca-bone": { near: [[0, 1.556, -0.03], [-0.02, 1.552, -0.027], [-0.036, 1.542, -0.02]], r: 0.0105, n: "post" },
  "epipteric-bone": { near: [-0.0547, 1.5459, 0.1255], r: 0.0055, n: "lat" },
  "parietal-notch-bone": { near: [-0.0686, 1.5225, 0.0542], r: 0.0045, n: "lat" },
  // 頬骨の体の下3分の1を前後に横切る線（上の大きい部分と下の小さい部分の境。頬骨上顎縫合の側から側頭突起の根もとへ）
  "bipartite-zygomatic-bone": { near: [[-0.0421, 1.4935, 0.1584], [-0.0481, 1.4935, 0.1533], [-0.0535, 1.495, 0.1464], [-0.058, 1.497, 0.1386]], r: 0.0035, n: "lat+ant" },
  // 切歯窩の前から、側切歯と犬歯の間（切歯縫合の外側の端）までの口蓋の前の三角形
  "incisive-bone": { near: [[-0.0018, 1.4717, 0.1656], [-0.0018, 1.4686, 0.171], [-0.004, 1.4677, 0.1697], [-0.0089, 1.4659, 0.1704]], r: 0.0045, n: "inf", cam: "inf+0.4ant" },
  // 椎骨（第7頚椎の横突起の前の部分・第1腰椎の肋骨突起）
  // 頚肋: 横突起の先と、横突孔の前の棒（前結節につづく肋骨にあたる部分）。m は 0＝左の端・1＝右の端（正中の骨なので骨全体の割合）
  "cervical-rib": { union: [{ ext: "lat+0.6ant" }, { ext: "ant", box: { m: [0.76, 0.86] } }], r: 0.005, n: "ant+lat" },
  // 腰肋: 肋骨突起の先と中ほど
  "lumbar-rib": { union: [{ ext: "lat" }, { ext: "lat", box: { m: [0, 0.86] } }], r: 0.007, n: "lat+post", ring: true },
};

export const CHECKS = [
  { name: "var-skull-post", mesh: "skull-all", views: ["post", "sup"], ids: ["sutural-bones", "fontanelle-bones", "interparietal-bone", "inca-bone", "lambdoid-suture", "lambda", "external-occipital-protuberance"] },
  { name: "var-skull-lat", mesh: "skull-all", views: ["lat"], crop: [0.05, 0.2, 0.95, 0.85], ids: ["epipteric-bone", "parietal-notch-bone", "bipartite-zygomatic-bone", "pterion", "squamous-suture", "parietomastoid-suture", "asterion", "zygomaticofacial-foramen"] },
  { name: "var-skull-inf", mesh: "skull-all", only: ["maxilla", "palatine"], views: ["inf"], ids: ["incisive-bone", "incisive-fossa", "median-palatine-suture", "palatine-process-of-maxilla"], side: "all" },
  { name: "var-c7", mesh: "vertebra-prominens", views: ["sup", "ant"], ids: ["cervical-rib"], side: "all" },
  { name: "var-l1", mesh: "first-lumbar-vertebra", views: ["sup", "post"], ids: ["lumbar-rib"], side: "all" },
];
