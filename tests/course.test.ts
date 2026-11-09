import "fake-indexeddb/auto";
import { termById, units } from "../src/content";
import { beginnerPoints, beginnerUnits, courseTerms, courseUnitOf, courseUnits, inCourse, lessonById, studyFacets } from "../src/course";
import { db } from "../src/db";
import { noteText, withoutEnglish } from "../src/en-notes";
import { loadPreferences, preferences, setPreference } from "../src/settings";
import { normalize, searchTerms, searchUnits } from "../src/search";
import { facetsFor, MUSCLE_FACETS, TERM_FACETS } from "../src/study";
import { nextLesson } from "../src/ui/lessons";
import { todayCounts } from "../src/ui/review";
import { termCard } from "../src/ui/term-card";

const withMode = async (mode: "beginner" | "detail", run: () => void | Promise<void>) => {
  const before = preferences.mode;
  preferences.mode = mode;
  try {
    await run();
  } finally {
    preferences.mode = before;
  }
};

describe("初心者コース", () => {
  it("どの語にも覚えることがあり、語は1つのレッスンにだけ入る", () => {
    const ids = beginnerUnits.flatMap((unit) => unit.terms.map((term) => term.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(300);
    expect(ids.every((id) => termById.has(id) && beginnerPoints.get(id))).toBe(true);
    // 基本の用語と、骨・筋・心臓・脳神経の大事な語が入る
    for (const id of ["anterior", "flexion", "humerus", "femur", "biceps-brachii", "left-ventricle", "vagus-nerve", "trochlear-nerve"]) expect(ids).toContain(id);
    // 細かい語は入らない
    for (const id of ["medial-circumflex-femoral-artery", "lateral-spinothalamic-tract", "foramen-spinosum"]) expect(ids).not.toContain(id);
  });

  it("初心者モードではレッスン・語・検索がコースのものだけになり、詳細モードではすべて", async () => {
    await withMode("beginner", () => {
      expect(courseUnits()).toBe(beginnerUnits);
      expect(courseTerms().every((term) => beginnerPoints.has(term.id))).toBe(true);
      expect(inCourse("humerus")).toBe(true);
      expect(inCourse("foramen-spinosum")).toBe(false);
      expect(searchTerms(normalize("きょくこう"))).toHaveLength(0);
      expect(searchUnits(normalize("頭蓋")).every((unit) => unit.id.startsWith("b-"))).toBe(true);
      expect(courseUnitOf("humerus")?.id).toBe("b-skel-arm");
    });
    await withMode("detail", () => {
      expect(courseUnits()).toBe(units);
      expect(inCourse("foramen-spinosum")).toBe(true);
      expect(searchTerms(normalize("きょくこう")).map((term) => term.id)).toContain("foramen-spinosum");
      expect(courseUnitOf("humerus")?.id).toBe(termById.get("humerus")!.unit);
    });
    // どちらのモードのレッスンも開ける
    expect(lessonById.get("b-skel-arm")?.terms.map((term) => term.id)).toContain("humerus");
    expect(lessonById.get(termById.get("humerus")!.unit)).toBeTruthy();
  });

  it("初心者モードでは筋の起始・停止などと通るものを出さない", async () => {
    preferences.studyFacets = [...TERM_FACETS];
    await withMode("beginner", () => {
      const facets = facetsFor(termById.get("biceps-brachii"), true, studyFacets());
      expect(facets.some((facet) => MUSCLE_FACETS.includes(facet))).toBe(false);
      expect(facets).toContain("locate");
      expect(facetsFor(termById.get("foramen-ovale"), true, studyFacets())).not.toContain("passage");
    });
    await withMode("detail", () => {
      expect(facetsFor(termById.get("biceps-brachii"), true, studyFacets())).toContain("attach");
    });
  });

  it("次のレッスンは今のモードのレッスンから選ぶ", async () => {
    await withMode("beginner", () => {
      expect(nextLesson([])?.id).toBe(beginnerUnits[0].id);
      // 詳細モードで学んだ語も、初心者コースに入っていれば学んだことになる
      const learned = beginnerUnits[0].terms.map((term) => ({ termId: term.id, unitId: term.unit, learnedAt: "2026-11-01T00:00:00.000Z" }));
      expect(nextLesson(learned)?.id).toBe(beginnerUnits[1].id);
    });
    await withMode("detail", () => {
      expect(nextLesson([])?.id).toBe(units[0].id);
    });
  });

  it("初心者モードの語のカードは覚えることを出し、説明は「くわしく」の中にたたむ", async () => {
    await withMode("beginner", () => {
      const card = termCard(termById.get("humerus")!);
      expect(card.querySelector(".term-point")?.textContent).toContain(beginnerPoints.get("humerus")!);
      const more = card.querySelector("details.term-more") as HTMLDetailsElement;
      expect(more.textContent).not.toContain(noteText(termById.get("humerus")!.note));
      more.open = true;
      more.dispatchEvent(new Event("toggle"));
      expect(more.textContent).toContain(noteText(termById.get("humerus")!.note));
    });
    await withMode("detail", () => {
      const card = termCard(termById.get("humerus")!);
      expect(card.querySelector(".term-point")).toBeNull();
      expect(card.textContent).toContain(noteText(termById.get("humerus")!.note));
    });
  });
});

describe("説明の英語の併記", () => {
  afterEach(() => {
    preferences.enNotes = false;
  });

  it("ふだんは日本語だけで、添えた英語だけを外す（もとからの英語は残す）", () => {
    const note = termById.get("humerus")!.note;
    expect(note).toContain("肩甲骨（scapula）");
    expect(preferences.enNotes).toBe(false);
    expect(noteText(note)).not.toMatch(/（[A-Za-z]/);
    expect(noteText(note)).toContain("肩甲骨と、肘で橈骨・尺骨と関節をつくる");
    expect(withoutEnglish("頭側（cranial）とも言う。肩甲骨（scapula）の上")).toBe("頭側（cranial）とも言う。肩甲骨の上");
    expect(withoutEnglish("脊髄神経（C1〜C8）")).toBe("脊髄神経（C1〜C8）");
    preferences.enNotes = true;
    expect(noteText(note)).toBe(note);
  });

  it("語のカードの「英語を併記」で切り替えて、設定に残す", async () => {
    await withMode("detail", async () => {
      const term = termById.get("humerus")!;
      const card = termCard(term);
      expect(card.textContent).not.toContain("（scapula）");
      const toggle = card.querySelector(".en-toggle button") as HTMLButtonElement;
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      toggle.click();
      await vi.waitFor(() => expect(card.textContent).toContain("（scapula）"));
      expect(preferences.enNotes).toBe(true);
      expect((await db.settings.get("enNotes"))?.value).toBe(true);
      await setPreference("enNotes", false);
    });
  });
});

describe("初心者モードの復習と、モードの初め", () => {
  beforeEach(async () => {
    await Promise.all([db.learned.clear(), db.schedules.clear(), db.reviewEvents.clear(), db.settings.clear()]);
    preferences.mode = "detail";
    preferences.studyFacets = [...TERM_FACETS];
  });

  it("初心者モードの復習にはコースの語だけが出る（ほかの語の記録は残る）", async () => {
    const learnedAt = "2026-11-01T00:00:00.000Z";
    await db.learned.bulkPut([
      { termId: "humerus", unitId: "skel-upper", learnedAt },
      { termId: "foramen-spinosum", unitId: "skel-pt-cranial-foramina", learnedAt },
    ]);
    const detail = await todayCounts();
    await withMode("beginner", async () => {
      const beginner = await todayCounts();
      expect(beginner.fresh).toBeLessThan(detail.fresh);
      expect(beginner.fresh).toBe(facetsFor(termById.get("humerus"), false, studyFacets()).length);
    });
  });

  it("モードを選んでいなければ、何も学んでいない人は初心者モード、学んだ人は詳細モードになる", async () => {
    await loadPreferences();
    expect(preferences.mode).toBe("beginner");
    expect((await db.settings.get("mode"))?.value).toBe("beginner");

    await db.settings.clear();
    preferences.mode = "detail";
    await db.learned.put({ termId: "humerus", unitId: "skel-upper", learnedAt: "2026-11-01T00:00:00.000Z" });
    await loadPreferences();
    expect(preferences.mode).toBe("detail");
  });

  it("学ぶ問い方を保存したあとに増えた問い方（向き・ホルモン）は学ぶ側に入り、外したものは外したまま", async () => {
    await db.settings.clear();
    await db.settings.put({ key: "studyFacets", value: ["locate", "point", "attach", "nerve", "action"], updatedAt: "2026-11-01T00:00:00.000Z" });
    await loadPreferences();
    expect(preferences.studyFacets).toEqual(["locate", "point", "attach", "nerve", "action", "relation", "hormone"]);
    // 向きの入ったあと（seenFacets に向きまである）に増えたホルモンも入る
    await db.settings.put({ key: "seenFacets", value: ["locate", "point", "ja2en", "en2ja", "attach", "nerve", "action", "passage", "relation"], updatedAt: "2026-11-05T00:00:00.000Z" });
    await db.settings.put({ key: "studyFacets", value: ["locate", "point", "relation"], updatedAt: "2026-11-05T00:00:00.000Z" });
    await loadPreferences();
    expect(preferences.studyFacets).toEqual(["locate", "point", "relation", "hormone"]);
    // 2回目からは足さない（設定で向きを外したら外したまま）
    await db.settings.put({ key: "studyFacets", value: ["locate", "point"], updatedAt: "2026-11-02T00:00:00.000Z" });
    await loadPreferences();
    expect(preferences.studyFacets).toEqual(["locate", "point"]);
  });
});
