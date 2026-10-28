import "fake-indexeddb/auto";
import { termById } from "../src/content";
import {
  checkBlank, clozeRating, essayRating, examByKey, examCountOf, examFacets, examItems, examItemsOf, examKey, examProgress, isExamKey,
  nextExamItems, normalizeJapanese, parseCloze, type ClozeItem,
} from "../src/exam";
import { Rating, nextSchedule } from "../src/fsrs";
import { buildQueue, facetsFor } from "../src/study";

describe("骨学試験の内容", () => {
  it("穴埋めの文はどれも空欄があり、語の空欄は語につながる", () => {
    const cloze = examItems.filter((item): item is ClozeItem => item.kind === "a");
    expect(cloze.length).toBeGreaterThan(100);
    for (const item of cloze) {
      expect(item.blanks.length).toBeGreaterThan(0);
      for (const blank of item.blanks) if (blank.term) expect(termById.has(blank.term)).toBe(true);
      // 文と空欄の番号を戻すと、空欄の数だけ番号がある
      expect(item.parts.filter((part) => typeof part === "number")).toHaveLength(item.blanks.length);
    }
  });

  it("空欄を文字列と番号に分ける。語の空欄は区別の（）を除いた名前を答えとして見せる", () => {
    const { parts, blanks } = parseCloze("仙骨の{auricular-surface-of-sacrum}は第{=2|二}肋軟骨");
    expect(parts).toEqual(["仙骨の", 0, "は第", 1, "肋軟骨"]);
    expect(blanks[0].display).toBe("耳状面");
    expect(blanks[0].answers).toContain("耳状面（仙骨）");
    expect(blanks[1]).toEqual({ answers: ["2", "二"], display: "2" });
  });

  it("出た回数の多い順に並べ、学んだ項目を飛ばして次を出す", () => {
    const list = examItemsOf("a");
    for (let i = 1; i < list.length; i++) expect(list[i - 1].count).toBeGreaterThanOrEqual(list[i].count);
    const next = nextExamItems("a", new Set([list[0].key]), 3);
    expect(next.map((item) => item.key)).toEqual(list.slice(1, 4).map((item) => item.key));
    expect(nextExamItems("b", new Set(), 5, "general").every((item) => item.area === "general")).toBe(true);
  });

  it("語ごとの試験に出た回数（A・B・C の合計）", () => {
    expect(examCountOf("supracristal-line")).toBeGreaterThanOrEqual(12);
    expect(examCountOf("clavicle")).toBeGreaterThan(0);
    expect(examCountOf("liver")).toBe(0);
  });
});

describe("答え合わせ", () => {
  const answers = ["耳状面（仙骨）", "耳状面", "じじょうめん", "auricular surface", "facies auricularis"];

  it("日本語・読み（カタカナでも）・英語・ラテン語のどれでも正解", () => {
    expect(checkBlank("耳状面", answers)).toBe("correct");
    expect(checkBlank("じじょうめん", answers)).toBe("correct");
    expect(checkBlank("ジジョウメン", answers)).toBe("correct");
    expect(checkBlank("Auricular surface", answers)).toBe("correct");
    expect(checkBlank("facies auricularis", answers)).toBe("correct");
    expect(checkBlank("耳状面(仙骨)", answers)).toBe("correct");
  });

  it("英字の1文字違いは惜しい。日本語は違えば不正解。空は不正解", () => {
    expect(checkBlank("auricular surfase", answers)).toBe("close");
    expect(checkBlank("関節面", answers)).toBe("wrong");
    expect(checkBlank("  ", answers)).toBe("wrong");
  });

  it("異体字（頸・鉤・靭）と全角数字をそろえる", () => {
    expect(normalizeJapanese("頸静脈孔")).toBe(normalizeJapanese("頚静脈孔"));
    expect(checkBlank("有鉤骨", ["有鈎骨"])).toBe("correct");
    expect(checkBlank("円錐靭帯結節", ["円錐靱帯結節"])).toBe("correct");
    expect(checkBlank("７", ["7", "七"])).toBe("correct");
  });

  it("穴埋めの文は、全部正解で Good、1文字違いか（空欄3つ以上で）1つだけまちがいで Hard、ほかは Again", () => {
    expect(clozeRating(["correct", "correct"])).toBe(Rating.Good);
    expect(clozeRating(["correct", "close"])).toBe(Rating.Hard);
    expect(clozeRating(["correct", "correct", "wrong"])).toBe(Rating.Hard);
    expect(clozeRating(["correct", "wrong"])).toBe(Rating.Again);
    expect(clozeRating(["wrong", "wrong", "correct"])).toBe(Rating.Again);
  });

  it("短文記述は、要点を全部で Good、半分以上で Hard、それ未満で Again", () => {
    expect(essayRating(3, 3)).toBe(Rating.Good);
    expect(essayRating(2, 4)).toBe(Rating.Hard);
    expect(essayRating(1, 3)).toBe(Rating.Again);
  });
});

describe("骨学試験の記録と復習", () => {
  const now = new Date("2026-11-01T09:00:00Z");

  it("記録のIDは exam:種類:ID で、語の問い方には混ざらない", () => {
    const key = examKey("b", "clavicle");
    expect(isExamKey(key)).toBe(true);
    expect(examByKey.get(key)?.kind).toBe("b");
    expect(facetsFor(termById.get("clavicle"))).not.toContain("spell");
  });

  it("B は最初にラ→日を解くと、日→英・ラが新しい問い方として復習に出る", () => {
    const key = examKey("b", "clavicle");
    const first = nextSchedule(undefined, key, "read", Rating.Good, now);
    const queue = buildQueue([{ termId: key, unitId: "exam-b", learnedAt: now.toISOString() }], [first], now, 10, () => examFacets.b);
    expect(queue).toEqual([{ termId: key, facet: "spell", isNew: true }]);
  });

  it("進み具合は学んだ数と覚え具合の平均", () => {
    const item = examItemsOf("c")[0];
    const schedule = nextSchedule(undefined, item.key, "explain", Rating.Good, now);
    const progress = examProgress("c", new Set([item.key]), [schedule], new Date(now.getTime() + 86_400_000));
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(examItemsOf("c").length);
    expect(progress.mastery).toBeGreaterThan(0.8);
  });
});
