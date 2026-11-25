// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PlateLabel } from "../src/content";
import { db } from "../src/db";
import {
  checkKey, checkView, currentOf, grade, isDone, jump, loadResults, missedOf, newRound, plateChecker, resultOf, resultText, retryRound,
} from "../src/ui/plate-check";
import { labelLines } from "../src/ui/plate-view";

/** docs/普段使い.md「隠して確かめるの見直し」 */
const labels: PlateLabel[] = [
  { at: [0, 0], term: "left-ventricle" },
  { at: [0, 0], term: "right-atrium" },
  { at: [0, 0], ja: "全身の組織", en: "body tissues" },
  { at: [0, 0], term: "aortic-valve" },
];
/** いつも同じ順になる「ばらばら」（入れかえない） */
const keep = () => 0.999;

describe("隠して確かめる（進め方）", () => {
  it("名前を全部・ばらばらの順に1つずつ問い、答えを見て○×をつけると次へ。終わったら結果", () => {
    const state = newRound("all", labels.length, undefined, keep);
    expect([...state.order].sort()).toEqual([0, 1, 2, 3]);
    expect(checkView(state).hidden.size).toBe(4);
    const first = currentOf(state)!;
    state.shown = true;
    // 答えを見たら、その名前だけ出る
    expect(checkView(state).hidden.has(first)).toBe(false);
    expect(checkView(state).hidden.size).toBe(3);
    grade(state, true);
    expect(state.shown).toBe(false);
    for (const ok of [false, false, true]) {
      state.shown = true;
      grade(state, ok);
    }
    expect(isDone(state)).toBe(true);
    expect(checkView(state).hidden.size).toBe(0);
    const result = resultOf(state, labels, "2026-11-25T03:00:00.000Z");
    expect(result.right).toBe(2);
    expect(result.total).toBe(4);
    expect(result.missed).toHaveLength(2);
  });

  it("× だけをもう一度（○はそのまま出しておく）", () => {
    const state = newRound("ja", labels.length, undefined, keep);
    for (const ok of [true, false, true, false]) {
      state.shown = true;
      grade(state, ok);
    }
    const again = retryRound(state, keep);
    expect(again.hide).toBe("ja");
    expect(again.order).toHaveLength(2);
    expect(again.order.every((i) => state.marks.get(i) === false)).toBe(true);
    expect(checkView(again).hidden).toEqual(new Set(again.order));
    expect([...again.marks.values()]).toEqual([true, true]);
  });

  it("図の番号を押すと、まだ問うていない名前を先に問う（答えた名前・今の問いは変わらない）", () => {
    const state = newRound("all", labels.length, undefined, keep);
    const last = state.order[3];
    expect(jump(state, last)).toBe(true);
    expect(currentOf(state)).toBe(last);
    expect(state.order).toHaveLength(4);
    expect(jump(state, last)).toBe(false);
    state.shown = true;
    grade(state, true);
    expect(jump(state, last)).toBe(false);
  });

  it("前回の × は名前（語ID）で覚え、図の番号が変わっても同じ名前を指す", () => {
    const result = { right: 2, total: 4, missed: ["right-atrium", "全身の組織", "消えた名前"], at: "2026-11-25T03:00:00.000Z" };
    expect(missedOf(result, labels)).toEqual([1, 2]);
    const state = newRound("all", labels.length, missedOf(result, labels), keep);
    expect([...state.order].sort()).toEqual([1, 2]);
    expect(state.marks.get(0)).toBe(true);
    expect(state.marks.get(3)).toBe(true);
    expect(resultText(result)).toBe("前回 2 / 4（11/25）");
    expect(resultText({ ...result, right: 4, missed: [] })).toBe("前回 全部○（11/25）");
  });
});

describe("隠して確かめる（図の名前の行）", () => {
  const view = (hide: "all" | "ja" | "en") => ({ hide, hidden: new Set([1]), marks: new Map([[0, false]]) });
  it("全部隠すは番号と「？」、日本語を隠すは英語が手がかり、英語を隠すは日本語が手がかり", () => {
    expect(labelLines(labels[1], 1, "both", view("all"))).toEqual([{ text: "2　？", en: false }]);
    expect(labelLines(labels[1], 1, "both", view("ja"))).toEqual([{ text: "2　？", en: false }, { text: "right atrium", en: true }]);
    expect(labelLines(labels[1], 1, "both", view("en"))).toEqual([{ text: "2　右心房", en: false }, { text: "？", en: true }]);
    // 名前の一覧（番号は ol が出す）
    expect(labelLines(labels[1], 1, "both", view("ja"), false)[0].text).toBe("？");
  });
  it("答えた名前は日本語と英語と○×、確かめていなければ名前の出し方のとおり", () => {
    expect(labelLines(labels[0], 0, "en", view("all"))).toEqual([{ text: "左心室", en: false, mark: false }, { text: "left ventricle", en: true }]);
    expect(labelLines(labels[0], 0, "ja", null)).toEqual([{ text: "左心室", en: false }]);
    expect(labelLines(labels[0], 0, "en", null)).toEqual([{ text: "left ventricle", en: true }]);
  });
});

describe("隠して確かめる（画面）", () => {
  it("選ぶ → 問い → 答え → ○× → 終わりの欄と、図ごと・隠し方ごとの結果", async () => {
    await db.settings.delete(checkKey("test-plate"));
    const bar = document.createElement("div");
    const controller = new AbortController();
    let changes = 0;
    const checker = plateChecker({ plateId: "test-plate", labels, signal: controller.signal, bar, changed: () => changes++ });
    expect(checker.active()).toBe(false);
    checker.open();
    expect(checker.active()).toBe(true);
    expect([...bar.querySelectorAll(".pc-kind b")].map((item) => item.textContent)).toEqual(["全部隠す", "日本語を隠す", "英語を隠す"]);
    bar.querySelectorAll<HTMLButtonElement>(".pc-kind")[1].click();
    expect(checker.view()?.hide).toBe("ja");
    expect(bar.querySelector(".pc-text")?.textContent).toContain("日本語は？");
    expect(checker.tools().length).toBeGreaterThan(0);
    for (let k = 0; k < labels.length; k++) {
      bar.querySelector<HTMLButtonElement>(".pc-show")!.click();
      expect(checker.shown()).toBe(true);
      bar.querySelector<HTMLButtonElement>(k === 0 ? ".pc-ng" : ".pc-ok")!.click();
    }
    expect(bar.querySelector(".pc-sum")?.textContent).toContain("4のうち 3 が○");
    expect(bar.querySelector(".pc-end .primary")?.textContent).toBe("× の1つをもう一度");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const saved = await loadResults("test-plate");
    expect(saved.ja?.right).toBe(3);
    expect(saved.all).toBeUndefined();
    // もう一度は × の1つだけ
    bar.querySelector<HTMLButtonElement>(".pc-end .primary")!.click();
    expect(checker.view()?.hidden.size).toBe(1);
    expect(changes).toBeGreaterThan(5);
    controller.abort();
  });
});

describe("隠して確かめるの案内", () => {
  it("使い方ガイド・はじめの目的・困ったときが新しい形を説明する", () => {
    const guide = readFileSync("src/ui/guide.ts", "utf8") + readFileSync("src/ui/guide-demos.ts", "utf8") + readFileSync("src/purposes.ts", "utf8");
    expect(guide).not.toContain("日本語と英語・日本語・英語・隠して確かめる の4つ");
    expect(guide).toContain("日本語を隠す");
    expect(guide).toContain("× だけ");
  });
});
