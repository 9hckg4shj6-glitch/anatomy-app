// Z-Anatomy の形を BodyParts3D の骨に合わせて動かす。
// 1. 同じ骨（と気管・食道などいくつかの器官）を両方から取り出し、1組ずつ ICP で合わせる（相似 → アフィン）。
// 2. 動かしたい点は、近くにある骨（ほど重く）の変換を混ぜて動かす。骨に付く筋は骨と一緒に動き、骨と骨の間はなめらかにつながる。
// 3. 何百万点も引くので、6mm の格子の角だけで計算して間を補う（使った角だけ計算して覚える）。
import { KdTree } from "./kdtree.mjs";

const ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
const REGION = { c: "cervical", t: "thoracic", l: "lumbar" };
const DIGITS = {
  hand: ["thumb", "index finger", "middle finger", "ring finger", "little finger"],
  foot: ["big toe", "second toe", "third toe", "fourth toe", "little toe"],
};
// Z-Anatomy の名前 → BodyParts3D の名前（左右を外した形）。書いていないものは同じ名前で探す
const RENAME = {
  "atlas (c1)": "atlas",
  "axis (c2)": "axis",
  "scaphoid bone": "scaphoid",
  "lunate bone": "lunate",
  "triquetrum bone": "triquetral",
  "pisiform bone": "pisiform",
  "trapezium bone": "trapezium",
  "trapezoid bone": "trapezoid",
  "capitate bone": "capitate",
  "hamate bone": "hamate",
  "inferior nasal concha bone": "inferior nasal concha",
  "ethmoid bone": "ethmoid",
  "manubrium of sternum": "manubrium",
  "oesophagus": "esophagus",
  "talus": "talus",
};
// 合わせ込みに使う器官（骨から遠い内臓・神経を動かすときの手がかり）
const SOFT = ["trachea", "oesophagus", "thyroid cartilage", "cricoid cartilage", "epiglottis", "stomach", "descending colon", "rectum",
  "urinary bladder", "kidney", "submandibular gland", "pons", "medulla oblongata", "midbrain", "duodenum", "pancreas"];

/** Z-Anatomy の骨（と手がかりの器官）と BodyParts3D の部品の組。返り値: [{ za, bp: [部品ID…], name }] */
export function anchorPairs(zaMeshes, bpNames) {
  const byName = new Map();
  for (const [id, name] of bpNames) {
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(id);
  }
  const pairs = [];
  for (const za of zaMeshes) {
    const base = za.name.replace(/^(right|left) /, "");
    const isBone = za.file === "SkeletalSystem100" && !za.parent && /bone|vertebra|rib$|atlas|axis|sternum|xiphoid|sacrum|mandible|maxilla|clavicle|scapula|humerus|radius|ulna|femur|patella|tibia|fibula|talus|calcaneus|vomer|concha|phalanx/.test(base)
      && !/sesamoid|ossicle|malleus|incus|stapes|cells|sinus/.test(base);
    if (!isBone && !SOFT.includes(base)) continue;
    let target = RENAME[base] ?? base;
    const vertebra = base.match(/^vertebra ([ctl])(\d+)$/);
    if (vertebra) target = `${ORD[vertebra[2] - 1]} ${REGION[vertebra[1]]} vertebra`;
    const cartilage = base.match(/^costal cartilage of (\w+) rib$/);
    if (cartilage) target = `${cartilage[1]} costal cartilage`;
    if (base === "navicular bone") target = `navicular bone of ${za.side} foot`;
    // BodyParts3D は "right humerus" "right first rib" のように左右を前に書く。指の骨と足の舟状骨は左右が中に入る
    let key = za.side && base !== "navicular bone" ? `${za.side} ${target}` : target;
    const phalanx = base.match(/^(proximal|middle|distal) phalanx of (\w+) finger of (hand|foot)$/);
    if (phalanx) key = `${phalanx[1]} phalanx of ${za.side} ${DIGITS[phalanx[3]][ORD.indexOf(phalanx[2])]}`;
    const bp = byName.get(key);
    if (bp) pairs.push({ za, bp, name: za.name });
  }
  return pairs;
}

