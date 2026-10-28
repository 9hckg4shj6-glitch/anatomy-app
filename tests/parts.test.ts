// @ts-expect-error 型定義の無いビルド用スクリプト
import { attachedBones } from "../scripts/attach-bones.mjs";
// @ts-expect-error 型定義の無いビルド用スクリプト
import { baseName, resolveParts } from "../scripts/build-models.mjs";
// @ts-expect-error 型定義の無いビルド用スクリプト
import { splitMesh } from "../scripts/split-mesh.mjs";
// @ts-expect-error 型定義の無いビルド用スクリプト
import { anchorPairs } from "../scripts/za/warp.mjs";

const elements = new Map([
  ["FJ1", "Left humerus"],
  ["FJ2", "Right humerus"],
  ["FJ3", "Cavity of left atrium"],
  ["FJ4", "Cavity of right atrium"],
  ["FJ5", "First metacarpal bone"],
  ["FJ6", "Fifth metacarpal bone"],
  ["FJ7", "Right anterior segmental artery"],
]);
const concepts = new Map([["FMA7309", new Set(["FJ7", "FJ99"])]]);
const resolve = (parts: string[]) => resolveParts([{ id: "t", parts }], elements, concepts);

describe("部品の指定", () => {
  it("左右を外して比べる", () => {
    expect(baseName("Acromial part of right deltoid")).toBe("acromial part of deltoid");
    expect(resolve(["humerus"]).resolved.get("t")).toEqual(["FJ1", "FJ2"]);
  });

  it("指定に左右があれば左右込みで比べる", () => {
    expect(resolve(["cavity of right atrium"]).resolved.get("t")).toEqual(["FJ4"]);
  });

  it("* と概念IDが使え、概念IDは実在する部品だけに展開する", () => {
    expect(resolve(["* metacarpal bone"]).resolved.get("t")).toEqual(["FJ5", "FJ6"]);
    expect(resolve(["FMA7309"]).resolved.get("t")).toEqual(["FJ7"]);
  });

  it("! で除き、当たらない指定は誤りにする", () => {
    expect(resolve(["humerus", "!FJ1"]).resolved.get("t")).toEqual(["FJ2"]);
    expect(resolve(["femur"]).errors).toHaveLength(1);
    expect(resolve(["humerus", "!FJ5"]).errors).toHaveLength(1);
  });
});

describe("Z-Anatomy の部品", () => {
  const za = new Map([
    ["ZA_Latissimus_dorsi_muscler", "right latissimus dorsi muscle"],
    ["ZA_Latissimus_dorsi_musclel", "left latissimus dorsi muscle"],
    ["ZA_Superior_lobe_of_right_lung", "superior lobe of right lung"],
  ]);
  const resolveZa = (parts: string[]) => resolveParts([{ id: "t", parts }], elements, concepts, za);

  it("za: は Z-Anatomy の形だけから探し、左右の扱いは BodyParts3D と同じ", () => {
    expect(resolveZa(["za:latissimus dorsi muscle"]).resolved.get("t")).toEqual(["ZA_Latissimus_dorsi_muscler", "ZA_Latissimus_dorsi_musclel"].sort());
    expect(resolveZa(["za:*lobe of right lung"]).resolved.get("t")).toEqual(["ZA_Superior_lobe_of_right_lung"]);
    expect(resolveZa(["za:humerus"]).errors).toHaveLength(1);
    expect(resolveZa(["humerus", "za:latissimus dorsi muscle"]).resolved.get("t")).toHaveLength(4);
  });

  it("骨の名前の書き方の違い（椎骨・肋軟骨・指の骨・左右）を合わせて組にする", () => {
    const bp = new Map([
      ["FJ10", "Fifth cervical vertebra"],
      ["FJ11", "Right fifth costal cartilage"],
      ["FJ12", "Distal phalanx of right little finger"],
      ["FJ13", "Right humerus"],
      ["FJ14", "Navicular bone of right foot"],
    ]);
    const bone = (name: string, side: string | null = null) => ({ file: "SkeletalSystem100", parent: null, name, side });
    const pairs = anchorPairs([
      bone("vertebra c5"),
      bone("right costal cartilage of fifth rib", "right"),
      bone("right distal phalanx of fifth finger of hand", "right"),
      bone("right humerus", "right"),
      bone("right navicular bone", "right"),
      { ...bone("right deltoid muscle", "right"), file: "MuscularSystem100" },
    ], bp);
    expect(pairs.map((p: { bp: string[] }) => p.bp[0])).toEqual(["FJ10", "FJ11", "FJ12", "FJ13", "FJ14"]);
  });
});

