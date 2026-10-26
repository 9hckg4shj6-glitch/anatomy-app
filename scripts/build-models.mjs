// BodyParts3D 4.0 の OBJ（data-raw/bp3d/obj）から、収録語が使う部品だけを系統別の GLB にまとめる。
// BodyParts3D に無い構造（広背筋・末梢神経など）は Z-Anatomy から骨に合わせて取り込む（scripts/za/、部品の指定は "za:…"）。
// 出力: public/models/<系統>.<ハッシュ>.glb, <系統>-za.<ハッシュ>.glb（Z-Anatomy 由来の形だけ。CC BY-SA 4.0 なので別のファイルにする）,
//       body.<ハッシュ>.glb（皮膚＝半透明の輪郭用）, index.json
// ファイル名に中身のハッシュを付けるので、PWA が GLB を CacheFirst で持っても古い形が残らない。
// 使い方: npm run fetch:sources && npm run build:models
//
// 座標: BodyParts3D は mm・Z軸が上。three.js に合わせて m・Y軸が上へ (x, z, -y) × 0.001 で変換する
// （ashemag/human-atlas の scripts/convert-anatomy.py と同じ向き）。全系統で同じ変換なので重ねて表示できる。
// 出典表記: "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International"
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, reorder, simplify, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { loadZa } from "./za/index.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW = path.join(ROOT, "data-raw/bp3d");
const OUT = path.join(ROOT, "public/models");
const BODY_ELEMENT = "FJ2810"; // Skin

// 部品名は "Left humerus" "Acromial part of right deltoid" のように左右が入るので、外して比べる。
export function baseName(name) {
  return name.toLowerCase().replace(/\b(right|left)\b/g, " ").replace(/\s+/g, " ").trim();
}

function readTable(file) {
  const [, ...rows] = fs.readFileSync(path.join(RAW, file), "utf8").trim().split("\n");
  return rows.map((row) => row.split("\t"));
}

export function parseObj(file) {
  const v = [], vn = [], positions = [], normals = [], indices = [];
  const seen = new Map();
  let name = "", bounds = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("# English name : ")) name = line.slice(17).trim();
    else if (line.startsWith("v ")) v.push(line.slice(2).trim().split(/\s+/).map(Number));
    else if (line.startsWith("vn ")) vn.push(line.slice(3).trim().split(/\s+/).map(Number));
    else if (line.startsWith("f ")) {
      const face = line.slice(2).trim().split(/\s+/).map((key) => {
        let index = seen.get(key);
        if (index === undefined) {
          const [vi, , ni] = key.split("/").map((s) => Number(s) - 1);
          const [x, y, z] = v[vi];
          positions.push(x * 0.001, z * 0.001, -y * 0.001);
          const [nx, ny, nz] = vn[ni] ?? [0, 0, 1];
          normals.push(nx, nz, -ny);
          index = seen.size;
          seen.set(key, index);
        }
        return index;
      });
      for (let i = 1; i < face.length - 1; i++) indices.push(face[0], face[i], face[i + 1]);
    }
  }
  for (let i = 0; i < positions.length; i += 3) {
    const p = positions.slice(i, i + 3);
    bounds ??= [[...p], [...p]];
    for (let k = 0; k < 3; k++) {
      bounds[0][k] = Math.min(bounds[0][k], p[k]);
      bounds[1][k] = Math.max(bounds[1][k], p[k]);
    }
  }
  return { name, positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices), bounds };
}

function globToRegExp(pattern) {
  return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
}

