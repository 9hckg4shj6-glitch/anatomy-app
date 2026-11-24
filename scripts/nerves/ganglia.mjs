// 交感神経幹の神経節（上頚神経節・中頚神経節・頚胸神経節・胸神経節）の模式の形を、Z-Anatomy の交感神経幹の上に作る
// （scripts/za/index.mjs の loadZa から使う。部品ID は ZS_…、名前は "right superior cervical ganglion" のように左右を前に書く）。
// Z-Anatomy の交感神経幹は第3頚椎から第12胸椎の高さまでで、神経節は椎骨ごとの直径 2mm ほどの点（"ganglia of sympathetic trunk"）しかない。
// 頚部は3つの神経節（上・中・下＝頚胸）にまとまるので、点は使わず、幹の中心線と BodyParts3D の椎骨の高さから紡錘形を作る:
//   上頚神経節: 幹の上端（第3頚椎）から上へのばした線の上、第2〜第3頚椎の前（長さ約 38mm・幅 7mm）
//   中頚神経節: 第6頚椎の高さ（小さい。長さ 8mm）
//   頚胸神経節（星状神経節）: 第7頚椎から第1胸椎（下頚神経節と第1胸神経節が合わさったもの。長さ 26mm・幅 8mm で前後に薄い）
//   胸神経節: Z-Anatomy の点のうち第2胸椎から下のもの（点の中心に長さ 6mm・幅 4mm）
// 幹の形をもとにするので CC BY-SA 4.0 として Z-Anatomy の GLB に入れる。実物の大きさ・数を写したものではない（説明に「模式」と書く）。
import { vertexNormals } from "../za/read.mjs";

export const GANGLIA = [
  { slug: "superior_cervical_ganglion", name: "superior cervical ganglion" },
  { slug: "middle_cervical_ganglion", name: "middle cervical ganglion" },
  { slug: "cervicothoracic_ganglion", name: "cervicothoracic ganglion" },
  { slug: "thoracic_ganglia", name: "thoracic ganglia" },
];

/** 部品ID → 名前（形はまだ作らない） */
export function gangliaNames() {
  const names = new Map();
  for (const side of ["right", "left"]) for (const g of GANGLIA) names.set(`ZS_${g.slug}_${side[0]}`, `${side} ${g.name}`);
  return names;
}

/** y の高さの幹の中心（上下 ±2.5mm の点の平均）。点が無ければ null */
function centerAt(positions, y, band = 0.0025) {
  const s = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i + 1] - y) > band) continue;
    s[0] += positions[i]; s[1] += positions[i + 1]; s[2] += positions[i + 2];
    n++;
  }
  return n ? s.map((v) => v / n) : null;
}

/** 点の連結成分ごとの中心 */
function components(positions, indices) {
  const n = positions.length / 3;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t]), b = find(indices[t + 1]), c = find(indices[t + 2]);
    parent[a] = b;
    parent[find(c)] = find(b);
  }
  const sums = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const s = sums.get(r) ?? [0, 0, 0, 0];
    s[0] += positions[i * 3]; s[1] += positions[i * 3 + 1]; s[2] += positions[i * 3 + 2]; s[3]++;
    sums.set(r, s);
  }
  return [...sums.values()].map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]]);
}

const sub = (a, b) => a.map((v, k) => v - b[k]);
const add = (a, b) => a.map((v, k) => v + b[k]);
const mul = (a, s) => a.map((v) => v * s);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => mul(a, 1 / (Math.hypot(...a) || 1));

/**
 * 中心線（点の列）に沿った紡錘形。断面は楕円（横 radius・前後 radius × flat）、太さは両端で 0 になる。
 * 返り値は { positions, indices }（閉じた形）
 */