describe("形を平面で分ける", () => {
  // 1辺 1 の立方体（面は外向き・反時計回り）
  const corners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
  const cube = {
    positions: new Float32Array(corners.flat()),
    normals: new Float32Array(corners.flatMap((c) => c.map((v) => v - 0.5))),
    indices: new Uint32Array(faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])),
  };
  // 符号付き体積（面が外向きなら正、穴があれば閉じない分ずれる）
  const volume = ({ positions: p, indices: t }: { positions: Float32Array; indices: Uint32Array }) => {
    let sum = 0;
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3];
      sum += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return sum / 6;
  };

  it("上と下に分け、切り口をふさぐ", () => {
    const { above, below } = splitMesh(cube, [0, 1, 0], 0.25);
    expect(volume(above)).toBeCloseTo(0.75);
    expect(volume(below)).toBeCloseTo(0.25);
    expect(above.bounds[0][1]).toBeCloseTo(0.25);
    expect(below.bounds[1][1]).toBeCloseTo(0.25);
  });
});

describe("付着面が乗っている1本ずつの骨", () => {
  // 第1肋骨（y = 0 の高さ）と第2肋骨（y = 0.03）を、点が3つの小さな形で表す
  const shape = (y: number) => ({ positions: new Float32Array([0, y, 0, 0.05, y, 0, 0.1, y, 0]), bounds: [[0, y, 0], [0.1, y, 0]] });
  const shapes: Record<string, ReturnType<typeof shape>> = { FJ1: shape(0), FJ2: shape(0.03) };
  // 部位の語は親の骨と同じ部品。representative は代表の1本（第2肋骨）の上に置いた部位
  const index = { terms: {
    ribs: { elements: ["FJ1", "FJ2"] }, "first-rib": { elements: ["FJ1"] }, "second-rib": { elements: ["FJ2"] },
    tubercle: { elements: ["FJ1", "FJ2"] }, representative: { elements: ["FJ2"] },
  } };
  const terms = [
    { id: "ribs", system: "skeletal" },
    { id: "first-rib", system: "skeletal" },
    { id: "second-rib", system: "skeletal" },
    { id: "tubercle", system: "skeletal", of: "ribs" },
    { id: "representative", system: "skeletal", of: "ribs" },
    { id: "muscle", system: "muscular", nerve: "肋間神経", insertionAt: ["tubercle"], originAt: ["representative"] },
  ];
  const run = (spots: object, pins: object = {}) => attachedBones(index, terms, (id: string) => shapes[id], { pins, spots: [spots] });

  it("まとめた骨の語に付いた付着面を、いちばん近い部品の1本ずつの骨にする", () => {
    expect(run({ muscle: { origin: [["ribs", 0.05, 0.028, 0, 0.008]] } })).toEqual({ "muscle@origin": ["second-rib"] });
  });

  it("起始・停止の骨の部位のピンも、乗っている1本を求める（代表の1本の上に置いた部位は使わない）", () => {
    const pins = { tubercle: { at: [[0.09, 0.002, 0]], r: 0.005 }, representative: { at: [[0.09, 0.03, 0]], r: 0.005 } };
    expect(run({}, pins)).toEqual({ "muscle@insertion": ["first-rib"] });
  });
});