// ---- 小さな線形代数 ----
function solve(A, b) {
  // ガウスの消去法（A は n×n、b は n×m）。A・b を書きかえる
  const n = A.length, m = b[0].length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      for (let k = 0; k < m; k++) b[r][k] -= f * b[c][k];
    }
  }
  return b.map((row, r) => row.map((v) => v / A[r][r]));
}

function jacobiMaxEigenvector(S) {
  // 対称 4×4 の最大固有値の固有ベクトル（ヤコビ法）
  const n = 4;
  const a = S.map((row) => [...row]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (a[i][i] > a[best][best]) best = i;
  return v.map((row) => row[best]);
}

/** 変換 T（3×4、行ごとに [m0 m1 m2 t]）を点にかける */
export function apply(T, x, y, z) {
  return [
    T[0][0] * x + T[0][1] * y + T[0][2] * z + T[0][3],
    T[1][0] * x + T[1][1] * y + T[1][2] * z + T[1][3],
    T[2][0] * x + T[2][1] * y + T[2][2] * z + T[2][3],
  ];
}

// 相似変換（回転・一様な拡大・平行移動）の最小二乗（Horn の四元数法）
function similarity(src, dst) {
  const n = src.length;
  const ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ca[k] += src[i][k] / n; cb[k] += dst[i][k] / n; }
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const a = src[i].map((v, k) => v - ca[k]), b = dst[i].map((v, k) => v - cb[k]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[r][c] += a[r] * b[c];
    ss += a[0] ** 2 + a[1] ** 2 + a[2] ** 2;
  }
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = M;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const [w, x, y, z] = jacobiMaxEigenvector(N);
  const R = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  let num = 0;
  for (let i = 0; i < n; i++) {
    const a = src[i].map((v, k) => v - ca[k]), b = dst[i].map((v, k) => v - cb[k]);
    for (let r = 0; r < 3; r++) num += b[r] * (R[r][0] * a[0] + R[r][1] * a[1] + R[r][2] * a[2]);
  }
  const s = num / ss;
  return R.map((row, r) => [...row.map((v) => v * s), cb[r] - s * (row[0] * ca[0] + row[1] * ca[1] + row[2] * ca[2])]);
}

// アフィン変換の最小二乗。相似変換 base に少し引き寄せて、薄い骨で潰れないようにする
function affine(src, dst, base, lambda) {
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const B = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < src.length; i++) {
    const p = [...src[i], 1];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) A[r][c] += p[r] * p[c];
      for (let c = 0; c < 3; c++) B[r][c] += p[r] * dst[i][c];
    }
  }
  const w = lambda * src.length;
  for (let r = 0; r < 3; r++) {
    A[r][r] += w;
    for (let c = 0; c < 3; c++) B[r][c] += w * base[c][r];
  }
  const X = solve(A, B); // 4×3
  return [0, 1, 2].map((r) => [X[0][r], X[1][r], X[2][r], X[3][r]]);
}

