// さらに細かい部位（Phase 3 その9）のうち、骨の部位のピンの規則（scripts/pins/compute.mjs）。
// 頭蓋は、頭蓋全体を描いた画像の上の点に当てた3Dの点と、近くの既存のピン（眼窩上孔・棘孔・下顎窩・後頭顆・翼突鈎など）
// からの位置で座標を決め、near（いちばん近い骨の表面の点）にした。体幹と四肢は語の形の確認画像の上の点（ray）と near。
export const RULES = {
  // 頭蓋の外面（縫合の交わる点・孔・突起）
  "pterion": { near: [-0.0639, 1.5489, 0.1155], r: 0.007, n: "lat" },
  "asterion": { near: [-0.0523, 1.5215, 0.0137], r: 0.006, n: "lat+post" },
  "nasion": { one: true, near: [-0.0007, 1.5314, 0.1751], r: 0.004, n: "ant" },
  "external-occipital-crest": { one: true, near: [[0, 1.5060, -0.0020], [0, 1.4980, 0.0130], [0, 1.4900, 0.0300]], r: 0.004, n: "post+inf", cam: "inf+0.8post" },
  "mastoid-foramen": { near: [-0.0470, 1.5030, 0.0250], r: 0.0035, n: "post+lat" },
  "articular-tubercle": { near: [-0.0440, 1.5040, 0.1060], r: 0.005, n: "inf", cam: "inf+0.6lat" },
  "condylar-canal": { near: [-0.0220, 1.4830, 0.0500], r: 0.0035, n: "inf+post", cam: "inf+0.5post" },
  "spine-of-sphenoid": { near: [-0.0330, 1.5030, 0.0900], r: 0.0035, n: "inf", cam: "inf+0.3lat" },
  // 顔面
  "frontal-notch": { near: [-0.0150, 1.5370, 0.1680], r: 0.0035, n: "ant+inf" },
  "canine-fossa": { near: [-0.0250, 1.4800, 0.1620], r: 0.006, n: "ant" },
  "maxillary-tuberosity": { near: [-0.0250, 1.4780, 0.1320], r: 0.005, n: "post", cam: "post+0.5lat+0.5inf" },
  "zygomatic-process-of-maxilla": { near: [-0.0400, 1.4880, 0.1500], r: 0.006, n: "lat+ant" },
  "frontal-process-of-zygomatic-bone": { near: [[-0.0470, 1.5250, 0.1480], [-0.0460, 1.5150, 0.1470]], r: 0.005, n: "lat+ant" },
  "palatine-process-of-maxilla": { near: [[-0.0080, 1.4740, 0.1500], [-0.0090, 1.4740, 0.1580]], r: 0.007, n: "inf" },
  "horizontal-plate-of-palatine-bone": { near: [-0.0080, 1.4750, 0.1320], r: 0.006, n: "inf" },
  "lateral-plate-of-pterygoid-process": { ring: true, near: [[-0.0200, 1.4880, 0.1150], [-0.0210, 1.4960, 0.1100]], r: 0.004, n: "lat", cam: "inf+0.6lat" },
  "medial-plate-of-pterygoid-process": { ring: true, near: [[-0.0130, 1.4870, 0.1170], [-0.0130, 1.4950, 0.1130]], r: 0.004, n: "med", cam: "inf+0.3post" },
  // 鼻腔の壁と頭蓋の内面
  "middle-nasal-concha": { ring: true, near: [[-0.0110, 1.5040, 0.1500], [-0.0110, 1.5020, 0.1380]], r: 0.005, n: "med", cam: "ant+0.6inf" },
  "superior-nasal-concha": { ring: true, near: [-0.0100, 1.5160, 0.1330], r: 0.005, n: "med", cam: "ant+0.6inf" },
  "perpendicular-plate-of-ethmoid": { one: true, ring: true, near: [[0, 1.5150, 0.1450], [0, 1.5050, 0.1480]], r: 0.007, n: "lat", cam: "lat+0.3inf" },
  "lesser-wing-of-sphenoid": { near: [[-0.0180, 1.5340, 0.1120], [-0.0260, 1.5360, 0.1170], [-0.0340, 1.5380, 0.1210]], r: 0.005, n: "sup" },
  "foramen-caecum-of-frontal-bone": { one: true, near: [0, 1.5340, 0.1580], r: 0.0035, n: "sup+post", cam: "sup+0.5post" },
};
// 体幹と上肢（頚椎は第5頚椎、腰椎は第3腰椎の形。椎弓根・前斜角筋結節など既存のピンの近く）
export const RULES2 = {
  "uncus-of-body": { ext: "sup", box: { m: [0.58, 0.72], a: [0.5, 0.85] }, r: 0.003, n: "sup+lat" },
  "anterior-tubercle-of-cervical-vertebra": { ext: "lat+0.4ant", box: { a: [0.55, 1] }, r: 0.003, n: "lat+ant" },
  "posterior-tubercle-of-cervical-vertebra": { near: [-0.0275, 1.4079, 0.0770], r: 0.003, n: "lat+post" },
  "groove-for-spinal-nerve": { ray: ["sup", 0.14, 0.74], r: 0.003, n: "sup" },
  "superior-vertebral-notch": { near: [-0.0163, 1.0125, 0.0784], r: 0.004, n: "sup", cam: "lat+0.4sup" },
  "inferior-vertebral-notch": { near: [-0.0163, 0.9880, 0.0784], r: 0.005, n: "inf", cam: "lat+0.4inf" },
  "costal-notches": { ring: true, ridge: { dir: "lat", along: "s", from: 0.25, to: 0.92, k: 7 }, r: 0.004, n: "lat+ant" },
  "groove-for-subclavian-vein": { near: [[-0.0551, 1.3235, 0.1166], [-0.0520, 1.3234, 0.1189]], r: 0.004, n: "sup" },
  "tuberosity-for-serratus-anterior": { ext: "lat", r: 0.007, n: "lat" },
  // 上から見た前の縁（肩甲棘より前）の点。上角から外側へ下りていく
  "superior-border-of-scapula": { near: [[-0.0825, 1.3208, 0.0314], [-0.0927, 1.3195, 0.0389], [-0.1016, 1.3180, 0.0451]], r: 0.004, n: "sup+ant" },
  "acromial-angle": { ext: "post+lat", box: { s: [0.85, 1] }, r: 0.005, n: "post+lat" },
  "pronator-tuberosity": { ext: "lat", box: { s: [0.5, 0.6] }, r: 0.006, n: "lat" },
  // 下肢
  "posterior-gluteal-line": { rays: [["lat", 0.2, 0.18], ["lat", 0.21, 0.3], ["lat", 0.22, 0.4]], r: 0.004, n: "lat" },
  "anterior-gluteal-line": { rays: [["lat", 0.62, 0.15], ["lat", 0.52, 0.28], ["lat", 0.42, 0.4], ["lat", 0.35, 0.45]], r: 0.004, n: "lat" },
  "inferior-gluteal-line": { rays: [["lat", 0.72, 0.45], ["lat", 0.6, 0.5], ["lat", 0.48, 0.56]], r: 0.004, n: "lat" },
  "iliac-tuberosity": { near: [-0.0470, 0.9000, 0.0180], r: 0.009, n: "med" },
  "obturator-groove": { near: [-0.0420, 0.8060, 0.0920], r: 0.005, n: "inf", cam: "inf+0.5ant+0.3lat" },
  "medial-supracondylar-line": { ridge: { dir: "post+med", along: "s", from: 0.12, to: 0.28, k: 3 }, r: 0.004 },
  "lateral-supracondylar-line": { ridge: { dir: "post+lat", along: "s", from: 0.12, to: 0.28, k: 3 }, r: 0.004 },
  "anterior-intercondylar-area": { ray: ["sup", 0.5, 0.72], r: 0.006, n: "sup" },
  "posterior-intercondylar-area": { ray: ["sup", 0.45, 0.14], r: 0.005, n: "sup+post" },
  "medial-intercondylar-tubercle": { ext: "sup", box: { m: [0.38, 0.5], a: [0.3, 0.7] }, r: 0.004, n: "sup" },
  "lateral-intercondylar-tubercle": { ext: "sup", box: { m: [0.5, 0.62], a: [0.3, 0.7] }, r: 0.004, n: "sup" },
  "apex-of-head-of-fibula": { ext: "sup", r: 0.004, n: "sup" },
  "lateral-process-of-talus": { ext: "lat+0.6inf", box: { a: [0.2, 0.6] }, r: 0.005, n: "lat" },
  "groove-for-tendon-of-flexor-hallucis-longus": { near: [-0.0635, -0.0200, 0.0490], r: 0.004, n: "post", cam: "post+0.4med" },
  "tuberosity-of-cuboid": { near: [-0.0950, -0.0520, 0.0920], r: 0.005, n: "inf", cam: "inf+0.4lat" },
};
export const CHECKS = [
  { name: "more-skull-lat", mesh: "skull-all", views: ["lat"], ids: ["pterion", "asterion", "mastoid-foramen", "zygomatic-process-of-maxilla", "frontal-process-of-zygomatic-bone", "canine-fossa", "maxillary-tuberosity", "articular-tubercle"] },
  { name: "more-skull-ant", mesh: "skull-all", views: ["ant"], ids: ["nasion", "frontal-notch", "canine-fossa", "zygomatic-process-of-maxilla", "frontal-process-of-zygomatic-bone", "middle-nasal-concha", "perpendicular-plate-of-ethmoid"], side: "all" },
  { name: "more-skull-inf", mesh: "skull-all", only: ["frontal", "parietal", "temporal", "occipital", "sphenoid", "ethmoid", "maxilla", "zygomatic", "nasal", "lacrimal", "palatine", "vomer", "concha"], views: ["inf"], crop: [0.1, 0.05, 0.9, 0.85], ids: ["external-occipital-crest", "condylar-canal", "spine-of-sphenoid", "articular-tubercle", "palatine-process-of-maxilla", "horizontal-plate-of-palatine-bone", "lateral-plate-of-pterygoid-process", "medial-plate-of-pterygoid-process", "maxillary-tuberosity", "mastoid-foramen"], side: "all" },
  { name: "more-skull-inner", mesh: "skull-all", views: ["sup", "med"], ids: ["lesser-wing-of-sphenoid", "foramen-caecum-of-frontal-bone", "middle-nasal-concha", "superior-nasal-concha", "perpendicular-plate-of-ethmoid"], half: true },
  { name: "more-ethmoid", mesh: "ethmoid-bone", views: ["ant", "med", "inf"], ids: ["middle-nasal-concha", "superior-nasal-concha", "perpendicular-plate-of-ethmoid"], side: "all" },
  { name: "more-skull-zoom", mesh: "skull-all", only: ["frontal", "parietal", "temporal", "occipital", "sphenoid", "ethmoid", "maxilla", "zygomatic", "nasal", "lacrimal", "palatine", "vomer", "concha"], views: ["inf"], crop: [0.15, 0.3, 0.6, 0.95], ids: ["external-occipital-crest", "condylar-canal", "spine-of-sphenoid", "articular-tubercle", "lateral-plate-of-pterygoid-process", "medial-plate-of-pterygoid-process", "mastoid-foramen", "foramen-spinosum", "occipital-condyle", "mandibular-fossa"], side: "all" },
  { name: "more-c5", mesh: "fifth-cervical-vertebra", views: ["sup", "ant"], ids: ["uncus-of-body", "anterior-tubercle-of-cervical-vertebra", "posterior-tubercle-of-cervical-vertebra", "groove-for-spinal-nerve"], side: "all" },
  { name: "more-l3", mesh: "third-lumbar-vertebra", views: ["lat"], ids: ["superior-vertebral-notch", "inferior-vertebral-notch", "pedicle-of-vertebral-arch"] },
  { name: "more-thorax", mesh: ["sternum", "first-rib", "second-rib"], views: ["ant", "sup"], ids: ["costal-notches", "groove-for-subclavian-vein", "tuberosity-for-serratus-anterior", "scalene-tubercle", "groove-for-subclavian-artery"] },
  { name: "more-scapula", mesh: "scapula", views: ["post", "sup"], ids: ["superior-border-of-scapula", "acromial-angle", "superior-angle-of-scapula", "suprascapular-notch"] },
  { name: "more-radius", mesh: "radius", views: ["lat"], ids: ["pronator-tuberosity", "radial-tuberosity"] },
  { name: "more-hip", mesh: "hip-bone", views: ["lat", "med"], ids: ["posterior-gluteal-line", "anterior-gluteal-line", "inferior-gluteal-line", "iliac-tuberosity", "obturator-groove", "auricular-surface-of-ilium"] },
  { name: "more-femur", mesh: "femur", views: ["post"], crop: [0, 0.6, 1, 1], ids: ["medial-supracondylar-line", "lateral-supracondylar-line", "adductor-tubercle", "linea-aspera"] },
  { name: "more-tibia", mesh: ["tibia", "fibula"], views: ["sup", "lat"], ids: ["anterior-intercondylar-area", "posterior-intercondylar-area", "medial-intercondylar-tubercle", "lateral-intercondylar-tubercle", "intercondylar-eminence", "apex-of-head-of-fibula"] },
  { name: "more-foot", mesh: ["talus", "calcaneus", "cuboid"], views: ["lat", "post", "inf"], ids: ["lateral-process-of-talus", "groove-for-tendon-of-flexor-hallucis-longus", "tuberosity-of-cuboid", "posterior-process-of-talus", "groove-for-fibularis-longus"] },
];
