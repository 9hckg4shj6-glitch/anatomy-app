import { organs, type Unit } from "../content";
import { db } from "../db";
import { h } from "../dom";
import { termAt, type AppContext } from "./context";
import { lessonMinutes } from "./home";
import { pathUnits } from "./lessons";
import { itemRow, lockedRow } from "./study-hub";

/**
 * 神経（#/nerves。学ぶの「学び方」から）: 神経系をまとめて学ぶ所。
 * 神経系の次のレッスン（続きから）・レッスンのまとまりごとの進み具合・神経を切ると（#/cut）と症状から当てる問い・
 * 神経の臓器の図・神経系の学んだ語の演習・神経系の語の一覧（調べる）を1つの画面に並べる。3Dは神経系（タップで図鑑）
 */

const NERVE_COLOR = "#b8862b";
/** 神経の臓器の図（content/organs.json の id）。並びは中枢 → 末梢 */
const NERVE_ORGANS = ["brain", "brain-base", "spinal-cord", "brachial-plexus", "plexuses"];
const ORGAN_SUB: Record<string, string> = {
  brain: "大脳・間脳・脳幹・小脳と脳室を、立体と平面図で",
  "brain-base": "脳の底面から出る12対の脳神経",
  "spinal-cord": "脊髄の断面と神経根・白質の伝導路",
  "brachial-plexus": "根・幹・束・枝の並びを1枚の図で",
  plexuses: "頚・腰・仙骨神経叢と、交感神経幹・自律神経",
};

export async function nervesScreen(ctx: AppContext): Promise<void> {
  const { viewer } = ctx;
  ctx.fold("3Dで見る：神経系（タップで図鑑）");
  ctx.hint("");
  const learned = await db.learned.toArray();
  const learnedIds = new Set(learned.map((item) => item.termId));

  const units = pathUnits().filter((unit) => unit.system === "nervous");
  const doneOf = (unit: Unit) => unit.terms.filter((term) => learnedIds.has(term.id)).length;
  const finished = (unit: Unit) => doneOf(unit) === unit.terms.length;
  // 続きから: 途中のレッスンがあればそれ、無ければまだ終えていない最初のレッスン
  const next = units.find((unit) => doneOf(unit) > 0 && !finished(unit)) ?? units.find((unit) => !finished(unit));
  const groups = [...new Set(units.map((unit) => unit.group ?? ""))];
  const learnedNerveIds = units.flatMap((unit) => unit.terms.filter((term) => learnedIds.has(term.id)).map((term) => term.id));

  const nextCard = !units.length
    ? h("section", { class: "home-card" }, h("p", { class: "home-note" }, "今のコースには神経系のレッスンがありません。設定でコースを「標準」にすると学べます。"))
    : next ? (() => {
      const done = doneOf(next);
      const rest = next.terms.length - done;
      return h("section", { class: "home-card study-next" },
        h("p", { class: "home-kicker" }, h("span", {}, `${done ? "続きから" : "次に学ぶ"}・神経系${next.group ? ` › ${next.group}` : ""}`)),
        h("div", { class: "study-next-title" }, h("b", {}, next.title), h("span", {}, done ? `${done} / ${next.terms.length}語` : `約${lessonMinutes(next.terms.length)}分`)),
        h("div", { class: "home-meter", "aria-hidden": "true" }, h("span", { style: `width:${(done / next.terms.length) * 100}%;background:var(--accent)` })),
        h("a", { class: "home-primary", href: `#/learn/${next.id}` },
          h("span", { class: "home-primary-text" }, h("span", { class: "home-primary-title" }, done ? `続ける（残り ${rest}語・約${lessonMinutes(rest)}分）` : "始める"))),
      );
    })() : h("section", { class: "home-card" }, h("p", { class: "home-note" }, "このコースの神経系のレッスンはすべて終えました。演習と「神経を切ると」で仕上げましょう。"));

  const lessonRows = groups.map((group) => {
    const inGroup = units.filter((unit) => (unit.group ?? "") === group);
    const done = inGroup.filter(finished).length;
    const sub = inGroup.slice(0, 3).map((unit) => unit.title).join("・") + (inGroup.length > 3 ? " など" : "");
    return itemRow("#/lessons/nervous", "lessons", "#a8572f", group || "神経系", sub, `${done} / ${inGroup.length}`);
  });

  const organRows = NERVE_ORGANS.flatMap((id) => {
    const organ = organs.find((item) => item.id === id);
    if (!organ) return [];
    return [itemRow(`#/organs/${organ.id}`, "organ", "#c2493a", organ.ja, ORGAN_SUB[id] ?? "", organ.plates.length ? `平面図 ${organ.plates.length}枚` : "")];
  });

  ctx.panel.replaceChildren(h("div", { class: "home" },
    h("div", { class: "tab-head" }, h("h2", {}, "神経")),
    h("section", { class: "home-card" },
      h("p", { class: "cut-lead" }, "脳と脊髄（中枢）から、全身へ向かう神経（末梢）まで。レッスンで覚える・図で見る・神経を切って確かめる、をここにまとめました。")),
    nextCard,
    units.length ? h("h3", { class: "list-title" }, "レッスンで覚える") : "",
    units.length ? h("ul", { class: "home-card home-list ways" }, ...lessonRows) : "",
    h("h3", { class: "list-title" }, "切って確かめる"),
    h("ul", { class: "home-card home-list ways" },
      itemRow("#/cut", "cut", NERVE_COLOR, "神経を切ると", "神経を1本切ると、止まる筋が灰色に。下垂手・猿手・鷲手などの形も"),
      itemRow("#/cut/quiz", "drill", NERVE_COLOR, "症状から神経を当てる", "「手首が上がらない人がいます。どの神経？」10問・4つから選ぶ"),
    ),
    organRows.length ? h("h3", { class: "list-title" }, "図で見る") : "",
    organRows.length ? h("ul", { class: "home-card home-list ways" }, ...organRows) : "",
    h("h3", { class: "list-title" }, "解き直す・調べる"),
    h("ul", { class: "home-card home-list ways" },
      learnedNerveIds.length
        ? itemRow(`#/drill/terms/${learnedNerveIds.join(",")}`, "drill", "#6b5fb5", "神経系の演習", `学んだ神経系の語（${learnedNerveIds.length}語）を、覚え具合の弱い順に`)
        : lockedRow("drill", "#6b5fb5", "神経系の演習", "神経系のレッスンを1つ学ぶと使えます"),
      itemRow("#/look/nervous", "explore", "#2f78b0", "神経系の語を一覧で", "レッスンごとに、覚えることと一緒に（調べる）"),
    ),
  ));

  // 3Dは神経系（骨格を薄く）。タップした所を図鑑で開く
  viewer.onPick = (elementId, point) => {
    const term = termAt(ctx, elementId, point);
    if (term) location.hash = `#/explore/${term.id}`;
  };
  viewer.onHover = (elementId, point) => termAt(ctx, elementId, point)?.ja ?? null;
  await viewer.show({ systems: ["nervous"], context: ["skeletal"], contextOpacity: 0.3 });
  if (ctx.signal.aborted) return;
  viewer.highlight([]);
  viewer.overview();
}
