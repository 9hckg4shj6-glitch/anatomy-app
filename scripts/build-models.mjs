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

// BodyParts3D で1つの形になっているものを平面で2つに分ける（仙骨は尾骨まで、下行結腸は S状結腸まで1つの形）。
// 平面の下側（normal・p < d）は別の部品 "<ID>-<slug>"（名前は name）になり、parts で name を指定して使う。
// 上側は元のIDのまま（"sacrum" は尾骨を除いた形になる）。切り口はふさぐ。
const CUTS = [
  // 仙尾連結: 横幅が最も細くなる高さ（その上が仙骨尖、下が第1尾椎の横突起）
  { part: "sacrum", slug: "coccyx", name: "Coccyx", normal: [0, 1, 0], d: 0.818 },
  // 左腸骨窩で下へ降りる管が内側へ曲がり始める高さ。曲がりから先を S状結腸とする
  { part: "descending colon", slug: "sigmoid", name: "Sigmoid colon", normal: [0, 1, 0], d: 0.886 },
];

/** 形を平面で切る。返り値 { above, below }（三角形を切り口で割り、切り口は扇形でふさぐ） */
export function splitMesh(mesh, normal, d) {
  const P = mesh.positions, N = mesh.normals, I = mesh.indices;
  const side = (i) => P[i * 3] * normal[0] + P[i * 3 + 1] * normal[1] + P[i * 3 + 2] * normal[2] - d;
  const pieces = { above: { p: [], n: [], tri: [], map: new Map() }, below: { p: [], n: [], tri: [], map: new Map() } };
  const vertex = (piece, key, pos, nor) => {
    let index = piece.map.get(key);
    if (index === undefined) {
      index = piece.p.length / 3;
      piece.map.set(key, index);
      piece.p.push(...pos);
      piece.n.push(...nor);
    }
    return index;
  };
  const original = (i) => [`v${i}`, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]];
  const crossing = (a, b) => {
    const [i, j] = a < b ? [a, b] : [b, a];
    const t = side(i) / (side(i) - side(j));
    const pos = [0, 1, 2].map((k) => P[i * 3 + k] + t * (P[j * 3 + k] - P[i * 3 + k]));
    const nor = [0, 1, 2].map((k) => N[i * 3 + k] + t * (N[j * 3 + k] - N[i * 3 + k]));
    const length = Math.hypot(...nor) || 1;
    // 同じ位置の頂点が法線ちがいで別の番号のこともあるので、切った点は位置で見分ける（切り口の輪がつながるように）
    return [`e${pos.map((v) => v.toFixed(6)).join(",")}`, pos, nor.map((v) => v / length)];
  };
  const segments = [];
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]];
    const up = v.map((i) => side(i) >= 0);
    const count = up.filter(Boolean).length;
    if (count === 3 || count === 0) {
      const piece = count ? pieces.above : pieces.below;
      piece.tri.push(...v.map((i) => vertex(piece, ...original(i))));
      continue;
    }
    // 1つだけ反対側にある頂点 L から回して (L, V1, V2) にする（向きを保つ）
    const lone = up.findIndex((u) => u === (count === 1));
    const [L, V1, V2] = [v[lone], v[(lone + 1) % 3], v[(lone + 2) % 3]];
    const [lonePiece, otherPiece] = count === 1 ? [pieces.above, pieces.below] : [pieces.below, pieces.above];
    const c1 = crossing(L, V1), c2 = crossing(L, V2);
    lonePiece.tri.push(vertex(lonePiece, ...original(L)), vertex(lonePiece, ...c1), vertex(lonePiece, ...c2));
    const [a, b, c, e] = [vertex(otherPiece, ...c1), vertex(otherPiece, ...original(V1)), vertex(otherPiece, ...original(V2)), vertex(otherPiece, ...c2)];
    otherPiece.tri.push(a, b, c, a, c, e);
    segments.push([c1, c2]);
  }
  // 切り口の輪: 切った点（辺ごとに1つ）を線分でつなぎ、輪ごとに中心から扇形でふさぐ
  const points = new Map(), links = new Map();
  for (const [a, b] of segments) {
    if (a[0] === b[0]) continue;
    for (const [x, y] of [[a, b], [b, a]]) {
      points.set(x[0], x[1]);
      if (!links.has(x[0])) links.set(x[0], []);
      links.get(x[0]).push(y[0]);
    }
  }
  const used = new Set();
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const loop = [start];
    used.add(start);
    for (let next = links.get(start).find((k) => !used.has(k)); next; next = links.get(next).find((k) => !used.has(k))) {
      loop.push(next);
      used.add(next);
    }
    if (loop.length < 3) continue;
    const center = [0, 1, 2].map((k) => loop.reduce((sum, key) => sum + points.get(key)[k], 0) / loop.length);
    for (const [piece, outward] of [[pieces.above, normal.map((v) => -v)], [pieces.below, normal]]) {
      const c = vertex(piece, `center${start}`, center, outward);
      for (let i = 0; i < loop.length; i++) {
        const p = points.get(loop[i]), q = points.get(loop[(i + 1) % loop.length]);
        const a = vertex(piece, `cap${loop[i]}`, p, outward), b = vertex(piece, `cap${loop[(i + 1) % loop.length]}`, q, outward);
        // 面の表（反時計回り）が外を向くように並べる
        const u = p.map((v, k) => v - center[k]), w = q.map((v, k) => v - center[k]);
        const face = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        if (face[0] * outward[0] + face[1] * outward[1] + face[2] * outward[2] >= 0) piece.tri.push(c, a, b);
        else piece.tri.push(c, b, a);
      }
    }
  }
  const finish = (piece) => {
    const positions = new Float32Array(piece.p);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], positions[i]);
    }
    return { positions, normals: new Float32Array(piece.n), indices: new Uint32Array(piece.tri), bounds: [lo, hi] };
  };
  return { above: finish(pieces.above), below: finish(pieces.below) };
}

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
    if (sources.length !== 1) throw new Error(`切る部品「${cut.part}」が ${sources.length} 個あります`);
    const [id] = sources[0];
    cutOf.set(id, [cut, "above"]);
    cutOf.set(`${id}-${cut.slug}`, [cut, "below", id]);
    elementNames.set(`${id}-${cut.slug}`, cut.name);
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
  return { objDir, elementNames, conceptElements, readMesh, readWhole };
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const { elementNames, conceptElements, readMesh: bpMesh, readWhole } = readElements();

  const { systems, terms } = loadTerms();
  const za = terms.some((term) => term.parts.some((spec) => spec.startsWith("za:"))) ? await loadZa(elementNames, readWhole) : null;
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
