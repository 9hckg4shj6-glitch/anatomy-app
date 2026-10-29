// BodyParts3D 4.0 の OBJ（data-raw/bp3d/obj）から、収録語が使う部品だけを系統別の GLB にまとめる。
// BodyParts3D に無い構造（広背筋・末梢神経など）は Z-Anatomy から骨に合わせて取り込む（scripts/za/、部品の指定は "za:…"）。
// 表示する形は、使えるときは BodyParts3D 3.0 の細かい形を 4.0 に重ねたもの（scripts/hires.mjs）にし、
// くぼみの暗さと筋線維・神経の向きを頂点ごとに入れる（scripts/surface.mjs、docs/設計.md の「3Dの見た目」）。
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
import { dedup, meshopt, prune, quantize, reorder } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { attachedBones } from "./attach-bones.mjs";
import { splitMesh } from "./split-mesh.mjs";
import { loadHires } from "./hires.mjs";
import { bakeAo, dropStrays, muscleFibers, nerveFibers, radialFibers, relax, simplify, subdivide } from "./surface.mjs";
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
  // 本体から離れた数枚の三角形（右の角膜の中にある左眼の位置のかけらなど）は除く（surface.mjs の dropStrays）
  return dropStrays({ name, positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices), bounds });
}

function globToRegExp(pattern) {
  return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
}

