import * as THREE from "three";
import { termById } from "../content";
import { db, nowIso } from "../db";
import { h, onKeys } from "../dom";
import {
  blockedReason, forkPrompt, journeyById, journeyKey, JOURNEYS, optionResult, stopOf,
  type Journey, type JourneyMission, type JourneyOption, type JourneyRecord, type JourneyStop,
} from "../journeys";
import type { Vec3 } from "../landmarks";
import { Polyline } from "../motions";
import { CM } from "../motion-models/common";
import { Tracer } from "../motion-models/flow";
import { ORGANS } from "../motion-models/body";
import { buildLineModel, LINE_MODELS, segmentLine, type LineModel } from "../motion-models/journey-models";
import { shortestRoute } from "../motion-models/route";
import type { AppContext } from "./context";
import { circulationPartName, circulationWorld, placeTags, stageModel } from "./motion-models";
import { Player, toggle } from "./motions";
import { segmented } from "./settings-kit";

/**
 * からだの旅（#/journey。src/journeys.ts・docs/普段使い.md「からだの旅」）。
 * "#/journey" は旅の一覧、"#/journey/<旅ID>[/<目当てID>]" は旅。旅をするもの（血液の1滴・食べ物・痛みの信号）が模型の中を進み、
 * 分かれ道で止まる。3Dの上の帯で次の名前を選ぶと、その道を進む（違う臓器へ行く道なら、着いてから分かれ道に戻る）。
 * 血液の1滴の旅は動きの図鑑「肺循環と体循環」の模型（心臓が拍動し、ほかの血液の粒も流れる）
 */

/** 旅の速さ（アプリを開いている間だけ覚えておく） */
const remembered = { speed: 1, follow: true, names: true };
const SPEEDS = [{ value: 0.5, label: "ゆっくり" }, { value: 1, label: "ふつう" }, { value: 2, label: "速く" }];

export async function journeyScreen(ctx: AppContext, arg: string): Promise<void> {
  const [id = "", missionId = ""] = arg.split("/");
  const journey = journeyById.get(id as Journey["id"]);
  if (!journey) return listScreen(ctx);
  const mission = journey.missions.find((m) => m.id === missionId) ?? journey.missions[0];
  return travel(ctx, journey, mission);
}

// ---------------------------------------------------------------- 結果

async function loadRecords(journey: Journey): Promise<Record<string, JourneyRecord>> {
  const value = (await db.settings.get(journeyKey(journey.id)))?.value as Record<string, JourneyRecord> | undefined;
  const out: Record<string, JourneyRecord> = {};
  for (const mission of journey.missions) {
    const record = value?.[mission.id];
    if (record && typeof record.best === "number" && typeof record.last === "number" && typeof record.at === "string") out[mission.id] = record;
  }
  return out;
}

async function saveRecord(journey: Journey, mission: JourneyMission, mistakes: number): Promise<{ record: JourneyRecord; before?: JourneyRecord }> {
  const all = await loadRecords(journey);
  const before = all[mission.id];
  const record = { best: Math.min(mistakes, before?.best ?? Infinity), last: mistakes, at: nowIso() };
  await db.settings.put({ key: journeyKey(journey.id), value: { ...all, [mission.id]: record }, updatedAt: nowIso() });
  return { record, before };
}

const dateOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// ---------------------------------------------------------------- 一覧

const ICON: Record<Journey["id"], string> = {
  blood: `<path d="M12 3.5c3 4 5.5 7.2 5.5 10a5.5 5.5 0 0 1-11 0c0-2.8 2.5-6 5.5-10Z"/>`,
  food: `<path d="M8 3v7a3 3 0 0 0 3 3v8"/><path d="M5 3v4a3 3 0 0 0 3 3"/><path d="M11 3v4a3 3 0 0 1-3 3"/><path d="M17 21V3c2 1.5 3 4 3 7s-1 4-3 4"/>`,
  pain: `<path d="M13 2 5 13h6l-1 9 8-11h-6Z"/>`,
};

