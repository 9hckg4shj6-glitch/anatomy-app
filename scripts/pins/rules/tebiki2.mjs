// 骨学実習の手引きによる見直し その2（Phase 3 その11）の骨の部位のピンの規則（scripts/pins/compute.mjs）。
// 関節面（環椎の下関節窩・軸椎の上関節面・踵骨の距骨関節面・距骨の内果面と外果面・脛骨の下関節面・尺骨の関節環状面）は、
// 向き合う骨に 4〜5mm 以内の表面の点のかたまりの中心（scratchpad の contact.mjs で求めた座標）を near に書いた。
const metacarpal = ["first", "second", "third", "fourth", "fifth"].map((n) => `${n} metacarpal bone`);
const metatarsal = ["first", "second", "third", "fourth", "fifth"].map((n) => `${n} metatarsal bone`);
const finger = ["thumb", "index finger", "middle finger", "ring finger", "little finger"].map((n) => `distal phalanx of ${n}`);

export const RULES = {
  // 環椎・軸椎・尾骨・肋骨
  "anterior-tubercle-of-atlas": { ext: "ant", box: { m: [0.45, 0.55] }, r: 0.004, n: "ant" },
  "posterior-tubercle-of-atlas": { ext: "post", box: { m: [0.45, 0.55] }, r: 0.005, n: "post" },
  "inferior-articular-facet-of-atlas": { near: [[-0.0226, 1.463, 0.0739], [-0.0165, 1.4655, 0.0775]], r: 0.005, n: "inf" },
  "superior-articular-facet-of-axis": { near: [[-0.0204, 1.46, 0.0753], [-0.014, 1.4635, 0.0765]], r: 0.005, n: "sup" },
  "coccygeal-cornu": { ray: ["post", 0.7, 0.32], r: 0.004, n: "post+sup" },
  "body-of-rib": { union: [{ ext: "lat" }, { ext: "lat+0.5ant" }, { ext: "lat+0.5post" }], r: 0.008, n: "lat", ring: true },
  // 肩甲骨・尺骨・手
  "costal-surface-of-scapula": { rays: [["ant", 0.55, 0.35], ["ant", 0.6, 0.55], ["ant", 0.63, 0.72]], r: 0.016, n: "ant" },
  "posterior-surface-of-scapula": { rays: [["post", 0.24, 0.22], ["post", 0.35, 0.5], ["post", 0.3, 0.75]], r: 0.016, n: "post" },
  "articular-circumference-of-ulna": { near: [[-0.2457, 0.8141, 0.1156], [-0.2451, 0.8198, 0.1175]], r: 0.005, n: "lat" },
  "base-of-metacarpal": { union: metacarpal.map((part) => ({ part, ext: "ant+1.5sup", box: { s: [0.75, 1] } })), r: 0.006, n: "ant+sup" },
  "tuberosity-of-distal-phalanx-of-hand": { union: finger.map((part) => ({ part, ext: "inf" })), r: 0.004, n: "inf+ant" },
  // 寛骨・大腿骨・下腿・足
  "gluteal-surface-of-ilium": { rays: [["lat", 0.33, 0.3], ["lat", 0.5, 0.28], ["lat", 0.58, 0.42]], r: 0.013, n: "lat" },
  "intercondylar-line": { near: [[-0.07, 0.393, 0.076], [-0.0787, 0.395, 0.076], [-0.087, 0.393, 0.076]], r: 0.004, n: "post" },
  "inferior-articular-surface-of-tibia": { near: [[-0.0647, 0.0041, 0.0847], [-0.069, 0.003, 0.0735], [-0.0749, 0.0022, 0.0617]], r: 0.006, n: "inf" },
  "anterior-border-of-fibula": { ridge: { dir: "ant", along: "s", from: 0.3, to: 0.7, k: 4 }, r: 0.003 },
  "posterior-border-of-fibula": { ridge: { dir: "post+0.6lat", along: "s", from: 0.3, to: 0.7, k: 4 }, r: 0.003 },
  "medial-crest-of-fibula": { ridge: { dir: "post+med", along: "s", from: 0.3, to: 0.6, k: 3 }, r: 0.003 },
  "posterior-talar-articular-surface": { near: [[-0.0844, -0.0285, 0.0635], [-0.0745, -0.026, 0.0585], [-0.0654, -0.0233, 0.0533]], r: 0.007, n: "sup" },
  "middle-talar-articular-surface": { near: [-0.0641, -0.0255, 0.0766], r: 0.006, n: "sup" },
  "anterior-talar-articular-surface": { near: [-0.0745, -0.0288, 0.0882], r: 0.005, n: "sup" },
  "lateral-malleolar-surface-of-talus": { near: [[-0.0871, -0.0153, 0.0644], [-0.0882, -0.0069, 0.0716]], r: 0.006, n: "lat" },
  "medial-malleolar-surface-of-talus": { near: [[-0.0556, -0.005, 0.073], [-0.0587, -0.0066, 0.0847]], r: 0.005, n: "med" },
  "base-of-metatarsal": { union: metatarsal.map((part) => ({ part, ext: "sup+post", box: { a: [0, 0.25] } })), r: 0.006, n: "sup+post" },
};

