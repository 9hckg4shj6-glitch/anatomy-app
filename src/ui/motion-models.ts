import * as THREE from "three";
import { termById } from "../content";
import { h } from "../dom";
import type { Vec3 } from "../landmarks";
import {
  CARDIAC_PHASES, cardiacTimeline, CONDUCTION, CONDUCTION_STEPS, conductionStep, cyclic, heartState, inhaling, loadMotionData, phaseAt,
  type BreathingData, type CardiacCycle, type Chamber, type ConductionStep, type ValveKey,
} from "../motions";
import { CM, tag } from "../motion-models/common";
import { FlowNet, normalizeFlow, type FlowPath, type FlowPool, type RGB } from "../motion-models/flow";
import { ARTERIAL, buildHeart, CHAMBERS, CONDUCTION_PATHS, heartRegion, MUSCLE, VENOUS, VESSELS, type HeartModel, type HeartTag } from "../motion-models/heart";
import type { SchematicTag } from "../viewer";
import type { AppContext } from "./context";
import { BODY_PATHS, buildBody, ORGANS } from "../motion-models/body";
import { buildLungs, BREATH, type LungTag } from "../motion-models/lungs";
import { segmented } from "./settings-kit";
import { axisLabel, chart, CHART_W, DEEP, ecgChart, el, HeartSound, hex, modeSwitch, Player, relatedTerms, toggle, wiggers, type MotionItem } from "./motions";

/**
 * 動きの図鑑の「わかりやすい模型」（docs/動きの図鑑.md「わかりやすい模型」）。
 * 教科書の模式図を立体にした作り物の模型（src/motion-models/）を、実測・計算の動き（心周期・呼吸）で動かす。
 * 実際の形（アプリの3Dの形）は #/motions/<ID>/real
 */
export async function motionModelScene(ctx: AppContext, player: Player, item: MotionItem): Promise<void> {
  if (item.id === "heartbeat" || item.id === "conduction") await heartModelScene(ctx, player, item);
  else if (item.id === "breathing") await breathingModelScene(ctx, player, item);
  else await circulationModelScene(ctx, player, item);
}

/** 模型の部品の名前（pick → 表示名・図鑑の語） */
const PICK_NAMES: Record<string, [string, string?]> = {
  svc: ["上大静脈", "superior-vena-cava"], ivc: ["下大静脈", "inferior-vena-cava"], pt: ["肺動脈幹", "pulmonary-trunk"],
  rpa: ["右肺動脈", "right-pulmonary-artery"], lpa: ["左肺動脈", "left-pulmonary-artery"],
  rspv: ["右肺静脈", "pulmonary-veins"], ripv: ["右肺静脈", "pulmonary-veins"], lspv: ["左肺静脈", "pulmonary-veins"], lipv: ["左肺静脈", "pulmonary-veins"],
  aorta: ["上行大動脈・大動脈弓", "aortic-arch"], desc: ["下行大動脈（胸大動脈）", "thoracic-aorta"], bct: ["腕頭動脈", "brachiocephalic-trunk"],
  lcca: ["左総頸動脈", "common-carotid-artery"], lsa: ["左鎖骨下動脈", "subclavian-artery"],
  "tricuspid-valve": ["三尖弁", "tricuspid-valve"], "mitral-valve": ["僧帽弁", "mitral-valve"], "pulmonary-valve": ["肺動脈弁", "pulmonary-valve"], "aortic-valve": ["大動脈弁", "aortic-valve"],
  "papillary-muscles": ["乳頭筋", "papillary-muscles"],
  "sinuatrial-node": ["洞房結節", "sinuatrial-node"], "atrioventricular-node": ["房室結節", "atrioventricular-node"], "atrioventricular-bundle": ["ヒス束（房室束）", "atrioventricular-bundle"],
  "right-bundle-branch": ["右脚", "right-bundle-branch"], "left-bundle-branch": ["左脚", "left-bundle-branch"], "purkinje-fibers": ["プルキンエ線維", "purkinje-fibers"],
  internodal: ["結節間路（心房の中の伝わる道）"],
};
const CHAMBER_NAMES: Record<Chamber, [string, string]> = {
  ra: ["右心房", "right-atrium"], rv: ["右心室", "right-ventricle"], la: ["左心房", "left-atrium"], lv: ["左心室", "left-ventricle"],
};

/** タップした所の名前を出す欄（図鑑へのリンクつき） */
function pickBox(ctx: AppContext, name: (id: string, point: Vec3) => [string, string?] | null): HTMLElement {
  const box = h("p", { class: "motion-picked muted" }, "模型をタップすると、名前が出ます。");
  ctx.viewer.onSchematicPick = (id, point) => {
    const found = id && point ? name(id, point) : null;
    if (!found) return;
    const [ja, termId] = found;
    const term = termId ? termById.get(termId) : undefined;
    box.replaceChildren("タップした所：", h("b", {}, ja), ...(term ? [h("span", { class: "muted", lang: "en" }, ` ${term.en} `), h("a", { href: `#/explore/${term.id}` }, "図鑑で見る ›")] : []));
  };
  return box;
}

/** 札（HTML）を作り、viewer に渡す */
function placeTags<T extends { text: string; note?: string; at: Vec3; kind: string; valve?: ValveKey }>(ctx: AppContext, root: THREE.Object3D, tags: T[]): Map<T, HTMLElement> {
  const elements = new Map<T, HTMLElement>();
  const list: SchematicTag[] = tags.map((t) => {
    const element = tag(t.text, t.kind);
    if (t.note) element.append(h("small", {}, t.note));
    if (t.valve) element.append(h("b", { class: "stage-tag-state" }, "閉"));
    elements.set(t, element);
    return { element, at: t.at, object: root };
  });
  ctx.viewer.setTags(list);
  return elements;
}

/** 模型を3Dに置く（体の部品は隠す） */
function stageModel(ctx: AppContext, model: THREE.Object3D): THREE.Group {
  const root = new THREE.Group();
  root.scale.setScalar(CM);
  root.add(model);
  ctx.viewer.setSection(null);
  ctx.viewer.setStage({ solid: [] });
  ctx.viewer.setSchematic(root);
  return root;
}

function viewChips(views: [string, () => void][]): HTMLElement {
  return h("div", { class: "chip-list" }, ...views.map(([label, go]) => h("button", { class: "chip", type: "button", onClick: go }, label)));
}

// ---------------------------------------------------------------- 心臓

