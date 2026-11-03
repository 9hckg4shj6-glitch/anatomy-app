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
  });

  it("眼・耳・鼻腔と咽頭・喉頭・腸・男性生殖器・脊髄のレッスンもその臓器だけを見せる", () => {
    expect(sceneFor("sensory", "sens-eyeball").organ).toBe("eye");
    expect(sceneFor("sensory", "sens-ear").organ).toBe("ear");
    expect(sceneFor("respiratory", "resp-nose").organ).toBe("nose");
    expect(sceneFor("digestive", "dig-mouth").organ).toBe("pharynx");
    expect(sceneFor("respiratory", "resp-larynx").organ).toBe("larynx");
    expect(sceneFor("digestive", "dig-intestine").organ).toBe("intestine");
    expect(sceneFor("urogenital", "uro-male").organ).toBe("male");
    expect(sceneFor("nervous", "nerv-cord-inner").organ).toBe("spinal-cord");
    // 体じゅうに散らばる語や、2つの臓器にまたがる語のレッスンは今までどおり
    expect(sceneFor("sensory", "sens-accessory").organ).toBeUndefined();
    expect(sceneFor("endocrine", "endo-glands").organ).toBeUndefined();
    expect(sceneFor("digestive", "dig-tract").organ).toBeUndefined();
    expect(sceneFor("nervous", "nerv-spinal").organ).toBeUndefined();
    // レッスンの外の語（with）も、図鑑でその臓器の見せ方になる
    expect(organOf("superior-rectus")?.id).toBe("eye");
    expect(organOf("thyroid-gland")?.id).toBe("larynx");
    expect(organOf("sigmoid-colon")?.id).toBe("intestine");
    // 長く続く脊髄そのものは添えるだけ
    expect(organOf("spinal-cord")).toBeUndefined();
  });

  it("鼻腔と副鼻腔は咽頭から分けた臓器で、咽頭の立体には鼻腔を添えるだけ", () => {
    expect(organOf("frontal-sinus")?.id).toBe("nose");
    expect(organOf("nasal-septal-cartilage")?.id).toBe("nose");
    // CT から作った鼻甲介・鼻道・上顎洞のレッスンも鼻腔の場面。骨の下鼻甲介は鼻甲介（粘膜）の形で示すので場面に入れない
    expect(sceneFor("respiratory", "resp-nose-wall").organ).toBe("nose");
    expect(organOf("middle-nasal-meatus")?.id).toBe("nose");
    expect(organOf("maxillary-sinus")?.id).toBe("nose");
    expect(organTerms(organById.get("nose")!)).not.toContain("inferior-nasal-concha");
    expect(organTerms(organById.get("pharynx")!)).toContain("nasal-cavity");
    // 頭蓋の骨は添えるだけ（図鑑で骨を開いたときは今までどおり全身で見せる）
    expect(organTerms(organById.get("nose")!)).toContain("ethmoid-bone");
    expect(organOf("ethmoid-bone")).toBeUndefined();
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
