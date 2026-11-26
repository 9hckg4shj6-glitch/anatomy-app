import * as THREE from "three";
import { termById } from "../content";
import { courseUnitOf, inCourse, isDetail } from "../course";
import { db, nowIso, type StoredSchedule } from "../db";
import { h } from "../dom";
import { SPECIMEN_PIECES, SPECIMEN_REGIONS, SPECIMEN_TOTAL, specimenState, type PlacedPiece, type SpecimenLevel, type SpecimenState } from "../specimen";
import type { Vec3 } from "../landmarks";
import type { AppContext } from "./context";
import { card, group } from "./settings-kit";

/**
 * わたしの標本（#/specimen。記録のタブの中）。覚えた骨だけを標本台に並べ、学ぶほど全身の骨格が組み上がる（src/specimen.ts）。
 * 骨は今の覚え具合で色を変え、忘れかけた骨（70%未満）は色があせて「手入れ」（その骨だけの演習）が要る。
 * 前に開いてから増えた骨は金色で示す。全部そろった日を記念日として残す（db.settings の specimen.completed.<本数>）
 */

/** 骨の色。覚えている骨は新しい骨の色、あせるほど灰色がかった茶に */
const LEVEL_COLORS: Record<SpecimenLevel, string> = { fresh: "#efe3c4", dull: "#bba77a", faded: "#6f6960" };
const LEVEL_LABELS: Record<SpecimenLevel, string> = { fresh: "きれい（覚えている）", dull: "少しあせた（70〜90%）", faded: "手入れが必要（70%未満）" };
/** 前に開いてから並んだ骨 */
const NEW_COLOR = "#f2c45a";
/** 前に開いたときに並んでいた骨の語（増えた骨を金色にするため） */
const SEEN_KEY = "specimen.seen";
/** まだの骨を影で見せるか */
const GHOST_KEY = "specimen.ghost";
const completedKey = (total: number) => `specimen.completed.${total}`;

/** 肋軟骨は骨に数えないが、肋骨と胸骨がそろえば添える（無いと胸郭が浮いて見えるので） */
const CARTILAGE = "costal-cartilages";

