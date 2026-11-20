import "fake-indexeddb/auto";
import Dexie from "dexie";
import { IDBFactory } from "fake-indexeddb";
import type { PullRequest, SyncBucket, SyncEntry, SyncServer } from "../src/sync";

/**
 * 端末をまたぐ同期（src/sync.ts・src/db.ts）。サーバーは 020_anatomy_sync.sql と同じ決まりの手元の偽物
 * （束ごとに、同じキーは c の新しい方。受けた順の番号 s。読むときは番号より後で、自分の端末の分を除く）。
 * 端末は IndexedDB を別々にして2つ作る
 */
function fakeServer(): SyncServer & { buckets: Map<string, { entries: Record<string, SyncEntry>; seq: number }>; pushes: number } {
  let seq = 0;
  const buckets = new Map<string, { entries: Record<string, SyncEntry>; seq: number }>();
  const server = {
    buckets,
    pushes: 0,
    async push(input: Record<string, Record<string, SyncEntry>>) {
      const sent = JSON.parse(JSON.stringify(input)) as typeof input;
      expect(Object.keys(sent).length).toBeLessThanOrEqual(500);
      server.pushes += 1;
      for (const [name, entries] of Object.entries(sent)) {
        expect(name).toMatch(/^(e:\d{4}-\d{2}-\d{2}|s:\d{1,2}|l:\d{1,2}|c:\d)$/);
        seq += 1;
        const bucket = buckets.get(name) ?? { entries: {}, seq };
        for (const [id, entry] of Object.entries(entries)) {
          const before = bucket.entries[id];
          if (!before || entry.c > before.c) bucket.entries[id] = { c: entry.c, v: entry.v ?? null, d: entry.d ?? "", s: seq };
        }
        bucket.seq = seq;
        buckets.set(name, bucket);
      }
    },
    // ページは小さく（3束）して、ページに分けて受けるところをいつも通す
    async pull({ after, since, until, device, limit }: PullRequest): Promise<SyncBucket[]> {
      const head = Math.min(seq, until ?? seq);
      return JSON.parse(JSON.stringify([...buckets].filter(([, bucket]) => bucket.seq > Math.max(after, since)).sort((a, b) => a[1].seq - b[1].seq)
        .slice(0, Math.min(limit, 3))
        .map(([bucket, row]) => ({
          bucket, seq: row.seq, head,
          entries: Object.fromEntries(Object.entries(row.entries).filter(([, entry]) => entry.s! > since && entry.s! <= head && entry.d !== device)),
        }))));
    },
  };
  return server;
}

/** IndexedDB を別にした端末（モジュールも読み直す） */
async function device() {
  vi.resetModules();
  (Dexie as unknown as { dependencies: { indexedDB: IDBFactory } }).dependencies.indexedDB = new IDBFactory();
  const [db, sync, fsrs, backup] = await Promise.all([import("../src/db"), import("../src/sync"), import("../src/fsrs"), import("../src/backup")]);
  return { ...db, ...sync, ...fsrs, ...backup };
}
type Device = Awaited<ReturnType<typeof device>>;

/** まだ送っていない変更は、書いたあと別のトランザクションで残すので、それが終わるまで待つ */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const owner = { id: "11111111-1111-1111-1111-111111111111", email: "hanako@example.com" };

