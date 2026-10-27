// 系統ごとに、語がほかの語に隠れずにどれだけ見えるかを数える（xray を付けるかの目安）。
// アプリの出題と同じく、その系統の語だけを不透明に描き（veil の語は除く）、6方向（前・後ろ・右・左・上・下）から
// 部品の番号で塗った画像を作る。語ごとに「見えている画素 ÷ その語だけを描いたときの画素」の最大を出す。
// 使い方: node scripts/visibility.mjs <系統> [--all]（ふだんは見え方と xray が合わない語だけを出す）
import { basis, loadDb, makeFrame } from "./pins/geometry.mjs";

const system = process.argv[2];
const all = process.argv.includes("--all");
const SIZE = 420;
// これより見えなければ隠れている（xray が要る）、これより見えれば xray は要らないかもしれない
const HIDDEN = 0.08;
const VISIBLE = 0.35;
const VIEWS = {
  ant: { f: [0, 0, -1], u: [0, 1, 0] },
  post: { f: [0, 0, 1], u: [0, 1, 0] },
  right: { f: [1, 0, 0], u: [0, 1, 0] },
  left: { f: [-1, 0, 0], u: [0, 1, 0] },
  sup: { f: [0, -1, 0], u: [0, 0, -1] },
  inf: { f: [0, 1, 0], u: [0, 0, 1] },
};

const { terms, resolved, mesh } = await loadDb({ za: true });
const list = terms.filter((t) => t.system === system && !t.of && t.parts);
if (!list.length) throw new Error(`系統 ${system} の語がありません`);
const shown = list.filter((t) => !t.veil);
const elements = [...new Set(shown.flatMap((t) => resolved.get(t.id)))];
const meshes = elements.map((id) => ({ id, ...mesh(id) }));
const indexOf = new Map(elements.map((id, i) => [id, i]));

/** 部品の番号（+1）で塗った画像。only を渡すとその部品だけ描く */
function rasterize(frame, only = null) {
  const { W, H, toScreen } = frame;
  const depth = new Float32Array(W * H).fill(Infinity);
  const ids = new Int32Array(W * H);
  for (const [i, m] of meshes.entries()) {
    if (only && !only.has(i)) continue;
    const p = m.positions, idx = m.indices;
    const scr = new Float32Array(p.length);
    for (let v = 0; v < p.length; v += 3) scr.set(toScreen([p[v], p[v + 1], p[v + 2]]), v);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const area = (scr[b] - scr[a]) * (scr[c + 1] - scr[a + 1]) - (scr[b + 1] - scr[a + 1]) * (scr[c] - scr[a]);
      if (!area) continue;
      const x0 = Math.max(0, Math.floor(Math.min(scr[a], scr[b], scr[c]))), x1 = Math.min(W - 1, Math.ceil(Math.max(scr[a], scr[b], scr[c])));
      const y0 = Math.max(0, Math.floor(Math.min(scr[a + 1], scr[b + 1], scr[c + 1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(scr[a + 1], scr[b + 1], scr[c + 1])));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((scr[b] - px) * (scr[c + 1] - py) - (scr[b + 1] - py) * (scr[c] - px)) / area;
          const w1 = ((scr[c] - px) * (scr[a + 1] - py) - (scr[c + 1] - py) * (scr[a] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const d = w0 * scr[a + 2] + w1 * scr[b + 2] + w2 * scr[c + 2];
          const k = y * W + x;
          if (d < depth[k]) {
            depth[k] = d;
            ids[k] = i + 1;
          }
        }
      }
    }
  }
  return ids;
}

const best = new Map(list.map((t) => [t.id, 0]));
for (const view of Object.values(VIEWS)) {
  basis(view); // 向きの形を確かめる
  const frame = makeFrame(meshes, view, SIZE, 0.02);
  const scene = rasterize(frame);
  for (const term of shown) {
    const own = new Set(resolved.get(term.id).map((id) => indexOf.get(id)));
    const alone = rasterize(frame, own);
    let total = 0, seen = 0;
    for (let k = 0; k < alone.length; k++) {
      if (!alone[k]) continue;
      total++;
      if (own.has(scene[k] - 1)) seen++;
    }
    // 小さすぎて写らない語（数画素）は、隠れているかを判断しない
    if (total >= 12) best.set(term.id, Math.max(best.get(term.id), seen / total));
  }
}
const rows = [];
for (const term of list) {
  const ratio = best.get(term.id);
  const flag = term.veil ? "veil" : term.xray ? (ratio > VISIBLE ? "xray? 見えている" : "xray") : ratio < HIDDEN ? "隠れている → xray?" : "";
  if (all || flag.includes("?")) rows.push(`${term.id.padEnd(44)} ${term.ja.padEnd(14, "　")} ${(ratio * 100).toFixed(0).padStart(3)}%  ${flag}`);
}
console.log(rows.join("\n") || "見え方と xray が合わない語はありません");
