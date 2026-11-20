import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { nowIso } from "./db";
import { loadMarks } from "./marks";
import { loadProfile, sendProfile } from "./profile";
import { loadPreferences } from "./settings";
import {
  bindOwner, eraseLocal, lastSyncedAt, onOutboxChange, pendingCount, resumeChangeLog, syncOnce, syncOwner,
  type SyncBucket, type SyncEntry, type SyncOwner, type SyncServer,
} from "./sync";

/**
 * Google でログインして端末をまたぐ（docs/普段使い.md「端末をまたぐ（同期）」）。ログインは基礎医学演習アプリの Supabase の
 * Google ログインを借りる（同じ Google アカウントなら同じ利用者。記録の表は別）。ログインしなくても今までどおり端末の中だけで使える。
 * - supabase-js はログインしたことのある人だけが読み込む（はじめの読み込みを重くしない）。
 * - ログインは PKCE（戻ってきたときの ?code= を受けてセッションにする）。アドレスの # はこのアプリの画面なので使わない。
 * - ログインの保存場所（localStorage の anatomy-auth）は基礎医学演習アプリ（同じドメイン）と分ける。
 * - 送るのは、変えてから少し待って（解いている間は 15 秒ごとにまとめて）・画面を離れたとき・通信が戻ったとき。
 *   受けるのは、起動したとき・画面に戻ったとき・開いている間は5分ごと。
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** この版でログインできるか（送り先が無ければ、ログインの所は出さない） */
export const accountAvailable = (): boolean => !!url && !!key;

const STORAGE_KEY = "anatomy-auth";
/** ログインに出る前の画面（戻ってきたらそこへ） */
const RETURN_KEY = "anatomy-auth-return";
const PUSH_DELAY = 15_000;
const PULL_EVERY = 5 * 60_000;

export type SyncPhase = "idle" | "syncing" | "offline" | "error" | "not-ready";

export interface AccountState {
  /** unavailable＝この版ではログインできない、loading＝確かめている、conflict＝この端末に別のアカウントの記録がある */
  status: "unavailable" | "loading" | "guest" | "signed-in" | "conflict";
  user: { id: string; email: string; name: string } | null;
  /** この端末の記録の持ち主（前にログインしたアカウント。ログアウトしても残る） */
  owner: SyncOwner | null;
  phase: SyncPhase;
  lastAt: string;
  /** まだ送っていない変更の数 */
  pending: number;
  /** 知らせ（ログインの失敗・同期の失敗） */
  message: string;
}

export const account: AccountState = {
  status: accountAvailable() ? "loading" : "unavailable", user: null, owner: null, phase: "idle", lastAt: "", pending: 0, message: "",
};

function emit(): void {
  window.dispatchEvent(new CustomEvent("anatomy:account"));
}

let clientPromise: Promise<SupabaseClient> | null = null;

function getClient(): Promise<SupabaseClient> {
  clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) => createClient(url!, key!, {
    auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: STORAGE_KEY },
  }), (error: unknown) => {
    // 読み込めなかったら、次に使うときにもう一度読む
    clientPromise = null;
    throw error;
  });
  return clientPromise;
}

function storedSession(): { user?: { id?: string; email?: string; user_metadata?: Record<string, unknown> } } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** LINE・Instagram などのアプリの中のブラウザ（Google がログインを断る） */
export function inAppBrowser(agent = navigator.userAgent): boolean {
  return /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger|KAKAOTALK/i.test(agent);
}

export function authErrorText(raw: string): string {
  const text = decodeURIComponent(raw.replace(/\+/g, " "));
  if (/access_denied|cancel|denied/i.test(text)) return "ログインをやめました。";
  if (/provider.*not enabled|unsupported provider/i.test(text)) return "Google でのログインは、今は使えません。";
  if (/code verifier|flow state|invalid.*grant|both auth code and code verifier/i.test(text)) {
    return "ログインの途中で開いている画面が変わったため、ログインできませんでした。ログインを始めた画面（ホーム画面のアプリかブラウザ）で、もう一度お試しください。";
  }
  if (/disallowed_useragent/i.test(text)) return "このブラウザでは Google にログインできません。Safari や Chrome で開いてください。";
  return `ログインできませんでした（${text}）。`;
}

let pendingCode: string | null = null;

/**
 * Google から戻ってきたときのアドレス（?code=… か ?error=…）を受け取り、アドレスをログインに出る前の画面に戻す。
 * 画面を作る前に呼ぶ（main.ts）
 */
