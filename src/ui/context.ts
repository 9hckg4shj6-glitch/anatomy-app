import { organOfUnit, organTerms, pins, regionSystems, termById, terms, type ModelIndex, type Term } from "../content";
import { beginnerOrgan, inCourse, lessonById } from "../course";
import { landmarkAt, type Vec3 } from "../landmarks";
import type { AnatomyViewer, SceneSpec } from "../viewer";

export interface AppContext {
  viewer: AnatomyViewer;
  index: ModelIndex;
  panel: HTMLElement;
  /** 3Dの上に出す一言（空文字で消す） */
  hint: (text: string) => void;
  /** 3Dの右下に置くボタン類 */
  tools: HTMLElement;
  /** スマホの縦向きで3Dを細い帯にたたむ（false で戻す）。一覧や設定など3Dを使わない画面で。画面を移ると戻る */
  fold: (on: boolean) => void;
  /** 画面を離れると abort される */
  signal: AbortSignal;
  /** ほかの画面へ移る前に確かめる文（null でやめる）。レッスンの途中で、うっかりタブを押して進み具合を失わないように */
  guard: (message: string | null) => void;
  /**
   * 同じ画面の中でアドレスが変わったとき（図鑑で語を選んで「戻る」を押したなど）に呼ぶ関数。true を返せば画面を作り直さない。
   * 画面を移ると消える
   */
  stay: (handler: ((arg: string) => boolean) | null) => void;
}

/** レッスンの途中で画面を離れるときの確認 */
export const LEAVE_LESSON = "レッスンの途中です。ここでやめると、このレッスンは学んだことにならず、復習にも入りません。やめますか？";

/**
 * 3Dでタップした部品のその点にある語。骨・器官の部位（ピン）の上なら、骨・器官ではなく部位。
 * within があれば、その語（臓器の図の語など）を先に選ぶ。初心者モードでは、初心者コースの外の部位は選ばない（骨・器官になる）
 */
export function termAt(ctx: AppContext, elementId: string | null, point: Vec3 | null, within?: Set<string>): Term | null {
  const ids = elementId ? ctx.viewer.termsOf(elementId) : [];
  const termId = (within && ids.find((id) => within.has(id))) ?? ids[0];
  const parts = elementId && point
    ? terms.filter((term) => term.of && (within ? within.has(term.id) : inCourse(term.id)) && pins[term.id] && ctx.index.terms[term.id]?.elements.includes(elementId))
    : [];
  const part = point ? landmarkAt(point, parts, 0.002) : null;
  return part ?? (termId ? termById.get(termId) ?? null : null);
}

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
 * 臓器の場面のレッスン（心臓など。content/organs.json）は、その臓器と大血管だけを見せる（体の中の血管に埋もれないように）。
 * 臓器の図の立体と同じく、臓器の語の系統はみな読み込む（膝関節のレッスンで骨も、縦隔で気管・食道も見えるように）。
 * 初心者コースのレッスンも、語がみな1つの臓器のものなら同じ（beginnerOrgan）。
 */
export function sceneFor(system: string, unitId?: string): SceneSpec {
  const organ = organOfUnit(unitId) ?? beginnerOrgan(unitId);
  if (organ) {
    const others = organTerms(organ).map((id) => termById.get(id)?.system ?? "").filter((id) => id && id !== system);
    return { systems: [system, ...new Set(others)], organ: organ.id };
  }
  if (system === "basics") return { systems: ["skeletal"], body: true };
  if (system === "joints") return { systems: ["joints"], context: ["skeletal"], body: true, contextOpacity: 0.34 };
  if (system === "regional") {
    const unit = unitId ? lessonById.get(unitId) : undefined;
    const regions = (unit?.terms ?? []).flatMap((term) => (term.region ? [term.region] : []));
    const needed = regions.length ? [...new Set(regions.flatMap(regionSystems))] : ["muscular", "nervous", "cardiovascular", "joints", "lymphatic"];
    return { systems: needed, context: ["skeletal"], body: true, contextOpacity: 0.3 };
  }
  return { systems: [system], context: system === "skeletal" ? [] : ["skeletal"], body: true };
}
