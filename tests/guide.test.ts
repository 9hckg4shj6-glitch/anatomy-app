import { existsSync } from "node:fs";
import { cardDemo, dayDemo, featureCards, gestureDemos, lessonDemo, memoryChart, tabsDemo } from "../src/ui/guide-demos";

/** 使い方ガイド（docs/普段使い.md「使い方ガイド」） */
describe("使い方ガイドの見本", () => {
  it("見本の絵（public/guide）がそろっている", () => {
    for (const name of ["spin", "femur", "femur-hi", "heart", "progress"]) expect(existsSync(`public/guide/${name}.webp`)).toBe(true);
  });

  it("毎日の使い方は、画面3つと手順4つ。指は押す所（今日の復習・正解の選択肢）の中にある", () => {
    const demo = dayDemo();
    expect(demo.querySelectorAll(".gd-scr")).toHaveLength(3);
    expect(demo.querySelectorAll(".gd-caps li")).toHaveLength(4);
    expect(demo.querySelector(".gd-day-s1 .gd-btn .gd-finger")).not.toBeNull();
    expect(demo.querySelector(".gd-day-s2 .gd-ok")?.textContent).toBe("大腿骨");
    expect(demo.querySelector(".gd-day-s2 .gd-ok .gd-finger")).not.toBeNull();
  });

  it("レッスンの流れは4つの段で、押すとその段の画面と説明に替わる", () => {
    const controller = new AbortController();
    const demo = lessonDemo(controller.signal);
    const tabs = [...demo.querySelectorAll<HTMLButtonElement>(".gd-stepper-tab")];
    expect(tabs).toHaveLength(4);
    expect(demo.querySelector(".gd-scr.is-active")?.classList.contains("gd-l1")).toBe(true);
    tabs[2].click();
    expect(demo.querySelector(".gd-scr.is-active")?.classList.contains("gd-l3")).toBe(true);
    expect(tabs[2].getAttribute("aria-pressed")).toBe("true");
    expect(demo.querySelector(".gd-stepper-text")?.textContent).toContain("名前→位置");
    controller.abort();
  });

  it("復習のしくみの図: 復習の日が 1・4・12・32日目（次までの日が 1・3・8・20日）", () => {
    const chart = memoryChart();
    expect(chart.querySelectorAll(".gd-dot")).toHaveLength(4);
    expect([...chart.querySelectorAll(".gd-gaps b")].map((b) => b.textContent)).toEqual(["1日", "3日", "8日", "20日", "…"]);
    // 曲線は 100% と 90% の間だけを行き来する（y は 50%〜100% の目盛り）
    const ys = (chart.querySelector(".gd-curve")?.getAttribute("d") ?? "").match(/[ML][\d.]+ ([\d.]+)/g)!.map((p) => Number(p.split(" ")[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(40);
  });

  it("3Dの動かし方は、スマホ・iPad とパソコンで説明が替わる", () => {
    const demo = gestureDemos();
    const captions = () => [...demo.querySelectorAll("figcaption span")].map((span) => span.textContent);
    demo.querySelector<HTMLButtonElement>('[data-mode="touch"]')!.click();
    expect(captions()[0]).toBe("1本指でドラッグ");
    demo.querySelector<HTMLButtonElement>('[data-mode="mouse"]')!.click();
    expect(captions()[0]).toBe("左ボタンでドラッグ");
    expect(demo.classList.contains("is-mouse")).toBe(true);
  });

  it("6つのタブ: 押すとそのタブの説明に替わる", () => {
    const controller = new AbortController();
    const demo = tabsDemo(controller.signal, (tab) => Object.assign(document.createElement("p"), { textContent: tab }));
    const chips = [...demo.querySelectorAll<HTMLButtonElement>(".gd-tabs-chips .chip")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["今日", "学ぶ", "調べる", "3D模型", "記録", "設定"]);
    chips[2].click();
    expect(demo.querySelector(".gd-tabs-side")?.textContent).toBe("look");
    controller.abort();
  });

  it("語のカードの番号と説明の数がそろい、そのほかの学び方はアプリの中の画面へ", () => {
    const card = cardDemo();
    expect(card.querySelectorAll(".gd-pin").length).toBe(card.querySelectorAll(".gd-parts li").length);
    for (const link of featureCards().querySelectorAll("a")) expect(link.getAttribute("href")).toMatch(/^#\//);
  });
});
