// 前腕の骨の部位のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）
export const RULES = {
  "olecranon": { ext: "sup+0.6post", r: 0.01 },
  "coronoid-process-of-ulna": { ext: "ant", box: { s: [0.85, 0.97] }, r: 0.007 },
  "trochlear-notch": { towards: { from: ["olecranon", "coronoid-process-of-ulna"], dir: "post+0.3inf" }, r: 0.009 },
  "radial-notch": { ext: "lat", box: { s: [0.86, 0.94] }, r: 0.006 },
  "ulnar-tuberosity": { slices: [{ view: "ant", s: 0.845 }], r: 0.007 },
  "head-of-ulna": { slices: [{ view: "post+0.5lat", s: 0.035 }], r: 0.009 },
  "ulnar-styloid-process": { ext: "inf+0.2post+0.2med", r: 0.005 },
  "head-of-radius": { ext: "sup", r: 0.012, n: "sup+0.5ant" },
  "neck-of-radius": { ring: true, slices: [{ view: "ant", s: 0.935 }, { view: "ant+lat", s: 0.935 }, { view: "lat", s: 0.935 }, { view: "post+lat", s: 0.935 }, { view: "post", s: 0.935 }, { view: "post+med", s: 0.935 }, { view: "med", s: 0.935 }, { view: "ant+med", s: 0.935 }], r: 0.006, n: "ant+lat" },
  "radial-tuberosity": { ext: "med+0.3ant", box: { s: [0.82, 0.9] }, r: 0.008 },
  "radial-styloid-process": { ext: "inf+0.6lat", box: { s: [0, 0.1] }, r: 0.007 },
};
const U = ["olecranon", "coronoid-process-of-ulna", "trochlear-notch", "radial-notch", "ulnar-tuberosity", "head-of-ulna", "ulnar-styloid-process"];
const R = ["head-of-radius", "neck-of-radius", "radial-tuberosity", "radial-styloid-process"];
export const CHECKS = [
  { name: "ulna-top", mesh: "ulna", views: ["lat", "ant", "med"], crop: [0, 0, 1, 0.25], ids: U },
  { name: "ulna-bot", mesh: "ulna", views: ["post", "med", "ant"], crop: [0, 0.82, 1, 1], ids: U },
  { name: "radius-top", mesh: "radius", views: ["ant", "med", "lat"], crop: [0, 0, 1, 0.25], ids: R },
  { name: "radius-bot", mesh: "radius", views: ["ant", "lat"], crop: [0, 0.82, 1, 1], ids: R },
];
