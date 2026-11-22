/**
 * 使い方（#/guide）の見本に使う3Dの絵を、アプリの3Dから撮って public/guide/*.webp に書く。docs/普段使い.md「使い方ガイド」。
 *
 *   npm run dev  （別の窓で。表示されたアドレスを GUIDE_URL に）
 *   GUIDE_URL=http://localhost:5173/ PLAYWRIGHT=<playwright の node_modules> node scripts/guide-images.mjs
 *
 * playwright はこのアプリの依存に入れていないので、npx などで入れた所を PLAYWRIGHT で渡す。
 * 撮るもの: 回る骨格（24こまの横並び spin.webp）・大腿骨（femur.webp と光らせた femur-hi.webp。同じ向き）・
 * 進捗の色（progress.webp。色は見本）・心臓（heart.webp）・3D模型の自由に操作（胃を選ぶ前 model-in・選んだ model-pick・外へ出した model-out。同じ向き）
 *
 * GUIDE_ONLY=model のように撮るものを名前（femur・progress・heart・spin・model）で絞れる（コンマで区切る）
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const base = process.env.GUIDE_URL ?? "http://localhost:5173/";
const require = createRequire(`${process.env.PLAYWRIGHT ?? process.cwd()}/`);
const { chromium } = require("playwright");
const OUT = "public/guide";
const only = process.env.GUIDE_ONLY?.split(",");
const want = (name) => !only || only.includes(name);
const wrote = [];
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
if (want("femur")) {
const femur = await shot("await v.show({ systems: ['skeletal'], body: true }); v.hideCompass(true); v.highlight([]); v.overview(false); await new Promise((r) => setTimeout(r, 500)); v.focus('femur', 1.25, false);");
const femurHi = await shot("v.highlight(['femur'], { isolate: true });", 1500);
const { width } = await sharp(femur).metadata();
for (const [buffer, name] of [[femur, "femur"], [femurHi, "femur-hi"]]) {
  await sharp(buffer).extract({ left: width - 1100, top: 60, width: 1100, height: 1375 }).resize(400, 500).webp({ quality: 76 }).toFile(`${OUT}/${name}.webp`);
}
wrote.push("femur", "femur-hi");
}

// 進捗の色（見本。骨ごとに 覚えている・あやしい・忘れかけ・まだ をちらす。色は src/ui/progress.ts の LEVELS）
const body = { left: 380, top: 120, width: 650, height: 1480 };
if (want("progress")) {
const progress = await shot(`v.highlight([]); v.overview(false);
  const colors = ['#3a9d5d', '#e0b43a', '#d0503c', '#d9d4c7'];
  const bones = content.terms.filter((t) => t.system === 'skeletal');
  v.colorTerms(new Map(bones.map((t, i) => { const r = ((i + 1) * 7919) % 17; return [t.id, colors[r < 7 ? 0 : r < 10 ? 1 : r < 12 ? 2 : 3]]; })));`);
await sharp(progress).extract(body).resize(240, 546).webp({ quality: 78 }).toFile(`${OUT}/progress.webp`);
wrote.push("progress");
}

// 心臓（臓器の図の場面）
if (want("heart")) {
const heart = await shot(`v.colorTerms(null); const organ = content.organs.find((o) => o.id === 'heart');
  await v.show({ systems: [...new Set(content.organTerms(organ).map((id) => content.termById.get(id)?.system ?? '').filter(Boolean))], organ: 'heart' });
  v.hideCompass(true); v.viewOrgan([0.35, 0.1, 1], false);`, 5000);
await sharp(heart).extract({ left: 154, top: 80, width: 1150, height: 1150 }).resize(400, 400).webp({ quality: 76 }).toFile(`${OUT}/heart.webp`);
wrote.push("heart");
}

// 回る骨格: 体の縦の軸のまわりに 15° ずつ 24こま
if (want("spin")) {
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
wrote.push("spin");
}

// 3D模型の自由に操作（はじめの組み合わせ「骨と内臓」）: 胃を選ぶ前・選んだ（橙）・外へ出した。同じ向きで、胴を前から、外へ出す側（画面の右）を広めに
if (want("model")) {
  await page.goto(`${base}#/model/free`);
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: ".stage-help, #stage-tools, #stage-hint, #stage > button, .stage-label, .stage-tip { display: none !important; }" });
  const stomach = "FJ2564";
  /** shift: 胃の真ん中から画面の右（本人の左）へずらす量。外へ出すは、押したときの視点の真ん中から見て胃のある側へ出すので、
   * 押すときは胃を少し右に置き（shift < 0）、撮るときは胃と出した先の間を真ん中にする */
  const frame = async (shift = 0.15, distance = 1.1) => {
    await page.evaluate(([id, dx, d]) => {
      const v = window.viewer;
      v.hideCompass(true);
      const [x, y, z] = v.partCenter([id]);
      const target = [x + dx, y + 0.02, z - 0.04];
      v.setView([target, [target[0], target[1] + 0.1, target[2] + d]], false);
    }, [stomach, shift, distance]);
    await page.waitForTimeout(2500);
  };
  const crop = async (buffer, name) => {
    const { width: w, height: h } = await sharp(buffer).metadata();
    const cw = Math.min(w, Math.round(h * (220 / 170)));
    await sharp(buffer).extract({ left: Math.round((w - cw) / 2), top: 0, width: cw, height: h }).resize(440, 340).webp({ quality: 76 }).toFile(`${OUT}/${name}.webp`);
    wrote.push(name);
  };
  await frame();
  await crop(await stage.screenshot(), "model-in");
  await page.evaluate((id) => window.viewer.onPick(id), stomach);
  await page.waitForTimeout(2000);
  await frame();
  await crop(await stage.screenshot(), "model-pick");
  await frame(-0.03);
  await page.getByRole("button", { name: "外へ出す", exact: true }).click();
  await page.waitForTimeout(1500);
  await frame();
  await crop(await stage.screenshot(), "model-out");
}

await browser.close();
console.log(`wrote ${wrote.map((name) => `${OUT}/${name}.webp`).join(", ")}`);
