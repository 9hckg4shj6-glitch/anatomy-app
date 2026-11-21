import * as THREE from "three";
import type { Vec3 } from "../landmarks";
import { clear, curvePoints, plastic, tube } from "./common";
import { ARTERIAL, VENOUS } from "./heart";

/**
 * 肺循環と体循環の「わかりやすい模型」の、心臓の外の部分（cm）。心臓の模型（heart.ts）の大血管の端から、
 * 動脈 → 臓器の毛細血管 → 静脈とつなぎ、静脈は上大静脈・下大静脈へ戻る。腸の血液は門脈で肝臓を通ってから戻る
 */

export type VesselKind = "artery" | "capillary" | "vein";

export interface BodyPath {
  points: Vec3[];
  kind: VesselKind;
  circuit: "systemic" | "pulmonary";
  /** 心拍出量のうちこの道を通る割合 */
  share: number;
  /** 行き先の道（重み） */
  to: [string, number][];
  /** 血液の色（初め → 終わり） */
  blood: ["arterial" | "venous", "arterial" | "venous"];
}

/** 毛細血管の道（点をなめらかに通り、細かく波打たせる） */
function wavy(points: Vec3[], amplitude = 0.55, waves = 9): Vec3[] {
  const line = curvePoints(points, 120);
  return line.map((p, i) => {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(line.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const d = Math.hypot(dx, dy) || 1;
    const t = i / (line.length - 1);
    const w = Math.sin(t * Math.PI * 2 * waves) * amplitude * Math.sin(t * Math.PI);
    return [p[0] - (dy / d) * w, p[1] + (dx / d) * w, p[2]];
  });
}
const mirror = (points: Vec3[], dx = 0): Vec3[] => points.map(([x, y, z]) => [-x + dx, y, z]);

const A = "arterial" as const;
const V = "venous" as const;

const rArmA: Vec3[] = [[0, 12.5, -0.6], [-1.4, 14.4, -1.8], [-6, 15.6, -2.6], [-13, 15.2, -2.6], [-20, 13.6, -2.6], [-24.4, 8, -2.6], [-25.8, 2, -2.0]];
const rArmC: Vec3[] = [[-25.8, 2, -2.0], [-27.2, -0.4, -1.4], [-26.2, -3, -0.6], [-27.2, -5.2, 0.2], [-25.6, -6.4, 0.8], [-24.6, -4, 1.0], [-25.4, -1.2, 1.2], [-24.6, 1.6, 1.2]];
const rArmV: Vec3[] = [[-24.6, 1.6, 1.2], [-23.4, 7.8, 1.2], [-19.4, 14.2, 1.2], [-12.4, 16.6, 1.0], [-6.4, 15.6, 0.6], [-3.4, 12.6, 0]];

export const BODY_PATHS: Record<string, BodyPath> = {
  // 頭（左総頸動脈 → 脳 → 内頸静脈 → 上大静脈）
  "head-a": { points: [[2.1, 12.5, -1.2], [2.4, 20, -1.2], [2.8, 27, -1.0]], kind: "artery", circuit: "systemic", share: 0.15, to: [["head-c", 1]], blood: [A, A] },
  "head-c": { points: wavy([[2.8, 27, -1.0], [5.2, 30.4, -1], [4.2, 34.4, -0.6], [0, 36.4, 0], [-4.2, 34.4, 0.4], [-5.2, 30.4, 0.6], [-3.2, 27, 0.6]]), kind: "capillary", circuit: "systemic", share: 0.15, to: [["head-v", 1]], blood: [A, V] },
  "head-v": { points: [[-3.2, 27, 0.6], [-3.4, 20, 0.4], [-3.4, 12.6, 0]], kind: "vein", circuit: "systemic", share: 0.15, to: [["svc", 1]], blood: [V, V] },
  // 腕（右は腕頭動脈、左は左鎖骨下動脈から）
  "r-arm-a": { points: rArmA, kind: "artery", circuit: "systemic", share: 0.07, to: [["r-arm-c", 1]], blood: [A, A] },
  "r-arm-c": { points: wavy(rArmC, 0.4, 7), kind: "capillary", circuit: "systemic", share: 0.07, to: [["r-arm-v", 1]], blood: [A, V] },
  "r-arm-v": { points: rArmV, kind: "vein", circuit: "systemic", share: 0.07, to: [["svc", 1]], blood: [V, V] },
  "l-arm-a": { points: [[4.6, 12.2, -2.2], [9, 14.8, -2.6], [16, 14.6, -2.6], [21.6, 11.6, -2.6], [24.6, 6.4, -2.4], [25.8, 2, -2.0]], kind: "artery", circuit: "systemic", share: 0.07, to: [["l-arm-c", 1]], blood: [A, A] },
  "l-arm-c": { points: wavy(mirror(rArmC), 0.4, 7), kind: "capillary", circuit: "systemic", share: 0.07, to: [["l-arm-v", 1]], blood: [A, V] },
  "l-arm-v": { points: [[24.6, 1.6, 1.2], [23.4, 7.8, 1.4], [19.4, 14.2, 1.4], [12.4, 17, 1.4], [5, 17, 1.2], [-0.6, 15.4, 0.8], [-3.4, 12.6, 0]], kind: "vein", circuit: "systemic", share: 0.07, to: [["svc", 1]], blood: [V, V] },
  // 腹（腹大動脈 → 腸 → 門脈 → 肝臓 → 肝静脈 → 下大静脈）
  "aorta-1": { points: [[5, -11, -3.2], [4.6, -18, -3.2]], kind: "artery", circuit: "systemic", share: 0.71, to: [["gut-a", 0.25], ["aorta-2", 0.46]], blood: [A, A] },
  "gut-a": { points: [[4.6, -18, -3.2], [5.4, -20.5, -0.5], [6.6, -23, 2.2]], kind: "artery", circuit: "systemic", share: 0.25, to: [["gut-c", 1]], blood: [A, A] },
  "gut-c": { points: wavy([[6.6, -23, 2.2], [9.2, -24.6, 2.6], [9.6, -28, 3], [6, -30.8, 3.4], [2.4, -28.8, 3.4], [2.2, -25.4, 3.2]], 0.5, 10), kind: "capillary", circuit: "systemic", share: 0.25, to: [["portal", 1]], blood: [A, V] },
  portal: { points: [[2.2, -25.4, 3.2], [-1.4, -23.4, 2.8], [-4.4, -20.6, 2.4]], kind: "vein", circuit: "systemic", share: 0.25, to: [["liver-c", 1]], blood: [V, V] },
  "liver-c": { points: wavy([[-4.4, -20.6, 2.4], [-7.6, -21.6, 2.8], [-11.6, -19.8, 2.4], [-11.4, -16.6, 1.6], [-8.6, -15.6, 1.2], [-7.4, -15.2, 0.6]], 0.45, 8), kind: "capillary", circuit: "systemic", share: 0.25, to: [["ivc-1", 1]], blood: [V, V] },
  "aorta-2": { points: [[4.6, -18, -3.2], [4.2, -22, -3.2]], kind: "artery", circuit: "systemic", share: 0.46, to: [["r-renal-a", 0.1], ["l-renal-a", 0.1], ["aorta-3", 0.26]], blood: [A, A] },
  // 腎臓
  "r-renal-a": { points: [[4.2, -22, -3.2], [-2, -22.6, -3.6], [-8.4, -23.2, -4.0]], kind: "artery", circuit: "systemic", share: 0.1, to: [["r-kidney-c", 1]], blood: [A, A] },
  "r-kidney-c": { points: wavy([[-8.4, -23.2, -4.0], [-11.6, -21.4, -4.2], [-12.4, -24.6, -4.2], [-10.8, -27.2, -4], [-8.8, -25.4, -3.6]], 0.35, 6), kind: "capillary", circuit: "systemic", share: 0.1, to: [["r-renal-v", 1]], blood: [A, V] },
  "r-renal-v": { points: [[-8.8, -25.4, -3.6], [-7.6, -24.6, -1.6], [-6.6, -24, -0.2]], kind: "vein", circuit: "systemic", share: 0.1, to: [["ivc-2", 1]], blood: [V, V] },
  "l-renal-a": { points: [[4.2, -22, -3.2], [6.4, -22.4, -3.8], [8.6, -22.6, -4.0]], kind: "artery", circuit: "systemic", share: 0.1, to: [["l-kidney-c", 1]], blood: [A, A] },
  "l-kidney-c": { points: wavy([[8.6, -22.6, -4.0], [11.8, -21, -4.2], [12.8, -24, -4.2], [11.4, -26.8, -4], [9, -25, -3.4]], 0.35, 6), kind: "capillary", circuit: "systemic", share: 0.1, to: [["l-renal-v", 1]], blood: [A, V] },
  "l-renal-v": { points: [[9, -25, -3.4], [6, -24.6, -0.4], [1, -24.3, 0.8], [-6.6, -24, -0.2]], kind: "vein", circuit: "systemic", share: 0.1, to: [["ivc-2", 1]], blood: [V, V] },
  // 脚
  "aorta-3": { points: [[4.2, -22, -3.2], [3.6, -30, -3.2], [3, -34, -3.0]], kind: "artery", circuit: "systemic", share: 0.26, to: [["r-leg-a", 1], ["l-leg-a", 1]], blood: [A, A] },
  "r-leg-a": { points: [[3, -34, -3.0], [-1.6, -38, -2.4], [-5.4, -44, -1.6], [-6.6, -50, -1.2]], kind: "artery", circuit: "systemic", share: 0.13, to: [["r-leg-c", 1]], blood: [A, A] },
  "r-leg-c": { points: wavy([[-6.6, -50, -1.2], [-8.2, -53, -0.8], [-6.4, -56.4, -0.4], [-8, -59.4, 0.2], [-5.6, -60.6, 0.8], [-5.2, -57, 1.2], [-7, -53.6, 1.4], [-5.8, -50, 1.6]], 0.4, 9), kind: "capillary", circuit: "systemic", share: 0.13, to: [["r-leg-v", 1]], blood: [A, V] },
  "r-leg-v": { points: [[-5.8, -50, 1.6], [-6.4, -44, 1.0], [-6.8, -38, 0.2], [-6.6, -36, -0.2]], kind: "vein", circuit: "systemic", share: 0.13, to: [["ivc-3", 1]], blood: [V, V] },
  "l-leg-a": { points: [[3, -34, -3.0], [7.2, -38, -2.4], [8.6, -44, -1.6], [8.8, -50, -1.2]], kind: "artery", circuit: "systemic", share: 0.13, to: [["l-leg-c", 1]], blood: [A, A] },
  "l-leg-c": { points: wavy(mirror([[-6.6, -50, -1.2], [-8.2, -53, -0.8], [-6.4, -56.4, -0.4], [-8, -59.4, 0.2], [-5.6, -60.6, 0.8], [-5.2, -57, 1.2], [-7, -53.6, 1.4], [-5.8, -50, 1.6]], 2.2), 0.4, 9), kind: "capillary", circuit: "systemic", share: 0.13, to: [["l-leg-v", 1]], blood: [A, V] },
  "l-leg-v": { points: [[8, -50, 1.6], [8.2, -44, 1.2], [6, -38.6, 0.8], [0, -36.8, 0.6], [-6.6, -36, -0.2]], kind: "vein", circuit: "systemic", share: 0.13, to: [["ivc-3", 1]], blood: [V, V] },
  // 下大静脈（脚 → 腎臓 → 肝臓の高さで合わさって心臓へ）
  "ivc-3": { points: [[-6.6, -36, -0.2], [-6.6, -24, -0.2]], kind: "vein", circuit: "systemic", share: 0.26, to: [["ivc-2", 1]], blood: [V, V] },
  "ivc-2": { points: [[-6.6, -24, -0.2], [-6.6, -15, -0.2]], kind: "vein", circuit: "systemic", share: 0.46, to: [["ivc-1", 1]], blood: [V, V] },
  "ivc-1": { points: [[-6.6, -15, -0.2], [-6.6, -11, -0.2]], kind: "vein", circuit: "systemic", share: 0.71, to: [["ivc", 1]], blood: [V, V] },
  // 肺（肺動脈 → 肺の毛細血管 → 肺静脈）
  "r-lung-c": { points: wavy([[-9.5, 5.8, -2.4], [-13, 8.2, -2.6], [-16.4, 11.2, -2.6], [-20.2, 9.6, -2.6], [-21.4, 4.8, -2.6], [-19.8, 0.4, -2.8], [-16, -0.8, -2.8], [-13, 1.4, -3.0], [-10.5, 2.4, -3.0]], 0.55, 11), kind: "capillary", circuit: "pulmonary", share: 0.55, to: [["rspv", 1], ["ripv", 1]], blood: [V, A] },
  "l-lung-c": { points: wavy([[9.5, 6.2, -0.8], [13, 8.4, -0.8], [16.2, 11.2, -0.8], [20, 9.6, -0.8], [21, 4.8, -0.6], [19.6, 0.4, -0.4], [16, -0.8, -0.4], [13, 1.4, -0.3], [10.5, 2.4, -0.2]], 0.55, 11), kind: "capillary", circuit: "pulmonary", share: 0.45, to: [["lspv", 1], ["lipv", 1]], blood: [V, A] },
};

export interface Organ {
  id: string;
  ja: string;
  note?: string;
  term?: string;
  center: Vec3;
  size: Vec3;
  color: string;
  circuit: "systemic" | "pulmonary";
  tag: Vec3;
}

export const ORGANS: Organ[] = [
  { id: "brain", ja: "脳（頭）", term: "cerebrum", center: [0, 32.4, -0.2], size: [6.8, 5.2, 5.6], color: "#e3c2bd", circuit: "systemic", tag: [0, 39.4, 0] },
  { id: "r-lung", ja: "右肺", note: "酸素を受け取る", term: "lung", center: [-16.6, 5.2, -2.6], size: [6.2, 8.6, 4.6], color: "#f2a2ac", circuit: "pulmonary", tag: [-17, 15.8, 0] },
  { id: "l-lung", ja: "左肺", note: "酸素を受け取る", term: "lung", center: [16.4, 5.2, -0.8], size: [5.8, 8.4, 4.6], color: "#f2a2ac", circuit: "pulmonary", tag: [17, 15.8, 0] },
  { id: "r-arm", ja: "右腕", term: "upper-limb", center: [-25.8, -2.2, -0.4], size: [2.8, 5.8, 2.6], color: "#e7c3a8", circuit: "systemic", tag: [-25.8, -10, 0] },
  { id: "l-arm", ja: "左腕", term: "upper-limb", center: [25.8, -2.2, -0.4], size: [2.8, 5.8, 2.6], color: "#e7c3a8", circuit: "systemic", tag: [25.8, -10, 0] },
  { id: "liver", ja: "肝臓", note: "門脈の血液も", term: "liver", center: [-8.2, -18.4, 1.6], size: [5.6, 3.8, 3.6], color: "#a0584a", circuit: "systemic", tag: [-15.6, -18.4, 2] },
  { id: "gut", ja: "消化管（腸）", term: "small-intestine", center: [5.8, -27.4, 3], size: [4.8, 4, 2.6], color: "#e5a998", circuit: "systemic", tag: [13.4, -29.6, 3] },
  { id: "r-kidney", ja: "腎臓", term: "kidney", center: [-10.6, -24.2, -4.1], size: [2.6, 4, 1.8], color: "#b5544a", circuit: "systemic", tag: [-15.6, -25.6, -4] },
  { id: "l-kidney", ja: "腎臓", term: "kidney", center: [10.8, -23.8, -4.1], size: [2.6, 4, 1.8], color: "#b5544a", circuit: "systemic", tag: [15.8, -22, -4] },
  { id: "r-leg", ja: "右脚", term: "lower-limb", center: [-6.7, -55.2, 0.2], size: [3, 6.8, 3], color: "#e7c3a8", circuit: "systemic", tag: [-12.6, -55.2, 0] },
  { id: "l-leg", ja: "左脚", term: "lower-limb", center: [8.9, -55.2, 0.2], size: [3, 6.8, 3], color: "#e7c3a8", circuit: "systemic", tag: [14.8, -55.2, 0] },
];

export interface BodyModel {
  root: THREE.Group;
  /** 体循環・肺循環の部品（薄くする） */
  materials: { circuit: "systemic" | "pulmonary"; material: THREE.MeshStandardMaterial; base: number }[];
}

export function buildBody(): BodyModel {
  const root = new THREE.Group();
  const materials: BodyModel["materials"] = [];
  const red = new THREE.Color(ARTERIAL);
  const blue = new THREE.Color(VENOUS);
  for (const [id, path] of Object.entries(BODY_PATHS)) {
    const radius = path.kind === "capillary" ? 0.22 : id.startsWith("aorta") ? 0.95 : id.startsWith("ivc") ? 1.05 : id === "portal" ? 0.6 : 0.42 + path.share * 0.6;
    const geometry = tube(path.points, radius, path.kind === "capillary" ? 220 : 64, path.kind === "capillary" ? 6 : 12);
    let material: THREE.MeshStandardMaterial;
    if (path.kind === "capillary") {
      // 毛細血管は色を道に沿って変える（uv の x が道の位置）
      const uv = geometry.getAttribute("uv");
      const colors = new Float32Array(uv.count * 3);
      const c = new THREE.Color();
      const [from, to] = path.blood.map((b) => (b === "arterial" ? red : blue));
      for (let i = 0; i < uv.count; i++) {
        c.copy(from).lerp(to, uv.getX(i));
        colors.set([c.r, c.g, c.b], i * 3);
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      material = plastic("#ffffff", { vertexColors: true });
      material.transparent = true;
      material.opacity = 0.9;
    } else {
      material = clear(path.blood[0] === "arterial" ? ARTERIAL : VENOUS, 0.34);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = path.kind === "capillary" ? 3 : 4;
    mesh.userData.pick = id;
    root.add(mesh);
    materials.push({ circuit: path.circuit, material, base: material.opacity });
  }
  for (const organ of ORGANS) {
    const material = clear(organ.color, 0.3);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 22), material);
    mesh.scale.set(...organ.size);
    mesh.position.set(...organ.center);
    mesh.renderOrder = 2;
    mesh.userData.pick = organ.id;
    root.add(mesh);
    materials.push({ circuit: organ.circuit, material, base: material.opacity });
  }
  return { root, materials };
}
