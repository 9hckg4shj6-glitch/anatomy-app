/**
 * 出題で語を映す向きを測って content/point-views.json に書く（src/point-views.ts。docs/普段使い.md「押しにくさの見直し」）。
 *
 *   npm run dev  （別の窓で。表示されたアドレスを POINT_URL に）
 *   POINT_URL=http://localhost:5173/ PLAYWRIGHT=<playwright の node_modules> node scripts/point-views.mjs [手分けするページの数（初めは4）]
 *
 * playwright はこのアプリの依存に入れていないので、npx などで入れた所を PLAYWRIGHT で渡す（scripts/guide-images.mjs と同じ）。
 *
 * 名前→位置を出す語（xray・small・図の語・平面図の語を除く）ごとに、ふつうの向き（語は正面か語に書いた from、骨・器官の部位は
 * 正面やや右上）と VIEW_DIRECTIONS の10の向きから、出題と同じ場面・近さ（スマホ 390×844 の3D）で映し、その語のまわりに格子状に
 * アプリのタップ判定（viewer.pick）を当てて、正解になる面（画素²）を数える。いちばん広い向きが、ふつうの向きより
 * 1.5倍以上かつ 150 画素²以上広ければ、その向きを書く（ふつうの向きで 44×44 画素以上ある語は、押しやすいので書かない）。
 * 3Dのモデル・ピン・場面（sceneFor）・語の from を変えたら測り直す。
 * 一部の系統のモデルだけを変えたときは POINT_SCENES=digestive,urogenital（その系統が出る場面の語）や POINT_IDS=kidney,ureter（その語）で
 * 測る語を絞れる。そのときは測った語だけを content/point-views.json に書き換える（ほかの語の向きは残す）。
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = process.env.POINT_URL ?? "http://localhost:5173/";
const require = createRequire(`${process.env.PLAYWRIGHT ?? process.cwd()}/`);
const { chromium } = require("playwright");
const workers = Number(process.argv[2] ?? 4);
/** 試すときに測る語の数（0 は全部。試したときは content/point-views.json を書かない） */
const limit = Number(process.env.POINT_LIMIT ?? 0);
/** 試すときに測る系統（空なら全部） */
const only = process.env.POINT_SYSTEM ?? "";
/** 測り直す語を、その系統が場面に出る語（POINT_SCENES）や語の ID（POINT_IDS）で絞る。測った語だけを書き換える */
const scenes = (process.env.POINT_SCENES ?? "").split(",").filter(Boolean);
const ids = (process.env.POINT_IDS ?? "").split(",").filter(Boolean);
const partial = scenes.length > 0 || ids.length > 0;
const OUT = path.resolve(import.meta.dirname, "../content/point-views.json");
/** ふつうの向きより何倍・何画素²広ければ向きを替えるか */
const RATIO = 1.5;
const MIN_GAIN = 150;
/** ふつうの向きでこれだけ（指で押しやすい目安の 44×44 画素）あれば、向きは替えない */
const EASY = 44 * 44;

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

