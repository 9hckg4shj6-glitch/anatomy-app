import { h } from "../dom";
import {
  breathSpans, CARDIAC_PHASES, cardiacSpans, CONDUCTION_STEPS, conductionSpans, spanAt, spanStart,
  type BreathingData, type CardiacCycle, type CardiacTimeline, type ConductionStep, type CycleSpan,
} from "../motions";
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
}

export class MotionCaption {
  readonly element: HTMLElement;
  private readonly title = h("b", { class: "motion-caption-title" });
  private readonly note = h("span", { class: "motion-caption-note" });
  private readonly bar = h("div", { class: "motion-caption-bar", role: "group", "aria-label": "1周の区分" });
  private readonly cursor = h("i", { class: "motion-caption-cursor", "aria-hidden": "true" });
  private spans: CaptionSpan[] = [];
  private buttons: HTMLElement[] = [];
  private offsets: number[] = [];
  private total = 1;
  private current = -1;
  private masked = false;

  /** go(index): その区分へ移って止める */
  constructor(ctx: AppContext, player: Player, private readonly go: (index: number) => void, spans: CaptionSpan[]) {
    const play = h("button", { class: "motion-caption-play", type: "button", onClick: () => player.set(!player.playing) });
    const show = () => {
      play.textContent = player.playing ? "❚❚" : "▶";
      play.setAttribute("aria-label", player.playing ? "止める" : "再生");
    };
    player.onChange(show);
    show();
    const step = (sign: number) => {
      if (!this.spans.length) return;
      this.go((Math.max(0, this.current) + sign + this.spans.length) % this.spans.length);
    };
    this.element = h("div", { class: "motion-caption" },
      h("div", { class: "motion-caption-top" },
        play,
        h("div", { class: "motion-caption-text", "aria-live": "polite" }, this.title, this.note),
        h("button", { class: "motion-caption-step", type: "button", "aria-label": "前の時期へ", title: "前の時期へ", onClick: () => step(-1) }, "‹"),
        h("button", { class: "motion-caption-step", type: "button", "aria-label": "次の時期へ", title: "次の時期へ", onClick: () => step(1) }, "›"),
      ),
      this.bar,
    );
    this.setSpans(spans);
    ctx.tools.append(this.element);
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
    this.current = -1;
  }

  /** 今の区分（index）とその中の位置（0〜1）・名前・一言 */
  update(index: number, frac: number, title: string, note: string): void {
    const share = (this.spans[index]?.width ?? 0) / this.total;
    this.cursor.style.left = `${((this.offsets[index] ?? 0) + share * Math.min(1, Math.max(0, frac))) * 100}%`;
    if (index !== this.current) {
      this.buttons[this.current]?.classList.remove("on");
      this.buttons[index]?.classList.add("on");
      this.current = index;
    }
    if (this.masked) return;
    if (this.title.textContent !== title) this.title.textContent = title;
    if (this.note.textContent !== note) this.note.textContent = note;
  }

  /** 問題の間は、名前と一言・区分の帯を伏せる */
  mask(on: boolean): void {
    this.masked = on;
    this.element.classList.toggle("masked", on);
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

const STEP_LABELS: Record<ConductionStep, string> = { sa: "洞房結節", atria: "心房", av: "房室結節", bundle: "ヒス束・脚", purkinje: "プルキンエ", rest: "収縮・休み" };

/** 心臓の拍動（心周期の7つの時期）と刺激伝導系（6つの段階。帯の幅はそろえる）の字幕 */
export function heartCaption(ctx: AppContext, player: Player, cycle: CardiacCycle, timeline: CardiacTimeline, conduction: boolean) {
  const phaseSpans = cardiacSpans(timeline);
  const stepSpans = conductionSpans();
  const spans: CycleSpan[] = conduction ? stepSpans : phaseSpans;
  const caption = new MotionCaption(ctx, player, (i) => player.seek(spanStart(spans, i), cycle.period), conduction
    ? stepSpans.map((span) => ({ label: STEP_LABELS[span.key], width: 1 }))
    : phaseSpans.map((span) => ({ label: CARDIAC_PHASES[span.key].short, width: span.to - span.from, tone: CARDIAC_PHASES[span.key].systole ? "systole" : "diastole" })));
  const update = (u: number) => {
    const at = spanAt(spans, u);
    if (conduction) {
      const step = CONDUCTION_STEPS[stepSpans[at.index].key];
      caption.update(at.index, at.frac, step.ja, step.note);
    } else {
      const phase = CARDIAC_PHASES[phaseSpans[at.index].key];
      caption.update(at.index, at.frac, `${phase.ja}（${phase.systole ? "収縮期" : "拡張期"}）`, phase.note);
    }
  };
  return { caption, update, phaseSpans, stepSpans };
}

/** 呼吸（吸気と呼気）の字幕 */
export function breathCaption(ctx: AppContext, player: Player, data: BreathingData, period: () => number) {
  const spans = breathSpans(data);
  const caption = new MotionCaption(ctx, player, (i) => player.seek(spanStart(spans, i), period()), spans.map((span) => ({
    label: span.key === "in" ? "吸気" : "呼気", width: span.to - span.from, tone: span.key === "in" ? "inhale" : undefined,
  })));
  const update = (u: number, deep: boolean) => {
    const at = spanAt(spans, u);
    const inhale = spans[at.index].key === "in";
    caption.update(at.index, at.frac, inhale ? "吸気（息を吸う）" : "呼気（息を吐く）", inhale
      ? deep ? "横隔膜が強く縮み、首の筋（胸鎖乳突筋・斜角筋）も胸郭を引き上げる → 肺が大きくふくらむ。" : "横隔膜が縮んで下がり、肋骨が上がって胸郭が広がる → 肺がふくらみ、空気が入る。"
      : deep ? "内肋間筋が肋骨を引き下げ、腹筋が横隔膜を押し上げて強く吐く。" : "横隔膜と外肋間筋がゆるみ、肺と胸郭が自分の弾性で縮む → 空気が出る（受け身）。");
  };
  return { caption, update, spans };
}
