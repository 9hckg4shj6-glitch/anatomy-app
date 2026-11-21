import fs from "node:fs";
import { BODY_PATHS } from "../src/motion-models/body";
import { FlowNet, normalizeFlow, Tracer, type FlowPath, type FlowPool } from "../src/motion-models/flow";
import { buildHeart, VESSELS } from "../src/motion-models/heart";
import { DESTINATIONS, loopRoute, shortestRoute, stationsOf } from "../src/motion-models/route";
import { breathQuestion, circulationQuestion, conductionQuestion, heartQuestion, stationBlood } from "../src/motion-quiz";
import {
  breathSpans, CARDIAC_PHASES, cardiacSpans, CONDUCTION_STEPS, cardiacTimeline, conductionSpans, conductionStep, cyclic, heartState, inhaling, phaseAt, spanAt, spanStart,
  type BreathingData, type CardiacCycle,
} from "../src/motions";
import { layoutTags, leaderLine, type Rect } from "../src/tag-layout";

const cycle = JSON.parse(fs.readFileSync("public/motions/cardiac-cycle.json", "utf8")) as CardiacCycle;
const breathing = JSON.parse(fs.readFileSync("public/motions/breathing.json", "utf8")) as BreathingData;
const seeded = (seed = 7) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("名前の札を重ならないように置く（tag-layout）", () => {
  it("重なる札をずらし、ずらした札には引き出し線を引く", () => {
    const places = layoutTags([{ x: 100, y: 100, w: 60, h: 20 }, { x: 110, y: 104, w: 60, h: 20 }], [], 400, 300);
    expect(places[0]).toMatchObject({ x: 100, y: 100, choice: 0, hidden: false });
    expect(places[1].hidden).toBe(false);
    const rect = (p: { x: number; y: number }) => ({ x: p.x - 30, y: p.y - 10, w: 60, h: 20 });
    expect(overlaps(rect(places[0]), rect(places[1]))).toBe(false);
    expect(leaderLine(110, 104, places[1], 60, 20)).not.toBeNull();
    expect(leaderLine(100, 100, places[0], 60, 20)).toBeNull();
  });

  it("ボタン・字幕の所は避け、枠の外へは出さない", () => {
    const caption: Rect = { x: 0, y: 250, w: 400, h: 50 };
    const [place] = layoutTags([{ x: 200, y: 260, w: 60, h: 20 }], [caption], 400, 300);
    expect(place.y + 10).toBeLessThanOrEqual(250);
    const [edge] = layoutTags([{ x: 2, y: -5, w: 60, h: 20 }], [], 400, 300);
    expect(edge.x - 30).toBeGreaterThanOrEqual(0);
    expect(edge.y - 10).toBeGreaterThanOrEqual(0);
  });

  it("前のフレームでずらした向きを続けて使い、重なりが無くなれば元の所へ戻す", () => {
    const first = layoutTags([{ x: 100, y: 100, w: 60, h: 20 }, { x: 100, y: 100, w: 60, h: 20 }], [], 400, 300);
    const again = layoutTags([{ x: 100, y: 100, w: 60, h: 20 }, { x: 100, y: 100, w: 60, h: 20, last: first[1].choice }], [], 400, 300);
    expect(again[1].choice).toBe(first[1].choice);
    const alone = layoutTags([{ x: 100, y: 100, w: 60, h: 20, last: first[1].choice }], [], 400, 300);
    expect(alone[0].choice).toBe(0);
  });

  it("置ける所が無いほど混んでいれば隠す", () => {
    const tags = Array.from({ length: 40 }, () => ({ x: 50, y: 30, w: 90, h: 24 }));
    const places = layoutTags(tags, [], 100, 60);
    expect(places.filter((p) => p.hidden).length).toBeGreaterThan(30);
  });
});

describe("字幕の区分（spanAt・spanStart）", () => {
  it("心周期の区分は1周を埋め、時期は phaseAt と同じ", () => {
    const timeline = cardiacTimeline(cycle);
    const spans = cardiacSpans(timeline);
    expect(spans.reduce((sum, s) => sum + (s.to - s.from), 0)).toBeCloseTo(1, 6);
    expect(new Set(spans.map((s) => s.key)).size).toBe(spans.length);
    for (let i = 0; i < 200; i++) {
      const u = (i + 0.5) / 200;
      expect(spans[spanAt(spans, u).index].key).toBe(phaseAt(timeline, u));
    }
    // 区分へ移ると、その区分の中に止まる
    spans.forEach((span, i) => expect(spans[spanAt(spans, spanStart(spans, i)).index].key).toBe(span.key));
  });

  it("刺激伝導の段階は1周を埋め、conductionStep と同じ", () => {
    const spans = conductionSpans();
    expect(spans.reduce((sum, s) => sum + (s.to - s.from), 0)).toBeCloseTo(1, 9);
    for (let i = 0; i < 400; i++) {
      const u = (i + 0.5) / 400;
      expect(spans[spanAt(spans, u).index].key).toBe(conductionStep(u));
    }
    spans.forEach((span, i) => expect(conductionStep(spanStart(spans, i))).toBe(span.key));
  });

  it("吸気と呼気は1周を埋め、inhaling と同じ", () => {
    const spans = breathSpans(breathing);
    expect(spans.map((s) => s.key)).toEqual(["in", "out"]);
    expect(spans[1].to - spans[0].from).toBeCloseTo(1, 9);
    // 境目の近くはのぞいて同じ
    for (let i = 0; i < 100; i++) {
      const u = (i + 0.5) / 100;
      const near = spans.some((s) => Math.abs(((u - s.from + 1.5) % 1) - 0.5) < 0.03);
      if (!near) expect(spans[spanAt(spans, u).index].key === "in").toBe(inhaling(breathing, u));
    }
  });
});

