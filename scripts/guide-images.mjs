/**
 * 使い方（#/guide）の見本に使う3Dの絵を、アプリの3Dから撮って public/guide/*.webp に書く。docs/普段使い.md「使い方ガイド」。
 *
 *   npm run dev  （別の窓で。表示されたアドレスを GUIDE_URL に）
 *   GUIDE_URL=http://localhost:5173/ PLAYWRIGHT=<playwright の node_modules> node scripts/guide-images.mjs
 *
 * playwright はこのアプリの依存に入れていないので、npx などで入れた所を PLAYWRIGHT で渡す。
 * 撮るもの: 回る骨格（24こまの横並び spin.webp）・大腿骨（femur.webp と光らせた femur-hi.webp。同じ向き）・
 * 進捗の色（progress.webp。色は見本）・心臓（heart.webp）
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const base = process.env.GUIDE_URL ?? "http://localhost:5173/";
const require = createRequire(`${process.env.PLAYWRIGHT ?? process.cwd()}/`);
const { chromium } = require("playwright");
const OUT = "public/guide";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
// スタート画面を出さないよう、見本の名前と所属・コースを入れてから開く（この撮影用のブラウザの中だけ）
await page.goto(`${base}#/credits`);
await page.waitForTimeout(3000);
await page.evaluate(() => new Promise((resolve) => {
  const request = indexedDB.open("anatomy-study-v1");
  request.onsuccess = () => {
    const tx = request.result.transaction("settings", "readwrite");
    const store = tx.objectStore("settings");
    const now = new Date().toISOString();
    store.put({ key: "profile", value: { name: "見本", university: "その他", faculty: "その他", grade: "その他", savedAt: now, sentAt: now }, updatedAt: now });
    store.put({ key: "course", value: "standard", updatedAt: now });
    tx.oncomplete = resolve;
  };
}));
await page.reload();
await page.waitForTimeout(5000);
await page.addStyleTag({ content: ".stage-help, #stage-tools, #stage-hint, #stage > button { display: none !important; }" });
const stage = page.locator("#stage");
/** 3Dを動かして待ち、3Dの所だけを撮る（window.viewer は開発時だけある。src/main.ts） */
const shot = async (code, wait = 3000) => {
  await page.evaluate(async (body) => {
    const content = await import("/src/content.ts");
    await new Function("v", "content", `return (async () => { ${body} })()`)(window.viewer, content);
  }, code);
  await page.waitForTimeout(wait);
  return stage.screenshot();
};

// 大腿骨（光らせる前と後を同じ向きで）
const femur = await shot("await v.show({ systems: ['skeletal'], body: true }); v.hideCompass(true); v.highlight([]); v.overview(false); await new Promise((r) => setTimeout(r, 500)); v.focus('femur', 1.25, false);");
const femurHi = await shot("v.highlight(['femur'], { isolate: true });", 1500);
const { width } = await sharp(femur).metadata();
for (const [buffer, name] of [[femur, "femur"], [femurHi, "femur-hi"]]) {
  await sharp(buffer).extract({ left: width - 1100, top: 60, width: 1100, height: 1375 }).resize(400, 500).webp({ quality: 76 }).toFile(`${OUT}/${name}.webp`);
}

// 進捗の色（見本。骨ごとに 覚えている・あやしい・忘れかけ・まだ をちらす。色は src/ui/progress.ts の LEVELS）
const body = { left: 380, top: 120, width: 650, height: 1480 };
const progress = await shot(`v.highlight([]); v.overview(false);
  const colors = ['#3a9d5d', '#e0b43a', '#d0503c', '#d9d4c7'];
  const bones = content.terms.filter((t) => t.system === 'skeletal');
  v.colorTerms(new Map(bones.map((t, i) => { const r = ((i + 1) * 7919) % 17; return [t.id, colors[r < 7 ? 0 : r < 10 ? 1 : r < 12 ? 2 : 3]]; })));`);
await sharp(progress).extract(body).resize(240, 546).webp({ quality: 78 }).toFile(`${OUT}/progress.webp`);

// 心臓（臓器の図の場面）
const heart = await shot(`v.colorTerms(null); const organ = content.organs.find((o) => o.id === 'heart');
  await v.show({ systems: [...new Set(content.organTerms(organ).map((id) => content.termById.get(id)?.system ?? '').filter(Boolean))], organ: 'heart' });
  v.hideCompass(true); v.viewOrgan([0.35, 0.1, 1], false);`, 5000);
await sharp(heart).extract({ left: 154, top: 80, width: 1150, height: 1150 }).resize(400, 400).webp({ quality: 76 }).toFile(`${OUT}/heart.webp`);

// 回る骨格: 体の縦の軸のまわりに 15° ずつ 24こま
await shot("await v.show({ systems: ['skeletal'], body: true }); v.hideCompass(true); v.highlight([]); v.overview(false);");
const [target, position] = await page.evaluate(() => window.viewer.view);
const dx = position[0] - target[0], dz = position[2] - target[2];
const frames = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  const next = [target[0] + dx * Math.cos(a) + dz * Math.sin(a), position[1], target[2] - dx * Math.sin(a) + dz * Math.cos(a)];
  await page.evaluate(([t, p]) => window.viewer.setView([t, p], false), [target, next]);
  await page.waitForTimeout(700);
  frames.push(await sharp(await stage.screenshot()).extract(body).resize(240, 546).toBuffer());
}
await sharp({ create: { width: 240 * 24, height: 546, channels: 3, background: "#2a2e36" } })
  .composite(frames.map((input, i) => ({ input, left: 240 * i, top: 0 })))
  .webp({ quality: 72 }).toFile(`${OUT}/spin.webp`);

await browser.close();
console.log(`wrote ${OUT}/spin.webp, femur.webp, femur-hi.webp, progress.webp, heart.webp`);
