import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// ピン打ちツール（src/ui/admin.ts）の「保存」を受けて content/pins.json を書きかえる。開発サーバーだけで動く。
function pinWriter(): Plugin {
  return {
    name: "anatomy-pin-writer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__admin/pins", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body) as Record<string, { at?: unknown; r?: unknown }>;
            for (const [id, pin] of Object.entries(data)) {
              if (!/^[a-z0-9-]+$/.test(id) || !Array.isArray(pin.at) || typeof pin.r !== "number") throw new Error(`形が違います: ${id}`);
            }
            fs.writeFileSync(path.resolve(import.meta.dirname, "content/pins.json"), body);
            res.end("ok");
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        });
      });
    },
  };
}

/**
 * 臓器の図（content/organs.json）を2つに分けて読む（2026-11-24 初めの読み込みを軽くする）。
 * virtual:organs-core はほかの画面でも使う所（名前・レッスン・3Dの箱・平面図のIDと名前とラベル）で、はじめの JS に入る。
 * virtual:organs-detail は臓器の図と動きの図鑑だけで使う所（説明・色分け・向き・切り口・平面図の出典・添え書き・要点）で、
 * その画面を開いたときに読む別のファイルになる（src/organ-details.ts）。organs.json は今までどおり1つのまま書く
 */
const ORGAN_CORE = ["id", "ja", "yomi", "en", "units", "with", "around", "box", "plates"];
const PLATE_CORE = ["id", "title", "labels"];

function organSplit(): Plugin {
  const file = path.resolve(import.meta.dirname, "content/organs.json");
  const ids = new Set(["virtual:organs-core", "virtual:organs-detail"]);
  const pick = (object: Record<string, unknown>, keys: string[], keep: boolean) =>
    Object.fromEntries(Object.entries(object).filter(([key]) => key === "id" || keys.includes(key) === keep));
  return {
    name: "anatomy-organ-split",
    resolveId: (id) => (ids.has(id) ? `\0${id}` : null),
    load(id) {
      if (!id.startsWith("\0virtual:organs-")) return null;
      this.addWatchFile(file);
      const { organs } = JSON.parse(fs.readFileSync(file, "utf8")) as { organs: (Record<string, unknown> & { plates: Record<string, unknown>[] })[] };
      const core = id.endsWith("core");
      const data = {
        organs: organs.map((organ) => ({
          ...pick(organ, ORGAN_CORE, core),
          plates: organ.plates.map((plate) => pick(plate, PLATE_CORE, core)),
        })),
      };
      // 大きな JSON は JS の式より JSON.parse の方が速く読める（Vite の JSON の読み込みと同じ）
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(data))});`;
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/anatomy-app/" : "/",
  // three.js（約600KB）と用語データ（2,500語と語根カード）を1つにまとめているため、既定の500KBの警告を上げる。
  // ソースマップは公開版に入れない（5.7MB あった。2026-11-24）。骨学試験・使い方・動きの図鑑・臓器の図は開いたときに読む別のファイル（src/main.ts）
  build: {
    target: "es2022", sourcemap: false, chunkSizeWarningLimit: 3200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // three.js などの部品は、語や図を足しても変わらないので別のファイルに（内容を更新しても取り直さない）
          if (/node_modules\/(three|dexie|ts-fsrs)\//.test(id)) return "vendor";
          // 臓器の図の残りの所（臓器の図と動きの図鑑の両方から読む）
          if (id.includes("virtual:organs-detail")) return "organ-details";
          return undefined;
        },
      },
    },
  },
  test: { environment: "jsdom", globals: true },
  plugins: [
    pinWriter(),
    organSplit(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "からだ見聞録",
        short_name: "からだ見聞録",
        description: "解剖学の用語・位置・英語を3Dとフラッシュカードで覚えるオフライン対応アプリ",
        lang: "ja",
        // 上の帯（.topbar）と同じ色にして、スマホの状態表示の所とつなげる
        theme_color: "#fffdf8",
        background_color: "#f4f1ea",
        display: "standalone",
        start_url: ".",
        categories: ["education", "medical"],
        // アイコンは scripts/build-icons.mjs が public/icons/icon.svg から作る
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        // GLB と音声は数MBになるのでプリキャッシュせず、開いたときに保存する。
        // どちらもファイル名に中身のハッシュが入っている（scripts/build-models.mjs, build-audio.mjs）ので、
        // CacheFirst でも作り直した版が古いまま残ることはない。
        // 臓器の平面図（plates/*.webp、1枚 70〜130KB・計 7.7MB）と使い方の絵（guide/*.webp）も、はじめに全部は保存せず、
        // 開いたときに保存する（2026-11-24。初回の裏の保存が 14MB あり、スマホの回線で重かった）。平面図もファイル名にハッシュが入っている（scripts/plates.mjs）。
        // 平面図のラベルの位置（plates/index.json）はプリキャッシュのまま
        globPatterns: ["**/*.{html,js,css,json,svg,png,webp,woff2}"],
        globIgnores: ["models/*.glb", "audio/*.m4a", "plates/*.webp", "guide/*.webp"],
        // 語の内容（content/terms）と臓器の図（content/organs.json）は JS に入るので、語や図が増えると既定の 2 MiB を超える。
        // 超えるとオフラインで開けなくなる（2026-11-20 に JS が 4.2MB になり 4 MiB を超えたので 6 MiB に）
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/models/") && url.pathname.endsWith(".glb"),
            handler: "CacheFirst",
            options: {
              cacheName: "anatomy-models-v1",
              expiration: { maxEntries: 40 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/plates/") && url.pathname.endsWith(".webp"),
            handler: "CacheFirst",
            options: {
              cacheName: "anatomy-plates-v1",
              expiration: { maxEntries: 400 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // 使い方の絵はファイル名にハッシュが無いので、新しい版があれば裏で取り直す
            urlPattern: ({ url }) => url.pathname.includes("/guide/") && url.pathname.endsWith(".webp"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "anatomy-guide-v1",
              expiration: { maxEntries: 40 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/audio/"),
            handler: "CacheFirst",
            options: {
              cacheName: "anatomy-audio-v1",
              expiration: { maxEntries: 3000 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ]
});
