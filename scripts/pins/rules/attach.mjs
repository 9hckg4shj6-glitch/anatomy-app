// 筋の起始・停止のうち、Z-Anatomy に付着面が無く、骨の部位のピンでも示せないものの規則（scripts/pins/compute.mjs の ATTACH）。
// 書き出し先は content/attachments.json。骨に付かない起始・停止（手掌腱膜・白線・腱中心・皮膚）は示さない。
// アプリは正中から 1cm 以上離れた球を左側にも折り返す。左右にある付着は x < -0.01、正中の付着（棘突起・舌骨体）は x ≈ 0 に置く。
export const RULES = {};
const SPINOUS = { ext: "post", r: 0.009, n: "post" };
const ord = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
const thoracic = (from, to) => ord.slice(from - 1, to).map((o) => `${o} thoracic vertebra`);
const lumbar = (from, to) => ord.slice(from - 1, to).map((o) => `${o} lumbar vertebra`);
const cervical = (from, to) => ord.slice(from - 1, to).map((o) => `${o} cervical vertebra`);
const ribs = (from, to) => ord.slice(from - 1, to).map((o) => `${o} rib`);
// 背部・頚部の深い筋（何個もの椎骨・肋骨にまたがる起始・停止。ピンは代表の1点だけなので、どの椎骨のどこかを面で示す）
// 椎骨は左右にまたがる1つの部品なので、右の突起は ext の lat（-x）と box の m（0＝左端・0.5＝正中・1＝右端）で選ぶ。
const SP = (bone, each, r = 0.007) => ({ bone, each, ext: "post", r, n: "post" });
const TP = (bone, each, r = 0.006) => ({ bone, each, ext: "lat+0.3post", r, n: "post+lat" });
// 頚椎の横突起の後結節・前結節、関節突起（関節柱の後外側）
const TPpost = (each, r = 0.005) => ({ bone: "cervical-vertebrae", each, ext: "lat+0.5post", r, n: "post+lat" });
const TPant = (each, r = 0.005) => ({ bone: "cervical-vertebrae", each, ext: "lat+0.7ant", r, n: "ant+lat" });
const ARTIC = (each, r = 0.005) => ({ bone: "cervical-vertebrae", each, ext: "post+0.3lat", box: { m: [0.7, 0.84] }, r, n: "post+lat" });
// 腰椎の乳頭突起（上関節突起の後縁）、椎弓板（棘突起の根もとの横）
const MAMMILLARY = (each) => ({ bone: "lumbar-vertebrae", each, ext: "post+0.3sup", box: { m: [0.6, 0.78] }, r: 0.005, n: "post" });
const LAMINA = (bone, each) => ({ bone, each, ext: "post+0.3inf", box: { m: [0.55, 0.64], a: [0.12, 0.45] }, r: 0.004, n: "post" });
// 肋骨: 肋骨角（いちばん後ろの所）、肋骨結節と肋骨角の間、肋骨角の外側の上縁・下縁
const ANGLE = (each, r = 0.006) => ({ bone: "ribs", each, ext: "post+0.2lat", r, n: "post" });
const NECK_TO_ANGLE = (each) => ({ bone: "ribs", each, ext: "post+0.5sup", box: { m: [0.06, 0.22] }, r: 0.005, n: "post+sup" });
const BEYOND_ANGLE = (each, edge) => ({ bone: "ribs", each, ext: `${edge}+0.6post`, box: { m: [0.25, 0.45] }, r: 0.006, n: "post" });
// 腸骨稜の後部、仙骨の後面（正中の右）
const ILIAC_CREST_POST = { bone: "hip-bone", ridge: { dir: "sup+0.2post", along: "a", from: 0.12, to: 0.32, k: 3 }, r: 0.008, n: "sup+post" };
const SACRUM_POST = { bone: "sacrum", ridge: { dir: "post", along: "s", from: 0.35, to: 0.85, k: 3 }, box: { m: [0.55, 0.7] }, r: 0.008, n: "post" };
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
  // 僧帽筋の横行部（第7頚椎〜第3胸椎）と上行部（第4〜12胸椎）の棘突起
  "transverse-part-of-trapezius@origin": [{ bone: "cervical-vertebrae", part: "seventh cervical vertebra", ...SPINOUS }, { bone: "thoracic-vertebrae", each: thoracic(1, 3), ...SPINOUS }],
  "ascending-part-of-trapezius@origin": { bone: "thoracic-vertebrae", each: thoracic(4, 12), ...SPINOUS },
  // 母指の基節骨の底: 短母指外転筋は橈側（外側）、短母指屈筋は掌側
  "abductor-pollicis-brevis@insertion": { bone: "phalanges-hand", part: "proximal phalanx of thumb", ext: "lat+0.5sup", box: { s: [0.65, 1] }, r: 0.004 },
  "flexor-pollicis-brevis@insertion": { bone: "phalanges-hand", part: "proximal phalanx of thumb", ext: "ant+0.5sup", box: { s: [0.65, 1] }, r: 0.004 },
  // 第1中手骨の橈側縁（母指対立筋）、第5中手骨の尺側縁（小指対立筋）
  "opponens-pollicis@insertion": { bone: "metacarpals", part: "first metacarpal bone", ridge: { dir: "lat+0.3ant", along: "s", from: 0.3, to: 0.75, k: 3 }, r: 0.004 },
  "opponens-digiti-minimi-of-hand@insertion": { bone: "metacarpals", part: "fifth metacarpal bone", ridge: { dir: "med+0.3ant", along: "s", from: 0.3, to: 0.75, k: 3 }, r: 0.004 },
  // 内側楔状骨と第1中足骨の底の足底側（外側寄り）
  "fibularis-longus@insertion": [
    { bone: "cuneiforms", part: "medial cuneiform bone", ext: "inf+0.5lat", r: 0.005 },
    { bone: "metatarsals", part: "first metatarsal bone", ext: "lat+inf", box: { a: [0, 0.1] }, r: 0.005 },
  ],

  // ── 背部の深い筋（固有背筋）──
  // 棘筋: 第11胸椎〜第2腰椎の棘突起 → 第2〜第5胸椎の棘突起（『Gray』では4〜8本）
  "spinalis@origin": [SP("thoracic-vertebrae", thoracic(11, 12)), SP("lumbar-vertebrae", lumbar(1, 2))],
  "spinalis@insertion": SP("thoracic-vertebrae", thoracic(2, 5)),
  // 半棘筋: 胸半棘筋（第6〜第10胸椎の横突起 → 第6頚椎〜第4胸椎の棘突起）、頚半棘筋（第1〜第6胸椎の横突起 → 第2〜第5頚椎の棘突起）、
  // 頭半棘筋（第7頚椎〜第6胸椎の横突起・第4〜第6頚椎の関節突起 → 後頭骨。停止はピン）
  "semispinalis-thoracis@origin": TP("thoracic-vertebrae", thoracic(6, 10)),
  "semispinalis-thoracis@insertion": [SP("cervical-vertebrae", cervical(6, 7)), SP("thoracic-vertebrae", thoracic(1, 4))],
  "semispinalis-cervicis@origin": TP("thoracic-vertebrae", thoracic(1, 6)),
  "semispinalis-cervicis@insertion": [SP("axis", undefined, 0.008), SP("cervical-vertebrae", cervical(3, 5), 0.006)],
  "semispinalis-capitis@origin": [TP("thoracic-vertebrae", thoracic(1, 6)), TPpost(cervical(7, 7)), ARTIC(cervical(4, 6))],
  "semispinalis@origin": [TPpost(cervical(7, 7)), TP("thoracic-vertebrae", thoracic(1, 10))],
  "semispinalis@insertion": [SP("axis", undefined, 0.008), SP("cervical-vertebrae", cervical(3, 7), 0.006), SP("thoracic-vertebrae", thoracic(1, 4))],
  // 多裂筋: 仙骨の後面・腰椎の乳頭突起・胸椎の横突起・第4〜第7頚椎の関節突起 → 2〜4個上の椎骨の棘突起（軸椎〜第5腰椎）
  "multifidus@origin": [SACRUM_POST, MAMMILLARY(lumbar(1, 5)), TP("thoracic-vertebrae", thoracic(1, 12), 0.005), ARTIC(cervical(4, 7))],
  "multifidus@insertion": [SP("axis", undefined, 0.006), SP("cervical-vertebrae", cervical(3, 7), 0.005), SP("thoracic-vertebrae", thoracic(1, 12), 0.005), SP("lumbar-vertebrae", lumbar(1, 5), 0.006)],
  // 回旋筋（胸部でよく発達）: 胸椎の横突起 → 1つ上の椎骨の椎弓板（棘突起の根もと）
  "rotatores@origin": TP("thoracic-vertebrae", thoracic(2, 12), 0.005),
  "rotatores@insertion": LAMINA("thoracic-vertebrae", thoracic(1, 11)),
  // 棘間筋（頚部と腰部）: 下の椎骨の棘突起 → すぐ上の椎骨の棘突起
  "interspinales@origin": [SP("cervical-vertebrae", cervical(3, 7), 0.005), SP("thoracic-vertebrae", thoracic(1, 1), 0.005), SP("lumbar-vertebrae", lumbar(2, 5), 0.006)],
  "interspinales@insertion": [SP("axis", undefined, 0.005), SP("cervical-vertebrae", cervical(3, 7), 0.005), SP("lumbar-vertebrae", lumbar(1, 4), 0.006)],
  // 最長筋: 胸最長筋（仙骨・腸骨稜・腰椎の棘突起 → 全胸椎の横突起・腰椎の肋骨突起）、頚最長筋（第1〜第5胸椎の横突起 → 第2〜第6頚椎の横突起）、
  // 頭最長筋（第1〜第5胸椎の横突起・第4〜第7頚椎の関節突起 → 乳様突起。停止はピン）
  "longissimus-thoracis@origin": [SACRUM_POST, ILIAC_CREST_POST, SP("lumbar-vertebrae", lumbar(1, 5))],
  "longissimus-cervicis@origin": TP("thoracic-vertebrae", thoracic(1, 5)),
  "longissimus-cervicis@insertion": [{ bone: "axis", ext: "lat+0.5post", r: 0.005, n: "post+lat" }, TPpost(cervical(3, 6))],
  "longissimus-capitis@origin": [TP("thoracic-vertebrae", thoracic(1, 5)), ARTIC(cervical(4, 7))],
  "longissimus@origin": [SACRUM_POST, ILIAC_CREST_POST, SP("lumbar-vertebrae", lumbar(1, 5)), TP("thoracic-vertebrae", thoracic(1, 5))],
  // 腸肋筋: 頚腸肋筋（第3〜第6肋骨の肋骨角 → 第4〜第6頚椎の横突起の後結節）、胸腸肋筋（第7〜第12肋骨の肋骨角 → 第1〜第6肋骨の肋骨角・第7頚椎の横突起）、
  // 腰腸肋筋（腸骨稜・仙骨 → 第6〜第12肋骨の肋骨角）
  "iliocostalis-cervicis@insertion": TPpost(cervical(4, 6)),
  "iliocostalis-thoracis@insertion": [ANGLE(ribs(1, 6)), TPpost(cervical(7, 7))],
  "iliocostalis-lumborum@origin": [ILIAC_CREST_POST, SACRUM_POST],
  // 板状筋: 頚板状筋（第3〜第6胸椎の棘突起 → 第1〜第3頚椎の横突起の後結節）
  "splenius-cervicis@origin": SP("thoracic-vertebrae", thoracic(3, 6)),
  // 上後鋸筋（第6頚椎〜第2胸椎の棘突起 → 第2〜第5肋骨の肋骨角の外側の上縁）、下後鋸筋（第11胸椎〜第2腰椎の棘突起 → 第9〜第12肋骨の下縁）
  "serratus-posterior-superior@origin": [SP("cervical-vertebrae", cervical(6, 7)), SP("thoracic-vertebrae", thoracic(1, 2))],
  "serratus-posterior-superior@insertion": BEYOND_ANGLE(ribs(2, 5), "sup"),
  "serratus-posterior-inferior@origin": [SP("thoracic-vertebrae", thoracic(11, 12)), SP("lumbar-vertebrae", lumbar(1, 2))],
  "serratus-posterior-inferior@insertion": BEYOND_ANGLE(ribs(9, 12), "inf"),
  // 肋骨挙筋: 第7頚椎〜第11胸椎の横突起 → すぐ下（短）・2つ下（長）の肋骨の肋骨結節と肋骨角の間
  "levatores-costarum@origin": [TPpost(cervical(7, 7)), TP("thoracic-vertebrae", thoracic(1, 11), 0.005)],
  "levatores-costarum-breves@origin": [TPpost(cervical(7, 7)), TP("thoracic-vertebrae", thoracic(1, 11), 0.005)],
  "levatores-costarum-breves@insertion": NECK_TO_ANGLE(ribs(1, 12)),
  "levatores-costarum-longi@origin": TP("thoracic-vertebrae", thoracic(7, 10), 0.005),
  "levatores-costarum-longi@insertion": NECK_TO_ANGLE(ribs(9, 12)),
  // 腰方形筋: 腸骨稜の後部 → 第12肋骨の下縁（内側半分）・第1〜第4腰椎の肋骨突起の先
  "quadratus-lumborum@origin": { bone: "hip-bone", ridge: { dir: "sup", along: "a", from: 0.18, to: 0.3, k: 2 }, r: 0.009, n: "sup" },
  "quadratus-lumborum@insertion": [{ bone: "ribs", part: "twelfth rib", ridge: { dir: "inf", along: "m", from: 0.1, to: 0.45, k: 3 }, r: 0.006, n: "inf" }, { bone: "lumbar-vertebrae", each: lumbar(1, 4), ext: "lat", r: 0.006, n: "lat" }],

  // ── 頚部の深い筋 ──
  // 頚長筋: 第5頚椎〜第3胸椎の椎体の前面 → 環椎の前結節・第2〜第4頚椎の椎体の前面
  "longus-colli@origin": [{ bone: "cervical-vertebrae", each: cervical(5, 7), ext: "ant", box: { m: [0.52, 0.6] }, r: 0.005, n: "ant" }, { bone: "thoracic-vertebrae", each: thoracic(1, 3), ext: "ant", box: { m: [0.52, 0.6] }, r: 0.005, n: "ant" }],
  "longus-colli@insertion": [{ bone: "atlas", ext: "ant", r: 0.005, n: "ant" }, { bone: "axis", ext: "ant+0.3inf", box: { m: [0.5, 0.6] }, r: 0.005, n: "ant" }, { bone: "cervical-vertebrae", each: cervical(3, 4), ext: "ant", box: { m: [0.52, 0.6] }, r: 0.005, n: "ant" }],
  // 頭長筋: 第3〜第6頚椎の横突起の前結節
  "longus-capitis@origin": TPant(cervical(3, 6)),
  // 上頭斜筋・外側頭直筋: 環椎の横突起（上頭斜筋は上面の後ろ寄り、外側頭直筋は上面の前寄り）
  "obliquus-capitis-superior@origin": { bone: "atlas", ext: "lat+0.5sup+0.3post", r: 0.005, n: "sup+post" },
  "rectus-capitis-lateralis@origin": { bone: "atlas", ext: "lat+0.5sup+0.3ant", r: 0.005, n: "sup" },
  // 後斜角筋: 第2肋骨の外側面
  "posterior-scalene@insertion": { bone: "ribs", part: "second rib", ext: "lat+0.4sup", box: { m: [0.35, 0.7] }, r: 0.007, n: "lat+sup" },
  // 胸骨甲状筋: 胸骨柄の後面（正中の右）。茎突舌骨筋: 舌骨の体と大角の境（二腹筋の停止のすぐ上）
  "sternothyroid@origin": { bone: "manubrium", ext: "post", box: { m: [0.52, 0.66], s: [0.45, 0.85] }, r: 0.007, n: "post" },
  "stylohyoid@insertion": { bone: "hyoid-bone", ext: "lat+ant+0.5sup", box: { a: [0.5, 1] }, r: 0.004, n: "lat+sup" },

  // ── 四肢の骨に付くのに、ピンも付着面も無かった起始・停止 ──
  // 短内転筋・小内転筋: 恥骨下枝の前面（小内転筋は坐骨枝寄り）
  "adductor-brevis@origin": { bone: "hip-bone", ext: "ant+0.3inf", box: { m: [0.03, 0.22], s: [0.12, 0.3] }, r: 0.007, n: "ant" },
  "adductor-minimus@origin": { bone: "hip-bone", ext: "ant+0.6inf", box: { m: [0.12, 0.36], s: [0.02, 0.12] }, r: 0.007, n: "ant+inf" },
  // 外閉鎖筋: 大腿骨の転子窩（大転子の内側の後ろのくぼみ）
  "obturator-externus@insertion": { bone: "femur", ext: "post+0.6med", box: { s: [0.88, 0.96], m: [0.62, 0.85] }, r: 0.006, n: "post+med" },
  // 尺側手根屈筋（2頭とも）: 豆状骨と第5中手骨の底（掌側）
  ...Object.fromEntries(["humeral-head-of-flexor-carpi-ulnaris", "ulnar-head-of-flexor-carpi-ulnaris"].map((id) => [`${id}@insertion`, [
    { bone: "pisiform", ext: "ant+0.3sup", r: 0.005, n: "ant" },
    { bone: "metacarpals", part: "fifth metacarpal bone", ext: "ant+0.5med", box: { s: [0.86, 1] }, r: 0.004, n: "ant" },
  ]])),
  // 短趾伸筋: 踵骨の上外側面の前部。足底方形筋: 踵骨の下面（内側と外側の2頭）
  "extensor-digitorum-brevis@origin": { bone: "calcaneus", ext: "sup+lat", box: { a: [0.62, 1] }, r: 0.007, n: "sup+lat" },
  "quadratus-plantae@origin": [{ bone: "calcaneus", ext: "inf+0.5med", box: { a: [0.3, 0.6] }, r: 0.007, n: "inf" }, { bone: "calcaneus", ext: "inf+0.5lat", box: { a: [0.3, 0.6] }, r: 0.006, n: "inf" }],
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
  { name: "att-trapezius", mesh: ["cervical-vertebrae", "thoracic-vertebrae"], views: ["post", "lat"], ids: ["transverse-part-of-trapezius@origin", "ascending-part-of-trapezius@origin"] },
  { name: "att-thumb", mesh: ["metacarpals", "phalanges-hand"], views: ["ant", "lat", "med"], ids: ["abductor-pollicis-brevis@insertion", "flexor-pollicis-brevis@insertion", "opponens-pollicis@insertion", "opponens-digiti-minimi-of-hand@insertion"] },
  { name: "att-foot", mesh: ["cuneiforms", "metatarsals"], views: ["inf", "med"], ids: ["fibularis-longus@insertion"] },
  { name: "att-back-semispinalis", size: 1100, mesh: ["cervical-vertebrae", "axis", "thoracic-vertebrae"], views: ["post", "lat"], ids: ["semispinalis-thoracis@origin", "semispinalis-thoracis@insertion", "semispinalis-cervicis@origin", "semispinalis-cervicis@insertion", "semispinalis-capitis@origin"] },
  { name: "att-back-multifidus", size: 1100, mesh: ["cervical-vertebrae", "axis", "thoracic-vertebrae", "lumbar-vertebrae", "sacrum"], views: ["post", "lat"], ids: ["multifidus@origin", "multifidus@insertion"] },
  { name: "att-back-rotatores", size: 1100, mesh: ["thoracic-vertebrae"], views: ["post", "lat"], ids: ["rotatores@origin", "rotatores@insertion", "spinalis@origin", "spinalis@insertion"] },
  { name: "att-back-interspinales", size: 1100, mesh: ["cervical-vertebrae", "axis", "thoracic-vertebrae", "lumbar-vertebrae"], views: ["lat", "post"], ids: ["interspinales@origin", "interspinales@insertion"] },
  { name: "att-back-longissimus", size: 1100, mesh: ["cervical-vertebrae", "thoracic-vertebrae", "lumbar-vertebrae", "sacrum", "hip-bone"], views: ["post", "lat"], ids: ["longissimus-thoracis@origin", "longissimus-cervicis@origin", "longissimus-cervicis@insertion", "longissimus-capitis@origin"] },
  { name: "att-back-iliocostalis", size: 1100, mesh: ["cervical-vertebrae", "ribs", "sacrum", "hip-bone"], views: ["post", "lat"], ids: ["iliocostalis-cervicis@insertion", "iliocostalis-thoracis@insertion", "iliocostalis-lumborum@origin"] },
  { name: "att-back-serratus", size: 1100, mesh: ["cervical-vertebrae", "thoracic-vertebrae", "lumbar-vertebrae", "ribs"], views: ["post", "lat"], ids: ["splenius-cervicis@origin", "serratus-posterior-superior@origin", "serratus-posterior-superior@insertion", "serratus-posterior-inferior@origin", "serratus-posterior-inferior@insertion"] },
  { name: "att-back-levatores", size: 1100, mesh: ["cervical-vertebrae", "thoracic-vertebrae", "ribs"], views: ["post", "lat"], ids: ["levatores-costarum-breves@origin", "levatores-costarum-breves@insertion", "levatores-costarum-longi@insertion"] },
  { name: "att-back-quadratus", size: 1100, mesh: ["lumbar-vertebrae", "ribs", "hip-bone"], only: null, views: ["post", "ant"], ids: ["quadratus-lumborum@origin", "quadratus-lumborum@insertion"] },
  { name: "att-neck-deep", size: 900, mesh: ["atlas", "axis", "cervical-vertebrae", "thoracic-vertebrae"], views: ["ant", "lat"], ids: ["longus-colli@origin", "longus-colli@insertion", "longus-capitis@origin", "obliquus-capitis-superior@origin", "rectus-capitis-lateralis@origin"] },
  { name: "att-limb-extra-hip", size: 1000, mesh: ["hip-bone", "femur"], views: ["ant", "post"], crop: [0, 0, 1, 0.42], ids: ["adductor-brevis@origin", "adductor-minimus@origin", "obturator-externus@insertion"] },
  { name: "att-limb-extra-hand", mesh: ["pisiform", "hamate", "metacarpals"], views: ["ant", "med"], ids: ["humeral-head-of-flexor-carpi-ulnaris@insertion"] },
  { name: "att-limb-extra-foot", mesh: ["calcaneus"], views: ["lat", "inf", "med"], ids: ["extensor-digitorum-brevis@origin", "quadratus-plantae@origin"] },
  { name: "att-neck-front", size: 900, mesh: ["ribs", "manubrium", "hyoid-bone"], views: ["ant", "post", "lat"], ids: ["posterior-scalene@insertion", "sternothyroid@origin", "stylohyoid@insertion"] },
];
