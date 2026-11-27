import {
  buildTiles, etymByKey, etymFacetsOf, etymKey, etymLessons, etymOfTerm, etymWords, isBuilt, isEtymKey, jaSegments, readChoices, relatedWords, wordSegments,
  ETYM_FACETS,
} from "../src/etym";
import { buildQueue, FACETS, facetLabels } from "../src/study";

const word = (termId: string) => etymOfTerm(termId)!;

/** くり返し同じ並びになる乱数（テストで選択肢を決めるため） */
function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

describe("語源で単語", () => {
  it("どの語も、英語名を部品に分けると部品の並びになり、つなぐと元の名前に戻る", () => {
    for (const item of etymWords) {
      const segments = wordSegments(item);
      expect(segments.map((segment) => segment.text).join("")).toBe(item.word);
      expect(segments.filter((segment) => segment.part !== null).map((segment) => segment.text.toLowerCase()))
        .toEqual(item.parts.map((part) => part.text.toLowerCase()));
    }
  });

  it("日本語名の字に部品を割り当てる（長い字から順に、重ならない所へ）", () => {
    const scm = word("sternocleidomastoid");
    expect(jaSegments(scm.term.ja, scm.parts)).toEqual([
      { text: "胸", part: 0 }, { text: "鎖", part: 1 }, { text: "乳突", part: 2 }, { text: "筋", part: null },
    ]);
    // 下唇下制筋: depressor「下制」を先に取り、inferioris「下」は残った頭の「下」へ
    const dli = word("depressor-labii-inferioris");
    expect(jaSegments(dli.term.ja, dli.parts)).toEqual([
      { text: "下", part: 2 }, { text: "唇", part: 1 }, { text: "下制", part: 0 }, { text: "筋", part: null },
    ]);
    for (const item of etymWords) {
      const segments = jaSegments(item.term.ja, item.parts);
      expect(segments.map((segment) => segment.text).join("")).toBe(item.term.ja);
      // 字を書いた部品は、どれも日本語名のどこかに色が付く
      const colored = new Set(segments.flatMap((segment) => (segment.part === null ? [] : [segment.part])));
      item.parts.forEach((part, i) => expect(!part.kanji || colored.has(i)).toBe(true));
    }
  });

  it("部品が1つの語は「部品から読む」だけ、2つ以上なら「部品で組み立てる」も", () => {
    expect(etymFacetsOf(word("coccyx"))).toEqual(["etymRead"]);
    expect(etymFacetsOf(word("biceps-brachii"))).toEqual(ETYM_FACETS);
    expect(ETYM_FACETS.every((facet) => FACETS.includes(facet) && facetLabels[facet])).toBe(true);
  });

  it("記録のキーは etym:<語ID> で、語と同じ復習の列に「読む」「組み立てる」の順で入る", () => {
    const key = etymKey("sternocleidomastoid");
    expect(isEtymKey(key)).toBe(true);
    expect(etymByKey.get(key)?.term.id).toBe("sternocleidomastoid");
    const queue = buildQueue([{ termId: key, unitId: "etym-neck", learnedAt: "2026-11-20T00:00:00Z" }], [], new Date("2026-11-27T00:00:00Z"), 10,
      (id) => etymFacetsOf(etymByKey.get(id)!));
    expect(queue.map((item) => item.facet)).toEqual(["etymRead", "etymBuild"]);
  });

  it("同じ部品の語は、特徴のある部品を共有する語を先に出す", () => {
    const related = relatedWords(word("sternohyoid")).slice(0, 4).map((item) => item.term.id);
    expect(related).toEqual(expect.arrayContaining(["sternothyroid"]));
    expect(related.every((id) => /sterno|hyoid/.test(etymOfTerm(id)!.word))).toBe(true);
  });

  it("部品から読む問題の選択肢は、正解を含む日本語名の違う4つで、部品を共有する語を入れる", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const item = word("sternohyoid");
      const choices = readChoices(item, seeded(seed));
      expect(choices).toHaveLength(4);
      expect(choices).toContain(item.key);
      expect(new Set(choices.map((key) => etymByKey.get(key)!.term.ja)).size).toBe(4);
      expect(choices.some((key) => key !== item.key && /sterno|hyoid/.test(etymByKey.get(key)!.word))).toBe(true);
    }
  });

  it("組み立てる問題の部品は、正解の部品と、正解と違うつづりのまぎらわしい部品", () => {
    for (const item of etymWords.filter((other) => other.parts.length > 1)) {
      const tiles = buildTiles(item, seeded(7));
      const lower = tiles.map((text) => text.toLowerCase());
      expect(new Set(lower).size).toBe(tiles.length);
      expect(item.parts.every((part) => lower.includes(part.text.toLowerCase()))).toBe(true);
      expect(tiles.length).toBe(item.parts.length + Math.max(3, 6 - item.parts.length));
    }
    const apl = word("abductor-pollicis-longus");
    expect(isBuilt(apl, ["abductor", "pollicis", "longus"])).toBe(true);
    expect(isBuilt(apl, ["abductor", "pollicis", "brevis"])).toBe(false);
    expect(isBuilt(apl, ["pollicis", "abductor", "longus"])).toBe(false);
  });

  it("レッスンは6〜12語で、どの語も1回だけ入る", () => {
    expect(etymLessons.every((lesson) => lesson.words.length >= 6 && lesson.words.length <= 12)).toBe(true);
    const ids = etymWords.map((item) => item.term.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("由来を空にした部品は、同じつづりの部品の由来を使う", () => {
    const parts = etymWords.flatMap((item) => item.parts);
    const known = new Set(parts.filter((part) => part.from).map((part) => part.text.toLowerCase()));
    expect(parts.filter((part) => known.has(part.text.toLowerCase())).every((part) => part.from)).toBe(true);
  });
});
