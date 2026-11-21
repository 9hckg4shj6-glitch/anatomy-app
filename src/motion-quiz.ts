import { CARDIAC_PHASES, CONDUCTION_STEPS, type CardiacPhaseKey, type ConductionStep, type CycleSpan } from "./motions";
import type { Station } from "./motion-models/route";

/**
 * 動きの図鑑の「確かめる」（docs/動きの図鑑.md「品質の見直し」）。模型をある時点で止め、その様子を4択で問う。
 * ここは問題を作るだけ（u は止める位置。station は循環で光る粒を置く駅の番号）。答えが出てしまう字幕・札は、問題の間は伏せる
 */

export interface MotionQuestion {
  /** 止める位置（1周の中。0〜1） */
  u?: number;
  /** 循環: 光る粒を置く駅の番号 */
  station?: number;
  prompt: string;
  choices: string[];
  answer: number;
  explain: string;
}

export type Rng = () => number;

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length) % list.length];

/** 正解と、ほかから選んだ3つ（重ならない）を混ぜる */
function fourChoices(rng: Rng, correct: string, others: string[], count = 4): { choices: string[]; answer: number } {
  const pool = [...new Set(others.filter((o) => o !== correct))];
  const wrong: string[] = [];
  while (wrong.length < count - 1 && pool.length) wrong.push(pool.splice(Math.floor(rng() * pool.length) % pool.length, 1)[0]);
  const choices = [...wrong];
  const answer = Math.floor(rng() * (choices.length + 1)) % (choices.length + 1);
  choices.splice(answer, 0, correct);
  return { choices, answer };
}

/** 区分の中ほど（端は区分の境で見分けにくいので避ける）の u */
function inside(rng: Rng, span: CycleSpan): number {
  const u = span.from + (span.to - span.from) * (0.3 + rng() * 0.4);
  return ((u % 1) + 1) % 1;
}

const VALVE_CHOICES = ["房室弁（三尖弁・僧帽弁）だけ開いている", "動脈弁（肺動脈弁・大動脈弁）だけ開いている", "4つとも閉じている", "4つとも開いている"];
const valveAnswer = (key: CardiacPhaseKey): number =>
  key === "rapidEjection" || key === "reducedEjection" ? 1 : key === "isoContraction" || key === "isoRelaxation" ? 2 : 0;

/** 心臓の拍動と心周期: 今の時期・開いている弁 */
export function heartQuestion(rng: Rng, spans: CycleSpan<CardiacPhaseKey>[]): MotionQuestion {
  const span = pick(rng, spans);
  const phase = CARDIAC_PHASES[span.key];
  const u = inside(rng, span);
  if (rng() < 0.5) {
    const { choices, answer } = fourChoices(rng, phase.ja, Object.values(CARDIAC_PHASES).map((p) => p.ja));
    return { u, prompt: "模型を止めました。今は心周期のどの時期？（部屋の縮み・弁の開き・粒の動きを見て）", choices, answer, explain: `${phase.ja}（${phase.systole ? "収縮期" : "拡張期"}）: ${phase.note}` };
  }
  return { u, prompt: "模型を止めました。今、開いている弁は？", choices: [...VALVE_CHOICES], answer: valveAnswer(span.key), explain: `今は${phase.ja}。${phase.note}` };
}

const ECG: Partial<Record<ConductionStep, string>> = { atria: "P 波", av: "PQ 間隔（P 波と QRS 波の間の平らな所）", purkinje: "QRS 波", rest: "T 波と、次の P 波までの休み" };

/** 刺激伝導系: 今の段階・心電図の波 */
export function conductionQuestion(rng: Rng, spans: CycleSpan<ConductionStep>[]): MotionQuestion {
  if (rng() < 0.55) {
    const span = pick(rng, spans);
    const step = CONDUCTION_STEPS[span.key];
    const { choices, answer } = fourChoices(rng, step.ja, Object.values(CONDUCTION_STEPS).map((s) => s.ja));
    return { u: inside(rng, span), prompt: "模型を止めました。黄色く光っている所を見て、今の段階は？", choices, answer, explain: `${step.ja}: ${step.note}` };
  }
  const span = pick(rng, spans.filter((s) => ECG[s.key]));
  const step = CONDUCTION_STEPS[span.key];
  const { choices, answer } = fourChoices(rng, ECG[span.key]!, Object.values(ECG));
  return { u: inside(rng, span), prompt: "模型を止めました。このとき心電図に出ているのは？", choices, answer, explain: `${step.ja}: ${step.note}` };
}

