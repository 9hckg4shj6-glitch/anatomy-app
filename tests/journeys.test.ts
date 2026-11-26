import { termById } from "../src/content";
import { JOURNEYS, optionResult, reaches, rightPath, stopOf, type Journey } from "../src/journeys";
import { BODY_PATHS } from "../src/motion-models/body";
import { LINE_MODELS } from "../src/motion-models/journey-models";
import { shortestRoute } from "../src/motion-models/route";

/** からだの旅（src/journeys.ts）: 語・模型の道・正しい道・違う所に着く道 */

/** 全身の模型の道のつながり（src/ui/motion-models.ts の heartFlow と circulationWorld と同じ） */
const HEART_NEXT: Record<string, string[]> = {
  ra: ["tv"], tv: ["rv"], rv: ["pt"], pt: ["rpa", "lpa"], rpa: ["r-lung-c"], lpa: ["l-lung-c"],
  rspv: ["la"], ripv: ["la"], lspv: ["la"], lipv: ["la"], la: ["mv"], mv: ["lv"], lv: ["aorta"],
  aorta: ["desc", "bct", "lcca", "lsa"], desc: ["aorta-1"], bct: ["r-arm-a"], lcca: ["head-a"], lsa: ["l-arm-a"], svc: ["ra"], ivc: ["ra"],
};
const bloodNext = (id: string): string[] => HEART_NEXT[id] ?? BODY_PATHS[id]?.to.filter(([, w]) => w > 0).map(([to]) => to) ?? [];

function modelNext(journey: Journey): (id: string) => string[] {
  if (journey.id === "blood") return bloodNext;
  const model = LINE_MODELS[journey.id];
  return (id) => model.segments[id]?.to ?? [];
}
function modelHas(journey: Journey, id: string): boolean {
  if (journey.id === "blood") return id in HEART_NEXT || id in BODY_PATHS;
  return id in LINE_MODELS[journey.id].segments;
}

describe("からだの旅のデータ", () => {
  it("所の ID が重ならず、選択肢の行き先がある", () => {
    for (const journey of JOURNEYS) {
      const ids = journey.stops.map((s) => s.id);
      expect(new Set(ids).size, journey.id).toBe(ids.length);
      for (const stop of journey.stops) {
        for (const option of stop.fork?.options ?? []) {
          expect(!!option.to !== !!option.blocked, `${journey.id}/${stop.id}/${option.label}: to か blocked のどちらか`).toBe(true);
          if (option.to) expect(ids, `${journey.id}/${stop.id} → ${option.to}`).toContain(option.to);
        }
        const labels = (stop.fork?.options ?? []).map((o) => o.label);
        expect(new Set(labels).size, `${journey.id}/${stop.id} の選択肢の名前`).toBe(labels.length);
        expect(labels.length === 0 || (labels.length >= 2 && labels.length <= 4), `${journey.id}/${stop.id} の選択肢は2〜4`).toBe(true);
        if (stop.dest) expect(stop.arrive, `${journey.id}/${stop.id} の着いたときの一言`).toBeTruthy();
      }
    }
  });

  it("図鑑の語がある", () => {
    for (const journey of JOURNEYS) {
      for (const stop of journey.stops) {
        if (stop.term) expect(termById.has(stop.term), `${journey.id}/${stop.id}: ${stop.term}`).toBe(true);
        for (const option of stop.fork?.options ?? []) if (option.term) expect(termById.has(option.term), `${journey.id}/${stop.id}/${option.label}: ${option.term}`).toBe(true);
      }
      if (journey.id !== "blood") {
        for (const [id, segment] of Object.entries(LINE_MODELS[journey.id].segments)) if (segment.term) expect(termById.has(segment.term), `${journey.id} の道 ${id}: ${segment.term}`).toBe(true);
      }
    }
  });

  it("所の道が模型にあり、選択肢の先まで模型の道でつながる", () => {
    for (const journey of JOURNEYS) {
      const next = modelNext(journey);
      for (const stop of journey.stops) {
        expect(modelHas(journey, stop.at), `${journey.id}/${stop.id}: 道 ${stop.at}`).toBe(true);
        for (const option of stop.fork?.options ?? []) {
          if (!option.to) continue;
          const to = stopOf(journey, option.to);
          expect(shortestRoute(next, stop.at, to.at), `${journey.id}: ${stop.id}（${stop.at}）→ ${to.id}（${to.at}）`).not.toBeNull();
        }
      }
      if (journey.id !== "blood") {
        const segments = LINE_MODELS[journey.id].segments;
        for (const [id, segment] of Object.entries(segments)) for (const to of segment.to) {
          expect(segments[to], `${journey.id}: ${id} → ${to}`).toBeTruthy();
          // 道の終わりと次の道の初めがつながっている
          const end = segment.points[segment.points.length - 1];
          const start = segments[to].points[0];
          expect(Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]), `${journey.id}: ${id} → ${to} の継ぎ目`).toBeLessThan(0.05);
        }
      }
    }
  });

  it("どの目当ても正しい道を選び続けるとゴールに着く", () => {
    for (const journey of JOURNEYS) {
      for (const mission of journey.missions) {
        const path = rightPath(journey, mission);
        expect(path[0]).toBe(journey.start);
        expect(path[path.length - 1], `${journey.id}/${mission.id}`).toBe(mission.checkpoints[mission.checkpoints.length - 1]);
        for (const checkpoint of mission.checkpoints) expect(path, `${journey.id}/${mission.id} が ${checkpoint} を通る`).toContain(checkpoint);
      }
    }
  });

  it("正しい道の分かれ道には違う選択肢があり、違う臓器に着く道もある", () => {
    for (const journey of JOURNEYS) {
      for (const mission of journey.missions) {
        const path = rightPath(journey, mission);
        let checkpoint = 0;
        let dests = 0;
        for (const id of path) {
          if (id === mission.checkpoints[checkpoint]) checkpoint++;
          if (checkpoint >= mission.checkpoints.length) break;
          const stop = stopOf(journey, id);
          const results = stop.fork!.options.map((o) => optionResult(journey, mission, checkpoint, o));
          expect(results, `${journey.id}/${mission.id}/${id} に正しい道`).toContain("right");
          // 左右の肺のように、どちらでもよい分かれ道だけは違う選択肢が無くてよい
          if (id !== "pt") expect(results.filter((r) => r !== "right").length, `${journey.id}/${mission.id}/${id} に違う選択肢`).toBeGreaterThan(0);
          dests += results.filter((r) => r === "dest").length;
        }
        expect(dests, `${journey.id}/${mission.id}: 違う所に着いてしまう分かれ道`).toBeGreaterThan(0);
      }
    }
  });

  it("血液の1滴: 行き先の臓器は大動脈弓・腹大動脈・分かれ目のどれかから行け、行き先ごとに正しい枝は1つ", () => {
    const blood = JOURNEYS.find((j) => j.id === "blood")!;
    for (const mission of blood.missions) {
      for (const fork of ["arch", "abd", "iliac"]) {
        const stop = stopOf(blood, fork);
        if (!reaches(blood, fork, mission.checkpoints[0])) continue;
        const right = stop.fork!.options.filter((o) => optionResult(blood, mission, 0, o) === "right");
        expect(right.length, `${mission.id}/${fork}`).toBe(1);
      }
    }
  });
});
