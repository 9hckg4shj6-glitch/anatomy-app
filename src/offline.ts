import { loadAudioManifest } from "./audio";
import type { ModelIndex } from "./content";

/**
 * オフライン用にまとめて保存する。GLB と音声はふだん開いたときに Service Worker が保存する（vite.config.ts の CacheFirst）ので、
 * ここでもページから fetch するだけにして、Service Worker に同じように保存させる（期限の管理もそちらに任せる）。
 */
export interface OfflineFile {
  url: string;
  /** 大きさ（音声は分からないので平均で見積もる） */
  bytes: number;
  /** 3Dなら系統ID、音声なら "audio" */
  group: string;
}

/** 音声1つのおおよその大きさ（全部で約34MB・約1,760語） */
const AUDIO_BYTES = 19_500;

export async function offlineFiles(index: ModelIndex): Promise<OfflineFile[]> {
  const base = import.meta.env.BASE_URL;
  const models = Object.entries(index.systems).flatMap(([id, system]) => [
    { url: `${base}${system.url}`, bytes: system.bytes, group: id },
    ...(system.za ? [{ url: `${base}${system.za.url}`, bytes: system.za.bytes, group: id }] : []),
  ]);
  const audio = Object.values(await loadAudioManifest()).map((file) => ({ url: `${base}${file}`, bytes: AUDIO_BYTES, group: "audio" }));
  return [...models, ...audio];
}

/** Service Worker が動いていれば保存できる（http の LAN や開発サーバーでは動かない） */
export function canSaveOffline(): boolean {
  return !!navigator.serviceWorker?.controller && "caches" in window;
}

/** 保存済みのファイルの url */
export async function savedFiles(files: OfflineFile[]): Promise<Set<string>> {
  if (!("caches" in window)) return new Set();
  const saved = await Promise.all(files.map(async (file) => ((await caches.match(file.url)) ? file.url : null)));
  return new Set(saved.filter((url): url is string => !!url));
}

/** まだのファイルを4つずつ取りに行く。進み具合を返し、signal でやめる */
export async function saveFiles(files: OfflineFile[], onProgress: (done: number, bytes: number) => void, signal: AbortSignal): Promise<number> {
  let next = 0;
  let done = 0;
  let bytes = 0;
  let failed = 0;
  const worker = async () => {
    while (next < files.length && !signal.aborted) {
      const file = files[next++];
      try {
        const response = await fetch(file.url, { signal });
        await response.arrayBuffer();
        if (!response.ok) failed++;
      } catch (error) {
        if (signal.aborted) return;
        failed++;
      }
      done++;
      bytes += file.bytes;
      onProgress(done, bytes);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return failed;
}
