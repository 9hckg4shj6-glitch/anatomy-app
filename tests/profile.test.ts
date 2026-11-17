import "fake-indexeddb/auto";
import { db } from "../src/db";
import { MED_UNIVERSITIES, REGIONS } from "../src/universities";

// src/profile.ts は送り先（VITE_SUPABASE_URL）を読み込んだときに決めるので、テストごとに読み直す
const load = async (env: boolean) => {
  vi.resetModules();
  vi.unstubAllEnvs();
  // CI ではビルド用に本物の送り先が入っているので、無いときも空にして上書きする（テストから本物へ送らない）
  vi.stubEnv("VITE_SUPABASE_URL", env ? "https://example.supabase.co" : "");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", env ? "anon-key" : "");
  return import("../src/profile");
};

describe("名前と所属（スタート画面）", () => {
  beforeEach(async () => {
    await db.settings.clear();
    vi.unstubAllGlobals();
  });

  it("医学部のある大学は82校で、名前が重ならず、どれも地方のどこかの都道府県にある", () => {
    expect(MED_UNIVERSITIES).toHaveLength(82);
    expect(new Set(MED_UNIVERSITIES.map(([name]) => name)).size).toBe(82);
    const prefs = new Set(REGIONS.flatMap(([, list]) => list));
    expect(prefs.size).toBe(47);
    for (const [, pref] of MED_UNIVERSITIES) expect(prefs.has(pref)).toBe(true);
  });

  it("4つそろうまでは未完了。保存すると制御文字を除き、名前は24文字まで", async () => {
    const { loadProfile, profileComplete, saveProfile } = await load(false);
    await saveProfile({ name: " 解剖\u0007花子 " });
    expect(profileComplete(await loadProfile())).toBe(false);
    await saveProfile({ university: "東京医科大学", faculty: "医学部 医学科", grade: "1年" });
    const saved = await loadProfile();
    expect(saved?.name).toBe("解剖花子");
    expect(profileComplete(saved)).toBe(true);
    await saveProfile({ name: "あ".repeat(30) });
    expect((await loadProfile())?.name).toHaveLength(24);
  });

  it("送り先が無ければ送らない（そのまま使える）", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { saveProfile, sendProfile } = await load(false);
    await saveProfile({ name: "花子", university: "東京医科大学", faculty: "医学部 医学科", grade: "1年" });
    await sendProfile();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("そろったら1回だけ送り、直したらもう一度送る。端末IDは変わらない", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const { deviceId, loadProfile, saveProfile, sendProfile } = await load(true);
    await saveProfile({ name: "花子", university: "東京医科大学", faculty: "医学部 医学科", grade: "1年" });
    await sendProfile();
    await sendProfile();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/anatomy_profile_set");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ p_name: "花子", p_university: "東京医科大学", p_faculty: "医学部 医学科", p_grade: "1年" });
    expect(body.p_device_id).toBe(await deviceId());
    const saved = await loadProfile();
    expect(saved?.sentAt).toBe(saved?.savedAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveProfile({ grade: "2年" });
    await sendProfile();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body)).p_grade).toBe("2年");
  });

  it("送れなかったら（オフラインなど）送っていないままにして、次に開いたときに送る", async () => {
    const fetch = vi.fn(async () => { throw new TypeError("offline"); });
    vi.stubGlobal("fetch", fetch);
    const { loadProfile, profileOnLaunch, saveProfile, sendProfile } = await load(true);
    await saveProfile({ name: "花子", university: "その他の大学", faculty: "看護学部", grade: "その他" });
    await sendProfile();
    expect((await loadProfile())?.sentAt).toBeUndefined();

    const ok = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", ok);
    await profileOnLaunch(new Date(2026, 10, 18));
    // 所属を送ったあと、その日にはじめて開いたことを残す
    expect(ok.mock.calls.map((call) => String((call as unknown as [string])[0]).split("/").pop())).toEqual(["anatomy_profile_set", "anatomy_seen"]);
    const saved = await loadProfile();
    expect(saved?.sentAt).toBe(saved?.savedAt);
    await profileOnLaunch(new Date(2026, 10, 18));
    expect(ok).toHaveBeenCalledTimes(2);
  });
});
