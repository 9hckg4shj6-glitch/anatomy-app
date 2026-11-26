// 手の種子骨（母指の中手指節関節の手のひら側にある2個。『骨学実習の手びき』§4）の模式の形を作る。
// BodyParts3D・Z-Anatomy には足の種子骨しか形が無いので、BodyParts3D の第1中手骨・母指の基節骨・短母指屈筋・母指内転筋の形から位置を決め、
// 小さな楕円体を2つ置く（scripts/made/index.mjs から BodyParts3D の部品として使う。CC BY 4.0 のまま骨格の GLB に入る）:
//   向き: 第1中手骨の長軸（基節骨の側が遠位）と、手のひら側（2つの筋の停止の端の向き。短母指屈筋の側が橈側、母指内転筋の側が尺側。
//         そのままでは約100°開くので、真ん中の向きから 35° ずつに寄せる）
//   位置: 第1中手骨頭の中心（遠位 20% の点の平均）から関節の側へ 2.5mm の高さで、筋の向きから当てた骨頭の表面の 0.4mm 外
//   大きさ: 長軸の向き 5.2mm・横 4mm・厚さ 3.2mm（実物はおよそ 4〜6mm。橈側をやや大きく）
// 実物の形を写したものではない（語の説明に「模式」と書き、schematic を付ける）。
// 座標はモデル座標（m・Y上・前が +z・本人の右が -x）。出力: data-raw/sesamoid/parts.json
// 使い方: node scripts/sesamoid/hand.mjs（そのあと npm run build:models）
import fs from "node:fs";
import path from "node:path";
import { loadDb, raycast, termMeshes } from "../pins/geometry.mjs";

// アプリに出す細かい形（BodyParts3D 3.0 を重ねたもの）の骨頭の上に置く
process.env.HIRES ??= "1";
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/sesamoid");
/** 手のひら側の真ん中の向きから、橈側・尺側の種子骨の向きまでの角度（°） */
const SPREAD = 35;
await loadDb();

const points = (m) => {
  const out = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
  return out;
};
const mean = (pts) => pts.reduce((s, q) => s.map((v, k) => v + q[k] / pts.length), [0, 0, 0]);
const sub = (a, b) => a.map((v, k) => v - b[k]);
const add = (a, b) => a.map((v, k) => v + b[k]);
const mul = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const dist = (a, b) => Math.hypot(...sub(a, b));

/** 点の主軸（いちばん長い向き） */
function principalAxis(pts) {
  const c = mean(pts);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (q[i] - c[i]) * (q[j] - c[j]);
  let v = [1, 1, 1];
  for (let it = 0; it < 200; it++) v = norm([0, 1, 2].map((i) => dot(C[i], v)));
  return v;
}

/** 楕円体（中心 c、軸 e1・e2・e3 の向きに半径 a・b・c）の三角形 */
function ellipsoid(center, [e1, e2, e3], [a, b, c], rings = 14, segments = 20) {
  const positions = [], indices = [];
  for (let i = 0; i <= rings; i++) {
    const t = (Math.PI * i) / rings;
    for (let j = 0; j < segments; j++) {
      const p = (2 * Math.PI * j) / segments;
      const [x, y, z] = [Math.cos(t) * a, Math.sin(t) * Math.cos(p) * b, Math.sin(t) * Math.sin(p) * c];
      positions.push(...add(center, add(add(mul(e1, x), mul(e2, y)), mul(e3, z))));
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const k = i * segments + j, right = i * segments + ((j + 1) % segments);
      // 外向きの面（e1×e2 = e3 の右手系で、上の輪から下の輪へ）
      indices.push(k, k + segments, right, right, k + segments, right + segments);
    }
  }
  return { positions, indices };
}

function merge(meshes) {
  const positions = [], indices = [];
  for (const m of meshes) {
    const base = positions.length / 3;
    positions.push(...m.positions);
    indices.push(...m.indices.map((i) => i + base));
  }
  return { positions: positions.map((v) => +v.toFixed(6)), indices };
}