/** 大血管の割合（心拍出量のうち）。心臓だけの場面と全身の場面で変える */
interface HeartShares {
  svc: number;
  ivc: number;
  desc: number;
  bct: number;
  lcca: number;
  lsa: number;
  /** 道の太さ（割合から） */
  width: (share: number) => number;
}
const HEART_ONLY: HeartShares = { svc: 0.35, ivc: 0.65, desc: 0.7, bct: 0.15, lcca: 0.075, lsa: 0.075, width: (share) => share };

/** 心臓の模型の血液の流れ（部屋はたまり、弁の通り道と血管は道）。動脈の端は静脈の初めへ戻す（全身の場面ではつなぎ直す） */
function heartFlow(heart: HeartModel, cycle: CardiacCycle, shares = HEART_ONLY): { paths: Record<string, FlowPath>; pools: Record<string, FlowPool>; mean: number; by: (key: "ti" | "po" | "mi" | "ao", share?: number) => (u: number) => number } {
  const sv = (cycle.flow.ao.reduce((a, b) => a + b, 0) / cycle.flow.ao.length) * cycle.period;
  const series = (key: "mi" | "ao" | "ti" | "po") => normalizeFlow(cycle.flow[key], cycle.period, sv);
  const flows = { ti: series("ti"), po: series("po"), mi: series("mi"), ao: series("ao") };
  const mean = sv / cycle.period;
  const by = (key: keyof typeof flows, share = 1) => (u: number) => cyclic(flows[key], u) * share;
  const venous: [RGB, RGB] = [hex(VENOUS), hex(VENOUS)];
  const arterial: [RGB, RGB] = [hex(ARTERIAL), hex(ARTERIAL)];
  const line = (id: string) => VESSELS.find((v) => v.id === id)!.points;
  const w = shares.width;
  const toVeins = { paths: [["svc", shares.svc], ["ivc", shares.ivc]] as [string, number][] };
  const toLungVeins = { paths: [["rspv", 1], ["ripv", 1], ["lspv", 1], ["lipv", 1]] as [string, number][] };
  const vein = (id: string, share: number, to: string, blood: [RGB, RGB]): FlowPath => ({ points: line(id), rate: () => mean * share, width: w(share), to: { pool: to }, color: blood });
  const branch = (id: keyof HeartShares) => ({ points: line(id), rate: by("ao", shares[id] as number), width: w(shares[id] as number), to: toVeins, color: arterial });
  const paths: Record<string, FlowPath> = {
    svc: vein("svc", shares.svc, "ra", venous),
    ivc: vein("ivc", shares.ivc, "ra", venous),
    tv: { points: [[-3.9, 1.4, 0.3], heart.valveCenter.ti, [-3.0, -2.6, 0.3]], rate: by("ti"), width: 0.5, to: { pool: "rv" }, color: venous },
    pt: { points: [[-1.8, -3.4, 0.3], ...line("pt")], rate: by("po"), to: { paths: [["rpa", 0.55], ["lpa", 0.45]] }, color: venous },
    rpa: { points: line("rpa"), rate: by("po", 0.55), width: w(0.55), to: toLungVeins, color: venous },
    lpa: { points: line("lpa"), rate: by("po", 0.45), width: w(0.45), to: toLungVeins, color: venous },
    rspv: vein("rspv", 0.25, "la", arterial),
    ripv: vein("ripv", 0.25, "la", arterial),
    lspv: vein("lspv", 0.25, "la", arterial),
    lipv: vein("lipv", 0.25, "la", arterial),
    mv: { points: [[3.6, 1.6, 0.3], heart.valveCenter.mi, [3.7, -2.8, 0.3]], rate: by("mi"), width: 0.5, to: { pool: "lv" }, color: arterial },
    aorta: { points: [[2.4, -4.6, 0.3], ...line("aorta")], rate: by("ao"), to: { paths: [["desc", shares.desc], ["bct", shares.bct], ["lcca", shares.lcca], ["lsa", shares.lsa]] }, color: arterial },
    desc: branch("desc"),
    bct: branch("bct"),
    lcca: branch("lcca"),
    lsa: branch("lsa"),
  };
  const pool = (chamber: Chamber, rate: (u: number) => number, to: FlowPool["to"], color: string, seed: number): FlowPool => ({
    slots: heart.samples(chamber, 220, seed), rate, to, color: hex(color), move: heart.move, start: cyclic(cycle.volume[chamber], 0),
  });
  const pools: Record<string, FlowPool> = {
    ra: pool("ra", by("ti"), { paths: [["tv", 1]] }, VENOUS, 11),
    rv: pool("rv", by("po"), { paths: [["pt", 1]] }, VENOUS, 23),
    la: pool("la", by("mi"), { paths: [["mv", 1]] }, ARTERIAL, 37),
    lv: pool("lv", by("ao"), { paths: [["aorta", 1]] }, ARTERIAL, 41),
  };
  return { paths, pools, mean, by };
}

/** 部屋の縮み（容積が一番大きいとき 0、一番小さいとき 1） */
function contraction(cycle: CardiacCycle): (u: number, out: Record<Chamber, number>) => Record<Chamber, number> {
  const range = Object.fromEntries(CHAMBERS.map((c) => [c, [Math.min(...cycle.volume[c]), Math.max(...cycle.volume[c])]])) as Record<Chamber, [number, number]>;
  return (u, out) => {
    for (const c of CHAMBERS) {
      const [min, max] = range[c];
      out[c] = (max - cyclic(cycle.volume[c], u)) / (max - min);
    }
    return out;
  };
}

