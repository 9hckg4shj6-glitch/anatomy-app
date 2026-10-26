// 筋の付着面（public/models/attachments-za.json）を、Z-Anatomy の「骨の上の付着面」の形から作る。
// Z-Anatomy の付着面は名前に o（起始）/ e（停止）が付くが、教科書と逆のもの（斜角筋・前鋸筋など）があるので使わない。
// どの骨の上にあるかだけを見て、下の表の起始の骨・停止の骨に振り分ける（表に無い骨の上の面は捨てる）。
// 位置は骨に合わせて動かしたあと BodyParts3D の骨の表面に寄せ、半径 R の球の並びで覆う。アプリは骨の部位のピンと同じ仕組みで塗る。
// 右側（本人の右）の骨の上の面だけを使う（左側はアプリが折り返して示す）。
// 出力は { 筋の語ID: { origin: [[骨の語ID, x, y, z, 半径, nx, ny, nz（面の向き。無いこともある）], …], insertion: […] } }。
// Z-Anatomy（CC BY-SA 4.0）から作ったデータなので、3Dモデルと同じく名前に -za を付けて public/models/ に置く。
// 使い方: node scripts/za/attachments.mjs [--check]（--check で data-raw/za-check/attach-*.png に確認画像）
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { loadTerms, readElements, resolveParts } from "../build-models.mjs";
import { makeFrame, render } from "../pins/geometry.mjs";
import { loadZa } from "./index.mjs";
import { KdTree } from "./kdtree.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "public/models/attachments-za.json");
const CHECK = path.join(ROOT, "data-raw/za-check");
const R = 0.008;
// 1つの起始（停止）の球の数の上限。アプリは1度に64個まで塗れる（左側への折り返しを含む。足りなければ折り返さない）
const MAX_SPOTS = 24;