async function snapshot(d: Device) {
  const [schedules, events, learned, settings] = await Promise.all([
    d.db.schedules.toArray(), d.db.reviewEvents.toArray(), d.db.learned.toArray(), d.db.settings.toArray(),
  ]);
  const sort = <T>(rows: T[], key: keyof T) => [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  return {
    schedules: sort(schedules, "cardId"), events: sort(events, "id"), learned: sort(learned, "termId"),
    settings: sort(settings.filter((row) => !d.isDeviceSetting(row.key)), "key").map((row) => ({ key: row.key, value: row.value })),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("変更の記録（まだ送っていない変更）", () => {
  it("ログインしたことのない端末では残さない。結びつけると今の記録をすべて残し、そのあとの変更も残す", async () => {
    const d = await device();
    await d.markLearned([{ termId: "femur", unitId: "u1" }], "2026-11-01T00:00:00.000Z");
    await d.recordReview("femur", "point", d.Rating.Good, { durationMs: 1000, source: "lesson" }, new Date("2026-11-01T00:00:10.000Z"));
    await settle();
    expect(await d.db.outbox.count()).toBe(0);

    await d.db.settings.put({ key: "deviceId", value: "abc", updatedAt: "2026-11-01T00:00:00.000Z" });
    await d.bindOwner(owner);
    const seeded = await d.db.outbox.toArray();
    // 覚え具合・解いた記録・学んだ語（端末IDと同期の状態は送らない）
    expect(seeded.map((entry) => entry.table).sort()).toEqual(["learned", "reviewEvents", "schedules"]);
    expect(seeded.find((entry) => entry.table === "learned")?.changedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(seeded.find((entry) => entry.table === "reviewEvents")?.bucket).toBe("e:2026-11-01");

    await d.db.outbox.clear();
    const { undo } = await d.recordReview("femur", "locate", d.Rating.Again, { durationMs: 900, source: "review" }, new Date("2026-11-02T09:00:00.000Z"));
    await d.db.settings.put({ key: "course", value: "standard", updatedAt: d.nowIso() });
    await d.db.settings.put({ key: "profileSeenDay", value: "2026-11-2", updatedAt: d.nowIso() });
    await settle();
    expect((await d.db.outbox.toArray()).map((entry) => `${entry.table} ${entry.bucket}`).sort())
      .toEqual(["reviewEvents e:2026-11-02", `schedules ${d.bucketOf("schedules", "femur:locate")}`, `settings ${d.bucketOf("settings", "course")}`].sort());
    // 取り消すと、解いた記録は「消した」として送る（消したあとも日の束が分かる）
    await undo();
    await settle();
    const events = (await d.db.outbox.toArray()).filter((entry) => entry.table === "reviewEvents");
    expect(events).toHaveLength(1);
    expect(events[0].bucket).toBe("e:2026-11-02");
    expect(await d.db.reviewEvents.get(events[0].id)).toBeUndefined();
  });

  it("同期で受けたものを書くトランザクションは残さない", async () => {
    const d = await device();
    await d.bindOwner(owner);
    await d.db.outbox.clear();
    await d.db.transaction("rw", d.db.settings, async (tx) => {
      d.quietTransaction(tx);
      await d.db.settings.put({ key: "course", value: "free", updatedAt: d.nowIso() });
    });
    await settle();
    expect(await d.db.outbox.count()).toBe(0);
  });

  it("束は端末によらず同じで、数が決まっている", async () => {
    const d = await device();
    expect(d.bucketOf("schedules", "femur:point")).toBe(d.bucketOf("schedules", "femur:point"));
    const all = new Set(Array.from({ length: 3000 }, (_, i) => d.bucketOf("schedules", `t${i}:point`)));
    expect(all.size).toBe(64);
    expect(new Set(Array.from({ length: 500 }, (_, i) => d.bucketOf("learned", `t${i}`))).size).toBe(16);
    expect(new Set(Array.from({ length: 200 }, (_, i) => d.bucketOf("settings", `mark:t${i}`))).size).toBe(8);
    expect(d.bucketOf("reviewEvents", "x", { reviewedAt: "2026-11-20T23:59:59.000Z" })).toBe("e:2026-11-20");
    expect(d.bucketOf("reviewEvents", "x")).toBeNull();
  });
});

describe("2つの端末で同じになる", () => {
  it("片方で学んだ記録・★とメモ・設定・名前と所属が、もう片方に届く（送った版と端末ごとの設定は届かない）", async () => {
    const server = fakeServer();
    const a = await device();
    await a.bindOwner(owner);
    await a.markLearned([{ termId: "femur", unitId: "b-skel-leg" }, { termId: "patella", unitId: "b-skel-leg" }]);
    await a.recordReview("femur", "point", a.Rating.Good, { durationMs: 1000, source: "lesson" });
    await a.recordReview("patella", "locate", a.Rating.Again, { durationMs: 1000, source: "lesson" });
    await a.db.settings.bulkPut([
      { key: "mark:femur", value: { starred: true, memo: "大腿骨頭に注意" }, updatedAt: a.nowIso() },
      { key: "course", value: "standard", updatedAt: a.nowIso() },
      { key: "profile", value: { name: "花子", university: "東京医科大学", faculty: "医学部 医学科", grade: "1年", savedAt: "2026-11-20T00:00:00.000Z", sentAt: "2026-11-20T00:00:00.000Z" }, updatedAt: "2026-11-20T00:00:00.000Z" },
      { key: "installHintClosed", value: true, updatedAt: a.nowIso() },
    ]);
    await settle();
    const first = await a.syncOnce(server);
    expect(first.pushed).toBeGreaterThan(0);
    expect(await a.db.outbox.count()).toBe(0);

    const b = await device();
    await b.db.settings.put({ key: "deviceId", value: "device-b", updatedAt: b.nowIso() });
    await b.bindOwner(owner);
    const got = await b.syncOnce(server);
    expect([...got.pulled].sort()).toEqual(["learned", "reviewEvents", "schedules", "settings"]);
    const [sa, sb] = [await snapshot(a), await snapshot(b)];
    expect(sb.schedules).toEqual(sa.schedules);
    expect(sb.events).toEqual(sa.events);
    expect(sb.learned).toEqual(sa.learned);
    // 名前と所属は届くが、「送った版」はこの端末ではまだ（次に開いたときにこの端末の分として送る）
    const profile = sb.settings.find((row) => row.key === "profile")?.value as Record<string, unknown>;
    expect(profile.name).toBe("花子");
    expect(profile.sentAt).toBeUndefined();
    expect(sb.settings.find((row) => row.key === "mark:femur")?.value).toEqual({ starred: true, memo: "大腿骨頭に注意" });
    expect(await b.db.settings.get("installHintClosed")).toBeUndefined();
    expect((await b.db.settings.get("deviceId"))?.value).toBe("device-b");
    // 受けたものは送り返さない
    expect(await b.db.outbox.count()).toBe(0);
  });

  it("もう片方で解き直し・取り消しをすると、元の端末に届く。自分の送った分は受け直さない", async () => {
    const server = fakeServer();
    const a = await device();
    await a.bindOwner(owner);
    await a.markLearned([{ termId: "femur", unitId: "u" }]);
    await a.recordReview("femur", "point", a.Rating.Good, { durationMs: 1000, source: "lesson" }, new Date("2026-11-18T00:00:00.000Z"));
    await settle();
    await a.syncOnce(server);

    const b = await device();
    await b.bindOwner(owner);
    await b.syncOnce(server);
    await b.recordReview("femur", "point", b.Rating.Easy, { durationMs: 800, source: "review" }, new Date("2026-11-20T00:00:00.000Z"));
    const wrong = await b.recordReview("femur", "ja2en", b.Rating.Again, { durationMs: 800, source: "review" }, new Date("2026-11-20T00:01:00.000Z"));
    await settle();
    await b.syncOnce(server);
    await wrong.undo();
    await settle();
    await b.syncOnce(server);

    const pulled = await a.syncOnce(server);
    expect([...pulled.pulled].sort()).toEqual(["reviewEvents", "schedules"]);
    expect(await snapshot(a)).toEqual(await snapshot(b));
    expect(await a.db.schedules.get("femur:ja2en")).toBeUndefined();
    expect((await a.db.schedules.get("femur:point"))?.lastReview).toBe("2026-11-20T00:00:00.000Z");
    expect(await a.db.reviewEvents.count()).toBe(2);
    // もう一度同期しても、どちらも何も受けない
    expect((await a.syncOnce(server)).pulled.size).toBe(0);
    expect((await b.syncOnce(server)).pulled.size).toBe(0);
  });

  it("通信の無い所で両方が同じ問題を解いたら、あとで解いた方の覚え具合が残り、解いた記録は両方残る", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const server = fakeServer();
    const a = await device();
    const b = await device();
    vi.setSystemTime(new Date("2026-11-19T10:00:00.000Z"));
    await a.bindOwner(owner);
    await b.bindOwner(owner);
    await a.syncOnce(server);
    await b.syncOnce(server);

    vi.setSystemTime(new Date("2026-11-20T08:00:00.000Z"));
    await a.recordReview("tibia", "point", a.Rating.Good, { durationMs: 1000, source: "review" });
    vi.setSystemTime(new Date("2026-11-20T09:00:00.000Z"));
    await b.recordReview("tibia", "point", b.Rating.Hard, { durationMs: 1000, source: "review" });
    await settle();
    // 先に B が送り、あとから A（古い方）が送っても、B の方が残る
    await b.syncOnce(server);
    await a.syncOnce(server);
    await b.syncOnce(server);
    const [sa, sb] = [await snapshot(a), await snapshot(b)];
    expect(sa).toEqual(sb);
    expect(sa.schedules[0].lastReview).toBe("2026-11-20T09:00:00.000Z");
    expect(sa.events.map((event) => event.rating).sort()).toEqual([a.Rating.Hard, a.Rating.Good].sort());
  });

  it("まだ送っていない自分の変更の方が新しければ、受けた行は捨てて自分のを送る", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const server = fakeServer();
    const a = await device();
    const b = await device();
    vi.setSystemTime(new Date("2026-11-20T08:00:00.000Z"));
    await a.bindOwner(owner);
    await b.bindOwner(owner);
    await a.db.settings.put({ key: "course", value: "basic", updatedAt: a.nowIso() });
    await settle();
    await a.syncOnce(server);
    vi.setSystemTime(new Date("2026-11-20T09:00:00.000Z"));
    await b.db.settings.put({ key: "course", value: "free", updatedAt: b.nowIso() });
    await settle();
    await b.syncOnce(server);
    expect((await b.db.settings.get("course"))?.value).toBe("free");
    await a.syncOnce(server);
    expect((await a.db.settings.get("course"))?.value).toBe("free");
  });
});

describe("ページに分けて受ける", () => {
  it("前に送った束がページの間に新しくなっても、新しい端末は全部を受ける（ページの番号で古い分を落とさない）", async () => {
    const server = fakeServer();
    const a = await device();
    await a.bindOwner(owner);
    // 1回目: 30語の覚え具合（多くの束に散る）
    for (let i = 0; i < 30; i++) await a.recordReview(`t${i}`, "point", a.Rating.Good, { durationMs: 1, source: "lesson" });
    await settle();
    await a.syncOnce(server);
    // 2回目: はじめの数語を解き直す（その束だけ番号が新しくなる）
    for (let i = 0; i < 5; i++) await a.recordReview(`t${i}`, "locate", a.Rating.Good, { durationMs: 1, source: "review" });
    await settle();
    await a.syncOnce(server);
    const b = await device();
    await b.bindOwner(owner);
    await b.syncOnce(server);
    expect(await b.db.schedules.count()).toBe(35);
    expect(await b.db.reviewEvents.count()).toBe(35);
  });

  it("受けている途中でほかの端末が送っても、取りこぼさない（次の受け取りで届く）", async () => {
    const server = fakeServer();
    const a = await device();
    const b = await device();
    await a.bindOwner(owner);
    await b.bindOwner(owner);
    for (let i = 0; i < 12; i++) await a.recordReview(`t${i}`, "point", a.Rating.Good, { durationMs: 1, source: "lesson" });
    await settle();
    await a.syncOnce(server);
    // B が2ページ目を受ける前に、A がはじめの束を新しくする
    const pull = server.pull.bind(server);
    let pages = 0;
    server.pull = async (request) => {
      if (pages++ === 1) {
        await a.recordReview("t0", "ja2en", a.Rating.Good, { durationMs: 1, source: "review" });
        await settle();
        await a.syncOnce({ ...server, pull });
      }
      return pull(request);
    };
    await b.syncOnce(server);
    server.pull = pull;
    await b.syncOnce(server);
    expect(await b.db.schedules.count()).toBe(13);
    expect(await snapshot(b)).toEqual(await snapshot(a));
  });
});

describe("はじめてログインした端末", () => {
  it("この端末の記録とアカウントの記録を合わせる（覚え具合は新しい方、解いた記録は両方、学んだ日は早い方）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    const server = fakeServer();
    const a = await device();
    const b = await device();
    // B はログインせずに使っていた（脛骨は A より前に学んで解き、大腿骨は A より後に解いた）
    at("2026-11-05T00:00:00.000Z");
    await b.markLearned([{ termId: "tibia", unitId: "u" }, { termId: "fibula", unitId: "u" }]);
    at("2026-11-06T00:00:00.000Z");
    await b.recordReview("tibia", "point", b.Rating.Again, { durationMs: 1000, source: "review" });
    at("2026-11-10T00:00:00.000Z");
    await a.bindOwner(owner);
    await a.markLearned([{ termId: "femur", unitId: "u" }, { termId: "tibia", unitId: "u" }]);
    await a.recordReview("femur", "point", a.Rating.Good, { durationMs: 1000, source: "lesson" });
    await a.recordReview("tibia", "point", a.Rating.Good, { durationMs: 1000, source: "lesson" });
    await settle();
    await a.syncOnce(server);
    at("2026-11-15T00:00:00.000Z");
    await b.recordReview("femur", "point", b.Rating.Easy, { durationMs: 1000, source: "review" });
    at("2026-11-20T00:00:00.000Z");
    await b.bindOwner(owner);
    await b.syncOnce(server);
    await a.syncOnce(server);

    const [sa, sb] = [await snapshot(a), await snapshot(b)];
    expect(sa).toEqual(sb);
    expect(sa.learned.map((row) => `${row.termId} ${row.learnedAt.slice(0, 10)}`))
      .toEqual(["femur 2026-11-10", "fibula 2026-11-05", "tibia 2026-11-05"]);
    expect(sa.events).toHaveLength(4);
    expect(sa.schedules.find((row) => row.cardId === "femur:point")?.lastReview).toBe("2026-11-15T00:00:00.000Z");
    expect(sa.schedules.find((row) => row.cardId === "tibia:point")?.lastReview).toBe("2026-11-10T00:00:00.000Z");
  });

  it("新しい端末でアプリが自分で入れた初めの値（モードなど）は、ほかの端末で選んだ値に負ける", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const server = fakeServer();
    vi.setSystemTime(new Date("2026-11-10T00:00:00.000Z"));
    const a = await device();
    await a.bindOwner(owner);
    const settingsA = await import("../src/settings");
    await settingsA.setCourse("standard");
    await settle();
    await a.syncOnce(server);

    // B は後から開いた（初めの値「初心者モード」が今の日時で入ると、A で選んだ「標準」に勝ってしまう）
    vi.setSystemTime(new Date("2026-11-20T00:00:00.000Z"));
    const b = await device();
    const settingsB = await import("../src/settings");
    await settingsB.loadPreferences();
    expect(settingsB.preferences.mode).toBe("beginner");
    await b.bindOwner(owner);
    await b.syncOnce(server);
    await settingsB.loadPreferences();
    expect(settingsB.preferences.mode).toBe("standard");
    expect(settingsB.preferences.course).toBe("standard");
    await a.syncOnce(server);
    expect((await a.db.settings.get("mode"))?.value).toBe("standard");
  });

  it("何百日分の解いた記録も、束の数を区切って送る", async () => {
    const server = fakeServer();
    const d = await device();
    const start = Date.parse("2025-01-01T00:00:00.000Z");
    await d.db.reviewEvents.bulkAdd(Array.from({ length: 600 }, (_, i) => ({
      id: `ev${i}`, cardId: "femur:point", termId: "femur", facet: "point" as const, rating: 3, durationMs: null, isNew: false, source: "review" as const,
      reviewedAt: new Date(start + i * 86_400_000).toISOString(),
    })));
    await d.bindOwner(owner);
    await d.syncOnce(server);
    expect(server.pushes).toBeGreaterThanOrEqual(2);
    expect(await d.db.outbox.count()).toBe(0);
    const b = await device();
    await b.bindOwner(owner);
    await b.syncOnce(server);
    expect(await b.db.reviewEvents.count()).toBe(600);
  });
});

