// 鎖骨と肩甲骨の部位のピンの規則（scripts/pins/compute.mjs）。ray の座標は確認画像の枠の中の割合（左上が 0,0）
export const RULES = {
  "sternal-end-of-clavicle": { ext: "med", r: 0.012, n: "ant+med" },
  "acromial-end-of-clavicle": { ext: "lat", r: 0.012, n: "sup+lat" },
  "acromion": { ray: ["sup", 0.17, 0.56], r: 0.015, n: "sup+0.5lat" },
  "coracoid-process": { ray: ["sup", 0.37, 0.82], r: 0.012, n: "ant+sup" },
  "glenoid-cavity": { ray: ["lat", 0.61, 0.39, [0.3, 0.05, 0.85, 0.6]], r: 0.019 },
  "spine-of-scapula": { ridge: { dir: "post+0.3sup", along: "m", from: 0.12, to: 0.62, k: 5 }, r: 0.008, n: "post+0.5sup" },
  "supraspinous-fossa": { rays: [["sup", 0.62, 0.25], ["sup", 0.47, 0.33]], r: 0.016, n: "sup+0.3post" },
  "infraspinous-fossa": { ray: ["post", 0.42, 0.5], r: 0.03 },
  "subscapular-fossa": { ray: ["ant", 0.6, 0.5], r: 0.032 },
  "superior-angle-of-scapula": { ext: "sup+0.6med", r: 0.009, n: "post+sup" },
  "inferior-angle-of-scapula": { ext: "inf", r: 0.01, n: "post+inf" },
  "medial-border-of-scapula": { ridge: { dir: "med", from: 0.2, to: 0.8, k: 5 }, r: 0.007, n: "post+med" },
  "lateral-border-of-scapula": { ridge: { dir: "lat+0.3post", from: 0.15, to: 0.55, k: 4 }, r: 0.007, n: "lat+post" },
  "supraglenoid-tubercle": { ray: ["lat", 0.63, 0.2], r: 0.006, n: "lat+sup" },
  "infraglenoid-tubercle": { ray: ["lat", 0.5, 0.5, [0.35, 0.15, 0.8, 0.6]], r: 0.007, n: "lat+inf" },
  "suprascapular-notch": { ray: ["sup", 0.29, 0.43], r: 0.008 },
};
const S = ["acromion", "coracoid-process", "glenoid-cavity", "spine-of-scapula", "supraspinous-fossa", "infraspinous-fossa", "subscapular-fossa", "superior-angle-of-scapula", "inferior-angle-of-scapula", "medial-border-of-scapula", "lateral-border-of-scapula", "supraglenoid-tubercle", "infraglenoid-tubercle", "suprascapular-notch"];
export const CHECKS = [
  { name: "scapula", mesh: "scapula", views: ["post", "ant", "lat", "sup", "postsup"], ids: S },
  { name: "glen", mesh: "scapula", views: ["lat"], crop: [0.3, 0.05, 0.85, 0.6], ids: ["glenoid-cavity", "supraglenoid-tubercle", "infraglenoid-tubercle", "acromion", "coracoid-process", "suprascapular-notch"] },
  { name: "clavicle", mesh: "clavicle", views: ["ant", "sup"], ids: ["sternal-end-of-clavicle", "acromial-end-of-clavicle"] },
];