function sample(positions, max) {
  const n = positions.length / 3;
  const step = Math.max(1, Math.floor(n / max));
  const out = [];
  for (let i = 0; i < n; i += step) out.push([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
  return out;
}

const flat = (points) => Float64Array.from(points.flat());

/**
 * 1組の形を ICP で合わせる。返り値 { T, rms }（T は Z-Anatomy → BodyParts3D）。
 * 両向きの最近点を使う（片向きだと小さい方へ縮みやすい）。
 */
export function icp(zaPositions, bpPositions) {
  const A = sample(zaPositions, 2500);
  const B = sample(bpPositions, 2500);
  const treeB = new KdTree(flat(B));
  const mean = (P) => P.reduce((s, p) => s.map((v, k) => v + p[k] / P.length), [0, 0, 0]);
  const [ca, cb] = [mean(A), mean(B)];
  let T = [[1, 0, 0, cb[0] - ca[0]], [0, 1, 0, cb[1] - ca[1]], [0, 0, 1, cb[2] - ca[2]]];
  let rms = Infinity;
  let base = T;
  for (let iter = 0; iter < 45; iter++) {
    const moved = A.map((p) => apply(T, ...p));
    const treeA = new KdTree(flat(moved));
    const src = [], dst = [], dist = [];
    for (let i = 0; i < moved.length; i++) {
      const [j, d] = treeB.nearest(...moved[i]);
      src.push(A[i]); dst.push(B[j]); dist.push(d);
    }
    for (let j = 0; j < B.length; j++) {
      const [i, d] = treeA.nearest(...B[j]);
      src.push(A[i]); dst.push(B[j]); dist.push(d);
    }
    const sorted = [...dist].sort((a, b) => a - b);
    const cut = sorted[Math.floor(sorted.length * 0.5)] * 9; // 3×中央値（距離の2乗なので9倍）
    const keep = dist.map((d) => d <= cut);
    const s2 = src.filter((_, i) => keep[i]), d2 = dst.filter((_, i) => keep[i]);
    rms = Math.sqrt(dist.reduce((s, d) => s + d, 0) / dist.length);
    if (iter < 25) T = base = similarity(s2, d2);
    else T = affine(s2, d2, base, 0.05);
  }
  return { T, rms };
}

/**
 * 動かす関数を作る。pairs: [{ za: {positions}, bpPositions }]
 * 返り値 warp(x, y, z) → [x', y', z']
 */
export function makeWarp(pairs, { grid = 0.006 } = {}) {
  const transforms = [];
  const points = [];
  const owner = [];
  for (const [b, pair] of pairs.entries()) {
    transforms.push(pair.T);
    for (const p of sample(pair.za.positions, 600)) { points.push(p); owner.push(b); }
  }
  const tree = new KdTree(flat(points));
  const ownerOf = Uint16Array.from(owner);
  const dists = new Float64Array(pairs.length).fill(Infinity);
  const touched = [];

  const exact = (x, y, z) => {
    const [, d0sq] = tree.nearest(x, y, z);
    const d0 = Math.sqrt(d0sq);
    const R = 1.5 * d0 + 0.02;
    touched.length = 0;
    tree.within(x, y, z, R, (i, d) => {
      const b = ownerOf[i];
      if (dists[b] === Infinity) touched.push(b);
      if (d < dists[b]) dists[b] = d;
    });
    let wx = 0, wy = 0, wz = 0, ws = 0;
    for (const b of touched) {
      const d = Math.sqrt(dists[b]);
      dists[b] = Infinity;
      // 半径の端で重みが 0 になるよう、外側3割でなめらかに落とす
      const t = Math.min(1, Math.max(0, (R - d) / (0.3 * R)));
      const w = (t * t * (3 - 2 * t)) / (d * d + 0.003 ** 2);
      const [px, py, pz] = apply(transforms[b], x, y, z);
      wx += w * px; wy += w * py; wz += w * pz; ws += w;
    }
    return [wx / ws, wy / ws, wz / ws];
  };

  const cache = new Map();
  const corner = (i, j, k) => {
    const key = `${i},${j},${k}`;
    let v = cache.get(key);
    if (!v) { v = exact(i * grid, j * grid, k * grid); cache.set(key, v); }
    return v;
  };
  return (x, y, z) => {
    const fx = x / grid, fy = y / grid, fz = z / grid;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    const u = fx - i, v = fy - j, w = fz - k;
    // 格子の角での「動き」を補う（点そのものではなく、ずれを補う）
    const out = [x, y, z];
    for (let c = 0; c < 8; c++) {
      const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
      const weight = (di ? u : 1 - u) * (dj ? v : 1 - v) * (dk ? w : 1 - w);
      const p = corner(i + di, j + dj, k + dk);
      out[0] += weight * (p[0] - (i + di) * grid);
      out[1] += weight * (p[1] - (j + dj) * grid);
      out[2] += weight * (p[2] - (k + dk) * grid);
    }
    return out;
  };
}
