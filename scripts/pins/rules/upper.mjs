// 上肢の骨の部位（Phase 3 その5 で追加）のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）
// 手のひらは前（+z）を向き、指は下へ伸びる。手根骨・中手骨の「前」は掌側、「下」は指の先の向き
const BOTTOM = [0, 0.62, 1, 1];
export const RULES = {
  "conoid-tubercle": { ext: "inf+0.6post", box: { m: [0.62, 0.78] }, r: 0.006 },
  "trapezoid-line": { ridge: { dir: "inf+0.2ant", along: "m", from: 0.74, to: 0.88, k: 3 }, r: 0.005 },
  "neck-of-scapula": { near: [[-0.131, 1.3, 0.045], [-0.131, 1.3, 0.07], [-0.133, 1.287, 0.057], [-0.131, 1.317, 0.06]], ring: true, r: 0.008, n: "lat+0.4post" },
  "medial-supracondylar-ridge": { ridge: { dir: "med", along: "s", from: 0.1, to: 0.22, k: 4 }, r: 0.004 },
  "lateral-supracondylar-ridge": { ridge: { dir: "lat", along: "s", from: 0.1, to: 0.24, k: 4 }, r: 0.004 },
  "radial-fossa": { near: [-0.226, 1.056, 0.078], r: 0.005, n: "ant" },
  "supinator-crest": { ridge: { dir: "lat+0.15post", along: "s", from: 0.73, to: 0.81, k: 3 }, r: 0.004 },
  "ulnar-notch-of-radius": { ext: "med", box: { s: [0.02, 0.08] }, r: 0.006 },
  "dorsal-tubercle-of-radius": { ext: "post", box: { s: [0.04, 0.12] }, r: 0.005 },
  "tubercle-of-scaphoid": { ext: "ant+0.5inf", r: 0.005 },
  "tubercle-of-trapezium": { ext: "ant", r: 0.004 },
  "hook-of-hamate": { ext: "ant", r: 0.004 },
  "head-of-metacarpal": {
    union: ["first", "second", "third", "fourth", "fifth"].map((n) => ({ ext: "inf+0.3ant", part: `${n} metacarpal bone` })),
    ring: true, r: 0.007, n: "inf+ant",
  },
};
export const CHECKS = [
  { name: "up-clavicle", mesh: "clavicle", views: ["inf", "ant", "post"], ids: ["conoid-tubercle", "trapezoid-line", "acromial-end-of-clavicle"] },
  { name: "up-scapula", mesh: "scapula", views: ["lat", "post", "ant"], ids: ["neck-of-scapula", "glenoid-cavity", "infraglenoid-tubercle"] },
  { name: "up-humerus", mesh: "humerus", views: ["ant", "post"], crop: BOTTOM, ids: ["medial-supracondylar-ridge", "lateral-supracondylar-ridge", "radial-fossa", "coronoid-fossa", "capitulum-of-humerus"] },
  { name: "up-ulna", mesh: "ulna", views: ["lat", "ant", "post"], crop: [0, 0, 1, 0.38], ids: ["supinator-crest", "radial-notch"] },
  { name: "up-radius", mesh: "radius", views: ["med", "post", "ant"], crop: [0, 0.75, 1, 1], ids: ["ulnar-notch-of-radius", "dorsal-tubercle-of-radius", "radial-styloid-process"] },
  { name: "up-carpus", mesh: "carpal-bones", views: ["ant", "lat", "med"], ids: ["tubercle-of-scaphoid", "tubercle-of-trapezium", "hook-of-hamate"] },
  { name: "up-mc", mesh: "metacarpals", views: ["ant", "post", "lat"], ids: ["head-of-metacarpal"] },
];