// 頭蓋。縫合は頭蓋全体を描いた画像の上で骨の境目（光線がいちばん手前で当たる骨が変わる所）を読み、その点を near に書いた
// （scratchpad の bonemap.mjs・uv2xyz.mjs）。頭蓋の内面の点は、頭の中から外へ出した光線が最初に当たる骨の面（inner.mjs）。
export const RULES2 = {
  // 頭蓋の骨の区分
  "squamous-part-of-frontal-bone": { near: [[-0.02, 1.585, 0.17], [0, 1.6, 0.16], [-0.035, 1.565, 0.1703]], r: 0.014, n: "ant" },
  "orbital-part-of-frontal-bone": { near: [[-0.03, 1.5444, 0.1559], [-0.026, 1.538, 0.138]], r: 0.007, n: "inf", cam: "ant+0.8inf" },
  "zygomatic-process-of-frontal-bone": { near: [-0.0529, 1.537, 0.152], r: 0.005, n: "lat+ant" },
  "squamous-part-of-occipital-bone": { near: [[-0.015, 1.49, 0.02], [-0.03, 1.53, -0.012], [-0.015, 1.56, -0.015]], r: 0.012, n: "post" },
  "lateral-part-of-occipital-bone": { near: [-0.026, 1.485, 0.058], r: 0.007, n: "inf", cam: "inf+0.3lat" },
  "basilar-part-of-occipital-bone": { near: [[-0.004, 1.4867, 0.081], [-0.004, 1.4952, 0.092]], r: 0.006, n: "inf", cam: "inf+0.3post" },
  "jugular-process": { near: [-0.037, 1.4862, 0.06], r: 0.005, n: "inf", cam: "inf+0.3lat" },
  "body-of-sphenoid": { near: [[-0.004, 1.506, 0.11], [-0.0125, 1.512, 0.104]], r: 0.007, n: "inf", cam: "inf+0.5post" },
  "squamous-part-of-temporal-bone": { near: [[-0.0705, 1.53, 0.075], [-0.0613, 1.52, 0.095]], r: 0.012, n: "lat" },
  "tympanic-part-of-temporal-bone": { near: [-0.047, 1.497, 0.087], r: 0.005, n: "inf+lat", cam: "inf+0.6lat" },
  "body-of-maxilla": { near: [-0.03, 1.49, 0.158], r: 0.012, n: "ant+0.3lat" },
  "orbital-plate-of-ethmoid": { near: [[-0.0159, 1.515, 0.14], [-0.016, 1.514, 0.132]], r: 0.006, n: "lat", cam: "ant+0.5lat" },
  "perpendicular-plate-of-palatine-bone": { near: [[-0.0123, 1.49, 0.13], [-0.01, 1.495, 0.125]], r: 0.005, n: "med", cam: "med+0.3ant" },
  // 縫合と外面
  "sphenofrontal-suture": { near: [[-0.0528, 1.5477, 0.1284], [-0.051, 1.545, 0.1315], [-0.0472, 1.5407, 0.1335], [-0.0452, 1.5376, 0.1357]], r: 0.004, n: "lat" },
  "sphenoparietal-suture": { near: [[-0.0557, 1.5444, 0.1236], [-0.0547, 1.5459, 0.1255], [-0.0533, 1.5478, 0.1271]], r: 0.004, n: "lat" },
  "sphenosquamous-suture": { near: [[-0.0559, 1.5424, 0.1217], [-0.0553, 1.5363, 0.1217], [-0.0552, 1.5294, 0.1233], [-0.052, 1.5232, 0.1255]], r: 0.004, n: "lat" },
  "occipitomastoid-suture": { near: [[-0.0629, 1.5132, 0.0366], [-0.0609, 1.5057, 0.0383], [-0.0552, 1.4983, 0.0415], [-0.0509, 1.4933, 0.0443]], r: 0.004, n: "lat+post" },
  "parietomastoid-suture": { near: [[-0.0649, 1.5182, 0.0399], [-0.0668, 1.5191, 0.0454], [-0.0673, 1.5201, 0.0497]], r: 0.004, n: "lat" },
  "median-palatine-suture": { one: true, near: [[0, 1.4747, 0.1592], [0, 1.4756, 0.1471], [0, 1.4753, 0.1374], [0, 1.4756, 0.1313]], r: 0.003, n: "inf" },
  "transverse-palatine-suture": { near: [[-0.0024, 1.4756, 0.1478], [-0.0086, 1.4756, 0.1451], [-0.0147, 1.4756, 0.1417], [-0.0174, 1.4741, 0.135]], r: 0.003, n: "inf" },
  "parietal-foramen": { near: [-0.007, 1.628, 0.03], r: 0.0035, n: "sup+post" },
  "highest-nuchal-line": { near: [[-0.006, 1.515, -0.0102], [-0.0145, 1.52, -0.0121], [-0.0247, 1.519, -0.0088], [-0.0349, 1.514, 0.0021]], r: 0.004, n: "post" },
  "occipital-groove": { near: [-0.033, 1.494, 0.04], r: 0.004, n: "inf", cam: "inf+0.4post" },
  "petrotympanic-fissure": { near: [-0.04, 1.505, 0.0885], r: 0.0035, n: "inf", cam: "inf+0.3lat" },
  // 内頭蓋底と頭蓋冠の内面
  "posterior-clinoid-process": { near: [-0.006, 1.5315, 0.0965], r: 0.0035, n: "sup+post", cam: "sup+0.3post" },
  "apex-of-petrous-part": { near: [-0.016, 1.511, 0.0935], r: 0.004, n: "sup", cam: "sup+0.3post" },
  "superior-border-of-petrous-part": { near: [[-0.0398, 1.5196, 0.0798], [-0.0291, 1.5165, 0.0844], [-0.0184, 1.513, 0.0901]], r: 0.004, n: "sup", cam: "sup+0.4post" },
  "tegmen-tympani": { near: [-0.046, 1.514, 0.088], r: 0.005, n: "sup", cam: "sup" },
  "groove-for-superior-petrosal-sinus": { near: [[-0.039, 1.518, 0.0775], [-0.029, 1.5145, 0.082], [-0.02, 1.5115, 0.0875]], r: 0.003, n: "post+sup", cam: "sup+0.5post" },
  "groove-for-inferior-petrosal-sinus": { near: [[-0.03, 1.504, 0.079], [-0.022, 1.506, 0.086]], r: 0.003, n: "sup+post", cam: "sup+0.5post" },
  "cruciform-eminence": { near: [[0, 1.5554, -0.0107], [0, 1.53, -0.0089], [0, 1.5103, 0.0072], [-0.027, 1.5255, -0.005]], r: 0.005, n: "ant", cam: "ant+0.6sup" },
  "grooves-for-arteries": { near: [[-0.0571, 1.55, 0.118], [-0.0635, 1.57, 0.112], [-0.0498, 1.6049, 0.104], [-0.0683, 1.555, 0.09], [-0.0681, 1.5886, 0.07]], r: 0.005, n: "med", cam: "0.6med+inf" },
  // 眼窩・鼻腔・翼口蓋窩の孔と管
  "anterior-ethmoidal-foramen": { near: [-0.0145, 1.522, 0.148], r: 0.003, n: "lat", cam: "ant+0.5lat" },
  "posterior-ethmoidal-foramen": { near: [-0.014, 1.522, 0.132], r: 0.003, n: "lat", cam: "ant+0.5lat" },
  "infra-orbital-groove": { near: [[-0.03, 1.5024, 0.14], [-0.03, 1.5008, 0.15]], r: 0.004, n: "sup", cam: "ant+sup" },
  "zygomaticofacial-foramen": { near: [-0.048, 1.502, 0.153], r: 0.003, n: "lat+ant" },
  "sphenopalatine-foramen": { near: [-0.0101, 1.5007, 0.1197], r: 0.004, n: "med", cam: "med+0.3ant" },
  "pterygoid-canal": { near: [-0.0135, 1.506, 0.1015], r: 0.003, n: "post+inf", cam: "inf+post" },
  "pterygoid-fossa": { near: [-0.0168, 1.497, 0.114], r: 0.004, n: "post+inf", cam: "post+inf" },
  "posterior-nasal-spine": { one: true, near: [0, 1.4762, 0.1293], r: 0.003, n: "post+inf", cam: "inf+0.5post" },
  "musculotubal-canal": { near: [-0.026, 1.4979, 0.091], r: 0.003, n: "inf", cam: "inf" },
  // 下顎骨（正中の骨。m は 0.5 が正中、本人の右が 1。s は下→上、a は後ろ→前）
  "alveolar-part-of-mandible": { ridge: { dir: "sup", along: "a", from: 0.5, to: 0.85, k: 3 }, box: { m: [0.5, 1] }, r: 0.006, n: "sup+lat" },
  "mylohyoid-groove": { union: [{ fromMid: { s: 0.48, a: 0.3 } }, { fromMid: { s: 0.4, a: 0.38 } }], r: 0.003, n: "med", cam: "0.55med+0.55inf+0.6post" },
  "sublingual-fossa": { near: [-0.01, 1.447, 0.152], r: 0.006, n: "med", cam: "0.6med+0.75sup+0.2post" },
  "submandibular-fossa": { near: [-0.024, 1.442, 0.122], r: 0.007, n: "med", cam: "0.6med+0.6inf" },
};

