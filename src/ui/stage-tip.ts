import { db, nowIso } from "../db";
import { h } from "../dom";
import { preferences } from "../settings";

/** db.settings のキー。見た回数（「わかった」で閉じたら -1） */
export const STAGE_TIP_KEY = "stageTip";
/** この回数だけ見たら出さない */
export const STAGE_TIP_TIMES = 3;

/** 今の回数から、出すかどうかと次の回数（出さないときは null） */
export function nextTipCount(saved: unknown): number | null {
  const seen = typeof saved === "number" ? saved : 0;
  return seen < 0 || seen >= STAGE_TIP_TIMES ? null : seen + 1;
}

/**
 * 3Dの右上の ⤢・?・向きの目印の説明（docs/普段使い.md「画面の分かりにくさの見直し」）。3Dを動かして見る画面（レッスン・図鑑・臓器の図）を
 * はじめのうちに開いたとき、向きの目印の左に吹き出しで出す。とくに「右」が画面の左にあるわけ（向かい合って見ている）。
 * 「わかった」で閉じればもう出さない。閉じなくても STAGE_TIP_TIMES 回で出さなくなる。画面を移ると消す
 */
export async function stageTip(stage: HTMLElement, signal: AbortSignal): Promise<void> {
  const count = nextTipCount((await db.settings.get(STAGE_TIP_KEY))?.value);
  if (count === null || signal.aborted) return;
  void db.settings.put({ key: STAGE_TIP_KEY, value: count, updatedAt: nowIso() });
  const close = h("button", {
    class: "stage-tip-close", type: "button",
    onClick: () => {
      tip.remove();
      void db.settings.put({ key: STAGE_TIP_KEY, value: -1, updatedAt: nowIso() });
    },
  }, "わかった");
  // 小さい iPhone でも3Dの下の系統のボタンにかからないよう、短く
  const tip = h("aside", { class: "stage-tip", "aria-label": "3Dの右上の印" },
    h("div", { class: "stage-tip-head" }, h("p", { class: "stage-tip-title" }, "右上の印"), close),
    h("dl", {},
      h("div", {}, h("dt", {}, "⤢"), h("dd", {}, "3Dを大きく")),
      h("div", {}, h("dt", {}, "?"), h("dd", {}, "3Dの動かし方")),
      // 向きの目印を設定で消している人には、目印の説明は出さない
      preferences.compass ? h("div", {}, h("dt", { class: "stage-tip-right" }, "右"), h("dd", {}, "本人の右（向かい合うので画面では左）")) : ""),
  );
  if (!preferences.compass) tip.classList.add("no-compass");
  stage.append(tip);
  signal.addEventListener("abort", () => tip.remove(), { once: true });
}
