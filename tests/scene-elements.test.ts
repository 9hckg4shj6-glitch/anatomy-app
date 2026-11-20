import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { organs, organTerms, termById } from "../src/content";
import { sceneFor } from "../src/ui/context";
import indexJson from "../public/models/index.json";

/**
 * 語の部品が、その語の場面（sceneFor。レッスン・問題・図鑑で使う）に出てタップで選べるか。
 * 3Dは場面の系統の GLB だけを読み込み、添える系統（context）の部品は薄くして選べない（その場面の系統の語の部品は除く。viewer の borrowed）。
 * 部品は1つの GLB にしか入らない（scripts/build-models.mjs）ので、ほかの系統の語が先に部品を使うと、その系統の GLB に入って出なくなる
 * （2026-11-20 まで、消化器の「腹膜後器官」が先に使ったため、腎臓・腎皮質・尿管・副腎などが泌尿器・内分泌の場面に出なかった）
 */
type ModelIndex = {
  systems: Record<string, { url: string; za?: { url: string } }>;
  terms: Record<string, { system: string; elements: string[] }>;
};
const index = indexJson as unknown as ModelIndex;

/** GLB の初めの JSON から、部品（node）の名前を読む */
function elementsOf(url: string): string[] {
  const bytes = readFileSync(path.resolve(import.meta.dirname, "../public", url));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8")) as { nodes?: { name?: string; mesh?: number }[] };
  return (json.nodes ?? []).filter((node) => node.mesh !== undefined && node.name).map((node) => node.name!);
}

describe("語の部品はその語の場面に出る", () => {
  const fileOf = new Map<string, string>();
  for (const [system, entry] of Object.entries(index.systems)) {
    for (const file of [entry.url, ...(entry.za ? [entry.za.url] : [])]) for (const element of elementsOf(file)) fileOf.set(element, system);
  }

  it("どの語も、部品がその語の場面の系統の GLB にあり（添える系統の GLB なら、その場面の系統の語として）選べる", () => {
    const missing: string[] = [];
    for (const [id, entry] of Object.entries(index.terms)) {
      const term = termById.get(id);
      if (!term) continue;
      const scene = sceneFor(term.system, term.unit);
      const shown = new Set(scene.systems);
      const context = new Set(scene.context ?? []);
      const lost = entry.elements.filter((element) => {
        const system = fileOf.get(element);
        if (!system) return true;
        return !shown.has(system) && !(context.has(system) && shown.has(term.system));
      });
      if (lost.length) missing.push(`${term.ja}（${id}）: ${lost.map((element) => `${element}＝${fileOf.get(element) ?? "どの GLB にも無い"}`).join("、")}`);
    }
    expect(missing).toEqual([]);
  });

  it("臓器の図の立体に、その臓器の語（添える語も）の部品がみな出る", () => {
    const missing: string[] = [];
    for (const organ of organs.filter((item) => item.box)) {
      // src/ui/organs.ts と同じく、臓器の語の系統を読み込む
      const ids = organTerms(organ);
      const shown = new Set(ids.map((id) => termById.get(id)?.system ?? "").filter(Boolean));
      for (const id of ids) {
        const lost = (index.terms[id]?.elements ?? []).filter((element) => !shown.has(fileOf.get(element) ?? ""));
        if (lost.length) missing.push(`${organ.ja}の${termById.get(id)?.ja ?? id}: ${lost.join("、")}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("腎臓まわりの語は泌尿器・内分泌の GLB に入っている（消化器の「腹膜後器官」が先に使っても）", () => {
    for (const [id, system] of [["kidney", "urogenital"], ["renal-cortex", "urogenital"], ["ureter", "urogenital"], ["adrenal-gland", "endocrine"]]) {
      for (const element of index.terms[id].elements) expect(fileOf.get(element), `${id} の ${element}`).toBe(system);
    }
  });
});
