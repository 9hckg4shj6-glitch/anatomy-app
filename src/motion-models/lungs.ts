import * as THREE from "three";
import type { Vec3 } from "../landmarks";
import { arrow, clear, curvePoints, Deformer, marker, plastic, pointArrow, smoothstep, tube } from "./common";

/**
 * 呼吸の「わかりやすい模型」: 胸郭（肋骨・肋軟骨・胸骨・脊柱）・左右の肺・気管と気管支・横隔膜・肝臓と胃。cm で作る
 * （x は本人の左・y は上・z は前）。breath（0〜1、吸い終わりで 1）で、横隔膜が下がり、肋骨が上がって広がり、肺がふくらむ
 */

const BONE = "#eee5cf";
const CARTILAGE = "#cfe2e8";
const LUNG = "#f2a2ac";
const DIAPHRAGM = "#b9473d";
const TENDON = "#eadfca";
const AIRWAY = "#e4ecee";

/** 安静呼吸の吸い終わりの動き（cm・度）。実際（横隔膜 約1.5cm）より大きくして見やすく */
export const BREATH = { diaphragm: 3.2, pump: 5.5, bucket: 6, lung: { lateral: 1.0, front: 1.1 } };

/** 肋骨の数と、肋骨ごとの形（脊柱の端の高さ・横の広がり・前後の深さ・前へ下がる量・前の端まで届くか） */
const RIBS = Array.from({ length: 10 }, (_, k) => {
  const i = k + 1;
  return {
    i,
    y: 13.2 - k * 2.55,
    a: [7, 10, 12, 13.4, 14.4, 15, 15.2, 15, 14.4, 13.6][k],
    b: [5.5, 7, 8, 8.8, 9.4, 9.8, 10, 10, 9.8, 9.4][k],
    drop: [2.4, 4, 5, 5.6, 6, 6.2, 6.4, 6.2, 5.6, 5][k],
    /** 前の端の角度（π で胸骨へ届く）。8〜10 は肋軟骨が上の肋軟骨へつく（仮肋） */
    end: i <= 7 ? Math.PI * 0.94 : Math.PI * (0.86 - (i - 8) * 0.06),
    /** 肋軟骨になる所 */
    cartilage: i <= 7 ? Math.PI * (0.8 - i * 0.012) : Math.PI * 0.72,
  };
});
const SPINE_Z = -9.2;

/** 横隔膜の高さ（rest） */
export function diaphragmHeight(x: number, z: number): number {
  const rim = -11.5 - 1.5 * smoothstep(-2, -9, z);
  const right = 8.6 * Math.exp(-((x + 6) ** 2) / 34 - ((z + 0.5) ** 2) / 44);
  const left = 7.6 * Math.exp(-((x - 6) ** 2) / 34 - ((z + 0.5) ** 2) / 44);
  const middle = 6.6 * Math.exp(-(x ** 2) / 30 - ((z - 1) ** 2) / 40);
  return rim + Math.max(right, left, middle);
}
/** 横隔膜の下がり方（ドームの上ほど 1、縁は 0） */
const descent = (x: number, z: number): number => smoothstep(-11.5, -4, diaphragmHeight(x, z));

/** 肋骨の中心線（体の片側。side は -1 右・+1 左） */
function ribCurve(rib: (typeof RIBS)[number], side: number, from: number, to: number, n = 28): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k <= n; k++) {
    const phi = from + ((to - from) * k) / n;
    const x = side * (1.6 + (rib.a - 1.6) * Math.sin(phi) - (phi > Math.PI * 0.8 ? (phi - Math.PI * 0.8) * 3.5 : 0));
    const z = -rib.b * Math.cos(phi) + (SPINE_Z + rib.b) * (1 - smoothstep(0, Math.PI * 0.5, phi)) * 0.4;
    const y = rib.y - rib.drop * (1 - Math.cos(phi)) * 0.5;
    out.push([x, y, z]);
  }
  return out;
}

