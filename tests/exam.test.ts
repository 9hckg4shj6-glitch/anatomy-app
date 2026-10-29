import "fake-indexeddb/auto";
import * as THREE from "three";
import { termById } from "../src/content";
import {
  annotateRating, checkBlank, clozeRating, directionOf, essayRating, examByKey, examCountOf, examFacets, examFacetsOf, examItems, examItemsOf, examKey,
  examProgress, isExamKey, labelRating, markAnswers, nextExamItems, normalizeJapanese, orientQuestion, parseCloze, perpendicularDirections, viewFrom,
  contrastStatements, orderMistakes, orderRating, traceRating, SORT_KINDS,
  type ClozeItem, type DrawingItem, type PairItem, type SequenceItem,
} from "../src/exam";
import { drawingUp } from "../src/landmarks";
import { Rating, nextSchedule } from "../src/fsrs";
import { buildQueue, facetsFor } from "../src/study";

describe("骨学試験の内容", () => {
  it("穴埋めの文はどれも空欄があり、語の空欄は語につながる", () => {
    const cloze = examItems.filter((item): item is ClozeItem => item.kind === "a");
    expect(cloze.length).toBeGreaterThan(100);
    for (const item of cloze) {
      expect(item.blanks.length).toBeGreaterThan(0);
      for (const blank of item.blanks) if (blank.term) expect(termById.has(blank.term)).toBe(true);
      // 文と空欄の番号を戻すと、空欄の数だけ番号がある
      expect(item.parts.filter((part) => typeof part === "number")).toHaveLength(item.blanks.length);
    }
  });

  it("空欄を文字列と番号に分ける。語の空欄は区別の（）を除いた名前を答えとして見せる", () => {
    const { parts, blanks } = parseCloze("仙骨の{auricular-surface-of-sacrum}は第{=2|二}肋軟骨");
    expect(parts).toEqual(["仙骨の", 0, "は第", 1, "肋軟骨"]);
    expect(blanks[0].display).toBe("耳状面");
    expect(blanks[0].answers).toContain("耳状面（仙骨）");
    expect(blanks[1]).toEqual({ answers: ["2", "二"], display: "2" });
  });

  it("出た回数の多い順に並べ、学んだ項目を飛ばして次を出す", () => {
    const list = examItemsOf("a");
    for (let i = 1; i < list.length; i++) expect(list[i - 1].count).toBeGreaterThanOrEqual(list[i].count);
    const next = nextExamItems("a", new Set([list[0].key]), 3);
    expect(next.map((item) => item.key)).toEqual(list.slice(1, 4).map((item) => item.key));
    expect(nextExamItems("b", new Set(), 5, "general").every((item) => item.area === "general")).toBe(true);
  });

  it("語ごとの試験に出た回数（A・B・C の合計）", () => {
    expect(examCountOf("supracristal-line")).toBeGreaterThanOrEqual(12);
    expect(examCountOf("clavicle")).toBeGreaterThan(0);
    expect(examCountOf("liver")).toBe(0);
  });
});

