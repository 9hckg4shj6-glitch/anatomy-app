import type { ModelIndex } from "../content";
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
}

/** 系統を見せるときの既定の組み合わせ。骨格以外は骨格を半透明で添えて、体のどこにあるかを分かりやすくする。 */
export function sceneFor(system: string): SceneSpec {
  return { systems: [system], context: system === "skeletal" ? [] : ["skeletal"], body: true };
}
