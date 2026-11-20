import fs from "node:fs";
import {
  breathWeights, cardiacTimeline, conductionStep, cyclic, ecg, heartDisplace, heartState, inhaling, phaseAt, Polyline, ROUTE_SHARE, routeLine, sampleField,
  type BreathingData, type CardiacCycle, type CirculationData, type HeartData,
} from "../src/motions";
import type { Vec3 } from "../src/landmarks";

const read = <T>(name: string): T => JSON.parse(fs.readFileSync(`public/motions/${name}.json`, "utf8")) as T;
const cycle = read<CardiacCycle>("cardiac-cycle");
const breathing = read<BreathingData>("breathing");
const heart = read<HeartData>("heart");
const circulation = read<CirculationData>("circulation");

describe("心周期（ModularCirc の Korakianitis のモデル）", () => {
  it("左心室の容積と圧が生理的な値になる", () => {
    const lv = cycle.volume.lv;
    const sv = Math.max(...lv) - Math.min(...lv);
    expect(sv).toBeGreaterThan(60);
    expect(sv).toBeLessThan(110);
    expect(Math.max(...cycle.pressure.lv)).toBeGreaterThan(100);
    expect(Math.max(...cycle.pressure.rv)).toBeLessThan(45);
    // 左右の拍出量はそろう
    const rv = cycle.volume.rv;
    expect(Math.abs(Math.max(...rv) - Math.min(...rv) - sv)).toBeLessThan(3);
  });

  it("区分が心房収縮→等容性収縮→駆出→等容性弛緩→充満の順に並び、Ⅰ音・Ⅱ音の時刻が決まる", () => {
    const timeline = cardiacTimeline(cycle);
    const order = timeline.spans.map((span) => span.key);
    const first = (key: string) => order.indexOf(key as never);
    expect(first("rapidEjection")).toBeLessThan(first("reducedEjection"));
    expect(first("reducedEjection")).toBeLessThan(first("isoRelaxation"));
    expect(first("isoRelaxation")).toBeLessThan(first("rapidFilling"));
    expect(first("rapidFilling")).toBeLessThan(first("diastasis"));
    expect(first("diastasis")).toBeLessThan(first("atrial"));
    expect(order).toContain("isoContraction");
    expect(phaseAt(timeline, 0.15)).toMatch(/Ejection/);
    expect(phaseAt(timeline, 0.7)).toBe("diastasis");
    expect(timeline.s2).toBeGreaterThan(0.25);
    expect(timeline.s2).toBeLessThan(0.4);
    expect(timeline.s1 > 0.9 || timeline.s1 < 0.05).toBe(true);
  });

  it("心電図の R 波は心室の収縮の始まりの直前", () => {
    expect(ecg(0.976)).toBeGreaterThan(0.9);
    expect(ecg(0.6)).toBeLessThan(0.05);
  });

  it("収縮期は心室が縮み、動脈弁が開いて房室弁が閉じる", () => {
    const systole = heartState(cycle, 0.2);
    expect(systole.cvL).toBeGreaterThan(0.5);
    expect(systole.open.ao).toBeGreaterThan(0.5);
    expect(systole.open.mi).toBe(0);
    const diastole = heartState(cycle, 0.6);
    expect(diastole.cvL).toBeLessThan(0.5);
    expect(diastole.open.ao).toBe(0);
    expect(diastole.open.mi).toBeGreaterThan(0);
  });

  it("心室の壁は収縮期に長軸へ寄り、心底は心尖へ下がる。心尖はほとんど動かない", () => {
    const out: Vec3 = [0, 0, 0];
    const systole = heartState(cycle, 0.25);
    heartDisplace(heart, systole, heart.apex, "wall", out);
    expect(Math.hypot(...out)).toBeLessThan(0.002);
    heartDisplace(heart, systole, heart.base, "wall", out);
    const toApex = out[0] * heart.axis[0] + out[1] * heart.axis[1] + out[2] * heart.axis[2];
    expect(toApex).toBeGreaterThan(0.005);
  });
});

describe("刺激伝導系", () => {
  it("洞房結節 → 心房 → 房室結節 → ヒス束 → プルキンエ線維 → 休み の順", () => {
    expect([0.856, 0.88, 0.93, 0.97, 0.995, 0.01, 0.4].map(conductionStep)).toEqual(["sa", "atria", "av", "bundle", "purkinje", "purkinje", "rest"]);
  });
});

describe("呼吸（4DMRI moving meshes）", () => {
  it("1回換気量は 300〜600 mL、周期は 3〜7 秒", () => {
    const tidal = Math.max(...breathing.volume);
    expect(tidal).toBeGreaterThan(300);
    expect(tidal).toBeLessThan(600);
    expect(breathing.period).toBeGreaterThan(3);
    expect(breathing.period).toBeLessThan(7);
    expect(inhaling(breathing, 0.2)).toBe(true);
    expect(inhaling(breathing, 0.7)).toBe(false);
  });

  it("吸うと肺底が下がり、前胸壁が前へ出る", () => {
    const u = breathing.volume.indexOf(Math.max(...breathing.volume)) / breathing.phases;
    const disp = (field: "lung" | "chest", p: Vec3): Vec3 => {
      const [w0, w1] = breathWeights(breathing, field, u);
      const a: Vec3 = [0, 0, 0];
      const b: Vec3 = [0, 0, 0];
      sampleField(breathing, field, 0, ...p, a);
      sampleField(breathing, field, 1, ...p, b);
      return [a[0] * w0 + b[0] * w1, a[1] * w0 + b[1] * w1, a[2] * w0 + b[2] * w1];
    };
    // 右肺の底（横隔膜のドームの上）
    expect(disp("lung", [-0.07, 1.13, 0.09])[1]).toBeLessThan(-0.008);
    // 胸骨体（前胸壁）
    expect(disp("chest", [0, 1.22, 0.175])[2]).toBeGreaterThan(0.001);
    // 格子の外は動かない
    expect(disp("lung", [0, 0.2, 0])).toEqual([0, 0, 0]);
  });
});

describe("血液の流れの道すじ", () => {
  it("体循環は左心室から右心房へ、肺循環は右心房から左心室へ戻り、毛細血管がある", () => {
    const near = (a: Float32Array, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.005;
    const out = new Float32Array(3);
    for (const route of circulation.routes) {
      const line = routeLine(route);
      line.at(0, out);
      expect(near(out, route.kind === "systemic" ? heart.chambers.lv : heart.chambers.ra)).toBe(true);
      line.at(line.length, out);
      expect(near(out, route.kind === "systemic" ? heart.chambers.ra : heart.chambers.lv)).toBe(true);
      expect(route.capillary[1]).toBeGreaterThan(route.capillary[0]);
      expect(line.length).toBeGreaterThan(0.3);
    }
    expect(Object.values(ROUTE_SHARE).reduce((a, b) => a + b, 0)).toBe(100);
    for (const route of circulation.routes.filter((r) => r.kind === "systemic")) expect(ROUTE_SHARE[route.id]).toBeGreaterThan(0);
  });

  it("折れ線の上を長さで進む・周期の値を補う", () => {
    const line = Polyline.of([[0, 0, 0], [1, 0, 0], [1, 2, 0]]);
    expect(line.length).toBe(3);
    const out = new Float32Array(3);
    line.at(2, out);
    expect([...out]).toEqual([1, 1, 0]);
    expect(cyclic([0, 10], 0.75)).toBe(5);
  });
});
