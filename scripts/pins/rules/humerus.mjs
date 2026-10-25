// 上腕骨の部位のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）
const BOT = [0, 0.75, 1, 1];
export const RULES = {
  "head-of-humerus": { ext: "med+0.8sup+0.3post", box: { s: [0.85, 1] }, r: 0.02 },
  "anatomical-neck": { cap: { ext: "med+0.8sup+0.3post", box: { s: [0.85, 1] }, theta: 78, k: 6 }, r: 0.006 },
  "surgical-neck": { ring: true, slices: [{ view: "ant", s: 0.82 }, { view: "ant+lat", s: 0.82 }, { view: "lat", s: 0.82 }, { view: "post+lat", s: 0.82 }, { view: "post", s: 0.82 }, { view: "post+med", s: 0.82 }, { view: "med", s: 0.82 }, { view: "ant+med", s: 0.82 }], r: 0.008, n: "ant+lat" },
  "greater-tubercle": { ext: "lat+0.3sup", box: { s: [0.85, 1] }, r: 0.012 },
  "lesser-tubercle": { ext: "ant+0.2med", box: { s: [0.85, 0.96] }, r: 0.009 },
  "intertubercular-sulcus": { groove: { view: "ant", levels: [0.92, 0.88, 0.84, 0.8], between: ["greater-tubercle", "lesser-tubercle"] }, r: 0.005 },
  "crest-of-greater-tubercle": { groove: { view: "ant", levels: [0.88, 0.84, 0.8], pick: "lat", between: ["greater-tubercle", "lesser-tubercle"], around: 0.012 }, r: 0.005, n: "ant+0.5lat" },
  "crest-of-lesser-tubercle": { groove: { view: "ant", levels: [0.88, 0.84, 0.8], pick: "med", between: ["greater-tubercle", "lesser-tubercle"], around: 0.012 }, r: 0.005, n: "ant+0.5med" },
  "deltoid-tuberosity": { ext: "lat+0.3ant", box: { s: [0.52, 0.64] }, r: 0.012 },
  "radial-groove": { slices: [{ view: "post", s: 0.64, m: 0.35 }, { view: "post", s: 0.56, m: 0.5 }, { view: "post", s: 0.48, m: 0.7 }, { view: "post+lat", s: 0.41, m: 0.85 }], r: 0.006, n: "post+0.3lat" },
  "medial-epicondyle-of-humerus": { ext: "med", box: { s: [0, 0.2] }, r: 0.01 },
  "lateral-epicondyle-of-humerus": { ext: "lat+0.2sup", box: { s: [0.03, 0.18] }, r: 0.009 },
  "capitulum-of-humerus": { ray: ["ant", 0.18, 0.77, BOT], r: 0.009, n: "ant+inf" },
  "trochlea-of-humerus": { ray: ["ant", 0.41, 0.83, BOT], r: 0.01, n: "ant+inf" },
  "olecranon-fossa": { ray: ["post", 0.63, 0.66, BOT], r: 0.01, inset: 0.003 },
  "coronoid-fossa": { ray: ["ant", 0.33, 0.62, BOT], r: 0.007 },
  "groove-for-ulnar-nerve": { ray: ["post", 0.47, 0.73, BOT], r: 0.005 },
};
const H = Object.keys(RULES);
export const CHECKS = [
  { name: "hum-top", mesh: "humerus", views: ["ant", "post", "lat", "med"], crop: [0, 0, 1, 0.35], ids: H },
  { name: "hum-bot", mesh: "humerus", views: ["ant", "post", "med", "inf"], crop: [0, 0.72, 1, 1], ids: H },
  { name: "hum", mesh: "humerus", views: ["post", "lat", "sup"], ids: H },
];
