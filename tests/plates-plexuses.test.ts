import { describe, expect, it } from "vitest";
import organsJson from "../content/organs.json";
import { isPlateUnit, organById, organOfLesson, plateOfTerm, termById, units } from "../src/content";
import { ORGAN_GROUPS } from "../src/ui/organs";

// 神経系の見直しの残り: 臓器の図「神経叢と自律神経」と交感神経幹の神経節（docs/設計.md「神経系の見直しの残り」）
describe("神経系の見直しの残り（神経叢と自律神経）", () => {
  const plateIds = (organ: string) => organById.get(organ)?.plates.map((plate) => plate.id) ?? [];
  const spec = (id: string) => organsJson.organs.flatMap((organ) => organ.plates as { id: string; art?: { page: string; license: string; keepInk?: string } }[]).find((plate) => plate.id === id);
  const labelsOf = (id: string) => organById.get("plexuses")!.plates.find((plate) => plate.id === id)!.labels.map((label) => (typeof label === "string" ? label : label.term));

  it("新しい臓器の図「神経叢と自律神経」は平面図だけで、腕神経叢の次に並ぶ", () => {
    expect(plateIds("plexuses")).toEqual(["cervical-plexus", "lumbar-plexus", "sacral-plexus", "recurrent-laryngeal", "spinal-nerve-rami", "autonomic-overview"]);
    expect(organById.get("plexuses")?.box).toBeUndefined();
    const group = ORGAN_GROUPS.find((item) => item.organs.includes("plexuses"))!;
    expect(group.title).toBe("神経と感覚器");
    expect(group.organs.indexOf("plexuses")).toBe(group.organs.indexOf("brachial-plexus") + 1);
  });

  it("新しいレッスンはどれもこの臓器の図に入る（平面図の語のレッスンは図のレッスン）", () => {
    for (const id of ["nerv-sympathetic-ganglia", "nerv-autonomic-ganglia", "nerv-spinal-nerve-rami", "nerv-cervical-plexus", "nerv-lumbosacral-plexus"]) {
      const unit = units.find((item) => item.id === id)!;
      expect(unit, id).toBeTruthy();
      expect(organOfLesson(unit)?.id, id).toBe("plexuses");
    }
    for (const id of ["nerv-autonomic-ganglia", "nerv-spinal-nerve-rami", "nerv-cervical-plexus", "nerv-lumbosacral-plexus"]) {
      expect(isPlateUnit(units.find((item) => item.id === id)!), id).toBe(true);
    }
  });

  it("形の無かった神経は平面図の語になり、その図の上にある", () => {
    const on = (id: string) => plateOfTerm(termById.get(id)!)?.plate.id;
    expect(on("cervical-plexus")).toBe("cervical-plexus");
    expect(on("ansa-cervicalis")).toBe("cervical-plexus");
    expect(on("recurrent-laryngeal-nerve")).toBe("recurrent-laryngeal");
    expect(on("superior-laryngeal-nerve")).toBe("recurrent-laryngeal");
    expect(on("lumbar-plexus")).toBe("lumbar-plexus");
    expect(on("subcostal-nerve")).toBe("lumbar-plexus");
    expect(on("sacral-plexus")).toBe("sacral-plexus");
    expect(on("inferior-gluteal-nerve")).toBe("sacral-plexus");
    expect(on("nerve-to-obturator-internus")).toBe("sacral-plexus");
    expect(on("white-ramus-communicans")).toBe("spinal-nerve-rami");
    expect(on("gray-ramus-communicans")).toBe("spinal-nerve-rami");
    expect(on("celiac-ganglion")).toBe("autonomic-overview");
    expect(on("pelvic-splanchnic-nerves")).toBe("autonomic-overview");
    // 縦隔の平面図の語（横隔神経・大内臓神経）は、新しい図のラベルにもつなぐ
    expect(labelsOf("cervical-plexus")).toContain("phrenic-nerve");
    expect(labelsOf("autonomic-overview")).toContain("greater-splanchnic-nerve");
  });

  it("3Dの語（交感神経幹の神経節・交通枝・側角）と、神経叢の図に今までの3Dの神経をつなぐ", () => {
    for (const id of ["superior-cervical-ganglion", "middle-cervical-ganglion", "cervicothoracic-ganglion", "thoracic-ganglia"]) {
      expect(termById.get(id)?.schematic, id).toBe(true);
      expect(termById.get("sympathetic-trunk")?.parts).toContain(`za:${termById.get(id)!.en}`);
    }
    expect(termById.get("rami-communicantes")?.parts).toEqual(["za:sympathetic nerves"]);
    expect(termById.get("lateral-horn")?.xray).toBe(true);
    expect(labelsOf("lumbar-plexus")).toEqual(expect.arrayContaining(["iliohypogastric-nerve", "ilio-inguinal-nerve", "genitofemoral-nerve", "lateral-femoral-cutaneous-nerve", "femoral-nerve", "obturator-nerve"]));
    expect(labelsOf("sacral-plexus")).toEqual(expect.arrayContaining(["superior-gluteal-nerve", "sciatic-nerve", "posterior-femoral-cutaneous-nerve", "pudendal-nerve", "nerve-to-piriformis", "nerve-to-quadratus-femoris"]));
    expect(labelsOf("autonomic-overview")).toEqual(expect.arrayContaining(["superior-cervical-ganglion", "sympathetic-trunk", "ciliary-ganglion", "vagus-nerve", "lateral-horn"]));
  });

  it("元の図は自由なライセンスの図。頚神経叢の図は青い線だけを残す", () => {
    for (const id of plateIds("plexuses")) {
      const art = spec(id)?.art;
      expect(art?.page, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(art?.license, id).toMatch(/^CC BY(-SA)? \d\.\d$|^Public domain$/);
    }
    expect(spec("cervical-plexus")?.art?.keepInk).toBe("#0000ff");
  });
});
