import detailJson from "virtual:organs-detail";
import { organById, type Organ, type OrganCore, type PlateSpec } from "./content";

/**
 * 臓器の図と動きの図鑑だけで使う、臓器の残りの所（説明・色分け・向き・切り口・平面図の出典・添え書き・要点）。
 * このファイルは臓器の図・動きの図鑑からだけ読む（はじめの JS に入れないため。vite.config.ts の organSplit）
 */
type Detail = Omit<Organ, keyof OrganCore> & { id: string; plates: (Omit<PlateSpec, "title" | "labels"> & { id: string })[] };

const details = new Map((detailJson.organs as Detail[]).map((detail) => [detail.id, detail]));
const full = new Map<string, Organ>();

/** 臓器の図の画面で使う所まで含めた臓器（はじめの JS の所と合わせる） */
export function fullOrgan(core: OrganCore): Organ {
  let organ = full.get(core.id);
  if (!organ) {
    const detail = details.get(core.id);
    if (!detail) throw new Error(`organs.json に無い臓器: ${core.id}`);
    const plates = new Map(detail.plates.map((plate) => [plate.id, plate]));
    organ = { ...core, ...detail, plates: core.plates.map((plate) => ({ ...plate, ...plates.get(plate.id)! })) };
    full.set(core.id, organ);
  }
  return organ;
}

export function fullOrganById(id: string): Organ | undefined {
  const core = organById.get(id);
  return core ? fullOrgan(core) : undefined;
}

/** 平面図の指定（出典・添え書き・要点まで） */
export function fullPlate(id: string | undefined): PlateSpec | undefined {
  for (const core of organById.values()) for (const plate of fullOrgan(core).plates) if (plate.id === id) return plate;
  return undefined;
}