describe("確かめる（4択の問題）", () => {
  it("心周期: 正解は止めた時点の時期・弁の開き", () => {
    const timeline = cardiacTimeline(cycle);
    const spans = cardiacSpans(timeline);
    const rng = seeded();
    for (let k = 0; k < 60; k++) {
      const q = heartQuestion(rng, spans);
      expect(new Set(q.choices).size).toBe(q.choices.length);
      const phase = phaseAt(timeline, q.u!);
      const answer = q.choices[q.answer];
      if (q.choices.length === 4 && answer.endsWith("期")) expect(answer).toBe(CARDIAC_PHASES[phase].ja);
      else {
        const open = heartState(cycle, q.u!).open;
        const av = open.ti > 0.05 || open.mi > 0.05;
        const sl = open.po > 0.05 || open.ao > 0.05;
        expect(answer).toBe(av && !sl ? "房室弁（三尖弁・僧帽弁）だけ開いている" : sl && !av ? "動脈弁（肺動脈弁・大動脈弁）だけ開いている" : "4つとも閉じている");
      }
    }
  });

  it("刺激伝導系・呼吸: 正解は止めた時点の段階・吸気か呼気か", () => {
    const rng = seeded(11);
    const steps = conductionSpans();
    for (let k = 0; k < 40; k++) {
      const q = conductionQuestion(rng, steps);
      expect(q.choices.length).toBe(4);
      const step = CONDUCTION_STEPS[conductionStep(q.u!)];
      const answer = q.choices[q.answer];
      if (Object.values(CONDUCTION_STEPS).some((s) => s.ja === answer)) expect(answer).toBe(step.ja);
      else expect(q.explain.startsWith(step.ja)).toBe(true);
    }
    const spans = breathSpans(breathing);
    for (let k = 0; k < 40; k++) {
      const q = breathQuestion(rng, spans);
      expect(q.answer).toBe(inhaling(breathing, q.u!) ? 0 : 1);
    }
  });
});

/** 全身の模型の流れのつながり（src/ui/motion-models.ts の heartFlow と circulationModelScene のつなぎ直しと同じ） */
const HEART_NEXT: Record<string, string[]> = {
  ra: ["tv"], tv: ["rv"], rv: ["pt"], pt: ["rpa", "lpa"], rpa: ["r-lung-c"], lpa: ["l-lung-c"],
  rspv: ["la"], ripv: ["la"], lspv: ["la"], lipv: ["la"], la: ["mv"], mv: ["lv"], lv: ["aorta"],
  aorta: ["desc", "bct", "lcca", "lsa"], desc: ["aorta-1"], bct: ["r-arm-a"], lcca: ["head-a"], lsa: ["l-arm-a"], svc: ["ra"], ivc: ["ra"],
};
const next = (id: string) => HEART_NEXT[id] ?? BODY_PATHS[id]?.to.map(([to]) => to) ?? [];