export async function specimenScreen(ctx: AppContext): Promise<void> {
  const { viewer, signal } = ctx;
  ctx.hint("");
  const [learned, schedules, seenRow, ghostRow] = await Promise.all([
    db.learned.toArray(), db.schedules.toArray(), db.settings.get(SEEN_KEY), db.settings.get(GHOST_KEY),
  ]);
  if (signal.aborted) return;
  const learnedIds = new Set(learned.map((item) => item.termId));
  const state = currentSpecimen(learnedIds, schedules);
  const seen = Array.isArray(seenRow?.value) ? new Set(seenRow.value as string[]) : null;
  // 初めて開いたときは、もう並んでいる骨を新しいとはしない（金色だらけにならないように）
  const fresh = seen ? state.placed.filter((item) => !seen.has(item.term)) : [];
  const freshIds = new Set(fresh.map((item) => item.term));
  void db.settings.put({ key: SEEN_KEY, value: state.placed.map((item) => item.term), updatedAt: nowIso() });
  let ghost = ghostRow?.value === true;

  // 全部そろった日（初めてそろったときに残す）
  const doneKey = completedKey(state.reachable);
  let completedAt = (await db.settings.get(doneKey))?.value as string | undefined;
  const justCompleted = state.reachable > 0 && state.bones >= state.reachable && !completedAt;
  if (justCompleted) {
    completedAt = nowIso();
    await db.settings.put({ key: doneKey, value: completedAt, updatedAt: completedAt });
  }
  if (signal.aborted) return;

  // ---- 3D: 標本台と、並べた骨 ----
  const index = ctx.index.terms;
  const elementsOf = (termId: string) => index[termId]?.elements ?? [];
  const placedTerms = new Set(state.placed.map((item) => item.term));
  const pieceOfElement = new Map<string, PlacedPiece>();
  for (const item of state.placed) for (const element of elementsOf(item.term)) pieceOfElement.set(element, item);
  const needsEar = state.placed.some((item) => item.region === "ear") || ghost;
  await viewer.show({ systems: needsEar ? ["skeletal", "sensory"] : ["skeletal"] });
  if (signal.aborted) return;
  const cartilage = learnedIds.has(CARTILAGE) || (!inCourse(CARTILAGE) && placedTerms.has("sternum") && placedTerms.has("first-rib"));
  const paint = () => {
    const colors: Record<string, string> = {};
    for (const item of state.placed) for (const element of elementsOf(item.term)) colors[element] = freshIds.has(item.term) ? NEW_COLOR : LEVEL_COLORS[item.level];
    const solid = [...pieceOfElement.keys(), ...(cartilage ? elementsOf(CARTILAGE) : [])];
    const rest = ghost ? SPECIMEN_PIECES.filter((item) => !placedTerms.has(item.term)).flatMap((item) => elementsOf(item.term)) : [];
    viewer.setStage({ solid, ghost: rest, colors });
  };
  paint();
  viewer.setSchematic(standModel(ctx));
  signal.addEventListener("abort", () => {
    viewer.setSchematic(null);
    viewer.setStage(null);
  }, { once: true });
  const [lo, hi] = ctx.index.bounds;
  const height = hi[1] - lo[1];
  const target: Vec3 = [0, lo[1] + height * 0.47, (lo[2] + hi[2]) / 2];
  const distance = (height * 0.7) / Math.tan((17.5 * Math.PI) / 180);
  viewer.setView([target, [target[0], target[1] + height * 0.05, target[2] + distance]]);
  viewer.spin(!matchMedia("(prefers-reduced-motion: reduce)").matches);

  // 3Dの骨を押すと、その骨の名前と具合
  const picked = h("div", { class: "specimen-picked", "aria-live": "polite" });
  const pick = (item: PlacedPiece | null) => {
    if (!item) {
      viewer.setLabel(null);
      picked.replaceChildren();
      return;
    }
    const term = termById.get(item.term)!;
    viewer.setLabel(item.term, term.ja);
    picked.replaceChildren(h("section", { class: "home-card specimen-pick" },
      h("p", { class: "home-kicker" }, "選んだ骨"),
      h("b", { class: "specimen-pick-name" }, term.ja, item.count > 1 ? h("small", {}, `（${item.count}本）`) : ""),
      h("span", { class: "specimen-pick-state" }, h("span", { class: "swatch", style: `background:${LEVEL_COLORS[item.level]}` }), stateText(item)),
      h("div", { class: "nav-row" },
        h("a", { class: "ghost-button", href: `#/explore/${item.term}` }, "図鑑で見る"),
        h("a", { class: item.level === "fresh" ? "ghost-button" : "primary", href: `#/drill/term/${item.by}` }, item.level === "fresh" ? "解いてみる" : "手入れする")),
    ));
  };
  viewer.onPick = (elementId) => {
    const item = elementId ? pieceOfElement.get(elementId) ?? null : null;
    pick(item);
    if (item) picked.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  viewer.onHover = (elementId) => {
    const item = pieceOfElement.get(elementId);
    return item ? termById.get(item.term)?.ja ?? null : null;
  };
  /** 骨の名前の札（押すと3Dでその骨に寄る） */
  const boneChip = (item: PlacedPiece, extra = "") => h("button", {
    class: "chip specimen-chip", type: "button",
    onClick: () => {
      viewer.spin(false);
      viewer.focusWhole(item.term, 1.1);
      pick(item);
    },
  }, h("span", { class: "swatch", style: `background:${freshIds.has(item.term) ? NEW_COLOR : LEVEL_COLORS[item.level]}` }), termById.get(item.term)?.ja ?? item.term, extra ? h("span", { class: "chip-count" }, extra) : "");

  ctx.tools.replaceChildren(h("button", {
    class: ghost ? "chip on" : "chip", type: "button", "aria-pressed": String(ghost),
    onClick: async (event: Event) => {
      ghost = !ghost;
      (event.currentTarget as HTMLElement).className = ghost ? "chip on" : "chip";
      (event.currentTarget as HTMLElement).setAttribute("aria-pressed", String(ghost));
      void db.settings.put({ key: GHOST_KEY, value: ghost, updatedAt: nowIso() });
      if (ghost && !needsEar) await viewer.show({ systems: ["skeletal", "sensory"] });
      if (!signal.aborted) paint();
    },
  }, "まだの骨を影で"));

  // ---- 欄 ----
  const percent = state.reachable ? Math.round((state.bones / state.reachable) * 100) : 0;
  const worn = (level: SpecimenLevel) => state.placed.filter((item) => item.level === level).sort((a, b) => (a.mastery ?? 1) - (b.mastery ?? 1));
  const faded = worn("faded");
  const dull = worn("dull");
  const care = faded.length ? faded : dull;
  const careIds = [...new Set(care.map((item) => item.by))];
  const bonesOf = (list: PlacedPiece[]) => list.reduce((sum, item) => sum + item.count, 0);

  ctx.panel.replaceChildren(h("div", { class: "home specimen" },
    h("div", { class: "tab-head" }, h("h2", {}, "わたしの標本")),
    h("section", { class: "home-card specimen-head" },
      h("p", { class: "home-kicker" }, "並べた骨"),
      h("p", { class: "specimen-count" }, h("b", {}, String(state.bones)), h("span", {}, ` / ${state.reachable}本`), h("span", { class: "specimen-rate" }, `${percent}%`)),
      h("div", { class: "home-meter", "aria-hidden": "true" }, h("span", { style: `width:${percent}%` })),
      h("p", { class: "home-note" }, state.bones
        ? "レッスンで覚えた骨だけが標本台に並びます。日がたって忘れかけた骨は色があせるので、手入れ（その骨の復習）をしましょう。骨を押すと名前が出ます。"
        : "まだ骨がありません。骨のレッスンで覚えた骨から、1本ずつ標本台に立っていきます。"),
      state.reachable < SPECIMEN_TOTAL ? h("p", { class: "home-note" }, `今のコースで並べられるのは ${state.reachable}本です（詳細コースで ${SPECIMEN_TOTAL}本すべて）。コースに無い骨は、まとめた語（頚椎・手根骨など）を覚えると並びます。`) : "",
    ),
    completedAt ? completeCard(completedAt, state.reachable, justCompleted) : "",
    !state.bones ? firstStep() : "",
    fresh.length ? h("section", { class: "home-card specimen-new" },
      h("p", { class: "home-kicker" }, h("span", { class: "swatch", style: `background:${NEW_COLOR}` }), `前に見てから並んだ骨 ${bonesOf(fresh)}本`),
      h("div", { class: "chip-list" }, ...fresh.map((item) => boneChip(item))),
    ) : "",
    care.length ? h("section", { class: "home-card specimen-care" },
      h("p", { class: "home-kicker" }, h("span", { class: "swatch", style: `background:${LEVEL_COLORS[care[0].level]}` }),
        faded.length ? `手入れが必要な骨 ${bonesOf(faded)}本` : `少しあせた骨 ${bonesOf(dull)}本`),
      h("div", { class: "chip-list" }, ...care.slice(0, 12).map((item) => boneChip(item, item.mastery === null ? "" : `${Math.round(item.mastery * 100)}%`))),
      care.length > 12 ? h("p", { class: "home-note" }, `ほか ${care.length - 12}種類`) : "",
      h("a", { class: "home-primary specimen-care-go", href: `#/drill/terms/${careIds.join(",")}` },
        h("span", { class: "home-primary-text" },
          h("span", { class: "home-primary-title" }, faded.length ? "手入れする" : "磨いておく"),
          h("span", { class: "home-primary-sub" }, `この${careIds.length}語を苦手な順に解く。正解すると色が戻ります`))),
    ) : "",
    picked,
    group("体の部分ごと", {}, card(...SPECIMEN_REGIONS.map((region) => regionRow(region, state, learnedIds)).filter(Boolean))),
    group("色の見方", {}, h("ul", { class: "legend specimen-legend" },
      ...(Object.keys(LEVEL_COLORS) as SpecimenLevel[]).map((level) => h("li", {}, h("span", { class: "swatch", style: `background:${LEVEL_COLORS[level]}` }), LEVEL_LABELS[level])),
      h("li", {}, h("span", { class: "swatch", style: `background:${NEW_COLOR}` }), "前に見てから並んだ骨"),
    )),
    h("p", { class: "footer-link" }, "覚え具合の数字は ", h("a", { href: "#/progress" }, "進捗"), " でも見られます。"),
  ));
}

/** 今のコースでの標本（記録・今日の画面でも使う） */
export function currentSpecimen(learnedIds: Set<string>, schedules: StoredSchedule[]): SpecimenState {
  const byTerm = new Map<string, StoredSchedule[]>();
  for (const schedule of schedules) byTerm.set(schedule.termId, [...(byTerm.get(schedule.termId) ?? []), schedule]);
  return specimenState(learnedIds, (id) => byTerm.get(id) ?? [], inCourse);
}

function stateText(item: PlacedPiece): string {
  const value = item.mastery === null ? "" : `（今思い出せる見込み ${Math.round(item.mastery * 100)}%）`;
  if (item.level === "fresh") return `きれいです${value}`;
  if (item.level === "dull") return `少し色があせてきました${value}`;
  return `忘れかけています。手入れしましょう${value}`;
}

/** 体の部分の行: 並べた本数と、次に覚える骨のレッスン */
function regionRow(region: (typeof SPECIMEN_REGIONS)[number], state: SpecimenState, learnedIds: Set<string>): HTMLElement | null {
  const count = state.byRegion.get(region.id)!;
  if (!count.total) return null;
  const done = count.bones >= count.total;
  const next = done ? undefined : SPECIMEN_PIECES.find((item) => {
    if (item.region !== region.id) return false;
    const by = inCourse(item.term) ? item.term : item.group;
    return by && inCourse(by) && !learnedIds.has(by);
  });
  const by = next && (inCourse(next.term) ? next.term : next.group!);
  const unit = by ? courseUnitOf(by) : undefined;
  return h("div", { class: "set-row specimen-region" },
    h("span", { class: "set-text" },
      h("span", { class: "set-label" }, region.ja, done ? h("span", { class: "specimen-done" }, " ✓ そろった") : ""),
      unit ? h("a", { class: "set-sub", href: `#/learn/${unit.id}` }, `次は「${unit.title}」 ›`) : ""),
    h("span", { class: "specimen-region-bar", "aria-hidden": "true" }, h("span", { style: `width:${(count.bones / count.total) * 100}%` })),
    h("span", { class: "set-value" }, `${count.bones} / ${count.total}`));
}

/** まだ1本も無いとき: 大腿骨のレッスンから */
function firstStep(): HTMLElement | string {
  const unit = courseUnitOf("femur");
  if (!unit) return "";
  return h("a", { class: "home-primary", href: `#/learn/${unit.id}` },
    h("span", { class: "home-primary-text" },
      h("span", { class: "home-primary-title" }, `「${unit.title}」で1本目を立てる`),
      h("span", { class: "home-primary-sub" }, "大腿骨など、体でいちばん長い骨から")));
}

/** 全部そろった日 */
function completeCard(at: string, total: number, now: boolean): HTMLElement {
  const date = new Date(at);
  return h("section", { class: now ? "home-card specimen-complete is-now" : "home-card specimen-complete" },
    h("p", { class: "specimen-complete-mark", "aria-hidden": "true" }, "🎉"),
    h("b", {}, now ? `${total}本の骨がそろいました！` : `${total}本の骨がそろった日`),
    h("span", {}, `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`),
    h("span", { class: "home-note" }, total >= SPECIMEN_TOTAL
      ? "全身の骨格が組み上がりました。今日は記念日です。あとは色をあせさせないよう、ときどき手入れを。"
      : isDetail() ? "" : "今のコースの骨がそろいました。詳細コースにすると、残りの骨も並べられます。"),
  );
}

/**
 * 標本台: 木の台座と、仙骨の後ろで骨格を支える真鍮の支柱。骨が1本でも、台に立っているように見せる。
 * 位置は体の座標（m）。仙骨の位置は骨格を読み込んでから測る
 */
function standModel(ctx: AppContext): THREE.Group {
  const [lo, hi] = ctx.index.bounds;
  const sacrum = ctx.viewer.partCenter(ctx.index.terms.sacrum?.elements ?? []) ?? [0, lo[1] + (hi[1] - lo[1]) * 0.55, 0.03];
  const wood = new THREE.MeshStandardMaterial({ color: "#7b5534", roughness: 0.62, metalness: 0.02 });
  const woodTop = new THREE.MeshStandardMaterial({ color: "#8d6440", roughness: 0.55, metalness: 0.02 });
  const brass = new THREE.MeshStandardMaterial({ color: "#b8955a", roughness: 0.32, metalness: 0.75 });
  const group = new THREE.Group();
  const centerZ = (lo[2] + hi[2]) / 2;
  const floor = lo[1] - 0.004;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.265, 0.03, 64), wood);
  base.position.set(0, floor - 0.035, centerZ);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.25, 0.02, 64), woodTop);
  top.position.set(0, floor - 0.01, centerZ);
  const poleZ = sacrum[2] - 0.075;
  const poleTop = sacrum[1] + 0.01;
  const poleHeight = poleTop - floor;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, poleHeight, 20), brass);
  pole.position.set(0, floor + poleHeight / 2, poleZ);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.012, 32), brass);
  foot.position.set(0, floor + 0.006, poleZ);
  const armLength = sacrum[2] - 0.015 - poleZ;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, armLength, 16), brass);
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0, poleTop, poleZ + armLength / 2);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.008, 20, 14), brass);
  knob.position.set(0, poleTop, poleZ);
  // 台座の前の名札（真鍮の板）
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.016, 0.003), brass);
  const front = centerZ + 0.2575;
  plate.position.set(0, floor - 0.035, front);
  plate.rotation.x = -0.06;
  group.add(base, top, pole, foot, arm, knob, plate);
  return group;
}