async function heartModelScene(ctx: AppContext, player: Player, item: MotionItem): Promise<void> {
  const { viewer, panel } = ctx;
  const conduction = item.id === "conduction";
  ctx.hint("読み込み中…");
  const cycle = await loadMotionData<CardiacCycle>("cardiac-cycle");
  if (ctx.signal.aborted) return;
  ctx.hint("");
  const timeline = cardiacTimeline(cycle);
  const heart = buildHeart({ conduction });
  const root = stageModel(ctx, heart.root);
  const views: [string, Vec3][] = [["前", [0, 0.04, 1]], ["斜め", [0.55, 0.3, 0.8]], ["下から", [0.1, -0.7, 0.75]]];
  const frame = (from: Vec3) => viewer.frameSchematic(from, conduction ? 0.86 : 1.05, conduction ? heart.root.children[0] : undefined);
  frame(views[0][1]);

  // 血管は刺激伝導系の場面では薄く
  if (conduction) {
    for (const material of heart.vesselMaterials.values()) material.opacity = 0.1;
    for (const valve of heart.semilunar) valve.visible = false;
  }

  // 札
  const conductionTags: HeartTag[] = conduction ? [
    { text: "洞房結節", note: "ペースメーカー", at: [-5.0, 6.2, 1.8], kind: "conduction", term: "sinuatrial-node" },
    { text: "房室結節", at: [-3.0, 1.0, 1.8], kind: "conduction", term: "atrioventricular-node" },
    { text: "ヒス束", at: [1.7, -0.7, 1.8], kind: "conduction", term: "atrioventricular-bundle" },
    { text: "右脚", at: [-1.2, -4.0, 1.8], kind: "conduction", term: "right-bundle-branch" },
    { text: "左脚", at: [2.1, -3.0, 1.8], kind: "conduction", term: "left-bundle-branch" },
    { text: "プルキンエ線維", at: [6.4, -7.6, 1.8], kind: "conduction", term: "purkinje-fibers" },
  ] : [];
  const tagList = [...heart.tags.filter((t) => !conduction || t.kind === "chamber"), ...conductionTags];
  let named = true;
  const tagElements = placeTags(ctx, root, tagList);
  const showTags = () => {
    for (const element of tagElements.values()) element.hidden = !named;
  };

  // 血液の粒
  const flow = conduction ? null : heartFlow(heart, cycle);
  const net = flow ? new FlowNet(flow.paths, flow.pools, 3.5, 0.22) : null;
  const sparkLines = conduction ? [CONDUCTION_PATHS.internodal, CONDUCTION_PATHS.bachmann, CONDUCTION_PATHS.his, CONDUCTION_PATHS.rbb, CONDUCTION_PATHS.lbb] : [];
  const dots = viewer.setDots(net ? net.count : sparkLines.length + 2, net ? 0.0022 : 0.0036)!;
  let showBlood = true;

  const muscle = new THREE.Color(MUSCLE);
  const hot = new THREE.Color("#f2913d");
  const excited = new THREE.Color("#ffd23f");
  const front = new THREE.Color("#fff6c8");
  const regionColor = Object.fromEntries(CHAMBERS.map((c) => [c, new THREE.Color()])) as Record<Chamber, THREE.Color>;
  const contract = contraction(cycle);
  const amount: Record<Chamber, number> = { ra: 0, rv: 0, la: 0, lv: 0 };
  const open: Record<ValveKey, number> = { ti: 0, po: 0, mi: 0, ao: 0 };

  // 刺激伝導系: 壁の点ごとの興奮の時刻（1拍の中の位置。1 を超えると次の拍の初め）
  const san = CONDUCTION_PATHS.san;
  const activation = (x: number, y: number, region: Chamber): [number, number] => {
    if (region === "ra" || region === "la") {
      const t = CONDUCTION.san + (Math.hypot(x - san[0], y - san[1]) / 11) * (CONDUCTION.avn - CONDUCTION.san + 0.01);
      return [t, t + 0.11];
    }
    // 心室: 心尖（下）から心底（上）へ。中隔は少し早い
    const height = Math.min(1, Math.max(0, (y + 9.8) / 9.2));
    const septum = Math.abs(x - 0.4) < 0.9 ? -0.008 : 0;
    const t = CONDUCTION.bundleEnd + height * (CONDUCTION.purkinjeEnd - CONDUCTION.bundleEnd) + septum;
    return [t, 1.27 - height * 0.03];
  };
  /** 0: 休み、1: 興奮している、2: 興奮が届いたばかり（波の先） */
  const excitedAt = (u: number, [from, to]: [number, number]): number => {
    const t = u + Math.ceil(from - 0.2 - u);
    if (t < from || t > to) return 0;
    return t - from < 0.012 ? 2 : 1;
  };

  const sparkPolylines = sparkLines.map((points) => points);
  const sparkAt = (points: Vec3[], f: number, out: Float32Array, o: number) => {
    const n = points.length - 1;
    const x = Math.min(n - 1e-6, Math.max(0, f * n));
    const i = Math.floor(x);
    const t = x - i;
    for (let k = 0; k < 3; k++) out[o + k] = (points[i][k] + (points[i + 1][k] - points[i][k]) * t) * CM;
  };
  const sparkFrame = (u: number) => {
    const c = CONDUCTION;
    const t = u < 0.5 ? u + 1 : u;
    const windows: [number, number][] = [[c.san, c.avn], [c.san + 0.01, c.avn], [c.avnLeave, c.his], [c.his, c.bundleEnd + 0.02], [c.his, c.purkinjeEnd]];
    sparkPolylines.forEach((points, i) => {
      const [a, b] = windows[i];
      if (t < a || t > b) {
        dots.size[i] = 0;
        return;
      }
      sparkAt(points, (t - a) / (b - a), dots.position, i * 3);
      dots.color.set(hex("#fffbe0"), i * 3);
      dots.size[i] = 1;
    });
    // 洞房結節・房室結節の明滅
    const nodes: [Vec3, boolean][] = [[CONDUCTION_PATHS.san, t >= c.san && t < c.san + 0.03], [CONDUCTION_PATHS.avn, t >= c.avn && t < c.his]];
    nodes.forEach(([at, on], k) => {
      const i = sparkPolylines.length + k;
      dots.position.set([at[0] * CM, at[1] * CM, (at[2] + 0.3) * CM], i * 3);
      dots.color.set(hex("#fff3b0"), i * 3);
      dots.size[i] = on ? 1.6 + Math.sin(t * 300) * 0.3 : 0;
    });
  };

  // 欄
  const phaseName = h("strong", { class: "motion-now-name" });
  const phaseNote = h("p", { class: "motion-now-note" });
  const valveRow = h("div", { class: "motion-valves" });
  const valveNames: [ValveKey, string][] = [["ti", "三尖弁"], ["po", "肺動脈弁"], ["mi", "僧帽弁"], ["ao", "大動脈弁"]];
  const valvePills = valveNames.map(([key, name]) => {
    const pill = h("span", { class: "motion-valve" }, name, h("b", {}));
    valveRow.append(pill);
    return [key, pill] as const;
  });
  const stepList = conduction ? h("ol", { class: "motion-steps" }, ...(Object.keys(CONDUCTION_STEPS) as ConductionStep[]).map((key) =>
    h("li", { "data-key": key }, h("b", {}, CONDUCTION_STEPS[key].ja), h("span", {}, CONDUCTION_STEPS[key].note)))) : null;
  const sound = new HeartSound();
  let lastU = 0;
  const graph = conduction ? ecgChart((u) => player.seek(u, cycle.period)) : wiggers(cycle, timeline, (u) => player.seek(u, cycle.period));

  player.onFrame((time, dt) => {
    const u = (time / cycle.period) % 1;
    const state = heartState(cycle, u);
    Object.assign(open, state.open);
    heart.update(contract(u, amount), open);
    // 壁の色: 拍動の場面は縮んでいる部屋を橙に、刺激伝導系の場面は興奮している所を黄に
    if (conduction) {
      heart.paint((x, y, region, out) => {
        const e = excitedAt(u, activation(x, y, region));
        out.copy(muscle);
        if (e) out.lerp(e === 2 ? front : excited, e === 2 ? 0.9 : 0.62);
      });
      sparkFrame(u);
    } else {
      for (const c of CHAMBERS) regionColor[c].copy(muscle).lerp(hot, Math.min(1, cyclic(cycle.activation[c], u)) * 0.55);
      heart.paint((_x, _y, region, out) => out.copy(regionColor[region]));
      net!.step(u, dt);
      net!.write(dots.position, dots.color, dots.size, CM, () => showBlood);
    }
    heart.arrows.atria.visible = Math.max(cyclic(cycle.activation.la, u), cyclic(cycle.activation.ra, u)) > 0.25;
    heart.arrows.ventricles.visible = cyclic(cycle.activation.lv, u) > 0.25;
    viewer.dotsChanged(dots.capacity);
    graph.cursor(u);
    const phase = phaseAt(timeline, u);
    if (conduction) {
      const step = conductionStep(u);
      if (phaseName.dataset.key !== step) {
        phaseName.dataset.key = step;
        phaseName.textContent = CONDUCTION_STEPS[step].ja;
        phaseNote.textContent = `${CARDIAC_PHASES[phase].ja}のころ。${CONDUCTION_STEPS[step].note}`;
        for (const li of stepList!.children) li.classList.toggle("on", (li as HTMLElement).dataset.key === step);
      }
    } else if (phaseName.dataset.key !== phase) {
      phaseName.dataset.key = phase;
      phaseName.textContent = `${CARDIAC_PHASES[phase].ja}（${CARDIAC_PHASES[phase].systole ? "収縮期" : "拡張期"}）`;
      phaseNote.textContent = CARDIAC_PHASES[phase].note;
    }
    for (const [key, pill] of valvePills) {
      const isOpen = open[key] > 0.05;
      if (pill.classList.contains("open") !== isOpen) {
        pill.classList.toggle("open", isOpen);
        pill.lastElementChild!.textContent = isOpen ? "開" : "閉";
      }
    }
    for (const [t, element] of tagElements) {
      if (!t.valve) continue;
      const isOpen = open[t.valve] > 0.05;
      if (element.classList.contains("open") !== isOpen) {
        element.classList.toggle("open", isOpen);
        element.lastElementChild!.textContent = isOpen ? "開" : "閉";
      }
    }
    if (dt > 0) sound.cross(lastU, u, timeline);
    lastU = u;
  });

  const lv = cycle.volume.lv;
  const sv = timeline.edv - timeline.esv;
  const sas = cycle.pressure.sas;
  panel.replaceChildren(
    modeSwitch(item, false),
    h("div", { class: "motion-head" }, h("h2", {}, conduction ? "刺激伝導系と心電図" : "心臓の拍動と心周期"), h("span", { class: "muted", lang: "en" }, conduction ? "cardiac conduction system" : "cardiac cycle")),
    h("p", { class: "motion-lead" }, conduction
      ? "心臓を前から切った模型です。黄色の線が刺激伝導系、壁が黄色くなっている所が興奮している所。洞房結節 → 心房 → 房室結節（少し待つ）→ ヒス束 → 右脚・左脚 → プルキンエ線維と進み、心室は心尖から心底へ興奮します。下の心電図の今の位置と見比べてください。"
      : "心臓を前から切った模型です。青の粒は静脈血（右心系）、赤の粒は動脈血（左心系）。血液は心房にたまり、弁が開いた間だけ次の部屋・血管へ流れます。縮んでいる部屋は橙色に。グラフを押すと、その時点で止まります。"),
    player.controls(() => cycle.period),
    h("div", { class: "motion-now" }, phaseName, phaseNote, conduction ? "" : valveRow),
    graph.svg,
    stepList ?? "",
    h("h3", { class: "list-title" }, "見方"),
    viewChips(views.map(([label, from]) => [label, () => frame(from)])),
    toggle("名前を出す", named, (on) => {
      named = on;
      showTags();
    }),
    conduction ? "" : toggle("血液の粒を出す", showBlood, (on) => (showBlood = on)),
    conduction ? "" : toggle("心音を鳴らす（Ⅰ音・Ⅱ音）", false, (on) => sound.enable(on)),
    pickBox(ctx, (id, point) => {
      if (id === "heart" || id === "right-heart" || id === "left-heart") return CHAMBER_NAMES[heartRegion(point[0] / CM, point[1] / CM)];
      return PICK_NAMES[id] ?? null;
    }),
    conduction ? "" : h("h3", { class: "list-title" }, "この1拍の数値（モデルの値）"),
    conduction ? "" : h("dl", { class: "motion-facts" },
      h("dt", {}, "心拍数"), h("dd", {}, `${Math.round(60 / cycle.period)} 回/分`),
      h("dt", {}, "左心室の容積"), h("dd", {}, `拡張末期 ${Math.round(timeline.edv)} mL → 収縮末期 ${Math.round(timeline.esv)} mL`),
      h("dt", {}, "1回拍出量・駆出率"), h("dd", {}, `${Math.round(sv)} mL・${Math.round((sv / Math.max(...lv)) * 100)}%`),
      h("dt", {}, "大動脈圧"), h("dd", {}, `${Math.round(Math.max(...sas))} / ${Math.round(Math.min(...sas))} mmHg`),
    ),
    h("h3", { class: "list-title" }, "関係する語"),
    relatedTerms(conduction
      ? ["sinuatrial-node", "atrioventricular-node", "atrioventricular-bundle", "right-bundle-branch", "left-bundle-branch", "purkinje-fibers", "interventricular-septum", "crista-terminalis"]
      : ["right-atrium", "right-ventricle", "left-atrium", "left-ventricle", "tricuspid-valve", "pulmonary-valve", "mitral-valve", "aortic-valve", "chordae-tendineae", "papillary-muscles"]),
    h("p", { class: "plate-credit muted" },
      "模型は教科書の模式図にならった作り物です（部屋の大きさ・弁の位置は分かりやすさを優先）。部屋の縮み・弁の開き・血液の流れる量は ModularCirc（Alan Turing Institute, MIT License）の Korakianitis & Shi (2006) の4つの部屋のモデルを解いた値。心電図は模式です。実際の心臓の形で見るときは、上の「実際の形」を。"),
  );
  if (!player.playing) ctx.hint("▶ 再生 で動きます");
}

