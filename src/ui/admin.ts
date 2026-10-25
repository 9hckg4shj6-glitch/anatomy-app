import { pins, termById, units, type Pin, type Term } from "../content";
import { h } from "../dom";
import type { Vec3 } from "../landmarks";
import type { AppContext } from "./context";

const round = (value: number) => Math.round(value * 10000) / 10000;

/** content/pins.json の書き方（1部位1行。差分を読みやすくする）。vite.config.ts の保存と同じ形 */
export function formatPins(data: Record<string, Pin>): string {
  const lines = Object.keys(data).sort().map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(data[id])}`);
  return `{\n${lines.join(",\n")}\n}\n`;
}

/**
 * ピン打ちツール（?admin=1 のときだけタブが出る）。骨の部位を選び、骨の表面をクリックして位置を決める。
 * 左側の骨をクリックしても右側に折り返して記録する（表示は左右とも出る）。
 * 開発サーバーでは「保存」で content/pins.json を書きかえる。それ以外ではファイルとして保存する。
 */
export async function admin(ctx: AppContext, initial: string): Promise<void> {
  const { viewer, panel, tools } = ctx;
  const landmarks = units.flatMap((unit) => unit.terms.filter((term) => term.of).map((term) => ({ unit, term })));
  if (!landmarks.length) {
    panel.replaceChildren(h("p", {}, "骨の部位（of がある語）がまだありません。"));
    return;
  }
  let current: Term = termById.get(initial)?.of ? termById.get(initial)! : landmarks[0].term;
  let adding = false;
  let radius = pins[current.id]?.r ?? 0.008;
  let unsaved = 0;
  const status = h("p", { class: "muted" });
  const json = h("textarea", { class: "admin-json", readOnly: true, "aria-label": "この部位のピン" });

  await viewer.show({ systems: ["skeletal"], body: false });

  const paint = () => {
    viewer.highlight([current.id], { isolate: true });
    viewer.setLabel(pins[current.id] ? current.id : null, current.ja);
    json.value = pins[current.id] ? JSON.stringify(pins[current.id]) : "（まだピンがありません）";
    status.textContent = `${landmarks.filter(({ term }) => pins[term.id]).length} / ${landmarks.length} 部位にピンあり${unsaved ? `・未保存 ${unsaved}件` : ""}`;
  };

  const choose = (term: Term) => {
    current = term;
    radius = pins[term.id]?.r ?? radius;
    history.replaceState(null, "", `#/admin/${term.id}`);
    render();
    paint();
    if (pins[term.id]) viewer.focus(term.id, 4);
    else viewer.focusWhole(term.id, 1.4, true, [-0.35, 0.15, 1]);
  };

  const save = async () => {
    const text = formatPins(pins);
    if (import.meta.env.DEV) {
      const response = await fetch("/__admin/pins", { method: "POST", headers: { "content-type": "application/json" }, body: text });
      if (response.ok) {
        unsaved = 0;
        paint();
        return; // 保存すると開発サーバーが読み込み直す（#/admin/<語ID> で同じ部位に戻る）
      }
      status.textContent = `保存できませんでした: ${await response.text()}`;
      return;
    }
    const link = h("a", { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: "pins.json" });
    link.click();
    URL.revokeObjectURL(link.href);
    unsaved = 0;
    paint();
  };

  const index = () => landmarks.findIndex(({ term }) => term.id === current.id);
  const select = h("select", { class: "admin-select", "aria-label": "部位", onChange: (event: Event) => choose(termById.get((event.target as HTMLSelectElement).value)!) });
  const radiusInput = h("input", {
    type: "range", min: "2", max: "40", step: "1",
    onInput: (event: Event) => {
      radius = Number((event.target as HTMLInputElement).value) / 1000;
      if (pins[current.id]) {
        pins[current.id] = { ...pins[current.id], r: radius };
        unsaved++;
      }
      radiusLabel.textContent = `${Math.round(radius * 1000)} mm`;
      paint();
    },
  });
  const radiusLabel = h("span", {});

  const render = () => {
    select.replaceChildren(...units.filter((unit) => unit.terms.some((term) => term.of)).map((unit) =>
      h("optgroup", { label: unit.title }, ...unit.terms.filter((term) => term.of).map((term) =>
        h("option", { value: term.id, selected: term.id === current.id }, `${pins[term.id] ? "✓" : "・"} ${term.ja}（${termById.get(term.of!)?.ja}）`)))));
    radiusInput.value = String(Math.round(radius * 1000));
    radiusLabel.textContent = `${Math.round(radius * 1000)} mm`;
  };

  viewer.onPick = (element, point, normal) => {
    if (!element || !point || !ctx.index.terms[current.id]?.elements.includes(element)) return;
    // ピンは本人の右側（x < 0）に打つ。左側をクリックしたら折り返す
    const side = point[0] > 0 ? -1 : 1;
    const at: Vec3 = [round(point[0] * side), round(point[1]), round(point[2])];
    const n = normal ? ([round(normal[0] * side), round(normal[1]), round(normal[2])] as Vec3) : undefined;
    const before = pins[current.id];
    // 点を足すときは、最初の点の向き（n・v）を保つ
    pins[current.id] = adding && before
      ? { ...before, at: [...before.at, at], r: radius }
      : { at: [at], r: radius, ...(n ? { n } : {}) };
    unsaved++;
    render();
    paint();
  };

  ctx.hint("骨をクリックしてピンを打つ");
  tools.replaceChildren(
    h("button", { class: "chip", type: "button", onClick: () => viewer.focus(current.id, 4) }, "ピンへ寄る"),
    h("button", { class: "chip", type: "button", onClick: () => viewer.focusWhole(current.id, 1.4) }, "骨全体"),
  );
  panel.replaceChildren(
    h("h2", {}, "ピン打ち"),
    h("p", { class: "muted" }, "骨の部位を選び、骨の表面をクリックすると位置が決まります。稜・線・縫合などは「点を足す」で数点打ちます。左側をクリックしても右側に記録します。"),
    select,
    h("div", { class: "admin-row" },
      h("button", { class: "ghost-button", type: "button", onClick: () => choose(landmarks[Math.max(0, index() - 1)].term) }, "前へ"),
      h("button", { class: "ghost-button", type: "button", onClick: () => choose(landmarks[Math.min(landmarks.length - 1, index() + 1)].term) }, "次へ"),
      h("button", { class: "ghost-button", type: "button", onClick: () => choose(landmarks.find(({ term }) => !pins[term.id])?.term ?? current) }, "未設定へ"),
    ),
    h("div", { class: "admin-row" },
      h("label", {}, h("input", { type: "checkbox", onChange: (event: Event) => { adding = (event.target as HTMLInputElement).checked; } }), "点を足す（稜・線）"),
      h("button", {
        class: "ghost-button", type: "button",
        onClick: () => {
          const pin = pins[current.id];
          if (!pin) return;
          if (pin.at.length > 1) pins[current.id] = { ...pin, at: pin.at.slice(0, -1) };
          else delete pins[current.id];
          unsaved++;
          render();
          paint();
        },
      }, "1点戻す"),
    ),
    h("div", { class: "admin-row" }, h("label", {}, "範囲の半径", radiusInput), radiusLabel),
    json,
    h("div", { class: "nav-row" }, h("button", { class: "primary", type: "button", onClick: () => void save() }, import.meta.env.DEV ? "保存（content/pins.json）" : "pins.json を保存")),
    status,
  );
  render();
  choose(current);
}