// 語ID → [Z-Anatomy の筋の名前（左右と o/e を外した形）, 起始の骨の語ID, 停止の骨の語ID, 使わない骨（Z-Anatomy の名前）]
const T = (za, origin, insertion = [], skip = null) => ({ za, origin, insertion, skip });
const TABLE = {
  "deltoid": T(["deltoid muscle", "acromial part of deltoid muscle", "clavicular part of deltoid muscle", "scapular spinal part of deltoid muscle"], ["clavicle", "scapula"], ["humerus"]),
  "supraspinatus": T(["supraspinatus muscle"], ["scapula"], ["humerus"]),
  "infraspinatus": T(["infraspinatus muscle"], ["scapula"], ["humerus"]),
  "teres-minor": T(["teres minor muscle"], ["scapula"], ["humerus"]),
  "teres-major": T(["teres major muscle"], ["scapula"], ["humerus"]),
  "subscapularis": T(["subscapularis muscle"], ["scapula"], ["humerus"]),
  "biceps-brachii": T(["biceps brachii muscle", "long head of biceps brachii", "short head of biceps brachii"], ["scapula"], ["radius"]),
  "coracobrachialis": T(["coracobrachialis muscle"], ["scapula"], ["humerus"]),
  "brachialis": T(["brachialis muscle"], ["humerus"], ["ulna"]),
  "triceps-brachii": T(["triceps brachii muscle", "long head of triceps brachii", "lateral head of triceps brachii", "medial head of triceps brachii"], ["scapula", "humerus"], ["ulna"]),
  "brachioradialis": T(["brachioradialis muscle"], ["humerus"], ["radius"]),
  "pronator-teres": T(["pronator teres"], ["humerus", "ulna"], ["radius"]),
  "pronator-quadratus": T(["pronator quadratus"], ["ulna"], ["radius"]),
  "supinator": T(["supinator"], ["humerus", "ulna"], ["radius"]),
  "flexor-carpi-ulnaris": T(["flexor carpi ulnaris", "ulnar head of flexor carpi ulnaris"], ["humerus", "ulna"], ["pisiform", "hamate", "metacarpals"]),
  "flexor-digitorum-superficialis": T(["flexor digitorum superficialis"], ["humerus", "ulna", "radius"], ["phalanges-hand"]),
  "flexor-digitorum-profundus": T(["flexor digitorum profundus"], ["ulna"], ["phalanges-hand"]),
  "extensor-carpi-radialis-longus": T(["extensor carpi radialis longus"], ["humerus"], ["metacarpals"]),
  "extensor-carpi-ulnaris": T(["extensor carpi ulnaris"], ["humerus", "ulna"], ["metacarpals"]),
  "extensor-digitorum": T(["extensor digitorum"], ["humerus"], ["phalanges-hand"], /proximal phalanx/),
  "pectoralis-major": T(["pectoralis major muscle", "sternocostal head of pectoralis major muscle", "(abdominal part of pectoralis major muscle)"], ["clavicle", "sternum", "costal-cartilages"], ["humerus"]),
  "pectoralis-minor": T(["pectoralis minor muscle"], ["ribs"], ["scapula"]),
  "serratus-anterior": T(["serratus anterior muscle"], ["ribs"], ["scapula"]),
  "subclavius": T(["subclavius muscle"], ["ribs"], ["clavicle"]),
  "diaphragm": T(["diaphragm"], ["sternum", "costal-cartilages", "ribs", "lumbar-vertebrae"]),
  "external-oblique": T(["external abdominal oblique muscle"], ["ribs"], ["hip-bone"]),
  "trapezius": T(["descending part of trapezius muscle", "transverse part of trapezius muscle", "ascending part of trapezius muscle"], ["occipital-bone", "cervical-vertebrae", "thoracic-vertebrae"], ["clavicle", "scapula"]),
  "levator-scapulae": T(["levator scapulae"], ["cervical-vertebrae"], ["scapula"]),
  "rhomboid-major": T(["rhomboid major muscle"], ["thoracic-vertebrae"], ["scapula"]),
  "rhomboid-minor": T(["rhomboid minor muscle"], ["cervical-vertebrae", "thoracic-vertebrae"], ["scapula"]),
  "erector-spinae": T(["erector spinae", "longissimus thoracis muscle", "iliocostalis colli muscle"], ["hip-bone", "sacrum"], ["ribs", "thoracic-vertebrae", "lumbar-vertebrae", "cervical-vertebrae"]),
  "psoas-major": T(["iliopsoas muscle"], ["lumbar-vertebrae"], ["femur"]),
  "iliacus": T(["iliacus muscle", "iliopsoas muscle"], ["hip-bone"], ["femur"]),
  "latissimus-dorsi": T(["latissimus dorsi muscle"], ["hip-bone", "thoracic-vertebrae", "lumbar-vertebrae", "ribs"], ["humerus"]),
  "rectus-abdominis": T(["rectus abdominis muscle"], ["hip-bone"], ["costal-cartilages", "sternum"]),
  "internal-oblique": T(["internal abdominal oblique muscle"], ["hip-bone"], ["ribs", "costal-cartilages"]),
  "transversus-abdominis": T(["transversus abdominis muscle"], ["hip-bone", "costal-cartilages"]),
  "sternocleidomastoid": T(["sternocleidomastoid muscle"], ["sternum", "clavicle"], ["temporal-bone"]),
  "digastric": T(["anterior belly of digastric muscle", "posterior belly of digastric muscle"], ["mandible", "temporal-bone"], ["hyoid-bone"]),
  "mylohyoid": T(["mylohyoid muscle"], ["mandible"], ["hyoid-bone"]),
  "sternohyoid": T(["sternohyoid muscle"], ["sternum", "clavicle"], ["hyoid-bone"]),
  "omohyoid": T(["omohyoid muscle"], ["scapula"], ["hyoid-bone"]),
  "anterior-scalene": T(["scalenus anterior muscle"], ["cervical-vertebrae"], ["ribs"]),
  "middle-scalene": T(["scalenus medius muscle"], ["cervical-vertebrae"], ["ribs"]),
  "orbicularis-oculi": T(["orbital part of orbicularis oculi"], ["maxilla", "frontal-bone"]),
  "orbicularis-oris": T(["orbicularis oris muscle"], ["maxilla", "mandible"]),
  "buccinator": T(["bucinator"], ["maxilla", "mandible"]),
  "zygomaticus-major": T(["zygomaticus major muscle"], ["zygomatic-bone"]),
  "levator-labii-superioris": T(["levator labii superioris"], ["maxilla"]),
  "depressor-anguli-oris": T(["depressor anguli oris"], ["mandible"]),
  "mentalis": T(["mentalis muscle"], ["mandible"]),
  "temporalis": T(["temporalis muscle"], ["frontal-bone", "parietal-bone", "temporal-bone", "sphenoid-bone"], ["mandible"]),
  "masseter": T(["masseter"], ["zygomatic-bone", "temporal-bone"], ["mandible"]),
  "medial-pterygoid": T(["medial pterygoid muscle"], ["sphenoid-bone"], ["mandible"]),
  "gluteus-maximus": T(["gluteus maximus muscle"], ["hip-bone", "sacrum"], ["femur"]),
  "gluteus-medius": T(["gluteus medius muscle"], ["hip-bone"], ["femur"]),
  "gluteus-minimus": T(["gluteus minimus muscle"], ["hip-bone"], ["femur"]),
  "piriformis": T(["piriformis muscle"], ["sacrum"], ["femur"]),
  "tensor-fasciae-latae": T(["tensor fasciae latae"], ["hip-bone"], ["tibia"]),
  "sartorius": T(["sartorius muscle"], ["hip-bone"], ["tibia"]),
  "quadriceps-femoris": T(["quadriceps femoris muscle", "rectus femoris muscle", "vastus lateralis muscle", "vastus medialis muscle", "vastus intermedius muscle"], ["hip-bone", "femur"], ["patella", "tibia"]),
  "rectus-femoris": T(["rectus femoris muscle", "quadriceps femoris muscle"], ["hip-bone"], ["patella", "tibia"]),
  "vastus-lateralis": T(["vastus lateralis muscle", "quadriceps femoris muscle"], ["femur"], ["patella", "tibia"]),
  "vastus-medialis": T(["vastus medialis muscle", "quadriceps femoris muscle"], ["femur"], ["patella", "tibia"]),
  "vastus-intermedius": T(["vastus intermedius muscle", "quadriceps femoris muscle"], ["femur"], ["patella", "tibia"]),
  "gracilis": T(["gracilis muscle"], ["hip-bone"], ["tibia"]),
  "adductor-longus": T(["adductor longus"], ["hip-bone"], ["femur"]),
  "adductor-magnus": T(["adductor magnus"], ["hip-bone"], ["femur"]),
  "pectineus": T(["pectineus muscle"], ["hip-bone"], ["femur"]),
  "biceps-femoris": T(["biceps femoris muscle", "long head of biceps femoris", "short head of biceps femoris"], ["hip-bone", "femur"], ["fibula"]),
  "semitendinosus": T(["semitendinosus muscle"], ["hip-bone"], ["tibia"]),
  "semimembranosus": T(["semimembranosus muscle"], ["hip-bone"], ["tibia"]),
  "tibialis-anterior": T(["tibialis anterior muscle"], ["tibia"], ["cuneiforms", "metatarsals"]),
  "triceps-surae": T(["triceps surae muscle", "lateral head of gastrocnemius", "medial head of gastrocnemius", "soleus muscle"], ["femur", "tibia", "fibula"], ["calcaneus"]),
  "gastrocnemius": T(["triceps surae muscle", "lateral head of gastrocnemius", "medial head of gastrocnemius"], ["femur"], ["calcaneus"]),
  "soleus": T(["triceps surae muscle", "soleus muscle"], ["tibia", "fibula"], ["calcaneus"]),
  "fibularis-longus": T(["fibularis longus muscle"], ["fibula"], ["cuneiforms", "metatarsals"]),
  "fibularis-brevis": T(["fibularis brevis muscle"], ["fibula"], ["metatarsals"]),
  "tibialis-posterior": T(["tibialis posterior muscle"], ["tibia", "fibula"], ["navicular", "cuneiforms", "metatarsals"]),
};