// 基本の用語（方向・面・運動。figure がある語）と局所解剖の語（region。ほかの語を組み合わせて示す）は3Dの部品を持たないので、
// ふだんは除く（英語の音声を作るときだけ figures: true）
export function loadTerms({ figures = false } = {}) {
  const systems = JSON.parse(fs.readFileSync(path.join(ROOT, "content/systems.json"), "utf8"));
  const terms = [];
  for (const system of systems) {
    const file = path.join(ROOT, `content/terms/${system.id}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const unit of data.units) for (const term of unit.terms) if (figures || !(term.figure || term.region)) terms.push({ ...term, system: system.id, unit: unit.id });
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

// くぼみの暗さ（AO）を求めるとき、光線がさえぎられたと見る距離（m）。系統の形の大きさに合わせる
const AO_DISTANCE = { skeletal: 0.025, joints: 0.015, muscular: 0.02, cardiovascular: 0.025, lymphatic: 0.015, respiratory: 0.04, digestive: 0.04, urogenital: 0.03, endocrine: 0.02, nervous: 0.02, sensory: 0.012 };

/**
 * 形を減らし（ratio・error は surface.mjs の simplify）、くぼみの暗さ（_AO）と線維の向き（_FIBER）を付けて GLB に書く。
 * fiberOf(部品ID, 減らした形) は線維の向き（無ければ null）。occluders は AO で光線をさえぎる形に加える、ほかの GLB の形。
 * extrasOf(部品ID) は部品に付ける印（アプリでは mesh.userData。軟骨は { cartilage: true }）。返り値の meshes は減らした形（部品ID → 形）。
 */
async function writeGlb(stem, elements, { ratio, error, ao = null, fiberOf = () => null, occluders = [], extrasOf = () => null }) {
  const meshes = new Map(elements.map(([id, mesh]) => [id, simplify(mesh, { ratio, error })]));
  const shading = ao ? bakeAo([...meshes.values()], [...meshes.values(), ...occluders], { distance: ao }) : null;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const material = doc.createMaterial("default");
  for (const [i, [id, mesh]] of [...meshes].entries()) {
    const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const primitive = doc.createPrimitive()
      .setAttribute("POSITION", accessor("VEC3", mesh.positions))
      .setAttribute("NORMAL", accessor("VEC3", mesh.normals))
      .setIndices(accessor("SCALAR", mesh.indices))
      .setMaterial(material);
    if (shading) {
      primitive.setAttribute("_AO", accessor("SCALAR", shading[i]));
      primitive.setAttribute("_FIBER", accessor("VEC3", fiberOf(id, mesh) ?? new Float32Array(mesh.positions.length)));
    }
    const node = doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(primitive));
    if (extrasOf(id)) node.setExtras(extrasOf(id));
    scene.addChild(node);
  }
  await doc.transform(
    dedup(),
    prune(),
    quantize({ quantizeGeneric: 8 }),
    reorder({ encoder: MeshoptEncoder }),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
  );
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const bytes = await io.writeBinary(doc);
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 10);
  const name = `${stem}.${hash}.glb`;
  fs.writeFileSync(path.join(OUT, name), bytes);
  return { url: `models/${name}`, bytes: bytes.byteLength, meshes };
}

// 形を減らすときに許すずれ（m。surface.mjs の simplify）。骨・脳は細かく、筋は形が大きくなめらかなので少し粗く
const DETAIL = { skeletal: 0.00012, nervous: 0.00012, muscular: 0.0004 };

// 表示の前に細分してなめらかにする部品（左右を外した名前 → 回数。surface.mjs の subdivide）。
// BodyParts3D 4.0 の舌（524面）・唇・唾液腺、Z-Anatomy の瞼板は粗く、角張って見える（3.0 の細かい形も無い）
const SMOOTH = { tongue: 2, lip: 2, "submandibular gland": 2, "sublingual gland": 2, "superior tarsus": 2, "inferior tarsus": 2 };

// 筋系の中の滑液包の色（content/terms/muscular.json）。袋なので線維を描かない
const BURSA = "#9fc2da";
// 関節・靱帯の系統で、線維の向きを入れない語（関節包・関節円板・半月・関節唇・髄核・恥骨結合）
const NOT_LIGAMENT = /joint$|disc|menisc|labrum|nucleus|symphysis/;
// 軟骨の印を付ける部品（骨格の肋軟骨・椎間円板、関節・靱帯の系統の線維軟骨）
const CARTILAGE = /cartilage|intervertebral dis[ck]|menisc|articular disc|interpubic disc|labrum|nucleus pulposus|pubic symphysis/i;

/**
 * 筋線維・神経の走る向き（surface.mjs）を部品ごとに返す関数を作る。
 * 筋は起始・停止の点（付着面 attachments-za.json・content/attachments.json と、無ければ骨の部位のピン）から、神経は形の並びから求める。
 * 靱帯・筋膜は起始・停止の無い筋と同じく形の主軸の向き。
 */
function fibers(terms, resolved) {
  const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
  const fromZa = read(path.join(OUT, "attachments-za.json"));
  const own = read(path.join(ROOT, "content/attachments.json"));
  const pins = read(path.join(ROOT, "content/pins.json"));
  const points = (term, kind) => {
    const list = [...(fromZa[term.id]?.[kind] ?? []), ...(own[term.id]?.[kind] ?? [])].map(([, x, y, z]) => [x, y, z]);
    if (!list.length && pins[term[`${kind}At`]]) list.push(...pins[term[`${kind}At`]].at);
    return list;
  };
  const muscles = new Map();
  const nerves = new Set();
  // 虹彩は瞳孔から放射状に走るすじ（語の tissue が "iris"）
  const radial = new Set(terms.filter((term) => term.tissue === "iris").flatMap((term) => resolved.get(term.id)));
  // 部品を含む語のうち、いちばん細かい語の起始・停止を使う
  for (const term of [...terms].sort((a, b) => resolved.get(a.id).length - resolved.get(b.id).length)) {
    if (term.of) continue;
    const muscle = (term.system === "muscular" && term.color !== BURSA) || term.color === "#c75b4f" || term.origin || /rectus|oblique|levator-palpebrae/.test(term.id)
      || (term.system === "joints" && !NOT_LIGAMENT.test(term.id));
    const nerve = term.system === "nervous" && ((/^nerv-(spinal|lower|cranial|upper-branches|lower-branches|cranial-branches|cord-inner)$/.test(term.unit) && !/ganglion|horn|canal/.test(term.id))
      || /nerve|chiasm|tract/.test(term.id));
    for (const id of resolved.get(term.id)) {
      if (muscle && !muscles.has(id)) muscles.set(id, { origin: points(term, "origin"), insertion: points(term, "insertion") });
      if (nerve) nerves.add(id);
    }
  }
  return (id, mesh) => {
    if (radial.has(id)) return radialFibers(mesh);
    if (nerves.has(id)) return nerveFibers(mesh);
    const attach = muscles.get(id);
    if (!attach) return null;
    if (!attach.origin.length && !attach.insertion.length) return muscleFibers(mesh, null);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], sum = [0, 0, 0];
    for (let i = 0; i < mesh.positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], mesh.positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], mesh.positions[i]);
      sum[i % 3] += mesh.positions[i] / (mesh.positions.length / 3);
    }
    // 点は右側にある。左側の形には折り返し、正中をまたぐ形（口輪筋など）には両側の点を使う
    const side = (list) => {
      if (lo[0] < -0.02 && hi[0] > 0.02) return [...list, ...list.map(([x, y, z]) => [-x, y, z])];
      return sum[0] > 0.01 ? list.map(([x, y, z]) => [-x, y, z]) : list;
    };
    // 片方しか骨に付かない筋（横隔膜の停止＝腱中心など）は、もう片方を形の中心とする
    return muscleFibers(mesh, {
      origin: attach.origin.length ? side(attach.origin) : [sum],
      insertion: attach.insertion.length ? side(attach.insertion) : [sum],
    });
  };
}

// BodyParts3D で1つの形になっているものを平面で2つに分ける（仙骨は尾骨まで、下行結腸は S状結腸まで1つの形）。
// 平面の下側（normal・p < d）は別の部品 "<ID>-<slug>"（名前は name）になり、parts で name を指定して使う。
// 上側は元のIDのまま（"sacrum" は尾骨を除いた形になる）。切り口はふさぐ。
// sided: true は左右の部品を両方切る（平面は右側で書き、左側は x を折り返す。下側の名前に Right / Left を付ける）。
const CUTS = [
  // 仙尾連結: 横幅が最も細くなる高さ（その上が仙骨尖、下が第1尾椎の横突起）
  { part: "sacrum", slug: "coccyx", name: "Coccyx", normal: [0, 1, 0], d: 0.818 },
  // 左腸骨窩で下へ降りる管が内側へ曲がり始める高さ。曲がりから先を S状結腸とする
  { part: "descending colon", slug: "sigmoid", name: "Sigmoid colon", normal: [0, 1, 0], d: 0.886 },
  // BodyParts3D の総肝管は十二指腸まで続く（総胆管を含む）。胆嚢管が合流する高さから下を総胆管とする
  { part: "common hepatic duct", slug: "bile", name: "Bile duct", normal: [0, 1, 0], d: 1.081 },
  // 第IV区域の肝門（左右の肝管が合わさる所）より下＝方形葉。上は右葉の一部（肝鎌状間膜より右）
  { part: "hepatovenous segment iv", slug: "quadrate", name: "Quadrate lobe of liver", normal: [0, 1, 0], d: 1.103 },
  // BodyParts3D の大腿直筋は膝蓋骨を包んで脛骨粗面まで続く（膝蓋靱帯を含む）。膝蓋骨尖（y = 0.3615）のすぐ下から下を膝蓋靱帯とする
  { part: "rectus femoris", slug: "patlig", name: "Patellar ligament", normal: [0, 1, 0], d: 0.358, sided: true },
];

// BodyParts3D には is-a と part-of の両方の木に同じ形が別IDで入っていることがある（脳の各部など）。
// 名前と外接箱が同じ部品は1つにまとめ、同じ形を二重に描かない。
// 返り値の readMesh(部品ID) は形を読む（CUTS で分けた部品は分けた形）。readWhole(部品ID) は分ける前の形で、
// Z-Anatomy の骨・器官との合わせ込み（scripts/za/）に使う（Z-Anatomy の下行結腸は BodyParts3D で切った上側より長く、切ると合わない）。
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
  const cutOf = new Map(); // 部品ID → [切り方, "above" | "below"]
  for (const cut of CUTS) {
    const sources = [...elementNames].filter(([, name]) => baseName(name) === cut.part);
    if (sources.length !== (cut.sided ? 2 : 1)) throw new Error(`切る部品「${cut.part}」が ${sources.length} 個あります`);
    for (const [id, name] of sources) {
      const side = cut.sided ? (/\bleft\b/i.test(name) ? "Left" : "Right") : "";
      const plane = side === "Left" ? { ...cut, normal: [-cut.normal[0], cut.normal[1], cut.normal[2]] } : cut;
      cutOf.set(id, [plane, "above"]);
      cutOf.set(`${id}-${cut.slug}`, [plane, "below", id]);
      elementNames.set(`${id}-${cut.slug}`, side ? `${side} ${cut.name.toLowerCase()}` : cut.name);
    }
  }
  const cache = new Map();
  const readMesh = (id) => {
    if (!cache.has(id)) {
      const [cut, half, source] = cutOf.get(id) ?? [];
      if (!cut) cache.set(id, parseObj(path.join(objDir, `${id}.obj`)));
      else cache.set(id, { name: elementNames.get(id), ...splitMesh(parseObj(path.join(objDir, `${source ?? id}.obj`)), cut.normal, cut.d)[half] });
    }
    return cache.get(id);
  };
  const readWhole = (id) => (cutOf.get(id)?.[1] === "above" ? parseObj(path.join(objDir, `${id}.obj`)) : readMesh(id));
  // splitOf(部品ID) → [切り方, "above" | "below", 元の部品ID]（切って作った部品でなければ undefined）
  return { objDir, elementNames, conceptElements, readMesh, readWhole, splitOf: (id) => cutOf.get(id) };
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const { objDir, elementNames, conceptElements, readMesh: bpMesh, readWhole, splitOf } = readElements();

  const { systems, terms } = loadTerms();
  const za = terms.some((term) => term.parts.some((spec) => spec.startsWith("za:"))) ? await loadZa(elementNames, readWhole) : null;
  // 表示には、BodyParts3D 3.0 の細かい形を 4.0 に重ねたもの（scripts/hires.mjs）を使えるときは使う。
  // 位置・大きさ・近さ（index.json）とピンは今までどおり 4.0 の形で決める
  const hires = loadHires({ parseObj, objDir, readWhole });
  const fine = (id) => {
    const [cut, half, source] = splitOf(id) ?? [];
    if (!cut) return hires(id);
    const whole = hires(source ?? id);
    return whole && { name: elementNames.get(id), ...splitMesh(whole, cut.normal, cut.d)[half] };
  };
  const mesh = (id) => (za?.names.has(id) ? za.mesh(id) : bpMesh(id));
  // 3.0 の細かい形の無い筋（4.0 の粗い形のまま）は、三角形の角のでこぼこをならす。舌・唇などの粗い形は細分する（SMOOTH）
  const shown = (id) => {
    const levels = SMOOTH[baseName(elementNames.get(id) ?? "")];
    if (levels) return subdivide(mesh(id), levels);
    if (za?.names.has(id)) return za.mesh(id);
    return fine(id) ?? (elementSystem.get(id) === "muscular" ? relax(bpMesh(id)) : bpMesh(id));
  };
  const { resolved, errors } = resolveParts(terms, elementNames, conceptElements, za?.names);
  if (errors.length) throw new Error(errors.join("\n"));
  if (za) for (const [id, name] of za.names) elementNames.set(id, name);

  // 古い GLB を消す（筋の付着面 attachments-za.json は scripts/za/attachments.mjs が作るので残す）
  fs.mkdirSync(OUT, { recursive: true });
  for (const file of fs.readdirSync(OUT)) if (file.endsWith(".glb")) fs.rmSync(path.join(OUT, file));

  // 部品は最初に使った語の系統の GLB に入れる（同じ部品を2つのファイルに重複させない）。
  const elementSystem = new Map();
  for (const term of terms) for (const id of resolved.get(term.id)) if (!elementSystem.has(id)) elementSystem.set(id, term.system);

  const fiberOf = fibers(terms, resolved);
  const index = { version: 1, source: za ? "BodyParts3D 4.0, Z-Anatomy" : "BodyParts3D 4.0", systems: {}, terms: {}, neighbors: {}, bounds: null };
  for (const system of systems) {
    const ids = [...elementSystem].filter(([, s]) => s === system.id).map(([id]) => id).sort();
    const bp = ids.filter((id) => !za?.names.has(id));
    const fromZa = ids.filter((id) => za?.names.has(id));
    if (!ids.length) continue;
    // 骨格の中の軟骨（肋軟骨・椎間円板）と関節の線維軟骨（半月・関節円板など）は、アプリで骨と違う青みのある白にする
    const extrasOf = (id) => (["skeletal", "joints"].includes(system.id) && CARTILAGE.test(elementNames.get(id)) ? { cartilage: true } : null);
    const shape = { error: DETAIL[system.id] ?? 0.0001, ao: AO_DISTANCE[system.id], fiberOf, extrasOf };
    let meshes = new Map();
    if (bp.length) {
      const glb = await writeGlb(system.id, bp.map((id) => [id, shown(id)]), shape);
      meshes = glb.meshes;
      index.systems[system.id] = { url: glb.url, bytes: glb.bytes, elements: bp.length };
      console.log(`${glb.url}: ${bp.length} 部品, ${(glb.bytes / 1024 / 1024).toFixed(2)} MB`);
    }
    if (fromZa.length && !bp.length) {
      // Z-Anatomy の形だけの系統（リンパ系）は、その GLB を系統の GLB にする（名前は -za のまま）
      const only = await writeGlb(`${system.id}-za`, fromZa.map((id) => [id, shown(id)]), shape);
      index.systems[system.id] = { url: only.url, bytes: only.bytes, elements: fromZa.length };
      console.log(`${only.url}: ${fromZa.length} 部品（Z-Anatomy）, ${(only.bytes / 1024 / 1024).toFixed(2)} MB`);
    } else if (fromZa.length) {
      // Z-Anatomy の形の AO は、同じ系統の BodyParts3D の形にもさえぎらせる（BodyParts3D の GLB には Z-Anatomy 由来のものを入れない）
      const extra = await writeGlb(`${system.id}-za`, fromZa.map((id) => [id, shown(id)]), { ...shape, occluders: [...meshes.values()] });
      index.systems[system.id].za = { url: extra.url, bytes: extra.bytes, elements: fromZa.length };
      console.log(`${extra.url}: ${fromZa.length} 部品（Z-Anatomy）, ${(extra.bytes / 1024 / 1024).toFixed(2)} MB`);
    }
  }
  const body = mesh(BODY_ELEMENT);
  const bodyGlb = await writeGlb("body", [[BODY_ELEMENT, body]], { ratio: 0.15, error: 0.01 });
  index.systems.body = { url: bodyGlb.url, bytes: bodyGlb.bytes, elements: 1 };
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
  // 部品の重なる語（肋骨と第6肋骨のように、答えを含む語・含まれる語）は選択肢に出さないので、ここでも除く
  // （除かないと、まとめた語の近くが1本ずつの語で埋まる）。
  const whole = terms.filter((term) => !term.of);
  for (const term of whole) {
    const c = index.terms[term.id].center;
    const own = new Set(index.terms[term.id].elements);
    index.neighbors[term.id] = whole
      .filter((other) => other.id !== term.id && other.system === term.system && !index.terms[other.id].elements.some((id) => own.has(id)))
      .map((other) => [other.id, Math.hypot(...index.terms[other.id].center.map((v, k) => v - c[k]))])
      .sort((a, b) => a[1] - b[1])
      .slice(0, 8)
      .map(([id]) => id);
  }
  // 付着面・付着のピンが、まとめた骨の語（肋骨など）のどの1本の上にあるか（図鑑の「この骨から起こる筋」）
  index.attachedBones = attachedBones(index, terms, mesh);
  fs.writeFileSync(path.join(OUT, "index.json"), `${JSON.stringify(index)}\n`);
  const total = Object.values(index.systems).reduce((sum, s) => sum + s.bytes + (s.za?.bytes ?? 0), 0);
  console.log(`語 ${terms.length} / 合計 ${(total / 1024 / 1024).toFixed(2)} MB`);
}

// --attached-bones: GLB は作らず、index.json の attachedBones だけを書き直す（付着面を作り直したとき）
async function writeAttachedBones() {
  const file = path.join(OUT, "index.json");
  const index = JSON.parse(fs.readFileSync(file, "utf8"));
  const { terms } = loadTerms();
  const { elementNames, readMesh, readWhole } = readElements();
  // 骨の語に Z-Anatomy の形（第8〜第10肋軟骨）があるので、そのときは Z-Anatomy も読む
  const za = terms.some((term) => term.system === "skeletal" && term.parts.some((spec) => spec.startsWith("za:"))) ? await loadZa(elementNames, readWhole) : null;
  index.attachedBones = attachedBones(index, terms, (id) => (za?.names.has(id) ? za.mesh(id) : readMesh(id)));
  fs.writeFileSync(file, `${JSON.stringify(index)}\n`);
  console.log(`attachedBones: ${Object.keys(index.attachedBones).length} 件`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await (process.argv.includes("--attached-bones") ? writeAttachedBones() : main());
