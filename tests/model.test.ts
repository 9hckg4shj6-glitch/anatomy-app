import { describe, expect, it } from "vitest";
import {
  History, PRESETS, initialState, isChanged, modelModeOf, partAt, partName, presetOf, toSpec, toggleSystem,
  withOffset, withPart, withPreset, withoutOffset, withoutPart,
} from "../src/model-state";

// 部品: kidneyR（右）・kidneyL（左）・aorta（正中）。語: 腎臓（左右）・大動脈・腹部（全部）
const SIDES: Record<string, -1 | 0 | 1> = { kidneyR: -1, kidneyL: 1, aorta: 0 };
const ELEMENTS: Record<string, string[]> = { kidney: ["kidneyR", "kidneyL"], aorta: ["aorta"], abdomen: ["kidneyR", "kidneyL", "aorta"] };
const sideOf = (id: string) => SIDES[id] ?? null;
const elementsOf = (term: string) => ELEMENTS[term] ?? [];
const names: Record<string, string> = { kidney: "腎臓", aorta: "大動脈", abdomen: "腹部" };

describe("3D模型の状態", () => {
  it("押した部品のまとまりは、左右のある語なら押した側だけ（右の腎臓）", () => {
    const part = partAt("kidneyR", 0, ["kidney", "abdomen"], elementsOf, sideOf);
    expect(part.elements).toEqual(["kidneyR"]);
    expect(partName(part, (id) => names[id])).toBe("右の腎臓");
    const left = partAt("kidneyL", 0, ["kidney", "abdomen"], elementsOf, sideOf);
    expect(partName(left, (id) => names[id])).toBe("左の腎臓");
    expect(left.key).not.toBe(part.key);
  });

  it("まとまりを大きくすると、押した側と正中の部品を集める。正中の部品からなら両側", () => {
    const part = partAt("kidneyR", 1, ["kidney", "abdomen"], elementsOf, sideOf);
    expect(part.elements.sort()).toEqual(["aorta", "kidneyR"]);
    const middle = partAt("aorta", 1, ["aorta", "abdomen"], elementsOf, sideOf);
    expect(middle.elements.sort()).toEqual(["aorta", "kidneyL", "kidneyR"]);
    expect(partName(middle, (id) => names[id])).toBe("腹部");
    // まとまりの大きさは語の数を超えない
    expect(partAt("kidneyR", 9, ["kidney", "abdomen"], elementsOf, sideOf).term).toBe("abdomen");
  });

  it("語の無い部品は、その部品だけ。語の部品の一覧は書きかえない", () => {
    const part = partAt("loose", 0, [], elementsOf, sideOf);
    expect(part).toEqual({ key: "@loose", term: null, elements: ["loose"] });
    partAt("kidneyR", 1, ["kidney", "abdomen"], elementsOf, () => null);
    expect(ELEMENTS.abdomen).toEqual(["kidneyR", "kidneyL", "aorta"]);
  });

  it("隠すと薄くするは片方だけ。押すとそのまとまりだけ戻り、全部戻すこともできる", () => {
    const kidney = partAt("kidneyR", 0, ["kidney"], elementsOf, sideOf);
    const aorta = partAt("aorta", 0, ["aorta"], elementsOf, sideOf);
    let state = withPart(initialState(), kidney, "hidden");
    state = withPart(state, kidney, "faded");
    expect(state.hidden).toEqual([]);
    expect(state.faded.map((part) => part.key)).toEqual([kidney.key]);
    state = withPart(state, aorta, "hidden");
    expect(toSpec(state, null)).toMatchObject({ hidden: ["aorta"], faded: ["kidneyR"] });
    expect(withoutPart(state, aorta.key).hidden).toEqual([]);
    expect(withoutPart(state)).toMatchObject({ hidden: [], faded: [] });
  });

  it("部品を動かすと量を足していき、元の位置へで消える", () => {
    let state = withOffset(initialState(), ["kidneyR"], [0.1, 0, 0]);
    state = withOffset(state, ["kidneyR", "aorta"], [0.05, 0.02, 0]);
    expect(state.offsets.kidneyR[0]).toBeCloseTo(0.15);
    expect(state.offsets.aorta).toEqual([0.05, 0.02, 0]);
    expect(isChanged(state)).toBe(true);
    expect(Object.keys(withoutOffset(state, ["aorta"]).offsets)).toEqual(["kidneyR"]);
    expect(isChanged(withoutOffset(state))).toBe(false);
  });

  it("系統の名前で出し入れすると、前の濃さに戻る", () => {
    let state = initialState();
    state.opacity.skeletal = 0.4;
    state = toggleSystem(state, "skeletal");
    expect(state.opacity.skeletal).toBe(0);
    state = toggleSystem(state, "skeletal");
    expect(state.opacity.skeletal).toBe(0.4);
    // はじめて出す系統は 1（皮膚はうっすら）
    expect(toggleSystem(state, "nervous").opacity.nervous).toBe(1);
    expect(toggleSystem({ ...state, opacity: { ...state.opacity, body: 0 } }, "body").opacity.body).toBe(0.25);
  });

  it("組み合わせの見本: はじめは「骨と内臓」で、見本を選ぶとその見本の印が付く", () => {
    expect(presetOf(initialState())).toBe("organs");
    const state = withPreset(initialState(), "muscles");
    expect(presetOf(state)).toBe("muscles");
    expect(state.opacity.digestive).toBeUndefined();
    state.opacity.skeletal = 0.5;
    expect(presetOf(state)).toBeNull();
    for (const preset of PRESETS) expect(Object.values(preset.opacity).every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it("元に戻すは新しい順で、写しなので後から変えても残した状態は変わらない", () => {
    const history = new History(2);
    const state = initialState();
    history.push(state);
    state.explode = 0.5;
    history.push(state);
    state.explode = 0.9;
    history.push(state);
    expect(history.size).toBe(2);
    expect(history.pop()?.explode).toBe(0.9);
    expect(history.pop()?.explode).toBe(0.5);
    expect(history.pop()).toBeUndefined();
  });

  it("3Dに渡す見せ方: 選んだ部品と、これだけ見る・片側・分解", () => {
    const part = partAt("kidneyR", 0, ["kidney"], elementsOf, sideOf);
    const spec = toSpec({ ...initialState(), solo: true, side: "right", explode: 0.3 }, part);
    expect(spec).toMatchObject({ selected: ["kidneyR"], solo: true, side: "right", explode: 0.3 });
  });
});

describe("3D模型の2つの使い方", () => {
  it("アドレスで選んだ使い方、無ければ前に選んだ使い方、どちらも無ければ見る", () => {
    expect(modelModeOf("free", "look")).toBe("free");
    expect(modelModeOf("look", "free")).toBe("look");
    expect(modelModeOf("", "free")).toBe("free");
    expect(modelModeOf("", undefined)).toBe("look");
    expect(modelModeOf("xyz", "other")).toBe("look");
  });
});