const parts = [];
for (const side of ["right", "left"]) {
  const metacarpal = termMeshes("first-metacarpal", side)[0];
  const phalanx = termMeshes("proximal-phalanges-of-hand", side).find((m) => /thumb/i.test(m.name));
  const pts = points(metacarpal);
  const center = mean(pts);
  // 長軸は基節骨の側を遠位にする
  let axis = principalAxis(pts);
  if (dot(axis, sub(mean(points(phalanx)), center)) < 0) axis = mul(axis, -1);
  const along = pts.map((q) => dot(sub(q, center), axis));
  const top = Math.max(...along), bottom = Math.min(...along);
  const head = mean(pts.filter((_, i) => along[i] > top - 0.2 * (top - bottom)));
  const level = add(head, mul(axis, 0.0025));
  // 関節（第1中手骨と基節骨のいちばん近い所）の近く 12mm にある筋の点の平均＝停止の端
  let joint = null, best = Infinity;
  const phPts = points(phalanx);
  for (const p of pts) for (const q of phPts) if (dist(p, q) < best) [best, joint] = [dist(p, q), mean([p, q])];
  const tendonEnd = (termId, re) => {
    const muscle = termMeshes(termId, side).find((m) => re.test(m.name));
    if (!muscle) throw new Error(`${side} ${termId} ${re} がありません`);
    const near = points(muscle).filter((q) => dist(q, joint) < 0.012);
    if (near.length < 10) throw new Error(`${muscle.name} の停止の端が関節の近くにありません`);
    return mean(near);
  };
  const toward = (p) => {
    const d = sub(p, head);
    return norm(sub(d, mul(axis, dot(d, axis))));
  };
  // 2つの筋の向きは約100°開いている（間が約1cm）。実物は長母指屈筋の腱をはさんで中心どうし7mm ほどなので、
  // 2つの向きの真ん中（手のひら側）から SPREAD° ずつの向きに寄せる
  const radial = toward(tendonEnd("flexor-pollicis-brevis", /superficial head/i));
  const ulnar = toward(tendonEnd("adductor-pollicis", /oblique head/i));
  const palmar = norm(add(radial, ulnar));
  const spread = (d) => add(mul(palmar, Math.cos((SPREAD * Math.PI) / 180)), mul(norm(sub(d, mul(palmar, dot(d, palmar)))), Math.sin((SPREAD * Math.PI) / 180)));
  const bones = [
    { slug: "radial", name: `Radial sesamoid bone of ${side} hand`, dir: spread(radial), size: [0.0026, 0.002, 0.0016] },
    { slug: "ulnar", name: `Ulnar sesamoid bone of ${side} hand`, dir: spread(ulnar), size: [0.0024, 0.0019, 0.0015] },
  ];
  console.log(`${side}: 2つの筋の向きの角度 ${((Math.acos(dot(radial, ulnar)) * 180) / Math.PI).toFixed(0)}°`);
  const report = [];
  for (const bone of bones) {
    // 骨頭の表面: 筋の向きの外から骨頭へ光線を当てる
    const hit = raycast([metacarpal], add(level, mul(bone.dir, 0.03)), mul(bone.dir, -1));
    if (!hit) throw new Error(`${bone.name}: 骨頭に当たりません`);
    const surface = add(level, mul(bone.dir, 0.03 - hit.dist));
    const c = add(surface, mul(bone.dir, bone.size[2] + 0.0004));
    const e3 = bone.dir;
    const e2 = norm(cross(e3, axis));
    const e1 = cross(e2, e3);
    const shape = merge([ellipsoid(c, [e1, e2, e3], bone.size)]);
    parts.push({ id: `SH_${bone.slug}_sesamoid_${side[0]}`, name: bone.name, ...shape });
    report.push(`${bone.slug} ${c.map((v) => v.toFixed(4)).join(",")}`);
  }
  const gap = dist(...parts.slice(-2).map((p) => mean(points({ positions: p.positions }))));
  console.log(`${side}: 骨頭 ${head.map((v) => v.toFixed(4)).join(",")}、2つの中心の間 ${(gap * 1000).toFixed(1)}mm、${report.join("、")}`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "parts.json"), `${JSON.stringify({ parts })}\n`);
console.log(`${path.relative(ROOT, OUT)}/parts.json: ${parts.length} 部品`);