/** 1つのページで、語の一覧のうち i 番目から workers ごとに測る */
async function measure(part) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ja-JP" });
  // 測るだけなので外へは送らない（名前と所属の送信など）
  await context.route("**/*", (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  // 開発サーバーの変更の知らせ（HMR）はつながない。重い計算の間に接続が切れると、つながり直したときにページが読み直されて測った分が消える
  await context.routeWebSocket(/.*/, () => {});
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror", String(error)));
  page.on("console", (message) => { if (message.type() === "log") console.log(`[${part}] ${message.text()}`); });
  // 何も描かない画面で3Dだけを使う
  await page.goto(`${base}#/credits`);
  await page.waitForFunction(() => !!window.viewer, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  return page.evaluate(async ({ part, workers, limit, only, scenes, ids, RATIO, MIN_GAIN, EASY }) => {
    const { terms, pins, isDrawn } = await import("/src/content.ts");
    const { facetsFor } = await import("/src/study.ts");
    const { sceneFor } = await import("/src/ui/context.ts");
    const { hitsPin } = await import("/src/landmarks.ts");
    const { VIEW_DIRECTIONS, TERM_DEFAULT, LANDMARK_DEFAULT } = await import("/src/point-views.ts");
    const viewer = window.viewer;
    const index = viewer.index;
    // 光線の判定を速くする（このページの中だけ。three-mesh-bvh で部品ごとに当たり判定の木を作る。当たる所はアプリと同じ）。
    // 筋や血管の場面は部品が多く、そのままでは1語に数十秒かかる
    const bvh = await import("/node_modules/three-mesh-bvh/src/index.js");
    let patched = false;
    const accelerate = () => {
      for (const mesh of viewer.meshes.values()) {
        if (!patched) {
          Object.getPrototypeOf(mesh).raycast = bvh.acceleratedRaycast;
          patched = true;
        }
        if (!mesh.geometry.boundsTree) mesh.geometry.boundsTree = new bvh.MeshBVH(mesh.geometry, { indirect: true });
      }
    };
    // スマホでは3Dの上に説明の欄が重なっている（たたんである）ので、3Dを出す
    document.querySelector(".layout").classList.remove("stage-folded");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const V = viewer.camera.position.constructor;
    const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // 出題で名前→位置を出す語（quiz.ts: xray・small・図の語は位置当てに替わる）
    const list = terms.filter((t) => facetsFor(t).includes("point") && !t.xray && !t.small && !isDrawn(t) && index.terms[t.id] && (!t.of || pins[t.id]));
    const inScene = (t) => {
      const scene = sceneFor(t.system, t.unit);
      return [...scene.systems, ...(scene.context ?? [])].some((system) => scenes.includes(system));
    };
    const chosen = list.filter((t) => (!only || t.system === only) && (!scenes.length && !ids.length || (scenes.length && inScene(t)) || ids.includes(t.id)));
    if (part === 0) console.log(`[0] 測る語 ${chosen.length}`);
    const mine = (limit ? chosen.slice(0, limit) : chosen).filter((_, i) => i % workers === part);
    const views = {};
    for (const [n, term] of mine.entries()) {
      const landmark = !!term.of;
      await viewer.show(sceneFor(term.system, term.unit));
      accelerate();
      const own = new Set(index.terms[term.id].elements);
      const correct = (hit) => !!hit && own.has(hit.element) && (!landmark || hitsPin(hit.point, pins[term.id]));
      /** その向きから出題と同じに映して、正解になる面（画素²） */
      const score = async (from) => {
        if (landmark) {
          viewer.only([term.id]);
          viewer.focusWhole(term.id, 1.3, false, from);
        } else {
          viewer.highlight([]);
          viewer.focus(term.id, 7, false, undefined, from);
        }
        viewer.controls.update();
        await frames();
        viewer.camera.updateMatrixWorld();
        // 答えの画面の上の範囲（部品の箱の角、骨・器官の部位はピンの点と半径）
        const corners = [];
        if (landmark) {
          const pin = pins[term.id];
          const centers = pin.region ? [pin.region.c] : pin.at;
          const r = pin.region ? pin.region.r : pin.r;
          for (const c of centers) for (const dx of [-r, r]) for (const dy of [-r, r]) for (const dz of [-r, r]) corners.push(new V(c[0] + dx, c[1] + dy, c[2] + dz));
        } else {
          for (const element of own) {
            const mesh = viewer.meshes.get(element);
            if (!mesh) continue;
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            const { min, max } = mesh.geometry.boundingBox;
            for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners.push(new V(x, y, z).applyMatrix4(mesh.matrixWorld));
          }
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const corner of corners) {
          const s = corner.clone().project(viewer.camera);
          if (s.z > 1) continue;
          const sx = rect.left + ((s.x + 1) / 2) * rect.width, sy = rect.top + ((1 - s.y) / 2) * rect.height;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        x0 = Math.max(rect.left, x0); y0 = Math.max(rect.top, y0); x1 = Math.min(rect.right, x1); y1 = Math.min(rect.bottom, y1);
        if (!(x1 > x0 && y1 > y0)) return 0;
        const step = Math.max(2, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / 200)));
        let hits = 0;
        for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (correct(viewer.pick(x, y, false))) hits++;
        return hits * step * step;
      };
      const usual = await score(landmark ? LANDMARK_DEFAULT : term.from ?? TERM_DEFAULT);
      let best = { name: "", px: usual };
      for (const [name, from] of Object.entries(VIEW_DIRECTIONS)) {
        const px = await score([...from]);
        if (px > best.px) best = { name, px };
      }
      if (best.name && usual < EASY && best.px >= usual * RATIO && best.px - usual >= MIN_GAIN) views[term.id] = { name: best.name, usual, best: best.px };
      if ((n + 1) % 100 === 0) console.log(`${n + 1}/${mine.length}`);
    }
    return { total: mine.length, measured: mine.map((t) => t.id), views };
  }, { part, workers, limit, only, scenes, ids, RATIO, MIN_GAIN, EASY }).finally(() => context.close());
}

const started = Date.now();
const results = await Promise.all(Array.from({ length: workers }, (_, part) => measure(part)));
await browser.close();
const measured = Object.assign({}, ...results.map((result) => result.views));
let views = Object.fromEntries(Object.keys(measured).sort().map((id) => [id, measured[id].name]));
if (partial) {
  // 測った語だけを書き換える（測った語で向きを替えなくなった語は消す）
  const again = new Set(results.flatMap((result) => result.measured));
  const before = JSON.parse(readFileSync(OUT, "utf8")).views;
  const kept = Object.entries(before).filter(([id]) => !again.has(id));
  const changed = [...again].filter((id) => before[id] !== views[id]).map((id) => `${id}: ${before[id] ?? "ふつう"} → ${views[id] ?? "ふつう"}`);
  console.log(`向きの変わった語 ${changed.length}${changed.length ? `\n  ${changed.join("\n  ")}` : ""}`);
  const merged = Object.fromEntries([...kept, ...Object.entries(views)]);
  views = Object.fromEntries(Object.keys(merged).sort().map((id) => [id, merged[id]]));
}
if (!limit && !only) writeFileSync(OUT, `${JSON.stringify({ views }, null, 2)}\n`);
const total = results.reduce((sum, result) => sum + result.total, 0);
const counts = {};
for (const name of Object.values(views)) counts[name] = (counts[name] ?? 0) + 1;
console.log(`測った語 ${total}、向きを替える語 ${Object.keys(views).length}（${JSON.stringify(counts)}）、${Math.round((Date.now() - started) / 1000)}秒`);
// 確かめ用に、ふつうの向きと替えた向きの面積も残す（リポジトリには入れない）
writeFileSync(path.join(process.env.POINT_REPORT_DIR ?? process.cwd(), "point-views-report.json"), JSON.stringify(measured, null, 1));
