import { termById, terms, type Attachments, type Term } from "./content";

const muscles = terms.filter((term) => term.nerve);
const nerves = terms.filter((term) => term.system === "nervous" && term.ja.endsWith("神経"));
const regions = terms.filter((term) => term.region);

/**
 * 語と関係のある語: 筋→支配神経、神経→支配する筋、骨→そこから起こる筋・そこに付く筋、骨の部位→付く筋。
 * どの語にも、その語が境界や通るものとして出てくる局所解剖の語（大腿動脈→大腿三角・内転筋管など）を足す。
 * attachedBones は、付着面がまとめた骨の語（肋骨など）に付いているとき、その中のどの1本（第6肋骨など）の上か（index.json）。
 */
export function relatedTerms(term: Term, attachments: Attachments, attachedBones: Record<string, string[]> = {}): { title: string; list: Term[]; group?: boolean }[] {
  const places = regions.filter((region) => region.region!.bounds.includes(term.id) || region.region!.contents.includes(term.id));
  const list = ownRelations(term, attachments, attachedBones);
  return places.length ? [...list, { title: "この語が出てくる局所", list: places }] : list;
}

function ownRelations(term: Term, attachments: Attachments, attachedBones: Record<string, string[]>): { title: string; list: Term[]; group?: boolean }[] {
  if (term.nerve) return [{ title: "支配神経", list: nerves.filter((nerve) => term.nerve!.includes(nerve.ja)) }];
  if (nerves.includes(term)) return [{ title: `${term.ja}が支配する筋`, list: muscles.filter((muscle) => muscle.nerve!.includes(term.ja)), group: true }];
  if (term.of) {
    return [
      { title: "ここから起こる筋", list: muscles.filter((muscle) => muscle.originAt?.includes(term.id)) },
      { title: "ここに停止する筋", list: muscles.filter((muscle) => muscle.insertionAt?.includes(term.id)) },
    ];
  }
  if (term.system === "skeletal") {
    const on = (muscle: Term, kind: "origin" | "insertion") =>
      !!attachments[muscle.id]?.[kind]?.some(([bone]) => bone === term.id) || !!muscle[`${kind}At`]?.some((id) => termById.get(id)?.of === term.id) ||
      !!attachedBones[`${muscle.id}@${kind}`]?.includes(term.id);
    return [
      { title: "この骨から起こる筋", list: muscles.filter((muscle) => on(muscle, "origin")) },
      { title: "この骨に停止する筋", list: muscles.filter((muscle) => on(muscle, "insertion")) },
    ];
  }
  return [];
}
