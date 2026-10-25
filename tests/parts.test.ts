// @ts-expect-error 型定義の無いビルド用スクリプト
import { baseName, resolveParts } from "../scripts/build-models.mjs";

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
