// 語の棚（docs/学びやすさ.md の案1・案3）の元になる content/shelves.json を作る。
// - small: 自分の3Dの形（parts）を持つ語のうち、形の直径（public/models/index.json の radius × 2）が SMALL_MM より小さい語と、その直径（mm）。
//   3Dでは点にしか見えないので、名前→位置（タップ）を出さず、図の棚（臓器の図で学ぶ）に入れる。
// - seePlate: small の語のうち平面図（public/plates/index.json）にラベルのある語と、その図ID。問題ではその図を重ねて番号で問う。
// 使い方: node scripts/shelves.mjs（build:models・plates.mjs のあとで。validate-content が古くないかを確かめる）
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
export const SMALL_MM = 15;

/** 今の内容と3D・平面図から shelves.json の中身を作る */
export function computeShelves() {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, "public/models/index.json"), "utf8"));
  const plates = JSON.parse(fs.readFileSync(path.join(ROOT, "public/plates/index.json"), "utf8")).plates;
  const organs = JSON.parse(fs.readFileSync(path.join(ROOT, "content/organs.json"), "utf8")).organs;
  // 図の並び（臓器の図の順）で、最初にその語のラベルがある図
  const plateOrder = organs.flatMap((organ) => organ.plates.map((plate) => plate.id)).filter((id) => plates[id]);
  const small = {};
  const seePlate = {};
  const dir = path.join(ROOT, "content/terms");
  for (const file of fs.readdirSync(dir).sort()) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    for (const unit of data.units) {
      for (const term of unit.terms) {
        const model = index.terms[term.id];
        if (!model || term.of || !term.parts) continue;
        const mm = Math.round(model.radius * 2 * 1000 * 10) / 10;
        if (mm >= SMALL_MM) continue;
        small[term.id] = mm;
        const plate = plateOrder.find((id) => plates[id].labels.some((label) => label.term === term.id));
        if (plate) seePlate[term.id] = plate;
      }
    }
  }
  return {
    about: `scripts/shelves.mjs が作る。small は3Dの形の直径が ${SMALL_MM}mm より小さい語（mm）、seePlate はそのうち平面図に載っている語の図ID`,
    small,
    seePlate,
  };
}

export const SHELVES_FILE = path.join(ROOT, "content/shelves.json");

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const shelves = computeShelves();
  fs.writeFileSync(SHELVES_FILE, `${JSON.stringify(shelves, null, 2)}\n`);
  console.log(`small ${Object.keys(shelves.small).length}語・そのうち平面図あり ${Object.keys(shelves.seePlate).length}語 → content/shelves.json`);
}
