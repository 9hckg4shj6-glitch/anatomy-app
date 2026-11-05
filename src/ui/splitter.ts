import { h } from "../dom";

/**
 * 3Dと説明の境目のつまみ。左右に並ぶとき（PC・iPad）は説明の幅、縦に並ぶとき（スマホ）は3Dの高さを変える。
 * 「3Dを大きく」で説明を一時的にたたむ。大きさは端末ごとのもの（ほかの端末に記録を写しても持っていかない）なので localStorage に残す。
 */
const KEY = "anatomy-layout";
const MIN_PANEL = 300;
const MIN_STAGE = 260;
const MIN_STAGE_HEIGHT = 200;

interface Saved {
  /** 左右に並ぶときの説明の幅（px） */
  panelWidth?: number;
  /** 縦に並ぶときの3Dの高さ（画面の高さに対する割合） */
  stageHeight?: number;
}

function load(): Saved {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Saved) : {};
  } catch {
    return {};
  }
}

function save(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // 保存できない（プライベートブラウズなど）ときは、その場だけ変える
  }
}

export interface Splitter {
  /** 説明をたたんでいたら戻し、3Dもたたんでいたら戻す（画面を移ったとき） */
  restore(): void;
  /** 縦に並ぶとき（スマホ）だけ、3Dを細い帯にたたむ（false で戻す）。左右に並ぶときは何も変わらない */
  fold(on: boolean): void;
}

export function setupSplitter(layout: HTMLElement, stage: HTMLElement, panel: HTMLElement): Splitter {
  const saved = load();
  const row = () => getComputedStyle(layout).flexDirection === "row";
  const viewportHeight = () => window.visualViewport?.height ?? window.innerHeight;

  const apply = () => {
    if (saved.panelWidth) {
      const width = Math.min(Math.max(saved.panelWidth, MIN_PANEL), layout.clientWidth - MIN_STAGE);
      layout.style.setProperty("--panel-width", `${Math.round(width)}px`);
    } else layout.style.removeProperty("--panel-width");
    if (saved.stageHeight) layout.style.setProperty("--stage-height", `${(saved.stageHeight * 100).toFixed(1)}svh`);
    else layout.style.removeProperty("--stage-height");
  };

  const handle = h("div", {
    class: "splitter", role: "separator", tabindex: "0",
    "aria-label": "3Dと説明の境目（ドラッグで大きさを変える。ダブルクリックで元に戻す）",
  });
  const sync = () => {
    handle.setAttribute("aria-orientation", row() ? "vertical" : "horizontal");
    handle.title = row() ? "ドラッグで説明の幅を変える" : "ドラッグで3Dの高さを変える";
  };

  /** 指（カーソル）の位置から大きさを決める */
  const moveTo = (x: number, y: number) => {
    if (row()) {
      const rect = layout.getBoundingClientRect();
      saved.panelWidth = Math.min(Math.max(rect.right - x, MIN_PANEL), rect.width - MIN_STAGE);
    } else {
      const top = stage.getBoundingClientRect().top;
      const height = Math.min(Math.max(y - top, MIN_STAGE_HEIGHT), viewportHeight() - top - 160);
      saved.stageHeight = height / viewportHeight();
    }
    apply();
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    const move = (e: PointerEvent) => moveTo(e.clientX, e.clientY);
    const end = () => {
      handle.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      save(saved);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end, { once: true });
    handle.addEventListener("pointercancel", end, { once: true });
  });
  handle.addEventListener("dblclick", () => {
    if (row()) delete saved.panelWidth;
    else delete saved.stageHeight;
    apply();
    save(saved);
  });
  // キーボードでは矢印キーで少しずつ
  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 80 : 24;
    const rect = row() ? panel.getBoundingClientRect() : stage.getBoundingClientRect();
    if (row() && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      moveTo(rect.left + (event.key === "ArrowLeft" ? -step : step), 0);
    } else if (!row() && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      moveTo(0, rect.bottom + (event.key === "ArrowUp" ? -step : step));
    } else return;
    event.preventDefault();
    save(saved);
  });

  const expand = h("button", { class: "stage-expand", type: "button" }) as HTMLButtonElement;
  const setExpanded = (on: boolean) => {
    layout.classList.toggle("stage-only", on);
    expand.textContent = on ? "⤡" : "⤢";
    expand.title = on ? "説明を出す" : "3Dを大きく";
    expand.setAttribute("aria-label", expand.title);
    expand.setAttribute("aria-pressed", String(on));
  };
  expand.addEventListener("click", () => setExpanded(!layout.classList.contains("stage-only")));
  setExpanded(false);

  // 一覧や設定など3Dを使わない画面では、説明を3Dに重ねて上の帯だけを見せる（3Dの大きさは変えないので、描き直しも視点のずれも無い）。
  // 帯を押すと3Dを出す
  const unfold = h("button", { class: "stage-unfold", type: "button", onClick: () => setFolded(false) }, "3Dを出す ▾");
  const setFolded = (on: boolean) => layout.classList.toggle("stage-folded", on);

  stage.append(expand, unfold);
  stage.after(handle);
  sync();
  apply();
  // 向きや窓の大きさが変わったら、並び方と幅の上限を合わせ直す
  window.addEventListener("resize", () => {
    sync();
    apply();
  });
  return {
    restore: () => {
      setExpanded(false);
      setFolded(false);
    },
    fold: setFolded,
  };
}
