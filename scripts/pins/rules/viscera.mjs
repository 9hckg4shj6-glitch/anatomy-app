// 解剖学講義（内臓の章）と照らし合わせて足した、肺・気管・喉頭・胃・十二指腸・直腸・肝臓・舌・膀胱・男性生殖器の部位のピンの規則（scripts/pins/compute.mjs）。
// ray の座標は確認画像の枠の中の割合（左上が 0,0）。前から見た画像（ant）は本人の右が画像の左、右の器官を外側から見た画像（lat）は前が画像の右、
// 右肺を内側から見た画像（med）は前が画像の左、左肺を内側から見た画像（side: "left" の lat）は前が画像の右。
// 左右の無い器官と、片側の肺だけで示す部位は one（左右に折り返さない）。near の座標は器官の形の点（scratchpad で測ったもの）。
export const RULES = {
  // 肺（右肺で計算して左へ折り返す。縦隔面・肺間膜は右肺だけ、心圧痕は左肺だけ）
  "costal-surface-of-lung": { ray: ["lat", 0.55, 0.62], r: 0.03, n: "lat" },
  "mediastinal-surface-of-lung": { ray: ["med", 0.4, 0.3], r: 0.025, n: "med", one: true },
  "anterior-border-of-lung": { ridge: { dir: "ant+0.3med", along: "s", from: 0.25, to: 0.8, k: 6 }, r: 0.006, n: "ant", ring: true },
  "inferior-border-of-lung": {
    union: [{ ext: "inf+lat" }, { ext: "inf+lat+ant" }, { ext: "inf+lat+post" }, { ext: "inf+ant" }, { ext: "inf+post" }, { ext: "inf+0.4lat+ant" }, { ext: "inf+0.4lat+post" }],
    r: 0.007, n: "inf+lat", ring: true,
  },
  "cardiac-impression": { side: "left", ray: ["lat", 0.58, 0.55], r: 0.022, n: "lat", one: true },
  "pulmonary-ligament": { rays: [["med", 0.65, 0.6], ["med", 0.66, 0.68], ["med", 0.67, 0.76], ["med", 0.68, 0.84]], r: 0.006, n: "med", one: true },
  // 気管の後ろの壁（後ろから見た画像の正中の縦の列）
  "membranous-wall-of-trachea": { rays: [["post", 0.5, 0.2], ["post", 0.5, 0.4], ["post", 0.5, 0.6], ["post", 0.5, 0.78]], r: 0.007, n: "post", one: true },
  // 披裂軟骨: 声帯突起は前へ、筋突起は外（後ろ寄り）へ最も出た所
  "vocal-process-of-arytenoid": { ext: "ant", r: 0.002 },
  "muscular-process-of-arytenoid": { ext: "lat+0.3post", r: 0.002 },
  // 胃（前から: 食道の残りが左上、幽門が左下の先）
  "cardial-notch": { ray: ["ant", 0.42, 0.21], r: 0.008, one: true },
  "pyloric-antrum": { ray: ["ant", 0.34, 0.8], r: 0.014, one: true },
  "pyloric-canal": { ray: ["ant", 0.16, 0.75], r: 0.009, one: true },
  // 十二指腸（前から C字。幽門からの入口が上の右寄り）
  "duodenal-bulb": { ray: ["ant", 0.4, 0.16], r: 0.011, one: true },
  "superior-duodenal-flexure": { ray: ["ant", 0.13, 0.24], r: 0.012, one: true },
  "inferior-duodenal-flexure": { ray: ["ant", 0.2, 0.83], r: 0.012, one: true },
  // 腸間膜根: 十二指腸空腸曲（第2腰椎の左）から右の仙腸関節の前へ斜めに下る線に近い、腸間膜の後ろの点
  // （BodyParts3D の腸間膜は扇の羽根の集まりで、高さごとの最も後ろの点では羽根の縁に散る）
  "root-of-mesentery": { near: [[0.015, 1.02, 0.128], [-0.002, 0.99, 0.125], [-0.017, 0.965, 0.125], [-0.033, 0.935, 0.125], [-0.048, 0.905, 0.125]], r: 0.007, n: "post", ring: true, one: true },
  // 直腸（右から: 前が画像の右。上で S状結腸から続き、仙骨に沿って後ろへふくらみ、下で前へ張り出して後ろ下へ曲がる）
  "rectal-ampulla": { ray: ["lat", 0.42, 0.68], r: 0.016, one: true },
  "sacral-flexure-of-rectum": { ridge: { dir: "post", along: "s", from: 0.4, to: 0.7, k: 3 }, r: 0.01, n: "post", ring: true, one: true },
  "perineal-flexure-of-rectum": { ext: "ant", box: { s: [0.05, 0.3] }, r: 0.01, one: true },
  // 肝臓（下から見た画像 inf は前が上・本人の右が画像の左。後ろから見た画像 post は本人の右が画像の右）
  "diaphragmatic-surface-of-liver": { near: [-0.045, 1.26, 0.14], r: 0.03, n: "sup+0.3ant", one: true },
  "visceral-surface-of-liver": { ray: ["inf", 0.22, 0.55], r: 0.028, n: "inf", one: true },
  "bare-area-of-liver": { near: [[-0.04, 1.165, 0.0], [-0.062, 1.15, 0.0]], r: 0.018, n: "post", one: true },
  "groove-for-vena-cava": { near: [[-0.0165, 1.134, 0.1154], [-0.0153, 1.1663, 0.1196]], r: 0.008, n: "post", one: true },
  "fossa-for-gallbladder": { near: [[-0.052, 1.074, 0.16], [-0.047, 1.08, 0.15], [-0.04, 1.086, 0.14]], r: 0.009, n: "inf", one: true },
  "fissure-for-round-ligament": { seam: { a: "segment iii", b: "quadrate lobe", gap: 0.003, k: 4, axis: 2, center: [0, 1.25, 0.12] }, r: 0.005, n: "inf", ring: true, one: true },
  "fissure-for-ligamentum-venosum": { seam: { a: "caudate lobe", b: "segment ii", gap: 0.003, k: 3, axis: 1, center: [0, 1.25, 0.12] }, r: 0.005, n: "inf+post", ring: true, one: true },
  "papillary-process": { part: "caudate lobe of liver", ext: "inf+ant", r: 0.006, one: true },
  "caudate-process": { part: "caudate lobe of liver", ext: "lat+inf", r: 0.006, one: true },
  // 舌（舌背は上の面、舌正中溝は正中の列）
  "dorsum-of-tongue": { ray: ["sup", 0.5, 0.45], r: 0.011, n: "sup", one: true },
  "median-sulcus-of-tongue": { near: [[-0.0006, 1.4665, 0.162], [-0.0006, 1.4665, 0.152], [-0.0006, 1.466, 0.142], [-0.0006, 1.4645, 0.133]], r: 0.003, n: "sup", one: true },
  // 膀胱体: 膀胱尖と膀胱底の間の横の壁（左右に折り返す）
  "body-of-bladder": { ext: "lat", box: { s: [0.3, 0.8] }, r: 0.014, n: "lat" },
  // 精巣上体（右から: 前が画像の右。頭が上で前へかぶさり、体と尾が後ろの縁を下る）
  "head-of-epididymis": { ray: ["lat", 0.6, 0.2], r: 0.005 },
  "body-of-epididymis": { ray: ["lat", 0.16, 0.64], r: 0.004 },
  "tail-of-epididymis": { ray: ["lat", 0.21, 0.86], r: 0.004 },
  // 精管膨大部（後ろから: 本人の右が画像の右。正中寄りの太い部分）
  "ampulla-of-ductus-deferens": { ray: ["post", 0.15, 0.33], r: 0.006 },
  // 前立腺（右から: 前が画像の右）
  "base-of-prostate": { ext: "sup", box: { a: [0.3, 0.7] }, r: 0.011, n: "sup", one: true },
  "apex-of-prostate": { ext: "inf+0.6ant", r: 0.006, one: true },
  // 陰茎（右から: 前が画像の右。根もとが左＝後ろ、亀頭が右下）
  "root-of-penis": { ray: ["lat", 0.22, 0.38], r: 0.016, one: true, ring: true, n: "lat" },
  "body-of-penis": { ray: ["lat", 0.76, 0.5], r: 0.014, one: true, ring: true, n: "lat" },
  "crus-of-penis": { part: "corpus cavernosum of penis", ext: "post+0.6lat", r: 0.008 },
  "bulb-of-penis": { part: "corpus spongiosum of penis", ext: "post+inf", r: 0.009, one: true },
  "corona-of-glans": { ext: "sup+post", r: 0.006, ring: true, n: "post", one: true },
  "external-urethral-orifice": { ext: "inf+0.3ant", r: 0.004, one: true },
};
export const CHECKS = [
  { name: "v-lung-right", mesh: "right-lung", views: ["lat", "med", "ant"], ids: ["costal-surface-of-lung", "mediastinal-surface-of-lung", "anterior-border-of-lung", "inferior-border-of-lung", "pulmonary-ligament", "hilum-of-lung"] },
  { name: "v-lung-left", mesh: "left-lung", side: "left", views: ["lat", "ant"], ids: ["cardiac-impression", "cardiac-notch", "anterior-border-of-lung", "inferior-border-of-lung"] },
  { name: "v-trachea", mesh: "trachea", views: ["post", "lat"], ids: ["membranous-wall-of-trachea", "tracheal-bifurcation"], side: "all" },
  { name: "v-arytenoid", mesh: "arytenoid-cartilage", views: ["sup", "lat"], ids: ["vocal-process-of-arytenoid", "muscular-process-of-arytenoid"] },
  { name: "v-stomach", mesh: "stomach", views: ["ant"], ids: ["cardial-notch", "pyloric-antrum", "pyloric-canal", "cardia", "fundus-of-stomach", "pylorus", "angular-incisure"] },
  { name: "v-duodenum", mesh: "duodenum", views: ["ant"], ids: ["duodenal-bulb", "superior-duodenal-flexure", "inferior-duodenal-flexure", "superior-part-of-duodenum", "descending-part-of-duodenum"] },
  { name: "v-mesentery", mesh: "mesentery", views: ["post", "lat"], ids: ["root-of-mesentery"] },
  { name: "v-rectum", mesh: "rectum", views: ["lat"], ids: ["rectal-ampulla", "sacral-flexure-of-rectum", "perineal-flexure-of-rectum"] },
  { name: "v-liver", mesh: "liver", views: ["inf", "post", "sup", "ant"], ids: ["diaphragmatic-surface-of-liver", "visceral-surface-of-liver", "bare-area-of-liver", "groove-for-vena-cava", "fossa-for-gallbladder", "fissure-for-round-ligament", "fissure-for-ligamentum-venosum", "papillary-process", "caudate-process", "porta-hepatis"], side: "all" },
  { name: "v-tongue", mesh: "tongue", views: ["sup"], ids: ["dorsum-of-tongue", "median-sulcus-of-tongue", "terminal-sulcus-of-tongue"], side: "all" },
  { name: "v-bladder", mesh: "urinary-bladder", views: ["lat", "ant"], ids: ["body-of-bladder", "apex-of-bladder", "fundus-of-bladder", "neck-of-bladder"], side: "all" },
  { name: "v-epididymis", mesh: "epididymis", views: ["lat", "post"], ids: ["head-of-epididymis", "body-of-epididymis", "tail-of-epididymis"] },
  { name: "v-ductus", mesh: "ductus-deferens", views: ["post", "lat"], ids: ["ampulla-of-ductus-deferens"] },
  { name: "v-prostate", mesh: "prostate", views: ["lat"], ids: ["base-of-prostate", "apex-of-prostate"], side: "all" },
  { name: "v-penis", mesh: "penis", views: ["lat", "inf"], ids: ["root-of-penis", "body-of-penis", "crus-of-penis", "bulb-of-penis", "corona-of-glans", "external-urethral-orifice"], side: "all" },
];
