import fs from "node:fs";
import * as THREE from "three";
import { BODY_PATHS, buildBody } from "../src/motion-models/body";
import { FlowNet, normalizeFlow, type FlowPath, type FlowPool } from "../src/motion-models/flow";
import { buildHeart, heartField, VESSELS } from "../src/motion-models/heart";
import { buildLungs, diaphragmHeight } from "../src/motion-models/lungs";
import { cyclic, type CardiacCycle } from "../src/motions";
import type { Vec3 } from "../src/landmarks";

const cycle = JSON.parse(fs.readFileSync("public/motions/cardiac-cycle.json", "utf8")) as CardiacCycle;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("わかりやすい模型（心臓）", () => {
  it("部屋が縮まなければ動かず、左心室が縮むと左心室の外の壁が内へ寄る", () => {
    const out = new THREE.Vector3();
    heartField({ x: 7.4, y: -3 }, { ra: 0, rv: 0, la: 0, lv: 0 }, out);
    expect(out.length()).toBe(0);
    heartField({ x: 7.4, y: -3 }, { ra: 0, rv: 0, la: 0, lv: 1 }, out);
    expect(out.x).toBeLessThan(-0.5);
    // 房室弁の付け根（心底）は心尖の方へ下がる
    heartField({ x: 5.0, y: -0.2 }, { ra: 0, rv: 0, la: 0, lv: 1 }, out);
    expect(out.y).toBeLessThan(-0.5);
  });

  it("模型を組み立てられ、4つの部屋の中に粒の置き場がある", () => {
    const heart = buildHeart({ conduction: true });
    expect(heart.root.children.length).toBeGreaterThan(10);
    for (const chamber of ["ra", "rv", "la", "lv"] as const) expect(heart.samples(chamber, 40, 7).length).toBe(40);
    expect(heart.conduction).not.toBeNull();
  });
});

/** 心臓だけの流れ（src/ui/motion-models.ts の heartFlow と同じつなぎ方） */
function heartNet(perDot: number) {
  const heart = buildHeart();
  const sv = (cycle.flow.ao.reduce((a, b) => a + b, 0) / cycle.flow.ao.length) * cycle.period;
  const flows = Object.fromEntries((["ti", "po", "mi", "ao"] as const).map((key) => [key, normalizeFlow(cycle.flow[key], cycle.period, sv)]));
  const by = (key: string, share = 1) => (u: number) => cyclic(flows[key], u) * share;
  const line = (id: string) => VESSELS.find((v) => v.id === id)!.points;
  const c: [[number, number, number], [number, number, number]] = [[0, 0, 1], [0, 0, 1]];
  const mean = sv / cycle.period;
  const paths: Record<string, FlowPath> = {
    svc: { points: line("svc"), rate: () => mean * 0.35, width: 0.35, to: { pool: "ra" }, color: c },
    ivc: { points: line("ivc"), rate: () => mean * 0.65, width: 0.65, to: { pool: "ra" }, color: c },
    tv: { points: [[-3.9, 1.4, 0], heart.valveCenter.ti, [-3, -2.6, 0]], rate: by("ti"), width: 0.5, to: { pool: "rv" }, color: c },
    pt: { points: line("pt"), rate: by("po"), to: { paths: [["pv", 1]] }, color: c },
    pv: { points: line("lspv"), rate: () => mean, to: { pool: "la" }, color: c },
    mv: { points: [[3.6, 1.6, 0], heart.valveCenter.mi, [3.7, -2.8, 0]], rate: by("mi"), width: 0.5, to: { pool: "lv" }, color: c },
    aorta: { points: line("aorta"), rate: by("ao"), to: { paths: [["svc", 0.35], ["ivc", 0.65]] }, color: c },
  };
  const pool = (chamber: "ra" | "rv" | "la" | "lv", rate: (u: number) => number, next: string): FlowPool => ({
    slots: heart.samples(chamber, 50, 3), rate, to: { paths: [[next, 1]] }, color: [1, 1, 1], start: cyclic(cycle.volume[chamber], 0),
  });
  return new FlowNet(paths, { ra: pool("ra", by("ti"), "tv"), rv: pool("rv", by("po"), "pt"), la: pool("la", by("mi"), "mv"), lv: pool("lv", by("ao"), "aorta") }, perDot, 0.22);
}

