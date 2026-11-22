import { h } from "../dom";
import {
  breathSpans, CARDIAC_PHASES, cardiacSpans, CONDUCTION_STEPS, conductionSpans, spanAt, spanStart,
  type BreathingData, type CardiacCycle, type CardiacTimeline, type ConductionStep, type CycleSpan,
} from "../motions";
import { stepLesson } from "../motion-lessons";
import type { AppContext } from "./context";
import type { Player } from "./motions";

/**
 * 動きの図鑑の3Dの下の字幕（docs/動きの図鑑.md「品質の見直し」）。今の時期の名前と一言、1周の区分の帯と今の位置、
 * 再生・止める、前の時期・次の時期へ。スマホでは欄が3Dの下にあるので、動きを見ながら今の時期が読めるように3Dの上に置く。
 * 区分を押すとその区分の初めへ移って止まる（1つずつ見る）。問題の間は答えが見えないよう伏せる（mask）
 */

export interface CaptionSpan {
  label: string;
  /** 帯の中の幅（割合。足して 1 でなくてよい） */
  width: number;
  /** 色分け（CSS の class。systole など） */
  tone?: string;
  /** 1周の中の実際の割合（0〜1）。1つずつのとき、短い区分を引き延ばすのに使う（period と掛けて秒に） */
  share?: number;
}

export class MotionCaption {
  readonly element: HTMLElement;
  private readonly title = h("b", { class: "motion-caption-title" });
  private readonly note = h("span", { class: "motion-caption-note" });
  private readonly look = h("span", { class: "motion-caption-look" });
  private readonly count = h("span", { class: "motion-caption-count" });
  private readonly stepListeners: ((index: number) => void)[] = [];
  private readonly bar = h("div", { class: "motion-caption-bar", role: "group", "aria-label": "1周の区分" });
  private readonly cursor = h("i", { class: "motion-caption-cursor", "aria-hidden": "true" });
  private spans: CaptionSpan[] = [];
  private buttons: HTMLElement[] = [];
  private offsets: number[] = [];
  private total = 1;
  private current = -1;
  private masked = false;
  /** 1つずつ: 次の区分へ入ったので、区分の中の stopInside まで来たら止める */
  private pendingStop = false;

  /**
   * go(index): その区分へ移って止める。period は1周の長さ（秒。区分の share と掛けて、1つずつのときの引き延ばしに使う）。
   * 1つずつ（player.guided）のときは、再生中に次の区分へ入ったらそこで止め、はじめは1つめの区分の初めで止めておく
   */
  constructor(ctx: AppContext, private readonly player: Player, readonly go: (index: number) => void, spans: CaptionSpan[], private readonly period?: () => number, private readonly stopInside = GUIDE_STOP) {
    player.stepped = true;
    const play = h("button", { class: "motion-caption-play", type: "button", onClick: () => player.set(!player.playing) });
    const show = () => {
      play.textContent = player.playing ? "❚❚" : "▶";
      play.setAttribute("aria-label", player.playing ? "止める" : player.guided ? "この時期を見る" : "再生");
      // 1つずつで止まっているときは ▶ を目立たせる（次はここを押す）
      play.classList.toggle("wait", player.guided && !player.playing);
      this.element?.classList.toggle("guided", player.guided);
    };
    player.onChange(show);
    const step = (sign: number) => {
      if (!this.spans.length) return;
      this.go((Math.max(0, this.current) + sign + this.spans.length) % this.spans.length);
    };
    this.element = h("div", { class: "motion-caption" },
      h("div", { class: "motion-caption-top" },
        play,
        h("div", { class: "motion-caption-text", "aria-live": "polite" }, h("span", { class: "motion-caption-head" }, this.count, this.title), this.note, this.look),
        h("button", { class: "motion-caption-step", type: "button", "aria-label": "前の時期へ", title: "前の時期へ", onClick: () => step(-1) }, "‹"),
        h("button", { class: "motion-caption-step", type: "button", "aria-label": "次の時期へ", title: "次の時期へ", onClick: () => step(1) }, "›"),
      ),
      this.bar,
    );
    this.setSpans(spans);
    show();
    ctx.tools.append(this.element);
    if (player.guided) go(0);
    // 模型は字幕の上の所に入るように映す
    ctx.viewer.setFrameInset(this.element.offsetHeight + 12);
  }

  setSpans(spans: CaptionSpan[]): void {
    this.spans = spans;
    this.total = spans.reduce((sum, span) => sum + span.width, 0) || 1;
    let x = 0;
    this.offsets = spans.map((span) => {
      const at = x;
      x += span.width / this.total;
      return at;
    });
    this.buttons = spans.map((span, i) => {
      const share = span.width / this.total;
      return h("button", {
        class: `motion-caption-span${span.tone ? ` ${span.tone}` : ""}${share < 0.12 ? " slim" : ""}`, type: "button", style: `flex-grow:${share}`,
        title: span.label, "aria-label": span.label, onClick: () => this.go(i),
      }, share < 0.06 ? "" : span.label);
    });
    this.bar.replaceChildren(...this.buttons, this.cursor);
    // 道順を変えたとき（循環の1周ごと）も、次の update で区分が変わったとして扱う（1つずつなら止める）
    this.current = this.current === -1 ? -1 : -2;
  }

  /** 区分が変わったときに呼ぶ（欄の学ぶ流れ・光らせる札） */
  onStep(listener: (index: number) => void): void {
    this.stepListeners.push(listener);
  }

