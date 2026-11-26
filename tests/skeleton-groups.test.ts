import indexJson from "../public/models/index.json";
import { pins, termById, terms } from "../src/content";
import { landmarkAt, nearbyLandmarks, nestedLandmarks } from "../src/landmarks";
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

  it("自由上肢骨は片側30個（左右60）と手の種子骨で、上肢帯と合わせると上肢の骨64本と種子骨", () => {
    const free = elementsOf("bones-of-free-upper-limb");
    const sesamoid = elementsOf("sesamoid-bones-of-hand");
    expect(free.size - sesamoid.size).toBe(60);
    expect(sorted(elementsOf("bones-of-free-upper-limb", "pectoral-girdle"))).toEqual(sorted(elementsOf(...piecesOf("upper"), "sesamoid-bones-of-hand")));
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

  it("種子骨は膝蓋骨・豆状骨と、手（母指の付け根に2個）と足（母趾の付け根に2個）の種子骨", () => {
    expect(sorted(elementsOf("sesamoid-bones"))).toEqual(sorted(elementsOf("patella", "pisiform", "sesamoid-bones-of-foot", "sesamoid-bones-of-hand")));
    // 手の種子骨は模式の形（scripts/sesamoid/hand.mjs）で、左右の橈側・尺側の4個。骨格の GLB に入る
    expect(elementsOf("sesamoid-bones-of-hand").size).toBe(4);
    expect(index.terms["sesamoid-bones-of-hand"]?.system).toBe("skeletal");
    expect(termById.get("sesamoid-bones-of-hand")?.schematic).toBe(true);
    // 206本（わたしの標本）には数えない
    expect(SPECIMEN_PIECES.some((item) => item.term.startsWith("sesamoid"))).toBe(false);
  });
});

/**
 * 骨学実習の手引きにあって語の無かった変異の骨（docs/設計.md「手引きにあって語の無かった骨」）。3Dに形が無いので、現れる場所をピンで示す。
 * 同じ所のふつうの部位（ラムダ縫合・プテリオンなど）とは4択に並べず、3Dをタップしたときはふつうの部位を選ぶ
 */
describe("変異の骨のピン", () => {
  const VARIANTS = ["sutural-bones", "fontanelle-bones", "interparietal-bone", "inca-bone", "epipteric-bone", "parietal-notch-bone", "bipartite-zygomatic-bone", "incisive-bone", "cervical-rib", "lumbar-rib"];
  const SAME_PLACE: [string, string][] = [
    ["sutural-bones", "lambdoid-suture"],
    ["fontanelle-bones", "bregma"],
    ["fontanelle-bones", "lambda"],
    ["epipteric-bone", "pterion"],
    ["parietal-notch-bone", "squamous-suture"],
  ];
  const term = (id: string) => termById.get(id)!;

  it.each(VARIANTS)("%s は骨の部位で、ピンがある", (id) => {
    expect(term(id).of).toBeTruthy();
    expect(pins[id]?.at.length).toBeGreaterThan(0);
  });

  it.each(SAME_PLACE)("%s と %s は4択に並ばず、その点をタップするとふつうの部位を選ぶ", (variant, usual) => {
    expect(nestedLandmarks(term(variant), term(usual))).toBe(true);
    expect(nearbyLandmarks(usual)).not.toContain(variant);
    // アプリ（src/ui/context.ts の termAt など）と同じく語の並び順で候補を渡す。同じ近さなら先に並ぶふつうの部位になる
    const candidates = terms.filter((other) => other.id === variant || other.id === usual);
    expect(candidates[0].id).toBe(usual);
    for (const point of pins[usual].at) expect(landmarkAt(point as [number, number, number], candidates)?.id).toBe(usual);
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
    ["日本骨", "bipartite-zygomatic-bone"],
    ["肋硬骨", "ribs"],
    ["鼓室骨", "tympanic-part-of-temporal-bone"],
    ["顎間骨", "incisive-bone"],
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
