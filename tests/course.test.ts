import "fake-indexeddb/auto";
import { termById, units } from "../src/content";
import { beginnerPoints, beginnerUnits, courseTerms, courseUnitOf, courseUnits, inCourse, lessonById, studyFacets } from "../src/course";
import { db } from "../src/db";
import { loadPreferences, preferences } from "../src/settings";
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
      expect(more.textContent).not.toContain(termById.get("humerus")!.note);
      more.open = true;
      more.dispatchEvent(new Event("toggle"));
      expect(more.textContent).toContain(termById.get("humerus")!.note);
    });
    await withMode("detail", () => {
      const card = termCard(termById.get("humerus")!);
      expect(card.querySelector(".term-point")).toBeNull();
      expect(card.textContent).toContain(termById.get("humerus")!.note);
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
});