  /** 今の区分（index）とその中の位置（0〜1）・名前・一言・ここを見る */
  update(index: number, frac: number, title: string, note: string, look = ""): void {
    const share = (this.spans[index]?.width ?? 0) / this.total;
    this.cursor.style.left = `${((this.offsets[index] ?? 0) + share * Math.min(1, Math.max(0, frac))) * 100}%`;
    const span = this.spans[index];
    this.player.spanSeconds = span?.share !== undefined && this.period ? span.share * this.period() : null;
    if (index !== this.current) {
      // 1つずつ: 再生中に次の区分へ入ったら、その初めの少しあと（境目では弁などが切り替わる途中なので）で止める。説明を読んでから ▶
      if (this.current !== -1 && this.player.guided && this.player.playing) this.pendingStop = true;
      this.buttons[this.current]?.classList.remove("on");
      this.buttons[index]?.classList.add("on");
      this.current = index;
      this.count.textContent = `${index + 1}/${this.spans.length}`;
      for (const listener of this.stepListeners) listener(index);
    }
    if (this.pendingStop && (frac >= this.stopInside || !this.player.playing || !this.player.guided)) {
      this.pendingStop = false;
      if (this.player.playing && this.player.guided) this.player.set(false);
    }
    if (this.masked) return;
    if (this.title.textContent !== title) this.title.textContent = title;
    if (this.note.textContent !== note) this.note.textContent = note;
    const lookText = look ? `ここを見る: ${look}` : "";
    if (this.look.textContent !== lookText) this.look.textContent = lookText;
  }

  /** 問題の間は、名前と一言・区分の帯を伏せる */
  mask(on: boolean): void {
    this.masked = on;
    this.element.classList.toggle("masked", on);
    this.look.textContent = "";
    if (on) {
      this.title.textContent = "？";
      this.note.textContent = "問題に答えてください（下の欄）";
    } else {
      this.title.textContent = "";
      this.note.textContent = "";
    }
  }

  /** 前の時期・次の時期の番号（確かめ用） */
  get index(): number {
    return this.current;
  }
}

/** 1つずつで止める所（区分の中の割合）。区分へ移る（帯・‹ ›）ときも同じ所へ */
export const GUIDE_STOP = 0.12;

const STEP_LABELS: Record<ConductionStep, string> = { sa: "洞房結節", atria: "心房", av: "房室結節", bundle: "ヒス束・脚", purkinje: "プルキンエ", rest: "収縮・休み" };

/** 心臓の拍動（心周期の7つの時期）と刺激伝導系（6つの段階。帯の幅はそろえる）の字幕 */
export function heartCaption(ctx: AppContext, player: Player, cycle: CardiacCycle, timeline: CardiacTimeline, conduction: boolean) {
  const phaseSpans = cardiacSpans(timeline);
  const stepSpans = conductionSpans();
  const spans: CycleSpan[] = conduction ? stepSpans : phaseSpans;
  const caption = new MotionCaption(ctx, player, (i) => player.seek(spanStart(spans, i, player.guided ? GUIDE_STOP : undefined), cycle.period), conduction
    ? stepSpans.map((span) => ({ label: STEP_LABELS[span.key], width: 1, share: span.to - span.from }))
    : phaseSpans.map((span) => ({ label: CARDIAC_PHASES[span.key].short, width: span.to - span.from, share: span.to - span.from, tone: CARDIAC_PHASES[span.key].systole ? "systole" : "diastole" })),
  () => cycle.period);
  const update = (u: number) => {
    const at = spanAt(spans, u);
    if (conduction) {
      const key = stepSpans[at.index].key;
      const step = CONDUCTION_STEPS[key];
      caption.update(at.index, at.frac, step.ja, step.note, stepLesson("conduction", key)?.look);
    } else {
      const key = phaseSpans[at.index].key;
      const phase = CARDIAC_PHASES[key];
      caption.update(at.index, at.frac, `${phase.ja}（${phase.systole ? "収縮期" : "拡張期"}）`, phase.note, stepLesson("heartbeat", key)?.look);
    }
  };
  return { caption, update, phaseSpans, stepSpans };
}

/** 呼吸（吸気と呼気）の字幕 */
export function breathCaption(ctx: AppContext, player: Player, data: BreathingData, period: () => number) {
  const spans = breathSpans(data);
  const caption = new MotionCaption(ctx, player, (i) => player.seek(spanStart(spans, i, player.guided ? GUIDE_STOP : undefined), period()), spans.map((span) => ({
    label: span.key === "in" ? "吸気" : "呼気", width: span.to - span.from, share: span.to - span.from, tone: span.key === "in" ? "inhale" : undefined,
  })), period);
  const update = (u: number, deep: boolean) => {
    const at = spanAt(spans, u);
    const inhale = spans[at.index].key === "in";
    caption.update(at.index, at.frac, inhale ? "吸気（息を吸う）" : "呼気（息を吐く）", inhale
      ? deep ? "横隔膜が強く縮み、首の筋（胸鎖乳突筋・斜角筋）も胸郭を引き上げる → 肺が大きくふくらむ。" : "横隔膜が縮んで下がり、肋骨が上がって胸郭が広がる → 肺がふくらみ、空気が入る。"
      : deep ? "内肋間筋が肋骨を引き下げ、腹筋が横隔膜を押し上げて強く吐く。" : "横隔膜と外肋間筋がゆるみ、肺と胸郭が自分の弾性で縮む → 空気が出る（受け身）。",
    stepLesson("breathing", spans[at.index].key)?.look);
  };
  return { caption, update, spans };
}
