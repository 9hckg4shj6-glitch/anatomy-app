import type { SystemInfo } from "../content";
import { db, nowIso } from "../db";
import { h } from "../dom";

/** db.settings のキー。自分で系統を一度でも切り替えたら true（それまで「ほかの系統もある」の吹き出しを出す） */
export const SYSTEM_PICKED_KEY = "systemPicked";

const reducedMotion = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** 一覧（シート）で系統の名前の下に出す、何が入っているかの目安（はじめての人が「内臓はどこ？」と迷わないように） */
const CONTENTS: Record<string, string> = {
  skeletal: "骨・軟骨",
  joints: "関節・靱帯",
  muscular: "全身の筋",
  cardiovascular: "心臓・動脈・静脈",
  lymphatic: "リンパ節・脾臓",
  respiratory: "鼻・喉頭・気管・肺",
  digestive: "口・胃・腸・肝臓",
  urogenital: "腎臓・膀胱・生殖器",
  endocrine: "甲状腺・副腎など",
  nervous: "脳・脊髄・神経",
  sensory: "眼・耳",
};

/** 3Dの下のボタンの短い名前（「骨格系」→「骨格」。泌尿器・生殖器系は「泌尿・生殖」） */
export function shortSystemName(name: string): string {
  return name === "泌尿器・生殖器系" ? "泌尿・生殖" : name.replace(/系$/, "");
}

export interface SystemPicker {
  /** ctx.tools に入れる（左端に「系統を選ぶ」、右に系統のボタンの列） */
  element: HTMLElement;
  /** 選んでいる系統の印を付け替える（3Dを出し直すのは呼ぶ側） */
  mark(systemId: string): void;
}

/**
 * 3Dの下の系統のボタン（ホームと3D模型の「見る」）。スマホ・iPad では列が1行で横にすべるので、はじめての人には
 * 骨格のほかに系統があることが分かりにくかった（docs/普段使い.md「系統のボタンの見つけにくさ」）。そこで
 * - 左端に動かない「系統を選ぶ」（押すと全部の系統を一覧で。PC は列が全部見えるので出さない）
 * - まだ自分で切り替えたことのない人には、列の上に「ほかに N の系統」の吹き出しを出し、列を一度すべらせて見せる
 * extra は列の終わりに足すボタン（3D模型の「全体」など）
 */
export function systemPicker(list: SystemInfo[], current: string, onChoose: (systemId: string) => void, signal: AbortSignal, extra: HTMLElement[] = []): SystemPicker {
  let shown = current;
  const pick = (systemId: string) => {
    nudge?.remove();
    void db.settings.put({ key: SYSTEM_PICKED_KEY, value: true, updatedAt: nowIso() });
    onChoose(systemId);
  };
  const chips = list.map((system) => h("button", {
    class: "chip", type: "button", style: `--swatch:${system.color}`, "aria-pressed": "false",
    onClick: () => pick(system.id),
  }, h("span", { class: "swatch" }), shortSystemName(system.ja)));
  const row = h("div", { class: "system-row", role: "group", "aria-label": "3Dで見る系統" }, ...chips, ...extra);
  const all = h("button", {
    class: "chip system-all", type: "button", "aria-haspopup": "dialog",
    onClick: () => openSheet(list, shown, pick, signal),
  }, h("span", { class: "system-all-icon", "aria-hidden": "true" }), "系統を選ぶ", h("span", { class: "system-all-count" }, String(list.length)));
  const element = h("div", { class: "system-picker" }, all, row);
  let nudge: HTMLElement | null = null;

  const mark = (systemId: string) => {
    shown = systemId;
    for (const [i, system] of list.entries()) {
      chips[i].classList.toggle("on", system.id === systemId);
      chips[i].setAttribute("aria-pressed", String(system.id === systemId));
    }
    // 選んだボタンが列の外に隠れていたら見える所へ（一覧から選んだときなど）
    const on = chips[list.findIndex((system) => system.id === systemId)];
    if (on && row.scrollWidth > row.clientWidth) {
      const left = on.offsetLeft - row.offsetLeft;
      if (left < row.scrollLeft || left + on.offsetWidth > row.scrollLeft + row.clientWidth) {
        row.scrollTo({ left: Math.max(0, left - 16), behavior: reducedMotion() ? "auto" : "smooth" });
      }
    }
  };
  mark(current);

  // まだ自分で系統を切り替えたことのない人に、ほかの系統があることを知らせる
  void db.settings.get(SYSTEM_PICKED_KEY).then((saved) => {
    if (saved?.value || signal.aborted || list.length < 2) return;
    const others = list.filter((system) => system.id !== shown);
    const examples = others.slice(0, 4).map((system) => shortSystemName(system.ja)).join("・");
    nudge = h("div", { class: "system-nudge", role: "note" },
      h("span", {}, h("b", {}, `ほかに ${others.length} の系統`), `（${examples}…）があります。下のボタンで切り替え`),
      h("button", { class: "system-nudge-close", type: "button", "aria-label": "閉じる", onClick: () => {
        nudge?.remove();
        void db.settings.put({ key: SYSTEM_PICKED_KEY, value: true, updatedAt: nowIso() });
      } }, "×"));
    element.append(nudge);
    // 列が横にすべることを、一度すべらせて見せる（動きを減らす設定なら動かさない）
    if (reducedMotion()) return;
    window.setTimeout(() => {
      if (signal.aborted || row.scrollWidth <= row.clientWidth || row.scrollLeft > 0) return;
      row.scrollTo({ left: Math.min(row.scrollWidth - row.clientWidth, 220), behavior: "smooth" });
      window.setTimeout(() => { if (!signal.aborted) row.scrollTo({ left: 0, behavior: "smooth" }); }, 1100);
    }, 900);
  });

  return { element, mark };
}

/** 全部の系統の一覧（下から出るシート）。選ぶか、閉じるか、画面を離れると消える */
function openSheet(list: SystemInfo[], current: string, pick: (systemId: string) => void, signal: AbortSignal): void {
  const dialog = h("dialog", { class: "sheet", "aria-label": "3Dで見る系統を選ぶ" });
  const close = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  signal.addEventListener("abort", close, { once: true });
  dialog.append(
    h("div", { class: "sheet-head" },
      h("span", { class: "sheet-grip", "aria-hidden": "true" }),
      h("div", { class: "sheet-title-row" },
        h("h2", { class: "sheet-title" }, "3Dで見る系統"),
        h("button", { class: "sheet-close", type: "button", onClick: close }, "閉じる"))),
    h("p", { class: "sheet-note" }, "選ぶと、その系統が3Dに出ます。"),
    h("div", { class: "system-grid" }, ...list.map((system) => h("button", {
      class: system.id === current ? "system-option on" : "system-option", type: "button", style: `--swatch:${system.color}`,
      "aria-pressed": String(system.id === current),
      onClick: () => {
        close();
        pick(system.id);
      },
    },
      h("span", { class: "system-option-swatch", "aria-hidden": "true" }),
      h("span", { class: "system-option-text" },
        h("span", { class: "system-option-name" }, system.ja),
        CONTENTS[system.id] ? h("small", {}, CONTENTS[system.id]) : ""),
      system.id === current ? h("span", { class: "sheet-check", "aria-hidden": "true" }, "✓") : "",
    ))),
  );
  document.body.append(dialog);
  dialog.showModal();
}
