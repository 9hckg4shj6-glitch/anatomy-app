import { regionSystems, unitById, type ModelIndex, type Term } from "../content";
import type { AnatomyViewer, SceneSpec } from "../viewer";

export interface AppContext {
  viewer: AnatomyViewer;
  index: ModelIndex;
  panel: HTMLElement;
  /** 3Dの上に出す一言（空文字で消す） */
  hint: (text: string) => void;
  /** 3Dの右下に置くボタン類 */
  tools: HTMLElement;
  /** 画面を離れると abort される */
  signal: AbortSignal;
  /** ほかの画面へ移る前に確かめる文（null でやめる）。レッスンの途中で、うっかりタブを押して進み具合を失わないように */
  guard: (message: string | null) => void;
}

/** レッスンの途中で画面を離れるときの確認 */
export const LEAVE_LESSON = "レッスンの途中です。ここでやめると、このレッスンは学んだことにならず、復習にも入りません。やめますか？";

/**
 * 筋の「動きを見る」（term-card の motion）。骨を動かし、起始〜停止の距離の文を返す。やめたら筋に寄り直す。
 * before は動かす前の用意（図鑑で骨格を表示に加える、など）。そのときは読み込んでから文を返す。
 */
export function motionPlayer(ctx: AppContext, term: Term, before?: () => Promise<void>): ((on: boolean) => string | Promise<string>) | undefined {
  if (!term.motion) return undefined;
  const play = () => {
    const lengths = ctx.viewer.playAction(term.id);
    ctx.hint("緑＝起始・紫＝停止。帯が縮むと骨が動く");
    if (!lengths) return "筋が縮むと、起始（緑）と停止（紫）が近づいて骨が動く。";
    const cm = (m: number) => (m * 100).toFixed(1);
    return `起始〜停止の距離 ${cm(lengths.from)}cm → ${cm(lengths.to)}cm（${Math.round((1 - lengths.to / lengths.from) * 100)}%縮む）`;
  };
  return (on) => {
    if (!on) {
      ctx.viewer.playAction(null);
      ctx.viewer.focus(term.id, 3.2);
      ctx.hint("");
      return "";
    }
    return before ? before().then(play) : play();
  };
}

/**
 * 系統を見せるときの既定の組み合わせ。骨格以外は骨格を半透明で添えて、体のどこにあるかを分かりやすくする。
 * 基本の用語（方向・面・運動）は骨格の上に図を描く。関節・靱帯は、どの骨をつなぐかが分かるよう骨を少し濃く添える。
 * 局所解剖は、そのレッスン（無ければ系統全体）の語の境界と中を通る語の系統を読み込む（ほかの語は隠して見せる）。
 */
export function sceneFor(system: string, unitId?: string): SceneSpec {
  if (system === "basics") return { systems: ["skeletal"], body: true };
  if (system === "joints") return { systems: ["joints"], context: ["skeletal"], body: true, contextOpacity: 0.34 };
  if (system === "regional") {
    const unit = unitId ? unitById.get(unitId) : undefined;
    const regions = (unit?.terms ?? []).flatMap((term) => (term.region ? [term.region] : []));
    const needed = regions.length ? [...new Set(regions.flatMap(regionSystems))] : ["muscular", "nervous", "cardiovascular", "joints", "lymphatic"];
    return { systems: needed, context: ["skeletal"], body: true, contextOpacity: 0.3 };
  }
  return { systems: [system], context: system === "skeletal" ? [] : ["skeletal"], body: true };
}
