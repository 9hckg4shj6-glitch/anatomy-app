import indexJson from "../public/models/index.json";
import { termById } from "../src/content";
import { lookup } from "../src/search";
import { SPECIMEN_PIECES } from "../src/specimen";

/**
 * 骨格系の見直し（docs/設計.md「全身の骨の点検」）: 206本の骨の語は src/specimen.ts と tests/specimen.test.ts で確かめる。
 * ここでは、骨を束ねる語（頭蓋・脳頭蓋・顔面頭蓋・脊柱・自由上肢骨・自由下肢骨・耳小骨）が、中の骨の3Dの部品をちょうど含むことと、
 * 教科書の別の呼び方（第7頚椎・頭蓋骨など）で骨の語を引けることを確かめる
 */
const index = indexJson as unknown as { terms: Record<string, { system: string; elements: string[] }> };
const elementsOf = (...ids: string[]) => new Set(ids.flatMap((id) => index.terms[id]?.elements ?? []));
const sorted = (set: Set<string>) => [...set].sort();
const piecesOf = (region: string) => SPECIMEN_PIECES.filter((item) => item.region === region).map((item) => item.term);

const NEURO = ["frontal-bone", "parietal-bone", "temporal-bone", "occipital-bone", "sphenoid-bone", "ethmoid-bone"];
const VISCERO = ["nasal-bone", "lacrimal-bone", "inferior-nasal-concha", "maxilla", "zygomatic-bone", "palatine-bone", "vomer", "mandible", "hyoid-bone"];

describe("骨を束ねる語", () => {
  it("頭蓋は脳頭蓋（6種8個）と顔面頭蓋（9種15個）を合わせた15種23個で、2つは重ならない", () => {
    expect(sorted(elementsOf("neurocranium"))).toEqual(sorted(elementsOf(...NEURO)));
    expect(sorted(elementsOf("viscerocranium"))).toEqual(sorted(elementsOf(...VISCERO)));
    expect(elementsOf("neurocranium").size).toBe(8);
    expect(elementsOf("viscerocranium").size).toBe(15);
    expect(sorted(elementsOf("skull"))).toEqual(sorted(elementsOf("neurocranium", "viscerocranium")));
    // 標本の「頭蓋と舌骨」と同じ骨
    expect(sorted(elementsOf("skull"))).toEqual(sorted(elementsOf(...piecesOf("skull"))));
  });

  it("脊柱は椎骨24・仙骨・尾骨をすべて含む（ほかは椎間円板だけ）", () => {
    const column = elementsOf("vertebral-column");
    const bones = elementsOf(...piecesOf("spine"));
    for (const element of bones) expect(column.has(element), element).toBe(true);
    const discs = elementsOf("intervertebral-disc");
    for (const element of column) expect(bones.has(element) || discs.has(element), element).toBe(true);
  });

  it("自由上肢骨は片側30個（左右60）で、上肢帯と合わせると上肢の骨64本", () => {
    expect(elementsOf("bones-of-free-upper-limb").size).toBe(60);
    expect(sorted(elementsOf("bones-of-free-upper-limb", "pectoral-girdle"))).toEqual(sorted(elementsOf(...piecesOf("upper"))));
  });

  it("自由下肢骨は片側30個（左右60）と足の種子骨で、寛骨と合わせると下肢の骨62本と種子骨", () => {
    const free = elementsOf("bones-of-free-lower-limb");
    const sesamoid = elementsOf("sesamoid-bones-of-foot");
    expect(free.size - sesamoid.size).toBe(60);
    expect(sorted(elementsOf("bones-of-free-lower-limb", "hip-bone"))).toEqual(sorted(elementsOf(...piecesOf("lower"), "sesamoid-bones-of-foot")));
  });

  it("耳小骨は左右のツチ骨・キヌタ骨・アブミ骨の6個", () => {
    expect(sorted(elementsOf("auditory-ossicles"))).toEqual(sorted(elementsOf("malleus", "incus", "stapes")));
    expect(elementsOf("auditory-ossicles").size).toBe(6);
  });
});

describe("骨の別の呼び方で引く", () => {
  it.each([
    ["第1頚椎", "atlas"],
    ["第2頚椎", "axis"],
    ["第7頚椎", "vertebra-prominens"],
    ["第７頸椎", "vertebra-prominens"],
    ["頭蓋骨", "skull"],
    ["背骨", "vertebral-column"],
    ["尾てい骨", "coccyx"],
    ["趾骨", "phalanges-foot"],
  ])("%s → %s", (query, id) => {
    const [first] = lookup(query, { all: true });
    expect(first?.term.id).toBe(id);
    expect(first?.via).toBe("jaAlt");
    expect(termById.get(id)?.jaAlt).toBeTruthy();
  });

  it("名前で当たる語は、別名で当たる語より先", () => {
    // 「頭蓋」は名前の語が先で、「頭蓋骨」の別名を持つ同じ語
    expect(lookup("頭蓋", { all: true })[0]?.term.id).toBe("skull");
    expect(lookup("頭蓋", { all: true })[0]?.via).toBe("ja");
  });
});
