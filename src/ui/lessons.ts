import { systems, termById, units, type Unit } from "../content";
import { db, nowIso, type LearnedTerm } from "../db";
import { h } from "../dom";
import { normalize, searchTerms, searchUnits } from "../search";
import { termAt, type AppContext } from "./context";

/** レッスンの一覧（#/lessons）。系統→まとまり→レッスンのフォルダーと、最近のレッスン・検索 */
export async function lessons(ctx: AppContext): Promise<void> {
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  // 皮膚と骨格だけを読み込む（全系統だと初めて開いたとき約25MB。ほかの系統は使う画面で読み込む）
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  // 骨や骨の部位をタップしたら、図鑑でその語を開く
  ctx.viewer.onPick = (elementId, point) => {
    const term = termAt(ctx, elementId, point);
    if (term) location.hash = `#/explore/${term.id}`;
  };
  ctx.viewer.onHover = (elementId, point) => termAt(ctx, elementId, point)?.ja ?? null;
  ctx.hint("タップで図鑑を開く・ドラッグで回転");

  const [learned, openSetting] = await Promise.all([db.learned.toArray(), db.settings.get(OPEN_FOLDERS)]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  // 開いたフォルダーは覚えておき、レッスンから戻ったときも開いたままにする
  const openIds = new Set(Array.isArray(openSetting?.value) ? (openSetting.value as string[]) : []);
  const folder = (id: string, title: (Node | string)[], summary: string, allDone: boolean, list: HTMLElement, kind = "system folder"): HTMLElement =>
    h("details", {
      class: allDone ? `${kind} done` : kind,
      open: openIds.has(id),
      ontoggle: (event: Event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) openIds.add(id);
        else openIds.delete(id);
        void db.settings.put({ key: OPEN_FOLDERS, value: [...openIds], updatedAt: nowIso() });
      },
    },
      h("summary", {},
        h("span", { class: "folder-title" }, ...title),
        h("span", { class: "folder-count" }, summary),
      ),
      list,
    );
  const nextUnit = nextLesson(learned);
  const recent = recentLessons(learned).filter((unit) => unit !== nextUnit);
  /** レッスンの行。途中まで学んだレッスンには「途中」の印 */
  const unitRow = (unit: Unit) => {
    const done = unit.terms.filter((term) => learnedIds.has(term.id)).length;
    return h("li", {},
      h("a", { href: `#/learn/${unit.id}`, class: done === unit.terms.length ? "unit done" : done ? "unit partial" : "unit" },
        h("span", { class: "unit-title" }, unit.title),
        h("span", { class: "unit-count" }, done ? `${done}/${unit.terms.length}語` : `${unit.terms.length}語`),
      ));
  };

  // 検索: レッスンの題と語。打っている間はフォルダーの代わりに当たったものを並べる
  const search = h("input", {
    class: "search", type: "search", placeholder: "レッスン・語を探す", "aria-label": "レッスンと語を探す",
    oninput: () => {
      const query = normalize(search.value.trim());
      folders.hidden = !!query;
      results.hidden = !query;
      if (query) showResults(query);
    },
  });
  const results = h("div", { class: "search-results", hidden: true });
  const showResults = (query: string) => {
    const lessons = searchUnits(query);
    const found = searchTerms(query);
    results.replaceChildren(
      lessons.length ? h("h3", {}, `レッスン ${lessons.length}`) : "",
      lessons.length ? h("ul", { class: "units" }, ...lessons.slice(0, 20).map(unitRow)) : "",
      found.length ? h("h3", {}, `語 ${found.length}`, found.length > 40 ? h("span", { class: "muted" }, "（はじめの40）") : "") : "",
      found.length ? h("ul", { class: "term-list" }, ...found.slice(0, 40).map((term) => h("li", {},
        h("a", { class: "term-row", href: `#/explore/${term.id}` },
          h("span", {}, term.ja, h("span", { class: "term-where" }, `${systems.find((s) => s.id === term.system)?.ja ?? ""}・${unitTitle(term.unit)}`)),
          h("span", { class: "en", lang: "en" }, term.en))))) : "",
      lessons.length || found.length ? "" : h("p", { class: "muted" }, "見つかりませんでした。"),
    );
  };

  const folders = h("div", {}, ...systems.flatMap((system) => {
      const list = units.filter((unit) => unit.system === system.id);
      if (!list.length) return [];
      const total = list.reduce((sum, unit) => sum + unit.terms.length, 0);
      const done = list.reduce((sum, unit) => sum + unit.terms.filter((term) => learnedIds.has(term.id)).length, 0);
      // まとまり（骨格系の体幹・上肢など）のある系統は、系統→まとまり→レッスンの入れ子のフォルダーにする
      const groups = [...new Set(list.map((unit) => unit.group))];
      const content = groups[0]
        ? h("div", { class: "subfolders" }, ...groups.map((group) => {
          const inGroup = list.filter((unit) => unit.group === group);
          const groupTotal = inGroup.reduce((sum, unit) => sum + unit.terms.length, 0);
          const groupDone = inGroup.reduce((sum, unit) => sum + unit.terms.filter((term) => learnedIds.has(term.id)).length, 0);
          return folder(`${system.id}/${group}`, [group ?? ""], `${inGroup.length}レッスン・${groupDone ? `${groupDone}/${groupTotal}` : groupTotal}語`,
            groupDone === groupTotal, h("ul", { class: "units" }, ...inGroup.map(unitRow)), "subfolder");
        }))
        : h("ul", { class: "units" }, ...list.map(unitRow));
      return [folder(system.id,
        [h("span", { class: "swatch", style: `background:${system.color}` }), system.ja],
        `${list.length}レッスン・${done ? `${done}/${total}` : total}語`,
        done === total,
        content,
      )];
    }));

  ctx.panel.replaceChildren(
    search,
    nextUnit ? h("a", { class: "primary next-lesson", href: `#/learn/${nextUnit.id}` }, `次のレッスン「${nextUnit.title}」`) : "",
    recent.length ? h("section", { class: "recent" },
      h("h3", {}, "最近のレッスン"),
      h("ul", { class: "units" }, ...recent.map(unitRow)),
    ) : "",
    results,
    folders,
    h("p", { class: "muted lessons-note" }, "語根カード・臓器の図・骨学試験は、ホームのそれぞれの項目から開きます。"),
  );
}

