import "fake-indexeddb/auto";

/** Google でログイン（src/account.ts）: 戻ってきたときのアドレス・知らせの文・同期の失敗の見せ方 */
const load = async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  // テストから本物の Supabase へつながないよう、送り先は偽物にする
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  return import("../src/account");
};

describe("Google から戻ってきたとき", () => {
  afterEach(() => {
    history.replaceState(null, "", "/");
    sessionStorage.clear();
  });

  it("?code= を受け取り、アドレスをログインに出る前の画面に戻す", async () => {
    const { takeAuthReturn } = await load();
    sessionStorage.setItem("anatomy-auth-return", "#/start");
    history.replaceState(null, "", "/?code=abc123");
    takeAuthReturn();
    expect(location.search).toBe("");
    expect(location.hash).toBe("#/start");
    expect(sessionStorage.getItem("anatomy-auth-return")).toBeNull();
  });

  it("戻り先を覚えていなければ設定のアカウントの所へ。やめたときは知らせる（# に入ってくる形も）", async () => {
    const { takeAuthReturn, account } = await load();
    history.replaceState(null, "", "/#error=access_denied&error_code=x&error_description=User+cancelled");
    takeAuthReturn();
    expect(location.hash).toBe("#/settings/account");
    expect(account.message).toBe("ログインをやめました。");
  });

  it("ふつうに開いたときは何もしない（このアプリの # の画面はそのまま）", async () => {
    const { takeAuthReturn, account } = await load();
    history.replaceState(null, "", "/#/lessons");
    takeAuthReturn();
    expect(location.hash).toBe("#/lessons");
    expect(account.message).toBe("");
  });
});

describe("知らせの文", () => {
  it("ログインの失敗", async () => {
    const { authErrorText } = await load();
    expect(authErrorText("Unsupported provider: provider is not enabled")).toBe("Google でのログインは、今は使えません。");
    expect(authErrorText("invalid request: both auth code and code verifier should be non-empty")).toMatch(/もう一度/);
  });

  it("同期の失敗: サーバーの準備がまだ・通信できない・そのほか", async () => {
    const { syncFailure } = await load();
    expect(syncFailure({ code: "PGRST202", message: "Could not find the function public.anatomy_sync_pull" }).phase).toBe("not-ready");
    expect(syncFailure(new TypeError("Failed to fetch")).phase).toBe("offline");
    expect(syncFailure({ code: "P0001", message: "BAD_ENTRY" })).toEqual({ phase: "error", message: "BAD_ENTRY" });
  });

  it("LINE などのアプリの中のブラウザを見分ける", async () => {
    const { inAppBrowser } = await load();
    expect(inAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0")).toBe(true);
    expect(inAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
  });
});
