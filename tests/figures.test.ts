// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { organs, termById } from "../src/content";
import { fullOrganById } from "../src/organ-details";
import { allFigures, alsoFigures, figureById, figureHref, figuresWith, findFigures, findOrgans, orderedOrgans, plateTermIds } from "../src/organ-figures";
import { figureCards, termFigures } from "../src/ui/figure-strip";
import { ORGAN_GROUPS } from "../src/ui/organs";

/** docs/普段使い.md「平面図の探しやすさの見直し」: 図の帯・すべての図・図を探す・この語が載っている図 */
const index = JSON.parse(readFileSync("public/plates/index.json", "utf8")) as { plates: Record<string, { url: string }> };
const ids = (list: { plate: { id: string } }[]) => list.map((item) => item.plate.id);

describe("平面図の探しやすさ", () => {
  it("すべての図は臓器の一覧の順で、どの平面図も1度ずつ入る", () => {
    const plates = organs.flatMap((organ) => organ.plates.map((plate) => plate.id));
    expect(ids(allFigures).sort()).toEqual([...plates].sort());
    expect(orderedOrgans.map((organ) => organ.id)).toEqual(ORGAN_GROUPS.flatMap((group) => group.organs));
    expect(allFigures[0].organ.id).toBe("heart");
  });

  it("平面図ごとに小さな絵がある（scripts/organ-thumbs.mjs。平面図と同じファイル名）", () => {
    for (const figure of allFigures) {
      const entry = index.plates[figure.plate.id];
      if (!entry) continue;
      const thumb = path.join("public/plates/thumbs", path.basename(entry.url));
      expect(existsSync(thumb), `${figure.plate.id} の小さな絵（node scripts/organ-thumbs.mjs）`).toBe(true);
    }
  });

  it("語が載っている図: その語の平面図 → 選んだ臓器の図 → ほかの臓器の図", () => {
    // 平面図の語は、その語の図がいちばん先
    expect(ids(figuresWith("nephron"))[0]).toBe("nephron");
    // 3Dの語は、今見ている臓器の図が先
    const ventricle = figuresWith("left-ventricle", "heart");
    expect(ventricle.length).toBeGreaterThan(3);
    const firstOther = ventricle.findIndex((figure) => figure.organ.id !== "heart");
    expect(firstOther).toBeGreaterThan(0);
    expect(ventricle.slice(firstOther).every((figure) => figure.organ.id !== "heart")).toBe(true);
    // どの図にも載っていない語は空
    expect(figuresWith("biceps-brachii")).toEqual([]);
    // 図の画面のアドレスは、語を付けるとその名前を選んで開く
    expect(figureHref(figureById("nephron")!, "nephron")).toBe("#/organs/renal/nephron/nephron");
  });

  it("図を探す: 題 → 図に載っている語の名前 → 臓器の名前", () => {
    expect(ids(findFigures("ネフロン"))[0]).toBe("nephron");
    expect(ids(findFigures("四腔断"))[0]).toBe("heart-four-chamber");
    expect(ids(findFigures("胎児循環"))[0]).toBe("fetal-circulation");
    // 題には無い語でも、図に載っていれば見つかる（当たった語の名前を添える）
    const ducts = findFigures("副膵管", { labels: true });
    expect(ids(ducts)).toEqual(expect.arrayContaining(["pancreatic-ducts", "pancreas-development"]));
    expect(ducts.every((hit) => hit.term && plateTermIds(hit.plate).includes(hit.term))).toBe(true);
    expect(ducts[0].label).toBe(termById.get(ducts[0].term!)?.ja);
    expect(findFigures("副膵管")).toEqual([]);
    // 臓器の名前で当たる図は、題で当たる図より後ろ
    const heart = findFigures("心臓");
    expect(heart[0].plate.title.startsWith("心臓")).toBe(true);
    expect(heart.filter((hit) => hit.byOrgan).every((hit) => hit.organ.id === "heart" || hit.organ.ja.includes("心臓"))).toBe(true);
    expect(heart.findIndex((hit) => hit.byOrgan)).toBeGreaterThan(heart.findIndex((hit) => !hit.byOrgan));
    // 英語・読みでも
    expect(ids(findFigures("nephron", { labels: true }))).toContain("nephron");
    expect(findOrgans("しんぞう")[0].id).toBe("heart");
    expect(findOrgans("kidney").map((organ) => organ.id)).toContain("kidney");
    expect(findFigures("")).toEqual([]);
  });

  it("図の題は「主題（向き）」の形（「前から見た〜」にしない）", () => {
    for (const figure of allFigures) expect(figure.plate.title, figure.plate.id).not.toMatch(/から見た|見る）/);
  });

  it("ほかの臓器の図（also）は、ほかの臓器にある図だけ", () => {
    let total = 0;
    for (const core of organs) {
      const organ = fullOrganById(core.id)!;
      const also = alsoFigures(organ.also);
      expect(also.length, organ.id).toBe((organ.also ?? []).length);
      for (const figure of also) expect(figure.organ.id, `${organ.id} の also ${figure.plate.id}`).not.toBe(organ.id);
      total += also.length;
    }
    expect(total).toBeGreaterThan(20);
    // 口腔の臓器から、咽頭の臓器にある「口を開けた口腔」へ
    expect(fullOrganById("mouth")!.also).toContain("mouth-open");
  });

  it("札の並び: 今の図に印・ほかの臓器の図の区切り・語の図の欄", () => {
    const list = figureCards([
      { href: "#/organs/heart/3d", title: "立体（3D）", kind: "3d", current: true },
      { href: "#/organs/heart/heart-anterior", title: "心臓（前から）", plate: "heart-anterior" },
      { divider: "ほかの臓器の図" },
      { href: "#/organs/vessels/dual-circulation", title: "体循環と肺循環", plate: "dual-circulation", sub: "体循環・肺循環と血管の壁" },
    ]);
    expect(list.className).toBe("fig-strip");
    expect(list.querySelectorAll(".fig-card")).toHaveLength(3);
    expect(list.querySelector(".fig-card.on")?.getAttribute("aria-current")).toBe("page");
    expect(list.querySelector(".fig-thumb-3d")?.textContent).toBe("3D");
    expect(list.querySelector(".fig-divider")?.textContent).toBe("ほかの臓器の図");
    expect(list.querySelector(".fig-sub")?.textContent).toBe("体循環・肺循環と血管の壁");

    const box = termFigures("left-ventricle", { prefer: "heart", except: "heart-anterior" }) as HTMLElement;
    const links = [...box.querySelectorAll<HTMLAnchorElement>("a.fig-card")].map((link) => link.getAttribute("href"));
    expect(links.length).toBe(figuresWith("left-ventricle").length - 1);
    expect(links.every((href) => href?.endsWith("/left-ventricle"))).toBe(true);
    expect(links).not.toContain("#/organs/heart/heart-anterior/left-ventricle");
    expect(termFigures("biceps-brachii")).toBe("");
  });
});