describe("この端末の記録を消す・書き出し", () => {
  it("消すと学習の記録と同期の状態は消え、端末ID は残る", async () => {
    const d = await device();
    await d.db.settings.bulkPut([
      { key: "deviceId", value: "keep-me", updatedAt: d.nowIso() },
      { key: "course", value: "free", updatedAt: d.nowIso() },
    ]);
    await d.markLearned([{ termId: "femur", unitId: "u" }]);
    await d.bindOwner(owner);
    await d.eraseLocal();
    expect(await d.db.learned.count()).toBe(0);
    expect(await d.db.outbox.count()).toBe(0);
    expect(await d.syncOwner()).toBeNull();
    expect((await d.db.settings.toArray()).map((row) => row.key)).toEqual(["deviceId"]);
  });

  it("書き出しに端末ごとの設定は入れず、読み込んでも端末ごとの設定は替えない", async () => {
    const d = await device();
    await d.db.settings.bulkPut([
      { key: "deviceId", value: "mine", updatedAt: "2026-11-01T00:00:00.000Z" },
      { key: "course", value: "free", updatedAt: d.nowIso() },
    ]);
    await d.bindOwner(owner);
    const backup = await d.exportBackup();
    expect(backup.settings.map((row) => row.key)).toEqual(["course"]);
    await d.importBackup({ ...backup, settings: [...backup.settings, { key: "deviceId", value: "other", updatedAt: "2026-12-01T00:00:00.000Z" }, { key: "sync.cursor", value: 999, updatedAt: "2026-12-01T00:00:00.000Z" }] });
    expect((await d.db.settings.get("deviceId"))?.value).toBe("mine");
    expect((await d.db.settings.get("sync.cursor"))?.value).toBe(0);
  });
});
