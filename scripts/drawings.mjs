// 骨学試験 D（図示）の図の確認。content/exam.json の drawings を、アプリと同じ向きで骨を描き、番号と名前を重ねて
// data-raw/pin-check/drawing-<ID>.png に出す（骨の陰に隠れる番号は灰色）。番号の点を骨の上に打つための光線も出せる。
// node scripts/drawings.mjs [ID,ID]            → 図を描く（ID を省くと全部）
// node scripts/drawings.mjs ray <ID> u,v [u,v]  → 図の枠の中の割合（左上が 0,0。画像の格子の 1〜9 が 0.1〜0.9）で骨に当てた点と面の向き
import fs from "node:fs";
import path from "node:path";
import { loadDb, makeFrame, raycast, render, termMeshes, norm } from "./pins/geometry.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "data-raw/pin-check");
const exam = JSON.parse(fs.readFileSync(path.join(ROOT, "content/exam.json"), "utf8"));
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "content/pins.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "public/models/index.json"), "utf8"));
const termsById = new Map();
for (const file of fs.readdirSync(path.join(ROOT, "content/terms"))) {
  for (const unit of JSON.parse(fs.readFileSync(path.join(ROOT, "content/terms", file), "utf8")).units) for (const term of unit.terms) termsById.set(term.id, term);
}

/** 図の向き（カメラを置く向き。右側の骨で lat＝外から・med＝内から）。真上・真下からは前が画面の上に来るよう少し傾ける（src/exam.ts と同じ） */
const DRAWING_VIEWS = {
  ant: [0, 0, 1], post: [0, 0, -1], lat: [-1, 0, 0], med: [1, 0, 0], sup: [0, 1, -0.12], inf: [0, -1, 0.12],
};

const fromOf = (view) => norm(Array.isArray(view) ? view : DRAWING_VIEWS[view]);

/** 番号の点（src/exam.ts の drawingMarks と同じ決め方）: 点を書いた印はその点、ピンのある語はピンの中心、骨の語は形の中心 */
function markPoint(mark) {
  if (typeof mark !== "string" && mark.at) return mark.at;
  const id = typeof mark === "string" ? mark : mark.term;
  const pin = pins[id];
  if (pin) return [0, 1, 2].map((k) => pin.at.reduce((sum, p) => sum + p[k], 0) / pin.at.length);
  return index.terms[id]?.center;
}

function markName(mark) {
  if (typeof mark !== "string" && mark.ja) return mark.ja;
  return termsById.get(typeof mark === "string" ? mark : mark.term)?.ja ?? "?";
}

function meshesOf(item) {
  const side = item.side === "mid" ? "all" : "right";
  let ms = item.bones.flatMap((id) => termMeshes(id, side));
  if (item.cut) {
    // 切って取り除く側の三角形を除く（重心で決める）
    const k = "xyz".indexOf(item.cut.axis);
    ms = ms.map((m) => {
      const keep = [];
      for (let t = 0; t < m.indices.length; t += 3) {
        const c = (m.positions[m.indices[t] * 3 + k] + m.positions[m.indices[t + 1] * 3 + k] + m.positions[m.indices[t + 2] * 3 + k]) / 3;
        if ((c - item.cut.at) * item.cut.keep >= 0) keep.push(m.indices[t], m.indices[t + 1], m.indices[t + 2]);
      }
      return { ...m, indices: keep };
    });
  }
  return ms;
}

/** 枠: 骨全体、fit: "marks" なら番号の点のまわり */
function frameOf(item, ms) {
  const f = fromOf(item.view).map((v) => -v);
  const view = { f, u: [0, 1, 0] };
  if (item.fit !== "marks") return makeFrame(ms, view, 900, 0.1);
  const points = item.marks.map(markPoint).filter(Boolean);
  return makeFrame([{ positions: points.flat() }], view, 900, 0.35);
}

const args = process.argv.slice(2);
await loadDb();
fs.mkdirSync(OUT, { recursive: true });

if (args[0] === "ray") {
  const item = exam.drawings.find((d) => d.id === args[1]);
  const ms = meshesOf(item);
  const frame = frameOf(item, ms);
  for (const spec of args.slice(2)) {
    const [u, v] = spec.split(",").map(Number);
    const { o, d } = frame.ray(u, v);
    // どの部品に当たったかも出す（眼窩の壁の骨を確かめる）
    const hits = ms.map((m) => ({ m, hit: raycast([m], o, d) })).filter((x) => x.hit).sort((a, b) => a.hit.dist - b.hit.dist);
    const best = hits[0];
    console.log(spec, best ? `${JSON.stringify({ at: best.hit.point.map((x) => +x.toFixed(4)), n: best.hit.normal.map((x) => +x.toFixed(2)) })} ${best.m.name}` : "外れ");
  }
} else {
  const wanted = args[0]?.split(",");
  for (const item of exam.drawings ?? []) {
    if (wanted && !wanted.includes(item.id)) continue;
    const ms = meshesOf(item);
    const frame = frameOf(item, ms);
    const moved = [];
    const hidden = [];
    const spots = item.marks.map((mark, i) => {
      let at = markPoint(mark);
      if (!at) throw new Error(`${item.id}: ${JSON.stringify(mark)} の点が無い`);
      // アプリと同じく、点の手前にその語の骨の面があれば（ピンが骨の裏・中にある、骨の語の中心）その面へ番号を移す
      const id = typeof mark === "string" ? mark : mark.at ? null : mark.term;
      if (id) {
        const own = new Set(termMeshes(id, "all").map((m) => m.id));
        const hit = raycast(ms.filter((m) => own.has(m.id)), at.map((x, k) => x - frame.f[k] * 2), frame.f);
        if (hit && hit.dist < 2 - 0.002) {
          at = hit.point;
          moved.push(i + 1);
        }
      }
      // ほかの骨の陰になるか
      const block = raycast(ms, at.map((x, k) => x - frame.f[k] * 2), frame.f);
      if (block && block.dist < 2 - 0.003) hidden.push(i + 1);
      return { at: [at], r: 0.002, color: "#d9480f", label: `${i + 1} ${markName(mark)}` };
    });
    const out = path.join(OUT, `drawing-${item.id}.png`);
    await render({ meshes: ms, spots, frame, out, title: `${item.title}  ${item.marks.length}か所` });
    console.log(out, moved.length ? `手前の面へ: ${moved.join(",")}` : "", hidden.length ? `隠れる: ${hidden.join(",")}` : "");
  }
}