describe("答え合わせ", () => {
  const answers = ["耳状面（仙骨）", "耳状面", "じじょうめん", "auricular surface", "facies auricularis"];

  it("日本語・読み（カタカナでも）・英語・ラテン語のどれでも正解", () => {
    expect(checkBlank("耳状面", answers)).toBe("correct");
    expect(checkBlank("じじょうめん", answers)).toBe("correct");
    expect(checkBlank("ジジョウメン", answers)).toBe("correct");
    expect(checkBlank("Auricular surface", answers)).toBe("correct");
    expect(checkBlank("facies auricularis", answers)).toBe("correct");
    expect(checkBlank("耳状面(仙骨)", answers)).toBe("correct");
  });

  it("英字の1文字違いは惜しい。日本語は違えば不正解。空は不正解", () => {
    expect(checkBlank("auricular surfase", answers)).toBe("close");
    expect(checkBlank("関節面", answers)).toBe("wrong");
    expect(checkBlank("  ", answers)).toBe("wrong");
  });

  it("異体字（頸・鉤・靭）と全角数字をそろえる", () => {
    expect(normalizeJapanese("頸静脈孔")).toBe(normalizeJapanese("頚静脈孔"));
    expect(checkBlank("有鉤骨", ["有鈎骨"])).toBe("correct");
    expect(checkBlank("円錐靭帯結節", ["円錐靱帯結節"])).toBe("correct");
    expect(checkBlank("７", ["7", "七"])).toBe("correct");
  });

  it("穴埋めの文は、全部正解で Good、1文字違いか（空欄3つ以上で）1つだけまちがいで Hard、ほかは Again", () => {
    expect(clozeRating(["correct", "correct"])).toBe(Rating.Good);
    expect(clozeRating(["correct", "close"])).toBe(Rating.Hard);
    expect(clozeRating(["correct", "correct", "wrong"])).toBe(Rating.Hard);
    expect(clozeRating(["correct", "wrong"])).toBe(Rating.Again);
    expect(clozeRating(["wrong", "wrong", "correct"])).toBe(Rating.Again);
  });

  it("短文記述は、要点を全部で Good、半分以上で Hard、それ未満で Again", () => {
    expect(essayRating(3, 3)).toBe(Rating.Good);
    expect(essayRating(2, 4)).toBe(Rating.Hard);
    expect(essayRating(1, 3)).toBe(Rating.Again);
  });
});

describe("骨学試験の記録と復習", () => {
  const now = new Date("2026-11-01T09:00:00Z");

  it("記録のIDは exam:種類:ID で、語の問い方には混ざらない", () => {
    const key = examKey("b", "clavicle");
    expect(isExamKey(key)).toBe(true);
    expect(examByKey.get(key)?.kind).toBe("b");
    expect(facetsFor(termById.get("clavicle"))).not.toContain("spell");
  });

  it("B は最初にラ→日を解くと、日→英・ラが新しい問い方として復習に出る", () => {
    const key = examKey("b", "clavicle");
    const first = nextSchedule(undefined, key, "read", Rating.Good, now);
    const queue = buildQueue([{ termId: key, unitId: "exam-b", learnedAt: now.toISOString() }], [first], now, 10, () => examFacets.b);
    expect(queue).toEqual([{ termId: key, facet: "spell", isNew: true }]);
  });

  it("進み具合は学んだ数と覚え具合の平均", () => {
    const item = examItemsOf("c")[0];
    const schedule = nextSchedule(undefined, item.key, "explain", Rating.Good, now);
    const progress = examProgress("c", new Set([item.key]), [schedule], new Date(now.getTime() + 86_400_000));
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(examItemsOf("c").length);
    expect(progress.mastery).toBeGreaterThan(0.8);
  });
});

