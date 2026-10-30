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

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/anatomy-app/" : "/",
  // three.js（約600KB）と用語データ（1,045語と語根カード）を1つにまとめているため、既定の500KBの警告を上げる（圧縮後は約390KB）
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 1600 },
  test: { environment: "jsdom", globals: true },
  plugins: [
    pinWriter(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "解剖学 3D単語帳",
        short_name: "解剖3D",
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
        globPatterns: ["**/*.{html,js,css,json,svg,png,woff2}"],
        globIgnores: ["models/*.glb", "audio/*.m4a"],
        // 語の内容（content/terms）は JS に入るので、語が増えると既定の 2 MiB を超える。超えるとオフラインで開けなくなる
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
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