const SK = Object.keys(RULES2);
export const CHECKS = [
  { name: "tb2-atlas", mesh: "atlas", views: ["inf", "ant", "post"], ids: ["anterior-tubercle-of-atlas", "posterior-tubercle-of-atlas", "inferior-articular-facet-of-atlas", "superior-articular-facet-of-atlas"], side: "all" },
  { name: "tb2-axis", mesh: "axis", views: ["sup"], ids: ["superior-articular-facet-of-axis", "dens-of-axis"], side: "all" },
  { name: "tb2-coccyx", mesh: "coccyx", views: ["post", "lat"], ids: ["coccygeal-cornu"], side: "all" },
  { name: "tb2-rib", mesh: "sixth-rib", views: ["sup", "lat"], ids: ["body-of-rib", "head-of-rib", "tubercle-of-rib", "angle-of-rib"] },
  { name: "tb2-scapula", mesh: "scapula", views: ["ant", "post"], ids: ["costal-surface-of-scapula", "posterior-surface-of-scapula", "spine-of-scapula"] },
  { name: "tb2-ulna", mesh: ["ulna", "radius"], views: ["ant", "lat"], crop: [0, 0.85, 1, 1], ids: ["articular-circumference-of-ulna", "head-of-ulna", "ulnar-notch-of-radius", "ulnar-styloid-process"] },
  { name: "tb2-hand", mesh: ["metacarpals", "distal-phalanges-of-hand"], views: ["ant", "lat"], ids: ["base-of-metacarpal", "head-of-metacarpal", "tuberosity-of-distal-phalanx-of-hand"] },
  { name: "tb2-hip", mesh: "hip-bone", views: ["lat"], ids: ["gluteal-surface-of-ilium", "anterior-gluteal-line", "posterior-gluteal-line", "inferior-gluteal-line"] },
  { name: "tb2-femur", mesh: "femur", views: ["post"], crop: [0, 0.75, 1, 1], ids: ["intercondylar-line", "intercondylar-fossa", "popliteal-surface"] },
  { name: "tb2-tibia", mesh: "tibia", views: ["inf"], ids: ["inferior-articular-surface-of-tibia", "articular-facet-of-medial-malleolus", "fibular-notch"] },
  { name: "tb2-fibula", mesh: "fibula", views: ["ant", "post", "med"], crop: [0, 0.35, 1, 0.65], ids: ["anterior-border-of-fibula", "posterior-border-of-fibula", "medial-crest-of-fibula", "interosseous-border-of-fibula"] },
  { name: "tb2-calc", mesh: "calcaneus", views: ["sup", "med"], ids: ["posterior-talar-articular-surface", "middle-talar-articular-surface", "anterior-talar-articular-surface", "sustentaculum-tali", "tarsal-sinus"] },
  { name: "tb2-talus", mesh: "talus", views: ["lat", "med", "sup"], ids: ["lateral-malleolar-surface-of-talus", "medial-malleolar-surface-of-talus", "trochlea-of-talus", "head-of-talus"] },
  { name: "tb2-skull-lat", mesh: "skull-all", views: ["lat"], crop: [0.05, 0.2, 0.95, 0.85], ids: ["sphenofrontal-suture", "sphenoparietal-suture", "sphenosquamous-suture", "occipitomastoid-suture", "parietomastoid-suture", "pterion", "asterion", "squamous-part-of-temporal-bone", "zygomaticofacial-foramen", "zygomatic-process-of-frontal-bone", "squamous-part-of-frontal-bone", "body-of-maxilla", "squamous-suture", "lambdoid-suture"] },
  { name: "tb2-skull-inf", mesh: "skull-all", only: ["frontal", "parietal", "temporal", "occipital", "sphenoid", "ethmoid", "maxilla", "zygomatic", "nasal", "lacrimal", "palatine", "vomer", "concha"], views: ["inf"], crop: [0.15, 0.1, 0.6, 0.75], ids: ["median-palatine-suture", "transverse-palatine-suture", "posterior-nasal-spine", "pterygoid-fossa", "pterygoid-canal", "basilar-part-of-occipital-bone", "lateral-part-of-occipital-bone", "jugular-process", "occipital-groove", "petrotympanic-fissure", "tympanic-part-of-temporal-bone", "musculotubal-canal", "body-of-sphenoid", "occipital-condyle", "mandibular-fossa", "squamous-part-of-occipital-bone"], side: "all" },
  { name: "tb2-skull-sup", mesh: "skull-all", only: ["temporal", "occipital", "sphenoid", "ethmoid", "frontal"], views: ["sup"], crop: [0.1, 0.25, 0.9, 0.85], ids: ["posterior-clinoid-process", "apex-of-petrous-part", "superior-border-of-petrous-part", "tegmen-tympani", "groove-for-superior-petrosal-sinus", "groove-for-inferior-petrosal-sinus", "cruciform-eminence", "arcuate-eminence", "trigeminal-impression", "dorsum-sellae", "foramen-lacerum", "jugular-foramen", "orbital-part-of-frontal-bone"], half: true },
  { name: "tb2-skull-med", mesh: "skull-all", views: ["med"], half: true, ids: ["grooves-for-arteries", "cruciform-eminence", "sphenopalatine-foramen", "perpendicular-plate-of-palatine-bone", "body-of-sphenoid", "parietal-foramen", "middle-nasal-concha", "superior-nasal-concha"] },
  { name: "tb2-skull-orbit", mesh: "skull-all", views: ["ant"], crop: [0.15, 0.2, 0.55, 0.6], ids: ["anterior-ethmoidal-foramen", "posterior-ethmoidal-foramen", "infra-orbital-groove", "orbital-plate-of-ethmoid", "orbital-part-of-frontal-bone", "optic-canal", "inferior-orbital-fissure", "superior-orbital-fissure", "zygomaticofacial-foramen"] },
  { name: "tb2-skull-post", mesh: "skull-all", views: ["post", "sup"], ids: ["squamous-part-of-occipital-bone", "highest-nuchal-line", "superior-nuchal-line", "parietal-foramen", "lambda", "asterion", "occipitomastoid-suture", "parietomastoid-suture"] },
  { name: "tb2-mand", mesh: "mandible", half: true, views: ["med"], ids: ["mylohyoid-groove", "sublingual-fossa", "submandibular-fossa", "mylohyoid-line", "mandibular-foramen", "mental-spine"] },
  { name: "tb2-mand-lat", mesh: "mandible", views: ["lat"], ids: ["alveolar-part-of-mandible", "body-of-mandible"] },
  { name: "tb2-mt", mesh: "metatarsals", views: ["sup", "lat"], ids: ["base-of-metatarsal", "head-of-metatarsal", "tuberosity-of-fifth-metatarsal"] },
];