// ---------------------------------------------------------------- 呼吸

const LUNG_PICKS: Record<string, [string, string?]> = {
  "right-lung": ["右肺", "lung"], "left-lung": ["左肺", "lung"], trachea: ["気管", "trachea"], "right-main-bronchus": ["右主気管支", "main-bronchus"],
  "left-main-bronchus": ["左主気管支", "main-bronchus"], "lobar-bronchi": ["葉気管支", "lobar-bronchi"], "segmental-bronchi": ["区域気管支", "segmental-bronchi"],
  diaphragm: ["横隔膜", "diaphragm"], ribs: ["肋骨", "ribs"], "costal-cartilages": ["肋軟骨", "costal-cartilages"], sternum: ["胸骨", "sternum"],
  "thoracic-vertebrae": ["胸椎", "thoracic-vertebrae"], heart: ["心臓"], liver: ["肝臓", "liver"], stomach: ["胃", "stomach"],
};

async function breathingModelScene(ctx: AppContext, player: Player, item: MotionItem): Promise<void> {
  const { viewer, panel } = ctx;
  ctx.hint("読み込み中…");
  const data = await loadMotionData<BreathingData>("breathing");
  if (ctx.signal.aborted) return;
  ctx.hint("");
  const lungs = buildLungs();
  const root = stageModel(ctx, lungs.root);
  const views: [string, Vec3][] = [["前", [0, 0.05, 1]], ["右から", [-1, 0.06, 0.08]], ["斜め", [-0.62, 0.22, 0.76]]];
  const frame = (from: Vec3) => viewer.frameSchematic(from, 1.12);
  frame(views[0][1]);

  let deep = false;
  let named = true;
  const period = () => data.period * (deep ? DEEP.period : 1);
  const vmax = Math.max(...data.volume);
  const n = data.volume.length;
  const slope = (u: number) => (cyclic(data.volume, u + 0.5 / n) - cyclic(data.volume, u - 0.5 / n)) * n;
  let maxSlope = 0;
  for (let i = 0; i < 200; i++) maxSlope = Math.max(maxSlope, Math.abs(slope(i / 200)));

  const tagElements = placeTags<LungTag>(ctx, root, lungs.tags);

  // 空気の粒（気管 → 気管支 → 肺の中）
  const lines = lungs.airways.map((points) => ({ points, length: points.length - 1 }));
  const perLine = 16;
  const dots = viewer.setDots(lines.length * perLine, 0.0032)!;
  const air = lines.flatMap((_, k) => Array.from({ length: perLine }, (_, i) => ({ k, f: (i + ((i * 7919 + k * 31) % 100) / 100) / perLine })));
  const fresh = hex("#4fc3f7");
  const stale = hex("#9aa3ad");
  const at: Vec3 = [0, 0, 0];
  const moved: Vec3 = [0, 0, 0];

  // グラフ: 肺の容積・肺胞内圧・胸腔内圧（圧は容積の変化からの模式。安静呼吸）
  const alveolar = Array.from({ length: 96 }, (_, i) => -slope(i / 96) / maxSlope);
  const pleural = Array.from({ length: 96 }, (_, i) => alveolar[i] - (5 + 2.5 * (cyclic(data.volume, i / 96) / vmax)));
  const volume = Array.from({ length: 96 }, (_, i) => cyclic(data.volume, i / 96));
  const graph = chart(268, [
    { values: volume, color: "#c2493a", min: 0, max: vmax * 1.12, top: 26, height: 82, width: 2.6 },
    { values: alveolar, color: "#2f6f9f", min: -1.3, max: 1.3, top: 128, height: 52, width: 2.2 },
    { values: pleural, color: "#7a4fb5", min: -8.6, max: -4.2, top: 200, height: 56, width: 2.2 },
  ], (svg, x) => {
    let start = -1;
    for (let i = 0; i <= 96; i++) {
      const rising = i < 96 && volume[(i + 1) % 96] > volume[i];
      if (rising && start < 0) start = i;
      if ((!rising || i === 96) && start >= 0) {
        svg.append(el("rect", { x: x(start / 96), y: 0, width: x(i / 96) - x(start / 96), height: 268, fill: "#e6f3fb" }),
          el("text", { x: (x(start / 96) + x(i / 96)) / 2, y: 14, class: "motion-band", "text-anchor": "middle" }, "吸気"));
        start = -1;
      }
    }
    svg.append(el("text", { x: x(0.72), y: 14, class: "motion-band", "text-anchor": "middle" }, "呼気"));
    // 0 cmH2O の線（肺胞内圧）
    const zero = 128 + 52 / 2;
    svg.append(el("line", { x1: x(0), x2: x(1), y1: zero, y2: zero, stroke: "#b9b2a3", "stroke-dasharray": "3 3" }));
    axisLabel(svg, "容積", 62, "#c2493a");
    axisLabel(svg, "肺胞", 150, "#2f6f9f");
    axisLabel(svg, "内圧", 164, "#2f6f9f");
    axisLabel(svg, "胸腔", 224, "#7a4fb5");
    axisLabel(svg, "内圧", 238, "#7a4fb5");
    svg.append(
      el("text", { x: CHART_W - 10, y: 40, class: "motion-legend", "text-anchor": "end", fill: "#c2493a" }, `肺の容積（+${Math.round(vmax)} mL まで）`),
      el("text", { x: CHART_W - 10, y: 140, class: "motion-legend", "text-anchor": "end", fill: "#2f6f9f" }, "肺胞内圧（0 を境に ±1 cmH₂O）"),
      el("text", { x: CHART_W - 10, y: 212, class: "motion-legend", "text-anchor": "end", fill: "#7a4fb5" }, "胸腔内圧（−5 → −7.5 cmH₂O）"),
    );
  }, (u) => player.seek(u, period()), "1呼吸の肺の容積・肺胞内圧・胸腔内圧のグラフ");

  const phaseName = h("strong", { class: "motion-now-name" });
  const phaseNote = h("p", { class: "motion-now-note" });
  const volumeText = h("span", { class: "motion-volume" });

  player.onFrame((time, dt) => {
    const u = (time / period()) % 1;
    const amp = deep ? DEEP.amplitude : 1;
    const breath = (cyclic(data.volume, u) / vmax) * amp;
    const flow = slope(u) / maxSlope; // -1〜1（吸うと +）
    lungs.update(breath, flow);
    const color = flow >= 0 ? fresh : stale;
    for (const [i, particle] of air.entries()) {
      const line = lines[particle.k];
      particle.f += (dt / period()) * flow * 1.1 * (deep ? 1.4 : 1);
      if (particle.f > 1) particle.f -= 1;
      if (particle.f < 0) particle.f += 1;
      const x = particle.f * line.length;
      const j = Math.min(line.length - 1, Math.floor(x));
      const t = x - j;
      for (let k = 0; k < 3; k++) at[k] = line.points[j][k] + (line.points[j + 1][k] - line.points[j][k]) * t;
      lungs.move(at, moved);
      dots.position[i * 3] = moved[0] * CM;
      dots.position[i * 3 + 1] = moved[1] * CM;
      dots.position[i * 3 + 2] = moved[2] * CM;
      dots.color.set(color, i * 3);
      // 気管の入口と肺の奥では小さく（入って消える・出てくる）
      const fade = Math.min(1, particle.f / 0.06, (1 - particle.f) / 0.18);
      dots.size[i] = (Math.abs(flow) > 0.08 ? 1 : 0.6) * Math.max(0, fade);
    }
    viewer.dotsChanged(dots.capacity);
    graph.cursor(u);
    const inhale = inhaling(data, u);
    const moving = Math.abs(flow) > 0.12;
    for (const [t, element] of tagElements) {
      element.hidden = !named || (t.phase ? !moving || (t.phase === "in") !== inhale : false);
    }
    const key = `${inhale}:${deep}`;
    if (phaseName.dataset.key !== key) {
      phaseName.dataset.key = key;
      phaseName.textContent = inhale ? "吸気（息を吸う）" : "呼気（息を吐く）";
      phaseNote.textContent = inhale
        ? deep
          ? "横隔膜が強く縮んで大きく下がり、外肋間筋に加えて胸鎖乳突筋・斜角筋なども肋骨と胸骨を引き上げる。胸腔が広がって内圧が下がり、肺がふくらむ。"
          : "横隔膜が縮んでドームが下がり（主な吸気筋）、外肋間筋が肋骨を引き上げて胸郭が前と横へ広がる。胸腔内圧が下がって肺がふくらみ、肺胞内圧が大気より低くなって空気が入る（水色の粒）。"
        : deep
          ? "強く吐くときは、内肋間筋が肋骨を引き下げ、腹筋が腹圧を上げて横隔膜を押し上げる。"
          : "安静の呼気は受け身: 横隔膜と外肋間筋がゆるみ、肺と胸郭が自分の弾性で縮む。肺胞内圧が大気より高くなって空気が出る（灰色の粒）。";
    }
    volumeText.textContent = `肺の容積 ＋${Math.round(cyclic(data.volume, u) * amp)} mL`;
  });

  const tidal = Math.round(vmax);
  panel.replaceChildren(
    modeSwitch(item, false),
    h("div", { class: "motion-head" }, h("h2", {}, "呼吸"), h("span", { class: "muted", lang: "en" }, "breathing")),
    h("p", { class: "motion-lead" }, "胸の模型です。息を吸うと、横隔膜のドームが下がり、肋骨が上がって胸郭が前と横へ広がり、肺がふくらんで空気が入ります。肝臓と胃も押し下げられます。「右から」で見ると、胸骨が前へ出る動きと横隔膜の下がり方がよく分かります。"),
    player.controls(period),
    h("div", { class: "motion-now" }, phaseName, phaseNote, volumeText),
    graph.svg,
    h("div", { class: "motion-switch" }, segmented<boolean>("呼吸の深さ", [{ value: false, label: "安静呼吸" }, { value: true, label: "深呼吸（目安）" }], deep, (value) => {
      deep = value;
      phaseName.dataset.key = "";
    })),
    h("h3", { class: "list-title" }, "見方"),
    viewChips(views.map(([label, from]) => [label, () => frame(from)])),
    toggle("名前を出す", named, (on) => (named = on)),
    toggle("肋骨を出す", true, (on) => (lungs.parts.ribs.visible = on)),
    toggle("心臓と腹の臓器（肝臓・胃）を出す", true, (on) => {
      lungs.parts.heart.visible = on;
      lungs.parts.abdomen.visible = on;
    }),
    pickBox(ctx, (id) => LUNG_PICKS[id] ?? null),
    h("h3", { class: "list-title" }, "この呼吸の数値（被験者の実測）"),
    h("dl", { class: "motion-facts" },
      h("dt", {}, "1回換気量"), h("dd", {}, `約 ${tidal} mL（安静呼吸。成人の目安は約 500 mL）`),
      h("dt", {}, "1呼吸の長さ"), h("dd", {}, `約 ${data.period.toFixed(1)} 秒（毎分 約 ${Math.round(60 / data.period)} 回）`),
      h("dt", {}, "吸気と呼気"), h("dd", {}, "吸気の方が短い（呼気は受け身でゆっくり）"),
    ),
    h("p", { class: "home-note" }, `模型の動きは見やすいよう大きくしています（安静呼吸で横隔膜 ${BREATH.diaphragm} cm。実際は約 1.5 cm）。深呼吸は安静呼吸の ${DEEP.amplitude} 倍・周期 ${DEEP.period} 倍の目安です。肺胞内圧・胸腔内圧は容積の変化から描いた模式です。`),
    h("h3", { class: "list-title" }, "関係する語"),
    relatedTerms(["diaphragm", "external-intercostal", "internal-intercostal", "lung", "trachea", "main-bronchus", "pleural-cavity", "costodiaphragmatic-recess", "sternocleidomastoid"]),
    h("p", { class: "plate-credit muted" },
      "模型は教科書の模式図にならった作り物です。呼吸の時間の流れ（吸気と呼気の長さ・容積の変化）は 4DMRI moving meshes（A. Duetschler ほか, Zenodo 2022, doi:10.5281/zenodo.7052607, CC BY 4.0）の自由呼吸 47 回の平均。実際の肺と胸郭の形で見るときは、上の「実際の形」を。"),
  );
  if (!player.playing) ctx.hint("▶ 再生 で動きます");
}

