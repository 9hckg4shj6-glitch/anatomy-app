// 向きの問い方（content/directions.json）の、骨格系でない組（臓器・血管・神経・筋）の2つの位置 at を3Dの形から求めて書きこむ。
// 位置は、語の部品の頂点のうち box（[[最小], [最大]] m）の中にあるものの外接箱の中心（box が無ければ部品全体）。
// 長い血管や神経は、box でその高さ・その場所の断面だけにして比べる（大動脈と下大静脈は腎静脈の高さで、など）。
// 骨の部位（ピンのある語）はピンの中心。box が無ければ、右・左の答えは部品をすべて、ほかは右の部品だけ使う。
// 最後に、答えの向きが位置の差のいちばん強い成分で、2番目の成分がその 0.7 倍以下かを表にする（validate-content と同じ決まり）。
// 使い方: node scripts/directions.mjs（語やピンや box を変えたら実行する）
import fs from "node:fs";
import path from "node:path";
import { loadDb, termMeshes, usesZa } from "./pins/geometry.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const file = path.join(ROOT, "content/directions.json");
const json = JSON.parse(fs.readFileSync(file, "utf8"));
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "content/pins.json"), "utf8"));
const DIR_AXIS = { superior: [1, 1], inferior: [1, -1], anterior: [2, 1], posterior: [2, -1], medial: [0, 1], lateral: [0, -1], right: [0, -1], left: [0, 1] };

const { terms } = await loadDb();
const system = new Map(terms.map((t) => [t.id, t.system]));
const placed = json.facts.filter((fact) => fact.box || system.get(fact.term) !== "skeletal" || system.get(fact.than) !== "skeletal");
await loadDb({ za: usesZa(placed.flatMap((fact) => [fact.term, fact.than])) });

const round = (v) => v.map((x) => Math.round(x * 10000) / 10000);

function placeOf(id, fact) {
  if (pins[id]) return round([0, 1, 2].map((k) => pins[id].at.reduce((sum, p) => sum + p[k], 0) / pins[id].at.length));
  // 左右の部品がある語（腎臓など）だけ右を使う。左心房のように片側だけの語は名前に left があってもそのまま
  let meshes = termMeshes(id, "all");
  const right = meshes.filter((m) => !/\bleft\b/i.test(m.name));
  if (!fact.box && fact.dir !== "right" && fact.dir !== "left" && right.length && right.length < meshes.length) meshes = right;
  const [lo, hi] = fact.box ?? [[-Infinity, -Infinity, -Infinity], [Infinity, Infinity, Infinity]];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of meshes) {
    for (let v = 0; v < positions.length; v += 3) {
      const p = [positions[v], positions[v + 1], positions[v + 2]];
      if (p.some((x, k) => x < lo[k] || x > hi[k])) continue;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
  }
  if (min[0] === Infinity) throw new Error(`${fact.term}: 「${id}」の形が box の中にありません`);
  return round(min.map((x, k) => (x + max[k]) / 2));
}

let bad = 0;
for (const fact of placed) {
  fact.at = [placeOf(fact.term, fact), placeOf(fact.than, fact)];
  const [a, b] = fact.at.map((p) => (fact.dir === "medial" || fact.dir === "lateral" ? [-Math.abs(p[0]), p[1], p[2]] : p));
  const v = a.map((x, k) => x - b[k]);
  const [first, second] = [0, 1, 2].sort((i, j) => Math.abs(v[j]) - Math.abs(v[i]));
  const [axis, sign] = DIR_AXIS[fact.dir];
  const ok = first === axis && Math.sign(v[axis]) === sign && Math.abs(v[second]) <= Math.abs(v[first]) * 0.7;
  if (!ok) bad++;
  console.log(`${ok ? "  " : "✗ "}${fact.term} は ${fact.than} の ${fact.dir}  差 ${v.map((x) => Math.round(x * 1000)).join(", ")} mm`);
}

// at は1行に収める（ほかの件と同じ見た目にする）
const lines = json.facts.map((fact) => `    ${JSON.stringify(fact).replace(/^\{/, "{ ").replace(/\}$/, " }").replace(/","/g, "\", \"").replace(/":/g, "\": ").replace(/,"/g, ", \"")}`);
fs.writeFileSync(file, `{\n  "facts": [\n${lines.join(",\n")}\n  ]\n}\n`);
console.log(`${placed.length}件の位置を書きこんだ。${bad ? `${bad}件は向きが合わない` : "すべて合う"}`);