const { elementNames, conceptElements, readMesh: bpMesh, readWhole } = readElements();
const { terms } = loadTerms();
const za = await loadZa(elementNames, readWhole);
const termById = new Map(terms.map((t) => [t.id, t]));
for (const id of Object.keys(TABLE)) if (!termById.get(id)?.nerve) throw new Error(`表の ${id} は筋の語ではありません`);
const bones = terms.filter((t) => t.system === "skeletal" && !t.of);
const { resolved } = resolveParts(bones, elementNames, conceptElements);
for (const [id, table] of Object.entries(TABLE)) {
  for (const bone of [...table.origin, ...table.insertion]) if (!resolved.has(bone)) throw new Error(`${id}: 骨の語 ${bone} がありません`);
}

// Z-Anatomy の骨 → BodyParts3D の部品 → それを含む一番小さい骨の語
const pairByName = new Map(za.pairs.map((p) => [p.name, p.bp]));
function boneOf(parentName) {
  const ids = pairByName.get(parentName);
  if (!ids) return null;
  const fits = bones.filter((t) => ids.every((id) => resolved.get(t.id).includes(id)));
  fits.sort((a, b) => resolved.get(a.id).length - resolved.get(b.id).length);
  return fits[0] ? { term: fits[0].id, elements: ids } : null;
}

