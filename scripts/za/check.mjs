// Z-Anatomy から取り込んだ形が BodyParts3D の骨に合っているかを見る確認画像を data-raw/za-check/ に描く。
// 使い方: node scripts/za/check.mjs [語ID,…]（省くと Z-Anatomy を使う語をすべて、系統ごとにまとめて描く）
import fs from "node:fs";
import path from "node:path";
import { loadTerms, parseObj, readElements, resolveParts } from "../build-models.mjs";
import { makeFrame, render } from "../pins/geometry.mjs";
import { loadZa } from "./index.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/za-check");
fs.mkdirSync(OUT, { recursive: true });

const { objDir, elementNames, conceptElements } = readElements();
const { terms } = loadTerms();
const bp = new Map();
const bpMesh = (id) => {
  if (!bp.has(id)) bp.set(id, parseObj(path.join(objDir, `${id}.obj`)));
  return bp.get(id);
};
const za = await loadZa(elementNames, bpMesh);
const mesh = (id) => (za.names.has(id) ? za.mesh(id) : bpMesh(id));
const { resolved } = resolveParts(terms, elementNames, conceptElements, za.names);
const PALETTE = ["#d1495b", "#00798c", "#edae49", "#30638e", "#8e5572", "#66a182", "#e76f51", "#2a9d8f", "#6d597a", "#f4a261"];

const wanted = process.argv[2]?.split(",");
const groups = new Map();
for (const term of terms) {
  if (wanted ? !wanted.includes(term.id) : !term.parts.some((spec) => spec.startsWith("za:"))) continue;
  if (!groups.has(term.unit)) groups.set(term.unit, []);
  groups.get(term.unit).push(term);
}
const skeleton = terms.filter((t) => t.system === "skeletal" && !t.of).flatMap((t) => resolved.get(t.id));
const skeletonMeshes = [...new Set(skeleton)].map((id) => ({ ...mesh(id), color: "#e9dfc9" }));

for (const [unit, list] of groups) {
  const shown = list.map((term, i) => ({ term, color: PALETTE[i % PALETTE.length], meshes: resolved.get(term.id).map(mesh) }));
  const all = shown.flatMap((s) => s.meshes);
  // 骨は、語の形の範囲（少し広げた箱）にかかるものだけ描く
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of all) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.bounds[0][k]); hi[k] = Math.max(hi[k], m.bounds[1][k]); }
  const pad = 0.03;
  const near = skeletonMeshes.filter((m) => m.bounds[0].every((v, k) => v < hi[k] + pad) && m.bounds[1].every((v, k) => v > lo[k] - pad));
  for (const view of ["ant", "post", "lat"]) {
    const frame = makeFrame(all, view, 900, 0.12);
    const meshes = [...near, ...shown.flatMap((s) => s.meshes.map((m) => ({ ...m, color: s.color })))];
    const out = path.join(OUT, `${unit}-${view}.png`);
    // 名前は、その語の形（右側）の点の平均に置く
    const spots = shown.map((s) => {
      const sum = [0, 0, 0];
      let n = 0;
      for (const m of s.meshes) for (let i = 0; i < m.positions.length; i += 3) {
        if (m.positions[i] > 0.01) continue;
        for (let k = 0; k < 3; k++) sum[k] += m.positions[i + k];
        n++;
      }
      return { at: [sum.map((v) => v / Math.max(1, n))], r: 0, label: s.term.ja };
    });
    await render({ meshes, frame, out, grid: false, title: unit, spots });
    console.log(out);
  }
}
