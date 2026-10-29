// 筋の付着面（attachments-za.json・content/attachments.json）と起始・停止の骨の部位のピンが、まとめた骨の語
// （肋骨・中足骨・胸椎など）のどの部品の上にあるかを求め、その部品を持つ細かい骨の語（第6肋骨・第5中足骨・第8胸椎など）を
// index.json の attachedBones（{ "筋の語ID@origin|insertion": [骨の語ID, …] }）に書く。
// 図鑑の「この骨から起こる筋」（src/related.ts）が、1本ずつの骨でも付く筋を出せるようにするため。
// build-models.mjs の最後に呼ぶ。付着面だけを作り直したとき（build:attachments・rules/attach.mjs）は、GLB を作らずにこれだけ書き直せる:
//   node scripts/build-models.mjs --attached-bones
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});

/**
 * index は index.json の中身（terms の elements を使う）、readMesh(部品ID) は部品の形（BodyParts3D 4.0、"ZA_…" は骨に合わせた Z-Anatomy の形。位置は m）。
 * pins は content/pins.json、spots は付着面のファイルの中身の配列（省けばファイルから読む）。
 */
export function attachedBones(index, terms, readMesh, {
  pins = read(path.join(ROOT, "content/pins.json")),
  spots = [read(path.join(ROOT, "public/models/attachments-za.json")), read(path.join(ROOT, "content/attachments.json"))],
} = {}) {
  const bones = terms.filter((term) => term.system === "skeletal" && !term.of && index.terms[term.id]);
  const elementsOf = (id) => index.terms[id]?.elements ?? [];
  // まとめた骨の語 → その部品だけでできた、より細かい骨の語
  const finer = new Map();
  for (const bone of bones) {
    const own = new Set(elementsOf(bone.id));
    const list = bones.filter((other) => other.id !== bone.id && elementsOf(other.id).length < own.size && elementsOf(other.id).every((id) => own.has(id)));
    if (list.length) finer.set(bone.id, list);
  }
  const shapes = new Map();
  const shape = (id) => {
    if (!shapes.has(id)) shapes.set(id, readMesh(id));
    return shapes.get(id);
  };
  // 点にいちばん近い部品（頂点までの距離。外接箱で遠いものを先に除く）
  const nearest = (bone, p) => {
    let best = null, bestD = Infinity;
    for (const id of elementsOf(bone)) {
      const { positions, bounds } = shape(id);
      const box = Math.hypot(...p.map((v, k) => Math.max(bounds[0][k] - v, 0, v - bounds[1][k])));
      if (box >= bestD) continue;
      for (let i = 0; i < positions.length; i += 3) {
        const d = Math.hypot(positions[i] - p[0], positions[i + 1] - p[1], positions[i + 2] - p[2]);
        if (d < bestD) [best, bestD] = [id, d];
      }
    }
    return best;
  };
  const out = {};
  for (const muscle of terms.filter((term) => term.nerve)) {
    for (const kind of ["origin", "insertion"]) {
      const points = [];
      for (const source of spots) for (const [bone, x, y, z] of source[muscle.id]?.[kind] ?? []) points.push([bone, [x, y, z]]);
      // 椎骨・肋骨の部位（棘突起・肋骨結節など）は代表の1個（第3腰椎・第6肋骨。語の parts）の上にピンがあるので使わない
      for (const landmark of muscle[`${kind}At`] ?? []) {
        const term = terms.find((other) => other.id === landmark);
        if (!term?.of || elementsOf(landmark).length < elementsOf(term.of).length) continue;
        for (const at of pins[landmark]?.at ?? []) points.push([term.of, at]);
      }
      const found = new Set();
      for (const [bone, p] of points) {
        if (!finer.has(bone)) continue;
        const element = nearest(bone, p);
        for (const other of finer.get(bone)) if (elementsOf(other.id).includes(element)) found.add(other.id);
      }
      if (found.size) out[`${muscle.id}@${kind}`] = [...found].sort();
    }
  }
  return out;
}