describe("模型の血液の粒（FlowNet）", () => {
  it("1拍で流れる量をそろえる", () => {
    const flow = normalizeFlow(cycle.flow.mi, cycle.period, 80);
    expect((flow.reduce((a, b) => a + b, 0) / flow.length) * cycle.period).toBeCloseTo(80, 5);
  });

  it("何拍たっても部屋の粒の数がずれず、左心室の粒は拍出量の分だけ増え減りする", () => {
    const perDot = 3.5;
    const net = heartNet(perDot);
    const dt = cycle.period / 400;
    const lv: number[] = [];
    for (let beat = 0; beat < 30; beat++) {
      for (let i = 0; i < 400; i++) {
        const u = i / 400;
        net.step(u, dt);
        if (beat >= 27) lv.push(net.poolCount("lv"));
      }
    }
    const swing = Math.max(...lv) - Math.min(...lv);
    const sv = Math.max(...cycle.volume.lv) - Math.min(...cycle.volume.lv);
    expect(swing).toBeGreaterThan((sv / perDot) * 0.7);
    expect(swing).toBeLessThan((sv / perDot) * 1.3);
    // 一番多いときの数は拡張末期の容積に近い（30拍たってもたまり過ぎない）
    expect(Math.max(...lv) * perDot).toBeLessThan(Math.max(...cycle.volume.lv) * 1.25);
    expect(Math.max(...lv) * perDot).toBeGreaterThan(Math.max(...cycle.volume.lv) * 0.6);
  });
});

describe("わかりやすい模型（肺循環と体循環）", () => {
  const heartEnds: Record<string, Vec3> = Object.fromEntries(VESSELS.map((v) => [v.id, v.points[v.points.length - 1]]));
  const heartStarts: Record<string, Vec3> = Object.fromEntries(VESSELS.map((v) => [v.id, v.points[0]]));

  it("道の終わりは次の道の初めにつながる", () => {
    for (const [id, path] of Object.entries(BODY_PATHS)) {
      const end = path.points[path.points.length - 1];
      for (const [next] of path.to) {
        const start = BODY_PATHS[next]?.points[0] ?? heartStarts[next];
        expect(start, `${id} → ${next}`).toBeDefined();
        expect(dist(end, start), `${id} → ${next}`).toBeLessThan(1.5);
      }
    }
    // 心臓の大血管の端から全身の道へ
    for (const [vessel, next] of [["desc", "aorta-1"], ["bct", "r-arm-a"], ["lcca", "head-a"], ["lsa", "l-arm-a"], ["rpa", "r-lung-c"], ["lpa", "l-lung-c"]]) {
      expect(dist(heartEnds[vessel], BODY_PATHS[next].points[0]), vessel).toBeLessThan(0.2);
    }
  });

  it("分かれる所と合わさる所で、流れの割合が保たれる", () => {
    for (const [id, path] of Object.entries(BODY_PATHS)) {
      if (path.to.length > 1 && path.to.every(([next]) => BODY_PATHS[next])) {
        const sum = path.to.reduce((total, [next]) => total + BODY_PATHS[next].share, 0);
        expect(sum, id).toBeCloseTo(path.share, 5);
      }
    }
    // 静脈が合わさる: 下大静脈の上の端は下半身の全部
    const into = (target: string) => Object.values(BODY_PATHS).filter((p) => p.to.some(([next]) => next === target)).reduce((t, p) => t + p.share, 0);
    expect(into("ivc-2")).toBeCloseTo(BODY_PATHS["ivc-2"].share, 5);
    expect(into("ivc-1")).toBeCloseTo(BODY_PATHS["ivc-1"].share, 5);
    expect(into("svc")).toBeCloseTo(0.29, 5);
  });

  it("全身の模型を組み立てられる", () => {
    const body = buildBody();
    expect(body.materials.length).toBeGreaterThan(Object.keys(BODY_PATHS).length);
  });
});

describe("わかりやすい模型（呼吸）", () => {
  it("横隔膜はドームの上が高く、吸うと肺の底と胸骨が動く", () => {
    expect(diaphragmHeight(-6, 0)).toBeGreaterThan(diaphragmHeight(-14, 0) + 5);
    expect(diaphragmHeight(-6, 0)).toBeGreaterThan(diaphragmHeight(6, 0));
    const lungs = buildLungs();
    const base: Vec3 = [-7, -4, 0];
    const out: Vec3 = [0, 0, 0];
    lungs.update(1, 1);
    lungs.move(base, out);
    expect(out[1]).toBeLessThan(base[1] - 1);
    const apex: Vec3 = [-7, 13, 0];
    lungs.move(apex, out);
    expect(Math.abs(out[1] - apex[1])).toBeLessThan(0.3);
  });
});
