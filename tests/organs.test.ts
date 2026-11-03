import * as THREE from "three";
import { organById, organOf, organOfUnit, organTerms } from "../src/content";
import { sceneFor } from "../src/ui/context";
// @ts-expect-error 型定義の無いビルド用スクリプト
import { partitionMesh } from "../scripts/split-mesh.mjs";

const mesh = (geometry: THREE.BufferGeometry) => {
  geometry.computeVertexNormals();
  return {
    positions: new Float32Array(geometry.getAttribute("position").array),
    normals: new Float32Array(geometry.getAttribute("normal").array),
    indices: new Uint32Array(geometry.index!.array),
  };
};

describe("臓器の場面", () => {
  it("心臓の場面に部屋・弁・大血管・表面の部位が入る", () => {
    const heart = organById.get("heart")!;
    const ids = organTerms(heart);
    for (const id of ["heart", "right-ventricle", "mitral-valve", "apex-of-heart", "ascending-aorta", "pulmonary-trunk"]) expect(ids).toContain(id);
    expect(ids).not.toContain("splenic-hilum");
    expect(organOf("left-atrium")?.id).toBe("heart");
    expect(organOf("femur")).toBeUndefined();
  });

  it("心臓のレッスンは心臓だけを見せ、ほかは今までどおり", () => {
    expect(organOfUnit("cv-heart")?.id).toBe("heart");
    expect(sceneFor("cardiovascular", "cv-heart")).toEqual({ systems: ["cardiovascular"], organ: "heart" });
    expect(sceneFor("cardiovascular", "cv-vein").organ).toBeUndefined();
  });

  it("肺・胃・肝臓・腎臓・脳のレッスンもその臓器だけを見せる", () => {
    expect(sceneFor("respiratory", "resp-lobes").organ).toBe("lung");
    expect(sceneFor("digestive", "dig-pt-gi").organ).toBe("stomach");
    expect(sceneFor("digestive", "dig-glands").organ).toBe("liver");
    expect(sceneFor("urogenital", "uro-urinary").organ).toBe("kidney");
    expect(sceneFor("nervous", "nerv-lobes").organ).toBe("brain");
    // 鼻・喉頭や舌・咽頭のレッスンは今までどおり
    expect(sceneFor("respiratory", "resp-larynx").organ).toBeUndefined();
    expect(sceneFor("digestive", "dig-mouth").organ).toBeUndefined();
  });

  it("添えるだけの語（around）は場面に入るが、図鑑でその臓器だけの見せ方にはしない", () => {
    const stomach = organById.get("stomach")!;
    expect(organTerms(stomach)).toContain("esophagus");
    expect(organOf("esophagus")).toBeUndefined();
    expect(organOf("trachea")?.id).toBe("lung");
    expect(organOf("frontal-lobe")?.id).toBe("brain");
  });
});

describe("近い目印の形で分ける", () => {
  it("板を、左右に置いた目印の近い方へ、境目で三角形を切って分ける", () => {
    const plate = mesh(new THREE.PlaneGeometry(0.1, 0.05, 40, 20));
    const left = mesh(new THREE.SphereGeometry(0.01).translate(-0.04, 0, 0.02));
    const right = mesh(new THREE.SphereGeometry(0.01).translate(0.04, 0, 0.02));
    const [a, b] = partitionMesh(plate, [left, right]);
    expect(a.indices.length + b.indices.length).toBeGreaterThan(plate.indices.length);
    // 左の片は x ≤ 0 の側、右の片は x ≥ 0 の側（境目は真ん中の近くの線で切る）
    expect(a.bounds[1][0]).toBeLessThan(0.003);
    expect(b.bounds[0][0]).toBeGreaterThan(-0.003);
  });
});
