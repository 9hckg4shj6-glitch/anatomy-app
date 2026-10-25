// public/icons/icon.svg から、ホーム画面に置くアイコンの PNG を作る。絵を変えたら実行し直す。
// - icon-192 / icon-512: そのままの形（角丸）。PC のブラウザなど
// - apple-touch-icon（180）: iOS は透明な所を黒く塗るので、角を丸めない正方形にする（角は iOS が丸める）
// - maskable-192 / 512: Android は機種ごとの形に切り抜くので、正方形にして絵を中央の安全域（直径80%）に縮める
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DIR = path.resolve(import.meta.dirname, "../public/icons");
const source = fs.readFileSync(path.join(DIR, "icon.svg"), "utf8");
const square = source.replace(/ rx="\d+"/, "");
// 背景の rect（最初の要素）の後ろが絵
const parts = square.match(/^([\s\S]*?<rect[^>]*\/>)([\s\S]*)(<\/svg>\s*)$/);
if (!parts) throw new Error("icon.svg の形が想定と違います（背景の rect → 絵 の順）");
const [, head, drawing, tail] = parts;
const maskable = `${head}\n  <g transform="translate(256 256) scale(0.78) translate(-256 -256)">${drawing}</g>\n${tail}`;

const outputs = [
  ["icon-192.png", source, 192],
  ["icon-512.png", source, 512],
  ["apple-touch-icon.png", square, 180],
  ["maskable-192.png", maskable, 192],
  ["maskable-512.png", maskable, 512],
];
for (const [name, svg, size] of outputs) {
  await sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(DIR, name));
  console.log(`public/icons/${name}`);
}
