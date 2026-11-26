import { termById } from "./content";
import type { StoredSchedule } from "./db";
import { termMastery } from "./study";

/**
 * わたしの標本（#/specimen。src/ui/specimen.ts）: 覚えた骨だけを標本台に並べ、学ぶほど全身の骨格が組み上がる。
 * 骨は語ごと（左右のある骨は1語で2本。指節骨は「基節骨（手）」1語で10本）。本数は 3D の部品の数と同じ（胸骨だけ3つの部品で1本）。
 * 合わせて 206本（頭蓋22・耳小骨6・舌骨1・脊柱26・胸骨1・肋骨24・上肢64・下肢62）。
 * group は、その骨の語が今のコースに無いとき（初心者・標準コース）に代わりに数える、まとめた語（頚椎・手根骨など）
 */
export interface SpecimenPiece {
  term: string;
  region: SpecimenRegion;
  count: number;
  group?: string;
}

export type SpecimenRegion = "skull" | "ear" | "spine" | "thorax" | "upper" | "lower";

export const SPECIMEN_REGIONS: { id: SpecimenRegion; ja: string }[] = [
  { id: "skull", ja: "頭蓋と舌骨" },
  { id: "ear", ja: "耳小骨" },
  { id: "spine", ja: "脊柱" },
  { id: "thorax", ja: "胸骨と肋骨" },
  { id: "upper", ja: "上肢" },
  { id: "lower", ja: "下肢" },
];

const piece = (region: SpecimenRegion, count: number, group?: string) => (term: string): SpecimenPiece => ({ term, region, count, group });

const RIBS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
const FINGERS = ["first", "second", "third", "fourth", "fifth"];

export const SPECIMEN_PIECES: SpecimenPiece[] = [
  ...["frontal-bone", "occipital-bone", "sphenoid-bone", "ethmoid-bone", "mandible", "vomer", "hyoid-bone"].map(piece("skull", 1)),
  ...["parietal-bone", "temporal-bone", "maxilla", "zygomatic-bone", "nasal-bone", "lacrimal-bone", "palatine-bone", "inferior-nasal-concha"].map(piece("skull", 2)),
  ...["malleus", "incus", "stapes"].map(piece("ear", 2)),
  ...["atlas", "axis"].map(piece("spine", 1, "cervical-vertebrae")),
  ...["third", "fourth", "fifth", "sixth"].map((n) => `${n}-cervical-vertebra`).map(piece("spine", 1, "cervical-vertebrae")),
  piece("spine", 1, "cervical-vertebrae")("vertebra-prominens"),
  ...RIBS.map((n) => `${n}-thoracic-vertebra`).map(piece("spine", 1, "thoracic-vertebrae")),
  ...RIBS.slice(0, 5).map((n) => `${n}-lumbar-vertebra`).map(piece("spine", 1, "lumbar-vertebrae")),
  ...["sacrum", "coccyx"].map(piece("spine", 1)),
  piece("thorax", 1)("sternum"),
  ...RIBS.map((n) => `${n}-rib`).map(piece("thorax", 2, "ribs")),
  ...["clavicle", "scapula", "humerus", "radius", "ulna"].map(piece("upper", 2)),
  ...["scaphoid", "lunate", "triquetrum", "pisiform", "trapezium", "trapezoid", "capitate", "hamate"].map(piece("upper", 2, "carpal-bones")),
  ...FINGERS.map((n) => `${n}-metacarpal`).map(piece("upper", 2, "metacarpals")),
  piece("upper", 10, "phalanges-hand")("proximal-phalanges-of-hand"),
  piece("upper", 8, "phalanges-hand")("middle-phalanges-of-hand"),
  piece("upper", 10, "phalanges-hand")("distal-phalanges-of-hand"),
  ...["hip-bone", "femur", "patella", "tibia", "fibula"].map(piece("lower", 2)),
  ...["talus", "calcaneus", "navicular", "cuboid"].map(piece("lower", 2, "tarsal-bones")),
  ...["medial", "intermediate", "lateral"].map((n) => `${n}-cuneiform`).map(piece("lower", 2, "tarsal-bones")),
  ...FINGERS.map((n) => `${n}-metatarsal`).map(piece("lower", 2, "metatarsals")),
  piece("lower", 10, "phalanges-foot")("proximal-phalanges-of-foot"),
  piece("lower", 8, "phalanges-foot")("middle-phalanges-of-foot"),
  piece("lower", 10, "phalanges-foot")("distal-phalanges-of-foot"),
];

export const SPECIMEN_TOTAL = SPECIMEN_PIECES.reduce((sum, item) => sum + item.count, 0);

/** 並べた骨の具合。fresh＝覚えている（90%以上）、dull＝少し色があせた（70〜90%）、faded＝手入れが必要（70%未満） */
export type SpecimenLevel = "fresh" | "dull" | "faded";

export interface PlacedPiece extends SpecimenPiece {
  /** 覚え具合を見た語（骨の語か、コースに無ければまとめた語） */
  by: string;
  mastery: number | null;
  level: SpecimenLevel;
}

export interface SpecimenState {
  placed: PlacedPiece[];
  /** 今のコースで並べられる骨の数（詳細モードでは 206） */
  reachable: number;
  /** 並べた骨の数 */
  bones: number;
  byRegion: Map<SpecimenRegion, { bones: number; total: number }>;
}

export function levelOf(mastery: number | null): SpecimenLevel {
  if (mastery === null || mastery >= 0.9) return "fresh";
  return mastery >= 0.7 ? "dull" : "faded";
}

/**
 * 今の標本。骨の語を学んでいれば並べる。骨の語が今のコースに無いとき（初心者コースの「頚椎」など）は、まとめた語を学んでいれば並べる。
 * inCourse は今のモードで学ぶ語か（src/course.ts）
 */
export function specimenState(
  learnedIds: Set<string>,
  schedulesOf: (termId: string) => StoredSchedule[],
  inCourse: (termId: string) => boolean,
  at = new Date(),
): SpecimenState {
  const placed: PlacedPiece[] = [];
  const byRegion = new Map<SpecimenRegion, { bones: number; total: number }>(SPECIMEN_REGIONS.map((region) => [region.id, { bones: 0, total: 0 }]));
  let reachable = 0;
  for (const item of SPECIMEN_PIECES) {
    if (!termById.has(item.term)) continue;
    const own = inCourse(item.term);
    const by = own ? item.term : item.group && inCourse(item.group) ? item.group : null;
    if (!by) continue;
    reachable += item.count;
    const region = byRegion.get(item.region)!;
    region.total += item.count;
    // コースの語ならその語を学んだときだけ（詳細モードで「肋骨」を学んでも、第1肋骨はまだ並ばない）
    if (!learnedIds.has(by)) continue;
    const mastery = termMastery(schedulesOf(by), at);
    placed.push({ ...item, by, mastery, level: levelOf(mastery) });
    region.bones += item.count;
  }
  return { placed, reachable, bones: placed.reduce((sum, item) => sum + item.count, 0), byRegion };
}
