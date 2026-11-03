// NasalSeg（CC BY 4.0）の CT の1例から作った鼻腔・鼻道・鼻甲介・上顎洞の形を、BodyParts3D の頭蓋に合わせて使う
// （scripts/build-models.mjs の readElements から使う。部品の名前は BodyParts3D と同じく左右を前に書く）。
// 元の形は scripts/nasal/nasalseg.py が data-raw/nasalseg/<症例>.json に書く（CT の LPS 座標・mm）。
// 合わせ方: (1) 鼻腔の空気の中心を、BodyParts3D の左右の下鼻甲介と鋤骨の中心に重ねる。
// (2) CT の骨の面（鼻腔の底より上。歯・下顎は除く）を、BodyParts3D の顔の骨に剛体（回転・平行移動）の ICP で重ねる。
//     CT も BodyParts3D も実寸の大人なので拡大はしない（似た形が少ない骨の面で拡大を許すと縮んでしまう）。
// (3) 骨の面の点のずれ（BodyParts3D の最も近い面まで）を、広い範囲から狭い範囲へならしてすべての点を動かす（hires.mjs の deform と同じ考え）。
//     CT の下鼻甲介は BodyParts3D の下鼻甲介（骨）より約3mm 内側にあるが、CT の外側の壁は BodyParts3D の上顎骨の内面に合っているので、
//     鼻甲介だけを寄せることはしない（下鼻道とぶつかる）。CT の中の位置関係を優先する。
// 上顎洞は BodyParts3D の上顎骨の空洞（壁が厚く、高さ約13mm と小さい）より大きく、前の壁・眼窩の床から数mm 外へ出る。
// 骨の内側へ寄せると 13.7mL が 8〜9mL に縮んで上面が平たくなったので、CT の形のままにして語を xray にする（ほかの副鼻腔と同じ）。
// 結果は data-raw/nasalseg/aligned.json に覚える。合わせ方を変えたら VERSION を上げる。
import fs from "node:fs";
import path from "node:path";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { KdTree } from "../za/kdtree.mjs";
import { apply } from "../za/warp.mjs";
import { vertexNormals } from "../za/read.mjs";

const VERSION = 2;
const ROOT = path.resolve(import.meta.dirname, "../..");
export const NASAL_DIR = path.join(ROOT, "data-raw/nasalseg");
export const NASAL_CASE = "P065";
const CACHE = path.join(NASAL_DIR, "aligned.json");
// 合わせ込みに使う BodyParts3D の顔の骨（左右を外した名前）
const FACE_BONES = /^(maxilla|palatine bone|vomer|nasal bone|zygomatic bone|ethmoid|inferior nasal concha|lacrimal bone|frontal bone|sphenoid)$/;
const SIGMAS = [0.015, 0.008];
/** 骨の面のずれを使う距離の上限（m）。これより遠い点は BodyParts3D に同じ所の骨が無い（CT の切り出しの縁・薄い壁）とみなす */
const REACH = 0.005;

const bounds = (positions) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], positions[i]);
  }
  return [lo, hi];
};
const concat = (list) => {
  const out = new Float32Array(list.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of list) { out.set(p, o); o += p.length; }
  return out;
};
const centroid = (positions) => {
  const c = [0, 0, 0];
  for (let i = 0; i < positions.length; i++) c[i % 3] += positions[i] / (positions.length / 3);
  return c;
};

// CT の LPS（mm。x が本人の左・y が後ろ・z が上）→ モデル座標（m。x が本人の左・y が上・z が前）
function toModel(p) {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i] * 0.001;
    out[i + 1] = p[i + 2] * 0.001;
    out[i + 2] = -p[i + 1] * 0.001;
  }
  return out;
}

// 剛体の最小二乗（Horn の四元数法。最大固有ベクトルはべき乗法で）
function rigid(A, B) {
  const n = A.length;
  const ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ca[k] += A[i][k] / n; cb[k] += B[i][k] / n; }
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[r][c] += (A[i][r] - ca[r]) * (B[i][c] - cb[c]);
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = M;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const shift = 10 * (Math.abs(Sxx) + Math.abs(Syy) + Math.abs(Szz) + 1e-12);
  let v = [1, 0, 0, 0];
  for (let it = 0; it < 300; it++) {
    const w = N.map((row, r) => row.reduce((s, x, c) => s + x * v[c], 0) + shift * v[r]);
    const l = Math.hypot(...w);
    v = w.map((x) => x / l);
  }
  const [w, x, y, z] = v;
  const R = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  return R.map((row, r) => [...row, cb[r] - (row[0] * ca[0] + row[1] * ca[1] + row[2] * ca[2])]);
}

