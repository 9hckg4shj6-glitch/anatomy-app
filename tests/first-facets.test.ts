import "fake-indexeddb/auto";
import { db } from "../src/db";
import { FIRST_FACETS, loadPreferences, preferences, setCourse } from "../src/settings";
import { TERM_FACETS } from "../src/study";

// 問い方は初めは3つ（docs/学びやすさ.md の案5）
describe("初めの学ぶ問い方", () => {
  beforeEach(async () => {
    await Promise.all([db.learned.clear(), db.schedules.clear(), db.reviewEvents.clear(), db.settings.clear()]);
    preferences.studyFacets = [...FIRST_FACETS];
    preferences.course = "";
    preferences.mode = "detail";
  });

  it("はじめて使う人は 位置→名前・名前→位置・日本語→英語 の3つ", async () => {
    await loadPreferences();
    expect(preferences.studyFacets).toEqual(["locate", "point", "ja2en"]);
    // 学んだあとで開き直しても3つのまま
    await db.learned.put({ termId: "humerus", unitId: "skel-upper", learnedAt: "2026-11-18T00:00:00.000Z" });
    await loadPreferences();
    expect(preferences.studyFacets).toEqual(["locate", "point", "ja2en"]);
  });

  it("今まで使っていた人（学んだ語があり、問い方を選んでいない）は、すべての問い方のまま", async () => {
    await db.learned.put({ termId: "humerus", unitId: "skel-upper", learnedAt: "2026-11-01T00:00:00.000Z" });
    await loadPreferences();
    expect(preferences.studyFacets).toEqual(TERM_FACETS);
    expect((await db.settings.get("studyFacets"))?.value).toEqual(TERM_FACETS);
  });

  it("コース「すべての語」を選ぶとすべての問い方、自分で選んだ問い方は変えない", async () => {
    await loadPreferences();
    await setCourse("standard");
    expect(preferences.studyFacets).toEqual(FIRST_FACETS);
    await setCourse("free");
    expect(preferences.studyFacets).toEqual(TERM_FACETS);

    await db.settings.clear();
    preferences.studyFacets = ["locate", "en2ja"];
    await db.settings.put({ key: "studyFacets", value: ["locate", "en2ja"], updatedAt: "2026-11-18T00:00:00.000Z" });
    await setCourse("free");
    expect(preferences.studyFacets).toEqual(["locate", "en2ja"]);
  });
});
