// 筋の起始・停止のうち、Z-Anatomy に付着面が無く、骨の部位のピンでも示せないものの規則（scripts/pins/compute.mjs の ATTACH）。
// 書き出し先は content/attachments.json。骨に付かない起始・停止（手掌腱膜・白線・腱中心・皮膚）は示さない。
// アプリは正中から 1cm 以上離れた球を左側にも折り返す。左右にある付着は x < -0.01、正中の付着（棘突起・舌骨体）は x ≈ 0 に置く。
export const RULES = {};
const SPINOUS = { ext: "post", r: 0.009, n: "post" };
const ord = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
const thoracic = (from, to) => ord.slice(from - 1, to).map((o) => `${o} thoracic vertebra`);
const lumbar = (from, to) => ord.slice(from - 1, to).map((o) => `${o} lumbar vertebra`);
// 肋間筋は第5・第6肋骨の間で示す（肋骨の外側の部分の下縁・上縁）
const lowerBorder = { bone: "ribs", part: "fifth rib", ridge: { dir: "inf", along: "a", from: 0.35, to: 0.85, k: 5 }, box: { m: [0.3, 1] }, r: 0.005 };
const upperBorder = { bone: "ribs", part: "sixth rib", ridge: { dir: "sup", along: "a", from: 0.35, to: 0.85, k: 5 }, box: { m: [0.3, 1] }, r: 0.005 };

export const ATTACH = {
  // 上腕骨体の内側面の中央
  "coracobrachialis@insertion": { bone: "humerus", ridge: { dir: "med+0.3ant", along: "s", from: 0.5, to: 0.6, k: 3 }, r: 0.006 },
  // 第2・第3中手骨の底（掌側）
  "flexor-carpi-radialis@insertion": { bone: "metacarpals", each: ["second metacarpal bone", "third metacarpal bone"], ext: "ant+0.3sup", box: { s: [0.75, 1] }, r: 0.005 },
  // 尺骨の前面（上 3/4）
  "flexor-digitorum-profundus@origin": { bone: "ulna", ridge: { dir: "ant", along: "s", from: 0.38, to: 0.8, k: 4 }, r: 0.007 },
  // 第5中手骨の底（尺側・背側の結節）
  "extensor-carpi-ulnaris@insertion": { bone: "metacarpals", part: "fifth metacarpal bone", ext: "med+0.5post+0.5sup", box: { s: [0.75, 1] }, r: 0.005 },
  // 第1肋骨の前端（肋軟骨との境）の上面
  "subclavius@origin": { bone: "ribs", part: "first rib", ext: "ant+0.3sup", r: 0.007, n: "sup+ant" },
  "external-intercostal@origin": lowerBorder,
  "external-intercostal@insertion": upperBorder,
  "internal-intercostal@origin": upperBorder,
  "internal-intercostal@insertion": lowerBorder,
  // 棘突起の先
  "rhomboid-major@origin": { bone: "thoracic-vertebrae", each: thoracic(2, 5), ...SPINOUS },
  "rhomboid-minor@origin": [{ bone: "cervical-vertebrae", part: "seventh cervical vertebra", ...SPINOUS }, { bone: "thoracic-vertebrae", part: "first thoracic vertebra", ...SPINOUS }],
  "splenius-capitis@origin": [{ bone: "cervical-vertebrae", part: "seventh cervical vertebra", ...SPINOUS }, { bone: "thoracic-vertebrae", each: thoracic(1, 3), ...SPINOUS }],
  // 椎体の外側面（第12胸椎〜第4腰椎）と、腰椎の肋骨突起（横突起）の前面
  "psoas-major@origin": [
    { bone: "thoracic-vertebrae", part: "twelfth thoracic vertebra", ext: "lat", box: { a: [0.6, 1] }, r: 0.008, n: "lat" },
    { bone: "lumbar-vertebrae", each: lumbar(1, 4), ext: "lat", box: { a: [0.6, 1] }, r: 0.008, n: "lat" },
    { bone: "lumbar-vertebrae", each: lumbar(1, 5), ext: "lat", r: 0.007, n: "ant+lat" },
  ],
  // 恥骨稜（恥骨結節から恥骨結合まで）
  "rectus-abdominis@origin": { bone: "hip-bone", ridge: { dir: "sup+0.3ant", along: "m", from: 0, to: 0.068, k: 3 }, box: { s: [0, 0.4], a: [0.6, 1] }, r: 0.007 },
  // 舌骨: 二腹筋は体と大角の境（中間腱）、顎舌骨筋は体の前面の上部
  "digastric@insertion": { bone: "hyoid-bone", ext: "lat+ant", box: { a: [0.55, 1] }, r: 0.005 },
  "mylohyoid@insertion": { bone: "hyoid-bone", ext: "ant+0.5sup", box: { x: [-0.002, 0.002] }, r: 0.009 },
  // 前頭骨の眉弓の内側端
  "corrugator-supercilii@origin": { bone: "frontal-bone", ray: ["ant", 0.41, 0.73], r: 0.006 },
  // 下顎頚の前面（翼突筋窩）
  "lateral-pterygoid@insertion": { bone: "mandible", ext: "ant+0.5med", box: { y: [1.492, 1.5], z: [0.08, 0.11], x: [-0.06, -0.03] }, r: 0.005 },
  // 内側楔状骨と第1中足骨の底の足底側（外側寄り）
  "fibularis-longus@insertion": [
    { bone: "cuneiforms", part: "medial cuneiform bone", ext: "inf+0.5lat", r: 0.005 },
    { bone: "metatarsals", part: "first metatarsal bone", ext: "lat+inf", box: { a: [0, 0.1] }, r: 0.005 },
  ],
};

export const CHECKS = [
  { name: "att-humerus", mesh: "humerus", views: ["ant", "med"], ids: ["coracobrachialis@insertion"] },
  { name: "att-ulna", mesh: "ulna", views: ["ant", "med"], ids: ["flexor-digitorum-profundus@origin"] },
  { name: "att-hand", mesh: "metacarpals", views: ["ant", "post", "med"], ids: ["flexor-carpi-radialis@insertion", "extensor-carpi-ulnaris@insertion"] },
  { name: "att-ribs", mesh: "ribs", only: ["first rib", "fifth rib", "sixth rib"], views: ["ant", "lat", "antlat"], ids: ["subclavius@origin", "external-intercostal@origin", "external-intercostal@insertion"] },
  { name: "att-spine", mesh: ["cervical-vertebrae", "thoracic-vertebrae", "lumbar-vertebrae"], views: ["post", "lat", "ant"], ids: ["rhomboid-major@origin", "rhomboid-minor@origin", "splenius-capitis@origin", "psoas-major@origin"] },
  { name: "att-pubis", mesh: "hip-bone", views: ["ant", "sup"], crop: [0.5, 0.5, 1, 1], ids: ["rectus-abdominis@origin"] },
  { name: "att-hyoid", mesh: "hyoid-bone", side: "all", views: ["ant", "sup", "lat"], ids: ["digastric@insertion", "mylohyoid@insertion"] },
  { name: "att-frontal", mesh: "frontal-bone", side: "all", views: ["ant"], ids: ["corrugator-supercilii@origin"] },
  { name: "att-mandible", mesh: "mandible", views: ["lat", "med", "ant"], crop: [0, 0, 1, 0.5], ids: ["lateral-pterygoid@insertion"] },
  { name: "att-foot", mesh: ["cuneiforms", "metatarsals"], views: ["inf", "med"], ids: ["fibularis-longus@insertion"] },
];