export interface LungTag {
  text: string;
  note?: string;
  at: Vec3;
  kind: "organ" | "chamber" | "note";
  term?: string;
  /** 吸うとき・吐くときだけ出す札 */
  phase?: "in" | "out";
}

export interface LungModel {
  root: THREE.Group;
  /** breath: 0〜1（吸い終わりで 1）。deep は深呼吸の倍率 */
  update(breath: number, flow: number): void;
  /** 空気の通り道（気管 → 気管支 → 肺の中、cm） */
  airways: Vec3[][];
  /** 今の形で点を動かす（気管支の中の空気の粒） */
  move(p: Vec3, out: Vec3): void;
  tags: LungTag[];
  arrows: { inhale: THREE.Group; exhale: THREE.Group };
  parts: { heart: THREE.Object3D; abdomen: THREE.Object3D; ribs: THREE.Object3D };
  lungMaterial: THREE.MeshStandardMaterial;
}

/** 肺の形（球を変形）。side は -1 右・+1 左 */
function lungGeometry(side: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 56, 40);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const t = (v.y + 1) / 2; // 0 底 〜 1 肺尖
    const narrow = 1 - 0.55 * smoothstep(0.55, 1, t) ** 1.4;
    let x = v.x * 6.6 * narrow;
    const z = v.z * 8.2 * narrow * (0.85 + 0.15 * (1 - t));
    let y = -10.5 + t * 24.5;
    // 内側（心臓の側）は平らに。左肺は下の方を大きくえぐる（心切痕）
    const medial = x * side < 0;
    if (medial) x *= side > 0 ? 0.42 + 0.4 * smoothstep(0.1, 0.55, t) : 0.62;
    x += side * 7.6;
    // 底は横隔膜のドームに沿ってくぼませる
    const floor = diaphragmHeight(x, z) + 0.35;
    if (y < floor + 1.2) y = floor + Math.max(0, y - floor + 1.2) * 0.3 + (t < 0.25 ? 0 : 0);
    position.setXYZ(i, x, y, z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** 楕円体（臓器のかたまり） */
function blob(size: Vec3, center: Vec3, material: THREE.Material, pick: string): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), material);
  mesh.scale.set(...size);
  mesh.position.set(...center);
  mesh.userData.pick = pick;
  return mesh;
}

