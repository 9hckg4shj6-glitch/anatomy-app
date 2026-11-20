import { systemById, systems, termById } from "../content";
import { h } from "../dom";
import type { Vec3 } from "../landmarks";
import {
  History, PRESETS, SKIN, cloneState, initialState, isChanged, partAt, partName, presetOf, toSpec, toggleSystem,
  withOffset, withPart, withPreset, withoutOffset, withoutPart, type ModelState, type Part,
} from "../model-state";
import type { Section } from "../viewer";
import type { AppContext } from "./context";
import { card, foot, group, row, segmented, toggleRow } from "./settings-kit";
import { tabIntro } from "./tab-intro";

/**
 * 3D模型（#/model。下のタブ）: 人体模型のように、自由に回し・取り外し・透かし・分解し・切って見る。docs/普段使い.md「3D模型」。
 * 部品をタップで選び（まとまりを大きく・細かく）、隠す・薄くする・これだけ・外へ出す。3Dはふだん回すだけで、
 * 選んだ部品の「動かす」を押したときだけ、その部品をドラッグで動かせる（「動かし終える」まで。うっかり動かさないように）。
 * 系統ごとに濃さを変え、分解・断面・片側・見る向きを選ぶ。どの操作も「元に戻す」で1つずつ戻せる。
 * 模型の状態はアプリを開いている間は残る（ほかのタブへ行って戻っても、取り外したまま）
 */

/** 3D模型を離れても残す状態・元に戻す履歴・視点（アプリを開いている間） */
let kept: { state: ModelState; history: History; view: [Vec3, Vec3] | null } | null = null;

/** 3Dを読み込む系統（局所解剖など3Dの部品を持たない系統は除く）と皮膚 */
function modelSystems(ctx: AppContext): { id: string; ja: string; color: string }[] {
  return [
    ...systems.filter((system) => ctx.index.systems[system.id]),
    ...(ctx.index.systems[SKIN] ? [{ id: SKIN, ja: "皮膚", color: "#e8c9a8" }] : []),
  ];
}

const SECTION_AXES: { axis: Section["axis"]; label: string; keep: Section["keep"] }[] = [
  { axis: "y", label: "水平断", keep: 1 },
  { axis: "x", label: "矢状断", keep: -1 },
  { axis: "z", label: "前頭断", keep: -1 },
];

/** 見る向き（カメラを置く向き。本人の右は -x） */
const VIEWS: [label: string, from: Vec3][] = [
  ["前", [0, 0, 1]], ["後ろ", [0, 0, -1]], ["右", [-1, 0, 0]], ["左", [1, 0, 0]], ["上", [0, 1, 0]], ["下", [0, -1, 0]],
];

