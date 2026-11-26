import indexJson from "../public/models/index.json";
import { joints, pins, termById, terms } from "../src/content";
import { cutQuestions, NERVE_CUTS } from "../src/nerve-cut";

/** 神経を切ると（src/nerve-cut.ts）: 筋の語の「神経」とのつき合わせ、3Dの部品、当てる問い */
const index = indexJson as unknown as { terms: Record<string, { system: string; elements: string[] }> };
const elementsOf = (id: string) => index.terms[id]?.elements ?? [];

describe("神経と筋", () => {
  it("神経・筋・動きの筋・骨の部位の語がそろっている", () => {
    for (const cut of NERVE_CUTS) {
      expect(termById.get(cut.id)?.system, cut.id).toBe("nervous");
      for (const site of cut.sites) {
        for (const id of [...site.lost, ...(site.weak ?? [])]) {
          expect(termById.has(id), `${cut.id}/${site.id}: ${id}`).toBe(true);
          expect(elementsOf(id).length, `${id} の3D`).toBeGreaterThan(0);
        }
        for (const move of site.cannot) if (move.by) expect(termById.get(move.by)?.motion, `${site.id}: ${move.by} の動き`).toBeTruthy();
        for (const id of site.near ?? []) expect(pins[id], `ピン ${id}`).toBeTruthy();
        for (const sign of site.signs) for (const id of Object.keys({ ...sign.pose?.from, ...sign.pose?.to })) expect(joints[id], `関節 ${id}`).toBeTruthy();
        expect(site.asks.length, `${cut.id}/${site.id} の問い`).toBeGreaterThan(0);
        expect(site.cannot.length + site.signs.length).toBeGreaterThan(0);
      }
    }
  });

  it("いちばん上で切ると、その神経だけで動く筋（筋の語の「神経」が motor のもの）がすべて止まる", () => {
    for (const cut of NERVE_CUTS) {
      const lost = new Set(cut.sites[0].lost.flatMap(elementsOf));
      const muscles = terms.filter((term) => term.nerve && cut.motor.includes(term.nerve));
      expect(muscles.length, cut.id).toBeGreaterThan(0);
      for (const term of muscles) {
        const missing = elementsOf(term.id).filter((element) => !lost.has(element));
        expect(missing, `${cut.id}: ${term.ja}（${term.id}）が止まる筋にない`).toEqual([]);
      }
    }
  });

  it("止まる筋は、筋の語でもその神経の筋。弱まる筋は、ほかの神経と一緒に動かす筋", () => {
    for (const cut of NERVE_CUTS) {
      const motorElements = new Set(terms.filter((term) => term.nerve && cut.motor.includes(term.nerve)).flatMap((term) => elementsOf(term.id)));
      const name = termById.get(cut.id)!.ja.replace(/神経$/, "");
      for (const site of cut.sites) {
        for (const id of site.lost) {
          const own = termById.get(id)!.nerve;
          // まとめた語（ハムストリング・下腿三頭筋など）は、部品がその神経の筋に含まれればよい
          const ok = (own && cut.motor.includes(own)) || elementsOf(id).every((element) => motorElements.has(element));
          expect(ok, `${cut.id}/${site.id}: ${id}（${own}）`).toBe(true);
        }
        for (const id of site.weak ?? []) {
          const own = termById.get(id)!.nerve ?? "";
          expect(own.includes(name) && !cut.motor.includes(own), `${cut.id}/${site.id}: 弱まる筋 ${id}（${own}）`).toBe(true);
        }
      }
    }
  });

  it("先の所で切ると、止まる筋は上で切るときより少ない（上で分かれる枝の筋は残る）", () => {
    for (const cut of NERVE_CUTS) {
      const top = new Set([...cut.sites[0].lost, ...(cut.sites[0].weak ?? [])].flatMap(elementsOf));
      for (const site of cut.sites.slice(1)) {
        for (const id of site.lost) for (const element of elementsOf(id)) expect(top.has(element), `${cut.id}/${site.id}: ${id}`).toBe(true);
        expect(site.lost.flatMap(elementsOf).length).toBeLessThanOrEqual(cut.sites[0].lost.flatMap(elementsOf).length);
      }
    }
  });

  it("切る所の名前と ID は神経の中で重ならない", () => {
    for (const cut of NERVE_CUTS) {
      expect(new Set(cut.sites.map((site) => site.id)).size).toBe(cut.sites.length);
      expect(new Set(cut.sites.map((site) => site.ja)).size).toBe(cut.sites.length);
    }
    expect(new Set(NERVE_CUTS.map((cut) => cut.id)).size).toBe(NERVE_CUTS.length);
  });
});

describe("当てる問い", () => {
  const seeded = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  it("4つの選択肢に答えが1つ。選択肢は重ならず、まず答えと同じ体の部分から", () => {
    const questions = cutQuestions(10, seeded(7));
    expect(questions).toHaveLength(10);
    for (const question of questions) {
      expect(question.choices).toHaveLength(4);
      expect(new Set(question.choices).size).toBe(4);
      expect(question.choices.filter((choice) => choice === question.cut)).toHaveLength(1);
      expect(question.choices.every((choice) => choice.region === question.cut.region)).toBe(true);
    }
  });

  it("10問では同じ神経をくり返さない（神経は19本）", () => {
    const questions = cutQuestions(10, seeded(3));
    expect(new Set(questions.map((question) => question.cut.id)).size).toBe(10);
  });

  it("体の部分を選ぶと、その部分の神経だけ", () => {
    const questions = cutQuestions(8, seeded(11), "lower");
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) expect(question.cut.region).toBe("lower");
  });
});