function icon(id: Journey["id"]): HTMLElement {
  const span = h("span", { class: "journey-icon", "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[id]}</svg>`;
  return span;
}

/** 同じ旅をもう一度（同じアドレスでは画面が作り直されないので、いったん一覧のアドレスにしてから移る） */
function restart(href: string): void {
  history.replaceState(null, "", "#/journey");
  location.hash = href;
}

async function listScreen(ctx: AppContext): Promise<void> {
  const { panel, viewer } = ctx;
  ctx.fold(true);
  viewer.setSchematic(null);
  const records = await Promise.all(JOURNEYS.map(loadRecords));
  if (ctx.signal.aborted) return;
  panel.replaceChildren(
    h("div", { class: "motion-head" }, h("h2", {}, "からだの旅")),
    h("p", { class: "motion-lead" }, "血液の1滴・食べ物・痛みの信号になって、からだの中を進みます。分かれ道ごとに次の血管・器官・神経の名前を選び、まちがえると違う所に着いてしまいます。"),
    ...JOURNEYS.map((journey, i) => {
      const done = journey.missions.filter((m) => records[i][m.id]);
      return h("section", { class: "journey-card", style: `--journey: ${journey.color}` },
        h("a", { class: "journey-card-head", href: `#/journey/${journey.id}` },
          icon(journey.id),
          h("span", { class: "journey-card-text" },
            h("b", {}, journey.title),
            h("span", {}, journey.sub),
          ),
          h("span", { class: "journey-go", "aria-hidden": "true" }, "›"),
        ),
        journey.missions.length > 1 ? h("div", { class: "journey-missions" },
          h("span", { class: "muted" }, journey.id === "blood" ? "行き先:" : "信号:"),
          ...journey.missions.map((mission) => {
            const record = records[i][mission.id];
            return h("a", { class: `chip${record ? " done" : ""}`, href: `#/journey/${journey.id}/${mission.id}`, title: record ? `いちばん少ないまちがい ${record.best}（${dateOf(record.at)}）` : undefined },
              record ? `${record.best === 0 ? "★ " : "✓ "}${mission.label}` : mission.label);
          }),
        ) : "",
        h("p", { class: "home-note" }, done.length
          ? `${done.length} / ${journey.missions.length} をゴール。${done.length === 1 && journey.missions.length === 1 ? `いちばん少ないまちがい ${records[i][done[0].id].best}（${dateOf(records[i][done[0].id].at)}）` : "★ はまちがえずにゴール。"}`
          : "まだ旅していません。"),
      );
    }),
    h("p", { class: "home-note" }, "血液の1滴の旅は、動きの図鑑「肺循環と体循環」の模型の中を進みます（心臓が拍動し、ほかの血液の粒も流れています）。"),
  );
}

// ---------------------------------------------------------------- 模型（旅をするものを動かす）

interface World {
  /** 前の所の道 from から、次の所の道 to まで進みはじめる */
  go(from: string, to: string): void;
  /** その道の終わりに置く（着いた状態） */
  put(at: string): void;
  /** 進んでいる途中なら、すぐ着かせる */
  skip(): void;
  /** 着いたときに呼ぶ */
  onArrive: (() => void) | null;
  /** 今通っている所の名前 */
  passing(): [string, string?] | null;
  /** 見る所（名前・映す） */
  views: [string, () => void][];
  /** 所 → 3Dの札 */
  stopTags: Map<string, HTMLElement[]>;
  /** 札を出す・隠す */
  showNames(on: boolean): void;
  /** 目当ての所を目立たせる */
  setGoal(stop: string | null): void;
}

/** 所ごとに映す所（views の番号）。無い所は変えない */
const STOP_VIEWS: Record<Journey["id"], Record<string, number>> = {
  blood: { ra: 1, rv: 1, pt: 1, "r-lung": 1, "l-lung": 1, la: 1, lv: 1, arch: 1, home: 1, abd: 0, iliac: 0, brain: 0, "r-arm": 0, "l-arm": 0, gut: 0, liver: 0, "r-kidney": 0, "l-kidney": 0, "r-leg": 0, "l-leg": 0 },
  food: { mouth: 1, pharynx: 1, nasal: 1, lungs: 0, esophagus: 0, stomach: 2, duodenum: 2, gallbladder: 2, pancreas: 2, jejunum: 2, ileum: 2, cecum: 2, appendix: 2, ascending: 2, transverse: 2, descending: 2, sigmoid: 2, rectum: 0, anus: 0 },
  pain: { finger: 0, median: 1, root: 1, horn: 1, reflex: 1, dc: 0, stt: 0, nucleus: 2, ml: 2, thalamus: 2, cerebellum: 2, cortex: 2, motor: 2 },
};

async function bloodWorld(ctx: AppContext, player: Player, journey: Journey): Promise<World | null> {
  const { viewer } = ctx;
  const world = await circulationWorld(ctx);
  if (!world) return null;
  const { net, cycle, mean, dots, root, body } = world;
  const tracer = new Tracer(net, [journey.stops[0].at], mean * cycle.period * 0.45);
  const isPool = (id: string) => net.pools.has(id);
  let arrived = true;
  const self: World = {
    onArrive: null,
    go(from, to) {
      const route = shortestRoute((id) => net.next(id), from, to);
      if (!route) throw new Error(`道が無い: ${from} → ${to}`);
      tracer.route = route;
      tracer.place(0, isPool(from) ? 0 : 1);
      arrived = false;
    },
    put(at) {
      tracer.route = [at];
      tracer.place(0, isPool(at) ? 0.3 : 1);
      arrived = true;
    },
    skip() {
      if (arrived) return;
      self.put(tracer.route[tracer.route.length - 1]);
      self.onArrive?.();
    },
    passing: () => circulationPartName(tracer.route[tracer.index]),
    views: world.views,
    stopTags: new Map(),
    showNames: () => {},
    setGoal: () => {},
  };
  const arrive = () => {
    if (arrived) return;
    arrived = true;
    self.onArrive?.();
  };
  tracer.onLoop = () => {
    if (arrived) return;
    // 最後の道を出た（道順の初めへ戻った）: 最後の道の終わりで止める
    tracer.place(tracer.route.length - 1, 1);
    arrive();
  };

  // 札: 臓器と1滴
  const tracerAt: Vec3 = [0, 0, 0];
  const organTags = ORGANS.map((organ) => ({ text: organ.ja, at: organ.tag, kind: "organ", id: organ.id }));
  const chamberTags = [
    { text: "右心房", at: [-7.6, 4.4, 1.6] as Vec3, kind: "chamber", id: "ra" },
    { text: "右心室", at: [-4.6, -7.4, 1.6] as Vec3, kind: "chamber", id: "rv" },
    { text: "左心房", at: [7.4, 4.6, 1.6] as Vec3, kind: "chamber", id: "la" },
    { text: "左心室", at: [6.4, -7.8, 1.6] as Vec3, kind: "chamber", id: "lv" },
  ];
  const tags = [...organTags, ...chamberTags, { text: journey.traveler, at: tracerAt, kind: "tracer", id: "" }];
  const elements = placeTags(ctx, root, tags);
  const byId = new Map<string, HTMLElement[]>();
  for (const [t, element] of elements) {
    if (!t.id) continue;
    const ids = t.id === "ra" ? ["ra", "home"] : [t.id];
    for (const id of ids) byId.set(id, [...(byId.get(id) ?? []), element]);
    if (t.kind === "chamber") element.classList.add("minor");
  }
  self.stopTags = byId;
  self.showNames = (on) => {
    for (const [t, element] of elements) element.hidden = !on && t.kind !== "tracer";
  };
  // 目当ての臓器（球）を濃く
  const organMaterials = new Map<string, THREE.MeshStandardMaterial>();
  body.root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && ORGANS.some((o) => o.id === mesh.userData.pick)) organMaterials.set(mesh.userData.pick as string, mesh.material as THREE.MeshStandardMaterial);
  });
  self.setGoal = (stop) => {
    for (const [id, list] of byId) for (const element of list) element.classList.toggle("goal", id === stop);
    for (const [id, material] of organMaterials) {
      const goal = id === stop;
      material.opacity = goal ? 0.62 : 0.3;
      material.emissive.set(goal ? "#5a4300" : "#000000");
    }
  };

  player.onFrame((time, dt) => {
    const u = (time / cycle.period) % 1;
    world.frame(u, dt);
    if (!arrived) {
      tracer.step(u, dt);
      const last = tracer.route.length - 1;
      if (tracer.index === last && isPool(tracer.route[last])) arrive();
    }
    tracer.position(tracerAt);
    const i = net.count;
    dots.position.set([tracerAt[0] * CM, tracerAt[1] * CM, tracerAt[2] * CM], i * 3);
    const [r, g, b] = tracer.color();
    dots.color.set([r + (1 - r) * 0.3, g + (1 - g) * 0.3, b + (1 - b) * 0.3], i * 3);
    dots.size[i] = 2.8;
    viewer.dotsChanged(dots.capacity);
  });
  return self;
}