const OPEN_FOLDERS = "homeOpenFolders";

/**
 * 次に学ぶレッスン（ホーム・レッスンの一覧と、復習・レッスンの終わりに出す）。最後に学んだレッスンが途中ならそれ、終えていれば
 * 同じまとまり→同じ系統の、後ろにあるまだ終えていないレッスン。何も学んでいなければ最初のレッスン。
 */
export function nextLesson(learned: LearnedTerm[]): Unit | undefined {
  const learnedIds = new Set(learned.map((item) => item.termId));
  const open = (unit: Unit) => unit.terms.some((term) => !learnedIds.has(term.id));
  const last = recentLessons(learned)[0];
  if (last) {
    if (open(last)) return last;
    const after = units.slice(units.indexOf(last) + 1);
    const next = after.find((unit) => open(unit) && unit.system === last.system && unit.group === last.group)
      ?? after.find((unit) => open(unit) && unit.system === last.system)
      ?? units.find((unit) => open(unit) && unit.system === last.system);
    if (next) return next;
  }
  return units.find(open);
}

/** 最近学んだレッスン（新しい順に3つまで）。記録のレッスンIDは並べ直しで変わるので、語から今のレッスンを引く */
function recentLessons(learned: LearnedTerm[]): Unit[] {
  const latest = new Map<string, string>();
  for (const item of learned) {
    const unit = termById.get(item.termId)?.unit;
    if (unit && (latest.get(unit) ?? "") < item.learnedAt) latest.set(unit, item.learnedAt);
  }
  return [...latest].sort((a, b) => b[1].localeCompare(a[1])).slice(0, 3).flatMap(([id]) => units.filter((unit) => unit.id === id));
}

function unitTitle(unitId: string): string {
  return units.find((unit) => unit.id === unitId)?.title ?? "";
}