function bvhOf(positions, indices) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return new MeshBVH(geometry);
}

/** 点を間引く（cell の格子ごとに1点） */
function thin(positions, cell) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < positions.length; i += 3) {
    const key = `${Math.floor(positions[i] / cell)},${Math.floor(positions[i + 1] / cell)},${Math.floor(positions[i + 2] / cell)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(positions[i], positions[i + 1], positions[i + 2]);
  }
  return Float64Array.from(out);
}

/**
 * 合わせ込み。meshes: [{ name, positions（モデル座標の向きにしたもの） }]、bp: [{ name, positions, indices }]（顔の骨）。
 * 返り値: { T（剛体の変換）, cues（なめらかな変形の手がかり）, sigmas }。JSON に覚えられる形で、mover が点を動かす関数にする
 */
function register(meshes, bp) {
  const byName = new Map(meshes.map((m) => [m.name, m]));
  const air = concat(meshes.filter((m) => /nasal cavity proper|meatus/.test(m.name)).map((m) => m.positions));
  const ctCenter = centroid(air);
  const ref = bp.filter((b) => /inferior nasal concha|vomer/i.test(b.name));
  const [rlo, rhi] = bounds(concat(ref.map((b) => b.positions)));
  const bpCenter = rlo.map((v, k) => (v + rhi[k]) / 2);
  const bone = byName.get("bone").positions;
  const [blo, bhi] = bounds(bone);
  const floor = bounds(air)[0][1];
  // CT の骨: 切り出しの縁から 4mm と、鼻腔の底より 6mm 下（歯・下顎）を除く
  const source = [];
  for (let i = 0; i < bone.length; i += 3) {
    const q = [bone[i], bone[i + 1], bone[i + 2]];
    if (q.every((v, k) => v > blo[k] + 0.004 && v < bhi[k] - 0.004) && q[1] > floor - 0.006) source.push(q);
  }
  // BodyParts3D の骨: CT の骨の範囲（鼻腔の中心からのずれで移したもの）の中
  const target = [];
  for (const b of bp) {
    for (let i = 0; i < b.positions.length; i += 3) {
      const q = [0, 1, 2].map((k) => b.positions[i + k]);
      const back = q.map((v, k) => v - bpCenter[k] + ctCenter[k]);
      if (back.every((v, k) => v >= blo[k] - 0.003 && v <= bhi[k] + 0.003) && back[1] > floor - 0.008) target.push(...q);
    }
  }
  const tree = new KdTree(Float64Array.from(target));
  const step = Math.max(1, Math.floor(source.length / 5000));
  const sample = source.filter((_, i) => i % step === 0);
  let T = [[1, 0, 0, bpCenter[0] - ctCenter[0]], [0, 1, 0, bpCenter[1] - ctCenter[1]], [0, 0, 1, bpCenter[2] - ctCenter[2]]];
  for (let it = 0; it < 80; it++) {
    const pairs = sample.map((p) => {
      const [j, d] = tree.nearest(...apply(T, ...p));
      return [p, [target[j * 3], target[j * 3 + 1], target[j * 3 + 2]], d];
    }).sort((a, b) => a[2] - b[2]);
    // 近い組だけで解く（初めは半分、あとは 7割）
    const keep = pairs.slice(0, Math.floor(pairs.length * (it < 20 ? 0.5 : 0.7)));
    T = rigid(keep.map((p) => p[0]), keep.map((p) => p[1]));
  }
  // なめらかな変形の手がかり: 骨の面の点 → BodyParts3D の最も近い面
  const bpAll = concat(bp.map((b) => b.positions));
  const bpIndex = new Uint32Array(bp.reduce((s, b) => s + b.indices.length, 0));
  let offset = 0, at = 0;
  for (const b of bp) {
    for (const i of b.indices) bpIndex[at++] = i + offset;
    offset += b.positions.length / 3;
  }
  const bvh = bvhOf(bpAll, bpIndex);
  const movedBone = [];
  for (const q of source) movedBone.push(...apply(T, ...q));
  const cues = []; // [x, y, z, dx, dy, dz, 重み]（重みは今はどれも 1）
  const p = new Vector3();
  const hit = {};
  const control = thin(Float64Array.from(movedBone), 0.0025);
  for (let i = 0; i < control.length; i += 3) {
    p.set(control[i], control[i + 1], control[i + 2]);
    bvh.closestPointToPoint(p, hit);
    if (hit.distance < REACH) cues.push([control[i], control[i + 1], control[i + 2], hit.point.x - p.x, hit.point.y - p.y, hit.point.z - p.z, 1]);
  }
  return { T, cues, sigmas: SIGMAS };
}

/** register の結果から点を動かす関数を作る。広い sigma から順に、手がかりのずれをならして足していく */
function mover({ T, cues, sigmas }) {
  const layers = [];
  let current = cues.map((c) => [...c]);
  for (const sigma of sigmas) {
    const frozen = current;
    const tree = new KdTree(Float64Array.from(frozen.flatMap((c) => c.slice(0, 3))));
    const field = (x, y, z) => {
      let sx = 0, sy = 0, sz = 0, sw = 0;
      tree.within(x, y, z, sigma * 2.5, (m, d2) => {
        const w = frozen[m][6] * Math.exp(-d2 / (2 * sigma * sigma));
        sx += frozen[m][3] * w; sy += frozen[m][4] * w; sz += frozen[m][5] * w; sw += w;
      });
      // 手がかりの少ない所（鼻の先の空気など）はずれを小さくする（sw に下駄をはかせる）
      const floor = 0.5;
      return [sx / (sw + floor), sy / (sw + floor), sz / (sw + floor)];
    };
    layers.push(field);
    // 次の段の手がかり: このずれで動かしたあとに残るずれ
    current = frozen.map((c) => {
      const f = field(c[0], c[1], c[2]);
      return [c[0] + f[0], c[1] + f[1], c[2] + f[2], c[3] - f[0], c[4] - f[1], c[5] - f[2], c[6]];
    });
  }
  return (x, y, z) => {
    let q = apply(T, x, y, z);
    for (const field of layers) {
      const f = field(...q);
      q = [q[0] + f[0], q[1] + f[1], q[2] + f[2]];
    }
    return q;
  };
}

// 部品にする形（nasalseg.py の名前 → 部品の名前）。骨（bone）と咽頭鼻部は合わせ込み・確かめにだけ使う
const PARTS = [
  "right nasal cavity proper", "left nasal cavity proper",
  "right inferior nasal meatus", "left inferior nasal meatus", "right middle nasal meatus", "left middle nasal meatus",
  "right inferior nasal concha (mucosa)", "left inferior nasal concha (mucosa)", "right middle nasal concha (mucosa)", "left middle nasal concha (mucosa)",
  "right maxillary sinus", "left maxillary sinus",
];
const idOf = (name) => `NS_${name.replace(/[^a-z]+/g, "_").replace(/_$/, "")}`;
const nameOf = (name) => name[0].toUpperCase() + name.slice(1);

/** 部品ID → 名前（readElements の elementNames に足す）。元の形が無ければ空 */
export function nasalNames() {
  const file = path.join(NASAL_DIR, `${NASAL_CASE}.json`);
  if (!fs.existsSync(file)) return new Map();
  return new Map(PARTS.map((name) => [idOf(name), nameOf(name)]));
}

/**
 * 形を読む関数を作る。elementNames・readWhole は BodyParts3D（顔の骨の合わせ込みに使う）。
 * 返り値 read(部品ID) → { name, positions, normals, indices, bounds }
 */
export function loadNasal({ elementNames, readWhole }) {
  let parts = null;
  const build = () => {
    const file = path.join(NASAL_DIR, `${NASAL_CASE}.json`);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const stamp = `${VERSION}:${fs.statSync(file).size}:${fs.statSync(file).mtimeMs}`;
    const meshes = data.meshes.map((m) => ({ name: m.name, positions: toModel(m.positions), indices: Uint32Array.from(m.indices) }));
    let fit = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : null;
    if (fit?.stamp !== stamp) {
      const bp = [...elementNames].filter(([id, name]) => FACE_BONES.test(name.toLowerCase().replace(/^(right|left) /, "")) && !id.includes("-"))
        .map(([id, name]) => ({ name, ...readWhole(id) }));
      fit = { stamp, ...register(meshes, bp) };
      fs.writeFileSync(CACHE, `${JSON.stringify(fit)}\n`);
    }
    const move = mover(fit);
    parts = new Map();
    for (const m of meshes) {
      if (!PARTS.includes(m.name)) continue;
      const positions = new Float32Array(m.positions.length);
      for (let i = 0; i < positions.length; i += 3) positions.set(move(m.positions[i], m.positions[i + 1], m.positions[i + 2]), i);
      parts.set(idOf(m.name), { name: nameOf(m.name), positions, normals: vertexNormals(positions, m.indices), indices: m.indices, bounds: bounds(positions) });
    }
  };
  return (id) => {
    if (!parts) build();
    const mesh = parts.get(id);
    if (!mesh) throw new Error(`NasalSeg の形 ${id} がありません`);
    return mesh;
  };
}
