import "fake-indexeddb/auto";
import { termById, terms, units } from "../src/content";
import { courseLesson, courseTerms, courseUnitOf, courseUnits, inCourse, pointOf, standardTermCount, standardUnits } from "../src/course";
import { db } from "../src/db";
import { courseOf, preferences, setCourse } from "../src/settings";
import { noteText } from "../src/en-notes";
import { nextLesson } from "../src/ui/lessons";
import { termCard } from "../src/ui/term-card";

// 標準のコース（docs/学びやすさ.md の案2）: 必修と基礎の語（level 1・2）だけ
describe("標準のコース", () => {
  const before = { course: preferences.course, mode: preferences.mode };
  afterEach(async () => {
    preferences.course = before.course;
    preferences.mode = before.mode;
    await db.settings.clear();
  });

  it("「標準」を選ぶと標準モードになり、必修と基礎の語だけを学ぶ", async () => {
    await setCourse("standard");
    expect(preferences.mode).toBe("standard");
    expect(courseOf()).toBe("standard");
    const list = courseTerms();
    expect(list.length).toBe(standardTermCount);
    expect(list.every((term) => term.level <= 2)).toBe(true);
    expect(list.length).toBe(terms.filter((term) => term.level <= 2).length);
    expect(list.length).toBeLessThan(terms.length);
    expect(courseUnits()).toBe(standardUnits);
    // 発展の語は入らない
    const advanced = terms.find((term) => term.level === 3)!;
    expect(inCourse(advanced.id)).toBe(false);
    expect(courseUnitOf(advanced.id)).toBeUndefined();
    expect(inCourse("humerus")).toBe(true);
  });

  it("レッスンは詳細モードと同じID で、発展の語を除いたもの", async () => {
    await setCourse("standard");
    const mixed = units.find((unit) => unit.terms.some((term) => term.level === 3) && unit.terms.some((term) => term.level <= 2))!;
    const lesson = courseLesson(mixed.id)!;
    expect(lesson.id).toBe(mixed.id);
    expect(lesson.terms.length).toBeLessThan(mixed.terms.length);
    expect(lesson.terms.every((term) => term.level <= 2)).toBe(true);
    expect(courseUnitOf("humerus")?.id).toBe(termById.get("humerus")!.unit);
    // 語の残らないレッスンは出さない
    expect(standardUnits.every((unit) => unit.terms.length > 0)).toBe(true);
    // 次のレッスンも標準のレッスン（学んだ語の続き）
    const first = nextLesson([])!;
    expect(standardUnits).toContain(first);
    const learned = first.terms.map((term) => ({ termId: term.id, unitId: first.id, learnedAt: "2026-11-01T00:00:00.000Z" }));
    expect(standardUnits).toContain(nextLesson(learned));
    expect(nextLesson(learned)).not.toBe(first);
  });

  it("すべての語は詳細モード", async () => {
    await setCourse("free");
    expect(preferences.mode).toBe("detail");
    expect(courseTerms()).toHaveLength(terms.length);
  });

  it("標準の語にはどれも覚えること（70字まで）があり、語のカードは覚えることを上に、説明を「くわしく」の中に出す", async () => {
    await setCourse("standard");
    for (const term of courseTerms()) {
      expect(pointOf(term.id), term.id).toBeTruthy();
      expect(pointOf(term.id)!.length).toBeLessThanOrEqual(70);
    }
    // 初心者コースに無い標準の語
    const term = termById.get("deep-femoral-artery")!;
    const card = termCard(term);
    expect(card.querySelector(".term-point")?.textContent).toContain(pointOf(term.id)!);
    const more = card.querySelector("details.term-more") as HTMLDetailsElement;
    expect(card.textContent).not.toContain(noteText(term.note));
    more.open = true;
    more.dispatchEvent(new Event("toggle"));
    expect(more.textContent).toContain(noteText(term.note));
    // 筋の起始・停止は標準でもすぐ見える
    expect(termCard(termById.get("biceps-brachii")!).querySelector(".muscle-notes")).toBeTruthy();
    // 発展の語は今までどおり説明を出す
    const advanced = terms.find((item) => item.level === 3)!;
    expect(termCard(advanced).querySelector(".term-desc")).toBeTruthy();
    // 詳細モードは今までどおり
    await setCourse("free");
    expect(termCard(term).querySelector(".term-desc")).toBeTruthy();
  });
});
