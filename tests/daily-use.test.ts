import "fake-indexeddb/auto";
import { termById } from "../src/content";
import { exportBackup, importBackup } from "../src/backup";
import { db } from "../src/db";
import { loadMarks, markOf, setMark, starredIds } from "../src/marks";
import { courseOf, preferences, setCourse } from "../src/settings";
import { weekDays } from "../src/ui/home";
import { nextLesson } from "../src/ui/lessons";
import { termCard } from "../src/ui/term-card";

/** docs/普段使い.md のその1（コース・今週の日・★とメモ） */
describe("普段使い その1", () => {
  const before = { course: preferences.course, mode: preferences.mode };
  afterEach(async () => {
    preferences.course = before.course;
    preferences.mode = before.mode;
    await db.settings.clear();
    await loadMarks();
  });

  it("コースからモードが決まり、まだ選んでいなければモードからコースを読む", async () => {
    await setCourse("basic");
    expect(preferences.mode).toBe("beginner");
    await setCourse("exam");
    expect(preferences.mode).toBe("detail");
    expect(courseOf()).toBe("exam");
    preferences.course = "";
    preferences.mode = "beginner";
    expect(courseOf()).toBe("basic");
    preferences.mode = "detail";
    expect(courseOf()).toBe("free");
  });

  it("骨学試験のコースで何も学んでいなければ、最初のレッスンは骨格系", async () => {
    await setCourse("exam");
    expect(nextLesson([])?.system).toBe("skeletal");
    await setCourse("free");
    expect(nextLesson([])?.system).toBe("basics");
  });

  it("今週（月曜から）に解いた日を数える。先週の日と同じ日の2問は1日", () => {
    // 2026-11-19 は木曜。月曜は 11-16
    const now = new Date(2026, 10, 19, 21);
    const at = (d: number, hour = 9) => ({ reviewedAt: new Date(2026, 10, d, hour).toISOString() });
    expect(weekDays([at(15), at(16), at(16, 22), at(18), at(19)], now)).toBe(3);
    expect(weekDays([], now)).toBe(0);
  });

  it("★とメモを語ごとに残し、記録の書き出し・読み込みで語ごとに新しい方を残す", async () => {
    await setMark("humerus", { starred: true, memo: " 顆上骨折 " });
    expect(markOf("humerus")).toEqual({ starred: true, memo: "顆上骨折" });
    expect(starredIds()).toEqual(["humerus"]);
    const backup = await exportBackup();
    await db.settings.clear();
    await loadMarks();
    expect(markOf("humerus").starred).toBe(false);
    await importBackup(backup);
    await loadMarks();
    expect(markOf("humerus")).toEqual({ starred: true, memo: "顆上骨折" });
  });

  it("語のカードの☆で★を付け外しする", async () => {
    const card = termCard(termById.get("femur")!);
    const star = card.querySelector<HTMLButtonElement>(".star-button")!;
    expect(star.getAttribute("aria-pressed")).toBe("false");
    star.click();
    await vi.waitFor(() => expect(markOf("femur").starred).toBe(true));
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect((await db.settings.get("mark:femur"))?.value).toEqual({ starred: true, memo: "" });
  });
});
