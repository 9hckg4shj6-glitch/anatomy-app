// 合わせ込みの確かめ: BodyParts3D の骨と重ねた画像（data-raw/nasalseg/check-*.png）と、重なりの数。
// - 下鼻甲介の骨の点のうち、CT の下鼻甲介（粘膜）の中にあるものの割合（大きいほどよい）
// - 鼻腔の空気の面の点のうち、BodyParts3D の骨の中に入ったものの割合（小さいほどよい）
// 使い方: node scripts/nasal/check.mjs
import path from "node:path";
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { acceleratedRaycast, computeBoundsTree } from "three-mesh-bvh";
import { readElements } from "../build-models.mjs";
import { makeFrame, render } from "../pins/geometry.mjs";
import { NASAL_DIR } from "./index.mjs";

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;
const { elementNames, readMesh } = readElements();
const ns = [...elementNames].filter(([id]) => id.startsWith("NS_")).map(([id, name]) => ({ id, name, ...readMesh(id) }));
const bone = (re) => [...elementNames].filter(([id, n]) => re.test(n) && !id.includes("-")).map(([id, name]) => ({ id, name, ...readMesh(id) }));
const meshOf = (m) => {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(m.positions, 3));
  g.setIndex(new BufferAttribute(m.indices, 1));
  g.computeBoundsTree();
  return new Mesh(g, new MeshBasicMaterial({ side: DoubleSide }));
};
// 点が閉じた形の中か（+x へ光線を飛ばし、当たった数が奇数なら中）
const ray = new Raycaster();
const inside = (meshes, x, y, z) => {
  ray.set(new Vector3(x, y, z), new Vector3(1, 0.013, 0.007).normalize());
  return meshes.some((m) => ray.intersectObject(m, false).length % 2 === 1);
};
for (const side of ["Right", "Left"]) {
  const b = bone(new RegExp(`^${side} inferior nasal concha$`))[0];
  const m = meshOf(ns.find((x) => x.name === `${side} inferior nasal concha (mucosa)`));
  let n = 0, k = 0;
  for (let i = 0; i < b.positions.length; i += 3) { n++; if (inside([m], b.positions[i], b.positions[i + 1], b.positions[i + 2])) k++; }
  console.log(`${side} 下鼻甲介の骨が粘膜の中: ${((k / n) * 100).toFixed(0)}%`);
}
const bones = bone(/^(right |left )?(maxilla|palatine bone|vomer|ethmoid|inferior nasal concha|sphenoid|nasal bone)$/i);
const solid = bones.map(meshOf);
for (const part of ns.filter((x) => /cavity|meatus|sinus/i.test(x.name))) {
  let n = 0, k = 0;
  for (let i = 0; i < part.positions.length; i += 30) { n++; if (inside(solid, part.positions[i], part.positions[i + 1], part.positions[i + 2])) k++; }
  console.log(`${part.name.padEnd(36)} 骨の中: ${((k / n) * 100).toFixed(0)}%`);
}
const COLORS = [[/maxillary/, "#e6c25c"], [/inferior nasal concha/, "#c98a8a"], [/middle nasal concha/, "#d6a3a3"], [/inferior nasal meatus/, "#e05050"], [/middle nasal meatus/, "#50b050"], [/cavity/, "#8fb0e6"]];
const soft = ns.map((m) => ({ ...m, color: COLORS.find(([re]) => re.test(m.name.toLowerCase()))[1] }));
const ghost = bones.filter((b) => !/sphenoid/i.test(b.name)).map((b) => ({ ...b, color: "#dddddd" }));
const views = { front: { f: [0, 0, -1], u: [0, 1, 0] }, right: { f: [1, 0, 0], u: [0, 1, 0] }, below: { f: [0, 1, 0], u: [0, 0, 1] } };
for (const [name, view] of Object.entries(views)) {
  const frame = makeFrame(soft, view, 700, 0.25);
  console.log(await render({ meshes: soft, ghost, frame, out: path.join(NASAL_DIR, `check-${name}.png`), grid: false }));
}
// 右の外側の壁: 鼻中隔の側から（左から右へ）見る。左の鼻腔と鼻中隔の骨は描かない
const wall = soft.filter((m) => /^Right/.test(m.name) && !/maxillary/.test(m.name));
const wallBones = bones.filter((b) => /^Right (inferior nasal concha|maxilla|palatine)|^Ethmoid/.test(b.name)).map((b) => ({ ...b, color: "#eeeeee" }));
const frame = makeFrame(wall, { f: [-1, 0, 0], u: [0, 1, 0] }, 700, 0.15);
console.log(await render({ meshes: [...wall.filter((m) => /concha/.test(m.name)), ...wallBones], ghost: wall.filter((m) => !/concha/.test(m.name)), frame, out: path.join(NASAL_DIR, "check-wall.png"), grid: false }));