/** 食べ物・痛みの信号: 道の中心線の上を一定の速さ（cm/秒）で進む。後ろに尾を引く */
function lineWorld(ctx: AppContext, player: Player, model: LineModel, journey: Journey, speed: number): World {
  const { viewer } = ctx;
  const built = buildLineModel(model);
  const root = stageModel(ctx, built.root);
  const lines = new Map(Object.entries(model.segments).map(([id, segment]) => [id, Polyline.of(segmentLine(segment))]));
  const next = (id: string) => model.segments[id]?.to ?? [];
  let route: string[] = [journey.stops[0].at];
  let index = 0;
  let s = 0;
  let arrived = true;
  const TRAIL = 10;
  const dots = viewer.setDots(TRAIL + 1, model.dot)!;
  const trail: Vec3[] = [];
  const at = new Float32Array(3);
  const here: Vec3 = [0, 0, 0];
  const lineOf = (id: string) => lines.get(id)!;
  const self: World = {
    onArrive: null,
    go(from, to) {
      const found = shortestRoute(next, from, to);
      if (!found) throw new Error(`道が無い: ${from} → ${to}`);
      // 前の所の道は通り終えているので、その次から
      route = found.length > 1 ? found.slice(1) : found;
      index = 0;
      s = 0;
      arrived = false;
    },
    put(id) {
      route = [id];
      index = 0;
      s = lineOf(id).length;
      arrived = true;
      trail.length = 0;
    },
    skip() {
      if (arrived) return;
      self.put(route[route.length - 1]);
      self.onArrive?.();
    },
    passing: () => {
      const segment = model.segments[route[index]];
      return segment ? [segment.name, segment.term] : null;
    },
    views: model.views.map((view) => [view.label, () => viewer.frameSchematic(view.from, view.zoom, view.region ? built.regions.get(view.region) : undefined)]),
    stopTags: new Map(),
    showNames: () => {},
    setGoal: () => {},
  };
  /** はじめは最初の道を初めから進む */
  route = [journey.stops[0].at];
  s = 0;
  arrived = false;

  const tags = [...model.tags.map((t) => ({ ...t })), { text: journey.traveler, at: here, kind: "tracer" as const }];
  const elements = placeTags(ctx, root, tags);
  for (const [t, element] of elements) {
    if (!("stop" in t) || !t.stop) continue;
    self.stopTags.set(t.stop, [...(self.stopTags.get(t.stop) ?? []), element]);
  }
  self.showNames = (on) => {
    for (const [t, element] of elements) element.hidden = !on && t.kind !== "tracer";
  };
  self.setGoal = (stop) => {
    for (const [id, list] of self.stopTags) for (const element of list) element.classList.toggle("goal", id === stop);
  };
  const color = new THREE.Color(model.traveler);
  let sinceTrail = 0;
  player.onFrame((_time, dt) => {
    if (!arrived && dt > 0) {
      s += speed * dt;
      while (s >= lineOf(route[index]).length) {
        if (index === route.length - 1) {
          s = lineOf(route[index]).length;
          arrived = true;
          self.onArrive?.();
          break;
        }
        s -= lineOf(route[index]).length;
        index++;
      }
    }
    lineOf(route[index]).at(Math.min(s, lineOf(route[index]).length), at);
    here[0] = at[0];
    here[1] = at[1];
    here[2] = at[2];
    sinceTrail += dt;
    if (!arrived && sinceTrail > 0.05) {
      sinceTrail = 0;
      trail.unshift([here[0], here[1], here[2]]);
      if (trail.length > TRAIL) trail.length = TRAIL;
    } else if (arrived && trail.length && sinceTrail > 0.05) {
      sinceTrail = 0;
      trail.pop();
    }
    const n = trail.length + 1;
    const points = [here, ...trail];
    points.forEach((p, i) => {
      dots.position.set([p[0] * CM, p[1] * CM, p[2] * CM], i * 3);
      const fade = i === 0 ? 1 : 0.85 - (i / (TRAIL + 1)) * 0.6;
      dots.color.set([color.r * fade + (1 - fade) * 0.2, color.g * fade + (1 - fade) * 0.2, color.b * fade + (1 - fade) * 0.2], i * 3);
      dots.size[i] = i === 0 ? 2.6 : 1.6 - (i / TRAIL) * 1.1;
    });
    viewer.dotsChanged(n);
  });
  return self;
}