export function loadTerms() {
  const systems = JSON.parse(fs.readFileSync(path.join(ROOT, "content/systems.json"), "utf8"));
  const terms = [];
  for (const system of systems) {
    const file = path.join(ROOT, `content/terms/${system.id}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const unit of data.units) for (const term of unit.terms) terms.push({ ...term, system: system.id, unit: unit.id });
  }
  // 骨の部位（of がある語）は、parts を書かなければ親の骨の部品を使う（3Dでは骨の上のピンで示す）
  const byId = new Map(terms.map((term) => [term.id, term]));
  for (const term of terms) if (term.of && !term.parts) term.parts = byId.get(term.of)?.parts ?? [];
  return { systems, terms };
}

// 部品の指定: "FMA…" は概念ID（is-a / part-of の両方の表で部品に展開）、それ以外は部品名（* 可）。
// 名前は左右を外して比べる（"humerus" で左右両方）。ただし指定に right / left が入っていれば左右込みで比べる
// （"cavity of right atrium" と "cavity of left atrium" を区別するため）。
// "!FJ…" はその部品を除く（元データで位置がずれている部品など）。
// "za:…" は Z-Anatomy の形の名前（zaNames。左右の扱いは同じ）。
export function resolveParts(terms, elementNames, conceptElements, zaNames = new Map()) {
  const resolved = new Map();
  const errors = [];
  for (const term of terms) {
    const ids = new Set();
    for (const spec of term.parts) {
      if (spec.startsWith("!")) {
        if (!ids.delete(spec.slice(1))) errors.push(`${term.id}: 除く部品「${spec}」が含まれていません`);
        continue;
      }
      const before = ids.size;
      if (/^FMA\d+$/.test(spec)) {
        for (const id of conceptElements.get(spec) ?? []) if (elementNames.has(id)) ids.add(id);
      } else {
        const za = spec.startsWith("za:");
        const re = globToRegExp(spec.replace(/^za:/, "").toLowerCase());
        const sided = /\b(right|left)\b/i.test(spec);
        for (const [id, name] of za ? zaNames : elementNames) if (re.test(sided ? name.toLowerCase() : baseName(name))) ids.add(id);
      }
      if (ids.size === before) errors.push(`${term.id}: 部品「${spec}」に当たるメッシュがありません`);
    }
    resolved.set(term.id, [...ids].sort());
  }
  return { resolved, errors };
}

async function writeGlb(stem, elements, { ratio, error }) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const material = doc.createMaterial("default");
  for (const [id, mesh] of elements) {
    const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const primitive = doc.createPrimitive()
      .setAttribute("POSITION", accessor("VEC3", mesh.positions))
      .setAttribute("NORMAL", accessor("VEC3", mesh.normals))
      .setIndices(accessor("SCALAR", mesh.indices))
      .setMaterial(material);
    scene.addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(primitive)));
  }
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error }),
    dedup(),
    prune(),
    quantize(),
    reorder({ encoder: MeshoptEncoder }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const bytes = await io.writeBinary(doc);
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 10);
  const name = `${stem}.${hash}.glb`;
  fs.writeFileSync(path.join(OUT, name), bytes);
  return { url: `models/${name}`, bytes: bytes.byteLength };
}

// BodyParts3D には is-a と part-of の両方の木に同じ形が別IDで入っていることがある（脳の各部など）。
// 名前と外接箱が同じ部品は1つにまとめ、同じ形を二重に描かない。
export function readElements() {
  const objDir = path.join(RAW, "obj");
  if (!fs.existsSync(objDir)) throw new Error("data-raw/bp3d/obj がありません。先に npm run fetch:sources を実行してください");
  const elementNames = new Map();
  const seenShapes = new Set();
  for (const file of fs.readdirSync(objDir).sort()) {
    const head = fs.readFileSync(path.join(objDir, file), "utf8").slice(0, 2000);
    const name = head.match(/# English name : (.*)/)?.[1].trim() ?? "";
    const shape = `${name.toLowerCase()}|${head.match(/# Bounds\(mm\): (.*)/)?.[1].trim()}`;
    if (seenShapes.has(shape)) continue;
    seenShapes.add(shape);
    elementNames.set(path.basename(file, ".obj"), name);
  }
  const conceptElements = new Map();
  for (const table of ["isa_element_parts.txt", "partof_element_parts.txt"]) {
    for (const [concept, , element] of readTable(table)) {
      if (!conceptElements.has(concept)) conceptElements.set(concept, new Set());
      conceptElements.get(concept).add(element);
    }
  }
  return { objDir, elementNames, conceptElements };
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const { objDir, elementNames, conceptElements } = readElements();

  const { systems, terms } = loadTerms();
  const meshes = new Map();
  const bpMesh = (id) => {
    if (!meshes.has(id)) meshes.set(id, parseObj(path.join(objDir, `${id}.obj`)));
    return meshes.get(id);
  };
  const za = terms.some((term) => term.parts.some((spec) => spec.startsWith("za:"))) ? await loadZa(elementNames, bpMesh) : null;
  const mesh = (id) => (za?.names.has(id) ? za.mesh(id) : bpMesh(id));
  const { resolved, errors } = resolveParts(terms, elementNames, conceptElements, za?.names);
  if (errors.length) throw new Error(errors.join("\n"));
  if (za) for (const [id, name] of za.names) elementNames.set(id, name);

  // 古い GLB を消す（筋の付着面 attachments-za.json は scripts/za/attachments.mjs が作るので残す）
  fs.mkdirSync(OUT, { recursive: true });
  for (const file of fs.readdirSync(OUT)) if (file.endsWith(".glb")) fs.rmSync(path.join(OUT, file));

  // 部品は最初に使った語の系統の GLB に入れる（同じ部品を2つのファイルに重複させない）。
  const elementSystem = new Map();
  for (const term of terms) for (const id of resolved.get(term.id)) if (!elementSystem.has(id)) elementSystem.set(id, term.system);

  const index = { version: 1, source: za ? "BodyParts3D 4.0, Z-Anatomy" : "BodyParts3D 4.0", systems: {}, terms: {}, neighbors: {}, bounds: null };
  for (const system of systems) {
    const ids = [...elementSystem].filter(([, s]) => s === system.id).map(([id]) => id).sort();
    const bp = ids.filter((id) => !za?.names.has(id));
    const fromZa = ids.filter((id) => za?.names.has(id));
    if (!bp.length) continue;
    const { url, bytes } = await writeGlb(system.id, bp.map((id) => [id, mesh(id)]), { ratio: 0.3, error: 0.004 });
    index.systems[system.id] = { url, bytes, elements: bp.length };
    console.log(`${url}: ${bp.length} 部品, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
    if (fromZa.length) {
      const extra = await writeGlb(`${system.id}-za`, fromZa.map((id) => [id, mesh(id)]), { ratio: 0.3, error: 0.004 });
      index.systems[system.id].za = { ...extra, elements: fromZa.length };
      console.log(`${extra.url}: ${fromZa.length} 部品（Z-Anatomy）, ${(extra.bytes / 1024 / 1024).toFixed(2)} MB`);
    }
  }
  const body = mesh(BODY_ELEMENT);
  const bodyGlb = await writeGlb("body", [[BODY_ELEMENT, body]], { ratio: 0.15, error: 0.01 });
  index.systems.body = { ...bodyGlb, elements: 1 };
  index.bounds = body.bounds;
  console.log(`${bodyGlb.url}: ${(bodyGlb.bytes / 1024 / 1024).toFixed(2)} MB`);

  const sphere = (ids) => {
    let lo = null, hi = null;
    for (const id of ids) {
      const [a, b] = mesh(id).bounds;
      lo = lo ? lo.map((v, k) => Math.min(v, a[k])) : [...a];
      hi = hi ? hi.map((v, k) => Math.max(v, b[k])) : [...b];
    }
    return {
      center: lo.map((v, k) => +((v + hi[k]) / 2).toFixed(4)),
      radius: +(Math.hypot(...hi.map((v, k) => v - lo[k])) / 2).toFixed(4),
    };
  };
  for (const term of terms) {
    const ids = resolved.get(term.id);
    // 左右がある語は、カメラを寄せる先・ラベルの位置・近さの計算に右側（本人の右）の部品を使う。
    // 左右まとめた中心だと体の正中に来てしまい、どちらの腕でもない所を指す。
    const right = ids.filter((id) => /\bright\b/i.test(elementNames.get(id)));
    const focus = sphere(right.length && right.length < ids.length ? right : ids);
    index.terms[term.id] = { system: term.system, elements: ids, ...focus };
  }
  // 4択の選択肢に使う「3Dで近くにある同じ系統の語」。近い順に8つ。
  // 骨の部位は骨と同じ部品なので含めない（部位どうしの近さはアプリがピンの位置から求める）。
  const whole = terms.filter((term) => !term.of);
  for (const term of whole) {
    const c = index.terms[term.id].center;
    index.neighbors[term.id] = whole
      .filter((other) => other.id !== term.id && other.system === term.system)
      .map((other) => [other.id, Math.hypot(...index.terms[other.id].center.map((v, k) => v - c[k]))])
      .sort((a, b) => a[1] - b[1])
      .slice(0, 8)
      .map(([id]) => id);
  }
  fs.writeFileSync(path.join(OUT, "index.json"), `${JSON.stringify(index)}\n`);
  const total = Object.values(index.systems).reduce((sum, s) => sum + s.bytes + (s.za?.bytes ?? 0), 0);
  console.log(`語 ${terms.length} / 合計 ${(total / 1024 / 1024).toFixed(2)} MB`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