export function buildLungs(): LungModel {
  const root = new THREE.Group();

  // 脊柱（椎体）
  const bone = plastic(BONE, { roughness: 0.55 });
  const spine = new THREE.Group();
  for (let y = -19; y <= 17; y += 2.55) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 2.0, 20), bone);
    body.position.set(0, y, SPINE_Z - 1.4);
    body.userData.pick = "thoracic-vertebrae";
    spine.add(body);
  }
  root.add(spine);

  // 肋骨（左右 10 本ずつ。脊柱の端を軸に回す）
  const cartilage = plastic(CARTILAGE, { roughness: 0.5 });
  const ribs = new THREE.Group();
  const ribPivots: { group: THREE.Group; rib: (typeof RIBS)[number]; side: number; front: THREE.Vector3 }[] = [];
  for (const rib of RIBS) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      const origin = new THREE.Vector3(side * 1.6, rib.y, SPINE_Z + rib.b * 0.4 - rib.b * 0.4);
      const points = ribCurve(rib, side, 0.05, rib.end);
      origin.set(...points[0]);
      pivot.position.copy(origin);
      const local = (list: Vec3[]): Vec3[] => list.map(([x, y, z]) => [x - origin.x, y - origin.y, z - origin.z]);
      const boneMesh = new THREE.Mesh(tube(local(ribCurve(rib, side, 0.05, rib.cartilage)), 0.5, 40, 8), bone);
      boneMesh.userData.pick = "ribs";
      let tail = ribCurve(rib, side, rib.cartilage - 0.02, rib.end, 10);
      // 仮肋（8〜10）の肋軟骨は上の肋軟骨へ寄せる
      if (rib.i >= 8) {
        const last = tail[tail.length - 1];
        tail = [...tail, [last[0] - side * 1.2, last[1] + 2.0, last[2] + 0.4]];
      }
      const cartilageMesh = new THREE.Mesh(tube(local(tail), 0.45, 16, 8), cartilage);
      cartilageMesh.userData.pick = "costal-cartilages";
      pivot.add(boneMesh, cartilageMesh);
      ribs.add(pivot);
      const end = points[points.length - 1];
      ribPivots.push({ group: pivot, rib, side, front: new THREE.Vector3(end[0] - origin.x, end[1] - origin.y, end[2] - origin.z) });
    }
  }
  root.add(ribs);

  // 胸骨（胸骨柄・胸骨体・剣状突起をひとつの板で。上の端が原点）
  const sternumShape = new THREE.Shape();
  sternumShape.moveTo(-0.9, 0);
  sternumShape.lineTo(-2.7, -0.6);
  sternumShape.quadraticCurveTo(-2.6, -3.2, -1.6, -4.2);
  sternumShape.lineTo(-1.8, -17.6);
  sternumShape.lineTo(-0.7, -18.8);
  sternumShape.lineTo(-0.4, -21.2);
  sternumShape.lineTo(0.4, -21.2);
  sternumShape.lineTo(0.7, -18.8);
  sternumShape.lineTo(1.8, -17.6);
  sternumShape.lineTo(1.6, -4.2);
  sternumShape.quadraticCurveTo(2.6, -3.2, 2.7, -0.6);
  sternumShape.lineTo(0.9, 0);
  sternumShape.quadraticCurveTo(0, -0.7, -0.9, 0);
  const sternumGeometry = new THREE.ExtrudeGeometry(sternumShape, { depth: 0.8, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 2 });
  sternumGeometry.translate(0, 0, -0.4);
  const sternum = new THREE.Mesh(sternumGeometry, bone);
  sternum.userData.pick = "sternum";
  const top = ribCurve(RIBS[0], 1, 0.05, RIBS[0].end).at(-1)!;
  const seventh = ribCurve(RIBS[6], 1, 0.05, RIBS[6].end).at(-1)!;
  sternum.position.set(0, top[1] + 1.4, top[2] + 0.5);
  // 胸骨は下ほど前へ（第7肋軟骨の前の端まで）
  sternum.rotation.x = -Math.atan2(seventh[2] - top[2], top[1] + 1.4 - seventh[1]);
  root.add(sternum);

  // 肺
  const lungMaterial = clear(LUNG, 0.62, { side: THREE.FrontSide });
  lungMaterial.depthWrite = false;
  const lungs = [-1, 1].map((side) => {
    const mesh = new THREE.Mesh(lungGeometry(side), lungMaterial);
    mesh.renderOrder = 3;
    mesh.userData.pick = side < 0 ? "right-lung" : "left-lung";
    root.add(mesh);
    return mesh;
  });

  // 気管と気管支（中心線）
  const trachea: Vec3[] = [[0, 23, 1.6], [0, 16, 1.2], [0, 9.2, 0.6]];
  const bronchi = {
    rightMain: [[0, 9.2, 0.6], [-2.6, 7.2, 0.3], [-4.6, 5.6, 0]] as Vec3[],
    leftMain: [[0, 9.2, 0.6], [2.8, 8.0, 0.3], [5.4, 6.0, 0]] as Vec3[],
    rul: [[-4.6, 5.6, 0], [-6.4, 8.2, 0.2], [-7.6, 11.2, 0]] as Vec3[],
    rml: [[-4.6, 5.6, 0], [-5.6, 3.6, 2.2], [-6.6, 1.2, 4.4]] as Vec3[],
    rll: [[-4.6, 5.6, 0], [-6.2, 1.6, -1.2], [-7.6, -3.6, -2.2]] as Vec3[],
    lul: [[5.4, 6.0, 0], [6.8, 8.6, 0.6], [7.6, 11.4, 0.2]] as Vec3[],
    lll: [[5.4, 6.0, 0], [6.6, 1.6, -1.2], [7.8, -3.8, -2.2]] as Vec3[],
  };
  const airwayMaterial = plastic(AIRWAY, { roughness: 0.4 });
  const airwayMeshes: THREE.Mesh[] = [];
  const addAirway = (points: Vec3[], radius: number, pick: string) => {
    const mesh = new THREE.Mesh(tube(points, radius, 32, 12), airwayMaterial);
    mesh.userData.pick = pick;
    mesh.renderOrder = 2;
    airwayMeshes.push(mesh);
    root.add(mesh);
  };
  addAirway(trachea, 1.05, "trachea");
  addAirway(bronchi.rightMain, 0.78, "right-main-bronchus");
  addAirway(bronchi.leftMain, 0.68, "left-main-bronchus");
  for (const key of ["rul", "rml", "rll", "lul", "lll"] as const) addAirway(bronchi[key], 0.48, "lobar-bronchi");
  // 区域気管支（葉気管支の先から細い枝）
  const twigs: Vec3[][] = [];
  for (const key of ["rul", "rml", "rll", "lul", "lll"] as const) {
    const line = bronchi[key];
    const end = line[line.length - 1];
    const before = line[line.length - 2];
    const dir = new THREE.Vector3(end[0] - before[0], end[1] - before[1], end[2] - before[2]).normalize();
    const side = Math.sign(end[0]);
    for (const [turnX, turnY, turnZ] of [[0.5, 0.2, 0.4], [0.2, -0.4, -0.5], [0.6, 0.4, -0.4]]) {
      const tip: Vec3 = [end[0] + (dir.x + side * turnX) * 2.4, end[1] + (dir.y + turnY) * 2.4, end[2] + (dir.z + turnZ) * 2.4];
      const mid: Vec3 = [(end[0] + tip[0]) / 2, (end[1] + tip[1]) / 2, (end[2] + tip[2]) / 2];
      twigs.push([end, mid, tip]);
      addAirway([end, mid, tip], 0.24, "segmental-bronchi");
    }
  }

  // 横隔膜（ドーム）。縁は赤い筋、真ん中は白い腱中心
  const grid = 44;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const muscle = new THREE.Color(DIAPHRAGM);
  const tendon = new THREE.Color(TENDON);
  const c = new THREE.Color();
  for (let j = 0; j <= grid; j++) {
    for (let i = 0; i <= grid; i++) {
      const a = (i / grid) * Math.PI * 2;
      const r = j / grid;
      const x = Math.cos(a) * r * 14.6;
      const z = Math.sin(a) * r * 9.6 - 0.2;
      positions.push(x, diaphragmHeight(x, z), z);
      const center = Math.exp(-(x ** 2) / 26 - ((z - 0.5) ** 2) / 22);
      c.copy(muscle).lerp(tendon, smoothstep(0.35, 0.75, center));
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const a = j * (grid + 1) + i;
      const b = a + grid + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const diaphragmGeometry = new THREE.BufferGeometry();
  diaphragmGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  diaphragmGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  diaphragmGeometry.setIndex(indices);
  diaphragmGeometry.computeVertexNormals();
  const diaphragm = new THREE.Mesh(diaphragmGeometry, plastic("#ffffff", { vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }));
  diaphragm.userData.pick = "diaphragm";
  root.add(diaphragm);

  // 心臓（横隔膜の腱中心の上）と、腹の臓器（肝臓・胃）
  const heart = blob([4.2, 3.6, 3.6], [1.6, -2.0, 2.4], plastic("#c4675d"), "heart");
  heart.rotation.z = -0.6;
  const abdomen = new THREE.Group();
  abdomen.add(
    blob([8.8, 4.2, 7.2], [-4.4, -15.6, 0.8], plastic("#8e4a3a", { roughness: 0.55 }), "liver"),
    blob([4.4, 3.0, 4.0], [6.2, -14.2, 1.6], plastic("#d8988a", { roughness: 0.55 }), "stomach"),
  );
  root.add(heart, abdomen);

  // 矢印（吸うとき: 横隔膜が下がる・肋骨が上がって外へ・空気が入る／吐くとき: 逆）
  const inMaterial = marker("#ffe066");
  const outMaterial = marker("#cfd6dd", 0.9);
  const arrowSet = (pairs: [Vec3, Vec3][], material: THREE.Material) => {
    const group = new THREE.Group();
    for (const [from, to] of pairs) {
      const a = arrow(1, 0.34, material);
      pointArrow(a, from, to);
      group.add(a);
    }
    group.userData.pick = false;
    root.add(group);
    return group;
  };
  const inhale = arrowSet([
    [[-7, -6.0, 9], [-7, -10.6, 9]], [[7, -6.8, 9], [7, -11.4, 9]],
    [[-16.6, 1, 0], [-18.8, 4.4, 0]], [[16.6, 1, 0], [18.8, 4.4, 0]],
    [[0, -6, 13.2], [0, -3.8, 16.4]],
    [[0, 30, 1.6], [0, 25.6, 1.6]],
  ], inMaterial);
  const exhale = arrowSet([
    [[-7, -10.6, 9], [-7, -6.6, 9]], [[7, -11.4, 9], [7, -7.4, 9]],
    [[-18.8, 4.4, 0], [-16.8, 1.2, 0]], [[18.8, 4.4, 0], [16.8, 1.2, 0]],
    [[0, 25.6, 1.6], [0, 30, 1.6]],
  ], outMaterial);

  // 変形: 肺・気管支は 1 つの形（breath に比例）、横隔膜はドームの下がり
  const lungField = (p: THREE.Vector3, out: THREE.Vector3) => {
    const down = smoothstep(13, -6, p.y) ** 1.15;
    const floor = descent(p.x, p.z);
    out.set(
      Math.sign(p.x) * BREATH.lung.lateral * smoothstep(1.5, 12, Math.abs(p.x)),
      -BREATH.diaphragm * Math.max(down * 0.75, floor * smoothstep(2, -8, p.y)),
      BREATH.lung.front * smoothstep(-6, 8, p.z) * smoothstep(16, 4, p.y),
    );
  };
  const deformer = new Deformer([...lungs, ...airwayMeshes, diaphragm], 1, (p, mesh, _c, out) => {
    if (mesh === diaphragm) out.set(0, -BREATH.diaphragm * descent(p.x, p.z), 0);
    else lungField(p, out);
  });
  // 気管は動かさない（上の方は場が 0 なのでそのまま）
  const weights = new Float32Array(1);
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const frontEnd = new THREE.Vector3();
  const sternumRest = sternum.position.clone();
  const heartRest = heart.position.clone();
  const shift = new THREE.Vector3();

  const model: LungModel = {
    root,
    update(breath, flow) {
      weights[0] = breath;
      deformer.apply(weights);
      // 肋骨: 上の肋骨はポンプの柄（前の端が上と前へ）、下の肋骨はバケツの柄（横が上と外へ）
      let sumY = 0;
      let sumZ = 0;
      let count = 0;
      for (const { group, rib, side, front } of ribPivots) {
        const lower = smoothstep(2, 9, rib.i);
        const pump = THREE.MathUtils.degToRad(BREATH.pump * (1 - lower * 0.6) * breath);
        const bucket = THREE.MathUtils.degToRad(BREATH.bucket * (0.35 + lower * 0.65) * breath);
        q.setFromAxisAngle(X, -pump);
        q2.setFromAxisAngle(Z, side * bucket);
        group.quaternion.copy(q2).multiply(q);
        if (rib.i <= 7) {
          frontEnd.copy(front).applyQuaternion(q).sub(front);
          sumY += frontEnd.y;
          sumZ += frontEnd.z;
          count++;
        }
      }
      sternum.position.set(sternumRest.x, sternumRest.y + sumY / count, sternumRest.z + sumZ / count);
      // 心臓は横隔膜の腱中心と一緒に少し下がる
      heart.position.copy(heartRest);
      heart.position.y -= BREATH.diaphragm * 0.55 * breath;
      abdomen.position.y = -BREATH.diaphragm * 0.85 * breath;
      abdomen.position.z = 0.5 * breath;
      // 矢印は流れているときだけ（吸うと黄、吐くと灰）
      const strength = Math.min(1, Math.abs(flow) * 1.6);
      inhale.visible = flow > 0.04;
      exhale.visible = flow < -0.04;
      for (const group of [inhale, exhale]) group.scale.setScalar(0.6 + 0.4 * strength);
      lungMaterial.opacity = 0.56 + 0.12 * breath;
    },
    airways: [
      [...trachea, ...bronchi.rightMain.slice(1), ...bronchi.rul.slice(1), ...twigs[0].slice(1)],
      [...trachea, ...bronchi.rightMain.slice(1), ...bronchi.rml.slice(1), ...twigs[4].slice(1)],
      [...trachea, ...bronchi.rightMain.slice(1), ...bronchi.rll.slice(1), ...twigs[7].slice(1)],
      [...trachea, ...bronchi.rightMain.slice(1), ...bronchi.rll.slice(1), ...twigs[8].slice(1)],
      [...trachea, ...bronchi.leftMain.slice(1), ...bronchi.lul.slice(1), ...twigs[9].slice(1)],
      [...trachea, ...bronchi.leftMain.slice(1), ...bronchi.lll.slice(1), ...twigs[12].slice(1)],
      [...trachea, ...bronchi.leftMain.slice(1), ...bronchi.lll.slice(1), ...twigs[13].slice(1)],
    ].map((points) => curvePoints(points, 80)),
    move(p, out) {
      const v = new THREE.Vector3(...p);
      lungField(v, shift);
      out[0] = p[0] + shift.x * weights[0];
      out[1] = p[1] + shift.y * weights[0];
      out[2] = p[2] + shift.z * weights[0];
    },
    tags: [
      { text: "気管", at: [0, 19.5, 2.8], kind: "organ", term: "trachea" },
      { text: "右主気管支", note: "太く短く急", at: [-3.6, 8.6, 2.2], kind: "organ", term: "main-bronchus" },
      { text: "左主気管支", at: [3.8, 9.6, 2.2], kind: "organ", term: "main-bronchus" },
      { text: "右肺", at: [-9.2, 3.0, 6.2], kind: "chamber", term: "lung" },
      { text: "左肺", at: [9.4, 3.0, 6.2], kind: "chamber", term: "lung" },
      { text: "横隔膜", at: [-11.0, -9.4, 5.6], kind: "organ", term: "diaphragm" },
      { text: "肋骨", at: [16.6, -6.6, 3], kind: "organ", term: "ribs" },
      { text: "胸骨", at: [0, 1.0, 11.6], kind: "organ", term: "sternum" },
      { text: "心臓", at: [2.6, -2.2, 6.4], kind: "organ" },
      { text: "肝臓", at: [-6.2, -16.4, 8.4], kind: "organ", term: "liver" },
      { text: "胃", at: [6.8, -14.6, 5.8], kind: "organ", term: "stomach" },
      { text: "横隔膜が縮んで下がる", at: [-7, -12.6, 9], kind: "note", phase: "in" },
      { text: "肋骨が上がり、胸郭が広がる", at: [-13.6, 7.6, 2], kind: "note", phase: "in" },
      { text: "胸骨が前へ", at: [0, -8.2, 14], kind: "note", phase: "in" },
      { text: "空気が入る", at: [4.2, 28, 1.6], kind: "note", phase: "in" },
      { text: "横隔膜がゆるんで上がる", at: [-7, -12.6, 9], kind: "note", phase: "out" },
      { text: "胸郭が弾性で戻る", at: [-13.6, 7.6, 2], kind: "note", phase: "out" },
      { text: "空気が出る", at: [4.2, 28, 1.6], kind: "note", phase: "out" },
    ],
    arrows: { inhale, exhale },
    parts: { heart, abdomen, ribs },
    lungMaterial,
  };
  model.update(0, 0);
  return model;
}