export async function modelScreen(ctx: AppContext): Promise<void> {
  const { viewer, panel, tools, index, signal } = ctx;
  const available = modelSystems(ctx);
  let state: ModelState = kept ? cloneState(kept.state) : initialState();
  const history = kept?.history ?? new History();
  /** 選んだ部品: 押した部品・まとまりの大きさ（0 が一番細かい）・まとまり */
  let selection: { element: string; level: number; part: Part } | null = null;
  /** 選んだ部品を動かしているか（ふだんは false＝回すだけ。選んだ部品の「動かす」で true にし、その部品だけをドラッグで動かす） */
  let moving = false;
  let spinning = false;
  /** スライダーを動かし始める前の状態（離したときに「元に戻す」へ入れる） */
  let editing: ModelState | null = null;

  const keep = () => {
    kept = { state: cloneState(state), history, view: viewer.view };
  };
  signal.addEventListener("abort", keep, { once: true });

  const sync = () => {
    viewer.setSection(state.section);
    void viewer.setModel(toSpec(state, selection?.part ?? null));
    const name = selection ? nameOf(selection.part) : "";
    viewer.setPartLabel(selection?.part.elements ?? null, name);
  };

  /** 状態を変える（元に戻せるように前の状態を残す） */
  const change = (next: ModelState, options: { record?: boolean; redraw?: boolean } = {}) => {
    if (next === state) return;
    if (options.record !== false) history.push(state);
    state = next;
    sync();
    if (options.redraw !== false) render();
  };
  const undo = () => {
    const previous = history.pop();
    if (!previous) return;
    state = previous;
    if (selection && state.hidden.some((part) => part.elements.includes(selection!.element))) {
      selection = null;
      if (moving) setMoving(false);
    }
    sync();
    render();
    ctx.hint("1つ戻した");
  };
  /** スライダー: 動かしている間は描き直さず、離したときに1回だけ元に戻す一覧に入れる */
  const slide = (update: (draft: ModelState) => void) => {
    editing ??= cloneState(state);
    const next = cloneState(state);
    update(next);
    state = next;
    sync();
  };
  const endSlide = () => {
    if (!editing) return;
    history.push(editing);
    editing = null;
    // 組み合わせの見本の印なども合わせて描き直す。キーボードで動かしていたら、同じつまみに戻す
    const focused = document.activeElement instanceof HTMLInputElement ? document.activeElement.getAttribute("aria-label") : null;
    render();
    if (focused) body.querySelector<HTMLInputElement>(`input[aria-label="${focused}"]`)?.focus();
  };

  const nameOf = (part: Part) => partName(part, (id) => termById.get(id)?.ja ?? id);
  const select = (element: string | null, level = 0) => {
    // 選び直したら、動かすのは終える（ほかの部品をうっかり動かさないように）
    if (moving) stopMoving(false);
    if (!element) {
      selection = null;
      if (state.solo) state = { ...cloneState(state), solo: false };
    } else {
      const terms = viewer.partTerms(element);
      const part = partAt(element, level, terms, (id) => index.terms[id]?.elements ?? [], (id) => viewer.sideOf(id));
      selection = { element, level: Math.min(level, Math.max(terms.length - 1, 0)), part };
    }
    sync();
    render();
  };

  viewer.onPick = (element) => {
    // 動かしている間は、動かしている部品と何も無い所のタップでは何もしない（終えるのは「動かし終える」）
    if (moving && (!element || selection?.part.elements.includes(element))) return;
    select(element);
  };
  viewer.onHover = (element) => {
    const terms = viewer.partTerms(element);
    return terms[0] ? termById.get(terms[0])?.ja ?? null : null;
  };
  viewer.partDrag = {
    enabled: () => moving,
    start: (element) => {
      // 動かせるのは、「動かす」を押した部品だけ。ほかの部品と何も無い所をドラッグしたら回す
      if (!selection?.part.elements.includes(element)) return null;
      editing = cloneState(state);
      return selection.part.elements;
    },
    end: (elements, delta) => {
      const before = editing ?? cloneState(state);
      editing = null;
      history.push(before);
      state = withOffset(before, elements, delta);
      sync();
      render();
    },
  };

  // ───── 3Dの上のボタン（動かしている間は「動かし終える」・元に戻す・全体） ─────
  const doneChip = h("button", { class: "chip model-done", type: "button", onClick: () => stopMoving() }, "✓ 動かし終える");
  const undoChip = h("button", { class: "chip", type: "button", onClick: undo, title: "元に戻す（⌘Z・Ctrl+Z）" }, "↶ 戻す");
  const renderTools = () => {
    doneChip.hidden = !moving;
    undoChip.disabled = !history.size;
  };
  const stage = document.getElementById("stage");
  const setMoving = (on: boolean) => {
    moving = on && !!selection;
    stage?.classList.toggle("is-moving", moving);
    ctx.hint(moving ? `${nameOf(selection!.part)}をドラッグで動かす（ほかの所は回す）` : "部品をタップで選ぶ");
  };
  /** 動かすのを終える（redraw が false なら欄は描き直さない。選び直すときは select が描き直す） */
  function stopMoving(redraw = true): void {
    setMoving(false);
    renderTools();
    if (redraw) render();
  }
  const startMoving = () => {
    setMoving(true);
    renderTools();
    render();
  };
  signal.addEventListener("abort", () => stage?.classList.remove("is-moving"), { once: true });
  tools.replaceChildren(doneChip, undoChip,
    h("button", { class: "chip", type: "button", onClick: () => viewer.frameModel() }, "全体"));

  // ───── 欄 ─────
  const selectedBox = h("div");
  const undoBox = h("div", { class: "model-undo" });
  const body = h("div", { class: "set-groups" });

  const renderUndo = () => {
    renderTools();
    undoBox.replaceChildren(
      h("button", { class: "ghost-button", type: "button", disabled: !history.size, onClick: undo }, history.size ? `↶ 元に戻す（${history.size}）` : "↶ 元に戻す"),
      h("button", {
        class: "ghost-button", type: "button", disabled: !isChanged(state),
        onClick: () => {
          const next = cloneState(state);
          Object.assign(next, { hidden: [], faded: [], offsets: {}, explode: 0, section: null, side: "both", solo: false });
          change(next);
          viewer.frameModel([0, 0, 1]);
          ctx.hint("組み立て直した（系統の濃さはそのまま）");
        },
      }, "組み立て直す"),
    );
  };

  const renderSelected = () => {
    if (!selection) {
      selectedBox.replaceChildren(h("div", { class: "model-empty" },
        h("p", {}, h("b", {}, "部品をタップして選ぶ")),
        h("p", { class: "muted" }, "3Dは1本指で回す・2本指でつまんで拡大・2本指でずらす。選んだ部品は、隠す・薄くする・これだけ見る・外へ出す・動かすができます。"),
      ));
      return;
    }
    const { part, element, level } = selection;
    const terms = viewer.partTerms(element);
    const term = part.term ? termById.get(part.term) : undefined;
    const moved = part.elements.some((id) => state.offsets[id]);
    const action = (label: string, onClick: () => void, on = false, disabled = false) =>
      h("button", { class: on ? "model-action on" : "model-action", type: "button", disabled, onClick }, label);
    selectedBox.replaceChildren(h("div", { class: "model-selected" },
      h("div", { class: "model-selected-head" },
        h("div", { class: "model-selected-name" },
          h("b", {}, nameOf(part)),
          term ? h("span", { class: "en", lang: "en" }, term.en) : "",
          h("span", { class: "model-selected-meta" }, `${systemById.get(term?.system ?? "")?.ja ?? ""}${term ? "・" : ""}部品 ${part.elements.length}`)),
        h("button", { class: "model-close", type: "button", "aria-label": "選ぶのをやめる", onClick: () => select(null) }, "×"),
      ),
      // まとまりの大きさ（右心房 → 心臓 → …）
      terms.length > 1 ? h("div", { class: "model-level" },
        h("button", { class: "model-step", type: "button", disabled: level <= 0, "aria-label": "細かいまとまりにする", onClick: () => select(element, level - 1) }, "‹ 細かく"),
        h("span", { class: "model-level-text" }, `まとまり ${level + 1} / ${terms.length}`),
        h("button", { class: "model-step", type: "button", disabled: level >= terms.length - 1, "aria-label": "大きなまとまりにする", onClick: () => select(element, level + 1) }, "大きく ›"),
      ) : "",
      // 動かす: ふだんは回すだけ。押したときだけ、この部品をドラッグで動かせる
      moving
        ? h("div", { class: "model-moving", role: "status" },
          h("p", {}, h("b", {}, "動かしています"), h("span", {}, `3Dで${nameOf(part)}をドラッグすると動きます。ほかの所をドラッグすると回ります。`)),
          h("button", { class: "primary", type: "button", onClick: () => stopMoving() }, "✓ 動かし終える"))
        : h("button", { class: "model-move", type: "button", onClick: startMoving },
          h("span", { class: "model-move-icon", "aria-hidden": "true" }, "✥"),
          h("span", {}, h("b", {}, "ドラッグで動かす"), h("small", {}, "押したあと、この部品だけを3Dで動かせます"))),
      h("div", { class: "model-actions" },
        action("隠す", () => {
          change(withPart(state, part, "hidden"), { redraw: false });
          ctx.hint(`${nameOf(part)}を隠した`);
          select(null);
        }),
        action("薄くする", () => {
          change(withPart(state, part, "faded"), { redraw: false });
          ctx.hint(`${nameOf(part)}を薄くした`);
          select(null);
        }),
        action(state.solo ? "まわりも見る" : "これだけ見る", () => {
          change({ ...cloneState(state), solo: !state.solo });
          if (state.solo) viewer.frameModel(undefined, part.elements);
        }, state.solo),
        action("外へ出す", () => {
          // 画面の横（部品のある側）へ、体の外まで出す
          const center = viewer.partCenter(part.elements);
          const [target] = viewer.view;
          const right = viewer.screenRight;
          const away = center ? (center[0] - target[0]) * right[0] + (center[1] - target[1]) * right[1] + (center[2] - target[2]) * right[2] : 1;
          const distance = 0.32 * (away < 0 ? -1 : 1);
          change(withOffset(state, part.elements, [right[0] * distance, right[1] * distance, right[2] * distance]));
          ctx.hint(`${nameOf(part)}を外へ出した。「元の位置へ」で戻る`);
        }),
        action("元の位置へ", () => change(withoutOffset(state, part.elements)), false, !moved),
        action("寄って見る", () => viewer.frameModel(undefined, part.elements)),
      ),
      term ? h("a", { class: "model-link", href: `#/explore/${term.id}` }, `${term.ja}を図鑑で見る ›`) : "",
    ));
  };

  const systemRows = () => available.map((system) => {
    const value = state.opacity[system.id] ?? 0;
    const percent = h("span", { class: "model-percent" }, value ? `${Math.round(value * 100)}%` : "なし");
    const slider = h("input", {
      type: "range", min: "0", max: "100", step: "5", value: String(Math.round(value * 100)), "aria-label": `${system.ja}の濃さ`,
      onInput: () => {
        const next = Number(slider.value) / 100;
        percent.textContent = next ? `${Math.round(next * 100)}%` : "なし";
        toggle.setAttribute("aria-pressed", String(next > 0));
        slide((draft) => {
          draft.opacity[system.id] = next;
        });
      },
      onChange: endSlide,
    }) as HTMLInputElement;
    const toggle = h("button", {
      class: "model-system", type: "button", "aria-pressed": String(value > 0), style: `--swatch:${system.color}`,
      onClick: () => change(toggleSystem(state, system.id)),
    }, h("span", { class: "model-swatch", "aria-hidden": "true" }), system.ja);
    return h("div", { class: "set-row model-system-row" }, toggle, slider, percent);
  });

  const sectionRows = () => {
    const current = state.section;
    const [lo, hi] = index.bounds;
    const middle = (k: number) => {
      const center = selection ? viewer.partCenter(selection.part.elements) : null;
      return center ? center[k] : (lo[k] + hi[k]) / 2 + (k === 1 ? (hi[1] - lo[1]) * 0.15 : 0);
    };
    const pick = segmented("断面", [{ value: "", label: "なし" }, ...SECTION_AXES.map((axis) => ({ value: axis.axis as string, label: axis.label }))], current?.axis ?? "", (value) => {
      const axis = SECTION_AXES.find((item) => item.axis === value);
      change({ ...cloneState(state), section: axis ? { axis: axis.axis, at: middle("xyz".indexOf(axis.axis)), keep: axis.keep } : null });
      if (axis) viewer.viewSection(true);
      else viewer.frameModel();
    });
    if (!current) return [row("切って見る", "", pick, true)];
    const k = "xyz".indexOf(current.axis);
    const ends = { y: ["足", "頭"], x: ["右", "左"], z: ["後ろ", "前"] }[current.axis];
    const slider = h("input", {
      type: "range", min: String(lo[k]), max: String(hi[k]), step: "0.002", value: String(current.at), "aria-label": "切る位置",
      onInput: () => slide((draft) => {
        draft.section = { ...current, at: Number(slider.value) };
      }),
      onChange: endSlide,
    }) as HTMLInputElement;
    return [
      row("切って見る", "", pick, true),
      h("div", { class: "set-row stack" },
        h("label", { class: "section-slider model-range" }, h("span", {}, ends[0]), slider, h("span", {}, ends[1])),
        h("div", { class: "model-buttons" },
          h("button", { class: "ghost-button", type: "button", onClick: () => { change({ ...cloneState(state), section: { ...current, keep: current.keep === 1 ? -1 : 1 } }); viewer.viewSection(true); } }, "反対側を残す"),
          h("button", { class: "ghost-button", type: "button", onClick: () => viewer.viewSection(true) }, "切り口を正面に"),
        )),
    ];
  };

  const explodeRow = () => {
    const percent = h("span", { class: "model-percent" }, state.explode ? `${Math.round(state.explode * 100)}%` : "なし");
    const slider = h("input", {
      type: "range", min: "0", max: "100", step: "1", value: String(Math.round(state.explode * 100)), "aria-label": "分解の度合い",
      onInput: () => {
        const value = Number(slider.value) / 100;
        percent.textContent = value ? `${Math.round(value * 100)}%` : "なし";
        slide((draft) => {
          draft.explode = value;
        });
      },
      onChange: () => {
        endSlide();
        viewer.frameModel();
      },
    }) as HTMLInputElement;
    return h("div", { class: "set-row model-system-row" }, h("span", { class: "set-label model-row-label" }, "分解"), slider, percent);
  };

  const removedRows = () => {
    const items = [...state.hidden.map((part) => ({ part, faded: false })), ...state.faded.map((part) => ({ part, faded: true }))];
    if (!items.length) return null;
    return group(`隠した部品・薄くした部品（${items.length}）`, {},
      card(h("div", { class: "set-row stack" },
        h("div", { class: "chip-list" }, ...items.map(({ part, faded }) => h("button", {
          class: faded ? "chip peeled faded" : "chip peeled", type: "button", title: "押すと戻す",
          onClick: () => change(withoutPart(state, part.key)),
        }, nameOf(part)))),
        h("button", { class: "ghost-button", type: "button", onClick: () => change(withoutPart(state)) }, "全部戻す"))),
      foot("押すとその部品だけ戻します。点線は薄くした部品。"));
  };

  const render = () => {
    renderSelected();
    renderUndo();
    const preset = presetOf(state);
    body.replaceChildren(
      group("組み合わせ", {},
        h("div", { class: "chip-list model-presets" }, ...PRESETS.map((item) => h("button", {
          class: preset === item.id ? "chip on" : "chip", type: "button",
          onClick: () => {
            change(withPreset(state, item.id));
            ctx.hint(item.id === "all" ? "全部の系統を読み込みます（はじめは約28MB。少し待ってください）" : `${item.label}にした`);
          },
        }, item.label))),
      ),
      group("系統と濃さ", {},
        card(...systemRows()),
        foot("名前を押すと出し入れ、つまみで濃さ。6割より薄い系統は透けて、奥の部品をタップできます。はじめて出す系統は読み込みます。"),
      ),
      group("分解・断面", {},
        card(explodeRow(), ...sectionRows()),
        foot("分解: 部品を真ん中から外へ離します（これだけ見ているときは、その部品の中で）。"),
      ),
      group("見る向き", {},
        card(
          h("div", { class: "set-row stack" }, h("div", { class: "model-views" },
            ...VIEWS.map(([label, from]) => h("button", { class: "ghost-button", type: "button", onClick: () => viewer.frameModel(from, selection?.part.elements) }, label)),
            h("button", { class: "ghost-button", type: "button", onClick: () => viewer.frameModel([0, 0, 1]) }, "全体"))),
          row("片側だけ", "", segmented("片側だけ", [{ value: "both", label: "両側" }, { value: "right", label: "右だけ" }, { value: "left", label: "左だけ" }], state.side, (value) => {
            change({ ...cloneState(state), side: value as ModelState["side"] }, { redraw: false });
            renderUndo();
          }), true),
          toggleRow("回し続ける", "", spinning, (on) => {
            spinning = on;
            viewer.spin(on);
          }),
        ),
        foot("右・左は本人の右・左です（前から見ると、本人の右は画面の左）。"),
      ),
      removedRows() ?? "",
    );
  };

  // キーボード: Delete で隠す・Esc で動かし終える／選ぶのをやめる・⌘Z / Ctrl+Z で元に戻す
  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
    } else if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    } else if (event.key === "Escape" && moving) {
      stopMoving();
    } else if ((event.key === "Delete" || event.key === "Backspace") && selection && !moving) {
      event.preventDefault();
      const part = selection.part;
      change(withPart(state, part, "hidden"), { redraw: false });
      ctx.hint(`${nameOf(part)}を隠した`);
      select(null);
    } else if (event.key === "Escape" && selection) {
      select(null);
    }
  }, { signal });

  const intro = await tabIntro("model");
  panel.replaceChildren(h("div", { class: "set-page model-page" },
    h("div", { class: "tab-head" }, h("h2", {}, "3D模型")),
    intro,
    selectedBox,
    undoBox,
    body,
  ));
  ctx.hint("部品をタップで選ぶ");
  render();
  renderTools();
  const view = kept?.view;
  if (view) viewer.setView(view, false);
  viewer.setSection(state.section);
  await viewer.setModel(toSpec(state, null));
  // はじめて開いたときは、読み込んでから模型の全体を前から映す
  if (!view && !signal.aborted) viewer.frameModel([0, 0, 1]);
}