describe("1滴を追う（道順と駅）", () => {
  it("どの行き先でも、右心房から肺・左心室・臓器を通って右心房へ戻る", () => {
    for (const dest of DESTINATIONS) {
      const route = loopRoute(next, ["ra", "r-lung-c", "lv", dest.id, "ra"]);
      expect(route[0]).toBe("ra");
      expect(route).toContain("r-lung-c");
      expect(route).toContain(dest.id);
      for (let i = 0; i < route.length; i++) expect(next(route[i])).toContain(route[(i + 1) % route.length]);
      const stations = stationsOf(route);
      // 駅は全部名前があり、同じ駅が続かない
      for (const s of stations) expect(s.title).not.toBe(s.key);
      for (let i = 1; i < stations.length; i++) expect(stations[i].key).not.toBe(stations[i - 1].key);
      expect(stations.map((s) => s.key).slice(0, 7)).toEqual(["ra", "rv", "pa", "lungc", "pv", "la", "lv"]);
    }
  });

  it("腸の血液は門脈と肝臓を通ってから戻る", () => {
    const route = loopRoute(next, ["ra", "l-lung-c", "lv", "gut-c", "ra"]);
    const keys = stationsOf(route).map((s) => s.key);
    expect(keys.indexOf("portal")).toBeGreaterThan(keys.indexOf("gut-c"));
    expect(keys.indexOf("liver-c")).toBeGreaterThan(keys.indexOf("portal"));
    // 腸から右心房へは、門脈 → 肝臓 → 下大静脈
    expect(shortestRoute(next, "gut-c", "ra")).toEqual(["gut-c", "portal", "liver-c", "ivc-1", "ivc", "ra"]);
  });

  it("問題の正解は駅に合う", () => {
    const stations = stationsOf(loopRoute(next, ["ra", "r-lung-c", "lv", "r-kidney-c", "ra"]));
    const rng = seeded(3);
    for (let k = 0; k < 60; k++) {
      const q = circulationQuestion(rng, stations);
      const station = stations[q.station!];
      const answer = q.choices[q.answer];
      if (answer.startsWith("動脈血") || answer.startsWith("静脈血")) expect(answer.startsWith("動脈血")).toBe(stationBlood(station) === "arterial");
      else expect([station.title, stations[(q.station! + 1) % stations.length].title]).toContain(answer);
    }
    expect(stationBlood(stations.find((s) => s.key === "pa")!)).toBe("venous");
    expect(stationBlood(stations.find((s) => s.key === "pv")!)).toBe("arterial");
  });

  it("光る粒は部屋で弁が開くのを待ち、何拍かで1周する", () => {
    const heart = buildHeart();
    const sv = (cycle.flow.ao.reduce((a, b) => a + b, 0) / cycle.flow.ao.length) * cycle.period;
    const flows = Object.fromEntries((["ti", "po", "mi", "ao"] as const).map((key) => [key, normalizeFlow(cycle.flow[key], cycle.period, sv)]));
    const by = (key: string) => (u: number) => cyclic(flows[key], u);
    const line = (id: string) => VESSELS.find((v) => v.id === id)!.points;
    const c: [[number, number, number], [number, number, number]] = [[0, 0, 1], [1, 0, 0]];
    const mean = sv / cycle.period;
    const paths: Record<string, FlowPath> = {
      ivc: { points: line("ivc"), rate: () => mean, to: { pool: "ra" }, color: c },
      tv: { points: [[-3.9, 1.4, 0], heart.valveCenter.ti, [-3, -2.6, 0]], rate: by("ti"), width: 0.5, to: { pool: "rv" }, color: c },
      pt: { points: line("pt"), rate: by("po"), to: { paths: [["pv", 1]] }, color: c },
      pv: { points: line("lspv"), rate: () => mean, to: { pool: "la" }, color: c },
      mv: { points: [[3.6, 1.6, 0], heart.valveCenter.mi, [3.7, -2.8, 0]], rate: by("mi"), width: 0.5, to: { pool: "lv" }, color: c },
      aorta: { points: line("aorta"), rate: by("ao"), to: { paths: [["ivc", 1]] }, color: c },
    };
    const pool = (chamber: "ra" | "rv" | "la" | "lv", rate: (u: number) => number, to: string): FlowPool => ({
      slots: heart.samples(chamber, 30, 3), rate, to: { paths: [[to, 1]] }, color: [1, 1, 1], start: cyclic(cycle.volume[chamber], 0),
    });
    const net = new FlowNet(paths, { ra: pool("ra", by("ti"), "tv"), rv: pool("rv", by("po"), "pt"), la: pool("la", by("mi"), "mv"), lv: pool("lv", by("ao"), "aorta") }, 3.5, 0.22);
    const route = loopRoute((id) => net.next(id), ["ra", "lv", "ra"]);
    expect(route).toEqual(["ra", "tv", "rv", "pt", "pv", "la", "mv", "lv", "aorta", "ivc"]);
    const tracer = new Tracer(net, route, sv * 0.45);
    let loops = 0;
    tracer.onLoop = () => loops++;
    const dt = 1 / 120;
    const timeline = cardiacTimeline(cycle);
    for (let t = 0; t < cycle.period * 12; t += dt) {
      const u = (t / cycle.period) % 1;
      const before = tracer.index;
      tracer.step(u, dt);
      // 左心室から大動脈へ出るのは、大動脈弁が開いている（駆出期の）間だけ
      if (route[before] === "lv" && route[tracer.index] === "aorta") expect(["rapidEjection", "reducedEjection"]).toContain(phaseAt(timeline, u));
    }
    expect(loops).toBeGreaterThanOrEqual(1);
    // 止めている間（dt = 0）は動かない
    const at = [tracer.index, tracer.s, tracer.volume];
    tracer.step(0.3, 0);
    expect([tracer.index, tracer.s, tracer.volume]).toEqual(at);
  });
});
