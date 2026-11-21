/**
 * 動きの図鑑の一覧（#/motions）の絵を、わかりやすい模型の3Dから撮って public/motions/thumbs/<ID>.webp に書く
 * （docs/動きの図鑑.md「品質の見直し」）。模型を作り直したら撮り直す。
 *
 *   npm run dev  （別の窓で。表示されたアドレスを MOTION_URL に）
 *   MOTION_URL=http://localhost:5173/ PLAYWRIGHT=<playwright の node_modules がある所> node scripts/motions/thumbs.mjs
 *
 * playwright はこのアプリの依存に入れていないので、npx などで入れた所を PLAYWRIGHT で渡す（scripts/guide-images.mjs と同じ）。
 * 字幕・札・ボタンは隠し、見せたい時期（3Dの下の字幕の区分）で止めて撮る。横 3：縦 2（一覧のカードの絵の枠）
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const base = process.env.MOTION_URL ?? "http://localhost:5173/";
const require = createRequire(`${process.env.PLAYWRIGHT ?? process.cwd()}/`);
const { chromium } = require("playwright");
const OUT = "public/motions/thumbs";
mkdirSync(OUT, { recursive: true });

/** 撮る動きと、止める区分（字幕の帯の番号。null は再生して 3 秒後に止める）・寄せる倍率 */
const SHOTS = [
  { id: "breathing", span: 1, crop: 0.9 },
  { id: "heartbeat", span: 1, crop: 0.92 },
  { id: "conduction", span: 4, crop: 0.92 },
  { id: "circulation", span: null, crop: 1 },
];

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
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
const HIDE = ".stage-tags, .stage-tools, .stage-hint, .stage-compass, .stage-tip, #stage > button { display: none !important; }";

for (const shot of SHOTS) {
  await page.goto(`${base}#/motions/${shot.id}`);
  await page.reload();
  await page.waitForTimeout(5000);
  if (shot.span === null) {
    await page.waitForTimeout(3000);
    await page.locator(".motion-caption-play").click();
  } else {
    await page.locator(".motion-caption-span").nth(shot.span).click();
  }
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(300);
  const buffer = await page.locator("#stage").screenshot();
  const { width, height } = await sharp(buffer).metadata();
  // 模型は字幕の上に寄せて映しているので、字幕の分（下 12%）を除いた所の真ん中を 3:2 で切る
  const usable = height * 0.88;
  const h = Math.round(Math.min(usable, (width / 1.5)) * shot.crop);
  const w = Math.round(h * 1.5);
  const left = Math.round((width - w) / 2);
  const top = Math.max(0, Math.round((usable - h) / 2));
  await sharp(buffer).extract({ left, top, width: w, height: h }).resize(480, 320).webp({ quality: 78 }).toFile(`${OUT}/${shot.id}.webp`);
  console.log(`${OUT}/${shot.id}.webp`);
}
await browser.close();