export function takeAuthReturn(): void {
  const search = new URLSearchParams(location.search);
  const fromHash = /(^#|&)error(_description)?=/.test(location.hash) ? new URLSearchParams(location.hash.slice(1)) : null;
  const code = search.get("code");
  const error = search.get("error_description") ?? search.get("error") ?? fromHash?.get("error_description") ?? fromHash?.get("error");
  if (!code && !error) return;
  pendingCode = code;
  if (error) account.message = authErrorText(error);
  let back = "#/settings/account";
  try {
    back = sessionStorage.getItem(RETURN_KEY) || back;
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // 読めなければ設定へ
  }
  history.replaceState(null, "", `${location.pathname}${back}`);
}

/** 起動したとき（main.ts）。前にログインしていれば、ログインを確かめて同期を始める */
export async function initAccount(): Promise<void> {
  if (!accountAvailable()) return;
  onOutboxChange(() => {
    account.pending += 1;
    if (account.status === "signed-in") requestSync(PUSH_DELAY);
  });
  account.owner = await resumeChangeLog();
  [account.pending, account.lastAt] = await Promise.all([pendingCount(), lastSyncedAt()]);
  watchTriggers();
  const stored = storedSession();
  if (!pendingCode && !stored) {
    account.status = "guest";
    emit();
    return;
  }
  emit();
  try {
    const client = await getClient();
    let session: Session | null = null;
    if (pendingCode) {
      const code = pendingCode;
      pendingCode = null;
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) account.message = authErrorText(error.message);
      session = data.session;
    }
    if (!session) {
      const { data, error } = await client.auth.getSession();
      session = data.session;
      // 通信できずにトークンを新しくできないときも、保存してあるログインのまま（つながったら同期する）
      if (!session && error && stored?.user?.id) {
        await useUser({ id: stored.user.id, email: stored.user.email ?? "", name: nameOf(stored.user.user_metadata) });
        return;
      }
    }
    await useUser(session ? userOf(session) : null);
    // ほかのタブでログアウトしたときや、ログインの期限が切れて新しくできなかったとき
    client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && account.user) void useUser(null);
    });
  } catch (error) {
    // supabase-js を読み込めない（オフラインで初めて）など。保存してあるログインのまま（別のアカウントの記録かは確かめる）
    console.warn("account", error);
    await useUser(stored?.user?.id ? { id: stored.user.id, email: stored.user.email ?? "", name: nameOf(stored.user.user_metadata) } : null);
    account.phase = "offline";
    emit();
  }
}

const nameOf = (meta: Record<string, unknown> | undefined): string => {
  const value = meta?.full_name ?? meta?.name;
  return typeof value === "string" ? value.trim() : "";
};
const userOf = (session: Session) => ({ id: session.user.id, email: session.user.email ?? "", name: nameOf(session.user.user_metadata) });

let userQueue: Promise<void> = Promise.resolve();

/** ログインした人を決める（1つずつ）。はじめての端末はアカウントに結びつけ、別のアカウントの記録がある端末は確かめる */
function useUser(user: AccountState["user"]): Promise<void> {
  userQueue = userQueue.catch((error) => console.warn("account", error)).then(() => setUser(user));
  return userQueue;
}

async function setUser(user: AccountState["user"]): Promise<void> {
  account.user = user;
  if (!user) {
    account.status = "guest";
    account.phase = "idle";
    emit();
    return;
  }
  let owner = await syncOwner();
  if (!owner) {
    await bindOwner({ id: user.id, email: user.email });
    owner = await syncOwner();
    account.pending = await pendingCount();
  }
  account.owner = owner;
  if (owner && owner.id !== user.id) {
    account.status = "conflict";
    emit();
    if (!location.hash.startsWith("#/settings")) location.hash = "#/settings/account";
    return;
  }
  account.status = "signed-in";
  emit();
  requestSync(0);
}

/** サーバー（基礎医学演習アプリの Supabase の 020_anatomy_sync.sql） */
function supabaseServer(client: SupabaseClient): SyncServer {
  return {
    async push(buckets) {
      const { error } = await client.rpc("anatomy_sync_push", { p_buckets: buckets });
      if (error) throw error;
    },
    async pull({ after, since, until, device, limit }): Promise<SyncBucket[]> {
      const { data, error } = await client.rpc("anatomy_sync_pull", { p_after: after, p_since: since, p_until: until, p_device: device, p_limit: limit });
      if (error) throw error;
      return ((data ?? []) as { bucket: string; entries: Record<string, SyncEntry> | null; seq: number | string; head: number | string }[])
        .map((row) => ({ bucket: row.bucket, entries: row.entries ?? {}, seq: Number(row.seq), head: Number(row.head) }));
    },
  };
}

