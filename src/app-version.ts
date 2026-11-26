/**
 * アプリの版と、最新版への更新（設定の「アプリの版」）。2026-11-26 追加。
 * 内容をこまめに直して公開すると、ホーム画面のアプリは前の版を Service Worker から開き続け、なかなか切りかわらない。
 * そこで、ビルドごとの版（vite.config.ts の __APP_BUILD__ と dist/version.json）を公開先と比べ、ボタンで取りに行けるようにする。
 *
 * 更新の順: ① Service Worker に新しい版を確かめさせ（registration.update）、入れかわったら読み直す（skipWaiting・clientsClaim は
 * vite-plugin-pwa の autoUpdate が入れる）。② それで切りかわらなければ、Service Worker を外して、保存した画面とプログラム
 * （workbox の precache）だけを消し、ブラウザの控えを通らない URL で開き直す。3D・平面図・音声の保存（ファイル名に中身のハッシュ入り）は消さない
 */
export interface BuildInfo {
  commit: string;
  builtAt: string;
}

export const currentBuild: BuildInfo = __APP_BUILD__;

/** 開き直したときに付ける印（ブラウザや GitHub Pages の控えを通らないように）。開いたら消す */
const FRESH = "fresh";

export const sameBuild = (a: BuildInfo, b: BuildInfo): boolean => a.commit === b.commit && a.builtAt === b.builtAt;

/** 「2026/11/26 14:05」（日本の時刻） */
export function buildLabel(build: BuildInfo): string {
  const date = new Date(build.builtAt);
  if (Number.isNaN(date.getTime())) return build.commit;
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

/** 公開先の最新版。通信できないときや開発サーバー（version.json が無い）では null */
export async function fetchLatestBuild(signal?: AbortSignal): Promise<BuildInfo | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store", signal });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<BuildInfo>;
    return typeof data.commit === "string" && typeof data.builtAt === "string" ? { commit: data.commit, builtAt: data.builtAt } : null;
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Service Worker が入れかわるのを待つ（新しい版のプログラムを全部取ってから入れかわるので、少しかかる） */
async function waitForNewWorker(registration: ServiceWorkerRegistration, ms: number): Promise<boolean> {
  const container = navigator.serviceWorker;
  return new Promise((resolve) => {
    const done = (value: boolean) => {
      clearTimeout(timer);
      container.removeEventListener("controllerchange", changed);
      resolve(value);
    };
    const changed = () => done(true);
    const timer = setTimeout(() => done(false), ms);
    container.addEventListener("controllerchange", changed);
    // 待っている新しい版がもうあれば、すぐ入れかえる
    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  });
}

/** 保存した画面とプログラムを消して、控えを通らない URL で開き直す */
export async function reloadFresh(): Promise<void> {
  const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  try {
    const registrations = (await container?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // 外せなくても開き直す
  }
  if ("caches" in window) {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("workbox-precache")).map((name) => caches.delete(name)));
    } catch {
      // 消せなくても開き直す
    }
  }
  const url = new URL(location.href);
  url.searchParams.set(FRESH, String(Date.now()));
  location.replace(url.toString());
}

/**
 * 最新版にする。onStatus で進み具合を伝える。読み直すので、ふつうは戻らない
 * （Service Worker の無い開き方では、すぐ控えを通らない URL で開き直す）
 */
export async function updateToLatest(onStatus: (text: string) => void): Promise<void> {
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (registration && navigator.serviceWorker.controller) {
    onStatus("新しい版を取り込んでいます…（数十秒かかることがあります）");
    try {
      await registration.update();
    } catch {
      // 確かめられなくても、下で開き直す
    }
    if (registration.installing || registration.waiting) {
      if (await waitForNewWorker(registration, 60_000)) {
        onStatus("新しい版に切りかえます…");
        location.reload();
        return;
      }
    }
  }
  onStatus("開き直しています…");
  await wait(300);
  await reloadFresh();
}

/** 開き直したときの印をアドレスから消す（起動時に呼ぶ） */
export function clearFreshMark(): void {
  const url = new URL(location.href);
  if (!url.searchParams.has(FRESH)) return;
  url.searchParams.delete(FRESH);
  history.replaceState(history.state, "", url.toString());
}
