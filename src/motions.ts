import type { Vec3 } from "./landmarks";

/**
 * 動きの図鑑（#/motions。docs/動きの図鑑.md）の計算。データは public/motions/ の JSON（scripts/motions/ が作る）:
 * - cardiac-cycle.json: 1拍の4つの部屋の容積・圧と弁の流れ（ModularCirc（MIT）の Korakianitis のモデルを scripts/motions/cardiac_cycle.py で解いた値）
 * - breathing.json: 呼吸の肺と胸郭の変位の場（4DMRI moving meshes（CC BY 4.0）の自由呼吸の平均。scripts/motions/breathing.py）
 * - heart.json: 心臓の目印（心尖・弁の輪・刺激伝導系の道）と、心臓の中の流れ・空気の道（scripts/motions/paths.py）
 * - circulation.json: 全身の血液の流れの道すじ（体循環・肺循環。scripts/motions/paths.py）
 * 画面と3Dは src/ui/motions.ts。ここは3Dに依らない計算だけ（tests/motions.test.ts）
 */

export type Chamber = "la" | "lv" | "ra" | "rv";
export type ValveKey = "mi" | "ao" | "ti" | "po";
export type FlowKey = ValveKey | "svn" | "pvn";

export interface CardiacCycle {
  source: string;
  /** 1拍の長さ（秒） */
  period: number;
  t: number[];
  volume: Record<Chamber, number[]>;
  pressure: Record<Chamber | "sas" | "pas", number[]>;
  flow: Record<FlowKey, number[]>;
  activation: Record<Chamber, number[]>;
}

export interface BreathingField {
  /** 2つの形（格子の点ごとの x y z。0.01mm 単位の整数） */
  modes: number[][];
  /** 位相ごとの2つの形の重み */
  weights: number[][];
}

export interface BreathingData {
  source: string;
  phases: number;
  /** 1呼吸の長さ（秒） */
  period: number;
  grid: { origin: Vec3; step: number; shape: [number, number, number] };
  fields: Record<"lung" | "chest", BreathingField>;
  /** 位相ごとの肺の容積の増え方（mL。呼気の終わりから） */
  volume: number[];
}

export interface Valve {
  c: Vec3;
  /** 輪の面に垂直な向き（房室弁は心室へ、動脈弁は動脈へ） */
  n: Vec3;
  r: number;
}

export interface HeartData {
  apex: Vec3;
  base: Vec3;
  /** 心底から心尖への向き */
  axis: Vec3;
  chambers: Record<Chamber, Vec3>;
  valves: Record<"mitral" | "tricuspid" | "aortic" | "pulmonary", Valve>;
  conduction: { san: Vec3; avn: Vec3; his: Vec3; rbb: Vec3[]; lbb: Vec3[][]; purkinje: Vec3[] };
  flows: { blood: "venous" | "arterial"; segments: { flow: FlowKey; points: Vec3[] }[] }[];
  airways: Vec3[][];
}

export interface Route {
  id: string;
  kind: "systemic" | "pulmonary";
  label: string;
  /** 毛細血管の初めと終わりの点の番号 */
  capillary: [number, number];
  /** 点（0.1mm 単位の整数の x y z の並び） */
  points: number[];
}

export interface CirculationData {
  routes: Route[];
}

const loaded = new Map<string, Promise<unknown>>();

/** public/motions/<name>.json を読む（一度だけ） */
export function loadMotionData<T>(name: "cardiac-cycle" | "breathing" | "heart" | "circulation"): Promise<T> {
  let data = loaded.get(name);
  if (!data) {
    data = fetch(`${import.meta.env.BASE_URL}motions/${name}.json`).then((response) => {
      if (!response.ok) throw new Error(`motions/${name}.json を読めませんでした（${response.status}）`);
      return response.json();
    });
    data.catch(() => loaded.delete(name));
    loaded.set(name, data);
  }
  return data as Promise<T>;
}