// ---------------------------------------------------------------- 肺循環と体循環

const BODY_PICKS: Record<string, [string, string?]> = {
  "head-a": ["左総頸動脈（頭へ）", "common-carotid-artery"], "head-v": ["内頸静脈（頭から）", "internal-jugular-vein"],
  "r-arm-a": ["鎖骨下動脈 → 腋窩動脈 → 上腕動脈（腕へ）", "subclavian-artery"], "l-arm-a": ["鎖骨下動脈 → 腋窩動脈 → 上腕動脈（腕へ）", "subclavian-artery"],
  "r-arm-v": ["腕の静脈 → 腕頭静脈", "brachiocephalic-vein"], "l-arm-v": ["腕の静脈 → 腕頭静脈", "brachiocephalic-vein"],
  "aorta-1": ["腹大動脈", "abdominal-aorta"], "aorta-2": ["腹大動脈", "abdominal-aorta"], "aorta-3": ["腹大動脈", "abdominal-aorta"],
  "gut-a": ["上腸間膜動脈（腸へ）", "superior-mesenteric-artery"], portal: ["門脈（腸から肝臓へ）", "hepatic-portal-vein"],
  "r-renal-a": ["腎動脈", "renal-artery"], "l-renal-a": ["腎動脈", "renal-artery"], "r-renal-v": ["腎静脈", "renal-vein"], "l-renal-v": ["腎静脈", "renal-vein"],
  "r-leg-a": ["総腸骨動脈 → 大腿動脈（脚へ）", "femoral-artery"], "l-leg-a": ["総腸骨動脈 → 大腿動脈（脚へ）", "femoral-artery"],
  "r-leg-v": ["大腿静脈 → 総腸骨静脈", "femoral-vein"], "l-leg-v": ["大腿静脈 → 総腸骨静脈", "femoral-vein"],
  "ivc-1": ["下大静脈", "inferior-vena-cava"], "ivc-2": ["下大静脈", "inferior-vena-cava"], "ivc-3": ["下大静脈", "inferior-vena-cava"],
  "head-c": ["脳の毛細血管", "capillary"], "r-arm-c": ["腕の毛細血管", "capillary"], "l-arm-c": ["腕の毛細血管", "capillary"], "gut-c": ["腸の毛細血管", "capillary"],
  "liver-c": ["肝臓の類洞（門脈と肝動脈の血液が流れる）", "dig-liver-lobule"], "r-kidney-c": ["腎臓の毛細血管（糸球体など）", "capillary"], "l-kidney-c": ["腎臓の毛細血管（糸球体など）", "capillary"],
  "r-leg-c": ["脚の毛細血管", "capillary"], "l-leg-c": ["脚の毛細血管", "capillary"], "r-lung-c": ["肺の毛細血管（肺胞のまわり）", "capillary"], "l-lung-c": ["肺の毛細血管（肺胞のまわり）", "capillary"],
};

