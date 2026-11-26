import { describe, expect, it } from "vitest";
import organsJson from "../content/organs.json";
import plateIndex from "../public/plates/index.json";
import { organById, termById } from "../src/content";

// 平面図の点検と追加（docs/設計.md「平面図の欠けの点検と、学びやすくする図の追加」）
type Spec = { id: string; labels: { term?: string; ja?: string; px: number[] }[]; art?: { page: string; license: string; white?: number; keepAll?: boolean; minBlob?: number } };
const spec = (id: string) => organsJson.organs.flatMap((organ) => organ.plates as Spec[]).find((plate) => plate.id === id);
const plateIds = (organ: string) => organById.get(organ)?.plates.map((plate) => plate.id) ?? [];
const index = plateIndex.plates as Record<string, { w: number; h: number; labels: { at: number[] }[] }>;

describe("平面図の欠けの点検", () => {
  it("薄い色の塗りが背景として抜けていた図は、白とみなす明るさを上げて残す", () => {
    for (const id of ["cartilage", "spinal-nerve-rami", "female-sagittal", "male-sagittal", "intestine-folds", "meninges", "epithelium", "adrenal-layers", "pharynx-sagittal", "intestine-anterior", "liver-biliary", "mouth-open"]) {
      expect(spec(id)?.art?.white, id).toBeGreaterThanOrEqual(248);
    }
  });

  it("引き出し線を消して本体から離れた所（胎盤の輪郭・椎骨と胸の壁の線）も残す", () => {
    for (const id of ["fetal-circulation", "mediastinum-compartments"]) {
      expect(spec(id)?.art?.keepAll, id).toBe(true);
      expect(spec(id)?.art?.minBlob, id).toBeGreaterThan(0);
    }
  });

  it("どの平面図もラベルの点が図の中にある", () => {
    for (const organ of organsJson.organs) {
      for (const plate of organ.plates as { id: string }[]) {
        for (const label of index[plate.id]?.labels ?? []) {
          for (const v of label.at) expect(v, plate.id).toBeGreaterThanOrEqual(0), expect(v, plate.id).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("学びやすくする図の追加", () => {
  const added = { "arteries-overview": "vessels", "veins-overview": "vessels", "limbic-system": "brain", dermatomes: "spinal-cord", "femoral-triangle": "passages", "rectus-sheath-upper": "passages", "rectus-sheath-lower": "passages" };

  it("足した図はその臓器の図に入り、平面図ができている", () => {
    for (const [id, organ] of Object.entries(added)) {
      expect(plateIds(organ), id).toContain(id);
      expect(index[id]?.w, id).toBeGreaterThan(0);
    }
    // 体循環の臓器の図は全身の動脈・静脈から始める（一覧の絵にもなる）
    expect(plateIds("vessels").slice(0, 2)).toEqual(["arteries-overview", "veins-overview"]);
    expect(organById.get("passages")?.ja).toBe("手根管・鼡径管・大腿三角と腹壁");
  });

  it("ラベルの語はアプリにある語で、語の無い所は日本語と英語の名前を持つ", () => {
    for (const id of Object.keys(added)) {
      for (const label of spec(id)!.labels) {
        if (label.term) expect(termById.has(label.term), `${id} ${label.term}`).toBe(true);
        else expect(label.ja, id).toBeTruthy();
      }
    }
  });

  it("全身の動脈と静脈の図には、大事な動脈・静脈が載る", () => {
    const terms = (id: string) => spec(id)!.labels.flatMap((label) => (label.term ? [label.term] : []));
    expect(terms("arteries-overview")).toEqual(expect.arrayContaining(["aortic-arch", "brachiocephalic-trunk", "common-carotid-artery", "subclavian-artery", "axillary-artery", "brachial-artery", "radial-artery", "ulnar-artery", "celiac-trunk", "superior-mesenteric-artery", "inferior-mesenteric-artery", "renal-artery", "common-iliac-artery", "external-iliac-artery", "internal-iliac-artery", "femoral-artery", "popliteal-artery", "anterior-tibial-artery", "posterior-tibial-artery", "dorsalis-pedis-artery"]));
    expect(terms("veins-overview")).toEqual(expect.arrayContaining(["internal-jugular-vein", "external-jugular-vein", "subclavian-vein", "brachiocephalic-vein", "superior-vena-cava", "inferior-vena-cava", "cephalic-vein", "basilic-vein", "median-cubital-vein", "great-saphenous-vein", "small-saphenous-vein", "femoral-vein", "popliteal-vein", "hepatic-veins", "renal-vein"]));
  });

  it("皮膚分節の図は覚える目安の分節（C6・C7・C8・T4・T10・L1・L4・L5・S1）を指す", () => {
    const names = spec("dermatomes")!.labels.map((label) => label.ja);
    expect(names).toEqual(expect.arrayContaining(["C6", "C7", "C8", "T4", "T10", "L1", "L4", "L5", "S1"]));
  });

  it("元の図は自由なライセンスの図", () => {
    for (const id of Object.keys(added)) {
      const art = spec(id)?.art;
      expect(art?.page, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(art?.license, id).toMatch(/^CC BY(-SA)? \d\.\d$|^Public domain$/);
    }
  });
});