describe("骨学試験 D（図示）", () => {
  const drawings = examItems.filter((item): item is DrawingItem => item.kind === "d");

  it("図の番号はどれも名前と英語があり、点は書いた点かピン（無ければ骨の語の中心を3Dで決める）", () => {
    expect(drawings.length).toBeGreaterThan(25);
    for (const item of drawings) {
      for (const mark of item.marks) {
        expect(mark.ja && mark.en).toBeTruthy();
        if (!mark.at) expect(termById.get(mark.term!)?.system).toBe("skeletal");
        // ピンや骨の語の中心から取った点だけ、手前の骨の面へ移す
        if (mark.project) expect(mark.term).toBe(mark.project);
      }
    }
  });

  it("「図に書き込む」は番号→名前を覚えてから、「骨と向き」は向きを書いた図だけ", () => {
    const humerus = examByKey.get(examKey("d", "humerus-ant"))!;
    expect(examFacetsOf(humerus)).toEqual(["label", "orient"]);
    expect(examFacetsOf(humerus, true)).toEqual(["label", "annotate", "orient"]);
    expect(examFacetsOf(examByKey.get(examKey("d", "humerus-post"))!, true)).toEqual(["label", "annotate"]);
    expect(examFacetsOf(examItemsOf("c")[0])).toEqual(["explain"]);
  });

  it("画面の上の向きは 3D 表示（three.js の回転）と同じ", () => {
    for (const view of ["ant", "post", "lat", "med", "sup", "inf"] as const) {
      for (const roll of [0, 90, 180, 270]) {
        const from = viewFrom(view, "left");
        const toward = new THREE.Vector3(...from).normalize();
        const up = new THREE.Vector3(0, 1, 0).addScaledVector(toward, -toward.y);
        if (up.lengthSq() < 1e-6) up.set(0, 0, 1);
        up.normalize().applyAxisAngle(toward.clone().negate(), THREE.MathUtils.degToRad(roll));
        drawingUp(from, roll).forEach((value, i) => expect(value).toBeCloseTo(up.getComponent(i), 6));
      }
    }
  });

  it("骨の向き: 上を上にして前から見れば上、逆さなら下。内側・外側は左右の骨で逆", () => {
    expect(directionOf(drawingUp(viewFrom("ant"), 0), "right")).toBe("sup");
    expect(directionOf(drawingUp(viewFrom("ant"), 180), "right")).toBe("inf");
    // 上から見ると画面の上は前（真上からは少し後ろから見る）
    expect(directionOf(drawingUp(viewFrom("sup"), 0), "right")).toBe("ant");
    expect(directionOf([1, 0, 0], "right")).toBe("med");
    expect(directionOf([1, 0, 0], "left")).toBe("lat");
    // 横に回すと内側か外側。左右の骨で前から見た向きを折り返すと、同じ回し方で同じ答えになる
    const right = directionOf(drawingUp(viewFrom("ant", "right"), 90), "right");
    expect(["med", "lat"]).toContain(right);
    expect(directionOf(drawingUp(viewFrom("post", "left"), 90), "left")).not.toBe("sup");
    expect(perpendicularDirections("lat")).toEqual(["sup", "inf", "ant", "post"]);
  });

  it("骨と向きの問題の正解は、選んだ左右・面・回し方から決まる", () => {
    const item = examByKey.get(examKey("d", "femur-ant")) as DrawingItem;
    const values = [0.7, 0.3, 0.6];
    let i = 0;
    const question = orientQuestion(item, () => values[i++ % values.length]);
    expect(question.side).toBe("left");
    expect(item.orient).toContain(question.view);
    expect(question.up).toBe(directionOf(drawingUp(viewFrom(question.view, "left"), question.roll), "left"));
  });

  it("番号→名前の判定と、図に書き込んだ数の自己採点", () => {
    expect(labelRating(["correct", "correct"])).toBe(Rating.Good);
    expect(labelRating(["correct", "close"])).toBe(Rating.Hard);
    expect(labelRating(["correct", "correct", "correct", "wrong"])).toBe(Rating.Hard);
    expect(labelRating(["correct", "wrong"])).toBe(Rating.Again);
    expect(annotateRating(8, 10)).toBe(Rating.Good);
    expect(annotateRating(5, 10)).toBe(Rating.Hard);
    expect(annotateRating(4, 10)).toBe(Rating.Again);
    const mark = (examByKey.get(examKey("d", "orbit-ant")) as DrawingItem).marks.find((m) => !m.term)!;
    expect(markAnswers(mark).ja).toContain("小翼");
    expect(checkBlank("ala minor ossis sphenoidalis", markAnswers(mark).en)).toBe("correct");
  });
});

