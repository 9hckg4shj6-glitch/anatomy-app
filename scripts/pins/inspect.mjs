// ピンの規則を書くための下見。骨・器官を描く・光線が当たる所の地図・奥行きの地図を出す（SIDE=left|all で左の部品も）。
// node scripts/pins/inspect.mjs view  <語ID> <view,view> [crop u0,v0,u1,v1]   → data-raw/pin-check/view-*.png
// node scripts/pins/inspect.mjs hits  <語ID> <view> u0 u1 v0 v1 [step]       → # が骨、. が何も無い所
// node scripts/pins/inspect.mjs depth <語ID> <view> u0 u1 v0 v1 [step]       → 0〜9 が手前〜奥
import fs from "node:fs";
import path from "node:path";
import { loadDb, makeFrame, raycast, render, termMeshes, usesZa } from "./geometry.mjs";

const OUT = path.resolve(import.meta.dirname, "../../data-raw/pin-check");
const [mode, term, view, ...rest] = process.argv.slice(2);
await loadDb({ za: usesZa([term]) });
const ms = termMeshes(term, process.env.SIDE ?? "right");

if (mode === "view") {
  fs.mkdirSync(OUT, { recursive: true });
  const crop = rest[0] ? rest[0].split(",").map(Number) : null;
  for (const v of view.split(",")) {
    const out = path.join(OUT, `view-${term}-${v}${crop ? "-crop" : ""}.png`);
    await render({ meshes: ms, frame: makeFrame(ms, v, 600, 0.08, crop), out, title: `${term} ${v}` });
    console.log(out);
  }
} else {
  const [u0, u1, v0, v1, step = "0.02"] = rest.map(Number);
  const frame = makeFrame(ms, view, 640);
  const rows = [];
  let lo = Infinity, hi = -Infinity;
  for (let v = v0; v <= v1 + 1e-9; v += step) {
    const row = [];
    for (let u = u0; u <= u1 + 1e-9; u += step) {
      const { o, d } = frame.ray(u, v);
      const hit = raycast(ms, o, d);
      row.push(hit ? hit.dist : null);
      if (hit) { lo = Math.min(lo, hit.dist); hi = Math.max(hi, hit.dist); }
    }
    rows.push([v, row]);
  }
  console.log(`u=${u0}〜${u1}（${step}ずつ）${mode === "depth" ? `、奥行き ${((hi - lo) * 1000).toFixed(0)} mm` : ""}`);
  for (const [v, row] of rows) {
    const cells = row.map((d) => (d === null ? "." : mode === "depth" ? String(Math.min(9, Math.floor(((d - lo) / (hi - lo || 1)) * 10))) : "#"));
    console.log(`${v.toFixed(2).padStart(5)} ${cells.join("")}`);
  }
}
