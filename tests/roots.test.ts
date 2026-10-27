import "fake-indexeddb/auto";
import { termById } from "../src/content";
import { db } from "../src/db";
import { exportBackup, importBackup, newerSchedule } from "../src/backup";
import { Rating, nextSchedule } from "../src/fsrs";
import { relatedTerms } from "../src/related";
import { examplesOf, isRootKey, rootKey, roots, rootsOf, rootUnits, splitAtRoot } from "../src/roots";
import { buildQueue, facetsFor, practiceQueue, ROOT_FACETS, type PracticeCandidate } from "../src/study";

const root = (id: string) => roots.find((r) => r.id === id)!;

describe("語根カード", () => {
  it("英語名から語根を見つけ、例の少ない語根を先に出す", () => {
    const ids = rootsOf(termById.get("brachioradialis")!).map((r) => r.id);
    expect(ids).toContain("brachi");
    expect(ids).toContain("radi");
    expect(rootsOf(termById.get("femoral-artery")!).map((r) => r.id)).toContain("femor");
  });

  it("誤って拾いやすい語を拾わない（posterior の oste、maxillary の axill、lung の lun）", () => {
    expect(examplesOf(root("oste")).map((t) => t.en)).not.toContain("posterior");
    expect(examplesOf(root("axill")).map((t) => t.id)).not.toContain("maxillary-artery");
    expect(examplesOf(root("lun")).some((t) => /lung/.test(t.en))).toBe(false);
  });

  it("英語名の中の語根の部分を切り出す", () => {
    expect(splitAtRoot("brachial artery", root("brachi"))).toEqual(["", "brachi", "al artery"]);
    expect(splitAtRoot("deltoid", root("brachi"))).toBeNull();
  });

  it("レッスンは11個までに分け、どの語根も1回ずつ入る", () => {
    expect(rootUnits.every((unit) => unit.roots.length <= 11)).toBe(true);
    const all = rootUnits.flatMap((unit) => unit.roots.map((r) => r.id));
    expect(all).toHaveLength(roots.length);
    expect(new Set(all).size).toBe(roots.length);
  });

  it("語根カードは語と同じ復習の列に、語根→意味・意味→語根の順で入る", () => {
    const key = rootKey(root("brachi"));
    expect(isRootKey(key)).toBe(true);
    const queue = buildQueue([{ termId: key, unitId: "roots-body-1", learnedAt: "2026-10-30T00:00:00Z" }], [], new Date("2026-11-01T00:00:00Z"), 10,
      (id) => (isRootKey(id) ? ROOT_FACETS : facetsFor(termById.get(id))));
    expect(queue.map((item) => item.facet)).toEqual(["rootMeaning", "rootForm"]);
    // 語には語根の問い方を付けない
    expect(facetsFor(termById.get("femur")).some((facet) => ROOT_FACETS.includes(facet))).toBe(false);
  });
});

describe("演習", () => {
  const candidate = (termId: string, facet: PracticeCandidate["facet"], recall: number | null, lapses = 0): PracticeCandidate => ({ termId, facet, recall, lapses });

  it("苦手な順では、思い出せる確率の低いものと忘れた回数の多いものを先に出す", () => {
    const queue = practiceQueue([
      candidate("femur", "locate", 0.95), candidate("tibia", "locate", 0.3), candidate("fibula", "locate", 0.6, 4), candidate("patella", "locate", null),
    ], 4, true);
    expect(queue.map((item) => item.termId)).toEqual(["tibia", "fibula", "patella", "femur"]);
  });

  it("同じ語の問い方は、ほかの語を1周してから出す", () => {
    const queue = practiceQueue([
      candidate("femur", "locate", 0.1), candidate("femur", "point", 0.1), candidate("femur", "ja2en", 0.1), candidate("tibia", "locate", 0.9),
    ], 3, true);
    expect(queue.slice(0, 2).map((item) => item.termId).sort()).toEqual(["femur", "tibia"]);
    expect(queue).toHaveLength(3);
  });
});

describe("関係する語", () => {
  it("筋→支配神経、神経→支配する筋", () => {
    expect(relatedTerms(termById.get("pronator-teres")!, {})[0].list.map((t) => t.id)).toEqual(["median-nerve"]);
    const muscles = relatedTerms(termById.get("median-nerve")!, {})[0].list.map((t) => t.id);
    expect(muscles).toContain("pronator-teres");
    expect(muscles).toContain("abductor-pollicis-brevis");
  });

  it("骨→付着面とピンからそこに付く筋、骨の部位→そこから起こる筋", () => {
    const [origin, insertion] = relatedTerms(termById.get("humerus")!, { "brachialis": { origin: [["humerus", 0, 0, 0, 0.01]] } });
    expect(origin.list.map((t) => t.id)).toContain("brachialis");
    expect(insertion.list.map((t) => t.id)).toContain("deltoid"); // insertionAt の三角筋粗面
    expect(relatedTerms(termById.get("lateral-epicondyle-of-humerus")!, {})[0].list.map((t) => t.id)).toContain("anconeus");
  });
});

describe("記録の書き出し・読み込み", () => {
  beforeEach(async () => {
    await Promise.all([db.schedules.clear(), db.reviewEvents.clear(), db.learned.clear(), db.settings.clear()]);
  });

  it("同じカードは最後に解いたのが新しい方を残す", () => {
    const old = nextSchedule(undefined, "femur", "locate", Rating.Good, new Date("2026-10-01T00:00:00Z"));
    const fresh = nextSchedule(undefined, "femur", "locate", Rating.Again, new Date("2026-10-20T00:00:00Z"));
    expect(newerSchedule(old, fresh)).toBe(fresh);
    expect(newerSchedule(fresh, old)).toBe(fresh);
  });

  it("読み込んだ記録を足し合わせる（履歴は重ねず、学んだ日時は早い方）", async () => {
    const local = nextSchedule(undefined, "femur", "locate", Rating.Good, new Date("2026-10-20T00:00:00Z"));
    await db.schedules.put(local);
    await db.learned.put({ termId: "femur", unitId: "skel-lower", learnedAt: "2026-10-20T00:00:00Z" });
    await db.reviewEvents.add({ id: "e1", cardId: "femur:locate", termId: "femur", facet: "locate", rating: 3, reviewedAt: "2026-10-20T00:00:00Z", durationMs: 1000, isNew: true, source: "review" });
    const backup = await exportBackup();
    backup.schedules = [
      nextSchedule(undefined, "femur", "locate", Rating.Again, new Date("2026-10-01T00:00:00Z")), // 古いので残さない
      nextSchedule(undefined, "tibia", "point", Rating.Good, new Date("2026-10-05T00:00:00Z")),
    ];
    backup.learned = [{ termId: "femur", unitId: "skel-lower", learnedAt: "2026-10-10T00:00:00Z" }, { termId: "tibia", unitId: "skel-lower", learnedAt: "2026-10-05T00:00:00Z" }];
    const result = await importBackup(backup);
    expect(result).toEqual({ schedules: 1, reviewEvents: 0, learned: 2 });
    expect((await db.schedules.get("femur:locate"))!.lastReview).toBe(local.lastReview);
    expect(await db.schedules.get("tibia:point")).toBeTruthy();
    expect((await db.learned.get("femur"))!.learnedAt).toBe("2026-10-10T00:00:00Z");
    expect(await db.reviewEvents.count()).toBe(1);
  });
});
