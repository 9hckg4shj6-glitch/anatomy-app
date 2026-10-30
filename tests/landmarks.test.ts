import { distanceToPin, hitsPin, landmarkAt, nearbyLandmarks, nestedPins, regionGap } from "../src/landmarks";
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

  it("区域（骨頭など）は、囲む球の中で切る面の表側ならどこでも当たり。左側は折り返す", () => {
    // 中心 (-0.1, 1, 0)・半径 3cm の球を、y = 1 の面で切った上半分（骨頭の形の代わり）
    const head: Pin = { at: [[-0.1, 1.02, 0]], r: 0.01, region: { c: [-0.1, 1, 0], r: 0.03, cut: [[0, 1, 0, -1]] } };
    expect(hitsPin([-0.1, 1.025, 0.02], head)).toBe(true);
    expect(hitsPin([0.1, 1.025, 0.02], head)).toBe(true);
    expect(regionGap([-0.1, 0.99, 0], head)).toBeCloseTo(0.01);
    expect(hitsPin([-0.1, 0.99, 0], head)).toBe(false);
    expect(hitsPin([-0.1, 1.04, 0], head)).toBe(false);
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

  it("範囲が入れ子の部位（椎弓と椎弓根、粗線と内側唇）は4択に並べない（どちらも正しくなる）", () => {
    const arch = pin([[-0.016, 1, 0.078], [-0.007, 0.989, 0.061]], 0.009);
    expect(nestedPins(pin([[-0.016, 1, 0.078]], 0.007), arch)).toBe(true);
    expect(nestedPins(arch, pin([[-0.016, 1, 0.078]], 0.007))).toBe(true);
    expect(nestedPins(arch, pin([[-0.04, 1, 0.07]], 0.008))).toBe(false);
    expect(nearbyLandmarks("pedicle-of-vertebral-arch")).not.toContain("vertebral-arch");
    expect(nearbyLandmarks("lunate-surface")).not.toContain("acetabulum");
    // 関節で向かい合う別の骨の部位は残す
    expect(nearbyLandmarks("head-of-femur")).toContain("acetabulum");
    // 薄い骨の表と裏の部位も残す
    expect(nearbyLandmarks("infraspinous-fossa")).toContain("subscapular-fossa");
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

  it("区域の中では、中にある小さな部位の中心近くを選ぶ（大腿骨頭と大腿骨頭窩）", async () => {
    const { pins } = await import("../src/content");
    pins["test-head"] = { at: [[-0.1, 1.02, 0]], r: 0.01, region: { c: [-0.1, 1, 0], r: 0.03, cut: [[0, 1, 0, -1]] } };
    pins["test-fovea"] = pin([[-0.1, 1.025, 0.01]], 0.004);
    const terms = [{ id: "test-head" }, { id: "test-fovea" }] as Term[];
    expect(landmarkAt([-0.1, 1.025, 0.01], terms)?.id).toBe("test-fovea");
    expect(landmarkAt([-0.08, 1.01, -0.01], terms)?.id).toBe("test-head");
    expect(landmarkAt([-0.1, 0.98, 0], terms)).toBeNull();
    delete pins["test-head"];
    delete pins["test-fovea"];
  });
});