/** 肺循環の道（ほかは体循環。弁の通り道は両方） */
const PULMONARY = new Set(["rv", "pt", "rpa", "lpa", "r-lung-c", "l-lung-c", "rspv", "ripv", "lspv", "lipv", "la"]);
const BOTH = new Set(["tv", "mv"]);

async function circulationModelScene(ctx: AppContext, player: Player, item: MotionItem): Promise<void> {
  const { viewer, panel } = ctx;
  ctx.hint("読み込み中…");
  const cycle = await loadMotionData<CardiacCycle>("cardiac-cycle");
  if (ctx.signal.aborted) return;
  ctx.hint("");
  const heart = buildHeart();
  const body = buildBody();
  const group = new THREE.Group();
  group.add(heart.root, body.root);
  const root = stageModel(ctx, group);
  const views: [string, () => void][] = [
    ["全身", () => viewer.frameSchematic([0, 0.03, 1], 1.02)],
    ["胸（心臓と肺）", () => viewer.frameSchematic([0, 0.05, 1], 0.4, heart.root.children[0])],
    ["心臓", () => viewer.frameSchematic([0, 0.05, 1], 1.0, heart.root.children[0])],
  ];
  views[0][1]();

  // 流れ: 心臓の模型の大血管の端を、全身の道へつなぎ直す
  const shares: HeartShares = { svc: 0.29, ivc: 0.71, desc: 0.71, bct: 0.07, lcca: 0.15, lsa: 0.07, width: (share) => Math.sqrt(share) };
  const { paths, pools, mean, by } = heartFlow(heart, cycle, shares);
  paths.desc.to = { paths: [["aorta-1", 1]] };
  paths.bct.to = { paths: [["r-arm-a", 1]] };
  paths.lcca.to = { paths: [["head-a", 1]] };
  paths.lsa.to = { paths: [["l-arm-a", 1]] };
  paths.rpa.to = { paths: [["r-lung-c", 1]] };
  paths.lpa.to = { paths: [["l-lung-c", 1]] };
  const circuit = new Map<string, "systemic" | "pulmonary" | "both">();
  for (const id of [...Object.keys(paths), ...Object.keys(pools)]) circuit.set(id, BOTH.has(id) ? "both" : PULMONARY.has(id) ? "pulmonary" : "systemic");
  for (const [id, path] of Object.entries(BODY_PATHS)) {
    const root2 = Math.sqrt(path.share);
    paths[id] = {
      points: path.points,
      // 動脈は拍動につれて、毛細血管と静脈はならした流れで
      rate: path.kind === "artery" ? by("ao", path.share) : () => mean * path.share,
      width: path.kind === "artery" ? root2 : path.kind === "capillary" ? root2 * 3.2 : root2 * 1.3,
      to: { paths: path.to },
      color: [hex(path.blood[0] === "arterial" ? ARTERIAL : VENOUS), hex(path.blood[1] === "arterial" ? ARTERIAL : VENOUS)],
    };
    circuit.set(id, path.circuit);
  }
  const net = new FlowNet(paths, pools, 5, 0.22);
  const dots = viewer.setDots(net.count, 0.0034)!;
  let filter = "both" as "both" | "systemic" | "pulmonary";
  const visible = (id: string) => filter === "both" || circuit.get(id) === "both" || circuit.get(id) === filter;

  // 札
  type Tag = { text: string; note?: string; at: Vec3; kind: string };
  const tags: Tag[] = [
    ...ORGANS.map((organ): Tag => ({ text: organ.ja, note: organ.note, at: organ.tag, kind: "organ" })),
    { text: "大動脈", at: [7.6, -16, -3.2], kind: "vessel" },
    { text: "下大静脈", at: [-10.6, -33, 0], kind: "vessel" },
    { text: "上大静脈", at: [-6.6, 20, 0], kind: "vessel" },
    { text: "門脈", at: [-0.6, -21.6, 3], kind: "vessel" },
    { text: "肺動脈", at: [-9.6, 9.0, -2.4], kind: "vessel" },
    { text: "肺静脈", at: [11.6, -0.2, 0], kind: "vessel" },
    { text: "心臓", at: [0, -11.6, 2], kind: "chamber" },
    { text: "毛細血管で 静脈血 → 動脈血", at: [-17, -4.6, -2.6], kind: "note" },
    { text: "毛細血管で 動脈血 → 静脈血", at: [-14.6, -48.4, 0], kind: "note" },
  ];
  let named = true;
  const tagElements = placeTags(ctx, root, tags);

  const muscle = new THREE.Color(MUSCLE);
  const hot = new THREE.Color("#f2913d");
  const regionColor = Object.fromEntries(CHAMBERS.map((c) => [c, new THREE.Color()])) as Record<Chamber, THREE.Color>;
  const contract = contraction(cycle);
  const amount: Record<Chamber, number> = { ra: 0, rv: 0, la: 0, lv: 0 };
  const open: Record<ValveKey, number> = { ti: 0, po: 0, mi: 0, ao: 0 };
  player.onFrame((time, dt) => {
    const u = (time / cycle.period) % 1;
    Object.assign(open, heartState(cycle, u).open);
    heart.update(contract(u, amount), open);
    for (const c of CHAMBERS) regionColor[c].copy(muscle).lerp(hot, Math.min(1, cyclic(cycle.activation[c], u)) * 0.55);
    heart.paint((_x, _y, region, out) => out.copy(regionColor[region]));
    heart.arrows.ventricles.visible = false;
    heart.arrows.atria.visible = false;
    net.step(u, dt);
    net.write(dots.position, dots.color, dots.size, CM, visible);
    viewer.dotsChanged(dots.capacity);
  });

  const legend = h("p", { class: "motion-now-note" });
  const describe = () => {
    legend.textContent = filter === "pulmonary"
      ? "肺循環（小循環）: 右心室 → 肺動脈幹 → 肺動脈 → 肺の毛細血管（二酸化炭素を出し、酸素を受け取る）→ 肺静脈 → 左心房。肺動脈は静脈血（青）、肺静脈は動脈血（赤）を運ぶ。"
      : filter === "systemic"
        ? "体循環（大循環）: 左心室 → 大動脈 → 全身の動脈 → 毛細血管（酸素を渡し、二酸化炭素を受け取る）→ 静脈 → 上大静脈・下大静脈 → 右心房。腸からの血液は門脈を通って肝臓の毛細血管（類洞）を通ってから戻る。"
        : "赤＝動脈血（酸素の多い血液）、青＝静脈血。粒の色が変わる所が毛細血管。体循環から右心房へ戻った血液は肺循環へ、肺循環から左心房へ戻った血液は体循環へ進み、8の字に回る。";
    // 見せない方の循環の血管・臓器は薄く
    for (const { circuit: c, material, base } of body.materials) material.opacity = filter === "both" || c === filter ? base : base * 0.25;
    for (const [id, material] of heart.vesselMaterials) {
      const c = ["pt", "rpa", "lpa", "rspv", "ripv", "lspv", "lipv"].includes(id) ? "pulmonary" : "systemic";
      material.opacity = filter === "both" || c === filter ? 0.32 : 0.08;
    }
  };
  describe();

  panel.replaceChildren(
    modeSwitch(item, false),
    h("div", { class: "motion-head" }, h("h2", {}, "肺循環と体循環"), h("span", { class: "muted", lang: "en" }, "pulmonary and systemic circulation")),
    h("p", { class: "motion-lead" }, "全身の血液の通り道の模型です。真ん中が心臓（前から切った模型）、まわりが肺と全身の臓器。粒が血液で、拍動につれて動脈の中で速くなり、毛細血管でゆっくりになって色が変わります（実際は1周に約1分）。"),
    player.controls(() => cycle.period),
    h("div", { class: "motion-switch" }, segmented<typeof filter>("見せる流れ", [{ value: "both", label: "両方" }, { value: "pulmonary", label: "肺循環" }, { value: "systemic", label: "体循環" }], filter, (value) => {
      filter = value;
      describe();
    })),
    h("div", { class: "motion-now" }, legend),
    h("h3", { class: "list-title" }, "見る所"),
    viewChips(views),
    toggle("名前を出す", named, (on) => {
      named = on;
      for (const element of tagElements.values()) element.hidden = !on;
    }),
    pickBox(ctx, (id, point) => {
      if (id === "heart" || id === "right-heart" || id === "left-heart") return CHAMBER_NAMES[heartRegion(point[0] / CM, point[1] / CM)];
      const organ = ORGANS.find((o) => o.id === id);
      if (organ) return [organ.ja, organ.term];
      return BODY_PICKS[id] ?? PICK_NAMES[id] ?? null;
    }),
    h("h3", { class: "list-title" }, "心拍出量の分かれ方（安静時の目安）"),
    h("p", { class: "home-note" }, "体循環の粒は、この割合で行き先を選んでいます。肺循環には心拍出量の全部が流れます。"),
    h("dl", { class: "motion-facts" },
      h("dt", {}, "脳（頭）"), h("dd", {}, "15%"),
      h("dt", {}, "腕"), h("dd", {}, "左右 7% ずつ"),
      h("dt", {}, "消化管 → 門脈 → 肝臓"), h("dd", {}, "25%"),
      h("dt", {}, "腎臓"), h("dd", {}, "20%（左右 10% ずつ）"),
      h("dt", {}, "脚（筋と皮膚など）"), h("dd", {}, "左右 13% ずつ"),
    ),
    h("h3", { class: "list-title" }, "関係する語"),
    relatedTerms(["left-ventricle", "ascending-aorta", "aortic-arch", "pulmonary-trunk", "pulmonary-veins", "superior-vena-cava", "inferior-vena-cava", "hepatic-portal-vein", "right-atrium", "left-atrium", "capillary"]),
    h("p", { class: "plate-credit muted" }, "模型は教科書の模式図にならった作り物です（臓器の位置・血管の道すじは分かりやすさを優先）。拍動と弁を流れる量は ModularCirc（MIT）の Korakianitis & Shi (2006) のモデルの値。実際の血管の形で見るときは、上の「実際の形」を。"),
  );
  if (!player.playing) ctx.hint("▶ 再生 で動きます");
}
