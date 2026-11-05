import { BODY_DIRECTIONS, DIRECTIONS, pins, termById, terms } from "../src/content";

describe("向きの問い方（content/directions.json）", () => {
  it("答えの向きは方向の用語で、比べる語がある", () => {
    const facts = terms.filter((term) => term.toward);
    expect(facts.length).toBeGreaterThanOrEqual(60);
    for (const term of facts) {
      expect(term.toward!.at ? BODY_DIRECTIONS : DIRECTIONS).toContain(term.toward!.dir);
      expect(termById.get(term.toward!.than)).toBeTruthy();
    }
    expect(DIRECTIONS.map((id) => termById.get(id)?.ja)).toEqual(["上", "下", "前", "後", "内側", "外側"]);
    expect(BODY_DIRECTIONS.map((id) => termById.get(id)?.ja)).toEqual(["上", "下", "前", "後", "内側", "外側", "右", "左"]);
  });

  it("臓器・血管・神経・筋の組は比べた2つの位置を持ち、右・左は骨どうしでは使わない", () => {
    const body = terms.filter((term) => term.toward?.at);
    expect(body.length).toBeGreaterThanOrEqual(45);
    for (const term of terms.filter((term) => term.toward)) {
      const bones = term.system === "skeletal" && termById.get(term.toward!.than)!.system === "skeletal";
      if (bones) expect(["right", "left"]).not.toContain(term.toward!.dir);
      else expect(term.toward!.at).toHaveLength(2);
    }
  });

  it("腹大動脈は下大静脈の左、食道は気管の後ろ、左心房は食道の前（解剖学的正位で本人から見て）", () => {
    expect(termById.get("abdominal-aorta")?.toward).toMatchObject({ than: "inferior-vena-cava", dir: "left" });
    expect(termById.get("esophagus")?.toward).toMatchObject({ than: "trachea", dir: "posterior" });
    expect(termById.get("left-atrium")?.toward).toMatchObject({ than: "esophagus", dir: "anterior" });
    // 本人の右は x < 0（腹大動脈の位置は下大静脈より x が大きい）
    const [aorta, cava] = termById.get("abdominal-aorta")!.toward!.at!;
    expect(aorta[0]).toBeGreaterThan(cava[0]);
  });

  it("大腿骨頭は大転子の内側、橈骨は尺骨の外側（解剖学的正位）", () => {
    expect(termById.get("head-of-femur")?.toward).toMatchObject({ than: "greater-trochanter", dir: "medial" });
    expect(termById.get("radius")?.toward).toMatchObject({ than: "ulna", dir: "lateral" });
  });

  it("後顆間区のピンは脛骨の上端（前顆間区と同じ高さ）にある", () => {
    const y = (id: string) => pins[id].at[0][1];
    expect(Math.abs(y("posterior-intercondylar-area") - y("anterior-intercondylar-area"))).toBeLessThan(0.02);
    expect(pins["posterior-intercondylar-area"].at[0][2]).toBeLessThan(pins["anterior-intercondylar-area"].at[0][2]);
  });
});

describe("方向の用語", () => {
  it("右・左と手足の向きの用語がある", () => {
    for (const id of ["right", "left", "palmar", "dorsal", "plantar", "radial", "ulnar", "tibial", "fibular"]) {
      expect(termById.get(id)?.system).toBe("basics");
      expect(termById.get(id)?.figure?.arrows?.length).toBeGreaterThan(0);
    }
  });

  it("左右のある大きな骨には置き方がある", () => {
    for (const id of ["clavicle", "scapula", "humerus", "radius", "ulna", "hip-bone", "femur", "patella", "tibia", "fibula", "talus", "calcaneus"]) {
      expect(termById.get(id)?.placing).toBeTruthy();
    }
  });
});