// 付着面: 骨の子の形。名前は「筋の名前」＋ o/e ＋ 番号 ＋ 左右
const patches = [];
for (const m of za.all) {
  if (m.file !== "SkeletalSystem100" || !m.parent || m.parent.startsWith("left ")) continue;
  const parsed = m.raw.match(/^(.*)([oe])(\d*)([lr]?)$/);
  if (!parsed) continue;
  const bone = boneOf(m.parent);
  if (!bone) continue;
  patches.push({ id: m.id, muscle: parsed[1].replace(/_/g, " ").toLowerCase().trim(), parent: m.parent, bone });
}

// 骨の表面（右側の部品）に寄せるための木
const surfaces = new Map();
function surface(elements) {
  const key = elements.join("+");
  if (!surfaces.has(key)) {
    const positions = [], normals = [];
    for (const id of elements) {
      const m = bpMesh(id);
      for (let i = 0; i < m.positions.length; i++) {
        positions.push(m.positions[i]);
        normals.push(m.normals[i]);
      }
    }
    surfaces.set(key, { tree: new KdTree(Float64Array.from(positions)), positions, normals });
  }
  return surfaces.get(key);
}

const round = (v) => Math.round(v * 10000) / 10000;

// 点の集まりを半径 r の球で覆う（いちばん遠い点を順に中心にする）
function cover(points, r) {
  const centers = [points[0]];
  const nearest = points.map((p) => Math.hypot(p.at[0] - points[0].at[0], p.at[1] - points[0].at[1], p.at[2] - points[0].at[2]));
  for (;;) {
    let far = 0;
    for (let i = 1; i < points.length; i++) if (nearest[i] > nearest[far]) far = i;
    if (nearest[far] <= r) break;
    const c = points[far];
    centers.push(c);
    for (let i = 0; i < points.length; i++) {
      nearest[i] = Math.min(nearest[i], Math.hypot(points[i].at[0] - c.at[0], points[i].at[1] - c.at[1], points[i].at[2] - c.at[2]));
    }
  }
  // ほかから離れた数点だけを覆う球（付着面の端のかけら）は、点が散って見えるので捨てる
  const few = Math.max(3, points.length * 0.01);
  return centers.map((c) => {
    const near = points.filter((p) => Math.hypot(p.at[0] - c.at[0], p.at[1] - c.at[1], p.at[2] - c.at[2]) <= r);
    if (near.length < few) return null;
    const n = near.reduce((s, p) => s.map((v, k) => v + p.n[k]), [0, 0, 0]);
    const length = Math.hypot(...n) / near.length;
    const reach = Math.max(...near.map((p) => Math.hypot(p.at[0] - c.at[0], p.at[1] - c.at[1], p.at[2] - c.at[2])));
    const spot = { on: c.on, at: c.at.map(round), r: round(Math.max(0.005, Math.min(r, reach + 0.002))) };
    // 面の向きがそろっていれば、その向きの面だけを塗る（薄い骨の裏まで塗らない）
    if (length > 0.6) spot.n = n.map((v) => round(v / Math.hypot(...n)));
    return spot;
  }).filter(Boolean);
}