/** 呼吸: 吸気か呼気か・横隔膜・肺胞内圧 */
export function breathQuestion(rng: Rng, spans: CycleSpan<"in" | "out">[]): MotionQuestion {
  const span = pick(rng, spans);
  const inhale = span.key === "in";
  const u = inside(rng, span);
  const kind = Math.floor(rng() * 3);
  if (kind === 0) {
    return {
      u, prompt: "模型を止めました。今は吸気・呼気のどちら？（横隔膜と肋骨の動き、空気の粒の色を見て）", choices: ["吸気（息を吸っている）", "呼気（息を吐いている）"], answer: inhale ? 0 : 1,
      explain: inhale ? "吸気: 横隔膜が縮んで下がり、肋骨が上がって胸郭が広がる。空気の粒は水色で肺へ入る。" : "呼気: 横隔膜と外肋間筋がゆるみ、肺と胸郭が自分の弾性で縮む。空気の粒は灰色で外へ出る。",
    };
  }
  if (kind === 1) {
    return {
      u, prompt: "模型を止めました。今、横隔膜はどうなっている？", choices: ["縮んで下がっている", "ゆるんで上がっている"], answer: inhale ? 0 : 1,
      explain: inhale ? "吸気では横隔膜（主な吸気筋）が縮み、ドームが下がって胸腔が縦に広がる。" : "安静の呼気では横隔膜がゆるみ、腹の臓器に押されてドームが上がる（受け身）。",
    };
  }
  return {
    u, prompt: "模型を止めました。今、肺胞内圧は大気圧と比べてどう？", choices: ["大気圧より低い", "大気圧より高い"], answer: inhale ? 0 : 1,
    explain: inhale ? "吸気では胸腔が広がって肺胞内圧が大気より低くなり、空気が流れ込む。" : "呼気では肺が縮んで肺胞内圧が大気より高くなり、空気が出ていく。",
  };
}

/** 駅の血液（毛細血管は途中で変わるので問わない） */
export function stationBlood(station: Station): "arterial" | "venous" | null {
  const key = station.key;
  if (key === "lungc" || key.endsWith("-c")) return null;
  if (["pv", "la", "lv", "ao"].includes(key) || key.endsWith("-a")) return "arterial";
  return "venous";
}

/** 肺循環と体循環: 光る粒の今いる所・次に向かう所・血液の種類 */
export function circulationQuestion(rng: Rng, stations: Station[]): MotionQuestion {
  const titles = stations.map((s) => s.title);
  const kind = Math.floor(rng() * 3);
  if (kind === 2) {
    const candidates = stations.map((s, i) => [s, i] as const).filter(([s]) => stationBlood(s));
    const [s, i] = pick(rng, candidates);
    const arterial = stationBlood(s) === "arterial";
    return {
      station: i, prompt: `光る粒は今「${s.title}」にいます。ここを流れているのは？`, choices: ["動脈血（酸素が多い）", "静脈血（酸素が少ない）"], answer: arterial ? 0 : 1,
      explain: `${s.title}: ${s.note}${s.key === "pa" || s.key === "pv" ? "" : arterial ? " 肺で酸素を受け取ってから、体の毛細血管に着くまでは動脈血。" : " 体の毛細血管で酸素を渡してから、肺の毛細血管に着くまでは静脈血。"}`,
    };
  }
  const i = Math.floor(rng() * stations.length) % stations.length;
  if (kind === 0) {
    const { choices, answer } = fourChoices(rng, stations[i].title, titles);
    return { station: i, prompt: "光る粒（1滴の血液）が今いるのは？", choices, answer, explain: `${stations[i].title}: ${stations[i].note}` };
  }
  const next = stations[(i + 1) % stations.length];
  const { choices, answer } = fourChoices(rng, next.title, titles.filter((t) => t !== stations[i].title));
  return { station: i, prompt: `光る粒は今「${stations[i].title}」にいます。次に向かうのは？`, choices, answer, explain: `${stations[i].title} → ${next.title}。${next.note}` };
}