/** 1周期の値の並びの u（0〜1）の所の値（くり返すとして、となりの値との間を補う） */
export function cyclic(series: number[], u: number): number {
  const n = series.length;
  const x = (((u % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const f = x - i;
  return series[i % n] * (1 - f) + series[(i + 1) % n] * f;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- 心周期

export type CardiacPhaseKey = "atrial" | "isoContraction" | "rapidEjection" | "reducedEjection" | "isoRelaxation" | "rapidFilling" | "diastasis";

export const CARDIAC_PHASES: Record<CardiacPhaseKey, { ja: string; short: string; note: string; systole: boolean }> = {
  atrial: { ja: "心房収縮期", short: "心房収縮", systole: false, note: "心房が縮み、残りの血液を心室へ押し込む（心室の充満の最後の2割ほど）。心電図の P 波のすぐあと。" },
  isoContraction: { ja: "等容性収縮期", short: "等容性収縮", systole: true, note: "心室が縮みはじめ、房室弁（僧帽弁・三尖弁）が閉じる（Ⅰ音）。動脈弁はまだ閉じていて、容積は変わらずに圧だけが急に上がる。" },
  rapidEjection: { ja: "急速駆出期", short: "急速駆出", systole: true, note: "心室の圧が動脈の圧を超え、動脈弁（大動脈弁・肺動脈弁）が開いて、血液が勢いよく出る。" },
  reducedEjection: { ja: "緩徐駆出期", short: "緩徐駆出", systole: true, note: "心室の圧が下がりはじめ、出る血液がゆっくりになる。心電図の T 波のころ。" },
  isoRelaxation: { ja: "等容性弛緩期", short: "等容性弛緩", systole: false, note: "動脈弁が閉じ（Ⅱ音）、房室弁も閉じたまま。容積は変わらずに心室の圧が急に下がる。" },
  rapidFilling: { ja: "急速充満期", short: "急速充満", systole: false, note: "心室の圧が心房の圧より下がると房室弁が開き、心房にたまっていた血液が一気に心室へ流れ込む。" },
  diastasis: { ja: "緩徐充満期", short: "緩徐充満", systole: false, note: "静脈から戻る血液が、心房を通ってゆっくり心室へ入る。" },
};

/** 心周期の区切り（左心で決める）。サンプルごとの区分と、区分の初めと終わり（u） */
export interface CardiacTimeline {
  labels: CardiacPhaseKey[];
  spans: { key: CardiacPhaseKey; from: number; to: number }[];
  /** Ⅰ音（僧帽弁が閉じる）とⅡ音（大動脈弁が閉じる）の u */
  s1: number;
  s2: number;
  /** 拡張末期・収縮末期の左心室の容積（mL） */
  edv: number;
  esv: number;
}

export function cardiacTimeline(cycle: CardiacCycle): CardiacTimeline {
  const n = cycle.t.length;
  const open = (key: ValveKey, i: number) => cycle.flow[key][(i + n) % n] > 1;
  const mi = cycle.flow.mi;
  const atrialOn = (i: number) => cycle.activation.la[i] > 0.02;
  const peakE = Math.max(...mi.map((q, i) => (atrialOn(i) ? 0 : q)));
  const lvp = cycle.pressure.lv;
  const labels: CardiacPhaseKey[] = [];
  for (let i = 0; i < n; i++) {
    if (open("ao", i)) labels.push(lvp[(i + 1) % n] >= lvp[i] ? "rapidEjection" : "reducedEjection");
    else if (open("mi", i)) labels.push(atrialOn(i) ? "atrial" : "rapidFilling");
    else {
      // 弁が両方とも閉じている: 最後に開いていたのが僧帽弁なら等容性収縮、大動脈弁なら等容性弛緩
      let k = 1;
      while (k < n && !open("mi", i - k) && !open("ao", i - k)) k++;
      labels.push(open("mi", i - k) ? "isoContraction" : "isoRelaxation");
    }
  }
  // 急速充満期: 房室弁が開いてから、E 波の流れが山の 3 割を下回るまで。そのあと心房収縮までが緩徐充満期
  for (let i = 0; i < n; i++) {
    if (labels[i] !== "rapidFilling") continue;
    const start = labels[(i - 1 + n) % n] !== "rapidFilling" && labels[(i - 1 + n) % n] !== "diastasis";
    if (start) {
      let j = i;
      let peaked = false;
      while (labels[j % n] === "rapidFilling") {
        if (mi[j % n] >= peakE * 0.95) peaked = true;
        if (peaked && mi[j % n] < peakE * 0.3) labels[j % n] = "diastasis";
        j++;
        if (j - i > n) break;
      }
    }
  }
  const spans: CardiacTimeline["spans"] = [];
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const last = spans[spans.length - 1];
    if (last && last.key === labels[i]) last.to = (i + 1) / n;
    else spans.push({ key: labels[i], from: u, to: (i + 1) / n });
  }
  // 初めと終わりが同じ区分なら、終わりの方をそのまま残す（u は 0〜1 の中で描くので）
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    if (open("mi", i) && !open("mi", i + 1)) s1 = (i + 1) / n;
    if (open("ao", i) && !open("ao", i + 1)) s2 = (i + 1) / n;
  }
  const lv = cycle.volume.lv;
  return { labels, spans, s1: s1 % 1, s2: s2 % 1, edv: Math.max(...lv), esv: Math.min(...lv) };
}

export function phaseAt(timeline: CardiacTimeline, u: number): CardiacPhaseKey {
  const n = timeline.labels.length;
  return timeline.labels[Math.floor((((u % 1) + 1) % 1) * n) % n];
}

/** 心電図（模式）。P 波は心房の収縮の少し前、QRS は心室の収縮の始まりの少し前、T 波は駆出の終わりのころ */
export function ecg(u: number): number {
  const wave = (center: number, width: number, height: number) => {
    let d = (((u - center) % 1) + 1.5) % 1 - 0.5;
    d /= width;
    return height * Math.exp(-d * d);
  };
  return wave(0.875, 0.022, 0.16) + wave(0.962, 0.006, -0.12) + wave(0.976, 0.008, 1) + wave(0.99, 0.007, -0.28) + wave(0.25, 0.045, 0.3);
}

/** その時の心臓の状態（変形に使う）: 心室・心房の縮み（0＝ゆるむ〜1）と弁の開き（0〜1） */
export interface HeartState {
  cvL: number;
  cvR: number;
  caL: number;
  caR: number;
  open: Record<ValveKey, number>;
}

export function heartState(cycle: CardiacCycle, u: number): HeartState {
  const squeeze = (key: "lv" | "rv") => {
    const list = cycle.volume[key];
    const max = Math.max(...list);
    const min = Math.min(...list);
    return clamp01((max - cyclic(list, u)) / (max - min));
  };
  const opening = (key: ValveKey) => {
    const peak = Math.max(...cycle.flow[key]);
    return clamp01((cyclic(cycle.flow[key], u) / peak) * 4);
  };
  return {
    cvL: squeeze("lv"), cvR: squeeze("rv"),
    caL: cyclic(cycle.activation.la, u), caR: cyclic(cycle.activation.ra, u),
    open: { mi: opening("mi"), ao: opening("ao"), ti: opening("ti"), po: opening("po") },
  };
}

/** 心臓の部品の動き方: wall＝心筋と心臓の表面のもの、vessel＝出入りする大血管（心底の動きにつれて少し動く）、弁 */
export type HeartPart = "wall" | "vessel" | "av-valve-l" | "av-valve-r" | "sl-valve-l" | "sl-valve-r";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * 心臓の拍動の変位（m）。p は動かす前の点、out に足し込む。
 * - 心室: 心尖を通る長軸へ向かって縮み（半径の 12%）、心底が心尖へ下がる（長さの 14%。房室弁の面が下がる）
 * - 心房: 心室の収縮で房室弁の面が下がると引き伸ばされ、心房の収縮では心房の真ん中へ縮む（10%）
 * - 弁: 開くと尖の先が輪の外へ（壁の方へ）開き、閉じると内へ寄って合わさる
 */
export function heartDisplace(heart: HeartData, state: HeartState, p: Vec3, part: HeartPart, out: Vec3): void {
  const up: Vec3 = [-heart.axis[0], -heart.axis[1], -heart.axis[2]];
  const length = dist(heart.apex, heart.base);
  const rel = sub(p, heart.apex);
  const along = dot(rel, up);
  // 心底の面より下（心室の側）の深さ
  const h = length - along;
  const wv = smoothstep(-0.004, 0.012, h);
  const dl = dist(p, heart.chambers.lv);
  const dr = dist(p, heart.chambers.rv);
  const wL = dr / (dl + dr);
  const cv = wL * state.cvL + (1 - wL) * state.cvR;
  const descent = 0.14 * length * cv;
  let x = 0;
  let y = 0;
  let z = 0;
  if (part === "vessel") {
    // 大血管: 心底から離れるほど動かない
    const above = Math.max(0, -h);
    const w = Math.exp(-above / 0.02) * Math.exp(-Math.max(0, dist(p, heart.base) - 0.05) / 0.02);
    x -= up[0] * descent * w;
    y -= up[1] * descent * w;
    z -= up[2] * descent * w;
  } else {
    const radial: Vec3 = [rel[0] - along * up[0], rel[1] - along * up[1], rel[2] - along * up[2]];
    const squeeze = 0.12 * cv * wv;
    const lift = descent * clamp01(along / length) * wv + descent * (1 - wv) * Math.exp(Math.min(0, h) / 0.025);
    x += -radial[0] * squeeze - up[0] * lift;
    y += -radial[1] * squeeze - up[1] * lift;
    z += -radial[2] * squeeze - up[2] * lift;
    const da = dist(p, heart.chambers.la);
    const dra = dist(p, heart.chambers.ra);
    const wLa = dra / (da + dra);
    const ca = (wLa * state.caL + (1 - wLa) * state.caR) * (1 - wv);
    const center = wLa > 0.5 ? heart.chambers.la : heart.chambers.ra;
    x -= (p[0] - center[0]) * 0.1 * ca;
    y -= (p[1] - center[1]) * 0.1 * ca;
    z -= (p[2] - center[2]) * 0.1 * ca;
    if (part !== "wall") {
      const valve = part === "av-valve-l" ? heart.valves.mitral : part === "av-valve-r" ? heart.valves.tricuspid : part === "sl-valve-l" ? heart.valves.aortic : heart.valves.pulmonary;
      const key: ValveKey = part === "av-valve-l" ? "mi" : part === "av-valve-r" ? "ti" : part === "sl-valve-l" ? "ao" : "po";
      const o = state.open[key];
      const r = sub(p, valve.c);
      const depth = Math.max(0, dot(r, valve.n));
      const flat: Vec3 = [r[0] - dot(r, valve.n) * valve.n[0], r[1] - dot(r, valve.n) * valve.n[1], r[2] - dot(r, valve.n) * valve.n[2]];
      const lr = Math.hypot(...flat) || 1;
      // 尖の先（輪から深い所）ほど大きく動かす。開くと外へ、閉じると内へ（深さは尖の長さほどまで）
      const reach = Math.min(depth, valve.r * 0.9) * Math.min(1, lr / (valve.r * 0.5));
      const swing = reach * (o * 0.45 - (1 - o) * 0.12) * (part.startsWith("sl") ? 1.1 : 1);
      x += (flat[0] / lr) * swing;
      y += (flat[1] / lr) * swing;
      z += (flat[2] / lr) * swing;
    }
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

// ---------------------------------------------------------------- 刺激伝導系

/** 刺激伝導の時刻（u。心室の収縮の始まりが 0） */
export const CONDUCTION = {
  san: 0.855,
  avn: 0.9,
  avnLeave: 0.955,
  his: 0.965,
  bundleEnd: 0.985,
  purkinjeEnd: 1.025,
} as const;

export type ConductionStep = "sa" | "atria" | "av" | "bundle" | "purkinje" | "rest";

export const CONDUCTION_STEPS: Record<ConductionStep, { ja: string; note: string }> = {
  sa: { ja: "洞房結節が興奮", note: "右心房の上大静脈の入口にある洞房結節（ペースメーカー）が自ら興奮する。" },
  atria: { ja: "心房に広がる", note: "興奮が心房の筋に広がり、心房が縮む（心電図の P 波）。" },
  av: { ja: "房室結節でゆっくり", note: "房室結節で伝わりが遅れる（心房が縮み終わるのを待つ。PQ 間隔）。" },
  bundle: { ja: "ヒス束から右脚・左脚へ", note: "心室中隔の中のヒス束（房室束）を通り、右脚と左脚に分かれて心尖へ速く伝わる。" },
  purkinje: { ja: "プルキンエ線維から心室全体へ", note: "プルキンエ線維が心尖から心底へ心室の内側に興奮を配り、心室がまとまって縮む（QRS 波）。" },
  rest: { ja: "心室の収縮と再分極", note: "心室が縮んで血液を送り出し、そのあと興奮がさめる（T 波）。次の興奮まで休む。" },
};

export function conductionStep(u: number): ConductionStep {
  const t = ((u % 1) + 1) % 1;
  const c = CONDUCTION;
  if (t >= c.san && t < c.san + 0.015) return "sa";
  if (t >= c.san + 0.015 && t < c.avn) return "atria";
  if (t >= c.avn && t < c.his) return "av";
  if (t >= c.his && t < c.bundleEnd) return "bundle";
  if (t >= c.bundleEnd || t < c.purkinjeEnd - 1) return "purkinje";
  return "rest";
}

// ---------------------------------------------------------------- 呼吸

/** 呼吸の位相 u（0〜1。0 が呼気の終わり）の、場の2つの形の重み */
export function breathWeights(data: BreathingData, field: "lung" | "chest", u: number): [number, number] {
  const w = data.fields[field].weights;
  return [cyclic(w.map((row) => row[0]), u), cyclic(w.map((row) => row[1]), u)];
}

/** 場の形 mode の、点 (x, y, z) の値（m）を out に（格子の外は 0） */
export function sampleField(data: BreathingData, field: "lung" | "chest", mode: number, x: number, y: number, z: number, out: Vec3): void {
  const { origin, step, shape } = data.grid;
  const values = data.fields[field].modes[mode];
  const gx = (x - origin[0]) / step;
  const gy = (y - origin[1]) / step;
  const gz = (z - origin[2]) / step;
  out[0] = out[1] = out[2] = 0;
  if (gx < 0 || gy < 0 || gz < 0 || gx > shape[0] - 1 || gy > shape[1] - 1 || gz > shape[2] - 1) return;
  const i = Math.min(Math.floor(gx), shape[0] - 2);
  const j = Math.min(Math.floor(gy), shape[1] - 2);
  const k = Math.min(Math.floor(gz), shape[2] - 2);
  const fx = gx - i;
  const fy = gy - j;
  const fz = gz - k;
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      for (let c = 0; c < 2; c++) {
        const w = (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (c ? fz : 1 - fz);
        if (!w) continue;
        const o = (((i + a) * shape[1] + (j + b)) * shape[2] + (k + c)) * 3;
        out[0] += values[o] * w * 1e-5;
        out[1] += values[o + 1] * w * 1e-5;
        out[2] += values[o + 2] * w * 1e-5;
      }
    }
  }
}

/** 呼吸の位相 u で吸っているか（肺の容積が増えているか） */
export function inhaling(data: BreathingData, u: number): boolean {
  return cyclic(data.volume, u + 0.01) > cyclic(data.volume, u - 0.01);
}

// ---------------------------------------------------------------- 道すじ

/** 折れ線の上を、初めからの長さで進む */
export class Polyline {
  readonly points: Float32Array;
  readonly cumulative: Float32Array;
  readonly length: number;

  constructor(points: ArrayLike<number>) {
    this.points = Float32Array.from(points);
    const n = this.points.length / 3;
    this.cumulative = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const dx = this.points[i * 3] - this.points[i * 3 - 3];
      const dy = this.points[i * 3 + 1] - this.points[i * 3 - 2];
      const dz = this.points[i * 3 + 2] - this.points[i * 3 - 1];
      this.cumulative[i] = this.cumulative[i - 1] + Math.hypot(dx, dy, dz);
    }
    this.length = this.cumulative[n - 1] ?? 0;
  }

  static of(points: Vec3[]): Polyline {
    return new Polyline(points.flat());
  }

  /** 長さ s の所の点の番号（その点と次の点の間） */
  indexAt(s: number): number {
    const c = this.cumulative;
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  at(s: number, out: Float32Array, offset = 0): void {
    const t = Math.min(this.length, Math.max(0, s));
    const i = this.indexAt(t);
    const n = this.cumulative.length;
    const j = Math.min(i + 1, n - 1);
    const span = this.cumulative[j] - this.cumulative[i];
    const f = span > 0 ? (t - this.cumulative[i]) / span : 0;
    for (let k = 0; k < 3; k++) out[offset + k] = this.points[i * 3 + k] * (1 - f) + this.points[j * 3 + k] * f;
  }
}

/** 全身の流れの道（circulation.json の点は 0.1mm 単位） */
export function routeLine(route: Route): Polyline {
  return new Polyline(route.points.map((v) => v / 10000));
}

/**
 * 体循環の道ごとの、心拍出量の分かれ方の目安（安静時。% の和は 100）。
 * 脳 約15%・腎臓 約20%・腹部の内臓と肝臓 約25%・筋と皮膚など（腕と脚）約40% を、道の数で分けた
 */
export const ROUTE_SHARE: Record<string, number> = {
  "head-r": 7.5, "head-l": 7.5, kidney: 20, gut: 25, "arm-r": 7, "arm-l": 7, "leg-r": 13, "leg-l": 13,
};
