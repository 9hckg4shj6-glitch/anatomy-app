// Z-Anatomy（CC BY-SA 4.0）の FBX を読む。data-raw/z-anatomy/*.fbx は scripts/fetch-sources.sh で取る。
// 座標: Z-Anatomy は cm・Y上・前が +z・本人の左が +x。モデル座標（m・Y上）へは ×0.01 だけでよい。
// ただし骨の形と位置が BodyParts3D と少しずつ違うので、そのままでは重ならない（scripts/za/warp.mjs で合わせる）。
//
// 名前: 左右のある形は末尾に l / r が付く（"Latissimus_dorsi_muscler"）。同じ名前の l と r がそろうときだけ左右とみなす
// （"Liver" の r は左右ではない）。末尾 g はまとまり、36点ほどの小さな形は名札の印なので使わない。
// 骨の子になっている形は筋の付着面で、筋の名前の後に o（起始）/ e（停止）と番号が付く（"Tibialis_anterior_muscleor"）。
import fs from "node:fs";
import path from "node:path";
import { BufferAttribute, BufferGeometry } from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const ZA_DIR = path.join(ROOT, "data-raw/z-anatomy");
export const ZA_FILES = ["SkeletalSystem100", "MuscularSystem100", "NervousSystem100", "VisceralSystem100"];

let FBXLoader = null;
async function loader() {
  if (!FBXLoader) {
    globalThis.self ??= globalThis; // FBXLoader がブラウザの self を見るため
    ({ FBXLoader } = await import("three/addons/loaders/FBXLoader.js"));
  }
  return new FBXLoader();
}

/** 名前を「左右を外した名前」と左右に分ける。sided は l と r の両方がある名前の集合 */
function splitSide(raw, sided) {
  const stem = raw.slice(0, -1);
  if (/[lr]$/.test(raw) && sided.has(stem)) return { stem, side: raw.endsWith("l") ? "left" : "right" };
  return { stem: raw, side: null };
}

/** 比べやすい名前: 小文字・空白区切り・左右は前に（BodyParts3D の "right humerus" に合わせる） */
export function zaDisplayName(stem, side) {
  const base = stem.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return side ? `${side} ${base}` : base;
}

/**
 * FBX の形を読む。返り値: [{ id, raw（元の名前）, name, stem, side, parent, file, positions, indices }]
 * id は "ZA_" ＋ 元の名前（記号は _。ids にすでにあれば _ を足す）。positions はモデル座標（m）、ただし骨の合わせ込みの前。
 */
export async function readZaFile(file, ids = new Set()) {
  const fbx = path.join(ZA_DIR, `${file}.fbx`);
  if (!fs.existsSync(fbx)) throw new Error(`${fbx} がありません。先に npm run fetch:sources を実行してください`);
  const bytes = fs.readFileSync(fbx);
  const root = (await loader()).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  root.updateMatrixWorld(true);
  const raw = [];
  root.traverse((object) => {
    if (object.isMesh && object.geometry.getAttribute("position").count > 60) raw.push(object);
  });
  const names = new Set(raw.map((o) => o.name));
  const sided = new Set();
  for (const name of names) if (name.endsWith("l") && names.has(`${name.slice(0, -1)}r`)) sided.add(name.slice(0, -1));
  const out = [];
  for (const object of raw) {
    let geometry = new BufferGeometry();
    geometry.setAttribute("position", object.geometry.getAttribute("position").clone());
    if (object.geometry.index) geometry.setIndex(object.geometry.index.clone());
    geometry.applyMatrix4(object.matrixWorld);
    geometry.scale(0.01, 0.01, 0.01);
    geometry = mergeVertices(geometry, 1e-6);
    const { stem, side } = splitSide(object.name, sided);
    const parent = object.parent?.isMesh ? splitSide(object.parent.name, sided) : null;
    let id = `ZA_${object.name.replace(/[^A-Za-z0-9]+/g, "_")}`;
    while (ids.has(id)) id += "_";
    ids.add(id);
    out.push({
      id,
      raw: object.name,
      name: zaDisplayName(stem, side),
      stem,
      side,
      parent: parent ? zaDisplayName(parent.stem, parent.side) : null,
      file,
      positions: new Float32Array(geometry.getAttribute("position").array),
      indices: new Uint32Array(geometry.index.array),
    });
  }
  return out;
}

/** 頂点の法線（面の向きの平均） */
export function vertexNormals(positions, indices) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return new Float32Array(geometry.getAttribute("normal").array);
}
