import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import ownAttachmentsJson from "../content/attachments.json";
import jointsJson from "../content/joints.json";
import pinsJson from "../content/pins.json";
import muscularJson from "../content/terms/muscular.json";
import skeletalJson from "../content/terms/skeletal.json";
import zaAttachmentsJson from "../public/models/attachments-za.json";
import indexJson from "../public/models/index.json";

type Vec3 = [number, number, number];
type Joint = { pivot: Vec3; axis: Vec3; slide?: boolean; moves: string[]; only?: string[] };
type Motion = { from?: Record<string, number>; to: Record<string, number>; via?: string[] };
type Muscle = { id: string; originAt?: string[]; insertionAt?: string[]; motion?: Motion };
type Spot = [string, number, number, number, ...number[]];

const joints = jointsJson as unknown as Record<string, Joint>;
const pins = pinsJson as unknown as Record<string, { at: Vec3[] }>;
const attachments = [zaAttachmentsJson, ownAttachmentsJson] as unknown as Record<string, { origin?: Spot[]; insertion?: Spot[] }>[];
const muscles = (muscularJson as unknown as { units: { terms: Muscle[] }[] }).units.flatMap((unit) => unit.terms).filter((term) => term.motion);
const elementsOf = (id: string) => (indexJson as unknown as { terms: Record<string, { elements: string[] }> }).terms[id]?.elements ?? [];
const boneOf = new Map((skeletalJson as unknown as { units: { terms: { id: string; of?: string }[] }[] }).units.flatMap((unit) => unit.terms).flatMap((term) => (term.of ? [[term.id, term.of] as const] : [])));

/** 骨格の GLB の部品ごとの外接箱（アプリと同じく、点にいちばん近い部品でその点を動かす関節を決める） */
const boxes = new Map<string, THREE.Box3>();
beforeAll(async () => {
  const file = path.join(import.meta.dirname, "../public", (indexJson as unknown as { systems: Record<string, { url: string }> }).systems.skeletal.url);
  // jsdom の中なので、Node の Buffer の中身をこの環境の ArrayBuffer に写す（GLTFLoader が instanceof で見るため）
  const bytes = fs.readFileSync(file);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, "");
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.computeBoundingBox();
    boxes.set(object.name, object.geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld));
  });
});

/**
 * 骨の上の点を動かす関節（根元から先の順）。アプリ（src/viewer.ts の anchor）と同じく、骨の部品のうち点にいちばん近いものを
 * 動かす関節（足の指の骨は母趾か第2〜5趾か、手の指の骨は母指かほかの指か）。距腿関節は「足根骨」の部品として踵骨も動かす。
 */
function jointsFor(bone: string, point: THREE.Vector3): string[] {
  const nearest = elementsOf(bone).filter((element) => boxes.has(element))
    .sort((a, b) => boxes.get(a)!.distanceToPoint(point) - boxes.get(b)!.distanceToPoint(point))[0];
  return Object.keys(joints).filter((id) =>
    joints[id].moves.some((term) => elementsOf(term).includes(nearest)) && (!joints[id].only || joints[id].only!.includes(nearest)));
}

/** アプリ（src/viewer.ts の poseMatrix）と同じく、先の関節から順に回してから根元の関節で回す（slide は mm だけ動かす） */
function pose(point: THREE.Vector3, ids: string[], angles: Record<string, number>): THREE.Vector3 {
  const p = point.clone();
  for (const id of [...ids].reverse()) {
    const angle = angles[id] ?? 0;
    if (!angle) continue;
    const { pivot, axis, slide } = joints[id];
    if (slide) p.add(new THREE.Vector3(...axis).normalize().multiplyScalar(angle / 1000));
    else p.sub(new THREE.Vector3(...pivot)).applyAxisAngle(new THREE.Vector3(...axis).normalize(), THREE.MathUtils.degToRad(angle)).add(new THREE.Vector3(...pivot));
  }
  return p;
}

/** 起始・停止の点を骨ごとにまとめる（付着面と、起始・停止の骨の部位のピン） */
function anchors(muscle: Muscle, kind: "origin" | "insertion"): { point: THREE.Vector3; joints: string[] }[] {
  const byBone = new Map<string, THREE.Vector3[]>();
  const add = (bone: string, point: THREE.Vector3) => byBone.set(bone, [...(byBone.get(bone) ?? []), point]);
  for (const file of attachments) for (const [bone, x, y, z] of file[muscle.id]?.[kind] ?? []) add(bone, new THREE.Vector3(x, y, z));
  for (const id of (kind === "origin" ? muscle.originAt : muscle.insertionAt) ?? []) {
    const at = pins[id]?.at ?? [];
    if (at.length) add(boneOf.get(id)!, at.reduce((sum, p) => sum.add(new THREE.Vector3(...p)), new THREE.Vector3()).divideScalar(at.length));
  }
  return [...byBone].map(([bone, points]) => {
    const point = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
    return { point, joints: jointsFor(bone, point) };
  });
}

describe("筋の作用の動き（content/terms/muscular.json の motion）", () => {
  it("動かすと起始と停止を結ぶ帯が縮む（作用の向きが逆になっていない）", () => {
    expect(muscles.length).toBeGreaterThan(40);
    const lengthened: string[] = [];
    for (const muscle of muscles) {
      const from = muscle.motion!.from ?? {};
      const to = muscle.motion!.to;
      // アプリと同じく、いちばん長さの変わる帯で見る
      // 帯は via の骨の部位（くるぶしなど）を通る
      const via = (muscle.motion!.via ?? []).map((id) => {
        const at = pins[id].at;
        const point = at.reduce((sum, p) => sum.add(new THREE.Vector3(...p)), new THREE.Vector3()).divideScalar(at.length);
        return { point, joints: jointsFor(boneOf.get(id)!, point) };
      });
      const length = (path: { point: THREE.Vector3; joints: string[] }[], angles: Record<string, number>) =>
        path.slice(1).reduce((sum, p, i) => sum + pose(p.point, p.joints, angles).distanceTo(pose(path[i].point, path[i].joints, angles)), 0);
      let best: { from: number; to: number } | null = null;
      for (const a of anchors(muscle, "origin")) {
        for (const b of anchors(muscle, "insertion")) {
          const path = [a, ...via, b];
          const pair = { from: length(path, from), to: length(path, to) };
          if (!best || Math.abs(pair.to - pair.from) / pair.from > Math.abs(best.to - best.from) / best.from) best = pair;
        }
      }
      if (!best) continue; // 起始・停止の点が無い筋は帯を描かない
      if (best.to > best.from * 0.99) lengthened.push(`${muscle.id}: ${(best.from * 100).toFixed(1)} → ${(best.to * 100).toFixed(1)} cm`);
    }
    expect(lengthened).toEqual([]);
  });
});