// ---------------------------------------------------------------- 旅

interface LogEntry {
  stop: string;
  label: string;
  result: "right" | "dest" | "blocked";
}

async function travel(ctx: AppContext, journey: Journey, mission: JourneyMission): Promise<void> {
  const { panel, viewer } = ctx;
  ctx.fold(false);
  // 向きの目印は帯と重なるので出さない（模型は前から見た形）
  viewer.hideCompass(true);
  const player = new Player(ctx);
  ctx.signal.addEventListener("abort", () => player.stop(), { once: true });
  player.speed = remembered.speed;
  player.playing = true;
  const model = journey.id === "blood" ? null : LINE_MODELS[journey.id];
  const world = model ? lineWorld(ctx, player, model, journey, journey.id === "pain" ? 14 : 8) : await bloodWorld(ctx, player, journey);
  if (!world || ctx.signal.aborted) return;
  const records = await loadRecords(journey);
  if (ctx.signal.aborted) return;

  // 旅の様子
  let stop = stopOf(journey, journey.start);
  let checkpoint = 0;
  let mistakes = 0;
  /** 違う道へ外れた分かれ道（着いたら戻る所） */
  let detour: JourneyStop | null = null;
  /** この分かれ道で選んで違った選択肢（もう一度来たら印を残す） */
  const tried = new Map<string, Set<string>>();
  const log: LogEntry[] = [];
  const passed: JourneyStop[] = [stop];
  let moving = false;
  let finished = false;
  let message: HTMLElement | null = null;
  let shuffled = new Map<string, JourneyOption[]>();
  let view = -1;

  // 3Dの上の帯（今いる所・分かれ道の問い・選択肢）
  const bar = h("div", { class: "journey-bar", "aria-live": "polite" });
  ctx.tools.append(bar);
  const inset = () => viewer.setFrameInset(bar.offsetHeight + 12);
  ctx.signal.addEventListener("abort", () => bar.remove(), { once: true });

  // 欄
  const now = h("div", { class: "motion-now journey-now" });
  const logList = h("ol", { class: "journey-log" });
  const result = h("div", { class: "journey-result" });

  const follow = (target: JourneyStop) => {
    if (!remembered.follow) return;
    const v = STOP_VIEWS[journey.id][target.id];
    if (v === undefined || v === view || !world.views[v]) return;
    view = v;
    world.views[v][1]();
  };

  const termLink = (id?: string) => {
    const term = id ? termById.get(id) : undefined;
    return term ? h("a", { class: "journey-term", href: `#/explore/${term.id}` }, "図鑑で見る ›") : "";
  };

  const showNow = () => {
    const target = mission.checkpoints[checkpoint];
    now.replaceChildren(
      h("strong", { class: "motion-now-name" }, `${journey.traveler}は今: ${stop.title}`),
      h("p", { class: "motion-now-note" }, stop.note || stop.arrive || ""),
      termLink(stop.term),
      !finished && target && target !== stop.id ? h("p", { class: "journey-target muted" }, `目当て: ${mission.checkpoints.slice(checkpoint).map((id) => stopOf(journey, id).title).join(" → ")}`) : "",
    );
    for (const [id, list] of world.stopTags) for (const element of list) element.classList.toggle("focus", id === stop.id);
    world.setGoal(finished ? null : mission.checkpoints[checkpoint] === "home" ? null : mission.checkpoints[checkpoint]);
  };

  const addLog = (entry: LogEntry) => {
    log.push(entry);
    const mark = entry.result === "right" ? "✓" : "×";
    logList.append(h("li", { class: entry.result }, h("b", {}, mark), ` ${entry.stop} → `, h("span", {}, entry.label), entry.result === "dest" ? h("small", { class: "muted" }, "（違う所に着いた）") : entry.result === "blocked" ? h("small", { class: "muted" }, "（つながっていない）") : ""));
  };

  const optionsOf = (target: JourneyStop): JourneyOption[] => {
    const cached = shuffled.get(target.id);
    if (cached) return cached;
    const list = [...(target.fork?.options ?? [])];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    shuffled.set(target.id, list);
    return list;
  };

  /** 分かれ道の帯 */
  const showFork = () => {
    const fork = stop.fork;
    if (!fork) return;
    const marks = tried.get(stop.id) ?? new Set<string>();
    const options = optionsOf(stop);
    bar.className = "journey-bar fork";
    bar.replaceChildren(
      h("div", { class: "journey-bar-head" }, h("span", { class: "journey-bar-at" }, stop.title), h("b", {}, forkPrompt(fork.prompt, mission))),
      h("div", { class: `journey-options n${options.length}` }, ...options.map((option, i) => {
        const wrong = marks.has(option.label);
        return h("button", {
          class: `journey-option${wrong ? " wrong" : ""}`, type: "button", disabled: wrong ? true : undefined,
          onClick: () => choose(option),
        }, h("span", { class: "journey-key", "aria-hidden": "true" }, String(i + 1)), option.label);
      })),
      message ?? "",
    );
    inset();
  };

  const choose = (option: JourneyOption) => {
    if (moving || finished || !stop.fork) return;
    const outcome = optionResult(journey, mission, checkpoint, option);
    if (outcome === "blocked") {
      mistakes++;
      const marks = tried.get(stop.id) ?? new Set<string>();
      marks.add(option.label);
      tried.set(stop.id, marks);
      addLog({ stop: stop.title, label: option.label, result: "blocked" });
      message = h("p", { class: "journey-message no" }, h("b", {}, `× ${option.label}`), " ", blockedReason(journey, mission, option), " ", termInline(option.term));
      showFork();
      return;
    }
    if (outcome === "dest") {
      mistakes++;
      const marks = tried.get(stop.id) ?? new Set<string>();
      marks.add(option.label);
      tried.set(stop.id, marks);
      detour = stop;
      addLog({ stop: stop.title, label: option.label, result: "dest" });
    } else addLog({ stop: stop.title, label: option.label, result: "right" });
    message = null;
    const target = stopOf(journey, option.to!);
    moving = true;
    bar.className = `journey-bar moving ${outcome}`;
    const passingName = h("span", { class: "journey-passing" });
    bar.replaceChildren(
      h("div", { class: "journey-bar-head" },
        h("b", {}, outcome === "right" ? `✓ ${option.label}` : `${option.label} へ…`),
        option.why ? h("span", { class: "journey-why" }, option.why) : "",
      ),
      h("div", { class: "journey-bar-row" }, passingName, h("button", { class: "journey-skip", type: "button", onClick: () => world.skip() }, "着くまで飛ばす ›")),
    );
    inset();
    const tick = () => {
      if (!moving || ctx.signal.aborted) return;
      const name = world.passing();
      passingName.textContent = name ? `通っている所: ${name[0]}` : "";
      requestAnimationFrame(tick);
    };
    tick();
    follow(target);
    const from = stop.at;
    stop = target;
    world.onArrive = () => arrive();
    world.go(from, target.at);
  };

  const termInline = (id?: string) => {
    const term = id ? termById.get(id) : undefined;
    return term ? h("a", { href: `#/explore/${term.id}` }, "図鑑 ›") : "";
  };

  const arrive = () => {
    moving = false;
    world.onArrive = null;
    shuffled = new Map([...shuffled].filter(([id]) => id !== stop.id));
    // 違う所（行き先）に着いた
    if (detour && stop.dest && stop.id !== mission.checkpoints[checkpoint]) {
      const back = detour;
      showNow();
      bar.className = "journey-bar wrong";
      bar.replaceChildren(
        h("div", { class: "journey-bar-head" }, h("b", {}, `× 着いたのは「${stop.title.replace(/に(着いた|入った)$/, "")}」`), h("span", { class: "journey-why" }, stop.arrive ?? "")),
        h("div", { class: "journey-bar-row" }, h("button", { class: "journey-back", type: "button", onClick: () => {
          stop = back;
          detour = null;
          world.put(back.at);
          follow(back);
          showNow();
          showFork();
        } }, `‹ 分かれ道（${back.title}）に戻る`)),
      );
      inset();
      return;
    }
    passed.push(stop);
    if (stop.id === mission.checkpoints[checkpoint]) checkpoint++;
    showNow();
    if (checkpoint >= mission.checkpoints.length || !stop.fork) {
      void finish();
      return;
    }
    showFork();
  };

  const finish = async () => {
    finished = true;
    showNow();
    bar.className = "journey-bar goal";
    bar.replaceChildren(
      h("div", { class: "journey-bar-head" }, h("b", {}, `ゴール！ ${stop.title}`), h("span", { class: "journey-why" }, mistakes ? `まちがい ${mistakes} 回` : "まちがえずにゴール")),
      h("div", { class: "journey-bar-row" }, h("button", { class: "journey-back", type: "button", onClick: () => result.scrollIntoView({ behavior: "smooth", block: "start" }) }, "ふり返る ›")),
    );
    inset();
    const { record, before } = await saveRecord(journey, mission, mistakes);
    if (ctx.signal.aborted) return;
    const others = journey.missions.filter((m) => m.id !== mission.id);
    result.replaceChildren(
      h("h3", { class: "list-title" }, "ふり返り"),
      h("p", { class: "journey-score" }, h("b", {}, mistakes ? `まちがい ${mistakes} 回` : "★ まちがえずにゴール"),
        before ? h("span", { class: "muted" }, ` 前回 ${before.last} 回（${dateOf(before.at)}）・いちばん少ない ${record.best} 回`) : ""),
      h("p", { class: "motion-now-note" }, mission.done),
      h("h3", { class: "list-title" }, "通った道"),
      h("ol", { class: "journey-route" }, ...passed.map((s) => h("li", {}, termById.get(s.term ?? "") ? h("a", { href: `#/explore/${s.term}` }, s.title) : s.title))),
      h("div", { class: "journey-actions" },
        h("button", { class: "ghost-button", type: "button", onClick: () => restart(`#/journey/${journey.id}/${mission.id}`) }, "もう一度"),
        ...others.slice(0, 3).map((m) => h("a", { class: "ghost-button", href: `#/journey/${journey.id}/${m.id}` }, `${m.label}へ`)),
        h("a", { class: "ghost-button", href: "#/journey" }, "ほかの旅"),
      ),
    );
  };

  // キーボード（PC）: 1〜4 で選ぶ、スペースで飛ばす
  onKeys(ctx.signal, (key) => {
    if (/^[1-4]$/.test(key) && !moving && !finished && stop.fork && bar.classList.contains("fork")) {
      const option = optionsOf(stop)[Number(key) - 1];
      if (option && !(tried.get(stop.id)?.has(option.label))) choose(option);
      return true;
    }
    if (key === " " && moving) {
      world.skip();
      return true;
    }
    return false;
  });

  const record = records[mission.id];
  panel.replaceChildren(
    h("div", { class: "motion-head" }, h("h2", {}, journey.title), h("a", { class: "muted", href: "#/journey" }, "からだの旅 ›")),
    journey.missions.length > 1 ? h("div", { class: "journey-missions" },
      h("span", { class: "muted" }, journey.id === "blood" ? "行き先:" : "運ぶ信号:"),
      ...journey.missions.map((m) => h("button", { class: `chip${m.id === mission.id ? " on" : ""}`, type: "button", "aria-pressed": String(m.id === mission.id), onClick: () => restart(`#/journey/${journey.id}/${m.id}`) }, m.label)),
    ) : "",
    h("p", { class: "motion-lead" }, mission.lead, record ? h("span", { class: "muted" }, ` （前回 まちがい ${record.last} 回・${dateOf(record.at)}）`) : ""),
    now,
    h("p", { class: "home-note" }, "3Dの下の帯で、次に進む名前を選びます。違う臓器へ行く道を選ぶとそこへ着いてしまい、つながっていない道を選ぶとその場で理由が出ます。PC では 1〜4 のキーでも選べます。"),
    result,
    h("h3", { class: "list-title" }, "選んだ道"),
    logList,
    h("h3", { class: "list-title" }, "見せ方"),
    h("div", { class: "motion-switch" }, segmented<number>("速さ", SPEEDS, remembered.speed, (value) => {
      remembered.speed = value;
      player.speed = value;
    })),
    toggle(`${journey.traveler}について映す`, remembered.follow, (on) => {
      remembered.follow = on;
      view = -1;
      if (on) follow(stop);
    }),
    toggle("名前を出す", remembered.names, (on) => {
      remembered.names = on;
      world.showNames(on);
    }),
    h("div", { class: "chip-list" }, ...world.views.map(([label, go]) => h("button", { class: "chip", type: "button", onClick: () => {
      view = -1;
      go();
    } }, label))),
    h("p", { class: "plate-credit muted" }, journey.credit),
  );
  world.showNames(remembered.names);

  // 出発（帯の高さを決めてから映す）
  showNow();
  if (journey.id === "blood") {
    world.put(stop.at);
    showFork();
  } else {
    // 初めの道（口・指先）を進んでから、最初の分かれ道
    moving = true;
    bar.className = "journey-bar moving right";
    bar.replaceChildren(h("div", { class: "journey-bar-head" }, h("b", {}, `出発: ${stop.title}`), h("span", { class: "journey-why" }, mission.lead)));
    inset();
    world.onArrive = () => {
      moving = false;
      world.onArrive = null;
      showFork();
    };
  }
  world.views[0][1]();
  follow(stop);
}
