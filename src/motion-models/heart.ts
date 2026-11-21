import * as THREE from "three";
import type { Vec3 } from "../landmarks";
import type { Chamber, ValveKey } from "../motions";
import { arrow, clear, curvePoints, Deformer, glow, marker, plastic, pointArrow, slab, smoothLoop, smoothstep, tube, type P2 } from "./common";

/**
 * 心臓の「わかりやすい模型」: 教科書の前頭断の模式図（右心房・右心室・左心房・左心室）を厚みのある板にし、
 * 大血管を管で出したもの。cm で作る（x は本人の左・y は上・z は前。前から見ると右心系が画面の左）。
 * 部屋は容積に合わせて縮み、房室弁と動脈弁は流れに合わせて開く
 */

/** 外の輪郭 */
const OUTER: P2[] = [
  [-4.6, 5.3], [-6.6, 4.6], [-7.5, 2.6], [-7.4, 0.2], [-6.6, -1.6], [-5.8, -3.6], [-4.0, -6.0], [-1.2, -8.0], [1.8, -9.4], [3.8, -9.8],
  [5.6, -8.4], [7.0, -5.4], [7.6, -2.4], [7.4, 0.4], [6.8, 2.6], [5.8, 4.4], [3.6, 5.1], [1.4, 4.8], [0.0, 4.4], [-1.6, 5.0], [-3.2, 5.4],
];
/** 右心系の内腔（右心房と右心室を三尖弁の口でつなぐ） */
const RIGHT: P2[] = [
  [-3.2, 4.4], [-5.4, 4.2], [-6.5, 2.6], [-6.5, 0.6], [-5.7, -0.3], [-4.9, -0.6],
  [-5.1, -1.5], [-4.9, -3.2], [-3.6, -5.2], [-1.8, -6.4], [-0.5, -6.2], [-0.1, -4.6], [-0.1, -2.6], [-0.3, -1.3], [-0.6, -0.75], [-1.5, -0.8], [-2.1, -0.45],
  [-1.9, 0.4], [-1.8, 2.2], [-2.0, 3.8],
];
/** 左心系の内腔（左心房と左心室を僧帽弁の口でつなぐ） */
const LEFT: P2[] = [
  [3.0, 4.2], [4.8, 4.0], [6.2, 2.8], [6.3, 1.2], [5.7, 0.2], [5.0, -0.2],
  [5.6, -1.2], [6.1, -3.4], [5.6, -6.2], [4.3, -8.3], [3.0, -7.6], [1.2, -5.2], [0.9, -3.0], [1.0, -1.3], [1.3, -0.7], [2.0, -0.55], [2.4, -0.2],
  [2.0, 0.9], [1.9, 2.6], [2.2, 3.8],
];

export const SLAB = 3.2;
const FRONT = SLAB / 2;

/** 部屋の縮み方: c は部屋の中心、a は縮むときに寄る点（心室は心尖の方）、r は動く範囲、k は縮みの強さ */
const FIELD: Record<Chamber, { c: P2; a: P2; r: number; k: number }> = {
  ra: { c: [-3.8, 2.0], a: [-3.6, 1.6], r: 4.2, k: 0.2 },
  rv: { c: [-2.6, -3.4], a: [-1.6, -4.6], r: 5.0, k: 0.24 },
  la: { c: [3.4, 2.2], a: [3.4, 1.8], r: 4.0, k: 0.2 },
  lv: { c: [3.4, -3.8], a: [3.3, -5.2], r: 5.5, k: 0.26 },
};
export const CHAMBERS: Chamber[] = ["ra", "rv", "la", "lv"];

/** 部屋の縮み（0〜1）で点を動かす量（cm。z は動かさない） */
export function heartField(p: { x: number; y: number }, contract: Record<Chamber, number>, out: THREE.Vector3): THREE.Vector3 {
  out.set(0, 0, 0);
  for (const key of CHAMBERS) {
    const w = contract[key];
    if (!w) continue;
    const f = FIELD[key];
    const d = Math.hypot(p.x - f.c[0], p.y - f.c[1]) / f.r;
    const fall = 1 - smoothstep(0.55, 1.25, d);
    if (!fall) continue;
    out.x += w * f.k * fall * (f.a[0] - p.x);
    out.y += w * f.k * fall * (f.a[1] - p.y);
  }
  return out;
}

