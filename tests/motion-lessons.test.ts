import fs from "node:fs";
import { LESSONS } from "../src/motion-lessons";
import { CARDIAC_PHASES, CONDUCTION_STEPS, spanStart, type CycleSpan } from "../src/motions";
import { STATIONS } from "../src/motion-models/route";
import { buildHeart } from "../src/motion-models/heart";
import { buildLungs } from "../src/motion-models/lungs";
import { ORGANS } from "../src/motion-models/body";
import { MIN_STEP_SECONDS, playRate } from "../src/ui/motions";

/** 動きの図鑑の学ぶ流れ（docs/動きの図鑑.md「学ぶ目当てと1つずつ」） */
describe("学ぶ流れの内容", () => {
  it("どの動きにも学ぶこと3つと覚えることがある", () => {
    for (const lesson of Object.values(LESSONS)) {
      expect(lesson.goals).toHaveLength(3);
      expect(lesson.points.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("心周期の7つの時期・刺激伝導の6つの段階・吸気と呼気のすべてに「ここを見る」と「なぜ」がある", () => {
    const cases: [keyof typeof LESSONS, string[]][] = [
      ["heartbeat", Object.keys(CARDIAC_PHASES)],
      ["conduction", Object.keys(CONDUCTION_STEPS)],
      ["breathing", ["in", "out"]],
    ];
    for (const [id, keys] of cases) {
      for (const key of keys) {
        expect(LESSONS[id].steps[key]?.look, `${id} ${key}`).toBeTruthy();
        expect(LESSONS[id].steps[key]?.why, `${id} ${key}`).toBeTruthy();
      }
    }
  });

  it("循環の学ぶ流れは、1滴の駅の名前（STATIONS）に合う", () => {
    for (const key of Object.keys(LESSONS.circulation.steps)) expect(STATIONS[key], key).toBeTruthy();
  });

  it("光らせる札（focus）は模型の札の文字にある", () => {
    const heart = buildHeart({ conduction: true });
    const heartTags = new Set([...heart.tags.map((t) => t.text), "洞房結節", "房室結節", "ヒス束", "右脚", "左脚", "プルキンエ線維"]);
    const lungTags = new Set(buildLungs().tags.map((t) => t.text));
    const bodyTags = new Set([...ORGANS.map((o) => o.ja), "大動脈", "下大静脈", "上大静脈", "門脈", "肺動脈", "肺静脈", "心臓"]);
    const sets = { heartbeat: heartTags, conduction: heartTags, breathing: lungTags, circulation: bodyTags };
    for (const [id, lesson] of Object.entries(LESSONS) as [keyof typeof sets, (typeof LESSONS)[keyof typeof LESSONS]][]) {
      for (const [key, step] of Object.entries(lesson.steps)) {
        for (const text of step.focus ?? []) expect(sets[id].has(text), `${id} ${key} ${text}`).toBe(true);
      }
    }
  });

  it("札の文字は src/ui/motion-models.ts の循環の札と同じ（ここで足した名前が本当にある）", () => {
    const source = fs.readFileSync("src/ui/motion-models.ts", "utf8");
    for (const text of ["大動脈", "下大静脈", "上大静脈", "門脈", "肺動脈", "肺静脈", "心臓"]) expect(source).toContain(`text: "${text}"`);
  });
});

describe("1つずつの速さ", () => {
  it("短い区分は MIN_STEP_SECONDS より短く見せず、長い区分と続けて見るは選んだ速さのまま", () => {
    // 等容性収縮期（約 0.05 秒）は ¼ でも 0.2 秒で過ぎてしまうので、4 秒になるよう遅くする
    expect(0.05 / playRate(0.25, true, 0.05)).toBeCloseTo(MIN_STEP_SECONDS);
    expect(playRate(0.25, true, 3)).toBe(0.25);
    expect(playRate(0.25, false, 0.05)).toBe(0.25);
    expect(playRate(0.5, true, null)).toBe(0.5);
  });

  it("区分へ移るときは、区分の中の割合の所へ（1周をまたぐ区分も 0〜1 に）", () => {
    const spans: CycleSpan[] = [{ key: "a", from: 0.9, to: 1.1 }, { key: "b", from: 1.1, to: 1.9 }];
    expect(spanStart(spans, 0, 0.5)).toBeCloseTo(0);
    expect(spanStart(spans, 1, 0.25)).toBeCloseTo(0.3);
    expect(spanStart(spans, 1)).toBeCloseTo(0.104);
  });
});