describe("骨学試験 整理して覚える（対・数と並び・体表の目安）", () => {
  const random = () => 0.42;

  it("回数は、その語の出る A・B・C の項目から数え、語のカードの回数には足さない", () => {
    const pair = examByKey.get(examKey("p", "middle-fossa-foramina"))!;
    // 中頭蓋窩の孔の文（9回）と、棘孔の出る中硬膜動脈の溝の文（2回）など
    expect(pair.count).toBeGreaterThanOrEqual(11);
    const mentions = (item: (typeof examItems)[number]) =>
      item.kind === "a" ? item.blanks.some((b) => b.term === "foramen-ovale") : (item.kind === "b" || item.kind === "c") && item.term === "foramen-ovale";
    expect(examCountOf("foramen-ovale")).toBe(examItems.filter(mentions).reduce((sum, item) => sum + item.count, 0));
    for (const kind of SORT_KINDS) expect(examItemsOf(kind).length).toBeGreaterThan(5);
  });

  it("対で覚える: 文は6つまでで、どれも並べた語の1つのもの", () => {
    for (const item of examItemsOf("p") as PairItem[]) {
      const statements = contrastStatements(item, random);
      expect(statements.length).toBeLessThanOrEqual(6);
      expect(statements.length).toBeGreaterThanOrEqual(item.terms.length * Math.min(item.rows.length, Math.floor(6 / item.terms.length)));
      for (const statement of statements) expect(item.terms).toContain(statement.term);
    }
    const notches = examByKey.get(examKey("p", "radius-ulna-notches")) as PairItem;
    const facts = contrastStatements(notches, random);
    expect(facts.find((fact) => fact.text === "下橈尺関節")?.term).toBe("ulnar-notch-of-radius");
  });

  it("並べる問題は隣どうしの入れかえ1回で Hard、すべて選ぶ問題は余分と足りない語を数える", () => {
    const members = ["scaphoid", "lunate", "triquetrum", "pisiform"];
    expect(orderMistakes(members, members, true)).toBe(0);
    expect(orderMistakes(["lunate", "scaphoid", "triquetrum", "pisiform"], members, true)).toBe(1);
    expect(orderMistakes(["pisiform", "triquetrum", "lunate", "scaphoid"], members, true)).toBe(3);
    expect(orderMistakes(["scaphoid", "lunate", "triquetrum"], members, true)).toBe(1);
    expect(orderMistakes(["pisiform", "lunate", "scaphoid", "triquetrum"], members, false)).toBe(0);
    expect(orderMistakes(["lunate", "scaphoid", "hamate"], members, false)).toBe(3);
    expect(orderRating(0, 4)).toBe(Rating.Good);
    expect(orderRating(1, 4)).toBe(Rating.Hard);
    expect(orderRating(1, 2)).toBe(Rating.Again);
    expect(orderRating(2, 8)).toBe(Rating.Again);
    expect([traceRating(0), traceRating(1), traceRating(2)]).toEqual([Rating.Good, Rating.Hard, Rating.Again]);
  });

  it("「3Dで押す」は図のある項目で、並べる・選ぶを覚えてから。体表の目安は高さ→目安も出る", () => {
    const carpals = examByKey.get(examKey("s", "carpal-proximal")) as SequenceItem;
    expect(examFacetsOf(carpals)).toEqual(["order"]);
    expect(examFacetsOf(carpals, true)).toEqual(["order", "trace"]);
    expect(examFacetsOf(examByKey.get(examKey("s", "orbit-bones"))!, true)).toEqual(["order"]);
    expect(examFacetsOf(examByKey.get(examKey("l", "sternal-angle"))!)).toEqual(["level", "landmark"]);
    expect(examFacetsOf(examByKey.get(examKey("p", "malleoli"))!)).toEqual(["contrast"]);
  });

  it("体表の目安の答えはどれも違う（高さ→目安の問題で正解が1つに決まる）", () => {
    const levels = examItemsOf("l");
    expect(new Set(levels.map((item) => item.kind === "l" && item.answer)).size).toBe(levels.length);
  });

  it("並べる問題を学ぶと、復習で「並べる・選ぶ」が新しく出る", () => {
    const now = new Date("2026-11-01T09:00:00Z");
    const key = examKey("s", "carpal-proximal");
    const queue = buildQueue([{ termId: key, unitId: "exam-s", learnedAt: now.toISOString() }], [], now, 10, () => examFacetsOf(examByKey.get(key)!));
    expect(queue).toEqual([{ termId: key, facet: "order", isNew: true }]);
  });
});