/** 点が多角形の中か */
export function inside(points: P2[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 大血管（管の中心線）。end は心臓から離れる側の端で、全身の模型（肺循環と体循環）はここから血管をつなぐ */
export interface Vessel {
  id: string;
  ja: string;
  /** 動脈血か静脈血か（色） */
  blood: "arterial" | "venous";
  radius: number;
  /** 血液の流れる向きの点（cm） */
  points: Vec3[];
}

export const VESSELS: Vessel[] = [
  { id: "svc", ja: "上大静脈", blood: "venous", radius: 1.0, points: [[-3.4, 12.5, 0], [-3.4, 6.5, 0], [-3.5, 4.4, 0], [-3.6, 3.0, 0.3]] },
  { id: "ivc", ja: "下大静脈", blood: "venous", radius: 1.1, points: [[-6.6, -11, -0.2], [-6.7, -3.0, -0.2], [-6.3, -0.6, 0], [-5.4, 0.9, 0.3]] },
  { id: "pt", ja: "肺動脈幹", blood: "venous", radius: 1.0, points: [[-0.9, -1.8, 0], [-0.8, -0.4, 1.6], [-0.5, 0.9, 2.7], [0.5, 3.2, 3.0], [1.3, 5.3, 2.4], [1.4, 6.4, 1.4]] },
  { id: "rpa", ja: "右肺動脈", blood: "venous", radius: 0.75, points: [[1.4, 6.4, 1.4], [0.2, 6.6, -0.6], [-1.2, 6.5, -1.9], [-3.4, 6.2, -2.4], [-9.5, 5.8, -2.4]] },
  { id: "lpa", ja: "左肺動脈", blood: "venous", radius: 0.75, points: [[1.4, 6.4, 1.4], [3.4, 6.8, 0.2], [5.6, 6.6, -0.6], [9.5, 6.2, -0.8]] },
  { id: "rspv", ja: "右肺静脈", blood: "arterial", radius: 0.6, points: [[-10.5, 3.4, -3.0], [-2.0, 3.2, -3.0], [0.8, 3.0, -2.0], [2.4, 2.8, -0.2]] },
  { id: "ripv", ja: "右肺静脈", blood: "arterial", radius: 0.6, points: [[-10.5, 1.4, -3.0], [-2.0, 1.4, -3.0], [0.8, 1.6, -2.0], [2.4, 1.8, -0.2]] },
  { id: "lspv", ja: "左肺静脈", blood: "arterial", radius: 0.6, points: [[10.5, 3.6, 0], [6.8, 3.1, 0], [4.9, 2.7, 0.2]] },
  { id: "lipv", ja: "左肺静脈", blood: "arterial", radius: 0.6, points: [[10.5, 1.0, -0.4], [6.6, 1.3, 0], [4.7, 1.6, 0.2]] },
  { id: "aorta", ja: "大動脈", blood: "arterial", radius: 1.15, points: [[1.6, -1.9, -0.2], [1.4, -0.4, 1.0], [0.6, 1.6, 1.2], [-0.4, 4.4, 0.9], [-0.6, 7.0, 0.4], [0.2, 9.0, -0.4], [2.4, 10.0, -1.4], [4.4, 9.2, -2.6]] },
  { id: "desc", ja: "下行大動脈", blood: "arterial", radius: 1.0, points: [[4.4, 9.2, -2.6], [5.0, 6.5, -3.2], [5.0, 0, -3.2], [5.0, -11, -3.2]] },
  { id: "bct", ja: "腕頭動脈", blood: "arterial", radius: 0.5, points: [[0.5, 9.5, -0.6], [0.2, 11, -0.6], [0.0, 12.5, -0.6]] },
  { id: "lcca", ja: "左総頸動脈", blood: "arterial", radius: 0.4, points: [[1.9, 10.1, -1.2], [2.0, 11, -1.2], [2.1, 12.5, -1.2]] },
  { id: "lsa", ja: "左鎖骨下動脈", blood: "arterial", radius: 0.42, points: [[3.4, 9.8, -2.0], [4.0, 11, -2.1], [4.6, 12.2, -2.2]] },
];

/** 弁: 房室弁は2枚の尖を弁輪の両端（hinge）で、動脈弁は管の中の2枚の半月弁 */
interface ValveSpec {
  key: ValveKey;
  ja: string;
  term: string;
}
const AV_VALVES: (ValveSpec & { hinges: [P2, P2]; length: number; papillary: P2[] })[] = [
  { key: "ti", ja: "三尖弁", term: "tricuspid-valve", hinges: [[-4.9, -0.6], [-2.1, -0.45]], length: 1.6, papillary: [[-3.7, -4.2], [-2.2, -4.9]] },
  { key: "mi", ja: "僧帽弁", term: "mitral-valve", hinges: [[2.4, -0.2], [5.0, -0.2]], length: 1.45, papillary: [[3.0, -5.4], [4.7, -5.0]] },
];
const SL_VALVES: (ValveSpec & { vessel: string; y: number })[] = [
  { key: "po", ja: "肺動脈弁", term: "pulmonary-valve", vessel: "pt", y: 1.2 },
  { key: "ao", ja: "大動脈弁", term: "aortic-valve", vessel: "aorta", y: 0.3 },
];
/** 乳頭筋（壁の根もと → 先） */
const PAPILLARY: [P2, P2][] = [[[-4.7, -4.9], [-3.7, -4.2]], [[-1.4, -6.0], [-2.2, -4.9]], [[2.0, -6.8], [3.0, -5.4]], [[5.7, -6.0], [4.7, -5.0]]];

/** 刺激伝導系（cm、板の前の面に描く） */
const FACE = FRONT + 0.12;
export const CONDUCTION_PATHS = {
  san: [-4.6, 4.75, FACE] as Vec3,
  avn: [-1.3, 0.1, FACE] as Vec3,
  /** 洞房結節 → 心房中隔 → 房室結節（前結節間路）と、左心房へ（バッハマン束） */
  internodal: [[-4.6, 4.75, FACE], [-2.8, 4.95, FACE], [-1.3, 4.4, FACE], [-1.0, 2.2, FACE], [-1.2, 0.8, FACE], [-1.3, 0.1, FACE]] as Vec3[],
  bachmann: [[-1.3, 4.4, FACE], [0.6, 4.5, FACE], [2.8, 4.75, FACE], [5.4, 4.3, FACE]] as Vec3[],
  his: [[-1.3, 0.1, FACE], [-0.2, -0.4, FACE], [0.4, -1.3, FACE]] as Vec3[],
  rbb: [[0.4, -1.3, FACE], [0.05, -3.0, FACE], [-0.15, -5.0, FACE], [-0.8, -5.9, FACE + 0.2], [-2.8, -5.7, FACE + 0.4], [-4.5, -4.6, FACE + 0.2], [-5.3, -2.8, FACE], [-5.6, -1.4, FACE]] as Vec3[],
  lbb: [[0.4, -1.3, FACE], [0.85, -3.0, FACE], [1.5, -5.6, FACE], [2.8, -7.9, FACE], [4.0, -8.9, FACE], [5.6, -7.4, FACE], [6.5, -5.0, FACE], [6.85, -2.4, FACE], [6.5, -0.6, FACE]] as Vec3[],
};

export interface HeartTag {
  text: string;
  note?: string;
  at: Vec3;
  kind: "chamber" | "vessel" | "valve" | "conduction";
  term?: string;
  valve?: ValveKey;
}

export interface HeartModel {
  root: THREE.Group;
  /** 部屋の縮み（0〜1）と弁の開き（0〜1）で形を動かす */
  update(contract: Record<Chamber, number>, open: Record<ValveKey, number>): void;
  /** 壁の色を点ごとに決める（region: どの部屋の壁か・atrial: 心房の側か）。毎フレーム呼んでよい */
  paint(color: (x: number, y: number, region: Chamber, out: THREE.Color) => void): void;
  /** 部屋の中の点（cm、動かす前）を n 個 */
  samples(chamber: Chamber, n: number, seed: number): Vec3[];
  /** 今の形で点を動かす（cm） */
  move(p: Vec3, out: Vec3): void;
  /** 弁の口の中心（cm、動かす前） */
  valveCenter: Record<ValveKey, Vec3>;
  tags: HeartTag[];
  /** 大血管の管（id → 材質。透かし方を変える） */
  vesselMaterials: Map<string, THREE.MeshStandardMaterial>;
  /** 刺激伝導系の部品（出し入れ） */
  conduction: THREE.Group | null;
  /** 動脈弁（刺激伝導系の場面では隠す） */
  semilunar: THREE.Group[];
  /** 心房・心室が縮む向きの矢印（強さ 0〜1） */
  arrows: Record<"atria" | "ventricles", THREE.Group>;
}

export const MUSCLE = "#c4675d";
const INNER = "#8f3d38";
export const VENOUS = "#3d63c9";
export const ARTERIAL = "#d23b3b";
const FLOOR: Record<"right" | "left", string> = { right: "#bccbef", left: "#f1c2c0" };

/** 壁の点がどの部屋の壁か（cm） */
export const heartRegion = (x: number, y: number): Chamber => {
  const atrial = y > 0.15 + (Math.abs(x) < 1.4 ? 0.2 : 0);
  const right = x < 0.4 - (atrial ? 0.4 : 0);
  return atrial ? (right ? "ra" : "la") : right ? "rv" : "lv";
};

export function buildHeart(options: { conduction?: boolean; vessels?: string[] } = {}): HeartModel {
  const root = new THREE.Group();
  const outer = smoothLoop(OUTER, 96);
  const right = smoothLoop(RIGHT, 96);
  const left = smoothLoop(LEFT, 96);

  // 壁（切り口を前に向けた板）。色は点ごと（興奮・収縮を色で）
  const wallGeometry = slab(outer, [right, left], SLAB, 0.3);
  const wallCount = wallGeometry.getAttribute("position").count;
  wallGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(wallCount * 3).fill(1), 3));
  const wall = new THREE.Mesh(wallGeometry, [plastic(MUSCLE, { vertexColors: true }), plastic(MUSCLE, { vertexColors: true, roughness: 0.6 })]);
  wall.userData.pick = "heart";
  // 後ろの壁（部屋の奥）
  const back = new THREE.Mesh(slab(outer, [], 0.7, 0.15), plastic(INNER, { roughness: 0.7 }));
  back.position.z = -FRONT - 0.2;
  back.userData.pick = "heart";
  // 部屋の底の血の色（右は静脈血・左は動脈血）
  const floors = ([["right", right], ["left", left]] as const).map(([side, loop]) => {
    const mesh = new THREE.Mesh(slab(loop, [], 0.12, 0), plastic(FLOOR[side], { roughness: 0.8 }));
    mesh.position.z = -FRONT + 0.05;
    mesh.userData.pick = side === "right" ? "right-heart" : "left-heart";
    return mesh;
  });
  root.add(wall, back, ...floors);

  // 乳頭筋
  const papillary = PAPILLARY.map(([base, tip]) => {
    const length = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
    const geometry = new THREE.ConeGeometry(0.55, length, 14);
    geometry.translate(0, length / 2, 0);
    const mesh = new THREE.Mesh(geometry, plastic(MUSCLE));
    pointArrowMesh(mesh, [base[0], base[1], 0], [tip[0], tip[1], 0]);
    mesh.userData.pick = "papillary-muscles";
    root.add(mesh);
    return mesh;
  });
  // 乳頭筋は変形の前に行列を頂点へ焼く（Deformer は部品の座標で動かすので）
  for (const mesh of papillary) {
    mesh.updateMatrix();
    mesh.geometry.applyMatrix4(mesh.matrix);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.setScalar(1);
  }

  // 大血管
  const vesselMaterials = new Map<string, THREE.MeshStandardMaterial>();
  const vesselMeshes: THREE.Mesh[] = [];
  const wanted = options.vessels ? new Set(options.vessels) : null;
  for (const vessel of VESSELS) {
    if (wanted && !wanted.has(vessel.id)) continue;
    const material = clear(vessel.blood === "venous" ? VENOUS : ARTERIAL, 0.32);
    vesselMaterials.set(vessel.id, material);
    const mesh = new THREE.Mesh(tube(vessel.points, vessel.radius, 72, 16), material);
    mesh.renderOrder = 4;
    mesh.userData.pick = vessel.id;
    vesselMeshes.push(mesh);
    root.add(mesh);
  }

  // 変形（4つの部屋の縮み）
  const contractOf = (c: number): Record<Chamber, number> => ({ ra: c === 0 ? 1 : 0, rv: c === 1 ? 1 : 0, la: c === 2 ? 1 : 0, lv: c === 3 ? 1 : 0 });
  const units = CHAMBERS.map((_, c) => contractOf(c));
  const deformer = new Deformer([wall, back, ...floors, ...papillary, ...vesselMeshes], 4, (p, mesh, c, out) => {
    heartField(p, units[c], out);
    // 血管は心臓から離れるほど動かさない
    if (vesselMeshes.includes(mesh)) out.multiplyScalar(1 - smoothstep(4, 8, Math.max(Math.abs(p.y - 0.5) - 4, Math.abs(p.x) - 5)));
  });
  const weights = new Float32Array(4);

  // 房室弁（尖と腱索）
  const valveMaterial = plastic("#f6f1e4", { roughness: 0.4 });
  const chordMaterial = new THREE.LineBasicMaterial({ color: "#f6f1e4", transparent: true, opacity: 0.85 });
  const avValves = AV_VALVES.map((spec) => {
    const leaflets = spec.hinges.map((hinge, side) => {
      const geometry = new THREE.BoxGeometry(spec.length, 0.2, SLAB - 0.6);
      geometry.translate(spec.length / 2, 0, 0);
      const mesh = new THREE.Mesh(geometry, valveMaterial);
      mesh.userData.pick = spec.term;
      root.add(mesh);
      // side 0 は +x の向き（右へ）、1 は -x の向き
      return { mesh, hinge, side };
    });
    const chordGeometry = new THREE.BufferGeometry();
    chordGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3 * 3 * 2), 3));
    const chords = new THREE.LineSegments(chordGeometry, chordMaterial);
    chords.frustumCulled = false;
    root.add(chords);
    return { spec, leaflets, chords };
  });

  // 動脈弁（管の中の2枚の半月弁）
  const vesselLine = new Map(VESSELS.map((vessel) => [vessel.id, curvePoints(vessel.points, 96)]));
  const slValves = SL_VALVES.map((spec) => {
    const vessel = VESSELS.find((v) => v.id === spec.vessel)!;
    const line = vesselLine.get(spec.vessel)!;
    const i = Math.max(1, line.findIndex((p) => p[1] >= spec.y));
    const center = new THREE.Vector3(...line[i]);
    const tangent = new THREE.Vector3(...line[i + 1]).sub(new THREE.Vector3(...line[i - 1])).normalize();
    const group = new THREE.Group();
    group.position.copy(center);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    const r = vessel.radius * 0.92;
    const cusps = [1, -1].map((sign) => {
      const geometry = new THREE.BoxGeometry(r * 1.02, 0.16, r * 1.6);
      geometry.translate(r * 0.51, 0, 0);
      const mesh = new THREE.Mesh(geometry, valveMaterial);
      mesh.position.x = sign * r;
      mesh.userData.pick = spec.term;
      group.add(mesh);
      return { mesh, sign };
    });
    root.add(group);
    return { spec, group, cusps, rest: center.clone() };
  });

  // 刺激伝導系
  let conduction: THREE.Group | null = null;
  if (options.conduction) {
    conduction = new THREE.Group();
    const lineMaterial = glow("#ffd23f");
    const c = CONDUCTION_PATHS;
    const add = (points: Vec3[], radius: number, pick: string) => {
      const mesh = new THREE.Mesh(tube(points, radius, 64, 8), lineMaterial);
      mesh.userData.pick = pick;
      conduction!.add(mesh);
    };
    add(c.internodal, 0.12, "internodal");
    add(c.bachmann, 0.12, "internodal");
    add(c.his, 0.26, "atrioventricular-bundle");
    add(c.rbb, 0.22, "right-bundle-branch");
    add(c.lbb, 0.24, "left-bundle-branch");
    // プルキンエ線維: 脚の下の方から壁の中へ細い枝
    const twig = (points: Vec3[], from: number, center: P2) => {
      const line = curvePoints(points, 60);
      for (let i = Math.floor(line.length * from); i < line.length - 2; i += 3) {
        const [x, y, z] = line[i];
        const dx = x - center[0];
        const dy = y - center[1];
        const d = Math.hypot(dx, dy) || 1;
        const turn = ((i * 7919) % 11) / 11 - 0.5;
        const ux = dx / d;
        const uy = dy / d;
        const end: Vec3 = [x + (ux * Math.cos(turn) - uy * Math.sin(turn)) * 0.65, y + (uy * Math.cos(turn) + ux * Math.sin(turn)) * 0.65, z];
        const mesh = new THREE.Mesh(tube([[x, y, z], [(x + end[0]) / 2 + turn * 0.2, (y + end[1]) / 2, z], end], 0.07, 6, 5), lineMaterial);
        mesh.userData.pick = "purkinje-fibers";
        conduction!.add(mesh);
      }
    };
    twig(c.lbb, 0.35, [3.4, -4.0]);
    twig(c.rbb, 0.45, [-2.6, -3.2]);
    for (const [at, r, pick] of [[c.san, 0.6, "sinuatrial-node"], [c.avn, 0.5, "atrioventricular-node"]] as const) {
      const node = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), glow("#ffb000"));
      node.scale.z = 0.45;
      node.position.set(...at);
      node.userData.pick = pick;
      conduction.add(node);
    }
    root.add(conduction);
  }

  // 縮む向きの矢印（心房・心室）
  const arrowMaterial = marker("#fff3c0", 0.9);
  const arrowGroup = (pairs: [Vec3, Vec3][]) => {
    const group = new THREE.Group();
    for (const [from, to] of pairs) {
      const a = arrow(1, 0.07, arrowMaterial);
      pointArrow(a, from, to);
      group.add(a);
    }
    group.visible = false;
    group.userData.pick = false;
    root.add(group);
    return group;
  };
  const arrows = {
    atria: arrowGroup([[[-7.9, 2.4, FRONT], [-6.9, 2.2, FRONT]], [[7.0, 3.6, FRONT], [6.1, 3.1, FRONT]]]),
    ventricles: arrowGroup([[[-6.6, -4.2, FRONT], [-5.4, -3.8, FRONT]], [[8.3, -3.4, FRONT], [7.0, -3.5, FRONT]], [[2.5, -11.0, FRONT], [3.0, -9.9, FRONT]]]),
  };

  // 壁の点の部屋
  const wallPosition = wallGeometry.getAttribute("position") as THREE.BufferAttribute;
  const wallColor = wallGeometry.getAttribute("color") as THREE.BufferAttribute;
  const restWall = Float32Array.from(wallPosition.array as Float32Array);
  const regions: Chamber[] = [];
  for (let i = 0; i < wallCount; i++) regions.push(heartRegion(restWall[i * 3], restWall[i * 3 + 1]));

  const current: Record<Chamber, number> = { ra: 0, rv: 0, la: 0, lv: 0 };
  const shift = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const pivot = new THREE.Vector3();
  const valveCenter = {} as Record<ValveKey, Vec3>;
  for (const valve of avValves) {
    const [a, b] = valve.spec.hinges;
    valveCenter[valve.spec.key] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.3, 0];
  }
  for (const valve of slValves) valveCenter[valve.spec.key] = valve.rest.toArray() as Vec3;

  const model: HeartModel = {
    root,
    update(contract, open) {
      Object.assign(current, contract);
      weights[0] = contract.ra;
      weights[1] = contract.rv;
      weights[2] = contract.la;
      weights[3] = contract.lv;
      deformer.apply(weights);
      for (const { spec, leaflets, chords } of avValves) {
        const o = open[spec.key];
        const chord = chords.geometry.getAttribute("position") as THREE.BufferAttribute;
        let k = 0;
        for (const { mesh, hinge, side } of leaflets) {
          heartField({ x: hinge[0], y: hinge[1] }, current, shift);
          mesh.position.set(hinge[0] + shift.x, hinge[1] + shift.y, 0);
          const closed = THREE.MathUtils.degToRad(side === 0 ? -16 : 196);
          const opened = THREE.MathUtils.degToRad(side === 0 ? -84 : 264);
          mesh.rotation.z = closed + (opened - closed) * o;
          // 腱索: 尖の先から乳頭筋の先へ（3本ずつ、奥行きを変えて）
          tip.set(Math.cos(mesh.rotation.z) * spec.length * 0.92, Math.sin(mesh.rotation.z) * spec.length * 0.92, 0).add(mesh.position);
          const target = spec.papillary[side];
          heartField({ x: target[0], y: target[1] }, current, pivot);
          for (const z of [-0.9, 0, 0.9]) {
            chord.setXYZ(k++, tip.x, tip.y, z);
            chord.setXYZ(k++, target[0] + pivot.x, target[1] + pivot.y, z * 0.3);
          }
        }
        chord.needsUpdate = true;
      }
      for (const { spec, group, cusps, rest } of slValves) {
        heartField(rest, current, shift);
        group.position.copy(rest).add(shift);
        const o = open[spec.key];
        for (const { mesh, sign } of cusps) {
          // 閉じると中心へ向けて少し下（心室の側）へ、開くと壁に沿って上へ
          const closed = THREE.MathUtils.degToRad(sign > 0 ? 205 : -25);
          const opened = THREE.MathUtils.degToRad(sign > 0 ? 100 : 80);
          mesh.rotation.z = closed + (opened - closed) * o;
        }
      }
    },
    paint(color) {
      const c = new THREE.Color();
      const array = wallColor.array as Float32Array;
      for (let i = 0; i < wallCount; i++) {
        color(restWall[i * 3], restWall[i * 3 + 1], regions[i], c);
        array[i * 3] = c.r;
        array[i * 3 + 1] = c.g;
        array[i * 3 + 2] = c.b;
      }
      wallColor.needsUpdate = true;
    },
    samples(chamber, n, seed) {
      let s = seed;
      const rand = () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
      const loop = chamber === "ra" || chamber === "rv" ? right : left;
      const atrial = chamber === "ra" || chamber === "la";
      const out: Vec3[] = [];
      for (let tries = 0; out.length < n && tries < n * 200; tries++) {
        const x = -7 + rand() * 14;
        const y = -9 + rand() * 14;
        if (atrial ? y < 0.9 : y > -1.4) continue;
        if (!inside(loop, x, y)) continue;
        // 壁から少し離す
        if (!inside(loop, x + 0.45, y) || !inside(loop, x - 0.45, y) || !inside(loop, x, y + 0.45) || !inside(loop, x, y - 0.45)) continue;
        out.push([x, y, -0.9 + rand() * 2.1]);
      }
      return out;
    },
    move(p, out) {
      heartField({ x: p[0], y: p[1] }, current, shift);
      out[0] = p[0] + shift.x;
      out[1] = p[1] + shift.y;
      out[2] = p[2];
    },
    valveCenter,
    tags: [
      { text: "右心房", at: [-4.2, 2.6, FRONT], kind: "chamber", term: "right-atrium" },
      { text: "右心室", at: [-2.8, -3.4, FRONT], kind: "chamber", term: "right-ventricle" },
      { text: "左心房", at: [3.7, 2.4, FRONT], kind: "chamber", term: "left-atrium" },
      { text: "左心室", at: [3.6, -3.4, FRONT], kind: "chamber", term: "left-ventricle" },
      { text: "上大静脈", note: "全身（上半身）から", at: [-3.4, 11.6, 0], kind: "vessel", term: "superior-vena-cava" },
      { text: "下大静脈", note: "全身（下半身）から", at: [-6.6, -10.2, 0], kind: "vessel", term: "inferior-vena-cava" },
      { text: "肺動脈", note: "肺へ", at: [-8.6, 5.6, -2.4], kind: "vessel", term: "pulmonary-trunk" },
      { text: "肺動脈", note: "肺へ", at: [8.6, 6.0, -0.8], kind: "vessel", term: "pulmonary-trunk" },
      { text: "肺静脈", note: "肺から", at: [9.4, 2.3, 0], kind: "vessel", term: "pulmonary-veins" },
      { text: "大動脈", note: "全身へ", at: [2.4, 11.4, -1.4], kind: "vessel", term: "aortic-arch" },
      ...AV_VALVES.map((spec): HeartTag => ({ text: spec.ja, at: [(spec.hinges[0][0] + spec.hinges[1][0]) / 2, -1.9, FRONT], kind: "valve", term: spec.term, valve: spec.key })),
      ...slValves.map(({ spec, rest }): HeartTag => ({ text: spec.ja, at: [rest.x + (spec.key === "po" ? -0.4 : 0.6), rest.y + (spec.key === "po" ? 1.5 : -1.4), rest.z + 0.4], kind: "valve", term: spec.term, valve: spec.key })),
    ],
    vesselMaterials,
    conduction,
    semilunar: slValves.map((valve) => valve.group),
    arrows,
  };
  model.paint((_x, _y, _r, out) => out.set(MUSCLE));
  model.update({ ra: 0, rv: 0, la: 0, lv: 0 }, { ti: 0, mi: 0, po: 0, ao: 0 });
  return model;
}

/** 部品（+y 向きに作った形）を from から to へ向ける */
function pointArrowMesh(mesh: THREE.Object3D, from: Vec3, to: Vec3): void {
  const direction = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
  mesh.position.set(...from);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
}
