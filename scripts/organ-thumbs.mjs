/**
 * 臓器の図の一覧（#/organs。src/ui/organs.ts）の小さな絵を、臓器ごとの最初の平面図（public/plates の絵がある図）から作って
 * public/organs/<臓器ID>.webp に書く（docs/普段使い.md「画面の分かりにくさの見直し」）。
 *
 *   node scripts/organ-thumbs.mjs
 *
 * 平面図の地の色（#fbf8f0）の余白を詰め、横 3：縦 2 の枠に収める。平面図の無い臓器（肺区域）は作らない（一覧では「立体だけ」の絵）。
 * 平面図を足したり作り直したり（scripts/plates.mjs）、臓器の平面図の並びを変えたりしたら作り直す。
 */
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public/organs");
/** 絵の大きさ（一覧の1枚はスマホで約 170×113px。2倍の細かさで） */
const WIDTH = 360;
const HEIGHT = 240;
const BACKGROUND = { r: 251, g: 248, b: 240 };

const { organs } = JSON.parse(readFileSync(path.join(ROOT, "content/organs.json"), "utf8"));
const index = JSON.parse(readFileSync(path.join(ROOT, "public/plates/index.json"), "utf8")).plates;

mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) if (file.endsWith(".webp")) rmSync(path.join(OUT, file));

let made = 0;
for (const organ of organs) {
  const plate = organ.plates.find((item) => index[item.id]?.url);
  if (!plate) {
    console.log(`${organ.id}: 平面図が無いので作らない`);
    continue;
  }
  const source = path.join(ROOT, "public", index[plate.id].url);
  // 地の色の余白を切ってから、枠に収める（余白は地の色で埋める）
  const trimmed = await sharp(source).trim({ background: BACKGROUND, threshold: 12 }).toBuffer();
  await sharp(trimmed)
    .resize(WIDTH - 24, HEIGHT - 24, { fit: "contain", background: BACKGROUND })
    .extend({ top: 12, bottom: 12, left: 12, right: 12, background: BACKGROUND })
    .webp({ quality: 72 })
    .toFile(path.join(OUT, `${organ.id}.webp`));
  made++;
}
console.log(`作った絵 ${made} / 臓器 ${organs.length}`);