function spindle(line, radius, flat = 1, around = 18, along = 22) {
  // 中心線を along 等分した点と向き
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + Math.hypot(...sub(line[i], line[i - 1])));
  const total = lengths.at(-1);
  const pointAt = (s) => {
    let i = 1;
    while (i < line.length - 1 && lengths[i] < s) i++;
    const t = (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    return add(line[i - 1], mul(sub(line[i], line[i - 1]), t));
  };
  const positions = [];
  const rings = [];
  for (let j = 0; j <= along; j++) {
    const s = (total * j) / along;
    const p = pointAt(s);
    const tangent = unit(sub(pointAt(Math.min(total, s + total / along)), pointAt(Math.max(0, s - total / along))));
    // 横の向き（体の左右 x にできるだけ近い向き）と前後の向き
    const side = unit(sub([1, 0, 0], mul(tangent, tangent[0])));
    const front = cross(tangent, side);
    const r = radius * Math.pow(Math.sin((Math.PI * j) / along), 0.7);
    if (j === 0 || j === along) {
      rings.push([positions.length / 3]);
      positions.push(...p);
      continue;
    }
    const ring = [];
    for (let k = 0; k < around; k++) {
      const a = (2 * Math.PI * k) / around;
      ring.push(positions.length / 3);
      positions.push(...add(p, add(mul(side, Math.cos(a) * r), mul(front, Math.sin(a) * r * flat))));
    }
    rings.push(ring);
  }
  const indices = [];
  for (let j = 0; j < along; j++) {
    const a = rings[j], b = rings[j + 1];
    if (a.length === 1) {
      for (let k = 0; k < around; k++) indices.push(a[0], b[(k + 1) % around], b[k]);
    } else if (b.length === 1) {
      for (let k = 0; k < around; k++) indices.push(a[k], a[(k + 1) % around], b[0]);
    } else {
      for (let k = 0; k < around; k++) {
        const k2 = (k + 1) % around;
        indices.push(a[k], a[k2], b[k2], a[k], b[k2], b[k]);
      }
    }
  }
  return { positions, indices };
}

function merge(shapes) {
  const positions = [], indices = [];
  for (const s of shapes) {
    const offset = positions.length / 3;
    positions.push(...s.positions);
    indices.push(...s.indices.map((i) => i + offset));
  }
  return { positions, indices };
}

/**
 * 片側の神経節の形を作る。trunk・dots は骨に合わせたあとの Z-Anatomy の交感神経幹と神経節の点の形、
 * level(name) は BodyParts3D の椎骨（"Third cervical vertebra" など）の中心の高さ
 */
export function makeGanglia(trunk, dots, level) {
  const p = trunk.positions;
  let top = -Infinity;
  for (let i = 1; i < p.length; i += 3) top = Math.max(top, p[i]);
  // 幹の上端の向き（上端から 3mm 下と 15mm 下の中心）を上へのばす
  const a = centerAt(p, top - 0.003), b = centerAt(p, top - 0.015);
  const up = unit(sub(a, b));
  const extend = (y) => add(a, mul(up, (y - a[1]) / up[1]));
  const along = (y0, y1, steps = 6) => Array.from({ length: steps + 1 }, (_, i) => {
    const y = y0 + ((y1 - y0) * i) / steps;
    return y > top - 0.004 ? extend(y) : centerAt(p, y);
  });
  const c2 = level("Axis"), c3 = level("Third cervical vertebra"), c6 = level("Sixth cervical vertebra");
  const c7 = level("Seventh cervical vertebra"), t1 = level("First thoracic vertebra"), t2 = level("Second thoracic vertebra");
  const out = {};
  // 上頚神経節: 第3頚椎の中心の少し下から第2頚椎の上の方まで
  out.superior_cervical_ganglion = spindle(along(c3 - 0.005, c2 + 0.009), 0.0032, 0.75);
  out.middle_cervical_ganglion = spindle(along(c6 + 0.004, c6 - 0.004, 2), 0.0022, 0.8);
  // 頚胸神経節: 第7頚椎の上の縁から第1胸椎と第2胸椎の間まで
  out.cervicothoracic_ganglion = spindle(along(c7 + 0.008, (t1 + t2) / 2, 6), 0.004, 0.6);
  const thoracic = components(dots.positions, dots.indices).filter((c) => c[1] < (t1 + t2) / 2 - 0.004).map((c) => {
    const centre = centerAt(p, c[1]) ?? c;
    return spindle(along(c[1] + 0.003, c[1] - 0.003, 2).map((q) => q ?? centre), 0.002, 0.8, 14, 10);
  });
  out.thoracic_ganglia = merge(thoracic);
  const result = {};
  for (const [slug, shape] of Object.entries(out)) {
    const positions = new Float32Array(shape.positions), indices = new Uint32Array(shape.indices);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], positions[i]);
    }
    result[slug] = { positions, indices, normals: vertexNormals(positions, indices), bounds: [lo, hi] };
  }
  return result;
}
