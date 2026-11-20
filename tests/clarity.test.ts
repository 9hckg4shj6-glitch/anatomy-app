import "fake-indexeddb/auto";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { organs } from "../src/content";
import { kindHintText } from "../src/study";
import { tabsDemo } from "../src/ui/guide-demos";
import { ORGAN_GROUPS, organMeta, organThumb } from "../src/ui/organs";
import { smallestReviewSize } from "../src/ui/review";
import { setupSplitter } from "../src/ui/splitter";
import { nextTipCount, STAGE_TIP_TIMES } from "../src/ui/stage-tip";
import { lockedRow } from "../src/ui/study-hub";

/** 画面の分かりにくさの見直し（docs/普段使い.md） */
describe("画面の分かりにくさの見直し", () => {
  it("3Dをたたむ: true は帯ごと隠し、文字を渡すとその帯だけを残す。帯を押すと3Dを出す", () => {
    const layout = document.createElement("main");
    const stage = document.createElement("section");
    const panel = document.createElement("section");
    layout.append(stage, panel);
    document.body.append(layout);
    const splitter = setupSplitter(layout, stage, panel);
    const unfold = stage.querySelector<HTMLButtonElement>(".stage-unfold")!;

    splitter.fold(true);
    expect(layout.classList.contains("stage-folded")).toBe(true);
    expect(layout.classList.contains("stage-folded-bar")).toBe(false);

    splitter.fold("3Dで見る：次のレッスンの語");
    expect(layout.classList.contains("stage-folded-bar")).toBe(true);
    expect(unfold.textContent).toContain("3Dで見る：次のレッスンの語");

    unfold.click();
    expect(layout.classList.contains("stage-folded")).toBe(false);
    expect(layout.classList.contains("stage-folded-bar")).toBe(false);
    layout.remove();
  });

  it("右上の印の説明は、閉じるか3回見たら出さない", () => {
    expect(nextTipCount(undefined)).toBe(1);
    expect(nextTipCount(1)).toBe(2);
    expect(nextTipCount(STAGE_TIP_TIMES - 1)).toBe(STAGE_TIP_TIMES);
    expect(nextTipCount(STAGE_TIP_TIMES)).toBeNull();
    expect(nextTipCount(-1)).toBeNull();
  });

  it("臓器の図の一覧: どの臓器も1つのまとまりに入り、平面図のある臓器には絵がある", () => {
    const grouped = ORGAN_GROUPS.flatMap((group) => group.organs);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(organs.map((organ) => organ.id).sort());
    for (const organ of organs) {
      const thumb = organThumb(organ);
      if (organ.plates.length) {
        expect(thumb).toBe(`/organs/${organ.id}.webp`);
        expect(existsSync(`public/organs/${organ.id}.webp`), `${organ.id} の絵（scripts/organ-thumbs.mjs）`).toBe(true);
      } else expect(thumb).toBeNull();
    }
  });

  it("臓器の札の字: 平面図の枚数（無ければ「立体だけ」）と図のレッスン", () => {
    const heart = organs.find((organ) => organ.id === "heart")!;
    const segments = organs.find((organ) => organ.id === "lung-segments")!;
    expect(organMeta(heart, 0, 0)).toEqual([`平面図 ${heart.plates.length}枚`]);
    expect(organMeta(segments, 0, 0)).toEqual(["立体だけ"]);
    expect(organMeta(heart, 3, 0)).toEqual([`平面図 ${heart.plates.length}枚`, "レッスン 3"]);
    expect(organMeta(heart, 3, 1)).toEqual([`平面図 ${heart.plates.length}枚`, "レッスン 1 / 3"]);
  });

  it("問い方に、何をする問題かの一言を添える", () => {
    expect(kindHintText(["locate", "point"])).toBe("位置→名前＝光った所の名前を選ぶ。名前→位置＝名前の所を3Dでタップ");
    // 一言の無い問い方（筋の起始・停止など）は入れない
    expect(kindHintText(["muscle"])).toBe("");
  });

  it("1回に解く数は、今日の問題が10問より多いときだけ選ぶ", () => {
    expect(smallestReviewSize()).toBe(10);
  });

  it("鍵の付いた学び方: 設定で使えるようになるものは、押すとその設定へ", () => {
    const linked = lockedRow("roots", "#2f8f55", "語根カード", "コースを「標準」にすると使えます", ["#/settings/course", "設定でコースを変える"]);
    const link = linked.querySelector<HTMLAnchorElement>("a.home-item.locked");
    expect(link?.getAttribute("href")).toBe("#/settings/course");
    expect(link?.textContent).toContain("設定でコースを変える ›");
    const plain = lockedRow("drill", "#6b5fb5", "演習", "レッスンを1つ学ぶと使えます");
    expect(plain.querySelector("a")).toBeNull();
    expect(plain.querySelector(".home-item")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("使い方の「5つのタブ」は、開いたタブを選んで止めておける（各タブの1行の説明の「くわしく」から）", () => {
    const controller = new AbortController();
    const demo = tabsDemo(controller.signal, (tab) => Object.assign(document.createElement("p"), { textContent: tab }), "look");
    expect(demo.querySelector(".gd-tabs-side")?.textContent).toBe("look");
    expect(demo.querySelector(".gd-tabs-chips .chip.on")?.textContent).toBe("調べる");
    demo.select("settings");
    expect(demo.querySelector(".gd-tabs-side")?.textContent).toBe("settings");
    controller.abort();
  });
});
