import { distanceToPin, hitsPin, landmarkAt, nearbyLandmarks } from "../src/landmarks";
import { termById, type Pin, type Term } from "../src/content";

const pin = (at: [number, number, number][], r = 0.01): Pin => ({ at, r });

describe("骨の部位のピン", () => {
  it("左側の骨をタップしても、右側に打ったピンと左右を折り返して比べる", () => {
    const p = pin([[-0.2, 1.3, 0.05]]);
    expect(distanceToPin([-0.2, 1.3, 0.05], p)).toBeCloseTo(0);
    expect(distanceToPin([0.2, 1.3, 0.05], p)).toBeCloseTo(0);
    expect(hitsPin([0.2, 1.31, 0.05], p)).toBe(true);
    expect(hitsPin([0.2, 1.35, 0.05], p)).toBe(false);
  });

  it("稜や線は、どれかの点の近くなら当たり", () => {
    const crest = pin([[-0.1, 1, 0], [-0.1, 1.05, 0], [-0.1, 1.1, 0]], 0.005);
    expect(hitsPin([-0.1, 1.052, 0.001], crest)).toBe(true);
    expect(hitsPin([-0.1, 1.2, 0], crest)).toBe(false);
  });
});

describe("器官の部位のピン", () => {
  it("左右の無い器官の部位（one）は折り返さない（幽門の反対側は胃体なので）", () => {
    const pylorus: Pin = { at: [[-0.03, 1.05, 0.12]], r: 0.01, one: true };
    expect(hitsPin([-0.03, 1.05, 0.12], pylorus)).toBe(true);
    expect(hitsPin([0.03, 1.05, 0.12], pylorus)).toBe(false);
  });

  it("4択の近い部位は、同じ系統の部位から選ぶ（胃の部位に骨の部位を混ぜない）", () => {
    const near = nearbyLandmarks("pylorus");
    expect(near.length).toBeGreaterThan(3);
    for (const id of near) expect(termById.get(id)?.system).toBe("digestive");
  });
});

describe("タップした所の部位", () => {
  it("広い窩より、しっかり当たっている狭い突起を選ぶ", async () => {
    const { pins } = await import("../src/content");
    pins["test-fossa"] = pin([[-0.1, 1, 0]], 0.03);
    pins["test-process"] = pin([[-0.1, 1.01, 0]], 0.006);
    const terms = [{ id: "test-fossa" }, { id: "test-process" }] as Term[];
    expect(landmarkAt([-0.1, 1.012, 0], terms)?.id).toBe("test-process");
    expect(landmarkAt([-0.1, 0.98, 0], terms)?.id).toBe("test-fossa");
    expect(landmarkAt([-0.1, 1.2, 0], terms)).toBeNull();
    delete pins["test-fossa"];
    delete pins["test-process"];
  });
});