const result = {};
const report = [];
for (const [muscleId, table] of Object.entries(TABLE)) {
  const entry = {};
  for (const kind of ["origin", "insertion"]) {
    const allowed = table[kind];
    const points = [];
    for (const patch of patches.filter((p) => table.za.includes(p.muscle) && !table.skip?.test(p.parent))) {
      const host = allowed.find((bone) => patch.bone.elements.every((id) => resolved.get(bone).includes(id)));
      if (!host) continue;
      const s = surface(patch.bone.elements);
      const { positions } = za.mesh(patch.id);
      for (let i = 0; i < positions.length; i += 3) {
        const [j] = s.tree.nearest(positions[i], positions[i + 1], positions[i + 2]);
        points.push({ on: host, at: s.positions.slice(j * 3, j * 3 + 3), n: s.normals.slice(j * 3, j * 3 + 3) });
      }
    }
    if (!points.length) continue;
    let r = R, spots = cover(points, r);
    while (spots.length > MAX_SPOTS) spots = cover(points, (r *= 1.2));
    entry[kind] = spots.map((s) => [s.on, ...s.at, s.r, ...(s.n ?? [])]);
  }
  if (Object.keys(entry).length) result[muscleId] = entry;
  report.push(`${muscleId}: 起始 ${entry.origin?.length ?? 0} / 停止 ${entry.insertion?.length ?? 0}`);
}
fs.writeFileSync(OUT, `${JSON.stringify(result)}\n`);
console.log(report.join("\n"));
console.log(`${Object.keys(result).length} 筋 → ${path.relative(ROOT, OUT)}`);

if (process.argv.includes("--check")) {
  // 4筋ずつ1枚に。筋ごとに前・後ろ・外・内から、骨（右側）と起始（緑）・停止（紫）
  fs.mkdirSync(CHECK, { recursive: true });
  const ids = Object.keys(result);
  for (let page = 0; page * 4 < ids.length; page++) {
    const tiles = [];
    for (const [row, muscleId] of ids.slice(page * 4, page * 4 + 4).entries()) {
      const entry = result[muscleId];
      const boneIds = [...new Set([...(entry.origin ?? []), ...(entry.insertion ?? [])].map(([on]) => on))];
      const meshes = boneIds.flatMap((b) => resolved.get(b).filter((id) => !/\bleft\b/i.test(elementNames.get(id)))).map((id) => ({ ...bpMesh(id), color: "#e9dfc9" }));
      const spot = (color) => ([, x, y, z, r, ...n]) => ({ at: [[x, y, z]], r, n: n.length ? n : undefined, color });
      const spots = [...(entry.origin ?? []).map(spot("#2f9e44")), ...(entry.insertion ?? []).map(spot("#7048e8"))];
      for (const [col, view] of ["ant", "post", "lat", "med"].entries()) {
        const file = path.join(CHECK, `tile-${row}-${col}.png`);
        await render({ meshes, spots, frame: makeFrame(meshes, view, 300, 0.06), out: file, grid: false, title: col ? view : `${termById.get(muscleId).ja} ${view}` });
        tiles.push({ input: await sharp(file).resize(300, 300, { fit: "contain", background: "#f7f5ee" }).toBuffer(), left: col * 300, top: row * 300 });
        fs.rmSync(file);
      }
    }
    const out = path.join(CHECK, `attach-${String(page + 1).padStart(2, "0")}.png`);
    await sharp({ create: { width: 1200, height: 1200, channels: 3, background: "#f7f5ee" } }).composite(tiles).png().toFile(out);
    console.log(out);
  }
}
