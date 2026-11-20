import { h } from "../dom";

/**
 * 設定の画面の部品（docs/普段使い.md「設定の見た目の見直し」）。見出しの下に白いカードを置き、中に行を並べる（iPhone の設定に近い形）。
 * 2択はスイッチ、数や大きさは切り替えの帯（segmented）、コース・目的・問い方はチェックの行。説明はカードの下の小さな注に。
 * スイッチと切り替えの帯は押したその場で見た目を変える（描き直さないので動きが途切れない）
 */
type Child = Node | string | null | undefined | false;

/** 見出しとカード・注をまとめた1つの欄 */
export function group(title: string, options: { id?: string; class?: string } = {}, ...children: Child[]): HTMLElement {
  return h("section", { class: options.class ? `set-group ${options.class}` : "set-group", id: options.id },
    h("h3", { class: "set-title" }, title), ...children);
}

export const card = (...rows: Child[]): HTMLElement => h("div", { class: "set-card" }, ...rows);

/** カードの下の小さな注 */
export const foot = (text: Child, className = ""): HTMLElement => h("p", { class: className ? `set-foot ${className}` : "set-foot" }, text);

function text(title: Child, sub?: Child): HTMLElement {
  return h("span", { class: "set-text" }, h("span", { class: "set-label" }, title), sub ? h("span", { class: "set-sub" }, sub) : "");
}

/** 題（と小さな説明）と、右か下に置く操作。stack のときは操作を下に全幅で */
export function row(title: Child, sub?: Child, control?: Child, stack = false): HTMLElement {
  return h("div", { class: stack ? "set-row stack" : "set-row" }, text(title, sub), control ? h("span", { class: "set-control" }, control) : "");
}

/** 右に値だけを出す行（「最後に書き出した日」など） */
export function valueRow(title: Child, value: Child): HTMLElement {
  return h("div", { class: "set-row" }, text(title), h("span", { class: "set-value" }, value));
}

/** 行ごと押せるスイッチ（role="switch"） */
export function toggleRow(title: string, sub: Child, on: boolean, onChange: (value: boolean) => Promise<void> | void): HTMLElement {
  const button = h("button", {
    class: "set-row set-toggle", type: "button", role: "switch", "aria-checked": String(on),
    onClick: async () => {
      const next = button.getAttribute("aria-checked") !== "true";
      button.setAttribute("aria-checked", String(next));
      await onChange(next);
    },
  }, text(title, sub), h("span", { class: "switch", "aria-hidden": "true" }));
  return button;
}

/** 切り替えの帯（1つを選ぶ）。onPick のあと描き直さなくてよいよう、押した所をその場で選んだ見た目に */
export function segmented<T>(label: string, options: { value: T; label: string }[], current: T, onPick: (value: T) => Promise<void> | void): HTMLElement {
  const box = h("span", { class: "seg", role: "radiogroup", "aria-label": label, style: `--seg-count:${options.length}` });
  const items = options.map((option) => h("button", {
    class: "seg-item", type: "button", role: "radio", "aria-checked": String(option.value === current),
    onClick: async () => {
      items.forEach((item) => item.setAttribute("aria-checked", String(item === items[options.indexOf(option)])));
      box.style.setProperty("--seg-at", String(options.indexOf(option)));
      await onPick(option.value);
    },
  }, option.label));
  box.style.setProperty("--seg-at", String(Math.max(0, options.findIndex((option) => option.value === current))));
  box.append(h("span", { class: "seg-thumb", "aria-hidden": "true" }), ...items);
  return box;
}

/**
 * 選ぶ行（コース・目的・問い方）。multi のときはいくつでも（丸に✓）、そうでなければ1つ（右に✓）。
 * meta は説明の頭に添える小さな数（「374語」など）
 */
export function choiceRow(title: Child, sub: Child, on: boolean, multi: boolean, onClick: () => void, meta = ""): HTMLElement {
  return h("button", {
    class: multi ? "set-row set-choice multi" : "set-row set-choice", type: "button", role: multi ? "checkbox" : "radio", "aria-checked": String(on), onClick,
  }, text(title, meta ? h("span", {}, h("span", { class: "set-meta" }, meta), sub) : sub), h("span", { class: "set-mark", "aria-hidden": "true" }));
}

/** 押すと何かをする行（アクセントの色の字）。href を渡すとリンク、tone で危ない操作（赤） */
export function actionRow(label: string, options: { onClick?: () => void; href?: string; tone?: "danger" | "plain"; disabled?: boolean; chevron?: boolean } = {}): HTMLElement {
  const className = ["set-row", "set-action", options.tone ? `is-${options.tone}` : "", options.chevron ? "has-chevron" : ""].filter(Boolean).join(" ");
  return options.href
    ? h("a", { class: className, href: options.href }, h("span", { class: "set-label" }, label))
    : h("button", { class: className, type: "button", disabled: options.disabled, onClick: options.onClick }, h("span", { class: "set-label" }, label));
}

/** 名前の頭の1字の丸（名前と所属・アカウント） */
export function monogram(name: string): HTMLElement {
  return h("span", { class: "set-avatar", "aria-hidden": "true" }, [...(name.trim() || "?")][0].toUpperCase());
}