/** 同期の失敗を、利用者に見せる状態に */
export function syncFailure(error: unknown): { phase: SyncPhase; message: string } {
  const { message = String(error), code = "" } = (error ?? {}) as { message?: string; code?: string };
  if (code === "PGRST202" || /could not find the function|anatomy_sync_(push|pull)/i.test(message)) {
    return { phase: "not-ready", message: "" };
  }
  if (/failed to fetch|network|load failed|fetch failed/i.test(message) || navigator.onLine === false) return { phase: "offline", message: "" };
  if (/AUTH_REQUIRED|JWT|401/.test(message)) return { phase: "error", message: "ログインの期限が切れました。ログアウトしてログインし直してください。" };
  return { phase: "error", message };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = 0;
let running: Promise<void> | null = null;
let again = false;

/** delay ミリ秒の後に同期する（もっと早い予定があればそのまま） */
export function requestSync(delay = 0): void {
  if (account.status !== "signed-in") return;
  const at = Date.now() + delay;
  if (timer && timerAt <= at) return;
  if (timer) clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delay);
}

/** 今すぐ同期する（設定の「今すぐ同期」・ログアウトの前） */
export function syncNow(): Promise<void> {
  if (account.status !== "signed-in") return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    if (navigator.onLine === false) {
      account.phase = "offline";
      return;
    }
    account.phase = "syncing";
    emit();
    try {
      const { pulled } = await syncOnce(supabaseServer(await getClient()));
      account.phase = "idle";
      account.message = "";
      account.lastAt = nowIso();
      if (pulled.has("settings")) {
        await Promise.all([loadPreferences(), loadMarks(), loadProfile()]);
        void sendProfile();
      }
      if (pulled.size) window.dispatchEvent(new CustomEvent("anatomy:synced", { detail: [...pulled] }));
    } catch (error) {
      console.warn("sync", error);
      Object.assign(account, syncFailure(error));
    }
  })().finally(async () => {
    account.pending = await pendingCount();
    running = null;
    emit();
    if (again) {
      again = false;
      requestSync(0);
    }
  });
  return running;
}

let watching = false;

function watchTriggers(): void {
  if (watching) return;
  watching = true;
  // 画面を離れるときは、止められる前にすぐ送り始める
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void syncNow();
    else if (Date.now() - new Date(account.lastAt || 0).getTime() > 60_000) requestSync(0);
  });
  window.addEventListener("pagehide", () => void syncNow());
  window.addEventListener("online", () => requestSync(0));
  window.addEventListener("offline", () => {
    if (account.status !== "signed-in") return;
    account.phase = "offline";
    emit();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") requestSync(0);
  }, PULL_EVERY);
}

/** Google でログイン（Google の画面へ移り、戻ってきたら initAccount が受ける） */
export async function signIn(): Promise<void> {
  try {
    sessionStorage.setItem(RETURN_KEY, location.hash || "#/");
  } catch {
    // 戻り先を覚えられなければ設定へ戻る
  }
  try {
    const client = await getClient();
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: new URL(import.meta.env.BASE_URL, location.origin).href, queryParams: { prompt: "select_account" } },
    });
    if (error) throw error;
  } catch (error) {
    account.message = navigator.onLine === false ? "通信できないため、ログインできません。" : authErrorText(error instanceof Error ? error.message : String(error));
    emit();
  }
}

/**
 * ログアウト。erase なら、この端末の記録を消して読み直す（アカウントの記録は残る）。
 * 残すときは、送れるものを送ってから。この端末の記録はそのまま使え、同じアカウントでログインし直すと続きから送る
 */
export async function signOut(erase: boolean): Promise<void> {
  if (account.status === "signed-in") await syncNow().catch(() => {});
  try {
    const client = await getClient();
    await client.auth.signOut({ scope: "local" });
  } catch {
    // オフラインでも、この端末のログインは消える
  }
  if (erase) {
    await eraseLocal();
    location.replace(`${location.pathname}#/`);
    location.reload();
    return;
  }
  await useUser(null);
}

/** この端末に別のアカウントの記録があるとき: この端末の記録を消して、今ログインしているアカウントの記録にする */
export async function switchToSignedInAccount(): Promise<void> {
  const user = account.user;
  if (!user) return;
  await eraseLocal();
  await bindOwner({ id: user.id, email: user.email });
  location.replace(`${location.pathname}#/`);
  location.reload();
}
